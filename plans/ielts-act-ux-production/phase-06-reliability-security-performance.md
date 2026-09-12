# Phase 6 — Recovery, security, performance, and capacity

Status: planned. Depends on: [Phase 5](phase-05-annotations-memory.md). Next: [Phase 7](phase-07-verification-release.md).

## Result

The polished interface reports persistence truth, preserves accepted work through tested failures, respects server authority, and stays responsive on realistic content. This phase repairs demonstrated gaps at existing owners; it does not replace the runtime or create another persistence system.

## File ownership

| Responsibility | Existing owner |
| --- | --- |
| Local commands/state | `src/features/student/application/exam-session/answerCommands.ts`, `navigationCommands.ts`, `studentExamStoreFactory.ts`, `reconcileServerSnapshot.ts` |
| Submission | `submissionCommands.ts`, `studentSubmissionCoordinator.ts`, `src/components/student/useStudentSubmissionOrchestration.ts`, `useStudentAutoSubmitBoundary.ts` |
| Durable adapters | `src/features/student/infrastructure/exam-session/`, `src/components/student/providers/StudentAttemptProvider.tsx`, `src/shared/durability/`, `src/services/studentMutationOutbox.ts` |
| Status/blocking | `src/features/student/domain/exam-session/blockingPolicy.ts`, `terminalState.ts`, existing runtime/attempt providers and header/overlay components |
| Time/realtime | `src/shared/hooks/useAuthoritativeDeadlineClock.ts`, existing student runtime poll/realtime coordinator and clock components |
| Content safety | `src/utils/sanitizeHtml.ts`, `imageUrl.ts`, existing annotation/model validation |
| Backend | `backend/go/cmd/api/`, `backend/go/internal/act/`, `delivery/`, `terminalization/`, existing auth/media/data boundaries |

## P6.1 — Trace the live save path for each provider

Record one concise call-chain for each active IELTS/ACT route: rendered control → live draft registration → application command → configured durability/outbox adapter → API → acknowledgment/reconciliation. Confirm the actual feature/configuration selection. Do not assume a class is active because it exists in the tree.

Preserve these invariants:

1. Local accepted input is immediately visible; network latency is not required for a radio to fill or text to appear.
2. An accepted write carries stable attempt/question/slot identity and the required revision/epoch metadata.
3. Only the existing persistence owner can mark a write acknowledged. A second UI effect cannot synthesize a saved state.
4. Older acknowledgments cannot replace newer local intent.
5. Submitted/sealed answers are immutable; rejected late writes remain recoverable under existing policy.

If a path bypasses an invariant, repair its existing boundary and add a regression there. Do not mirror all writes into a new queue to compensate.

## P6.2 — Map status and severity to actual state

Use a pure mapping over the existing attempt/runtime status. Add a new enum only if the existing types cannot express an observed required state.

| Actual condition | UI behavior |
| --- | --- |
| Current write acknowledged | Quiet Saved state; no toast or layout movement |
| Latest write awaiting server acknowledgment | Stable Saving/Syncing state |
| Offline with a confirmed local checkpoint | Explicit device-saved state; follow existing offline runtime policy |
| Offline without confirmed local storage | Never claim device-saved; preserve live draft and show recovery warning |
| Storage unavailable | Existing blocking policy prevents further unsafe acceptance; retain work and show proctor/recovery action |
| Proctor pause/section closed | Authoritative blocking message; ordinary retry does not unlock it |
| Submit sent, receipt unverified | Pending verification, not completion |
| Receipt/terminal state verified | Provider-correct completion |

Do not turn existing log-only integrity signals into new hard blocks as an incidental UX change. Likewise, do not make an enforced server restriction optional. Remove contradictory copy only after tracing its reachable state.

## P6.3 — Test submission as an ordered barrier

Use the existing `DraftCommitPort` and submission coordinator sequence: commit live drafts → flush local durability → flush required pending mutations → call/reconcile submission transport. Determine from the active adapter what each flush guarantees; do not infer server acknowledgment from a merely local flush.

Test failure injection at every boundary:

- Draft commit throws: no submit call; live data remains available.
- Durable write fails: no verified completion; actionable storage state.
- Pending flush times out/fails: preserve retry state and edits; no duplicate terminal command.
- Server accepts submission but response disappears: reconcile the same attempt/receipt and reuse idempotency identity.
- Manual submit, timeout, and proctor advance overlap: at most one accepted terminalization; no post-seal mutation.
- An authoritative deadline arrives while a dropdown/note/editor is open: capture only accepted answer edits through existing barriers and close unsafe interaction paths.

Retries use existing backoff/jitter/bounds and error classification. A 429/retryable timeout differs from authorization/schema/lease rejection. Never recursively retry forever or generate a new submit identity on every attempt.

## P6.4 — Preserve recovery across lifecycle and ownership changes

Test old snapshot after new edit; tab reload around the Writing debounce boundary; storage quota/getter/read failures; malformed records; auth expiry; second device/lease; pause/extension; background throttling; OS sleep/wake; and lost realtime followed by safety polling.

Use server deadlines and current timing revisions. Network reconnection or browser time changes cannot grant extra exam time. Preserve pending/quarantined edits for supported recovery; cleanup requires verified existing retention rules, not component unmount or request dispatch.

Record the measured local persistence window. A physically typed character still in an unflushed DOM buffer is different from a durably acknowledged answer. Improve an excessive window at the existing live-draft owner, without falsely claiming browser termination can never interrupt an in-flight write.

## P6.5 — Verify content and identity boundaries

1. Exercise every new HTML-rendering path with script/event-handler/unsafe-URL payloads, including transformed media markup and annotation decorations. Use the existing DOMPurify/URL pipeline; plain-text notes never become HTML.
2. Verify student payload redaction after ACT adapter changes: answer keys, grading internals, and authoring-only data remain absent.
3. Verify attempt and media authorization server-side with a second synthetic candidate; client hiding is not access control. Retain CSRF binding, origin validation, request/body limits, and safe error responses.
4. Validate media type, size, and reference ownership at existing upload/complete/download boundaries. A filename extension or client-declared MIME type is insufficient evidence by itself.
5. Inspect production header/CSP configuration before proposing changes. Account for configured audio/images, portals, math, and worker requirements; do not blindly add a policy that breaks the exam. Report-only measurement precedes enforcing a newly tightened policy when needed.
6. Keep tokens, answers, notes, essays, and candidate data out of public artifacts and logs. Test redaction at the existing debug/telemetry boundary.
7. Check dependencies/lockfiles for relevant security findings using the normal CI workflow. Fix reproducible exploitable findings; do not blanket-upgrade the dependency tree without compatibility tests.

## P6.6 — Optimize only measured hot paths

Measure a production build with realistic fixtures against [the performance budgets](verification-and-release.md). Instrument around meaningful interactions without logging their content.

Typical bounded repairs, only if measurements justify them:

- Use existing selector hooks so an answer update subscribes only the necessary question/progress/status surfaces.
- Keep clock ticks inside existing clock components; do not rerender the textarea or reparse passages each second.
- Cache sanitized/canonical immutable content by version/surface identity; invalidate correctly when content changes.
- Keep pointermove free from synchronous sessionStorage and repeated full-tree reads; coalesce geometry writes per frame.
- Use native textarea input and cheap derived count updates. A worker, virtualization layer, or editor framework is not the default fix for a 1,000-word essay.
- Decode/layout images without cumulative jumps; avoid eager-loading every offscreen high-resolution image when current media behavior permits staged loading.

Keep the <=500KiB current compressed-entry gate and measure required lazy student chunks separately. Record before/after latency, render counts where useful, and the specific fixture/device; do not claim performance improvement from code inspection alone.

## P6.7 — Verify scale and observability

Reuse existing k6/API/worker/database setup for the agreed concurrent-candidate load, including start bursts, steady saving, section transitions, reconnect waves, auto-submit, and submit storms. Start with existing named workload presets; derive final capacity from actual enrollment requirements.

Monitor pending age/depth, save acknowledgment latency, verified-submit latency, retry counts by reason, rejected stale writes, media errors, DB pool saturation, CPU/memory, and client crashes. Keep metric labels bounded; correlate with opaque IDs in restricted logs only when needed.

Set numeric service thresholds and capacity headroom from the Phase 0 baseline before load acceptance. Any lost acknowledged answer, false completion, duplicate score, or authorization breach fails regardless of average latency. Fix bottlenecks at their existing boundary before adding caches/services/queues.

## Validation and exit gate

```sh
npm run test:run -- src/features/student/application/exam-session/__tests__ src/shared/durability/__tests__ src/services/__tests__/studentMutationOutbox.conflicts.test.ts src/utils/__tests__/sanitizeHtml.test.ts src/components/student/__tests__/answerMutationDebug.redaction.test.ts src/shared/hooks/__tests__/useAuthoritativeDeadlineClock.test.ts
npm run typecheck
```

When backend code changes, run targeted Go tests for that boundary and the existing race/integration gates against an isolated test database. Never use production data for failure injection/load.

Suggested commits: status truth; barrier/recovery defects; content/auth/telemetry safeguards; measured performance repairs. Exit when all code-based failure scenarios pass, no new persistence authority exists, and real integration/performance/capacity evidence is completed or explicitly pending for Phase 7. Pending evidence prevents a production-ready claim.
