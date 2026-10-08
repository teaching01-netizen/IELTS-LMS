# SAT device transfer

Use this runbook when a candidate's original browser is unavailable or a competing device is blocked. Preserve the current owner and its local answers until the transfer decision is explicit.

## Operator workflow

1. Identify the schedule and attempt in the SAT room. Verify the candidate and the intended destination device. A display name or email alone does not establish ownership.
2. Inspect answer-save status on the original device if it is available. Drain outstanding saves and check the authoritative V2 response snapshot. Locally held answers may remain unconfirmed; tell the proctor before approving a transfer.
3. The destination device requests a device change. Before testing starts, the current owner can confirm where policy permits. Once testing has started, use the assigned proctor's approval flow and explicitly acknowledge outstanding-answer risk.
4. Commit the approved transfer from the destination. If its response is lost, retry/recover the same transfer rather than creating a new ownership change. The recovered credential must carry the same committed writer lease.
5. Verify that the destination resumes the existing module deadline and can save an answer. Verify that the original credential is fenced. A transfer must not reset time or create another module or route.
6. If approval expires, is denied, or is cancelled, the original owner remains authoritative. If commit rolls back, retain that owner and recover the outstanding request. Do not edit writer lease/session columns directly.

Same-browser tabs share local storage and a writer identity. Close the extra exam tab or use its retry action after the current tab closes. Browsers without Web Locks cannot safely enter the writer surface; use a supported secure-context browser.

## Investigation and validation

Correlate transfer IDs, attempt IDs, old/new lease epochs, request IDs, and structured rejection reasons. Do not copy bearer tokens or answers into incident tickets. Check `sat_device_transfer_total` and the room's persisted transfer state. Review late-answer evidence separately if the old device reconnects after its module closed.

Run the real-database ownership regressions against a disposable migrated schema:

```sh
cd backend/go
TEST_MYSQL_DSN="$SAT_REHEARSAL_DSN" go test ./integration -count=1 -v \
  -run '^TestSATTransfer|^TestTakeoverReplayAfterLostResponseIsOwnerOnly$'
```

For burst rehearsal, use `k6/sat-device-transfer.js` on an isolated staging schedule with synthetic candidates and authorized staff credentials. Run it alongside `k6/sat-exam-day.js` on a disjoint student slice. Set `K6_CONFIRM_SAT=true` explicitly. Competing-entry authorization, stale-owner accepted writes, and duplicate ownership changes must stay at zero. A script completing does not replace checking the persisted owner and response state.
