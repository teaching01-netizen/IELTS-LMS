package grading

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type studentInputVector struct {
	ID       string `json:"id"`
	Group    string `json:"group"`
	Key      string `json:"key"`
	Student  string `json:"student"`
	OptOut   bool   `json:"optOut"`
	Expected bool   `json:"expected"`
}

func TestStudentInputVectorsSharedContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "student-input-vectors.json"))
	if err != nil {
		t.Fatalf("read student-input vectors: %v", err)
	}
	var fixture struct {
		Vectors []studentInputVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode student-input vectors: %v", err)
	}
	if len(fixture.Vectors) == 0 {
		t.Fatal("student-input vectors fixture is empty")
	}
	for _, vec := range fixture.Vectors {
		vec := vec
		t.Run(vec.ID, func(t *testing.T) {
			var got bool
			if vec.OptOut {
				got = answersMatchInsensitive(vec.Student, vec.Key)
			} else {
				got = answersMatch(vec.Student, vec.Key)
			}
			if got != vec.Expected {
				t.Fatalf("match(%q, %q, optOut=%v) = %v, want %v", vec.Student, vec.Key, vec.OptOut, got, vec.Expected)
			}
		})
	}
}
