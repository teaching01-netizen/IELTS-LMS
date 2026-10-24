package attempts

import (
	_ "embed"
	"encoding/json"
	"testing"
)

//go:embed testdata/sat_frozen_hash_vectors.json
var satFrozenHashVectors []byte

func TestSATFrozenHashVectors(t *testing.T) {
	var vectors struct {
		Responses []struct {
			Name    string          `json:"name"`
			Payload ResponsePayload `json:"payload"`
			Hash    string          `json:"hash"`
		} `json:"responses"`
		Manifest struct {
			Entries []struct {
				QuestionID    string `json:"questionId"`
				WriteID       string `json:"writeId"`
				ClientVersion int64  `json:"clientVersion"`
				ContentHash   string `json:"contentHash,omitempty"`
			} `json:"entries"`
			Hash string `json:"hash"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(satFrozenHashVectors, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors.Responses {
		t.Run(vector.Name, func(t *testing.T) {
			got, err := HashResponsePayload(vector.Payload)
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.Hash {
				t.Fatalf("canonical response hash = %s, want %s", got, vector.Hash)
			}
		})
	}
	got, err := HashResponse(vectors.Manifest.Entries)
	if err != nil {
		t.Fatal(err)
	}
	if got != vectors.Manifest.Hash {
		t.Fatalf("canonical frontier hash = %s, want %s", got, vectors.Manifest.Hash)
	}
}
