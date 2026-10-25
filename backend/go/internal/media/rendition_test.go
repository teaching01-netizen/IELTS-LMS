package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"sync/atomic"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func testFigure(width, height int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 255 / width), uint8(y * 255 / height), uint8((x ^ y) & 0xFF), 255})
		}
	}
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func encodeJPEG(t *testing.T, img image.Image, quality int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestRenderDeliveryDownscalesLargePNG(t *testing.T) {
	src := encodePNG(t, testFigure(3000, 2000))
	out, ok := renderDelivery(src, "image/png")
	if !ok {
		t.Fatalf("a 3000x2000 figure must render")
	}
	if len(out) >= len(src) {
		t.Fatalf("rendition %d bytes must be smaller than original %d", len(out), len(src))
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || format != "png" {
		t.Fatalf("rendition must be a PNG: %v %q", err, format)
	}
	if cfg.Width != 1600 || cfg.Height != 1066 {
		t.Fatalf("rendition is %dx%d, want 1600x1066", cfg.Width, cfg.Height)
	}
}

func TestRenderDeliveryKeepsOriginalWhenNotWorthIt(t *testing.T) {
	small := encodeJPEG(t, testFigure(200, 100), 50)
	if _, ok := renderDelivery(small, "image/jpeg"); ok {
		t.Fatalf("an already-small JPEG must be served as the original")
	}
	if _, ok := renderDelivery([]byte("\x89PNG\r\n\x1a\nnot really"), "image/png"); ok {
		t.Fatalf("corrupt bytes must fall back to the original")
	}
}

// afterSOI splices a JPEG segment in front of the original's first marker.
func afterSOI(jpegBytes, segment []byte) []byte {
	out := append([]byte{}, jpegBytes[:2]...)
	out = append(out, segment...)
	return append(out, jpegBytes[2:]...)
}

// tiffWithTag is a big-endian EXIF TIFF block whose IFD0 holds one SHORT tag.
func tiffWithTag(tag uint16, value byte) []byte {
	return []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, byte(tag >> 8), byte(tag), 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0}
}

// exifOrientationSegment is an APP1 Exif segment whose IFD0 holds only the
// orientation tag.
func exifOrientationSegment(orientation byte) []byte {
	payload := append([]byte("Exif\x00\x00"), tiffWithTag(0x0112, orientation)...)
	return append([]byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}, payload...)
}

// iccSegment is an APP2 ICC_PROFILE segment holding a one-slice profile whose
// header names colorSpace.
func iccSegment(colorSpace string) []byte {
	profile := make([]byte, 128)
	copy(profile[16:20], colorSpace)
	payload := append([]byte("ICC_PROFILE\x00\x01\x01"), profile...)
	return append([]byte{0xFF, 0xE2, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}, payload...)
}

// pngChunk builds one chunk with a valid CRC.
func pngChunk(kind string, data []byte) []byte {
	out := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
	out = append(out, kind...)
	out = append(out, data...)
	return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(append([]byte(kind), data...)))
}

// afterIHDR splices chunks between the PNG's IHDR and the rest.
func afterIHDR(pngBytes []byte, chunks ...[]byte) []byte {
	out := append([]byte{}, pngBytes[:33]...)
	for _, chunk := range chunks {
		out = append(out, chunk...)
	}
	return append(out, pngBytes[33:]...)
}

// quadrants paints four solid quarters so orientation survives JPEG loss.
func quadrants(width, height int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			switch {
			case x < width/2 && y < height/2:
				img.Set(x, y, color.RGBA{255, 0, 0, 255})
			case y < height/2:
				img.Set(x, y, color.RGBA{0, 255, 0, 255})
			case x < width/2:
				img.Set(x, y, color.RGBA{0, 0, 255, 255})
			default:
				img.Set(x, y, color.RGBA{255, 255, 255, 255})
			}
		}
	}
	return img
}

func near(c color.Color, r, g, b uint8) bool {
	cr, cg, cb, _ := c.RGBA()
	d := func(have uint32, want uint8) bool {
		v := int(have>>8) - int(want)
		return v > -40 && v < 40
	}
	return d(cr, r) && d(cg, g) && d(cb, b)
}

// Phone photos carry EXIF: they must shrink too, upright and without the EXIF
// (whose GPS and camera data students have no use for).
func TestRenderDeliveryBakesExifOrientationIntoJPEG(t *testing.T) {
	big := encodeJPEG(t, quadrants(1800, 900), 95)

	out, ok := renderDelivery(afterSOI(big, exifOrientationSegment(6)), "image/jpeg")
	if !ok {
		t.Fatal("an EXIF JPEG must render")
	}
	if jpegOrientation(out) != 1 || bytes.Contains(out, []byte("Exif\x00\x00")) {
		t.Fatal("the rendition must not carry EXIF")
	}
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	// Orientation 6 is a quarter turn clockwise: the 1800x900 original shows
	// as 800x1600, its bottom-left (blue) at the top-left.
	if b := img.Bounds(); b.Dx() != 800 || b.Dy() != 1600 {
		t.Fatalf("rendition is %dx%d, want 800x1600", b.Dx(), b.Dy())
	}
	if c := img.At(100, 100); !near(c, 0, 0, 255) {
		t.Fatalf("top-left is %v, want the original's bottom-left blue", c)
	}
	if c := img.At(700, 100); !near(c, 255, 0, 0) {
		t.Fatalf("top-right is %v, want the original's top-left red", c)
	}

	// EXIF without a readable orientation renders as it is stored.
	plain, ok := renderDelivery(afterSOI(big, append([]byte{0xFF, 0xE1, 0x00, 0x0A}, []byte("Exif\x00\x00\x00\x00")...)), "image/jpeg")
	if !ok {
		t.Fatal("an EXIF JPEG without an orientation must render")
	}
	if cfg, err := jpeg.DecodeConfig(bytes.NewReader(plain)); err != nil || cfg.Width != 1600 || cfg.Height != 800 {
		t.Fatalf("rendition config %+v, %v; want 1600x800", cfg, err)
	}
}

// Every EXIF orientation, on a 3x2 image whose pixels are numbered 1-6.
func TestOrientMatchesExifOrientations(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for i := 0; i < 6; i++ {
		src.Set(i%3, i/3, color.RGBA{uint8(i + 1), 0, 0, 255})
	}
	// Stored:  1 2 3
	//          4 5 6
	for orientation, want := range map[int][]string{
		1: {"123", "456"},
		2: {"321", "654"},
		3: {"654", "321"},
		4: {"456", "123"},
		5: {"14", "25", "36"},
		6: {"41", "52", "63"},
		7: {"63", "52", "41"},
		8: {"36", "25", "14"},
	} {
		got := orient(src, orientation)
		var rows []string
		for y := 0; y < got.Bounds().Dy(); y++ {
			row := ""
			for x := 0; x < got.Bounds().Dx(); x++ {
				r, _, _, _ := got.At(x, y).RGBA()
				row += fmt.Sprint(r >> 8)
			}
			rows = append(rows, row)
		}
		if fmt.Sprint(rows) != fmt.Sprint(want) {
			t.Errorf("orientation %d = %v, want %v", orientation, rows, want)
		}
	}
}

// A figure keeps its colours: RGB profiles carry into the rendition, other
// colour spaces (which no longer describe the re-encoded pixels) do not.
func TestRenderDeliveryCarriesRGBColorProfiles(t *testing.T) {
	big := encodeJPEG(t, testFigure(1800, 900), 95)
	rgb := iccSegment("RGB ")
	out, ok := renderDelivery(afterSOI(big, rgb), "image/jpeg")
	if !ok {
		t.Fatal("a JPEG with an RGB profile must render")
	}
	if !bytes.Equal(out[2:2+len(rgb)], rgb) {
		t.Fatal("the RGB profile must follow the rendition's SOI")
	}
	if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("rendition must stay decodable: %v", err)
	}
	if out, ok := renderDelivery(afterSOI(big, iccSegment("GRAY")), "image/jpeg"); !ok || bytes.Contains(out, []byte("ICC_PROFILE")) {
		t.Fatal("a non-RGB profile must render without the profile")
	}

	iccp := pngChunk("iCCP", append([]byte("Display P3\x00\x00"), 0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01))
	out, ok = renderDelivery(afterIHDR(encodePNG(t, testFigure(1700, 1000)), iccp), "image/png")
	if !ok {
		t.Fatal("a PNG with a profile must render")
	}
	if !bytes.Equal(out[33:33+len(iccp)], iccp) {
		t.Fatal("the iCCP chunk must follow the rendition's IHDR")
	}
	if _, err := png.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("rendition must stay decodable: %v", err)
	}
}

// What a still re-encode would lose keeps the original.
func TestRenderDeliveryKeepsOriginalForAnimationAndOrientation(t *testing.T) {
	big := encodePNG(t, testFigure(1700, 1000))
	if _, ok := renderDelivery(big, "image/png"); !ok {
		t.Fatal("the plain PNG must render")
	}
	if _, ok := renderDelivery(afterIHDR(big, pngChunk("acTL", make([]byte, 8))), "image/png"); ok {
		t.Fatal("an animated PNG must be served as the original")
	}
	if _, ok := renderDelivery(afterIHDR(big, pngChunk("eXIf", tiffWithTag(0x0112, 6))), "image/png"); ok {
		t.Fatal("a PNG with an EXIF orientation must be served as the original")
	}
	// macOS screenshots carry eXIf with no orientation (an Exif IFD pointer):
	// they must still render.
	if _, ok := renderDelivery(afterIHDR(big, pngChunk("eXIf", tiffWithTag(0x8769, 0))), "image/png"); !ok {
		t.Fatal("a PNG whose EXIF sets no orientation must render")
	}
	vp8x := func(flags byte) []byte {
		return append([]byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00"), flags, 0, 0, 0, 0, 0, 0, 0, 0, 0)
	}
	for flags, want := range map[byte]bool{0x20: true, 0x08: true, 0x02: true, 0x10: false, 0x00: false} {
		if got := webpHasExtras(vp8x(flags)); got != want {
			t.Errorf("webpHasExtras(flags %#x) = %v, want %v", flags, got, want)
		}
	}
	if webpHasExtras([]byte("RIFF\x00\x00\x00\x00WEBPVP8 \x0a\x00\x00\x00\x20\x00")) {
		t.Error("a simple WebP has no extras")
	}
}

// A rendition left by an earlier process is not rendered again.
func TestRenditionWorkerSkipsExistingRendition(t *testing.T) {
	store := objectstore.NewLocalStore(t.TempDir())
	asset := Asset{ID: "a1", ObjectKey: "assets/a1", ContentType: "image/png"}
	if err := store.Put(context.Background(), asset.ObjectKey+deliveryRenditionSuffix, nil, "image/png"); err != nil {
		t.Fatal(err)
	}
	w := newRenditionWorker()
	var renders atomic.Int32
	w.render = func(b []byte, ct string) ([]byte, bool) {
		renders.Add(1)
		return nil, false
	}
	w.kick(store, asset)
	w.wg.Wait()
	if got := renders.Load(); got != 0 {
		t.Fatalf("an existing rendition was rendered %d times, want 0", got)
	}
}

// A room requesting a fresh figure at once must render it once.
func TestRenditionWorkerRendersOncePerAsset(t *testing.T) {
	store := objectstore.NewLocalStore(t.TempDir())
	src := encodePNG(t, testFigure(2000, 1000))
	if err := store.Put(context.Background(), "assets/a1", src, "image/png"); err != nil {
		t.Fatal(err)
	}
	w := newRenditionWorker()
	var renders atomic.Int32
	w.render = func(b []byte, ct string) ([]byte, bool) {
		renders.Add(1)
		return renderDelivery(b, ct)
	}
	asset := Asset{ID: "a1", ObjectKey: "assets/a1", ContentType: "image/png"}
	var start sync.WaitGroup
	start.Add(50)
	var done sync.WaitGroup
	for i := 0; i < 50; i++ {
		done.Add(1)
		go func() {
			defer done.Done()
			start.Done()
			start.Wait()
			w.kick(store, asset)
		}()
	}
	done.Wait()
	w.wg.Wait()
	if got := renders.Load(); got != 1 {
		t.Fatalf("50 concurrent requests rendered %d times, want 1", got)
	}
	out, err := store.Get(context.Background(), "assets/a1"+deliveryRenditionSuffix)
	if err != nil || len(out) == 0 || len(out) >= len(src) {
		t.Fatalf("rendition must be persisted and smaller: %d bytes, err %v", len(out), err)
	}
}

func TestOpenDeliveryServesRenditionOnceReady(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(false)
	root := t.TempDir()
	store := objectstore.NewLocalStore(root)
	svc := NewService(db, tx.NewRunner(db), store)
	src := encodePNG(t, testFigure(2000, 1000))
	if err := store.Put(context.Background(), "assets/a1", src, "image/png"); err != nil {
		t.Fatal(err)
	}
	read := func() (string, []byte) {
		t.Helper()
		mock.ExpectQuery(regexp.QuoteMeta("FROM media_assets WHERE id = ?")).
			WithArgs("a1").
			WillReturnRows(assetRow("a1", StatusFinalized, "assets/a1", "image/png"))
		content, err := svc.OpenDelivery(context.Background(), "a1")
		if err != nil {
			t.Fatalf("open delivery: %v", err)
		}
		defer content.Body.Close()
		body, err := io.ReadAll(content.Body)
		if err != nil {
			t.Fatal(err)
		}
		return content.ContentType, body
	}

	// First request: no rendition yet -> the original, never a wait.
	if ct, body := read(); ct != "image/png" || !bytes.Equal(body, src) {
		t.Fatalf("first read must serve the original (%s, %d bytes)", ct, len(body))
	}
	svc.renditions.wg.Wait()
	// Later requests get the screen-sized copy.
	if _, body := read(); len(body) == 0 || len(body) >= len(src) {
		t.Fatalf("rendition must be served once ready: %d bytes vs original %d", len(body), len(src))
	}
	// An empty marker means the original is already the best copy.
	if err := os.WriteFile(filepath.Join(root, "assets", "a1"+deliveryRenditionSuffix), nil, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, body := read(); !bytes.Equal(body, src) {
		t.Fatalf("empty marker must serve the original")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
