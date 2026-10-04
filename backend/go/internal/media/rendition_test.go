package media

import (
	"bytes"
	"context"
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
	// Re-encoding drops EXIF, and with it the orientation browsers apply.
	big := encodeJPEG(t, testFigure(2400, 1200), 95)
	exif := append([]byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x0A}, []byte("Exif\x00\x00\x00\x00")...)
	withExif := append(exif, big[2:]...)
	if _, ok := renderDelivery(withExif, "image/jpeg"); ok {
		t.Fatalf("an EXIF JPEG must be served as the original")
	}
	if _, ok := renderDelivery(big, "image/jpeg"); !ok {
		t.Fatalf("the same JPEG without EXIF must render")
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
