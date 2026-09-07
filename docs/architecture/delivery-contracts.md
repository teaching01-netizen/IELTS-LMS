# Delivery Contracts (frozen revisions gate parallel work)

No frontend/backend pair implements against these boundaries until the stated revision is frozen and published here.

## Answer / acknowledgement contract

- Legacy: serverAcceptedThroughSeq = N means acceptance of the required contiguous prefix, not the highest sequence observed. If coalescing removes intermediate sequences, the resolution rule must be stated per product (Wave 2.3).
- V2: per-write ResponseAcknowledgementV2 with writeId, questionId, clientVersion, outcome (applied | duplicate | superseded), serverRevision, canonicalResponse, contentHash. Reusing one identity with different content is rejected. Visible answer is pending-first via getVisibleResponse (display only).
- Persist unsent local changes promptly; debounce transport separately.
- Answer-state compaction is separate from forensic history retention.

## Save-status vocabulary (UI must use exactly these)

| UI status | Evidence required |
| --- | --- | --- |
| Saving on device | Local persistence pending (AttemptSyncState saving, V2 saving) |
| Saved on device | Local persistence completed (saved, saved_locally) |
| Syncing | Server acknowledgement pending (syncing_reconnect, saving) |
| Saved to server | Server acknowledgement received (idle + seq, synced) |
| Needs attention | Persistence or delivery needs intervention (error, offline, durability_fault, conflict_*) |

Browser storage has quota/eviction constraints: detect failures, assess availability, never promise unconditional device durability.

## Submission contract

- Barrier: evaluateSubmissionBarrier returns ready, then coordinator order commitAll > flushDurability > flushPending > submit.
- Idempotent submit references a final-mutation boundary (V2 SubmitAttemptV2Request: submissionId, leaseEpoch, controlEpoch, finalCommands, expectedAttemptRevision); server verifies required mutations, finalizes atomically, returns a durable receipt (submissionId, attemptRevision, finalResponseDigest, submittedAt, acknowledgements).
- Ambiguous network failure retries or queries the same submission identity. Replay misuse returns HTTP 409 + existingSubmissionId.
- Submission pending is not submitted.
- D1 (open): offline edits after the deadline - acceptance, grace, or review. Client timestamps are not proof; backend + exam policy decide.

## Timing contract

- Authoritative inputs: server deadline (+ revision) and server-time estimate; display anchored via monotonic elapsed time (useAuthoritativeDeadlineClock); never a decrementing counter as truth.
- Refresh after reconnect, visibility restore, device wake; reject stale deadline revisions. Pause, extension, and section changes route through the runtime machine.
- Device clock changes cannot extend server acceptance.

## Recovery / takeover contract

- V2 snapshot carries attemptRevision, leaseEpoch, controlEpoch, deadlineAt, closingGraceUntil (see v2SnapshotHandler in backend/go/cmd/api/handlers_v2.go).
- Same-browser tabs coordinate; server enforces authority via ownership generations (lease/control epochs + fencing in backend/go/internal/attempts/submit.go). Stale ownership is rejected; rejected queued work is preserved for defined recovery or review with an explicit takeover flow. D2 (open): allowed active-device policy.

## Error contract

- Stable failure codes, user-safe messages, retryability, logging behavior, and the layer translating failures into transport responses: defined per boundary before Wave 1 fixes land. Never silently swallow failures; never expose internal exceptions to candidates.
