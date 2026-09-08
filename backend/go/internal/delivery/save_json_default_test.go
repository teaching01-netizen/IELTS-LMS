package delivery

// Plan E-honesty, round 84 (live rehearsal): saving a response without
// `annotations` sent NULL into a NOT NULL column — MySQL 1048 escaped
// WriteError as a silent 500 (caught by the round-74 unknown-hook).
// Optional JSON bodies must default to '{}', matching the reader's
// rawJSON default; only `response` stays nullable (its column is NULL).
import (
	"encoding/json"
	"testing"
)

func TestEmptySaveJSONDefaults(t *testing.T) {
	if got := emptySaveJSON(nil); got != "{}" {
		t.Fatalf("nil annotations must default to {}, got %v", got)
	}
	if got := emptySaveJSON(json.RawMessage("null")); got != "{}" {
		t.Fatalf("null annotations must default to {}, got %v", got)
	}
	if got := emptySaveJSON(json.RawMessage(`{"x":1}`)); got != `{"x":1}` {
		t.Fatalf("present annotations must pass through, got %v", got)
	}
}

func TestNullableSaveRawStillNullable(t *testing.T) {
	if nullableSaveRaw(nil) != nil {
		t.Fatalf("nil response must stay NULL (column is nullable)")
	}
}
