# SAT module handoff and answer recovery

Use this runbook for route-lag, client-start-lag, auto-start, module rejection, or late-answer route-risk alerts. Correlate by schedule, attempt, module attempt, and request ID. Keep student answers and credentials out of incident logs.

## Authority and timing

The database owns accepted responses, clocks, route decisions, and close receipts. Answer writes and module closure serialize on the attempt row. A committed route must not be changed after its selected module has been administered.

The student response protocol is:

- `GET /api/v2/student/attempts/{attemptId}/responses`
- `POST /api/v2/student/attempts/{attemptId}/responses:batch`
- `POST /api/v2/student/attempts/{attemptId}/submit`

Use an authoritative snapshot's lease and control epochs. Retry an uncertain save with the same write IDs, versions, and answer content. A conflict is not an acknowledgement. A snapshot must confirm the intended final write, version, and answer.

For personal `client_start` sessions, `POST /api/v1/assessment-delivery/schedules/{scheduleId}/modules/close` carries the module and module-attempt IDs, a stable close ID, and an exact final-write manifest. `CLOSE_WRITES_PENDING` means the manifest has not been persisted; drain those saves before retrying. Retry the same committed close intent with the same close ID. A changed manifest is a different intent and requires a new close ID.

The normal save-only grace is 3 seconds. Personal client-start sessions use `SAT_PERSONAL_CLOSE_WINDOW_SECS`, 15 seconds by default. A confirmed close can route earlier. An unsent browser answer cannot prove a pre-deadline click; after closure it is evidence, not a canonical save.

## During an incident

1. Check API and worker health, database connection wait/in-use, failed save rates, transaction retries, and worker `sat_personal_timeout_reconcile`/`sat_timeout_reconcile` failures. Distinguish delayed routing from a wrong branch.
2. Check the affected module's state, deadline, pause/extension state, and the stored route decision. Check `sat_module_close_total`, `sat_close_writes_pending_total`, `sat_route_lag_seconds`, and `sat_module_scoped_rejection_total`.
3. If the module is still open, recover outstanding saves using the current owner. Do not transfer ownership merely to retry a lost acknowledgement. If the API response was lost, recover through the same write/close identity or an authoritative snapshot.
4. If the module is closed, keep its answers in the late-evidence path. Use the staff late-evidence review surface/API to inspect and record a review outcome. Never insert the evidence into canonical response rows or manually reroute the student. An alert that evidence would change the route requires a documented proctor decision about the sitting.
5. If the worker stopped, restart its normal reconciliation lane after database health recovers. Request reads also reconcile attempts. Verify progress through persisted module/terminal facts; do not rely on a successful heartbeat alone.
6. If final submission fails, retry the same submission intent and check the authoritative terminal receipt. Final-module closure and sealing must either commit together or roll back. Escalate persistent failures with IDs and structured error reasons.

## Deployment and rehearsal

Keep API and worker handoff-window configuration identical throughout an active sitting. Runtime handoff mode is stored, but close-window duration is process configuration. Do not change that duration in a rolling deployment while exams are active.

The automated real-HTTP regression runs against a disposable, migrated database:

```sh
cd backend/go
TEST_MYSQL_DSN="$SAT_REHEARSAL_DSN" go test ./cmd/api -count=1 -v \
  -run '^TestSATCommittedSaveSurvivesAPIKillAndConcurrentCloseMySQL$'
```

It kills an API after commit before the acknowledgement, retries through fresh processes, races close replays, verifies one route/receipt and exact database answers, saves in Module 2, and runs a 20-candidate wave sharing one runtime. This is a correctness rehearsal, not a production capacity claim.

With k6 installed, set `SAT_REHEARSAL_K6=1` on the same command to run the actual handoff script through a round-robin proxy to the two API processes. The test seeds the synthetic credentials and deadlines, delays final packets until 250 ms after zero, and checks database answers and branch counts independently after k6 completes. Credentials stay in a temporary file with mode 0600.

Use `k6/sat-m1-m2-handoff.js` for a larger synchronized boundary wave and `k6/sat-exam-day.js` for the full sitting. Supply one synthetic admitted credential per candidate and an isolated schedule. The handoff fixture's deadline must match `K6_WAVE_AT_MS`; final answers must cross a known routing threshold. Scripts use V2 batches and check stored exact answers, rather than treating 409 as success. Save the k6 summary, worker/API versions, database version, pool limits, cohort size, and server-side invariants with each rehearsal.

Completed test fixtures have immutable terminal receipts. Drop the disposable test schema when finished; never disable immutability triggers to clean up a shared or application database.
