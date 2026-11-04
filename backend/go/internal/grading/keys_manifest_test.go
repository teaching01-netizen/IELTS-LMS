package grading

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

type keySourceManifest struct {
	Rows         map[string][]string `json:"rows"`
	AdditiveRows map[string][]string `json:"additiveRows"`
	Default      []string            `json:"default"`
}

func loadKeySourceManifest(t *testing.T) keySourceManifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "key-source-table.json"))
	if err != nil {
		t.Fatalf("read key-source manifest: %v", err)
	}
	var manifest keySourceManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode key-source manifest: %v", err)
	}
	if len(manifest.Rows) == 0 {
		t.Fatal("key-source manifest has no rows")
	}
	return manifest
}

func TestKeySourceTableMatchesSharedManifest(t *testing.T) {
	manifest := loadKeySourceManifest(t)
	gotTypes := KeySourceTypes()
	wantTypes := make([]string, 0, len(manifest.Rows))
	for questionType := range manifest.Rows {
		wantTypes = append(wantTypes, questionType)
	}
	sort.Strings(wantTypes)
	if !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("Go key-source types = %v, want %v", gotTypes, wantTypes)
	}
	for questionType, wantFields := range manifest.Rows {
		if got := KeySourceFields(questionType); !reflect.DeepEqual(got, wantFields) {
			t.Fatalf("KeySourceFields(%q) = %v, want %v", questionType, got, wantFields)
		}
	}
	for questionType, wantFields := range manifest.AdditiveRows {
		if got := AdditiveAnswerFields(questionType); !reflect.DeepEqual(got, wantFields) {
			t.Fatalf("AdditiveAnswerFields(%q) = %v, want %v", questionType, got, wantFields)
		}
		// An additive type must not also appear in the single-winner table,
		// otherwise the manifest certifies a field grading ignores.
		if _, listed := manifest.Rows[questionType]; listed {
			t.Fatalf("%q is listed as both single-winner and additive", questionType)
		}
	}
	if got := KeySourceFields("NEW_QUESTION_TYPE"); !reflect.DeepEqual(got, manifest.Default) {
		t.Fatalf("default key-source fields = %v, want %v", got, manifest.Default)
	}
}
