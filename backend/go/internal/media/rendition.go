package media

import (
	"bytes"
	"context"
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
	deliveryRenditionSuffix = ".delivery-v1"
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
// the original should be served: undecodable, over the pixel bound, carrying
// EXIF (re-encoding would drop the orientation browsers apply), or not smaller.
func renderDelivery(src []byte, contentType string) ([]byte, bool) {
	if contentType == "image/jpeg" && jpegHasExif(src) {
		return nil, false
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
	if long := max(cfg.Width, cfg.Height); long > deliveryMaxEdge {
		width := max(1, cfg.Width*deliveryMaxEdge/long)
		height := max(1, cfg.Height*deliveryMaxEdge/long)
		dst := image.NewRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
		img = dst
	}
	var buf bytes.Buffer
	if contentType == "image/jpeg" {
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: deliveryJPEGQuality})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	}
	if err != nil || buf.Len() >= len(src) {
		return nil, false
	}
	return buf.Bytes(), true
}

// jpegHasExif reports an APP1 Exif segment before the image data.
func jpegHasExif(b []byte) bool {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return false
	}
	for i := 2; i+4 <= len(b); {
		if b[i] != 0xFF {
			return false
		}
		marker := b[i+1]
		if marker == 0xFF { // fill byte
			i++
			continue
		}
		if marker == 0xDA || marker == 0xD9 { // SOS / EOI: no metadata past here
			return false
		}
		n := int(b[i+2])<<8 | int(b[i+3])
		if marker == 0xE1 && i+10 <= len(b) && string(b[i+4:i+10]) == "Exif\x00\x00" {
			return true
		}
		i += 2 + n
	}
	return false
}
