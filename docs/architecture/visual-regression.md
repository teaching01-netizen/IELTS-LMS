# Visual Regression Baseline Spec (plan section 115)

The frontend rule is additive-only: no visual output changes without
explicit product approval (doctrine 19). This spec fixes WHAT to
capture and HOW to judge a diff, so the V2-only flip and any later
structural change can prove no-visual-change.

## Baselines (same data fixture for all)

Capture before the change, compare after:

- student desktop, student tablet, student mobile;
- SAT student, ACT Science, IELTS writing;
- builder, SAT authoring, ACT builder;
- proctor, grading, results.

## Method

- Existing screenshot specs (`e2e/student-interaction-motion.spec.ts`,
  `e2e/student-security.spec.ts`, viewport ATDD) already assert
  `toHaveScreenshot`; extend that pattern per surface above rather
  than inventing a second harness.
- Same fixture, same viewport set, same browser build for both runs.
- Gate in CI review: any diff requires explicit review,
  classification (intentional vs accidental), and intentional
  approval recorded on the PR.

## Standing (honest)

No fresh baseline run is recorded this session: baselines require a
running frontend + API pair, and the Go API is still being wired.
The V2-only frontend flip must capture baselines first and attach
the comparison to its PR (see review-checklists.md UI section).
