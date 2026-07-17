# Student Footer and Viewport Design

## Goal

Give reading and listening exams more usable vertical space and keep the footer at the bottom of the visible iPad browser area.

## Ownership

- `StudentFooter` owns objective-exam progress and question navigation.
- `StudentApp` and the shared student exam CSS own the viewport-height contract.
- Answer counting remains owned by `examAdapterService`; this change only repositions its displayed result.

## Design

The objective footer becomes one row. Question and part navigation remains horizontally scrollable on the left. The overall answered count, such as `0/40`, remains visible on the right and does not scroll with the question chips. The tablet footer no longer renders a Finish button; non-tablet layouts retain it beside the count so manual submission remains available.

The exam shell height will be the larger of the session's protected viewport height and the current dynamic viewport height. This preserves the existing protection against temporary viewport shrinkage from an iPad keyboard or pinch gesture, while allowing the shell and footer to move down when Safari exposes additional vertical space. The footer remains part of the exam flex layout rather than being independently fixed over exam content.

## Invariants

- Question and part buttons retain their current navigation behavior and accessible labels.
- Desktop manual submission behavior remains available and unchanged.
- The answered count continues to use `countAnsweredQuestions` and `countQuestionSlots`.
- Temporary visual-viewport shrinkage must not move the footer upward during an exam.
- A visual-viewport increase must not leave blank space below the footer.
- No submission, autosave, timer, answer, or audit behavior changes.

## Verification and Repository Memory

- Add a `StudentFooter` regression test proving that the answered count shares the navigation row and that Finish is absent.
- Add or update the iPad viewport test to prove that the effective shell height can grow with the visible viewport while remaining protected from shrinkage.
- Run the focused student footer and student app test files, then run the relevant type or build check if available.
