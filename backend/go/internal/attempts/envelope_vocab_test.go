package attempts

// Plan I2 + E1 honesty: ValidateSaveEnvelope is the first gate every V2
// batch hits — a malformed batch must 400 BEFORE any tx begins (no lock,
// no probe, no retry). The existing test pins only two rows; this table
// pins the full vocabulary: zero epochs, oversized batch, empty/oversize
// ids, zero version, and duplicate write IDs within one batch (I2: the
// in-batch dup would otherwise double-apply under retry).
// RED: full table.
import (
	"strings"
	"testing"
)

func TestValidateSaveEnvelopeVocabulary(t *testing.T) {
	good := func() SaveResponsesCommand {
		return SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
			Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	}
	if err := ValidateSaveEnvelope(good()); err != nil {
		t.Fatalf("valid envelope must pass, got %v", err)
	}
	bad := []struct {
		name string
		mut  func(*SaveResponsesCommand)
	}{
		{"empty attempt", func(c *SaveResponsesCommand) { c.AttemptID = "" }},
		{"zero lease epoch", func(c *SaveResponsesCommand) { c.LeaseEpoch = 0 }},
		{"zero control epoch", func(c *SaveResponsesCommand) { c.ControlEpoch = 0 }},
		{"empty write id", func(c *SaveResponsesCommand) { c.Commands[0].WriteID = "" }},
		{"oversize write id", func(c *SaveResponsesCommand) { c.Commands[0].WriteID = strings.Repeat("w", MaxWriteIDLen+1) }},
		{"empty question id", func(c *SaveResponsesCommand) { c.Commands[0].QuestionID = "" }},
		{"zero client version", func(c *SaveResponsesCommand) { c.Commands[0].ClientVersion = 0 }},
		{"duplicate write ids in batch", func(c *SaveResponsesCommand) {
			c.Commands = append(c.Commands, c.Commands[0])
		}},
	}
	for _, tc := range bad {
		cmd := good()
		tc.mut(&cmd)
		if err := ValidateSaveEnvelope(cmd); err == nil {
			t.Fatalf("%s must fail validation", tc.name)
		}
	}
	// Oversized batch (I2: bounds the tx write set).
	big := good()
	for i := 0; i < MaxBatchCommands; i++ {
		big.Commands = append(big.Commands, ResponseCommand{WriteID: "w-" + strings.Repeat("x", i%8+1) + string(rune('a'+i%26)), QuestionID: "q-1", ClientVersion: 1})
	}
	if err := ValidateSaveEnvelope(big); err == nil {
		t.Fatalf("oversized batch must fail validation")
	}
}
