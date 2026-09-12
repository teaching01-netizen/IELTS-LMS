package outbox

import "example.com/ielts-proctoring/internal/platform/telemetry"

// MOutboxTerminalTotal counts outbox rows parked terminal (WS-09 DLQ
// evidence). Label: family (low-cardinality event family only; event and
// attempt ids stay in logs, never in labels).
//
// NOTE (alert wiring): the alert-rules owner adds the
// outbox_terminal_total rule AND registers this series in
// telemetry.Names() together (their parity test requires both). This
// package must not edit telemetry.go (another lane owns it).
const MOutboxTerminalTotal = "outbox_terminal_total"

// EmitTerminalTotal counts one terminal DLQ insert for the family.
func EmitTerminalTotal(family string) {
	telemetry.IncCounter(MOutboxTerminalTotal, "family", family)
}
