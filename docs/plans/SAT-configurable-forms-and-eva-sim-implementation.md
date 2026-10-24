# SAT configurable forms — implementation record

Implemented in the existing checkout on 2026-10-24. No sub-agents were used. The temporary checkout created before the no-worktree instruction was archived; all implementation was performed in the original checkout. Existing unrelated changes were preserved.

## Delivered behavior

- Exam Settings manages common registration, Verbal entry, Math entry and Eva SIM independently. Verbal and Math each have an on/off switch that preserves their questions. Each save uses the last confirmed values of the other forms and the draft revision. Other unsaved input is preserved.
- New SAT drafts use forms schema v2: Admission year (Gregorian, four digits) and seat number at check-in; Expected Class in the Math entry form, with Unenroll and Rank 4–1 and no default selection. Seat values remain text and need not be unique.
- Verbal starts with no configured questions and is skipped until staff supplies them. Disabled or empty section forms use the normal module-entry flow, including explicit entry after a break when the recovery policy requires it. Math questions appear after the actual break completes, or before Math in a Math-only sitting. A selected Module 2 can be the first delivered module of a section.
- Section answers are validated against the sitting's pinned version, sealed once per section/attempt, and stored separately from registration and Eva. Adaptive Module 2 does not collect the form again.
- Room creation and first admission require persisted individual SAT timing for schema v2. Turning personal timing off rejects incompatible new rooms instead of creating shared-clock form rooms.
- Form filling starts neither working time nor the preparation recovery allowance. Pending section modules have no availability/automatic-start timestamp. Where the recovery policy applies, acceptance arms preparation once after release; retries do not reset it. Normal authenticated entry and the existing start-code/runtime/writer checks still start the working clock.
- One SQL predicate protects module activation, routed active inserts, legacy entry confirmation, reconciliation and recovery activation. Personal delivery withholds unstarted module content until entry. Same-section progression retains its configured behavior after the form is accepted.
- Failed form reads hold entry for retry. Slow reads do not overlap. Legacy/empty forms stop polling. Uncertain writes retry the same operation and answers; acknowledged writes remain sealed even if the subsequent state read fails. Stale responses from a previous attempt are ignored.
- Individual and room-wide pause are respected. Staff End closes new section writes/starts and Eva access. Committed operation receipts replay for a still-authorized owner without rewriting answers or clocks.
- Eva retains native and embedded modes. Native answers can be edited until staff End. Embedded forms retain Back to SAT Complete, a new-tab fallback, sandboxing, and truthful `not_tracked` reporting. Automatic completion leaves Eva collection open.
- Staff Form responses has separate Registration, Verbal entry, Math entry and Eva filters. Future sections show “Section not available”. Scores remain in the existing results workspace.
- Existing schema-v1 rooms keep scoped registration behavior. An explicit draft upgrade previews the placement, preserves field/option IDs, labels, help and validation, and does not rewrite existing rooms or responses.
- Student fields, Settings previews and native Eva share the existing renderer. Browser verification corrected Safari validation focus and completion focus restoration. The pre-exam device-transfer control remains reachable from the new entry screen.

## Implementation boundary

The optional section `enabled` flag defaults to enabled for existing v2 snapshots. Disabled forms skip student collection and activation gates and response completion counts without deleting their definitions.

The controller uses the owner-only section-entry GET/PUT endpoints and one `useSatSectionEntry` hook rather than adding a duplicate gate property to bootstrap and compact snapshots. Unknown or failed reads hold client entry; the database activation predicate remains authoritative. Active exam surfaces are never covered by a stale form response.

The additive migration is `backend/go/migrations/0104_sat_section_entry_forms.sql`. It widens the existing form-key CHECK atomically, retains existing keys and responses, and can be rerun. Startup schema verification refuses a database with the old vocabulary. Applied migration 0101 was not edited.

## Verification

All checks below passed locally:

| Check | Evidence |
| --- | --- |
| TypeScript | `bun run typecheck` |
| Production build | `bun run build` |
| Frontend behavior | 82 tests across 10 files: form validation/upgrade, independent Settings saves, controller start gating, Math after break, pause surfaces, Eva and response views |
| Go packages | `go test ./internal/delivery ./internal/assessmentforms/... ./internal/authoring ./internal/exams ./internal/schedules ./internal/platform/db ./internal/authz ./cmd/api` from `backend/go` |
| Actual database | 12 top-level tests on an isolated MySQL 8.4 instance, including both zero-break and scheduled-break handoffs |
| Browser | `bun run e2e:sat-forms`: 70 passing Chromium/WebKit tests; 320/640/768/1440 CSS px, long Thai labels, keyboard validation/focus, axe, Settings upgrade, native/embed Eva, uncertain acknowledgements and pause/End |
| Migration | Fresh migration through 0104; direct rerun of 0104 retained response counts for every form key; migrator `--validate-only` reported clean |
| Static checks | Scoped ESLint: zero errors, 15 warnings in existing label-analysis/controller areas. `git diff --check` passed. |

Database cases cover credential admission, code-start rollback without a section response, sealed answers and receipt replay, unchanged clocks on form acceptance, same-section routing, selected-module entry, break withholding, recovery anchoring, an End lock barrier, room pause/resume, disabled Math entry with retained questions, native Eva editing, embedded non-tracking, explicit closure, and draft lifecycle/version isolation.

## Deployment

Apply migration 0104 before deploying the updated API and workers, then deploy the frontend. Keep personal SAT timing enabled for new v2 rooms. Existing rooms retain their captured version and timing model; use the explicit draft upgrade for future rooms.

No production deployment or live external form provider was exercised. Browser provider responses are controlled fixtures. A real destination URL still needs the existing provider/browser preview before staff enables embed mode. Manual screen-reader, virtual-keyboard, fleet/load and production metadata-lock rehearsals were not performed by these checks.
