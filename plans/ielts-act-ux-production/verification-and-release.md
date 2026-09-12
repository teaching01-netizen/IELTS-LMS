# Verification and release contract

This is the required implementation verification plan. Browser/device checks below are future release gates; they were not executed during the code-only planning review.

## Evidence rules

- Record the exact commit and environment for each result. The planning checkout has existing changes and unresolved conflicts, so its results are a limited baseline.
- Use realistic authored fixtures through existing preview/delivery adapters. A three-question sample cannot establish 40-question navigation, long-option, or large-essay quality.
- Required UI or measurement missing means failure. Avoid `if (visible) { assert(...) }` and early returns that turn missing features into success.
- Prefer user-observable assertions: input value, focus destination, committed revision, verified receipt, pane containment, and preserved context. Update class-string tests when intentional styling changes; do not rely on them as proof of accessibility.
- Keep product tests isolated from production candidates. Use synthetic accounts/content in a separate Go/MySQL environment. Do not point destructive fixture setup at shared or production data.

## Functional acceptance matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| UX-01 | Render every supported IELTS question family and ACT Science text/image choices | Correct labels, order, answer keys/slot IDs, wrapping, and accessible controls |
| UX-02 | Click answer-row whitespace, select by keyboard, flag, and eliminate an ACT choice | Exactly the intended action occurs; no accidental selection or duplicate mutation |
| UX-03 | Open a matching select near each viewport edge; use arrows/typeahead/Enter/Escape | Overlay stays reachable; commit and cancel are distinct; focus returns correctly |
| UX-04 | Choose/clear a select and immediately blur, navigate, or submit | Latest committed value reaches the live registry, durability path, and server |
| UX-05 | Navigate multi-slot/grouped questions, first/last question, and non-40 ACT fixtures | Correct numbering/progress; no off-by-one jumps; navigation cannot submit |
| UX-06 | Drag splitter to limits, cancel pointer, lose capture, resize, unmount | No invalid pane width, stuck selection lock, leaking listener, or extra storage writes |
| UX-07 | Resize by keyboard and click/tap alternatives | Same real bounds and value as drag; controls work without dragging |
| UX-08 | Switch panes, rotate, narrow/widen repeatedly while reading paragraph D/Q14 | Active pane and meaningful source/question location restored; no duplicate inputs |
| UX-09 | Type 1,000+ words, use multiline/Unicode/IME, switch tasks and return | Text, selection, scroll, count, and allowed editing behavior stay correct |
| UX-10 | Change layout, flag, or tick the timer while composing text | No textarea replacement, selection loss, or premature IME commit |
| UX-11 | Open/close software keyboard, change focus while open, rotate while typing | Active line/control remains reachable; no document jump or covered essential action |
| UX-12 | Apply highlight/underline/note over repeated text, nested markup, and Unicode | Correct stable offsets; no text movement; keyboard/touch operation succeeds |
| UX-13 | Reload annotations, migrate V2 data, change content version, deny storage | Safe restoration/migration; no stale marks on different content; truthful failure state |
| UX-14 | Play Listening audio, switch panes/layout, stall/error/end, blocked autoplay | One configured playback state; useful recovery; no silent restart or policy change |
| UX-15 | Zoom ACT stimulus/question/choice images; fail an asset request | Legible content/aspect ratio; close restores focus; errors do not erase answers |
| UX-16 | Enter/pre-check/lobby/pause/resume/complete for IELTS and ACT | Provider-correct copy, focus, status, and actions; no unauthorized local submit |
| UX-17 | Apply largest text, text spacing, high contrast, forced colors, reduced motion | No clipping/lost functions; visible distinct focus and non-color states |
| UX-18 | Render identical Writing prompts under different task IDs | Annotation surface and draft/caret remain associated with the correct task |

## Reliability and security acceptance

| ID | Trigger | Required proof |
| --- | --- | --- |
| REL-01 | Offline after a confirmed local checkpoint; reconnect and reload | Same latest accepted answer reaches server once, with correct write identity |
| REL-02 | Kill/reload immediately before and after the draft debounce boundary | Document the actual persistence window; no loss of durably acknowledged work; ordinary navigation flushes pending drafts |
| REL-03 | Old save acknowledgment/snapshot arrives after a new answer | Newer local intent is not overwritten |
| REL-04 | Manual submit, timeout, and proctor advance race with a pending write | One terminal result; correct barrier ordering; no late mutation of sealed answers |
| REL-05 | Server accepted submit but response was lost; retry/reload | Receipt reconciliation recognizes completion without duplicate scoring/submission |
| REL-06 | Storage getter/read/write failure, quota exceeded, corrupt draft | Preserve available work, expose recovery state, and follow existing hard-stop policy |
| REL-07 | Credential expiry, second device/owner lease, stale control epoch | Correct re-auth/conflict flow; data retained; no identity crossover |
| REL-08 | Sleep/wake, background throttling, clock adjustment, extension, pause/resume | Deadline and section state reconcile to server authority |
| SEC-01 | Malicious rich text, note text, SVG/image URLs, corrupted annotation payload | No executable content; invalid data rejected; normal content still works |
| SEC-02 | Read/mutate another attempt, fetch another candidate's media, omit CSRF | Backend denies unauthorized operations with correct status and no sensitive payload |
| SEC-03 | Inspect student-delivery payloads and client telemetry | No answer keys, secrets, notes, response text, or private draft contents leak |
| SEC-04 | Switch candidate/session and complete/logout on a shared browser | View data is correctly namespaced; no cross-candidate state; recoverable answers are not cleared prematurely |
| SEC-05 | Pause or finalize while a menu/note editor is open | Overlay cannot keep an otherwise locked answer editable; ephemeral state closes safely |

“Saved” must describe the actual storage layer. Ordinary navigation/reload can be protected with lifecycle flushes; browser/OS termination can interrupt an in-flight write. Measure that boundary and report it honestly instead of promising that every physical keystroke survives every device failure. If a keystroke has not reached the durable layer, do not label it durably saved.

## Viewport and input matrix

| CSS viewport | Expected starting presentation |
| --- | --- |
| 320×568 | Phone |
| 375×667 | Phone |
| 390×844 | Phone |
| 412×915 | Phone |
| 430×932 | Phone |
| 844×390 | Compact with low-height treatment |
| 768×1024 | Compact |
| 820×1180 | Compact |
| 1024×768 | Standard split when enlarged-content fit permits |
| 1180×820 | Wide split when fit permits |
| 1366×1024 | Wide |
| 1280×720 | Wide |
| 1366×768 | Wide |
| 1440×900 | Wide |
| 1920×1080 | Wide |
| 2560×1440 | Wide with bounded reading measure |

Also test 599/600, 899/900, 1179/1180 widths, and 599/600 plus 649/650 heights; shell narrower than browser window; resized browser alongside another app; and orientation changes without remount.

Use the existing Chromium, Firefox, WebKit, mobile-Chromium, mobile-WebKit, and tablet projects. Cover the critical state/mode combinations on each engine, with the broader viewport/content matrix in scheduled/release checks. Do not multiply every browser/viewport/input/content combination unnecessarily; use risk-based pairings while explicitly covering every listed invariant.

Text/browser zoom: 100%, 125%, 150%, 200%; 400% on a 1280px desktop for reflow. Device scale factor is not a substitute for browser zoom. Include keyboard-only navigation, mouse, touch, hybrid touch+trackpad, reduced motion, and user contrast/text preferences.

Real-device release checks must cover Safari software keyboard/selection, Android keyboard/selection, Samsung Internet where supported, and iPad rotation/multitasking. Desktop WebKit and Playwright device emulation alone do not prove those behaviors. Record supported versions and test dates; unsupported proctoring APIs need an explicit capability message instead of a false success.

## Performance and scale budgets

The following are initial project acceptance targets, not measured current results. Measure on a representative lower-powered supported device using production builds and realistic exam fixtures; establish repeatable baselines in Phase 0.

| Metric | Target / gate |
| --- | --- |
| Answer selection and text input to next paint | p95 <=100ms under the representative fixture workload |
| Field interaction latency | Aim for p75 INP <=200ms; do not substitute a synthetic metric for field INP |
| Splitter drag | No width transition; at most one layout update per frame; no repeated >=50ms tasks during ordinary dragging |
| Layout stability | Zero unintended movement of active controls/caret, timer slot, or count label on ordinary state changes |
| Timer render isolation | Timer ticks do not cause editor DOM replacement or unrelated answer-tree renders |
| Initial bundle | Preserve current CI <=500KiB compressed entry-assets gate |
| Student route cost | Measure entry plus required lazy chunks; no unexplained >10% growth from the clean baseline |
| Network mutations | No additional save/poll requests caused solely by responsive layout or pane switching |
| Long session | 60-minute reading/writing interaction soak without growing listeners, runaway queues, or progressive latency |

Reuse the existing k6 start/transition/submit/resume scripts. Begin with their configured workloads, including the named 200-user start/submit cases, in an isolated staging environment. This is a starting load scenario, not a claim that 200 users is the product's final capacity. Set the release capacity from actual concurrent enrollment/start-wave expectations, then test steady saving, bursts, retry storms, timeout terminalization, and recovery with headroom.

Record save acknowledgment and verified submission p50/p95/p99, HTTP errors/timeouts, queue depth/age, DB pool saturation, and process memory/CPU. Define service-specific latency/error thresholds from the clean baseline and the required exam-day capacity before promotion. Any lost accepted answer, duplicate finalization, or authorization failure is a hard stop independent of average latency.

## Commands and existing test ownership

Run these in the repository root after Phase 0. Do not run `npm ci` over the current working environment merely to assess a plan; use a clean isolated checkout for installation verification.

```sh
npm ci
npm run typecheck
npm run lint
npm run test:run
npm run test:coverage -- --run
npm run build
npm run test:performance
git diff --check
```

Run focused tests during each implementation slice. Existing anchors include:

- Layout: `src/components/student/layout/__tests__/`, `StudentMaterialWithQuestionPane.test.tsx`, `StudentSplitPaneCss.test.ts`, `StudentViewportCss.test.ts`, `StudentFooterOverlayLayout.test.ts`.
- Controls/editor: `ProtectedSelect.test.tsx`, `StudentWriting.lifecycle.test.tsx`, `StudentWriting.undo.test.tsx`, `StudentWriting.clipboard.test.tsx`, `StudentWriting.a11y.test.tsx`, `StudentQuestionExperience.test.tsx`.
- Durability: `src/shared/durability/__tests__/`, `src/features/student/application/exam-session/__tests__/`, existing mutation-outbox conflict tests.
- Integration: `student-input-durability.spec.ts`, `student-durability.spec.ts`, `student-recovery.spec.ts`, `student-submit-flow.spec.ts`, `student-writing-draft.spec.ts`, `student-timer.spec.ts`, `student-network.spec.ts`, `student-security.spec.ts`, `student-multi-device.spec.ts`, `e2e-05-proctor-advance-during-flush.spec.ts`.
- UX: `student-viewport-layout.spec.ts`, `student-exam-viewport.atdd.spec.ts`, `student-ipad-layout.spec.ts`, `student-accessibility.spec.ts`, `student-highlight-selection.spec.ts`, `student-interaction-motion.spec.ts`.
- ACT: `act-science-workflow.spec.ts`, `act-full-cycle.spec.ts`, ACT reconciliation fixtures/tests under services, components, and the Go backend.

After isolated database/environment provisioning, the existing Playwright configuration starts Go API, worker, and Vite. Run the selected files per phase, then the complete required suite before release:

```sh
npx playwright test
```

For backend repairs, use the existing CI environment and isolated test database. From `backend/go`:

```sh
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./internal/...
go build ./cmd/api ./cmd/worker ./cmd/migrate
go run ./cmd/migrate --validate-only
```

Run real-MySQL integration/migration tests using CI's documented test configuration. No migration application or destructive load test is authorized against production by this plan. If no backend code changes are required, retain the existing backend release gates without repeating unrelated tests on every CSS edit.

## CI and deployment changes

1. Retain current typecheck, lint, test, coverage, backend, migration validation, and bundle checks. Fix their inputs rather than reducing thresholds to make a visual change pass.
2. Require `e2e-tests` and the relevant performance/accessibility checks before `railway-deploy`. Inspect conditional/skipped job behavior so a required skipped job cannot silently approve promotion.
3. Add a secret/dependency scanning gate appropriate to the existing registry/CI; distinguish reproducible new exploitable findings from documented baseline findings. Pin release-critical CLI/tool versions and actions through the repository's chosen lock/pinning mechanism.
4. Keep traces, screenshots, and telemetry private. `.github/workflows/ci.yml` currently sets Lighthouse `temporaryPublicStorage: true`; do not send authenticated candidate content there. Use synthetic fixtures and private retained artifacts.
5. Replace the current “unit tests against production” claim with a genuine read-only deployed HTTP/UI smoke using synthetic data and correct environment configuration. Unit tests run in a local process regardless of a URL variable.
6. Preserve the old release's hashed assets long enough for open exam sessions to finish. Publish asset manifests atomically and avoid mixed-release chunk failures.

## Rollout and operations

Promote through isolated preview/staging, internal synthetic sessions, a limited cohort, then broader release. Use the existing deployment controls; add a simple rollout flag only if cohort selection cannot otherwise be performed safely. Choose presentation at attempt/bootstrap time and keep it stable throughout an active attempt.

Monitor save age, storage failures, rejected writes by reason, pending finalization, verified-submit latency, media failures, client crashes, and backend saturation. Use opaque correlation identifiers in restricted logs when necessary; never include answer/note text, credentials, or high-cardinality personal information in metrics.

Rollback triggers: any confirmed accepted-answer loss, false verified completion, unauthorized access, widespread inability to enter/continue an exam, new submit barrier failures, or a sustained material regression against agreed performance/error budgets. Pause expansion first; do not force candidates to refresh or purge local work.

Rollback restores compatible application assets/configuration and retains active API compatibility, durable drafts, and annotation readers. If a backend fix requires a migration, use additive compatible changes and a separately tested rollout; do not make a frontend rollback depend on dropping columns or deleting candidate records.

Before launch, rehearse the existing backup/restore process and an in-progress exam recovery against restored data. Record recovery-time/recovery-point expectations and who handles exam-day incidents. Release evidence must include the failing-state recovery path, not just successful screenshots.
