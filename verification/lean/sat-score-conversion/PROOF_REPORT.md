# Proof report

Commit base `a0b0d9021be77e068907786d12f88718dbfc845e` plus the uncommitted working tree (the feature
itself is uncommitted). Toolchain `leanprover/lean4:v4.19.0` (`lean-toolchain`), no packages (core Lean only).

## Verdict

| Field | Value |
| --- | --- |
| **Formal status** | **PROVED**: all 23 audited declarations (`evidence/lean-axiom-audit.txt`: axioms ⊆ {propext, Classical.choice, Quot.sound}); no `sorry`, `admit`, custom axiom or `native_decide` (source grep clean); clean `lake build` exit 0 (`evidence/lean-build.txt`). |
| **Independent check** | `lake env lean --run Replay.lean Model Safety Counterexamples` re-checks every theorem in the kernel via `Environment.replay` (`evidence/leanchecker.txt`; its forged-`False` self-test is rejected). The toolchain ships no `leanchecker` binary. |
| **Correspondence status** | **REVIEWED_WITH_TESTS** for G-1…G-10; **no mechanized refinement** to Go/SQL. |
| **Production evidence** | **PARTIAL**: 47 Go/MySQL tests pass incl. `-race` (`evidence/go-tests.txt`); 30× race soak of the concurrent publish = 60/60 pass (`evidence/go-concurrency-soak.txt`), MySQL 9.6.0 only. No multi-instance, no 8.4, no production-size or load run. |
| **Overall** | **CONDITIONAL.** Blockers: A-LOCK and A-TX are database obligations validated only on one MySQL 9.6.0 primary (U-1); production volume/topology unknown (U-2). |

## What was proved

The model (`Model.lean`) is a nondeterministic state machine over revisions, the active pointer, the
next revision number and results. `Safety.lean` proves `Init → Inv` and `Inv ∧ Step → Inv` for every
constructor (including `stutter` = abort/crash/lost ACK), hence `Reach → Inv`, and derives G-1…G-10.
The key invariant fields: published numbers in `[1, nextNum)` and injective; `active = none ⇒ no
published revision ∧ nextNum = 1`; `active = some a ⇒ a published with num + 1 = nextNum`; every
published revision's base is `none` (number 1) or a published revision numbered one lower; published ⇒
`Publishable`.

## Anti-vacuity review

- `Init` is the empty system; `Step` is not trivially unsatisfiable: `witness_display_changes` reaches a
  state with an active revision whose policy changes a released result's display from `555` to `200`.
- `Inv` is established inductively, not assumed. The publish case discharges the chain field using the
  guard `base = active`; removing the guard breaks it: `naive_publish_forks` is a kernel-checked trace
  (two drafts based on an empty pointer both publish) violating `no_fork`.
- `stutter` makes every action possibly fail, so safety does not depend on requests succeeding.
- Atomicity is *postulated* for `publish` (A-TX/A-LOCK). It is not derived; the counterexample shows what
  happens without the lock, and the MySQL tests exercise the lock.
- Not modelled: ranges, audit rows, checksums (A-SHA is code-level), the cache, time, multiple subjects
  (`Content` is one route's table list; per-subject independence FR-5 is a Go test:
  `TestPublishingOneSubjectKeepsTheOtherUnchanged`).
- Liveness is not claimed.

## Hostile schedules (mapped)

| Schedule | Result |
| --- | --- |
| Two admins publish on the same base | One wins, others `STALE_BASE`; chain unforked (`no_fork`; test). Without the pointer lock: fork (`naive_publish_forks`). |
| Commit succeeds, ACK lost, client retries | `retry_after_commit` / `alreadyActive`; if superseded meanwhile: 409 (L-5). |
| Stale save after another save | `save_requires_current_version`; 412. |
| Save races publish of the same draft | Row lock serializes: save-first → published content includes it; publish-first → `NOT_A_DRAFT`. |
| Reader races publish | Reader sees the old or the new pointer; never a mixed state (pointer + revision commit together, A-TX). |
| Crash before / after commit | Before: no trace (stutter). After: state is committed; reads and retries are consistent. |
| Corrupted stored revision | Reads fail closed (raw-only); `ErrIntegrity`; metric `integrity`. |
| Version skew (old binary) | Old binary ignores the tables and shows legacy payload scores; documented rollout order. |

## Bugs and edge cases found and fixed during this verification

| # | Finding | Fix | Regression test |
| --- | --- | --- | --- |
| B-1 | **Canonical encoding was unpinned.** Any change to the Go struct tags/field order would change every revision's checksum, so every published revision would fail its integrity check and ALL converted scores would be withheld after a deploy. | Golden encoding + sha256 pinned (hash cross-checked with `shasum`). | `TestContentChecksumIsPinned` |
| B-2 | Impact report counted `{"classroomRaw":{"sections":null}}` and `[]` results as compared results (JSON null passes `IS NOT NULL`). | Skip empty/null reports before counting. | `TestImpactReportIsBoundedAndMatchesTheOverlay` (null and empty rows inserted; count stays 1508) |
| B-3 | A corrupted or unreachable policy degraded every result read and logged one line per read. | Rate-limited to one log line per 30 s; the counter still records each occurrence. | covered by `TestCorruptedRevisionFails…` (behaviour), review (log) |
| B-4 | UI: a pasted number with 20 digits became an imprecise JS number, was sent on the wire and rejected by the server as malformed (confusing 422). | ≤ 9 digits are numbers, longer runs stay visible text and block save locally. | `tsv.test.ts` |
| B-5 | UI: a tab/newline pasted into a single cell corrupted the row structure of TSV/CSV export. | Whitespace inside a cell is collapsed. | `tsv.test.ts` |
| B-6 | (Found earlier in the browser smoke) pasted text with blank lines between rows was rejected. | Blank lines in multi-column pastes are ignored; a one-column table keeps them (an empty cell). | `tsv.test.ts` |
| B-7 | Overlay edge cases lacked tests: fractional, negative, over-count raw scores. | Verified fail-closed; tests added. | `TestOverlayNeverInventsAScore` |

Checked and found NOT to be a bug: the student bootstrap's ETag/304 applies to the static content
snapshot, not the result, so a publish cannot be masked by a cached 304 (`handlers_domain.go`,
`etag.go`).

## Confidence boundary

The theorems hold for the model. A trace that violates them in production must violate A-TX, A-LOCK,
A-IMM, A-VALID, A-RESOLVE or A-RAWSRC, or involve something outside the model (TiDB without triggers,
direct DB edits, replica reads). Each has an owner in ASSUMPTIONS.md.
