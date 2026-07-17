# Student Exam Page Zoom Guard Design

## Goal

Prevent native iPad Safari pinch zoom from enlarging and cropping the entire exam interface while preserving the exam's own accessibility and media zoom controls.

## Ownership

- `StudentApp` owns the lifecycle of browser policies that apply only while the student is in the exam phase.
- A focused student utility owns reading, applying, and restoring the viewport meta policy.
- `StudentZoomableMedia` continues to own image, map, chart, and diagram enlargement through its explicit modal controls.
- `StudentUIProvider` and the reading/listening content surfaces continue to own deliberate accessibility zoom.

## Design

When the effective phase enters `exam`, the app stores the current viewport meta content and replaces it with an exam policy containing `width=device-width`, `initial-scale=1`, `maximum-scale=1`, and `user-scalable=no`. Updating the policy at exam entry asks Safari to return the page to its normal scale and prevents subsequent whole-page pinch zoom.

The exam lifecycle also installs non-passive guards for Safari gesture events and multi-touch movement as defense in depth. The guard prevents only gestures involving two or more touches; one-finger scrolling, text selection, answer entry, split-pane controls, and ordinary taps remain unchanged. Because native page pinch is disabled at the viewport level, dedicated media zoom remains button-controlled through the existing modal and does not depend on browser pinch.

When the exam phase ends or `StudentApp` unmounts, the exact original viewport meta content is restored. The policy must not leak into login, briefing, waiting-room, admin, or other non-exam screens.

## Invariants

- Exam-wide native pinch zoom cannot crop the header, content, or footer.
- The viewport meta tag is restored exactly after leaving the exam.
- One-finger exam scrolling and touch interaction remain available.
- Accessibility text/content scaling remains available through existing app controls.
- Image and diagram zoom remains available through `StudentZoomableMedia` controls.
- Answer persistence, submission, timer fairness, and audit behavior do not change.

## Verification and Repository Memory

- Add focused tests for applying and restoring the exam viewport policy.
- Add a test proving multi-touch movement is prevented while single-touch movement is not.
- Run the focused zoom-guard tests plus relevant `StudentApp` viewport tests.
- Run scoped lint and patch-hygiene checks; report unrelated repository-wide failures separately.
