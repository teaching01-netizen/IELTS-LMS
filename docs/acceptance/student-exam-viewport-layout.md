# Student exam viewport layout acceptance contract

## Feature

As a student taking an IELTS examination, I want the exam interface to remain
contained inside the visible screen so that the timer, answers, navigation, and
proctor-controlled completion state remain usable across supported devices,
orientations, and input modes.

## Product invariants

- The shell, header, workspace, and footer remain inside the visual viewport.
- Header and footer never overlap usable answer content.
- Reading and Listening content panes are the only intended vertical scroll owners.
- The document and body do not become the exam scroll owner.
- The document and shell have no horizontal overflow.
- Presentation changes never mutate answers, flags, current question, timer, or
  submission state.
- Schedule-backed student sessions keep completion proctor-controlled; this layout
  contract must not expose a student submission action as a responsive side effect.
- Previous and Next navigation never submit an exam.
- Every enabled exam function remains discoverable and operable.
- Primary touch controls are at least 44 x 44 CSS pixels in compact and touch
  medium layouts.

All geometry assertions allow one CSS pixel for browser rounding. The visual
viewport is measured with `window.visualViewport` when available and falls back
to `window.innerHeight`; `document.documentElement.clientHeight` is not the
source of truth.

## Acceptance scenarios

### AC-01: Shell remains inside the visual viewport

```gherkin
Scenario: Active Reading or Listening exam fits the visible viewport
  Given the student has entered an active Reading or Listening exam
  When the exam is displayed at a supported viewport
  Then the shell top is not above the visible viewport top
  And the shell bottom is not below the visible viewport bottom
  And the header is inside the shell
  And the footer is fully visible
  And the workspace starts at or below the header bottom
  And the workspace ends at or above the footer top
```

### AC-02: Document scrolling is never the exam scroll owner

```gherkin
Scenario: Student scrolls content that exceeds the workspace
  Given a Reading examination contains enough passage and question content to scroll
  When the student scrolls an intentional content pane
  Then the pane can move independently
  And window scrollY remains zero
  And documentElement scrollTop remains zero
  And body scrollTop remains zero
  And the header viewport position is unchanged
  And the footer viewport position is unchanged
```

### AC-03: No horizontal viewport overflow

```gherkin
Scenario: Exam remains horizontally contained
  Given the exam is displayed at any supported viewport
  Then document scrollWidth is at most document clientWidth plus one pixel
  And shell scrollWidth is at most shell clientWidth plus one pixel
```

### AC-04: iPad portrait remains usable

```gherkin
Scenario: Student uses an iPad-sized portrait viewport
  Given an active Reading exam
  And the viewport is 768 by 1024 CSS pixels
  When the exam renders
  Then the layout mode is medium
  And the timer is visible
  And the header and footer are inside the visual viewport
  And the footer does not overlap the workspace
  And there is no horizontal or document-level vertical overflow
  And the student can answer question one
  And the answer reaches Saved state
```

### AC-05: iPad landscape remains usable

```gherkin
Scenario: Student uses an iPad-sized landscape viewport
  Given an active Reading exam
  And the viewport is 1024 by 768 CSS pixels
  When the exam renders
  Then the layout mode is medium
  And the timer is visible
  And passage and question content are visible
  And the workspace has positive usable height
  And the footer is fully visible without overlapping the workspace
  And the student can answer a question
```

### AC-06: Larger tablet dimensions use the same contract

```gherkin
Scenario Outline: Larger tablet remains contained
  Given an active Reading exam
  And the viewport is <width> by <height> CSS pixels
  When the exam renders
  Then the layout mode is medium
  And the shell, header, workspace, and footer remain contained
  And no horizontal or document-level vertical overflow exists

Examples:
  | width | height |
  | 834   | 1194   |
  | 1194  | 834    |
```

### AC-07: Width breakpoint transition preserves exam state

```gherkin
Scenario: Presentation changes at the wide breakpoint
  Given the viewport is 1199 by 900 CSS pixels
  And the student has entered an answer
  And the student has flagged another question
  And the current question is known
  When the viewport changes to 1200 by 900 CSS pixels
  Then the layout mode changes from medium to wide
  But the answer remains unchanged
  And the flag remains unchanged
  And the current question remains unchanged
  And the timer continues
  And no submission occurs
  And the shell remains contained
```

### AC-08: Compact phone portrait remains usable

```gherkin
Scenario: Student uses a compact phone portrait viewport
  Given an active Reading exam
  And the viewport is 360 by 800 CSS pixels
  When the exam renders
  Then the layout mode is compact
  And the timer, Previous, Next, and Navigator functions are accessible
  And the header and footer remain inside the viewport
  And the workspace remains between the header and footer
  And no document-level vertical or horizontal overflow exists
  And primary touch controls are at least 44 by 44 CSS pixels
  And a question answer can reach Saved state
```

### AC-09: Phone landscape keeps usable workspace height

```gherkin
Scenario: Student uses a short phone landscape viewport
  Given an active Reading exam
  And the viewport is 844 by 390 CSS pixels
  When the exam renders
  Then the layout mode is medium
  And the timer and footer are visible
  And the workspace has more than 100 CSS pixels of usable height
  And the footer does not overlap answer controls
  And no document-level scrolling occurs
  And an answer control is reachable
```

### AC-10: Orientation changes preserve state

```gherkin
Scenario: Student rotates while answering
  Given the viewport is 768 by 1024 CSS pixels
  And the student answers question one
  And the answer reaches Saved state
  And the student flags question two
  And the student navigates to question three
  When the viewport changes to 1024 by 768 CSS pixels
  Then the layout remains valid
  And the answer remains present
  And the flag remains present
  And the current question remains question three
  And the timer remains visible
  And no submission occurs
  When the viewport changes back to 768 by 1024 CSS pixels
  Then all of the same state remains present
```

### AC-11: Dynamic visual viewport height changes remain contained

```gherkin
Scenario: Mobile browser chrome changes available height
  Given an active exam at 390 by 844 CSS pixels
  When the available viewport height changes to 760 CSS pixels
  And then to 700 CSS pixels
  And then returns to 844 CSS pixels
  Then after every change the shell and footer remain inside the visible viewport
  And the workspace has positive height
  And the current answer remains present
  And the document does not become the scroll owner
```

### AC-12: Writing remains usable during a short viewport

```gherkin
Scenario: Writing editor survives a virtual keyboard-sized viewport
  Given the student is in Writing with a draft in the editor
  When the available viewport height decreases to simulate a software keyboard
  Then the writing editor remains reachable
  And the draft remains intact
  And the document itself does not scroll
  And the header does not duplicate or detach
  And no submission occurs
```

Writing may use a module-specific navigation surface; this scenario does not
require Reading or Listening footer geometry for Writing.

### AC-13: Footer never covers answer controls

```gherkin
Scenario: Student focuses an answer near the bottom of a question pane
  Given an active objective exam
  When the relevant pane is scrolled to the question
  And the answer control is focused
  Then the answer control can be brought fully above the footer
  And the answer control remains operable
```

### AC-14: Navigation boundaries are safe

```gherkin
Scenario: Student reaches navigation boundaries
  Given the student is on the first question
  Then Previous is disabled
  And Next is enabled when another question exists
  When the student is on a middle question
  Then Previous and Next are enabled when adjacent questions exist
  When the student is on the last question
  Then Next is disabled
  And clicking navigation never invokes submission
```

### AC-15: Tools and navigator remain accessible

```gherkin
Scenario: Student opens tools and navigator during a presentation change
  Given the student is using compact or medium layout
  When the student opens exam tools or the question navigator
  And the viewport is resized or oriented
  Then the overlay remains reachable inside the visible viewport
  And the overlay can be closed
  And focus returns to the invoking control when supported
  And exam geometry remains valid
```

### AC-16: Enabled controls satisfy touch target requirements

```gherkin
Scenario: Student uses touch-oriented controls
  Given compact or touch-oriented medium layout
  Then Previous, Next, Navigator, Tools, Accessibility, and critical
  answer interactions have a width and height of at least 44 CSS pixels
```

## Product viewport matrix

The dimensions below are product policy, not arbitrary test data.

| Case | Width | Height | Expected mode |
| --- | ---: | ---: | --- |
| phone portrait | 390 | 844 | compact |
| phone landscape | 844 | 390 | medium |
| compact regression | 360 | 800 | compact |
| small tablet portrait | 768 | 1024 | medium |
| small tablet landscape | 1024 | 768 | medium |
| large tablet portrait | 834 | 1194 | medium |
| large tablet landscape | 1194 | 834 | medium |
| medium boundary | 1199 | 900 | medium |
| wide boundary | 1200 | 900 | wide |
| desktop | 1440 | 900 | wide |

## Evidence and failure diagnostics

Acceptance failures must report a structured diagnostic containing:

- requested viewport and `window.innerWidth`/`window.innerHeight`
- `visualViewport` width, height, offset, and scale when available
- shell, header, workspace, and footer rectangles
- document and shell scroll dimensions
- layout mode and orientation
- pointer, hover, and touch capabilities

Geometry assertions must produce explicit messages such as:

```text
Footer bottom 846px exceeds visual viewport bottom 834px by 12px
```

Screenshots and traces are supporting evidence, not the acceptance oracle.

## Implementation memory

`StudentExamShell` is the only viewport-height owner. The viewport partitions
available height into fixed header, flexible workspace, and normal-flow footer
rows. The document and body must never become the exam scroll owner. Only
named content panes may scroll vertically, and horizontal overflow is forbidden
unless a control row explicitly owns it.

Do not introduce a primary exam navigation with `position: fixed` or
`position: absolute`; do not add device-specific iPad media queries, user-agent
layout detection, `window.innerHeight` layout math, or duplicated safe-area
calculations. Any exception requires an architectural reason and a new
acceptance scenario.
