# Selection Engine v2

Owned touch text selection for exam prose: the app builds the selection, because
on a coarse pointer the platform's own selection is what raises iOS/Android's
Copy / Look Up / Share bar over a passage, and it cannot be suppressed
separately from the selection.

This file is the map. It exists so the next change lands in the layer that owns
the behaviour, instead of in whichever file happened to be open.

## The layers, and what each one owns

```text
domain/                     pure decisions, no DOM, no React
  selectionTypes.ts         the shared vocabulary (TextPoint, rects, phases, presentation)
  selectionMachine.ts       the gesture's transitions; returns effects, performs none
  selectionSegmenter.ts     Intl.Segmenter-first word boundaries (Thai, CJK, RTL, emoji),
                            the whole-word run a body-touch drag means, and the
                            grapheme boundary a handle endpoint may stop on

engine/                     DOM primitives and the one session; no React, no scheduling
  selectionPoint.ts         coordinate → TextPoint (native caret APIs + geometry fallback)
  selectionRange.ts         two TextPoints → the DOM Range
  selectionGeometry.ts      Range → painted lines, handles, anchor box
  selectionSession.ts       THE OWNER: machine state + boundary + the derived span
  selectionScheduler.ts     one frame source; coalesces reads into one pass
  pointerCapture.ts         follow one pointer without a document-wide drag listener
  selectionAutoScroll.ts    edge scrolling during a handle drag
  selectionPlacement.ts     the one placement decision (above / below / clamped / hidden)

react/                      the browser-facing adapter and the presentation
  useStudentSelectionGesture.ts   pointer capture, hold timer, scroll suppression,
                                  frames, React state — and NO selection of its own
  SelectionOverlay.tsx            portal + layer + highlight + handles + loupe, wired
                                  to the gesture and to a product's actions
  SelectionFloatingLayer.tsx      the top layer the overlay hangs in, popover first
  SelectionHighlight.tsx          the painted lines (and why they never animate)
  SelectionHandle.tsx             a 44px target around a 12px grip, either edge
  SelectionLoupe.tsx              the magnifier's wiring: when the picture is built,
                                  measured and painted
  loupePicture.ts                 the picture itself — cloned prose rather than a
                                  screenshot, mirrored, sanitised, and mapped into
                                  the lens (pure functions, no React)
  SelectionActionMenu.tsx         toolbar grammar only (role, rows, keyboard, dismissal)
  useSelectionMotion.ts           which motion token drives which moment

styles/selection.css        the material, the tokens, the coarse-pointer suppression
```

Direction of dependency is one way: `react → engine → domain`. Nothing in
`domain/` or `engine/` imports a component, a hook or a stylesheet; the products
(`features/student-delivery`) depend on these modules, never the reverse.

## The rules that are load-bearing

**The `Range` never enters `window.getSelection()`.** That is the whole point of
the module: the platform must have no selection to decorate. Everything
downstream (annotation anchors, toolbars) works from character offsets, so
nothing needs one. `useStudentSelectionGesture.test.tsx` asserts it with a spy on
`Selection.prototype.addRange`.

**One owner per fact.**

- *What is selected* → `engine/selectionSession.ts`, as a single derivation
  (`spanOf`) with two views: the `Range` to paint, and the endpoints to move. A
  handle grab adopts the endpoints of the span the last frame published, so the
  range the student can see and the range a drag acts on cannot disagree. This is
  the defect that shipped twice: a hold claimed one character while the overlay
  painted the word, and the handle at the word's start moved the word's end.
- *Whether the selection's own chrome or body received a press* →
  `react/SelectionOverlay.tsx`'s capture pass, which is also the only place that
  CONSUMES one (see below). It is the half the session cannot own: whether a press
  belongs to this surface at all is about the page underneath it. The endpoint it
  may begin is not, and that is reported rather than decided.
- *Whether a finger is choosing words or characters* → `domain/selectionMachine.ts`,
  as `granularity` (`SelectionGranularity`, the spec's `'word' | 'grapheme'`), plus
  the claimed word the same session keeps as `anchor`. The granularity is a field
  of the machine's STATE rather than a flag beside it: one transition decides it
  and the phase together — a press is `word` and a `grab` is the one transition
  that makes it `grapheme` — so the two cannot disagree, and it survives the
  release, which is what tells the re-derived span whether it is a whole-word run
  or a handle's precise one. A BODY gesture adopts the word under the press and
  every later body move is a whole-word run measured from it
  (`resolveWordDragSpan`), through the release that leaves the selection resting —
  so the word the student can see is the word the engine keeps, and the opposite
  edge of the claimed word cannot move. The run is spelled in whole words even
  when the finger LEAVES the node it claimed the word in — a paragraph splits its
  words across inline elements (an annotated `<mark>`, an `<em>`), and a drag can
  reach the next block — so the anchor (a `NodeWordSegment`, carrying its node)
  decides the side by document order and the far edge is the whole word the finger
  reached (`resolveWordRunAcrossNodes`). A node with no word in it leaves the claim
  standing, exactly as a gap inside one node does; dropping the anchor there is
  what let raw offsets produce `eta ga` from `beta` + `gamma`. A grabbed handle DROPS the anchor and
  places only its own endpoint, on a GRAPHEME boundary (`snapToGraphemeBoundary`):
  precision is the handle's job, and a character several code units long — an
  emoji, a flag, a combining accent, a Thai cluster — can never be cut in half.
  The two granularities meet in one place instead of being inferred from whichever
  component handled the event.
- *Which endpoint a press grabs* → the same session, in `grab`, applying the
  pure rule from `engine/selectionGeometry.ts` (`resolveHandleAcquisition`) to the
  paint the session itself measures. A selection narrower than the 44px controls
  that adjust it puts both of their boxes on the same coordinates, and the one the
  browser delivers a press to is decided by render order — so a press inside the
  START handle's outward zone can arrive at the END control, whose refusal would
  consume it as the selection's own body and leave the handle the student aimed at
  inert. Both zones are evaluated independently and the answer is a fact about the
  paint: the only one that accepts, else the nearer optical anchor, else the
  pointer's side of the span in reading order.

  The RULE lives in the engine because it is geometry; the DECISION lives here
  because it is about the selection — and it is made once. It used to be made
  twice: `SelectionOverlay` resolved it to know what to consume, and
  `beginHandleAdjustment` resolved it again to know what to move, each against its
  own snapshot of a frame. The overlay now REPORTS a press (its coordinates, and
  the control the browser delivered it to) and reads the verdict, which is what
  tells it a drag began — so no component names an endpoint, no component can
  name a different one than the geometry does, and the endpoints a press is judged
  against are the handles the student can see.
- *Which frame geometry is read in* → `engine/selectionScheduler.ts`.
- *Where a menu goes* → `engine/selectionPlacement.ts`, one decision for every
  product; products map it to their own chrome (`satAnnotationSurfaceChrome`) and
  never decide again.
- *What an action means* → the product. SAT/IELTS/ACT supply actions; the engine
  has never heard of Highlight or Note.
- *Whether touch selection is owned at all* → `StudentExamInteractionScope`
  (`ownedTouchSelection`), not routes, user agents or tool state.

**Pure logic stays pure.** `selectionMachine` returns effects instead of
performing them, `selectionGeometry` returns numbers instead of rendering, and
the session takes pointers and returns effects. That is what makes the interaction
grammar testable without a browser — and what keeps a change to "when" separate
from a change to "how".

**The magnifier is a camera, so a page coordinate has to be a lens coordinate.**
`react/loupePicture.ts` lays its copy of the prose out at the SOURCE'S width and in
the SOURCE'S type, which is what makes the two layouts one coordinate system — a
copy left to wrap itself into the lens's own column renders a correct-looking,
completely empty disc. Sizing is only half of it: the picture's ORIGIN has to be
measured too, because the copy's first block carries a top margin that collapses
out of the copy and cannot collapse out of the layer it lands in, which displaces
the whole picture by that margin. A lens with the right box in the wrong place is
the same defect wearing a better disguise — the prose in it looks perfect and the
column the tick indexes belongs to a different character. Both halves are asserted
in `e2e/student-owned-touch-selection.spec.ts` (the picture's box against the
passage's, and the finger's document coordinate against the centre of the lens),
and a new failure mode belongs there rather than in a screenshot. The mapping
itself is one function, `pictureTranslation`, which is why it can be read — and
argued with — without a component around it.

## Deliberately left in `touch-selection/`

`touch-selection/StudentExamInteractionScope.tsx`,
`touch-selection/StudentTouchSelectionDiagnostics.tsx` and
`touch-selection/touchSelectionDiagnostics.ts` are still imported here. They are
the scope boundary and the diagnostics sink — orthogonal to the engine, and used
by both the v2 gesture and the surfaces around it. Their predecessors
(`useStudentTouchTextSelection`, `StudentTouchSelectionOverlay`, the point/range
re-export shims) are gone; what is left is deliberately the part that is not
selection.
