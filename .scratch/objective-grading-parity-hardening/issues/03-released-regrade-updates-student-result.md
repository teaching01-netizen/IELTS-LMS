# 03: Released regrade updates the student-visible result

**What to build:** The audited "regrade released" action corrects the result students and teachers actually read, not just the stored section grading snapshot. After the action, the released result's objective section bands and overall band reflect the corrected scores, while writing, speaking and teacher comments are preserved. The audit entry continues to record each submission's old and new score.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] After an audited released regrade, the student result view shows the corrected objective band and overall band.
- [ ] The teacher result dashboard shows the same corrected band.
- [ ] Writing, speaking and teacher summary content are unchanged.
- [ ] The released result remains released and receives a new version rather than mutating history in place.
- [ ] The audit entry still records actor, time, schedule and each submission's old/new scores.
- [ ] Normal regrade behaviour for unreleased results is unchanged.

## Implementation note

Released regrade publishes a new `student_results` version with recalculated listening/reading bands and overall band, preserving writing/speaking/summary, and writes a `regraded_released` release event. Unit band tests pass, and `TestIELTSReleasedRegradePreviewAndApply` passed against a dedicated MySQL instance: the new `student_results` version carries reading band 7 and overall band 7, preserves writing/summary, and writes one `regraded_released` release event.
