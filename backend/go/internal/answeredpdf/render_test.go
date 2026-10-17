package answeredpdf

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// Needs a built SPA and a local Chromium:
//
//	bun run build && ANSWEREDPDF_DIST=$PWD/dist go test ./internal/answeredpdf
func renderer(t *testing.T) *Renderer {
	dist := os.Getenv("ANSWEREDPDF_DIST")
	if dist == "" {
		t.Skip("ANSWEREDPDF_DIST not set")
	}
	files := http.FileServer(http.Dir(dist))
	return New(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dist, filepath.Clean(r.URL.Path))); err != nil || r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(dist, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	}), 1)
}

func TestRenderA4LandscapeOnePagePerQuestion(t *testing.T) {
	r := renderer(t)
	payload, err := os.ReadFile("testdata/payload.json")
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := r.Render(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if out := os.Getenv("ANSWEREDPDF_OUT"); out != "" {
		_ = os.WriteFile(out, pdf, 0o600)
	}
	if !bytes.Contains(pdf, []byte("/ObjStm")) {
		t.Fatal("renderer returned an unoptimized PDF without compressed object streams")
	}
	dimensions, err := api.PageDims(t.Context(), bytes.NewReader(pdf), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	pages := len(dimensions)
	// Cover and answer sheet, then one page for each of the 12 questions.
	if pages < 12+2 || pages > 12+4 {
		t.Fatalf("pages = %d, want one per question plus front matter", pages)
	}
	for _, box := range dimensions {
		if box.Width < 841 || box.Width > 843 || box.Height < 594 || box.Height > 596 {
			t.Fatalf("page box %v is not A4 landscape", box)
		}
	}
}

func TestRenderFailsClosedOnMissingFigure(t *testing.T) {
	r := renderer(t)
	payload, err := os.ReadFile("testdata/payload.json")
	if err != nil {
		t.Fatal(err)
	}
	payload = bytes.Replace(payload, []byte(`"media":{"asset-ok"`), []byte(`"media":{"asset-gone"`), 1)
	if _, err := r.Render(context.Background(), payload); !errors.Is(err, ErrNotPrintable) {
		t.Fatalf("err = %v, want ErrNotPrintable", err)
	}
}

func TestRenderBusyAndCancellation(t *testing.T) {
	_ = renderer(t) // Same explicit Chromium integration opt-in as other render tests.
	entered := make(chan struct{})
	var once sync.Once
	r := New(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		once.Do(func() { close(entered) })
		<-request.Context().Done()
	}), 1)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := r.Render(ctx, []byte(`{}`)); done <- err }()
	select {
	case <-entered:
	case <-time.After(30 * time.Second):
		t.Fatal("renderer never requested its page")
	}
	if _, err := r.Render(t.Context(), []byte(`{}`)); !errors.Is(err, ErrBusy) {
		t.Fatalf("second concurrent render: got %v, want ErrBusy", err)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v, want cancellation", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("canceled renderer did not stop")
	}
	if len(r.slots) != 0 {
		t.Fatal("canceled renderer leaked a concurrency slot")
	}
}

func TestPreparationSharesRenderBoundAndCancellation(t *testing.T) {
	r := New(nil, 1)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := r.RenderPrepared(ctx, func(ctx context.Context) ([]byte, error) {
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) > RenderTimeout {
				t.Error("preparation has no shared deadline")
			}
			close(entered)
			<-ctx.Done()
			return nil, ctx.Err()
		})
		done <- err
	}()
	<-entered
	called := false
	if _, err := r.RenderPrepared(t.Context(), func(context.Context) ([]byte, error) { called = true; return nil, nil }); !errors.Is(err, ErrBusy) || called {
		t.Fatalf("busy preparation ran: %v", err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if len(r.slots) != 0 {
		t.Fatal("preparation leaked a slot")
	}
	if pdf, err := r.RenderPrepared(t.Context(), func(context.Context) ([]byte, error) { return nil, ErrNotPrintable }); !errors.Is(err, ErrNotPrintable) || len(pdf) != 0 {
		t.Fatalf("incomplete preparation returned a file: %d %v", len(pdf), err)
	}
}
