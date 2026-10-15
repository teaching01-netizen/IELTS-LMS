# Assumptions and unknowns

| ID | Assumption | Owner / anchor | Validation | Criticality |
| --- | --- | --- | --- | --- |
| A-1 | `classroomRaw` is authoritative for the displayed report and is supplied only on a released result. | `SatScoreReport.tsx` `classroomReport`; Go student result projection | Existing `verification/lean/sat-result` release model and tests; this project's component tests start from a released report. | High |
| A-2 | `converterVersion` is the signal that a converter was configured for this result; blank or malformed values mean no converter. | Go `satscoring.ApplyRevision`; TS `buildStudentScoreReportView` | Backend writes the active converter version; Vitest covers blank and malformed metadata. No mechanized TS refinement. | High |
| A-3 | Accepted score intervals are finite integer values, on 10-point steps, bounded to 200–800 for sections and 400–1600 for totals. | Go `satconvert.checkScore` and `satconvert.Total`; TS `estimate` | Go tests plus new TypeScript cases for fractions, off-step intervals, bounds, and inversion. | High |
| A-4 | Raw correctness values are nonnegative integer counts with `correct <= total`. | Released `classroomRaw.sections[]`; TS `validRaw` | TypeScript tests cover fractional, negative, and over-total section counts. | High |
| A-5 | Module/domain rows in the Lean input are the already-filtered rows that the view model exposes. | TS `buildModules` / `buildDomains` | Component and view-model tests cover normal rows and malformed/duplicate rows. Lean does not prove the filtering algorithm. | Medium |
| A-6 | `converterPresent` in the model is the normalized result of checking a nonblank string. | TS converter metadata normalization | Blank/whitespace and malformed runtime values have regression tests. JS `trim` semantics are not mechanized. | Medium |
| A-7 | The Go adaptive router receives an integer raw score in `[0, operationalCount]`; the threshold is validated in `[1, operationalCount]`. | `delivery.chooseAdaptiveRoute` | Go boundary tests exercise 0, 12, 13, 14, and 25 correct at threshold 13 of 25. | Medium |
| A-8 | A server-provided `totalScaled` is authoritative and only emitted when both SAT sections have compatible converted full-route topologies. | Go `satscoring.ApplyRevision` and `satconvert.Total` | Existing Go conversion tests; the UI model checks range/step and requires valid section estimates before showing it. Route topology is not modeled here. | High |

## Unknown production facts

| ID | Unknown | Why it matters / resolution |
| --- | --- | --- |
| U-1 | The exact deployed frontend/backend revision pair and active converter configuration. | Confirm in the release environment that a nonblank converter version accompanies every active conversion revision and that the client bundle contains this change. |
| U-2 | Real browser/device and assistive-technology rendering of the dash and its screen-reader explanation. | Run a deployed-style student report smoke on supported browsers; Vitest verifies the React output but not browser presentation. |
| U-3 | Production instance count, database engine/isolation, replica routing, and failure profile for route/result finalization. | Outside this display-only proof. Existing SAT classroom/result reports list these as separate production obligations. |
