# SAT session continuity and answer retention — specification

## Incident this targets
15 Oct (prod, `ielts-warwick-institute.up.railway.app`): SAT students stuck on "Time is up — your saved answers are being recorded"; module 2 answers missing.
Root cause: the student session cookie had `Max-Age = min(absolute, idle) = 60 min` and was never re-sent. The browser dropped it 60 min after entry, so the attempt bearer (15 min) could no longer be refreshed. Every save, state and close call then got 401.
Fixes: `bc87947a` (cookie lifetime = absolute deadline) and `71fab6d6` (middleware re-issues the student cookie on every authenticated request).

## Guarantees (business language)
| ID | Guarantee | Lean theorem |
|---|---|---|
| G1 | A student whose browser talks to the server at least every `gap` seconds stays logged in. Every save/state/close call is accepted until the 12 h absolute session deadline, provided `touch + gap < idle`. Prod: gap = 5 min is enough; measured client traffic is ≈ 27 requests/min. | `active_student_always_served`, `prod_active_student_always_served` |
| G2 | (Old behaviour, as a check that the model can show the bug.) With the old cookie policy, every request from `entry + idle` on is unauthenticated, and every save from `entry + min(abs, idle) + ttl` (75 min in prod) on is rejected, **no matter how active the student is**. | `idleBound_logs_out_active_student`, `idleBound_rejects_saves`, `old_policy_fails_three_hours` |
| G3 | Once an answer is durably accepted on the device, no later event deletes it: 401, 5xx, timeout, offline, lost ACK, reload, module close or late upload. | `Retention.answer_never_silently_lost` |
| G4 | After module close, every answer the server accepted, and every answer the student saw as saved (ACK), is in the scoring snapshot. | `Retention.saved_answer_scored` |
| G5 | Every answer the student made is scored, or pending on the device, or quarantined as late evidence on the device. A lost ACK can make it both scored and quarantined: a duplicate, never a loss. | `Retention.answer_accounted`, `Retention.ackLost_then_closed_is_duplicate` |

## Click vs server acceptance
"Answer accepted" in G3/G5 means **durably accepted on the device** (`acceptResponse` resolved: checkpoint + IndexedDB). "Saved" in G4 means **server committed** (row in `attempt_responses_v2` / an ACK). A click whose local durable write failed is outside G3; the engine reports `durability_fault` for it instead of a saved state (existing test "reports durability_fault and never a false saved state").

## Out of scope (not proved)
- That students re-entering from a different device or cleared browser storage can recover. They currently cannot; see RECOMMENDATIONS R1.
- Network liveness: an iPad offline past module close keeps its answers as late evidence, and they are not scored automatically.
- Revocation: logout-all, password reset, or a staff kill of the session during a sitting.
- Grading/scoring after the snapshot (covered by `sat-finish-score`, `sat-score-conversion`).
