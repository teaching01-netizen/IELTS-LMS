package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/image/draw"

	"example.com/ielts-proctoring/internal/platform/objectstore"
)

// Students are served a delivery rendition of each figure, not the authoring
// original: authoring accepts up to 10 MiB / 8192px with no re-encoding, and a
// room downloads every figure once per student over one venue uplink. The
// rendition is rendered once per asset in the background and persisted next
// to the original; until it exists (or when the original is already the
// smaller copy) the original is served, so optimization never adds latency
// and never fails a figure.
const (
	// The suffix versions the encoding: re-tuning renders under a new key.
	// v2: EXIF JPEGs render with their orientation applied, and colour
	// profiles carry over.
	deliveryRenditionSuffix = ".delivery-v2"
	deliveryMaxEdge         = 1600
	deliveryJPEGQuality     = 82
	deliveryRenderTimeout   = time.Minute
	// Each in-flight render holds a decoded image (up to ~100 MB at the 25 MP
	// upload cap); renders queue behind this bound instead of piling up.
	deliveryRenderConcurrency = 2
)

// Content is a finalized object opened for streaming.
type Content struct {
	ContentType string
	Body        io.ReadSeekCloser
}

// OpenFinalized streams the original bytes of a finalized asset.
func (s *Service) OpenFinalized(ctx context.Context, assetID string) (Content, error) {
	asset, err := s.finalizedAsset(ctx, assetID)
	if err != nil {
		return Content{}, err
	}
	s.renditions.kick(s.store, asset)
	body, err := s.openObject(ctx, asset.ObjectKey)
	if err != nil {
		return Content{}, serviceUnavailable()
	}
	return Content{ContentType: asset.ContentType, Body: body}, nil
}

// OpenDelivery streams the student copy of a finalized asset: its delivery
// rendition once rendered, the original until then.
func (s *Service) OpenDelivery(ctx context.Context, assetID string) (Content, error) {
	asset, err := s.finalizedAsset(ctx, assetID)
	if err != nil {
		return Content{}, err
	}
	if contentType, ok := deliveryContentType(asset.ContentType); ok {
		body, err := s.openObject(ctx, asset.ObjectKey+deliveryRenditionSuffix)
		if err != nil {
			s.renditions.kick(s.store, asset)
		} else if size, err := body.Seek(0, io.SeekEnd); err == nil && size > 0 {
			if _, err := body.Seek(0, io.SeekStart); err == nil {
				return Content{ContentType: contentType, Body: body}, nil
			}
			_ = body.Close()
		} else {
			// Empty marker: the original is already the best copy.
			_ = body.Close()
		}
	}
	body, err := s.openObject(ctx, asset.ObjectKey)
	if err != nil {
		return Content{}, serviceUnavailable()
	}
	return Content{ContentType: asset.ContentType, Body: body}, nil
}

func (s *Service) openObject(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	if opener, ok := s.store.(objectstore.Opener); ok {
		return opener.Open(ctx, key)
	}
	body, err := s.store.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return nopSeekCloser{bytes.NewReader(body)}, nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

// deliveryContentType is the rendition's type for a source type. GIFs pass
// through untouched (animation would be lost); WebP renders to PNG and is kept
// only when that is smaller.
func deliveryContentType(source string) (string, bool) {
	switch source {
	case "image/jpeg":
		return "image/jpeg", true
	case "image/png", "image/webp":
		return "image/png", true
	}
	return "", false
}

type renditionWorker struct {
	sem    chan struct{}
	render func(src []byte, contentType string) ([]byte, bool)
	wg     sync.WaitGroup

	mu sync.Mutex
	// offcut: one attempt per asset per process; a transient store failure
	// keeps serving the original until the next deploy retries it.
	attempted map[string]struct{}
}

func newRenditionWorker() *renditionWorker {
	return &renditionWorker{
		sem:       make(chan struct{}, deliveryRenderConcurrency),
		render:    renderDelivery,
		attempted: map[string]struct{}{},
	}
}

// kick renders an asset's rendition in the background, at most once per
// process: a room requesting a fresh figure 400 times renders it once.
func (w *renditionWorker) kick(store objectstore.Store, asset Asset) {
	contentType, ok := deliveryContentType(asset.ContentType)
	if w == nil || !ok {
		return
	}
	key := asset.ObjectKey + deliveryRenditionSuffix
	w.mu.Lock()
	if _, seen := w.attempted[key]; seen {
		w.mu.Unlock()
		return
	}
	w.attempted[key] = struct{}{}
	w.mu.Unlock()
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		// A rendition (or empty marker) from an earlier process is final:
		// restarts must not re-render every figure staff open.
		if store.Stat(context.Background(), key) == nil {
			return
		}
		w.sem <- struct{}{}
		defer func() { <-w.sem }()
		ctx, cancel := context.WithTimeout(context.Background(), deliveryRenderTimeout)
		defer cancel()
		// Author-supplied bytes reach third-party decoders: a decoder panic
		// must cost one rendition, not the API process.
		defer func() {
			if p := recover(); p != nil {
				slog.ErrorContext(ctx, "media delivery rendition panicked", "asset_id", asset.ID, "panic", fmt.Sprint(p))
			}
		}()
		src, err := store.Get(ctx, asset.ObjectKey)
		if err != nil {
			slog.WarnContext(ctx, "media delivery rendition: read original failed", "asset_id", asset.ID, "error", err)
			return
		}
		out, ok := w.render(src, asset.ContentType)
		if !ok {
			out = nil
		}
		if err := store.Put(ctx, key, out, contentType); err != nil {
			slog.WarnContext(ctx, "media delivery rendition: store failed", "asset_id", asset.ID, "error", err)
		}
	}()
}

// renderDelivery downscales to deliveryMaxEdge and re-encodes. ok=false means
// the original should be served: undecodable, over the pixel bound, not
// smaller, or carrying what a re-encode would lose (animation, CMYK, a WebP
// profile or EXIF, a PNG EXIF orientation). Re-encoding drops JPEG EXIF, so the
// orientation browsers apply is baked into the pixels; RGB colour profiles are
// copied over.
func renderDelivery(src []byte, contentType string) ([]byte, bool) {
	var colorMeta []byte
	switch contentType {
	case "image/jpeg":
		colorMeta = jpegRGBProfile(src)
	case "image/png":
		var keepOriginal bool
		if colorMeta, keepOriginal = pngMetadata(src); keepOriginal {
			return nil, false
		}
	case "image/webp":
		if webpHasExtras(src) {
			return nil, false
		}
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(src))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 ||
		cfg.Width > maxImageDimension || cfg.Height > maxImageDimension ||
		cfg.Width*cfg.Height > maxDecodedPixels {
		return nil, false
	}
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, false
	}
	// Browsers colour-manage CMYK; a naive RGB conversion would not match.
	if _, cmyk := img.(*image.CMYK); cmyk {
		return nil, false
	}
	if long := max(cfg.Width, cfg.Height); long > deliveryMaxEdge {
		width := max(1, cfg.Width*deliveryMaxEdge/long)
		height := max(1, cfg.Height*deliveryMaxEdge/long)
		dst := image.NewRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
		img = dst
	}
	var buf bytes.Buffer
	if contentType == "image/jpeg" {
		err = jpeg.Encode(&buf, orient(img, jpegOrientation(src)), &jpeg.Options{Quality: deliveryJPEGQuality})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	}
	if err != nil {
		return nil, false
	}
	out := withColorMetadata(buf.Bytes(), contentType, colorMeta)
	if len(out) >= len(src) {
		return nil, false
	}
	return out, true
}

// orient applies an EXIF orientation to the pixels, so the rendition shows
// what browsers show for the original. Runs after the downscale: it is a
// permutation, so the order does not change the result, only the cost.
func orient(img image.Image, orientation int) image.Image {
	if orientation < 2 || orientation > 8 {
		return img
	}
	src, ok := img.(*image.RGBA)
	if !ok || src.Rect.Min != (image.Point{}) {
		src = image.NewRGBA(image.Rect(0, 0, img.Bounds().Dx(), img.Bounds().Dy()))
		draw.Draw(src, src.Rect, img, img.Bounds().Min, draw.Src)
	}
	w, h := src.Rect.Dx(), src.Rect.Dy()
	dw, dh := w, h
	if orientation >= 5 { // 5-8 transpose: the sides swap
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = w - 1 - x
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dy = h - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			to, from := dst.PixOffset(dx, dy), src.PixOffset(x, y)
			copy(dst.Pix[to:to+4], src.Pix[from:from+4])
		}
	}
	return dst
}

// jpegSegments calls visit with each whole marker segment (marker, length,
// payload) before the scan data.
func jpegSegments(b []byte, visit func(marker byte, segment []byte)) {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return
	}
	for i := 2; i+4 <= len(b); {
		if b[i] != 0xFF {
			return
		}
		marker := b[i+1]
		if marker == 0xFF { // fill byte
			i++
			continue
		}
		if marker == 0xDA || marker == 0xD9 { // SOS / EOI: no metadata past here
			return
		}
		end := i + 2 + (int(b[i+2])<<8 | int(b[i+3]))
		if end < i+4 || end > len(b) {
			return
		}
		visit(marker, b[i:end])
		i = end
	}
}

// jpegOrientation is the EXIF orientation (1-8) browsers apply to a JPEG; 1
// when there is none or it cannot be read.
func jpegOrientation(b []byte) int {
	orientation := 1
	jpegSegments(b, func(marker byte, segment []byte) {
		if marker == 0xE1 && len(segment) > 10 && string(segment[4:10]) == "Exif\x00\x00" {
			if o := tiffOrientation(segment[10:]); o != 0 {
				orientation = o
			}
		}
	})
	return orientation
}

// tiffOrientation reads tag 0x0112 from IFD0 of an EXIF TIFF block; 0 when
// it is absent or malformed.
func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	if order.Uint16(t[2:]) != 42 {
		return 0
	}
	ifd := uint64(order.Uint32(t[4:]))
	if ifd < 8 || ifd+2 > uint64(len(t)) {
		return 0
	}
	entries := uint64(order.Uint16(t[ifd:]))
	for k := uint64(0); k < entries; k++ {
		e := ifd + 2 + 12*k
		if e+12 > uint64(len(t)) {
			return 0
		}
		if order.Uint16(t[e:]) != 0x0112 {
			continue
		}
		// SHORT, count 1: the value is the first two bytes of the value field.
		if order.Uint16(t[e+2:]) != 3 || order.Uint32(t[e+4:]) != 1 {
			return 0
		}
		if o := int(order.Uint16(t[e+8:])); o >= 1 && o <= 8 {
			return o
		}
		return 0
	}
	return 0
}

// jpegRGBProfile returns a JPEG's ICC_PROFILE segments, ready to follow a new
// SOI, when they describe an RGB colour space; nil otherwise.
func jpegRGBProfile(b []byte) []byte {
	var segments []byte
	rgb := false
	jpegSegments(b, func(marker byte, segment []byte) {
		// APP2 "ICC_PROFILE\0", sequence number, count, then a slice of the profile.
		if marker != 0xE2 || len(segment) < 18 || string(segment[4:16]) != "ICC_PROFILE\x00" {
			return
		}
		// The first slice opens with the profile header; bytes 16-19 name the colour space.
		if segment[16] == 1 && len(segment) >= 38 {
			rgb = string(segment[34:38]) == "RGB "
		}
		segments = append(segments, segment...)
	})
	if !rgb {
		return nil
	}
	return segments
}

// pngMetadata returns an RGB-family PNG's colour-space chunks (iCCP, sRGB,
// gAMA, cHRM) verbatim, and whether the PNG must be served as it is: animated
// (APNG) or with an EXIF orientation, which browsers disagree on applying.
// macOS writes eXIf without an orientation into every screenshot; those render.
func pngMetadata(b []byte) (colorChunks []byte, keepOriginal bool) {
	// Signature, then IHDR: length, type, 13 data bytes (colour type at 9), CRC.
	if len(b) < 33 || string(b[12:16]) != "IHDR" {
		return nil, false
	}
	colorType := b[25]
	rgb := colorType == 2 || colorType == 3 || colorType == 6
	for i := 8; i+12 <= len(b); {
		n := int(binary.BigEndian.Uint32(b[i:]))
		if n < 0 || n > len(b)-i-12 {
			break
		}
		end := i + 12 + n
		switch string(b[i+4 : i+8]) {
		case "IDAT", "IEND":
			return colorChunks, false
		case "acTL":
			return nil, true
		case "eXIf":
			if tiffOrientation(b[i+8:i+8+n]) > 1 {
				return nil, true
			}
		case "iCCP", "sRGB", "gAMA", "cHRM":
			if rgb {
				colorChunks = append(colorChunks, b[i:end]...)
			}
		}
		i = end
	}
	return colorChunks, false
}

// webpHasExtras reports an extended (VP8X) WebP declaring an ICC profile, EXIF,
// or animation, all of which a PNG rendition would drop.
func webpHasExtras(b []byte) bool {
	return len(b) >= 21 && string(b[12:16]) == "VP8X" && b[20]&(0x20|0x08|0x02) != 0
}

// withColorMetadata splices source colour metadata into an encoded rendition:
// after the JPEG SOI, or after the PNG signature and IHDR (before any PLTE or
// IDAT, where those chunks must sit).
func withColorMetadata(encoded []byte, contentType string, meta []byte) []byte {
	at := 2
	if contentType != "image/jpeg" {
		at = 33
	}
	if len(meta) == 0 || len(encoded) < at {
		return encoded
	}
	out := make([]byte, 0, len(encoded)+len(meta))
	out = append(out, encoded[:at]...)
	out = append(out, meta...)
	return append(out, encoded[at:]...)
}
