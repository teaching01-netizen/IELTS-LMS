# Student Check-in: Nickname + IELTS Course

## Summary
The student **Exam Check-in** (registration) flow collects two additional required fields:

- `nickname` (1–50 chars after trim)
- `IELTS Course` (free text, non-empty after trim)

These fields are accepted by `POST /api/v1/auth/student/entry`, validated server-side, and persisted into `schedule_registrations.metadata` JSON.

## Ownership & Boundaries
- **Frontend (student check-in UI):** `StudentEntryRoute`
- **API contract + validation:** `auth::student_entry` route
- **Persistence owner:** `SchedulingService::create_student_registration` (table: `schedule_registrations`)

No new inter-module imports; API passes data into the Scheduling application service.

## API / Contract Changes
`StudentEntryRequest` adds:
- `nickname: string`
- `ieltsCourse: string` (serialized from Rust field `ielts_course`)

Server-side validation:
- Reject empty `nickname` or `ieltsCourse` with `422 VALIDATION_ERROR`.
- Reject nickname longer than 50 chars (counted by Unicode scalar values).

## Persistence
Store values in `schedule_registrations.metadata`:

```json
{
  "nickname": "Ace",
  "ieltsCourse": "IELTS Course - Intermediate"
}
```

Updates are **idempotent**: on repeat check-in for the same user/registration, the metadata keys are overwritten with the latest submitted values.

## Non-goals / Invariants
- Identity locking remains unchanged: `student_name` + `email` stay authoritative for `schedule_id + wcode`.
- `nickname` / `IELTS Course` do **not** participate in locking or conflict checks.

