package answeredpdf

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestPreviewLeavesRenderCapacityForDownloads(t *testing.T) {
	r := New(nil, 2)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := r.RenderPreview(ctx, func(ctx context.Context) ([]byte, error) {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		})
		done <- err
	}()
	<-started

	prepared := errors.New("download preparation ran")
	build := func(context.Context) ([]byte, error) { return nil, prepared }
	if _, err := r.RenderPreview(t.Context(), build); !errors.Is(err, ErrBusy) {
		t.Fatalf("concurrent preview got %v, want ErrBusy", err)
	}
	if _, err := r.RenderPrepared(t.Context(), build); !errors.Is(err, prepared) {
		t.Fatalf("preview blocked download preparation: %v", err)
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled preview returned %v", err)
	}
	if _, err := r.RenderPreview(t.Context(), build); !errors.Is(err, prepared) {
		t.Fatalf("canceled preview leaked capacity: %v", err)
	}
}

// A reviewed question and its saved explanation print on one sheet. The paper
// used to fit each question to the whole page, so the explanation row never had
// room and every explanation started the following page — the teacher's copy and
// the student's copy both read as if the explanation belonged to no question.
//
// The comparison is keyed-with against keyed-without: turning the answer key on
// already adds a sheet of its own, so comparing against an unkeyed paper would
// hide the explanation cost inside that difference.
func TestRenderKeepsExplanationsOnTheirQuestionSheet(t *testing.T) {
	r := renderer(t)
	raw, err := os.ReadFile("testdata/payload.json")
	if err != nil {
		t.Fatal(err)
	}
	pages := func(explained bool) int {
		t.Helper()
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		exam := payload["exam"].(map[string]any)
		var entries []any
		for _, section := range exam["sections"].([]any) {
			for _, module := range section.(map[string]any)["modules"].([]any) {
				module := module.(map[string]any)
				for _, question := range module["questions"].([]any) {
					entry := map[string]any{
						"moduleId":       module["id"],
						"examQuestionId": question.(map[string]any)["examQuestionId"],
						"correctAnswers": []any{map[string]any{"label": "A", "text": "Choice a"}},
						"result":         "correct",
					}
					if explained {
						entry["explanation"] = map[string]any{
							"version": 1,
							"nodes": []any{map[string]any{
								"type": "paragraph",
								"id":   "explanation",
								"text": "A generalization makes a claim about a whole class, not just particular items.",
							}},
						}
					}
					entries = append(entries, entry)
				}
			}
		}
		exam["answerKey"] = map[string]any{
			"available": true, "policyRevision": 1, "versionId": exam["versionId"], "entries": entries,
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		pdf, err := r.Render(context.Background(), encoded)
		if err != nil {
			t.Fatal(err)
		}
		dimensions, err := api.PageDims(t.Context(), bytes.NewReader(pdf), pdfConfiguration())
		if err != nil {
			t.Fatal(err)
		}
		return len(dimensions)
	}

	without := pages(false)
	with := pages(true)
	if with != without {
		t.Fatalf("pages = %d with explanations, %d without: an explanation was pushed onto its own page", with, without)
	}
}
