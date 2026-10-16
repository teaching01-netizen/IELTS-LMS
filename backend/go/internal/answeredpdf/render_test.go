package answeredpdf

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"testing"
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
	pages := len(regexp.MustCompile(`/Type\s*/Page[^s]`).FindAll(pdf, -1))
	// Cover and answer sheet, then one page for each of the 12 questions.
	if pages < 12+2 || pages > 12+4 {
		t.Fatalf("pages = %d, want one per question plus front matter", pages)
	}
	for _, box := range regexp.MustCompile(`/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)`).FindAllSubmatch(pdf, -1) {
		if !bytes.HasPrefix(box[1], []byte("841")) && !bytes.HasPrefix(box[1], []byte("842")) {
			t.Fatalf("page box %s × %s is not A4 landscape", box[1], box[2])
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
