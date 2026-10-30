# Exam continuity: executed evidence

Date: 2026-10-29, Asia/Bangkok. Local checkout, Go 1.26.3, MySQL 9.6.0. An isolated temporary MySQL data directory and Unix socket were created for this investigation. The application migration runner applied migrations through `0111_persistent_staff_sessions.sql` successfully. No production services or data were used.

## Executed results

Counts below are Go named test **and subtest** pass events, not unique independent assertions. Counts across runs overlap and must not be summed as distinct coverage. Machine-readable package/test results: [test-results.json](test-results.json).

| Run | Named passes | Failed | Skipped | Meaning |
| --- | ---: | ---: | ---: | --- |
| Backend baseline: auth, attempts, delivery, terminalization, crypto, API | 1213 | 0 | 156 | Existing logic regression coverage; MySQL-dependent tests skipped in this first run |
| Selected existing suites with real MySQL | 51 | 0 | 0 | Transfer, completion/timeout serialization, account session policies, late evidence, staff recovery, and multi-process recovery |
| New continuity characterization with real MySQL | 17 | 0 | 0 | Focused reproduction of authorization gaps, SAT/IELTS receipts, API process kill/restart, and IELTS deadline preservation |
| Race-enabled continuity + concurrent transfer/submit suites, real MySQL | 20 | 0 | 0 | Go race detector on test processes; child API binaries use their normal build |

A passing characterization can demonstrate an existing gap. In particular, some tests intentionally assert today's rejection or inadequate revocation behavior. They must be changed to assert the desired contract when implementation lands; their current passing state does not certify the proposed design.

## What was demonstrated

| Scenario | Observed outcome | Test owner |
| --- | --- | --- |
| Login expired, bearer valid | HTTP save 200 and answer persisted; credential refresh 401 `SESSION_EXPIRED` | `TestExamContinuityExpiredLoginStillSavesButCannotRenewMySQL` |
| Both login and attempt token expired | Further save 401; previously accepted answer remains stored | Same test |
| Live login cookie + valid bearer, missing CSRF | 403 `CSRF_REJECTED`; same bearer without cookie saves 200 | `TestExamContinuityAmbientCookieAddsCSRFGateMySQL` |
| Same browser credential rotated | Old credential is cryptographically valid/unexpired but HTTP save 401; replacement saves 200 | `TestExamContinuityRenewalInvalidatesUnexpiredBearerMySQL` |
| Account logout-all or disable, bearer-only request | Save still returns 200: account-level revocation is not exam-grant revocation | `TestExamContinuityAccountRevocationDoesNotRevokeAttemptMySQL` |
| Submit committed, first response treated as lost | Recreated service returns original receipt/digest; one receipt and one seal, SAT and IELTS | `TestExamContinuityLostSubmitReceiptSurvivesServiceRecreationButNotExpiredBearerMySQL` |
| Same submission after token expiration | Credential 401; committed receipt/seal remain stored | Same test, injected clock +3 hours |
| Actual API process killed after commit and restarted | Identical submit request succeeds from new process with same DB/signing key; same digest, one receipt/seal, SAT and IELTS | `TestExamContinuityReceiptAcrossKilledAPIProcessMySQL` |
| IELTS answer window closed | New answer rejected with section/deadline error; earlier committed B remains B | `TestExamContinuityIELTSDeadlineKeepsCommittedAnswerMySQL` |
| Old browser after transfer, racing admission/transfer | Existing real-MySQL fencing and single-writer tests pass | `integration/sat_device_transfer_test.go` |
| Multiple API/worker processes, lost/duplicate hints | Two API + two worker processes converge on persisted recovery state | `TestSATRecoveryTwoAPITwoWorkerProcessesRecoverLostAndDuplicateHintsMySQL` |
| SAT past deadline while worker behind / late evidence | Late normal save rejected; separate late-evidence storage/deduplication tested | `TestSATSavePastDeadlineAndGraceIsRefusedWhileTheWorkerIsBehind`, `TestSATLateEvidenceMySQL` |

The restart test obtains the first response to establish a comparison, then treats it as lost and retries after process termination. It does not physically drop an ACK packet or kill during an unknown commit outcome. Receipt retry/idempotency is demonstrated; transport-level ACK loss remains a staging fault drill.

## Reproduction

From `backend/go`, with `TEST_MYSQL_DSN` pointing only at an isolated migrated MySQL database:

```sh
go test ./internal/auth ./internal/attempts ./internal/delivery ./internal/terminalization ./internal/platform/crypto ./cmd/api -count=1 -json

go test ./integration ./internal/auth ./cmd/api -count=1 -timeout=240s -json -run 'Test(SATTransfer|ConcurrentSATClientSubmit|SATCompletion|SATRecoveryTwoAPI|StaffDeviceRecovery|AuthMiddlewareRejects|LoginPolicyPersistence|LookupLockedAdmission|.*LateEvidence.*|.*Deadline.*|.*SubmitReplay.*|.*Continuity.*)'

go test ./cmd/api -count=1 -timeout=180s -run TestExamContinuity -json

go test -race ./cmd/api ./integration -count=1 -timeout=180s -run 'Test(ExamContinuity|SATTransferConcurrent|ConcurrentSATClientSubmit)' -json
```

The new test file is `backend/go/cmd/api/exam_continuity_mysql_test.go`; it uses existing production service wiring, fixture helpers, and the real API binary. It skips clearly if an isolated `TEST_MYSQL_DSN` is not supplied. No production implementation was modified in this investigation.

## Not demonstrated

- Four-hour real-browser sitting, iPad sleep, browser reload, or proxy/domain cookie behavior.
- Production deployed version/settings, request volume, database capacity, latency SLOs, or an entire-fleet rolling deployment.
- Actual network partition across closure, packet-level lost ACK, or process death at every commit instruction boundary.
- Recovery of an answer never sent when all device storage copies are lost.
- The proposed longer-lived grant, revised revocation, new receipt endpoint, or provider-neutral IELTS late evidence: those remain implementation work.
