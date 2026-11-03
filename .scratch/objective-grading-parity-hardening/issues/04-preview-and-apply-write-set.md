# 04: Preview and apply cover the same writes

**What to build:** A regrade preview lists exactly the writes its action will perform. The preview scope matches the action it feeds: the normal preview covers unreleased submissions, and the released preview covers released submissions. The preview token covers every planned section write, including integrity-only changes that do not alter an individual question score. A normal regrade immediately after an unreleased preview changes exactly what the preview listed, and repeating an apply is a no-op.

**Blocked by:** 03 (released regrade updates the student-visible result)

**Status:** done

- [ ] The normal preview uses the unreleased scope; the released preview uses the released scope.
- [ ] The preview token invalidates when any planned section write changes, including integrity-only changes.
- [ ] A normal regrade immediately after an unreleased preview changes exactly the submissions and questions the preview listed.
- [ ] Repeating a released apply with a fresh preview changes nothing and writes no extra audit event.
- [ ] Tests cover an integrity-only change and a stale-token rejection.

## Implementation note

Normal preview now uses the unreleased scope; the preview token hashes every planned section write including integrity-only diffs and excludes volatile `generatedAt`. Token unit tests pass. The dedicated-MySQL integration test passed: an unreleased preview excludes the released row, a stale token is rejected, and a repeat apply creates no new result version or audit event.
