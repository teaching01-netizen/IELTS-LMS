# SPEC — SAT workbook import (preview → commit → replay → undo)

## Verification target
`authoring.ParseSATWorkbook`, `RegisterSATWorkbookPreview`, `CommitSATWorkbook`
(`replaceSATDraftOpKey`), `UndoSATWorkbook` in `backend/go/internal/authoring`,
plus the single-page UI in `src/features/exam-authoring/import/SatWorkbookImportSheet.tsx`.

## Scope statement
One authoring session uploads an `.xlsx`. The server detects which of the six SAT
modules the sheet contains (any row differing from the template defaults), checks
them, and registers a preview bound to (detected modules, content digest, draft
revision). A commit replaces exactly those modules' question placements in the
editable draft in one transaction, keyed by an operation key, and can be undone
until the draft is edited or published. Authoritative state: the draft
(`exam_versions` row + placements), `sat_workbook_imports`,
`sat_workbook_import_scopes`, `authoring_operation_keys`. Fault boundary: process
crash, lost ACK, client retry, deadlock/abort, concurrent authors, multiple API
instances on one MySQL primary. Out of scope: publish validation (only its role
as the pretest gate), delivery/scoring, media storage internals, replicas.

## Guarantees (safety unless stated)
| ID | Guarantee |
|---|---|
| REQ-1 | An import's effect is applied **at most once**, under any retries, keys, interleavings, crashes, undo. |
| REQ-2 | A commit changes **only** the detected modules; every other module is unchanged. |
| REQ-3 | The detected modules end with **exactly the checked content** (digest-bound), not client-substituted content. |
| REQ-4 | A commit applies only to **the draft the user checked**: any intervening write (anyone) makes it a no-op (no lost update). |
| REQ-5 | A claimed operation key makes any commit with that key a **no-op** (ACK-loss retry replays; different content is a conflict). A used import cannot be re-applied even with a fresh key. |
| REQ-6 | Undo is allowed only while nothing was written since the import, and restores the pre-import draft **for all modules**; it never erases a later edit. |
| REQ-7 | The Pretest column is **not validated at import**; exactly-two-pretests per module is enforced at publish, inside the locked publish transaction (`exams/service.go:929`). |

## Not claimed
Liveness (a retried commit eventually completes) holds only under availability and
retry assumptions and is not proved. Linearizability across the HTTP API is not
modelled; serialization comes from the exam-row lock (A2). Capacity/SLO is not
claimed.
