package answeredpdf

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"example.com/ielts-proctoring/internal/satwordvault"
	"github.com/pdfcpu/pdfcpu/pkg/api"
)

func TestRenderWordVaultMultipage(t *testing.T) {
	r := renderer(t)
	payload, err := os.ReadFile("testdata/payload.json")
	if err != nil {
		t.Fatal(err)
	}
	base, err := r.Render(t.Context(), payload)
	if err != nil {
		t.Fatal(err)
	}
	basePages, err := api.PageDims(t.Context(), bytes.NewReader(base), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(payload, &data); err != nil {
		t.Fatal(err)
	}
	var entries []satwordvault.PrintedEntry
	for _, branch := range []string{"lower", "higher"} {
		for i := 0; i < 22; i++ {
			entries = append(entries, satwordvault.PrintedEntry{
				ModuleKey: "rw-m2-" + branch, Module: "Module 2 — " + branch,
				Question: i + 1, Word: fmt.Sprintf("entry-%s-%02d", branch, i+1),
				Thai:       "การปรับตัวให้เหมาะกับสถานการณ์",
				Definition: "To change your behavior or way of thinking in response to a new situation.",
				Example:    "Students adapt to different teaching styles when they change classes.",
			})
		}
	}
	data["wordVault"], err = json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	payload, err = json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	withVault, err := r.Render(t.Context(), payload)
	if err != nil {
		t.Fatal(err)
	}
	pages, err := api.PageDims(t.Context(), bytes.NewReader(withVault), pdfConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	if added := len(pages) - len(basePages); added < 4 {
		t.Fatalf("expected both appendix modules to span pages, got %d added pages", added)
	}
	for _, page := range pages[len(basePages):] {
		if page.Width < 841 || page.Width > 843 || page.Height < 594 || page.Height > 596 {
			t.Fatalf("appendix page dimensions are not A4 landscape: %v", page)
		}
	}
}
