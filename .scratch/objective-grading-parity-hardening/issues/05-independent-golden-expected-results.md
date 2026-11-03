# 05: Golden expected results are independent and cover overrides

**What to build:** The full-coverage parity exam's expected results are an independently reviewed golden file, not an automatic snapshot of the website grader. Regenerating the fixture cannot silently rewrite the expectation; an explicit update path makes the change reviewable. Both graders must match the golden file, and the file includes the grouped-slot and tree-root override cases.

**Blocked by:** 02 (grouped-slot and tree-root overrides score identically)

**Status:** done

- [ ] The expected-results file is checked in and reviewed independently of either grader's output.
- [ ] The fixture builder refuses to overwrite the expected file without an explicit update flag, and the diff is reviewable.
- [ ] Go and website tests both compare against the same golden file.
- [ ] A missing, stale or drifted expected file fails CI.
- [ ] The golden file includes grouped-slot and tree-root override cases.

## Implementation note

The fixture builder regenerates expected results from the Go grader only, preserves the checked-in golden by default, and `--check` fails on drift. CI runs `--check`. Verified drift exit 1 and restored exit 0.
