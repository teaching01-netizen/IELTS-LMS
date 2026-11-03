# 08: Production-shaped parity baseline (human)

**What to build:** Run the grading parity harness against a dedicated database containing production-shaped IELTS submissions, before and after the hardening fixes. Save the reports, record the summary, and confirm the final replay shows zero mismatches. This closes the remaining part of the original parity harness ticket.

**Blocked by:** 02, 03, 04, 05, 06

**Status:** needs-human

- [ ] The harness runs against a dedicated parity database, never the production clone.
- [ ] The before report is saved and its affected-student/question summary is recorded.
- [ ] The final replay report shows zero Go-versus-website mismatches.
- [ ] Released submissions are included in the baseline and confirmed after the released-result correction.
- [ ] The result is recorded in the original parity harness ticket.

## Implementation note

A dedicated temporary MySQL instance was used for integration tests and a database-mode harness smoke run (`0 submissions`, `0 mismatches`). The production-shaped baseline still needs a copy of real IELTS submissions; the local production clone must not be used.
