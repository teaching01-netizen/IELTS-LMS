# Phase 7 — Acceptance, deployment, and operational handoff

Status: planned. Depends on: [Phase 6](phase-06-reliability-security-performance.md).

## Result

An evidence-backed release with a defined supported environment, deployment gates, compatible assets/data, and a rehearsed recovery path. A successful build or screenshot alone does not satisfy this phase.

The current task permits code review/planning only and prohibits browser work. Prepare code-based checks now. Browser, assistive-technology, and real-device checks listed here remain unexecuted until the user's working constraints permit them. Do not silently waive them or claim full production readiness while they are pending.

## P7.1 — Record a reproducible release candidate

Pin the resolved commit, dependency locks, Node/npm/Go versions, production build ID, API/worker versions, schema migration version, and deterministic fixture IDs. Preserve exact test commands/results and relevant artifacts in a private evidence location.

Confirm all Phase 0 issues were rechecked rather than copied from the old baseline. No unresolved Git conflict, broken clean install, type error, required test failure, or known critical security issue remains.

## P7.2 — Run static, unit, integration, and regression gates

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

Run installation in the isolated candidate checkout. Use the existing Go/MySQL environment for backend/integration/race/migration validation. Re-run broad suites after integration changes; do not repeatedly run unchanged expensive suites without a reason.

Include SAT regressions for shared routing/CSS/media/delivery changes. Required assertions must fail if the navigator, dialog, metric, or endpoint is absent. Intentional provider capability absence is represented by an explicit fixture and an assertion of absence.

## P7.3 — Execute functional, visual, and accessibility acceptance

Use the complete UX/REL/SEC matrices in [verification-and-release.md](verification-and-release.md). The detailed phase task IDs map each failure back to its owner; repair it there instead of adding a release-only workaround.

Required evidence:

- IELTS Reading/Listening/Writing/Speaking support and ACT Science at the documented viewport/mode boundaries.
- Realistic all-question-type fixtures, long options, scientific tables/images, grouped numbering, and 1,000+ word essays.
- Stable element identity, answer/scroll/caret continuity, divider limits/cancellation, deterministic select commit/cancel/clear, and focus restoration.
- Keyboard-only operation, forced colors, high contrast, reduced motion, text-spacing override, 200% text enlargement, and 320-CSS-pixel/400% reflow cases.
- Screen-reader checks with at least the supported Windows and Apple assistive-technology combinations; record actual combinations rather than implying one automated scanner covers them.
- Browser-engine coverage through existing Chromium/Firefox/WebKit profiles plus physical iOS/Android/iPad keyboard/selection/rotation behavior. Samsung Internet gets explicit testing when included in support policy.
- Deterministic reference captures with fixed content/time/font settings. Classify changes as approved design improvement, platform rendering difference, or defect; do not auto-approve every changed screenshot.

If the browser restriction remains, mark these items **pending** and leave production promotion incomplete. Code implementation and code-based tests can still be completed within the authorized scope.

## P7.4 — Run realistic durability and capacity rehearsal

Execute offline/reconnect, stale acknowledgment, credential expiry, second-owner conflict, storage denial, response loss, timeout/manual/proctor races, and sealed-answer immutability against real isolated services. Verify persisted state/receipt, not just a toast.

Run existing load scenarios at the agreed concurrency/start-window and document latency/error/backlog distributions and resource saturation. Record the numeric thresholds chosen in Phase 6 before the run. Include a 60-minute interaction/recovery soak. Do not label the named 200-user script as the application's universal capacity.

Rehearse backup restore and in-progress attempt recovery with the existing operational process. Record recovery-time/recovery-point results and remaining limitations. Do not introduce a new backup system unless the current one fails a required capability.

## P7.5 — Make CI enforce release prerequisites

**Files:** `.github/workflows/ci.yml`, existing Playwright/Vitest configs, deployment scripts/runbooks where active.

1. Require frontend quality, Go backend, E2E, and relevant performance/accessibility jobs before `railway-deploy` can promote a candidate.
2. Audit job conditions and skip behavior. A required job being skipped is not a passing result. Use the actual workflow job names rather than creating redundant duplicate suites.
3. Pin release-critical tooling through the repository's supported mechanism and keep credentials in the existing secret store. Never print secrets in diagnostics.
4. Remove public artifact upload for authenticated/sensitive content. Replace Lighthouse `temporaryPublicStorage: true` with a private evidence path when needed; use synthetic fixtures even in private reports.
5. Replace the misleading post-deploy unit-test check with a genuine deployed health/API smoke and synthetic flow verification. Use existing dedicated production-smoke infrastructure only after verifying it targets the correct service and safe test data.
6. Validate cache headers and asset publication: hashed assets remain available to open old sessions; the HTML/manifest is published consistently; stale chunk failures have an appropriate recovery message.

Workflow changes can be prepared locally; pushing, deployment, production tests, and migrations are separate consequential execution steps outside this planning-only request.

## P7.6 — Roll out without interrupting active exams

Order: isolated staging → internal synthetic sessions → limited cohort → broader release. Prefer existing deployment/cohort controls. Add a rollout flag only if necessary, and resolve it at bootstrap so a running attempt does not switch presentation mid-exam.

Before expanding, verify entry, active save, media, finalization, receipt, and telemetry on the deployed candidate. Keep old assets/API contracts available long enough for active sessions to finish. Do not force refreshes to make deployment easier.

Monitor the agreed save/submit/error budgets and assign an incident owner. Candidate-facing recovery instructions must be accurate and actionable; technical diagnostics belong in restricted logs/runbooks.

## P7.7 — Rehearse rollback and data compatibility

Define rollback triggers before promotion: any confirmed acknowledged-answer loss, false completion, unauthorized access, duplicate terminal result, widespread entry/continuation failure, or sustained material regression beyond agreed budgets.

Rollback must restore compatible assets/configuration without clearing answer drafts, quarantine records, or candidate data. Keep server APIs compatible with still-open clients. For additive backend changes, retain schema compatibility; do not drop columns or reverse migrations that current attempts use.

V3 annotations require special care: retain old V2 records for the previous reader and retain V3 records for recovery. A previous release cannot be assumed to understand newly introduced notes/underline. Do not force active V3 attempts onto an incompatible reader; pin/retain their working assets or ship the required compatibility reader before rollback. Explicitly test reload during rollback. Preserving bytes while making active work inaccessible is not a successful rollback.

## P7.8 — Deliver the completed change

Provide implementation code, relevant tests, fixture manifest, supported browser/device versions, migration notes, exact verification results, private evidence links, monitoring/incident instructions, and rollback steps. Remove temporary debugging code and obsolete duplicate implementations once consumers and compatibility windows allow it.

Final readiness must state what was actually verified. Do not describe unrun device/security/load tests as passed or substitute unit tests for deployed verification.

## Exit checklist

- [ ] All implementation phase gates passed on the release candidate.
- [ ] Clean install/typecheck/lint/build and required frontend/backend tests passed.
- [ ] Required UX, accessibility, real-device, failure-recovery, and scale scenarios have evidence.
- [ ] Deployment waits for every required gate; artifacts do not expose private content.
- [ ] Synthetic deployed smoke passed before cohort expansion.
- [ ] Active exam and annotation compatibility survive a tested rollback/reload.
- [ ] Monitoring, recovery expectations, incident ownership, and known limitations are documented.

If any required item remains pending, report the concrete limit and keep production promotion incomplete.
