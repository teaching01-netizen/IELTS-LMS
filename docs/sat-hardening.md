# SAT Exam Bluebook Design System — Hardening Evidence (2026-09-10)

> Exam-scope implementation record. The staff-workspace notes follow below unchanged.

## Bluebook token values (semantic intentions, never scattered hex)

| Intention | Token | Value | Contrast |
|---|---|---|---|
| Chrome brackets | `--sat-chrome` / `--sat-shell-bg` | `#EAF2FD` | text-on-chrome 14.92 AAA |
| Action fill | `--sat-accent` | `#3154D7` | on-white 6.21 AA |
| Action hover + text | `--sat-accent-strong` | `#2947BA` | on-white 7.76 AAA |
| Action pressed | `--sat-accent-pressed` | `#223A98` | on-white 9.87 AAA |
| Action tint | `--sat-accent-soft` | `#E4EAFB` | (-strong text on tint 6.46 AA) |
| Attention (Help Close only) | `--sat-attention` / fg / border / hover | `#FFD718` / `#171717` / `#44484C` / `#F2C900` | 12.79 AAA |
| Paper highlight | `--sat-highlight-background` | `#FFF2B3` | — |
| Note header | `--sat-note-header` | `#FFF9D9` | — |
| Review | `--sat-review-active` | `#C9475C` | on-white 4.63 AA |
| Focus | `--sat-focus` | `#005FCC` | on-white 5.98 AA |
| Progress | `--sat-progress` | `#191919` | — |
| Answer border / split / tool border | `--sat-answer-border` / `--sat-split-divider` / `--sat-tool-border` | `#74787D` / `#777B80` / `#5D6268` | — |
| Scrim / reader mask | `--sat-scrim` / `--sat-reader-mask` | `rgb(0 0 0 / 72%)` / `rgb(20 20 20 / 92%)` | — |
| Elevation | `--sat-shadow-floating` / `--sat-shadow-modal` | floating / modal only | — |
| Geometry | answer 52/8, marker 28, button 44/pill, focus 3/2 | — | — |

## What changed / what did not

- Changed (CSS + class swaps only): chrome shell, royal action, 72% scrim,
  dark reader mask, answer/marker/button tokens, yellow Help Close, calm tool
  buttons (icon 20, 2px text underline), footer 70px/1440 rhythm, navigator
  86px anchor offset, 320px footer tighten.
- Unchanged: timing, persistence/outbox, interaction machine, Desmos internals,
  eraser logic, keyboard radio arrows, announcements, Escape arbitration.

## Gates evidence (2026-09-10)

- Unit: `src/features/student-delivery` 69 files / 314 pass, 0 fail
  (incl. bluebookTokens 9, bans 8, shell 6, overlays 9).
- A11y: `npm run e2e:sat-a11y` 77 pass + 7 skip, 0 fail (chromium/webkit/touch).
- ESLint: clean on all touched scope files.
- Typecheck: scoped delivery config clean except pre-existing
  `src/shared/error/errorTypes.ts` captureStackTrace lib artifact (untouched
  file); full-repo tsc OOMs on 8GB machines (pre-existing env limit).

---

# SAT Staff Workspace — Hardening Notes (Chains 1–10)

Calm-ops language is unchanged (canvas `#f5f5f7`, white cards, accent `#0071e3`).
This doc records the production-grade deltas, not the design system.

## Motion tokens (single vocabulary)

| Token | Duration | Use |
|---|---|---|
| `fast` | 100ms | Press/hover color (`AUTHORING_EASE_STANDARD`) |
| `state` | 160ms | Chips, rows, fades, stagger (`AUTHORING_EASE`) |
| `panel` | 220ms | Dialogs, sheets |
| `spring` / `settle` / `snap` | — | Critically-damped springs (see `src/shared/motion.ts`) |
| `sat-spin` | 800ms linear | Pending spinner (text `Working…` is the carrier) |
| `sat-live-pulse` | 1.6s | Live dot (label text is the carrier) |
| `sat-shimmer-sweep` | 1.35s | List skeleton (matches `authoring-skeleton`) |

Rules: no `transition-all` in SAT + spine; no `duration-150/100/200` one-offs;
`--sat-row-index` caps at 5 (60ms steps); everything collapses under
`prefers-reduced-motion` (MotionConfig `reducedMotion="user"` at SAT roots).

## Save vocabulary (single truth)

`Saved` / `Editing` / `Saving…` / `Offline · saved on this device` /
`Not saved — Retry` (button) / `Changed elsewhere — Review` (button when a
review handler is wired, else status text). Error renders instantly, no
choreography. Previous status is effect-written (StrictMode-safe).

## Release lifecycle

`draft → checks → publish → immutable`. Students stay pinned to the version
their link was created for; "Students still receive vN until you publish"
is the canonical copy. Offline blocks publish; dirty sections block publish
and arm `beforeunload` + leave-dialog. Publish notes carry a live count.
Delivery numerics show their valid range (`1–600 min`, `1–N correct`).

## Room operator runbook

- Stale banner (`role=alert`) = data may be out of date; risky actions freeze
  until Retry reconnects. Last-updated time is shown.
- Pending is per-action: one in-flight extension never freezes Start/Pause/Warn.
- Error banners are `role=alert` red; success banners are neutral `role=status`.
- Roster: far-from-deadline rows tick every 15s, sub-5-minute rows every 1s;
  header + detail clocks always tick every 1s. Math stays server-authoritative.
- Roster keyboard: one Tab into the listbox, arrows move, selection follows focus.
- Attention queue pins above the detail view whenever alerts are open.
- Terminate/Finish are destructive confirms focused on Cancel; outcomes land in
  the banner. All exam-day actions log `{action, scheduleId, latencyMs}` —
  IDs only, never student names or emails.

## Dialog + card rules

- SAT routes use Sat* dialogs; authoring uses Authoring* dialogs; never nested.
  z-scale 110/111 vs 200/201; one scrim recipe; sheet docks under 640px.
- Cards: `rounded-2xl border-black/[0.06] bg-white shadow-[0_1px_2px]` —
  `releaseSurfaceClass`, `SatPage` cards, and spine `spine-card` converge here.

## Acceptance record (2026-09-10)

- `pnpm typecheck`: clean.
- `pnpm eslint src/products/sat src/features/exam-authoring src/shared/hooks`:
  0 errors; 2 pre-existing warnings in untouched regions
  (`SatResultDetailRoute` useMemo deps, `useLiveUpdates` effect deps).
- `pnpm vitest run src/products/sat src/features/exam-authoring/ui src/shared/hooks`:
  **56 files / 247 tests, all pass** (baseline was 51 / 219).
- Every `sat-*` class applied in TSX resolves to a definition in `src/index.css`
  (`data-sat-menu-animate` is a data attribute, not a class — Radix-owned).
- No `transition-all`, no `duration-150/100/200` one-offs in SAT + spine.

## Workspace render budget

`useQuestionAutosave` returns a memoized object so `handleChange` stays stable
and keystrokes don't re-create every dependent callback. Full draft colocation
(45 touchpoints: nav guards, bulk ops, workbook import, offline recovery) is
deferred as a multi-PR refactor — the memo boundary is the safe 80% fix.
