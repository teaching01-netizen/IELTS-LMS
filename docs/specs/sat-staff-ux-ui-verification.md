# Digital SAT Staff UX/UI Verification Evidence

**Target:** [sat-staff-ux-ui-spec.md](./sat-staff-ux-ui-spec.md)

**Result:** The implemented UI and mocked browser workflows pass the recorded checks. Product sign-off, database-backed workflows, and full WCAG acceptance remain partial.

## Verification target and boundary

This run verifies the SAT staff-facing React routes and interactions described by the UX specification. The critical UX guarantees are clear state/action hierarchy, recoverable feedback, preserved room/result context, keyboard operation, and responsive access to core controls. Playwright replaces HTTP responses with deterministic fixtures; no database transaction, server authorization, production role policy, or deployed service behavior is proved here. The separate Lean project proves theorems about its abstract SAT start/admission model only.

## Requirement traceability

| Requirement | Evidence in this repository | Status in this run |
| --- | --- | --- |
| SAT-UX-01 — role destinations and return context | `SatAccessRoute.test.tsx`, `useSatListReturn.test.tsx`, SAT route tests, `sat-staff-results-ux.spec.ts` | Unit-covered; mocked browser checks confirm role-appropriate navigation for admin, builder, proctor, and grader. Response inspector close restores the same filters and focus. Server authorization is not established by navigation visibility. |
| SAT-UX-02 — find/create exams and lifecycle clarity | `SatExamLibraryRoute.test.tsx`, `SatRoot.test.tsx`, `sat-authoring-lifecycle.spec.ts` | Unit-covered; four mocked browser scenarios pass for no-draft, explicit draft creation with the question prompt rendered, refresh, and missing exam. The browser test models the documented co-editing-unavailable response and verifies the HTTP-backed editor fallback. |
| SAT-UX-03 — publish blockers and version scope | `SatDeliveryReleaseRoute.test.tsx`, `SatDeliveryReleasePage.test.tsx`, `releaseSelectors.test.ts`, `sat-authoring-lifecycle.spec.ts` | Unit-covered; mocked browser walkthrough confirms full-exam blockers, a passing section scope, excluded-section copy, and the version-pinned publish request before navigation to access links. Server persistence and authorization remain unproven. |
| SAT-UX-04 — guided room setup and pre-create review | `AccessLinkEditorSheet.test.tsx`, `DeliveryFlow.test.tsx`, `SatSessionsRoute.test.tsx`, `sat-staff-room-ux.spec.ts` | Unit-covered; mocked browser walkthrough completes the guide from both Rooms entry points, checks validation, audience and check-in, preserves values after Back, reviews the pinned exam version, and creates/navigates. The narrow review passes at 390 CSS px. Database persistence remains unproven. |
| SAT-UX-05 — live-room state and scoped actions | `SatSessionRoomRoute.test.tsx`, `SatSessionRoomStudents.test.tsx`, `sessionRunSheet.test.ts`, `sat-staff-room-ux.spec.ts` | Unit-covered, including stale-confirmation rejection. Mocked browser checks pass at 320, 390, and 768 CSS px, and exercise keyboard confirmation/cancel/focus restoration. |
| SAT-UX-06 — response search and attempt context | `SatResultsRoutes.test.tsx`, list-parameter and return-context tests, `sat-staff-results-ux.spec.ts` | Unit-covered; browser scenario covers search/status/date filters, Bangkok-local date-to-UTC conversion, saved-answer inspection, shared URL refresh, and return to the filtered list. Pagination remains unit-covered. |
| SAT-UX-07 — keyboard and assistive technology | Dialog, focus, and interaction unit tests; `sat-staff-room-ux.spec.ts`; axe checks in the browser specs | Keyboard confirmation/cancel and focus restoration pass in browser. Automated axe checks report no critical/serious violations on tested states. Manual screen-reader review remains unrun. |
| SAT-UX-08 — phone/tablet/reflow | `sat-staff-room-ux.spec.ts`; `e2e/sat-product-workspace.spec.ts` has a DB-backed responsive matrix | Mocked live room passes at 320, 390, and 768 CSS px and at 640 CSS px with DPR 2; these checks report no page-level horizontal overflow. DPR 2 is a reflow proxy, not actual browser zoom. The broader DB-backed matrix remains unrun. |
| SAT-UX-09 — WCAG 2.2 AA | `satContrastTokens.test.ts`; axe-core checks in `sat-authoring-lifecycle.spec.ts`, `sat-staff-room-ux.spec.ts`, and `sat-staff-results-ux.spec.ts` | Partial: no critical/serious axe violations on tested mocked authoring, publish readiness/confirmation, room setup/live-room, response-list, and inspector states. The runs found low-contrast authoring and staff text; fixes now use AA text/accent tokens, with regression coverage for accent/hover, tertiary labels, SAT muted text, and publish-dialog copy. Manual focus-obscuration, actual zoom/magnification, assistive-technology, and full-process review remain. |

## Commands and results

- `bun run test:run -- --silent` — **782 files passed; 6,646 tests passed, 2 skipped**. The passing run emitted a Vite duplicate-`sectionKey` warning in the unrelated `SatMoreHelpFlow.test.tsx` fixture.
- `bunx playwright test --config=playwright.sat-staff-ux.config.ts --workers=2 --reporter=line` — **12 mocked browser tests passed**: role navigation, response search/filter/inspection/refresh/return, room setup from both entry points, live-room reflow at 320/390/768 CSS px, keyboard confirmation/cancel/focus restoration, and 640 CSS px at DPR 2. Both room setup flows review and create with the exam version pinned; the exam-specific path verifies no page-level horizontal overflow at 390 CSS px. Axe ran on setup review, room, and response surfaces. The Vite WebSocket proxy reported connection-refused messages for mocked room/results scenarios because the backend was not running.
- `bunx playwright test --config=playwright.sat-authoring.config.ts --workers=1 --reporter=line` — **5 mocked browser tests passed**: four lifecycle scenarios plus publish review. Publish coverage checks failing whole-exam readiness, passing section readiness, scope/version confirmation, and a version-pinned publish request. The workspace test verifies the fetched prompt is rendered after opening and refresh; a mocked co-edit 503 exercises the HTTP-backed fallback. Axe ran on pre-draft, loaded editor, not-found, and publish states. The browser's generic console line for the mocked 503 is filtered; application console errors and page errors remain asserted empty.
- `bun run typecheck` — passed.
- `bun run build` — passed; 3,710 modules transformed.
- Changed-file ESLint — **0 errors, 0 warnings**.
- `git diff --check` — passed.
- Lean audit: `lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit` and `lake env lean AxiomAudit.lean` — passed.

An earlier overlapping full-suite run had six timeout/async failures; the final isolated full unit run passed after the accessibility and responsive fixes. Browser checks exposed low-contrast text and a room-header overflow; these were fixed and covered by regression checks. The authoring fixture models the typed unavailable-service path, verifies the loaded prompt, and includes the publish readiness/version review. Final isolated staff and authoring browser runs passed.

The database-backed browser suite was not pointed at the generic `DATABASE_URL` or `DATABASE_DIRECT_URL` values in `backend/.env`: `e2e/support/db.ts` can use those as fallbacks, and SAT scenarios mutate exam and attempt records. No test-specific connection was available to identify as disposable.

## Formal boundary

No new Lean theorem was added: the changed guarantees are React interaction and presentation requirements, and a separate toy state-machine theorem would not establish that the browser implementation refines it. The pinned project at `verification/lean/sat-access-code-start` was rebuilt at repository HEAD `f78e77627bfd4a2fadf9c507320389e86e0c6233` with `leanprover/lean4:v4.19.0` using `lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit && lake env lean AxiomAudit.lean`. The audit prints the exact existing abstract backend theorem statements and reports only Lean's standard `propext`, `Classical.choice`, and `Quot.sound` axioms; the unguarded counterexample theorem reports no axioms. These theorems concern the abstract backend start/admission model, not this UX spec or the TypeScript implementation. Backend-to-production correspondence remains outside this UX verification.

## Remaining acceptance evidence

- Run the live multi-role exam, publish, room-setup, results, and return-context flows against a configured disposable test database.
- Complete manual screen-reader, actual 200% browser text zoom/magnification, visible-focus, and contrast review across the full staff workflows.
- Review product decisions in spec §11 before treating the specification as final.

## Production test plan and recommendation

After a confirmed disposable test database is configured, run the existing SAT product workspace browser suite through publish, room creation, student access, room operation, and response review; capture persisted state and verify return URLs and room version pins. Then complete keyboard-only, 200% browser zoom/reflow, focus-obscuration, and representative screen-reader walkthroughs at the supported live-proctoring widths. Product owners must settle the role/action matrix, timezone policy, supported proctor devices, and usability baselines in spec §11. Until those steps are evidenced, treat this result as **conditional UI acceptance**, not production readiness or complete WCAG conformance.
