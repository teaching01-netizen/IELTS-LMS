# Recommendations

| ID | Recommendation | Why | Effort |
|---|---|---|---|
| R1 | Staff-assisted device transfer: a proctor action to re-bind an in-progress attempt/registration to a new device user. At minimum, replace the raw message "Wcode … is already registered for this schedule" with "This exam is open on another device. Ask your proctor." | F3: a student whose iPad dies, or whose browser storage is cleared, cannot get back into the sitting (409 at `schedules/service.go:1228`). Open links silently start a new attempt instead. | Medium; needs a product decision on identity checks. |
| R2 | Exponential backoff with jitter (cap ~30 s) on the student session GET + bootstrap retry after 401. | F4: 80 req/min per stuck student. Bandwidth was not the cause, but this multiplies load during an incident. | Small |
| R3 | In the late-evidence review screen, mark evidence whose `writeId` already exists in `attempt_responses_v2` as "already scored". | F5: a lost ACK before close shows the same answer twice. | Small |
| R4 | Keep a production alert: rate of `401` from `actor=anonymous` on student/assessment routes > N/min during a scheduled sitting. | Early warning for this whole class (cookie, proxy, domain changes). | Small |
| R5 | Run E2E with production auth timings (`SESSION_IDLE_STUDENT_MINS=60`, `ATTEMPT_TOKEN_TTL_MINUTES=15`), using a time-compressed variant (1 / 1) in CI. | `playwright.config.ts` sets idle = 600 min, which is why tests never caught F1. | Small |
| R6 | Rotate the secrets pasted in chat (prod env dump). | They are now in a chat transcript. | Small |
