# Diagnostics Scripts

Purpose: operational debugging tools for reproducibility and support.

## Guidelines
- Scripts must be safe by default (read-only unless explicitly documented).
- Input/output should be deterministic and machine-readable where possible.
- Every script should state:
  - required env vars
  - expected output
  - interpretation hints

## Suggested First Scripts
- `check-answer-integrity.ts`
- `inspect-session-timeline.ts`
- `replay-autosave-sequence.ts`

## Usage Contract
When a production issue cannot be reproduced from tests alone, add a diagnostic script here and reference it from `docs/failure-cases.md`.
