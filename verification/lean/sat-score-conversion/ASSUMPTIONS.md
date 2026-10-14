# Assumptions, unknowns and limitations

| ID | Assumption | Owner / anchor | Validation | Criticality |
| --- | --- | --- | --- | --- |
| A-TX | The publish writes (revision `draft→published` with number + sha256, pointer update, audit insert) commit or abort together. The model's single `publish` step is one transaction. | `satscoring/service.go` `Publish` inside `tx.Runner.WithTx` (InnoDB, REPEATABLE READ). | Reviewed. `TestPublishRequiresCompleteContentAndCalibration` (nothing activates on refusal), `TestPublishIdempotentMonotonicAndRestore`. | Critical (G-2, G-3). |
| A-LOCK | Concurrent publishes are serialized by `SELECT … FROM sat_score_conversion_active WHERE id = 1 FOR UPDATE`, taken first; the draft row is then locked `FOR UPDATE` and revision numbers are allocated while the pointer lock is held. A second publisher therefore reads the state the first committed. | same function; singleton row via `CHECK (id = 1)` + seed in 0087. | `TestConcurrentPublishOnSameBaseOneWins` (6 publishers, barrier), 30× under `-race` (`evidence/go-concurrency-soak.txt`). Counterexample without the lock: `naive_publish_forks`. | Critical (G-3). |
| A-IMM | Published rows are not updated or deleted by any other path. App: every UPDATE has `status = 'draft'`. MySQL: triggers `sat_score_conversion_revisions_immutable_*`. **TiDB skips triggers.** | `0087`, `SaveDraft`/`Publish` SQL. | `TestPublishedRevisionIsImmutableAndAuditAppendOnly` (MySQL). Direct DB access outside the app bypasses the app guard. | High (G-1). Integrity check (A-SHA) is the backstop. |
| A-SHA | A published revision's content equals what was hashed. `ActiveRevision` re-hashes the canonical encoding on load and fails closed (`ErrIntegrity`) on mismatch. | `satconvert.Content.Checksum`, `satscoring.scanRevision`. | `TestCorruptedRevisionFailsClosedAndOverlayDegradesToRaw`; `TestContentChecksumIsPinned` pins the encoding. | High. |
| A-POINTER | Readers read the pointer on every call (one PK read); only immutable revisions are cached by id. A reader therefore sees the pointer value as of its read, never a staler cache. | `satscoring.ActiveRevision`. | Reviewed; `TestOverlayAppliesActivePolicyRetroactivelyAndFailsClosed`. A single MySQL primary is assumed (A-RAW). | High (G-6). |
| A-RAW | The pointer read after a publish commit sees it: one primary, no read replica on this path. | `sat.LoadResultForAttempt` / `results.GetSATResult` use the primary pool. | **UNKNOWN in production.** | Medium: with a lagging replica a result briefly shows the previous policy (a delay, never a wrong mix). |
| A-VALID | The Go validator implements the model's `Publishable`: complete matrices, scores 200–800 multiples of 10, consistent assignments. | `satconvert.Content.Validate`. | Reviewed + `TestContentValidate*`. Not mechanized. | High (G-4, G-5). |
| A-RESOLVE | `Content.Resolve` implements `Content.resolve`: first assigned table with exactly equal dimensions, in-range raw scores, valid cell, else unavailable. Go additionally requires the table kind to match the route. | `satconvert.Content.Resolve`. | `TestContentResolve*`, `TestOverlayNeverInventsAScore`. | High (G-5). |
| A-RAWSRC | The overlay's inputs are the persisted `classroomRaw.sections[].modules[]` of a released result. | `terminalization.classroomRawScoreTx`. | `TestSATGlobalScoreConversionIsRetroactiveMySQL`. | High (G-6). |

## Unknowns

| ID | Unknown | How to resolve |
| --- | --- | --- |
| U-1 | Production instance count, MySQL version/isolation (migrate names 8.4 as supported; evidence is on 9.6.0). | Re-run the soak on 8.4 with the production `transaction_isolation`. |
| U-2 | Production volume of released SAT results (impact scan cost), and whether per-exam converters differ (seed decision D2). | Phase-0 audit queries; run `Impact` on a production-sized copy. |
| U-3 | Whether any code path writes `sat_score_conversion_*` outside the app. | Database audit / role grants. |

## Known limitations (reachable, accepted)

| ID | Limitation |
| --- | --- |
| L-1 | `POST /drafts` is not idempotent: a retry after a lost ACK creates a second draft. Harmless clutter, never a score effect. |
| L-2 | No liveness claim: if the database is unavailable, publishes fail and readers degrade to raw-only (`status=error`), they do not block. |
| L-3 | Rollback hazard: `ParseContent` rejects unknown fields. If a later release adds a content field, publishes it, and is rolled back, the older binary treats those revisions as corrupt and withholds converted scores. Ship a tolerant parser one release before any field addition. |
| L-4 | The checksum is over the Go canonical encoding; any change to tags/field order is caught only by `TestContentChecksumIsPinned` in CI. |
| L-5 | A lost ACK on a publish later superseded reports 409 although the commit happened (see SPEC). |
| L-6 | TiDB: no triggers, so G-1 rests on the app guard and A-SHA only. |
| L-7 | Ranges (`{low, high}`) in 1D tables are not modelled in Lean; they are validated by Go tests. |
