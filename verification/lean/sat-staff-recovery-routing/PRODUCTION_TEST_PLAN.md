# Production test plan

Nothing in this file has been executed. It is what would move the production
evidence field from `NOT_TESTED` to `VALIDATED_IN_STATED_PROFILE`.

## What is already covered locally

| Case | Where |
| --- | --- |
| Module finding against a full shell / an incomplete map / no shell | `releaseSelectors.test.ts` |
| Refusal of a finding naming a module the draft lacks | `releaseSelectors.test.ts` |
| Leaked field path refused, with and without a shell | `releaseSelectors.test.ts` |
| Module link adopted, stale module link dropped, question link dropped | `useAuthoringSelection.test.tsx` (6 tests) |
| R12: unresolvable question link and stray field link consumed and dropped | `useAuthoringSelection.test.tsx` (added; both failed before the fix) |
| Republish during an open room setup cannot move the pin or the fields | `SatSessionsRoute.test.tsx` |

## Scenarios still to run (T1–T9)

**T1 — Real republish race, with timers.** Two authenticated staff sessions on
one exam. A opens the room setup; B publishes a new version; wait past the
overview poll interval so the refresh actually lands; then A creates the room.
Check: the created room's `publishedVersionId` is A's captured version, A's
label still shows it, and no entered field changed. This is the *real* timer
version of `SatSessionsRoute.test.tsx`'s simulated rerender (A13).

**T2 — Link for a question the local shell lacks (U4).** From the release
review, press Fix on a question finding, then delete that question in another
session (or open the link after a draft switch) so the shell no longer contains
it. Check: the URL carries no `?question=`/`?field=` afterwards, no editor field
is focused, the selection falls back deterministically, and nothing re-adopts
when the question returns after a save/refresh.

**T3 — Partially mapped shell (A5/U1).** If a caller is ever changed to pass a
page-scoped shell, press Fix on a finding whose section the shell does not map.
Check: the press still opens that module. **Expected to fail today** — the
denial branch treats any shell that maps modules as authoritative.

**T4 — Duplicate module keys across sections (A4/U2).** Publish a version where
`rw-m1` and `math-m1`… i.e. two sections carry the same module key, then press
Fix on a finding for one of them. Check: the opened module is the one the
finding names. Server-side, consider a uniqueness constraint on
(section, moduleKey).

**T5 — Accessibility walkthrough.** Keyboard-only pass over the release review
issues pane and the publish sheet: every Fix press reachable, labelled, and
announces its destination; `unresolved` rows expose the reason to a screen
reader and are not focusable actions. Run with `bun run e2e:sat-a11y` once the
harness is up, plus a manual 200% zoom check (the plan's §6 walkthrough).

**T6 — Responsive check.** The staff surfaces at 390 / 768 / 1440 px with the
new rows and panels (the plan's §1 gap).

**T7 — Cross-tab link injection.** Inject a `?module=` link from a coedit room
into a tab whose shell is mid-refresh; confirm one adoption, and that the
parameter does not persist or re-fire.

**T8 — Failure and retry.** Room creation fails (server rejection, then
timeout): the form keeps the pinned version, the entered fields survive, and the
retry sends the same `publishedVersionId`.

**T9 — Load/soak.** Not a property of these functions, but the surfaces that
carry them: run the staff list and release routes under the normal request mix
and confirm no unbounded refetch loop appears after a link is consumed (the
stripped parameter must not retrigger the query).

## Observability the checks need

- The created room's `publishedVersionId` and the exam's current published
  version, side by side, at create time.
- The URL at each step (for the consumed-link checks).
- The selection ids and the focused editor field after a Fix press.
- Client-side error surfaces (`overview.error`, publish errors) so a refusal is
  distinguishable from a silent failure.

## Exit criteria

T1, T2, T8 pass and T5 reports no focus or labelling regression → production
evidence becomes `PARTIAL` (T3, T4, T6, T7, T9 still open). Anything that lets a
pressed Fix land on an object the finding did not name is a stop-ship.
