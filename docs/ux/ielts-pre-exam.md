# IELTS pre-exam screens: check-in and waiting room

Direction: **product UI, not a campaign**. The candidate is mid-task, possibly
on a phone in an exam hall. One identifier bar, one card, one red action.
No illustrations, no explainer sections, no second accent.

## Registration (`/student/:scheduleId`)

`ExamCheckInScreen`, issued by the IELTS/ACT branch of `StudentEntryRoute`.

- Header: institute mark, divider, red `IELTS` wordmark. Nothing else.
- One centered form card, `max-width: 440px`, containing:
  - `Exam Check-in` heading
  - WCode, Email, Full name, Nickname, IELTS Course
  - one red primary action
- No intro copy, no "what happens next", no character counters or helper
  prose. Labels are the instructions; errors appear under the field.
- Queue, retry, closed and reconnect states reuse the same card shell.

**The access code is labelled `WCode`** in the field, placeholder and validation
error. Requirements are unchanged: all five fields are mandatory, nickname keeps
its 50-character limit, email uses the shared schema, and 429 admissions keep
retrying with the submitted payload.

## Waiting room (`ExamEntryCard`, used by `Lobby` and `PreCheck`)

One card, and the card is the section-times table:

- live status line with a red dot (`role="status"`)
- `Waiting for the exam to start` and the required keep-this-page-open line
- exam title, candidate, WCode
- total duration and every enabled section with its own time
- the timer and autosave facts as two quiet notes at the bottom
- no hero, no artwork, no guidance cards, no "what happens next" tiles

## Tokens

Defined on `.exam-entry` in `src/index.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--exam-accent` | `#DA291C` (Pantone 485) | primary action, focus, status dot, IELTS wordmark |
| `--exam-accent-strong` | `#A81D12` | red text on tinted surfaces |
| `--exam-canvas` | `#F7F7F8` | page background |
| `--exam-surface` | `#FFFFFF` | header and cards |
| `--exam-ink` | `#18181B` | primary text |
| `--exam-ink-secondary` | `#52525B` | supporting text |
| `--exam-ink-muted` | `#71717A` | fine print, field labels in the pass |
| `--exam-hairline` | `#E4E4E7` | card and row borders |
| `--exam-control-border` | `#8F8F96` | input boundary (3:1 against white) |
| `--exam-danger` | `#B42318` | validation |

Radii: 12 px cards, 8 px controls. One 1 px shadow at 4% on cards. No gradients,
no decorative animation; the only motion is the connecting dot and a busy
spinner, both disabled under reduced motion.

## Verification

- `docs/ux/ielts-student/` holds full-page screenshots at 375 / 768 / 1440 px
  for check-in, inline errors, queue state, waiting, reconnect note and closed
  state.
- `docs/ux/ielts-student/audit.json`: 36 runs (6 states × 320/375/768/1024/1280/
  1440 px) checking horizontal overflow, clipped text, targets under 44 px,
  WCAG AA text contrast, 3:1 input borders, font and image loading. Final run:
  no findings.
