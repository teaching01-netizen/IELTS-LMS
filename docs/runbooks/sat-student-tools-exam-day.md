# SAT Student Tools — Exam-Day Notes (Bluebook tool parity)

Student tool surfaces are **presentation-only**: Help, Shortcuts, More,
Line Reader, Highlights & Notes, Mark for Review, Option Eliminator,
Calculator, Reference, Display, the image viewer, the 5-minute warning,
and Unscheduled Break never pause, stop, or extend the module clock.
The clock stays server-authoritative; autosubmit at zero fires under
every overlay.

## Unscheduled Break (student-initiated)

- Takes a confirm first (testing time will continue). Then a veil with
a **live** timer and Return to Test. No backend pause call exists.
- Persistence/outbox keep running under the veil; answers are intact;
the question tree never unmounts (scroll position preserved on return).
- Break state is transient and clears on question navigation.
- Available in module phase only (review has no module clock to veil).
- If a proctor pause lands mid-break, the proctor blocking veil (z 100)
covers the break veil; time-expiry submission (z 95) also covers it.

## Proctor pause vs student break

- Proctor pause: frozen timer + proctor note, whole exam grid inert.
Help/Shortcuts stay reachable read-only through the route-level overlay
(outside inert). Line Reader and Break disable with reason while paused.
- Student break: timer keeps running. The two veils are distinct surfaces;
never assume a veiled student is time-frozen — check the proctor roster.

## Calculator / Reference

- Desmos College Board testing build (scientific + graphing radiogroup).
Both tools coexist side by side; toggling one never closes the other.
- Panel positions (+ calculator size) persist per module-attempt for the
session and are clamped onscreen on restore. Calculator input state
persists through Desmos; calculator mode persists in the workspace store.
- Compact viewports (phone / short height) fall back to a bottom sheet.

## Display / Line Reader / Image viewer

- Display (text size, line spacing, screen zoom) and Line Reader position
persist per schedule:attempt. Line Reader is vertical-only, resettable
from its header bar.
- Question images open a non-modal lightbox (zoom 100-400%, drag to pan
when zoomed). Exam chrome stays reachable; nothing about timing or
answers changes while it is open.

## Bluebook visual notes (operator-visible)

- Header/footer chrome is pale blue; the exam document stays white. The Help
  Close button is yellow; tool-active state is a 2px text underline (no blue
  fills outside primary moves). Nothing about timing or answers changed.

## Keyboard shortcuts

- Full table lives in the in-exam Shortcuts modal (More > Shortcuts).
All shortcuts are ignored while paused/blocked and inside text inputs.
