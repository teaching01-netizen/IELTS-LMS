# ADR-005 - terminalization receipt-first

Status - accepted.

Context - terminal state must survive crashes between decide and project. A projected submitted_at without an immutable receipt is unauditable.

Decision - seal_attempt_in_tx is the only writer - INSERT the receipt FIRST, then apply the compatibility projection. Replay is outcome-only compatible. Receipts are never updated or deleted. Lock order attempt, runtime, section everywhere.

Consequences - new terminal paths must use the sealer interface. Direct status writes are correctness bugs. The invariant audit guards the ordering.
