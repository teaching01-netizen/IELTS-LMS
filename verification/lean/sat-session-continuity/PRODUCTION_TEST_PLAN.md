# Production test plan

Goal: upgrade Production evidence from PARTIAL to OBSERVED.

## 1. Deploy check (before the next exam)
- Railway active deployment = `71fab6d6` or later.
- On one student iPad/browser after entry: DevTools → Application → Cookies → `__Host-session` expires ≈ 12 h after entry, not 1 h.

## 2. Long mock sitting (one room, 2 devices, one of them an iPad)
1. Create a mock SAT room with the real prod config (do not change `SESSION_IDLE_STUDENT_MINS`).
2. Enter, answer a few questions every ~10 min, and stay in the exam > 90 min (past idle + ttl = 75 min, the old failure point).
3. Pass: no "Time is up" overlay stall, module closes on time, results show every answer.

## 3. Log checks (Railway logs, during and after the sitting)
- Zero `401` with `"actor":"anonymous"` on `/api/v1/student/…` and `/api/v1/assessment/…` routes for a student who did not close the tab.
- No repeating `GET /student/sessions/{id}` + `POST …/bootstrap` 401 pairs.

## 4. Database checks after the sitting
```sql
-- closes should be on time (close_at - deadline ≈ 0 s, not the 15 s server close window)
-- late answers should be 0 for students who stayed online
SELECT COUNT(*) FROM assessment_late_answer_evidence WHERE created_at > '<sitting start>';
```

## 5. Fault drills (optional, staging)
- Turn the iPad offline for 2 min mid-module, then back online → answers sync, no loss (G3).
- Reload the page mid-module → answers restored from the device (Step.reload).
- Offline across module close → answers appear as late evidence for proctor review (G5).
