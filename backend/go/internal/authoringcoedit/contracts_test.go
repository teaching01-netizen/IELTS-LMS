package authoringcoedit

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecimalStringContractPreservesLargeCounters(t *testing.T) {
	valid := []string{"0", "1", "9007199254740993", "18446744073709551615"}
	for _, value := range valid {
		if !IsDecimalString(value) {
			t.Fatalf("expected %q to be a valid decimal counter", value)
		}
	}
	for _, value := range []string{"", "01", "-1", "18446744073709551616", "1.0"} {
		if IsDecimalString(value) {
			t.Fatalf("expected %q to be rejected as a decimal counter", value)
		}
	}

	metadata := CoeditDurabilityMetadata{
		Room:               "coedit:v2:exam-1",
		StateEpoch:         DecimalString("9007199254740993"),
		StateHash:          strings.Repeat("a", 64),
		CommitSequence:     DecimalString("18446744073709551615"),
		SafeToDiscardCache: false,
	}
	if !metadata.Valid() {
		t.Fatal("expected durability metadata to be valid")
	}
	payload, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	if !strings.Contains(string(payload), `"stateEpoch":"9007199254740993"`) ||
		!strings.Contains(string(payload), `"commitSequence":"18446744073709551615"`) {
		t.Fatalf("counters were not encoded as strings: %s", payload)
	}
}

func TestLifecycleOperationContract(t *testing.T) {
	if !(CoeditLifecycleOperation{
		FreezeOperationID: "operation-1",
		FreezeExpiresAt:   1_800_000_000,
	}).Valid() {
		t.Fatal("expected lifecycle operation to be valid")
	}
	if (CoeditLifecycleOperation{FreezeOperationID: "operation 1", FreezeExpiresAt: 1_800_000_000}).Valid() {
		t.Fatal("operation ids must not contain whitespace")
	}
}
