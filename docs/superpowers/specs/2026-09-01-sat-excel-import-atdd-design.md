# SAT Excel Import ATDD Design

## Goal

Harden the existing **Import SAT from Excel** workflow with rigorous acceptance-driven coverage across workbook parsing, validation, preview registration, atomic draft replacement, persistence, recovery, undo, frontend behavior, and the user-facing workflow.

This work tests and fixes the existing full-workbook importer. It does not redesign the importer or introduce a second Excel format.

## Acceptance Boundary

```text
Generated real XLSX
  → backend parser
  → validation preview
  → preview registration
  → atomic commit
  → persisted SAT draft
  → reload verification
  → undo verification
```

## Behavioral Contract

The authorized SAT builder selects an `.xlsx` workbook from the authoring workspace. The system previews and validates it before enabling import. A valid workbook can replace the complete six-module SAT draft atomically. The preview and commit are tied to the expected authoring version. Embedded visuals are staged before commit. The latest untouched import can be undone.

The system must preserve published versions and must not mutate the draft for invalid, unsafe, stale, unauthorized, or partially failed imports.

## Invariants

- Import is all-or-nothing.
- Published versions are untouched.
- Exactly six SAT modules are represented.
- Reading & Writing modules contain 27 questions each.
- Math modules contain 22 questions each.
- Every module contains exactly two pretest questions.
- Invalid or stale imports never mutate the draft.
- Embedded assets must be staged before commit.
- Undo is available only for the latest untouched import.
- Existing question-import behavior, SAT delivery/scoring, and IELTS behavior remain unchanged.

## Acceptance Scenarios

### AT-01 — Valid complete workbook preview

Given an authorized builder and a real workbook containing all six modules and 147 valid questions, when the workbook is selected, then the preview reports 147 questions, six modules, no blocking issues, and the UI enables Import.

### AT-02 — Rich content and metadata mapping

Given valid workbook rows containing math, tables, code, emphasis, stimulus, rationale, tags, domains, skills, difficulty, and pretest values, when parsed, then the preview preserves the corresponding structured content and metadata.

### AT-03 — Student-produced response mapping

Given a valid Math student-response row with semicolon-separated accepted responses, when parsed, then the question becomes a student-produced-response question with normalized accepted responses and no choice answer key.

### AT-04 — Embedded asset staging

Given a valid workbook with an image on the Assets sheet and a question referencing it, when preview completes, then the image is represented with required alt text and the UI stages it before enabling Import. The commit payload contains the staged asset ID and no workbook-local image ID.

### AT-05 — Invalid workbook diagnostics

Given a workbook with missing required columns, invalid module/order, duplicate order, invalid answer/domain/skill/difficulty/pretest, wrong module counts, wrong pretest counts, unsupported content, or missing assets, when preview runs, then blocking row/field diagnostics are returned and Import remains disabled.

### AT-06 — Unsafe or malformed workbook rejection

Given a non-XLSX file, malformed XLSX/ZIP, workbook over 12 MB, oversized cells, excessive archive expansion, formulas, or unsupported/excessive images, when submitted, then the API rejects it with the established error contract and makes no database mutation.

### AT-07 — Atomic successful commit

Given a valid preview tied to the current authoring version, when Import is confirmed, then the complete draft is replaced in one transaction, the response returns the new shell and undo state, and a subsequent shell load returns the imported structure.

### AT-08 — Stale version or invalid preview conflict

Given a valid preview whose expected version is stale or whose preview token is invalid/expired, when commit is attempted, then the API returns a conflict/validation error and the existing draft remains unchanged.

### AT-09 — Partial asset failure

Given a workbook with multiple assets where one staging upload fails, when staging runs, then Import remains disabled, a recoverable error is shown, and no draft mutation occurs.

### AT-10 — Commit failure atomicity

Given a commit that fails during persistence, when the failure is injected, then all previous questions/module assignments remain intact and no partial imported draft is visible.

### AT-11 — Authorization

Given an unauthenticated, non-staff, wrong-tenant, or non-SAT actor, when preview, commit, template download, or undo is requested, then access is rejected and no protected data is changed.

### AT-12 — Undo latest untouched import

Given a successful import with no subsequent edits, when Undo is confirmed, then the exact prior draft structure is restored, published versions remain unchanged, and the undo state is cleared.

### AT-13 — Undo protection after later editing

Given a successful import followed by an authoring edit, when Undo is requested, then undo is rejected/removed and the edited imported draft remains intact.

### AT-14 — Frontend workflow and recovery

Given the authoring workspace, when the builder opens Import from Excel, selects a file, reviews the preview, imports, receives a failure, retries, or cancels, then focus, loading, disabled, success, error, and recovery states are understandable and preserve work.

## Failure Handling

- Preview validation failures produce row/field diagnostics and never produce a committable mutation.
- Malformed or unsafe files use the existing API error mapping.
- Commit requires import ID and expected version identity/revision.
- Asset uploads happen before commit; a failed upload never enables Import.
- Persistence failures preserve the previous draft through a transaction or equivalent atomic strategy.
- Undo is limited to the latest recoverable import and is invalidated by subsequent edits.

## Test Strategy

### Rust unit tests

Use generated real XLSX bytes from the existing template builder. Cover parser mappings, all module/count rules, metadata, rich content, SPR, assets, formula rejection, malformed files, and safety limits.

### Application/database integration tests

Cover atomic replacement, preview registration/token validation, optimistic version conflicts, authorization scope, rollback on failure, and undo/recovery. Compare the persisted shell before and after rejected or failed operations.

### API route tests

Cover multipart/file validation, authentication/role/provider checks, status codes, error codes, and response contracts for preview, commit, template, and undo routes.

### Frontend tests

Extend `SatWorkbookImportSheet` tests for file limits/types, diagnostics, staged assets, commit payloads, commit errors, focus/disabled states, and retry behavior.

### Playwright acceptance

Add a focused workflow using the existing SAT backend setup: open authoring, obtain a real workbook through the template/generation path, upload it, verify the 147-question preview, commit, reload the workspace, and exercise undo. If the environment cannot support deterministic workbook creation/upload, retain backend integration coverage and document the E2E gap.

## Implementation Surface

### Must change or receive tests

- `backend/crates/application/src/sat_workbook.rs`
- `backend/crates/application/src/assessment_authoring.rs`
- `backend/crates/api/src/routes/assessment_authoring.rs`
- `src/features/exam-authoring/import/SatWorkbookImportSheet.tsx` only where tests expose a defect
- `src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx`
- focused files under `backend/**/tests` and `e2e/`

### Verify unchanged

- Published SAT delivery and scoring paths.
- Existing question import flow.
- IELTS routes and authoring behavior.
- Existing database schema unless integration evidence identifies a missing recovery constraint.

### Fixture policy

Prefer generated workbooks and test helpers over committed binary fixtures. Mutate generated workbook cells to produce invalid cases. Commit binary fixtures only if generation cannot represent a required scenario.

## Execution Order

1. Establish baseline and AST/symbol map without source changes.
2. Write failing Rust parser acceptance tests.
3. Write failing application atomicity, conflict, authorization, and undo tests.
4. Write failing API contract tests.
5. Extend frontend tests.
6. Add the focused Playwright acceptance workflow.
7. Implement only defects exposed by the tests.
8. Re-parse and re-run AST dependency checks after edits.
9. Run Rust, TypeScript, build, focused Vitest, and relevant Playwright verification.
10. Audit the final diff and leave unrelated working-tree changes untouched.

## Rollout and Rollback

No schema migration is expected from this test-hardening task. Existing migration `0040_sat_workbook_import_recovery.sql` must be verified against the undo behavior.

Roll out backend tests/fixes before relying on the browser acceptance test. If a defect is found in commit atomicity or recovery, disable the import entry point or revert the importer fix while preserving existing drafts and published versions. Any persisted import data must remain readable by the previous application version.

## Definition of Done

- Every AT scenario has an automated verification path or an explicitly documented environment gap.
- Invalid, unauthorized, stale, unsafe, and partial operations leave the draft unchanged.
- Successful import, reload, and undo are proven against persistence.
- Existing regression suites pass.
- Typecheck, build, lint, Rust tests, focused Vitest, and relevant E2E checks are run with recorded evidence.
- No unrelated working-tree files are staged or modified by this task.
