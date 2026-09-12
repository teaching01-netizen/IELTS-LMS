# Student answer and interaction disappearance audit

## Verdict

**Confirmed: the current code can make a newly typed answer and a newly set question flag revert without a student clearing them.** A deterministic test reproduced both changes disappearing through the real IELTS StudentAttemptProvider. Shared-engine tests reproduce additional recovery, version-fencing, and storage failure paths.

This is a code/workspace audit, not a diagnosis of a specific production incident. No production database, affected browser, incident logs, or deployed build was inspected. Baseline HEAD: 7b88606; the workspace already had extensive uncommitted changes. Findings refer to the actual working-tree code, not necessarily that commit or production. No application behavior was modified; only this report and two audit test files were added. No subagents or additional skills were used.

## Active state/persistence model

- IELTS input -> StudentApp handlers -> immediate exam-session state + StudentAttemptProvider -> DurableResponseEngine -> browser checkpoint/durableDraftStore -> V2 response batch -> Go attempts service -> attempt_responses_v2 and attempt_mutations_v2.
- SAT input -> useSatExamController -> useSatResponsePersistence -> the same DurableResponseEngine and HTTP transport.
- A response is a whole-question aggregate: answer, markedForReview, eliminatedOptions, annotations. Replacing one aggregate can revert multiple student actions together.
- The engine displays pending.payload ahead of confirmed.payload. Removing pending makes the previous confirmed answer/flag visible again (src/shared/durability/types.ts:29–36).
- IELTS excludes response fields from ordinary same-attempt legacy snapshot merges (StudentAttemptProvider.tsx:925–969). Therefore a generic claim that every poll overwrites answers would be incorrect. The problematic paths below run through V2 recovery and conflict handling.
- IELTS passage highlights use a separate browser-local store; this audit does not establish server-backed or cross-device durability for those highlights.

## Ranked findings

### F1 — High: delayed recovery replaces a new edit with an older local draft

**Evidence:** reproduced at engine level and through the real IELTS provider.

References:
- src/shared/durability/DurableResponseEngine.ts:269–301 (new versions allocated immediately from an initially empty tracker).
- Same file:435–440, 467–515 (read durable drafts, wait for server, only then seed versions and compare pending states).
- src/components/student/providers/StudentAttemptProvider.tsx:403–477, 1083–1096 (engine exists while recovery is pending; acceptance does not wait when it exists).
- src/features/student-delivery/hooks/useSatResponsePersistence.ts:178–223, 281–296 (same readiness pattern).

Sequence:
1. Browser has an older unsent question draft at client version 20.
2. Recovery reads it, then waits on a slow server response.
3. Student types a new answer and flags the question. The fresh engine allocates versions 1 and 2 because recovered version 20 has not been installed yet.
4. Recovery finishes. Its numeric comparison treats old version 20 as newer than the live edits and installs the old aggregate.
5. The answer reverts and the flag becomes false. The older draft can also replace the question's unsent outbox entry.

The real-provider test observes new answer + true flag first, then older answer + false flag. This is not merely a hypothetical stale React render.

**Remediation:** establish a recovery/readiness barrier and initialize ordering before issuing versioned commands. If students may type during recovery, immediately preserve those intents durably outside the not-yet-initialized command ledger, then reconcile/version them after recovery. Simply waiting before storing input creates a different durability gap.

### F2 — High: editing before version initialization can collide with an already saved server write

**Evidence:** client behavior reproduced with a modeled VERSION_COLLISION response; rejection condition verified in Go code.

References:
- Engine:257–301, 672–698, 885–898, 1203–1213.
- backend/go/internal/attempts/service.go:279–285 (version uniqueness within attempt/lease/question).
- Same Go file:295–320 (a lower unused version can instead be acknowledged as superseded, with the existing canonical response).

Sequence:
1. A saved answer already used client version 1 in the current lease.
2. After reload, the student edits before the V2 snapshot initializes the version tracker.
3. The engine issues a different writeId with client version 1. Later snapshot installation raises future versions but does not repair this already issued command.
4. Backend rejects it as VERSION_COLLISION. The engine quarantines pending commands, removes the visible pending value, and reveals the older confirmed answer/flag.

A collision invokes quarantineAllPending, so other active writes may be affected too. If a low version was never used but is below the current projection, the server's superseded response is another path to the canonical older content replacing the student's current intent.

**Remediation:** same ordering/readiness correction as F1, plus an explicit conflict state that retains the student's draft. Do not bypass server version or session fencing and do not silently label a superseded user intent as successfully saved.

### F3 — High: routine proctor timing changes discard unsent edits from visible/retry state

**Evidence:** epoch-change rollback reproduced in the shared engine; actual runtime control paths inspected.

References:
- backend/go/internal/runtime/service.go:338–375, 385–440, 450–489, 545–571.
- backend/go/internal/attempts/service.go:197–202.
- Engine:230–250, 480–507, 1076–1090, 1152–1179.
- IELTS provider:484–495; SAT persistence hook:230–256 (engine replacement on epoch props).

Pause/resume and time extension call SyncV2TimingInTx, which increments control_epoch. A student write accepted locally under the previous epoch can therefore lose the race with a routine control command. The server correctly fences an old-epoch request, but the client removes that draft from the normal retry ledger and visible pending state. The previous confirmed aggregate becomes visible. Recreated engines similarly quarantine recovered drafts whose epoch differs.

The test establishes: pending new answer + true flag -> control epoch increment -> previous answer + false flag, pendingCount=0, EPOCH_STALE quarantine entry. This does not mean already committed answers are erased by the control SQL. It means unsent student work is removed from normal presentation/delivery.

**Remediation:** distinguish a legitimate control boundary from silent loss. Preserve blocked drafts visibly with an explicit recovery/decision flow. Define which timing-only transitions permit safe reconciliation; retain strict fencing for takeover, termination, section admission, and exam closure. Never automatically relabel stale commands under a new epoch without a safe server contract.

### F4 — High: the latest typing can remain memory-only behind a slow older IndexedDB write

**Evidence:** deterministic slow-storage/engine-teardown witness.

References:
- Engine:298–301, 324–359, 591–604, 1279–1288.
- src/utils/durableDraftStore.ts:95–108.

Although called a synchronous checkpoint, the localStorage checkpoint write is inside persistAcceptedResponse, which runs on a per-question asynchronous acceptance chain. If the previous input's IndexedDB save stalls, a later edit updates the visible state immediately but waits behind that older operation even to write its localStorage checkpoint.

The test stalls the first durable write, accepts newer typing and a flag, and destroys the engine. The checkpoint still contains only the first keystroke. After the old write finishes, the newer queued persistence exits because the engine was destroyed. Refresh/unmount/epoch-driven engine replacement can therefore lose the newer memory-only edit. A page lifecycle handler merely starts an asynchronous flush; it cannot guarantee the browser stays alive to finish it.

**Remediation:** checkpoint the newest accepted intent immediately, independently of prior asynchronous IndexedDB work. Keep asynchronous persistence monotonic and serialized where needed, and make teardown safe for already accepted edits. Test blocked IndexedDB plus rapid input, reload, and engine replacement.

### F5 — High: quarantine may delete the last recovery copy before the archive is durable

**Evidence:** archive-write rejection injected; checkpoint deletion and durable-draft deletion request observed.

References:
- Engine:1152–1191.
- src/utils/durableDraftStore.ts:106–108, 206–236.

quarantineEntry starts saveDurableDraft on a separate quarantine key, ignores its failure, then removes the active checkpoint and requests deletion of the active durable draft. There is no awaited archive-before-delete guarantee or cross-key atomic transaction. If archive persistence fails while deletion succeeds, the rejected answer remains only in the in-memory quarantine list and is lost on refresh. Even a successful archive is not the normal visible/retry state.

The witness proves that rejecting the archive save still removes localStorage recovery data and invokes active-draft clear, without entering durability_fault. It does not emulate a complete physical IndexedDB failure/restart cycle.

**Remediation:** durably commit the quarantine record before deleting the source (prefer a transaction when supported). Retain the original source and surface a storage fault if archival fails. Restore quarantined records into an explicit recovery view after reload rather than treating queue emptiness as resolution.

## What is already protected

- Exact write identity is checked for acknowledgements, and a normal older acknowledgement does not clear a newer pending write.
- Accepted server writes have transactional version/idempotency guards. The audited Go save path uses row-level projection and append-only mutation identities rather than blindly replacing the entire attempt for each keystroke.
- Same-attempt IELTS legacy snapshots omit answer/flag replacement.
- Missing acknowledgements trigger retry rather than immediate queue clearing.
- Existing tests verify some of these protections. They do not cover the recovery-before-version-seeding interleavings reproduced here.

These are useful protections, not evidence of end-to-end immunity from loss.

## Verification artifacts and commands

Added:
- src/shared/durability/__tests__/studentStateLoss.audit.test.ts — five focused failure-path witnesses.
- src/components/student/providers/__tests__/StudentAttemptProvider.stateLoss.audit.test.tsx — real IELTS provider answer+flag rollback witness.

**Important:** these are characterization/audit witnesses. They intentionally assert the unsafe CURRENT behavior so a passing result proves reproducibility, not a fix. During remediation replace/invert them into preservation regressions; do not retain unsafe expectations as the desired specification.

Final focused frontend run: **27 tests passed across 5 files**, including all **6 new audit witnesses** (exit code 0).

Run:

```sh
npx vitest run \
  src/shared/durability/__tests__/studentStateLoss.audit.test.ts \
  src/components/student/providers/__tests__/StudentAttemptProvider.stateLoss.audit.test.tsx \
  src/shared/durability/__tests__/DurableResponseEngine.test.ts \
  src/shared/durability/__tests__/DurableResponseEngine.debounce.test.ts \
  src/components/student/providers/__tests__/StudentAttemptProvider.v2.test.tsx
```

Backend verification: go test ./internal/attempts ./internal/runtime succeeded (Go reported cached results). These are unit/package tests, not live MySQL or browser E2E evidence. No full-suite, deployed build, physical browser lifecycle, or live production verification was performed.

## Incident triage: preserve evidence before retrying

For a concrete student incident, capture the following through authorized support tooling:
1. Attempt ID, schedule ID, affected question/task IDs, approximate time/timezone, provider, deployed build version, and browser/device.
2. Was there a reload, reconnect, proctor pause/resume/extension, section transition, or another-tab/device takeover immediately beforehand?
3. Preserve the affected browser profile/storage before clearing site data, logging out, taking over, or asking the student to repeatedly reload. Relevant keys include response-checkpoint:v2:*, durable drafts v2_attempt_*, and v2_quarantine:* in warwick_durable_drafts_v1 (or its localStorage fallback).
4. Correlate V2 batch/snapshot requests and VERSION_COLLISION, CONTROL_EPOCH_STALE, LEASE_FENCED, superseded outcomes, and missing acknowledgements with control events and the server mutation ledger.
5. Compare the last confirmed server projection with locally retained pending/quarantined payloads. Do not automatically replay drafts across terminal or security fences.
6. Distinguish: (a) UI rollback with draft still recoverable, (b) write rejected/not submitted, (c) confirmed server response replaced by a later accepted command, and (d) permanent loss of all durable copies.

Do not put raw answer text or student identifiers into general telemetry. Use scoped diagnostics with appropriate access and retention controls.

## Recommended repair order

1. Fix shared recovery/version initialization (F1/F2) while preserving typing durably during startup.
2. Move latest-intent checkpointing ahead of slow asynchronous storage (F4).
3. Make quarantine archival safe before deletion (F5).
4. Define and implement user-visible handling of routine control changes versus terminal/session fences (F3).
5. Add browser/E2E coverage for IELTS and SAT: slow snapshot + existing pending draft; reload + previously saved question; simultaneous answer/flag changes; stalled IndexedDB + navigation/reload; pause/resume/extension while typing/offline; full storage during quarantine; submission boundaries; and multi-tab takeover.

The fixes should preserve exam integrity as well as student work. Reducing debounce alone, disabling freshness checks, or blindly replaying all local drafts would not address these causes safely.
