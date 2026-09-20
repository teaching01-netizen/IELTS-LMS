# Student Access — interaction quality plan (press feel, micro-interactions, Apple UX)

ATDD implementation plan. **No implementation code is written here.**

Scope: the staff-facing Student Access page — route `/sat/exams/:examId/access`
(`src/products/sat/routes/SatAccessRoute.tsx` → `StudentLinksDashboard` and its four
satellite components). It is the surface staff use to create links, share them, watch
join/start/submit counts, and pause/revoke/duplicate.

Status of items: `KNOWN` = verified in this checkout, `INFERRED` = derived from verified
code, `OPEN QUESTION` = must be resolved before or in Phase 0.

---

## 0. Implementation status (2026-09-19)

Landed: Phase 2 (press vocabulary + token-ized durations + contract test), Phase 3
(control press everywhere on the page, sheet Save pending semantics), Phase 4 (row
vocabulary, per-link pending, inline confirmation, scroll-into-view), Phase 5 (tab
indicator, roving tabs, panel reveal, scroll reset, Escape-to-row, copy confirmation),
Phase 6 (immediate search echo, filter thumb), Phase 7.1/7.3 (banner fade, no
double-announce), Phase 8.1 (README). Acceptance tests added: `satPressCss.test.ts`
(13 CSS contracts) plus `*.interaction.test.tsx` suites for the row, dashboard,
detail, toolbar, and editor sheet (23 behavioral ATs).

Deliberate deviations from the text above (all recorded, none silent):

- **2.2** only the *durations* moved onto the existing tokens. The SAT curve literal
  `cubic-bezier(0.22, 1, 0.36, 1)` is **not** `--sat-staff-ease`
  (`cubic-bezier(0.2, 0, 0, 1)`) — swapping it would have changed the feel of every
  existing row/banner/route animation, which §2.2 promised not to do.
- **D-4** rows carry `sat-list-row` **and** `sat-press-row` (the latter owns the
  border-color/box-shadow half of the transition). A selected row additionally needed
  `.sat-list-row[aria-current="true"]:hover` to keep its accent tint: the shared hover
  fill outranked the row's own tint utility and read as a deselection.
- **AT-12 is NOT satisfied as written.** The banner stays in the page flow (it now
  enters through `sat-banner-enter`); a failed action still shifts the cards below it by
  ~56px for the life of the banner. The shift-free variants (pinned overlay, or inline
  per-row errors) are design calls that change where failures are read, so they were not
  taken unilaterally. Residual risk, explicitly owned by 7.1.
- **D-5 Plan A shipped.** Acknowledgement is inline-only; no staff toast host was added
  and the `showToast` store writes were left in place (harmless, and ready for a future
  host). F-1 is therefore *mitigated*, not fixed.
- **1.7 / AT-01, AT-03, AT-20, AT-23, AT-25 browser ATs are not automated.** Q-4 (the
  seeding path) is unresolved: the only harness that reaches a published-exam access page
  is `startSatAttempt` inside `e2e/sat-product-workspace.spec.ts` (~90s to seed). The CSS
  contract test covers the cascade; the residual risk is real-engine cascade/paint
  verification, which is exactly what that spec would buy.
- **Q-2** implemented as `SEARCH_FAST_PATH_MAX = 150`; above it the 150ms debounce stays.
- **New, beyond the plan:** `SatPrimaryButton`'s pressed state moved from Tailwind
  `active:` utilities to the shared class (single vocabulary), and the editor's primary
  action gained a `min-w-[8.5rem]` box so the pending label + spinner cannot resize it.
- **AT-24:** no new color token was introduced, so the existing contrast/forced-colors
  contracts cover it unchanged; `satPressCss` additionally asserts no new
  `--sat-staff-*` token escapes the dark-twin audit.

Known pre-existing failures on this branch (not caused by this change):
`src/test/architecture/feature-internal-boundary.test.ts` (SatExamLibraryRoute imports a
feature internal) and `src/features/student-delivery/ui/__tests__/bluebookBans.test.ts`
(a student-delivery source still contains `backdrop-blur`).

Baseline before this work: 16 files / 117 tests in the access-links + sat-ui scope;
after: 30 files / 273 tests, all green.

---

## 1. Goal

Make every interaction on the Student Access page feel *physical and immediate* under the
finger/mouse, in line with Apple-style interaction quality:

1. **Immediate press acknowledgement** at the exact control pressed (pointer-down, not
   response-time).
2. **A complete state model per control** — default, hover, pressed, focus-visible,
   pending, settled, disabled — with no state left undefined (skill pack:
   `premium-react-frontend-skill-pack/experience/interaction-states-feedback.md`).
3. **No layout shift** on feedback (banners, spinners, confirmation swaps must not move
   the rows under the pointer).
4. **One motion vocabulary**: 100–160 ms, ease-out, no bounce, no overshoot, interruptible;
   reduced-motion / reduced-transparency / increased-contrast / forced-colors respected.
   Motion must answer "did my action register?" and be silence otherwise.
5. **Local feedback first**: acknowledgement lives on the pressed control; global toasts
   carry only off-screen events. Today the primary success channel is silent (finding F-1).

Explicitly **out of scope**:

- Any change to link semantics, revision/optimistic-concurrency rules, pinning to the
  immutable release, roster validation, or section scoping (README invariants).
- Any API, database, or backend change. This plan is client-only.
- The student join/attempt surface, the release page, and the sessions/results pages
  (they are *regression* surfaces only).
- Dark-appearance/token *values*, type sizes, and contrast floors (frozen by
  `satContrastTokens.test.ts`, `satTypeFloor.test.ts`, `satContractsCss.test.ts`).

---

## 2. Current-System Understanding

### 2.1 Render and interaction chain (`KNOWN`)

```text
SatAccessRoute (examId param)
  ├─ useExamQuery(examId) ─────────────► examQuery.data       (providerKey must be 'sat')
  ├─ useAccessDistributionOverview ───► distributionQuery     (30–35 s poll, staleTime 30 s)
  └─ StudentLinksDashboard({exam, overview, isLoading, error, onRefresh, onBackToRelease})
        ├─ links = overview.links ⊕ coedit room values at "access/{id}"   (room wins)
        ├─ LinksToolbar        (search 150 ms debounce, status pills + counts, result count)
        ├─ AccessLinkRow[]     (button + absolutely-positioned compact SatMenu)
        ├─ AccessLinkDetail    (tabs Overview | Activity | Settings, 30–35 s activity poll)
        ├─ AccessLinkEditorSheet (Radix Sheet, roster validation, discard confirm)
        ├─ AccessLinkShareSheet / AccessLinkPresentView (QR, share, copy)
        └─ AuthoringConfirmDialog (revoke only)
```

- Mutation layer (`src/features/exam-authoring/api/assessmentAccessLinkQueries.ts`):
  `useCreateAccessLink`, `useUpdateAccessLink`, `useSetAccessLinkLifecycle`,
  `useDuplicateAccessLink`. **No optimistic updates**; each `onSuccess` writes the single
  link cache entry and calls `authoringEffects.accessChanged`.
- Co-editing (`src/features/exam-authoring/realtime/coedit`): the dashboard mirrors link
  state into the room (`setValue`/`setValues("access/{id}")`), seeds from the overview
  after `ready && localReady`, and announces commands (`access.created`, `access.updated`,
  `access.lifecycle_changed`, `access.duplicated`). The room — not the HTTP response — is
  what keeps sibling tabs honest. **Consequence:** any "instant" local state we add must
  not contradict this echo (see §6 D-3).
- Success feedback: `useNotificationStore.addSuccess` via
  `infrastructure/authoringUiGateway.ts` → `services/authoringUiBridge.ts` →
  `app/store/notificationStore.ts`. Success toasts fire on create / update / lifecycle /
  duplicate / copy.
- Shell: `SatRoot` wraps everything in `MotionConfig reducedMotion="user"`; the sidebar is
  kept on `/access`, so the page renders its own sticky header inside a two-pane card.

### 2.2 Existing motion/interaction vocabulary (`KNOWN`, all in `src/index.css`)

| Class | Behavior |
| --- | --- |
| `.sat-list-row` | hover fill `rgba(120,120,128,0.06)`, `:active` `scale(0.99)`, 160 ms/100 ms transitions; paired with `.sat-row-chevron` nudge |
| `.sat-row-enter` | 160 ms opacity+4px rise, stagger `min(--sat-row-index, 5) * 60 ms` |
| `.sat-route-enter`, `.sat-banner-enter` | 160 ms / 140 ms opacity fade (no translate) |
| `.sat-spinner`, `.sat-live-dot`, `.sat-skeleton-shimmer` | rotation, opacity pulse, gradient sweep |
| `.sat-menu-trigger-chevron` | 180° rotation on open |
| `.authoring-button:active` | `scale(0.97)` |
| `.authoring-icon-button` | **hover only — no pressed state** |
| Reduced motion | blanket `0.01 ms` durations **plus** an explicit transform reset for `.active\:scale-\[0\.97\]:active` and `.active\:scale-\[0\.99\]:active` |
| Duplicates | `SatPrimaryButton` uses Tailwind `active:scale-[0.97]`; `authoringMotion.press` (`scale: 0.97`) is the JS twin in `src/shared/motion.ts` |

Staff motion tokens exist but are **entirely unused** by CSS (only referenced by their own
definitions and the DARK-02 exemption list): `--sat-staff-ease` (`cubic-bezier(0.2,0,0,1)`),
`--sat-staff-ease-press` (`cubic-bezier(0.4,0,0.2,1)`), `--sat-staff-motion-hover: 120ms`,
`--sat-staff-motion-state: 130ms`, `--sat-staff-motion-banner: 140ms`,
`--sat-staff-motion-row: 160ms`, `--sat-staff-motion-press: 100ms`,
`--sat-staff-stagger-step: 60ms`, `--sat-staff-stagger-cap: 5`,
`--sat-staff-shimmer-duration: 1.35s`. Press/active fills also already exist:
`--sat-staff-fill-active` (`rgba(0,0,0,0.065)`), `--sat-staff-fill-chip-hover`,
`--sat-staff-accent-active`.

### 2.3 Findings this plan must fix

**F-1 (`KNOWN`) — the success channel is silent.** No component in `src` subscribes to
`useNotificationStore().notifications`. Grep confirms the only references are the store
itself, `app/store/index.ts`, `services/authoringUiBridge.ts`,
`infrastructure/authoringUiGateway.ts`, and `StudentLinksDashboard.tsx` (writer only);
`GlobalToast` is a separate, local-state component used only by `BuilderRoot`. Every
`showToast(...)` on this page — created, updated, paused, resumed, revoked, duplicated,
copied — renders **nothing**.
*If this were wrong, the most likely error would be a host mounted outside `src`; the plan
makes the fix independent of that question by moving routine acknowledgement into the
page's own controls (§6 D-5).*

**F-2 (`KNOWN`) — most controls have no pressed state.** No `:active` treatment on: the row
overflow trigger (`COMPACT_TRIGGER_CLASS`), status pills, search-clear button, detail
Edit / Share / Copy / Present / "Create Version N Link" / activity Retry / "Copy link ID",
tab buttons, editor-sheet Cancel + Save + Choice cards + SectionToggles + segments +
roster helper buttons, share-sheet buttons and closes, present-view close, alert-dismiss
icons. `.authoring-icon-button` is hover-only by design of the stylesheet.

**F-3 (`KNOWN`) — pending work is invisible at the pressed control.** Pause/Resume/Revoke
from the row menu close the menu and show nothing until the echo (room write) or the
30–35 s poll lands; Duplicate likewise. Only the revoke confirm dialog exposes `busy`, and
only inside the dialog.

**F-4 (`KNOWN`) — press loses focus and input on the editor sheet's primary action.**
`footer` Save uses `disabled={isSaving}`; disabling the pressed element drops focus to the
document, and the fieldset is disabled wholesale while saving.

**F-5 (`KNOWN`) — feedback causes layout shift.** The action-error banner is rendered above
the two-pane card inside `SatContainer`, so a failed action pushes the whole list down;
it also has no entrance transition although `.sat-banner-enter` exists.

**F-6 (`KNOWN`) — selection and panel changes are untextured.** Row selection is an
instant fill swap (no transition on the selected border/fill), the detail tab indicator
snaps (`border-b-2` toggling), the panel swaps with no fade, and the detail pane keeps its
previous `scrollTop` when the selected link changes, so a long Activity list leaves the new
link scrolled past its own header.

**F-7 (`KNOWN`) — keyboard selection does not follow the eye.** ArrowUp/Down moves
selection but never scrolls the row into view, and the detail pane cannot return focus.

**F-8 (`KNOWN`) — search echo is debounced for no benefit.** The dashboard debounces input
by 150 ms before filtering an array that is at most dozens of rows, so typing feels laggy
while the (unchanged) result count jumps late.

**F-9 (`KNOWN`) — the row does not use the shared row vocabulary.** `AccessLinkRow` composes
its own button with Tailwind `hover:` and no `:active`, so it misses `.sat-list-row`'s
hover fill, press scale, and the reduced-motion transform reset.

**F-10 (`KNOWN`) — tab semantics are incomplete for the ARIA tab pattern.** All three tabs
are in the tab order (`tabIndex` unset), Home/End are unhandled, and arrow keys change
`aria-selected` without moving focus.

---

## 3. Behavioral Contract

After implementation, an operator using the page with mouse, keyboard, or touch observes:

1. Every actionable control compresses on pointer-down (≈0.97 for controls, ≈0.99 for the
   ≥72 px row) with its press fill/border change, and releases over ~100 ms. Press lands in
   the same frame; release animates.
2. A control that starts work keeps the pressed/pending look **in place** — spinner
   substituted for the icon inside the same box — and its sibling controls are disabled
   only while that same link's write is in flight. No element changes size, position, or
   wrap when pending begins or ends.
3. Copy actions confirm at the pressed control for ~1.6 s ("Copied" + check), whether
   invoked from the detail pane or from the row menu; no toast is required for this.
4. Pause / Resume / Revoke / Duplicate show per-row pending and then the settled row, in
   the same visual position, without a manual refresh.
5. Failed actions surface exactly one banner, announced once, whose appearance does not
   move the list; the stale-revision path still offers Refresh and still says "This link
   changed elsewhere. Refresh and retry.".
6. Row selection, filter changes, and tab changes are legible transitions (≤160 ms,
   opacity/fill/indicator position), never replayed on the 30–35 s poll, and never
   block the next input.
7. Keyboard: `/` focuses search, ArrowUp/Down moves selection **and scrolls the row into
   view**, tabs implement roving tabindex + Arrow/Home/End with focus following selection,
   Escape in the detail pane returns focus to the selected row.
8. All of the above collapses to instant, non-translating state changes under
   `prefers-reduced-motion: reduce`, stays legible under `prefers-contrast: more`,
   `prefers-reduced-transparency: reduce`, and `forced-colors: active`.

Invariants that must remain true (from `access-links/README.md` and the existing suites):

- Links stay pinned to `publishedVersionId`; publishing never mutates old links.
- `duplicate(source)` keeps the version; `duplicate(current)` targets the current release.
- Revision conflicts still surface the stale banner + Refresh; nothing is silently retried.
- `selected_students` ⇒ `student_code`; roster codes unique case-insensitively; email
  optional but validated.
- `studentJoinUrl` keeps encoding the link id; external targets stay `target="_blank"
  rel="noreferrer"`.
- `No nested <button>` in a row (pinned by `AccessLinkRow.test.tsx`).
- Long URLs keep `.break-all` (pinned by `AccessLinkDetail.test.tsx`).
- No `animate-pulse` in SAT; skeleton uses `.sat-skeleton-shimmer`.

---

## 4. Acceptance Scenarios (ATDD matrix)

Layer key — **RTL**: vitest + jsdom + Testing Library (DOM/state/semantics);
**CSS**: vitest reading `src/index.css` (contract, mirrors `satContractsCss.test.ts`);
**UX**: Playwright (real press geometry, computed styles, animation counting) — needs the
seeded access page (§12.4); **Manual**: preview + WebKit/Safari check.

| ID | Scenario | Preconditions | Action | Expected result | Layer |
| --- | --- | --- | --- | --- | --- |
| AT-01 | Press feedback exists and is instant | Any press-capable control (row, pill, icon trigger, detail action, sheet footer) | Pointer down, hold | `transform: scale(--sat-staff-press-scale)` with 0 ms press-in transition; press fill token applied | CSS + UX |
| AT-02 | Press feedback is proportional and consistent | Control set | Compare pressed rows vs controls | ≥72 px surfaces use the row scale (0.99); controls use 0.97; one class vocabulary, no per-site literals | CSS |
| AT-03 | Release settles, never bounces | Pressed control | Pointer up | Returns to rest over `--sat-staff-motion-press`; no overshoot keyframe/spring; no size change | UX |
| AT-04 | Reduced motion removes transform press | `prefers-reduced-motion: reduce` | Pointer down on the same controls | `transform: none`; fill/label state change still present (state never depends on motion) | CSS + UX |
| AT-05 | Row selection is a transition, not a swap | ≥2 links | Click a non-selected row | Selected border/fill animate over `--sat-staff-motion-state`; `aria-current` set; no text reflow | RTL + CSS |
| AT-06 | Keyboard selection scrolls into view | ≥10 links, search focused | ArrowDown ×5 | Selection moves and the selected row is scrolled into view (`scrollIntoView({block:'nearest'})`) | RTL |
| AT-07 | Row pending state | Link is `live` | Open row menu → Pause | Row shows `aria-busy="true"` and an inline pending label with the shared spinner **inside the existing 40 px trigger box**; height/width of the row unchanged; menu items disabled | RTL |
| AT-08 | Row settles without refresh | Lifecycle mutation resolves | Await settle | Row shows Paused pill and resumes rest presentation; pending label cleared; no `onRefresh` call was required | RTL |
| AT-09 | Pending is per link | Two links, one write in flight | Trigger Pause on link A | Only row A is busy/disabled; row B stays fully interactive | RTL |
| AT-10 | Copy confirms locally (detail) | Any link, Overview tab | Press Copy | Button swaps to check + "Copied" for ~1.6 s, then reverts; clipboard received the student join URL | RTL |
| AT-11 | Copy confirms locally (row menu) | Any link | Row menu → Copy link | The row (not the closed menu) shows the transient confirmation; no toast-dependent path | RTL |
| AT-12 | Feedback causes no layout shift | Link list rendered, banner absent | Force an action failure | Exactly one `role="alert"` appears, announced once, fading in via `.sat-banner-enter`; the list's row rectangles do not move | RTL + UX |
| AT-13 | Stale-revision path preserved | Mutation rejects with a revision/stale message | Trigger an action | Banner copy "This link changed elsewhere. Refresh and retry." + Refresh button; Refresh calls `onRefresh` | RTL |
| AT-14 | Tab indicator glides | Detail open, Overview selected | Click Activity, then use ArrowRight | Single indicator translates between tabs (shared `layoutId`), `aria-selected` follows, panel content fades in ≤140 ms without translate | RTL + CSS |
| AT-15 | Tab pattern is complete | Detail open | Tab into the tablist, press End/Home, ArrowRight | Roving tabindex (one `tabIndex=0`); focus moves with selection; `aria-controls`/`aria-labelledby` unchanged | RTL |
| AT-16 | Panel scroll resets on link change | Long Activity list, scrolled | Select another link | Detail pane `scrollTop === 0`; the newly selected link's header is visible | RTL |
| AT-17 | Escape returns focus to the row | A row selected | Focus in detail pane → Escape | Focus lands on that row's button | RTL |
| AT-18 | Filter pills glide, counts stay honest | ≥2 statuses | Click "Live 1" then "All 3" | One sliding selection thumb between pills; `aria-pressed` follows; the result-count live region text updates once per change | RTL + CSS |
| AT-19 | Search echoes immediately | ≥5 links | Type "Mon" | Matching rows update in the same keystroke (no debounce gate for lists ≤ the fast-path size); `role="status"` count updates without announcing intermediate keystrokes twice | RTL |
| AT-20 | Poll refresh does not replay entrance motion | Page settled after first load | Force overview/activity refetch with unchanged ids | No new `Animation` objects appear and no row remounts; only changed numbers update | UX |
| AT-21 | Save keeps focus and press affordance | Editor sheet open, valid input | Press "Create Link" | Button becomes `aria-busy` + `aria-disabled` (still focused, spinner in place, same box); double-submit prevented; fieldset remains non-interactive | RTL |
| AT-22 | Icon buttons press | Editor/share/present close buttons | Pointer down | Pressed fill + scale via the shared vocabulary (no hover-only affordance) | CSS + UX |
| AT-23 | Menu trigger press | Row overflow trigger | Pointer down on the 40 px trigger | Pressed fill/scale; `aria-expanded` still toggles; 40×40 box unchanged | RTL + CSS |
| AT-24 | Forced-colors / contrast integrity | `forced-colors: active`, `prefers-contrast: more` | Load page, press controls | State still readable via fill/underline/label weight; no token without a mapped fallback | CSS + Manual |
| AT-25 | Touch target floor intact | `pointer: coarse` | Inspect controls | 44 px minimum block size preserved; press state does not shrink the hit area (transform only); no 300 ms tap delay (`touch-action: manipulation` on pressable rows) | CSS + UX |
| AT-26 | Existing behavior untouched | Full access-links suite + type/contrast/contract gates | Run suites | All existing tests pass unchanged; no new `--sat-staff-*` token lacks a dark twin or exemption | RTL + CSS |

---

## 5. Change-Surface / Dependency Map

```text
src/index.css (shared staff interaction vocabulary)        CHANGE
      ↓
SatPrimaryButton / SatListRow / SatSearchField (primitives) CHANGE
      ↓
AccessLinkRow ──► LinksToolbar ──► AccessLinkDetail         CHANGE
      ↓                  ↓                  ↓
   SatMenu (shared)  AccessLinkEditorSheet  AccessLinkShareSheet / PresentView   CHANGE (press/pending only)
      ↓
StudentLinksDashboard (orchestration: pending, transient, selection, scroll)     CHANGE
      ↓
accessLinkUi.ts (shared helpers)                            ADD (transient hook, pending derivation)
      ↓
notificationStore / authoringUiGateway                       VERIFY → CHANGE if D-5b chosen
      ↓
SatRoot (MotionConfig, sidebar chrome)                       VERIFY (unchanged)
      ↓
Sessions / Results / Exam Library routes (share .sat-list-row, SatPrimaryButton) VERIFY
      ↓
Student join surface (`/join/:accessLinkId`)                 N/A (no shared component)
```

Node classifications:

| Area | Class | Note |
| --- | --- | --- |
| `src/index.css` staff interaction section | CHANGE | Adds the press vocabulary; moves the hardcoded 160/140 ms literals onto the existing unused staff motion tokens |
| `src/products/sat/ui/SatPage.tsx` | CHANGE | `SatPrimaryButton` press/settle polish; `SatSearchField` clear-button press |
| `src/products/sat/ui/Menu.tsx` | CHANGE | compact trigger + menu-item pressed states, `aria-busy` passthrough |
| `access-links/AccessLinkRow.tsx` | CHANGE | adopt `.sat-list-row` vocabulary, pending/`aria-busy`, transient confirmation, stable row id |
| `access-links/LinksToolbar.tsx` | CHANGE | sliding selection thumb, pill press, immediate echo (props unchanged) |
| `access-links/AccessLinkDetail.tsx` | CHANGE | tab indicator + roving tabindex, panel fade, scroll reset, local copy confirmation, press on all actions |
| `access-links/AccessLinkEditorSheet.tsx` | CHANGE | footer Save pending semantics (no focus loss), Choice/SectionToggle/Segment/helper press |
| `access-links/AccessLinkShareSheet.tsx` | CHANGE | press on Share/Copy/Present/Download/Open, transient copied via shared hook |
| `access-links/StudentLinksDashboard.tsx` | CHANGE | pending derivation, transient flags, scroll-into-view, Escape-to-row, banner enter, debounce fast path |
| `access-links/accessLinkUi.ts` | ADD | `useTransientFlag` + pending-state derivations (framework-free helpers stay put) |
| `access-links/rosterValidation.ts` | VERIFY | unchanged |
| `access-links/README.md` | CHANGE | document the interaction vocabulary + new invariants |
| `features/exam-authoring/api/assessmentAccessLinkQueries.ts` | VERIFY | signatures unchanged; only read `isPending`/`variables` |
| `features/exam-authoring/realtime/coedit/*` | VERIFY | unchanged; the plan must not race the room echo |
| `app/store/notificationStore.ts` (+ host, if D-5b) | VERIFY/CHANGE | see D-5 |
| `app/router/*`, `products/sat/SatRoot.tsx` | VERIFY | no route/manifest change |
| `features/*/ui/spine/*` (`SaveCluster`) | VERIFY | co-edit save truth untouched |
| Sessions / Results / Library routes | VERIFY | consume `.sat-list-row` and `SatPrimaryButton`; changed by the shared CSS edit → regression suite mandatory |

---

## 6. Design Decisions

**D-1 — One CSS press vocabulary, opt-in, in `index.css`.**
*Decision:* add `.sat-press` (controls) and `.sat-press-row` (≥72 px surfaces) to the
existing "SAT staff list motion" section of `src/index.css`, driven by
`--sat-staff-press-scale` / `--sat-staff-press-scale-row`, `--sat-staff-motion-press`,
`--sat-staff-ease-press`, and the existing `--sat-staff-fill-active` /
`--sat-staff-accent-active` fills. Press-in transition duration 0 ms; release
`--sat-staff-motion-press` (100 ms).
*Reason:* press feedback is cross-surface (toolbar, rows, detail, sheets, menus) and must
be reused by Sessions/Results/Library rather than forked. Contract tests already read
`index.css`, so the vocabulary is testable in the same place it lives.
*Alternatives rejected:* per-site Tailwind `active:scale-[...]` — the reduced-motion reset
block enumerates escaped class selectors, so every new scale class needs a hand-written
escaped reset; and a page-lane stylesheet (`sat-session-room.css` precedent) would fork a
vocabulary that is not page-specific.
*Invariant protected:* the existing `.sat-list-row` scale (0.99) and the escape-reset list
stay authoritative; no global `button:active` rule is introduced (that would restyle every
page in the product).
*Cost:* `--sat-staff-press-scale*` are geometry tokens, so DARK-02's exemption list in
`satContractsCss.test.ts` must gain both names (with the same rationale already documented
for other geometry tokens).

**D-2 — Instant press-in, animated release.**
*Decision:* `.sat-press:active { transition-duration: 0ms }`, rest state transitions over
100 ms ease-press.
*Reason:* Apple tactile feel: the surface moves in the same frame as touch-down; the
return is what should be softened. It also means a fast click still shows a visible press.
*Alternative rejected:* symmetric 100 ms press-in — feels laggy on quick clicks.

**D-3 — Pending state is honest, never optimistic state.**
*Decision:* derive pending from TanStack mutation state
(`mutation.isPending && mutation.variables?.linkId === link.id`) and render it as
`aria-busy` + spinner + pending label. Do **not** fabricate a `status`/`lifecycleState`
before the server confirms; keep the room echo (`collaboration.setValues`) as the single
optimistic channel it already is.
*Reason:* the README invariant says a stale revision must surface as an error, not a lie;
optimistic status would show "Paused" for a write that later fails, which on this page
means staff believe student entry is closed when it is not.
*Alternative rejected:* optimistic lifecycle cache writes with rollback — higher perceived
speed, wrong on the one invariant this page exists to protect.

**D-4 — Rows adopt `.sat-list-row`; keep the row's own button and its trailing menu.**
*Decision:* add `sat-list-row` to the existing row `<button>` and let the class own the
hover fill and press scale; delete the now-shadowed Tailwind `hover:bg-*` literal on that
button. Keep `AccessLinkRow`'s internal markup (the menu must stay a sibling, not a child —
`AccessLinkRow.test.tsx` pins "no nested buttons").
*Reason:* extends the existing abstraction instead of inventing a second row language;
inherits the reduced-motion reset for free.
*Invariant protected:* no nested buttons; 40 px menu box; `min-h-[76px]` rhythm.
*Side effect:* rows visually match Sessions/Results/Library hover fill — intended, but it
is a visible change on this page and must be eyeballed (AT-26 covers the other pages).

**D-5 — Feedback channel: fix the local one first; the global toast host is a separate,
explicitly-decided change.**
*Decision (required):* routine acknowledgement moves to the pressed control — transient
check/`Copied` on copy, settled state on lifecycle, per-row pending. That makes the page
correct **independently** of `notificationStore`.
*Decision (recommended, needs sign-off):* also mount one staff notification host bound to
`useNotificationStore` so the store's existing writers are not silently dropped; today the
store is write-only (finding F-1). Preferred placement: a single viewport inside the SAT
shell (`SatRoot`) so other authoring pages inherit it. Minimum viable alternative: leave
the store alone and delete this page's `showToast` reliance, keeping inline confirmations
only.
*Reason:* an acknowledgement must not depend on an unmounted subscriber; "all feedback
routed to toasts" is an explicit anti-pattern in the skill pack.
*Alternative rejected:* keeping toasts as the only success signal (current state = no
signal at all). **OPEN QUESTION (Q-1):** is a global staff toast host in scope, or does
this page keep inline-only feedback?

**D-6 — Search filtering becomes synchronous with a fast path; the debounce survives only
for large lists.**
*Decision:* filter on the committed value when `links.length <= FAST_PATH_MAX` (proposed
150); keep the 150 ms debounce above it. The result-count region stays `role="status"
aria-live="polite"` and must not double-announce.
*Reason:* Apple responsiveness — the gesture should echo in the keystroke; debouncing is a
cost control for expensive filtering, and there is none here.
*Verified safe for existing tests:* `StudentLinksDashboard.test.tsx` asserts the *outcome*
via `waitFor`, which holds for both immediate and debounced filtering. **OPEN QUESTION
(Q-2):** confirm the intended `FAST_PATH_MAX` with the team (or drop the debounce
entirely).

**D-7 — Motion driven by CSS for press/focus (pointer-frame critical), by `motion/react`
for selection/indicator/panel (interruptible geometry).**
*Reason:* matches the repo's split: `whileTap={authoringMotion.press}` for toolbar glyphs,
`layoutId` springs for segmented thumbs. CSS gives zero-latency press without React
re-render on pointer-down; `layoutId` gives the sliding indicator that CSS cannot do
without measuring. `MotionConfig reducedMotion="user"` already governs the JS half.

**D-8 — No new animation on poll refresh.**
*Decision:* entrance animations stay mount-only; metric changes do not animate. An optional
"changed number" tick is explicitly NOT in this plan's required scope.
*Reason:* skill-pack anti-pattern — "staggered list entrances every time data refreshes".
Rows keep `key={link.id}` (already true) and AT-20 pins it.

---

## 7. Detailed Implementation TODOs

Dependency order. `Blocks:` names later items that cannot start first.

### Phase 0 — Characterization and open-question resolution

- [ ] **0.1 Resolve Q-1 (toast host scope).** Determine whether a staff notification host
  is approved. Input: `notificationStore` write sites (only this page) and the product
  owner's preference. Output: D-5 branch chosen; recorded in this document.
  *Enables:* 7.1 / 7.2 decision. *Blocks:* 7.2.
- [ ] **0.2 Resolve Q-2 (search fast path).** Confirm `FAST_PATH_MAX` (or "no debounce").
  *Blocks:* 6.1.
- [ ] **0.3 Record current behavior baselines to protect.** Capture, before editing:
  `bun run test:run src/features/exam-authoring/ui/access-links src/products/sat/ui`
  and a manual pointer-down recording of the row, a pill, the overflow trigger, and the
  detail Share/Copy buttons. *Verify:* baseline pass count recorded here.
  **Baseline taken 2026-09-19: 16 files / 117 tests passing.**
- [ ] **0.4 Enumerate the press-capable control inventory.** Walk the four components and
  list every element that must gain the press vocabulary (finding F-2 is the starting
  list). *Deliverable:* checklist used by Phase 3; no control left hover-only.
- [ ] **0.5 Confirm the shared-CSS blast radius.** Identify every module importing
  `.sat-list-row` / `SatPrimaryButton` (Sessions, Results, Exam Library, session room) so
  Phase 2's edits are known to be shared. *Blocks:* 2.1.

### Phase 1 — Acceptance-test specification (write red first)

- [ ] **1.1 RTL ATs for the dashboard.** New cases in
  `src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx`
  (or a sibling `StudentLinksDashboard.interaction.test.tsx` if the file grows past
  readability): AT-07, AT-08, AT-09, AT-11, AT-12, AT-13, AT-16, AT-17, AT-19.
  *Depends on:* 0.3. *Note:* mutation mocks must expose `isPending`/`variables`, so the
  existing `vi.mock` factory needs a controllable pending hook.
- [ ] **1.2 RTL ATs for the row.** `__tests__/AccessLinkRow.test.tsx`: AT-05 (transition
  class + `aria-current`), AT-07 (busy semantics + stable box), AT-11 (transient
  confirmation), plus an explicit assertion that the row still has no nested buttons and
  the `min-h-[76px]` rhythm class.
- [ ] **1.3 RTL ATs for the toolbar.** `__tests__/LinksToolbar.test.tsx`: AT-18
  (`aria-pressed` + indicator presence), AT-19 semantics (single live region, no duplicate
  announcement).
- [ ] **1.4 RTL ATs for the detail.** `__tests__/AccessLinkDetail.test.tsx`: AT-10, AT-14
  (indicator + panel fade container), AT-15 (roving tabindex, Home/End, focus follows),
  AT-16 (scroll reset), AT-17 (Escape → row focus), plus preservation of the existing
  `break-all`, banner, and ArrowRight assertions.
- [ ] **1.5 RTL ATs for the editor sheet.** `__tests__/AccessLinkEditorSheet.test.tsx`:
  AT-21 (`aria-busy`/`aria-disabled`, focus retained, double-submit blocked) and the
  discard-confirm path unchanged.
- [ ] **1.6 CSS contract test.** New
  `src/products/sat/ui/__tests__/satPressCss.test.ts` (pattern:
  `satContractsCss.test.ts` / `editorSurfacesCss.test.ts`): AT-01 (0 ms press-in + token
  scaling), AT-02 (two scales, no literals), AT-04 (reduced-motion transform reset for
  the new classes), AT-25 (`touch-action: manipulation` on pressable rows, 44 px floor
  untouched), AT-24 (no `--sat-staff-*` token introduced without a dark twin/exemption),
  and that `.sat-list-row`'s existing contract still holds.
- [ ] **1.7 Browser ATs.** New spec `e2e/sat-access-links-interaction.spec.ts`: AT-01,
  AT-03, AT-07, AT-20, AT-23, AT-25, using `page.mouse.down()` + `getComputedStyle` and
  `document.getAnimations()`; run once with `page.emulateMedia({ reducedMotion: 'reduce' })`
  for AT-04. *Depends on:* 12.4 seeding decision (0.6 below).
- [ ] **0.6 (moved here for ordering) Decide the browser-AT seeding path for the access
  page.** Options: (a) extract the seeding helper `startSatAttempt(...)` (currently local
  to `e2e/sat-product-workspace.spec.ts`, line 296) into `e2e/fixtures/satAccessHarness.ts`
  and reuse it; (b) create the exam + publish + link through the backend API directly.
  *Verify:* chosen path boots the access page in < 60 s. *Blocks:* 1.7.
- [ ] **1.8 Verify the red state.** Run 1.1–1.6 and confirm every new AT fails for the
  intended reason (missing behavior), not for a compile/mock error. *Depends on:* 1.1–1.6.

### Phase 2 — Shared interaction vocabulary

- [ ] **2.1 Add the press vocabulary to `src/index.css`** (staff interaction section, near
  `.sat-list-row`): `.sat-press` / `.sat-press-row`, `--sat-staff-press-scale` (0.97) /
  `--sat-staff-press-scale-row` (0.99), press fill (`--sat-staff-fill-active`) and pressed
  accent (`--sat-staff-accent-active`) rules, `:active` after `:hover` so press wins while
  hovering, and `:disabled` exclusion.
  - *Depends on:* 1.6 (contract exists first), 0.5.
  - *Preserve:* `.sat-list-row` hover/scale values; the existing escaped-class reset list.
  - *Enables:* AT-01, AT-02, AT-22, AT-23.
  - *Verify:* `satPressCss.test.ts` green; no other page's computed hover changes.
- [ ] **2.2 Move the SAT interaction timings onto the existing (unused) tokens.** Replace
  the literals `160ms` (row/route), `140ms` (banner), `60ms` (stagger step) in the staff
  motion section with `var(--sat-staff-motion-row)`, `var(--sat-staff-motion-banner)`,
  `var(--sat-staff-stagger-step)`, and the eases with `var(--sat-staff-ease)`.
  - *Reason:* the tokens exist; two vocabularies is the drift this repo explicitly avoids.
  - *Preserve:* identical computed values (same numbers), so no visual diff.
  - *Verify:* CSS contract asserts each rule references a token (no literal ms).
- [ ] **2.3 Add the reduced-motion + tap-behavior guards.** Extend the existing
  `@media (prefers-reduced-motion: reduce)` block to reset `.sat-press` / `.sat-press-row`
  transforms (and their `:active`), and add `touch-action: manipulation` for pressable rows.
  - *Enables:* AT-04, AT-25. *Verify:* 1.6.
- [ ] **2.4 Register the new geometry tokens in the DARK-02 exemption list.**
  `src/products/sat/ui/__tests__/satContractsCss.test.ts` — add
  `--sat-staff-press-scale`, `--sat-staff-press-scale-row` with the same inline rationale
  as the other geometry entries.
  - *Depends on:* 2.1. *Verify:* AT-26 / `satContractsCss.test.ts` green.
- [ ] **2.5 Primitive press pass.** `src/products/sat/ui/SatPage.tsx`:
  `SatPrimaryButton` gains the shared press/settle (press fill + scale, pressed shadow drop,
  no size change); `SatSearchField`'s clear button gains the press class while keeping its
  pinned 28 px target and centering rule.
  - *Preserve:* `satContractsCss` F-A6 search-clear rule; `disabled`/`pending` semantics.
  - *Enables:* AT-01, AT-22. *Blocks:* 3.x, 4.x, 5.x.
- [ ] **2.6 `SatMenu` press pass.** `src/products/sat/ui/Menu.tsx`: pressed state on both
  the compact and full trigger classes and on menu items (both the Radix and static
  branches), plus optional `busy`/`disabled` passthrough on `SatMenuItem` if 4.2 needs it.
  - *Preserve:* trigger accessible names, `aria-expanded`, chevron rotation, typeahead.
  - *Enables:* AT-23, AT-07. *Blocks:* 4.2.
- [ ] **2.7 `.authoring-icon-button` pressed state.** Add an `:active` fill/scale to the
  shared class (used by sheet closes, `QuestionImportSheet`, `authoringPrimitives`).
  - *Verify:* no other consumer regresses (`.authoring-*` is unscoped, so check the
    authoring pages in Phase 10).

### Phase 3 — Control-level press and pending (detail, toolbar, sheets)

- [ ] **3.1 `AccessLinkDetail` action styling.** Apply the press vocabulary to Edit,
  Share, Copy, Present, "Open student page", activity Retry, tab buttons, and
  "Create Version N Link"; remove the now-shadowed local hover literals.
  - *Depends on:* 2.5. *Enables:* AT-01, AT-22. *Verify:* 1.4.
- [ ] **3.2 `LinksToolbar` pills.** Press state on every status pill; keep the 44 px hit
  box, the `aria-pressed` semantics, and the overflow-x scroll strip.
- [ ] **3.3 `AccessLinkEditorSheet` controls.** Choice cards, SectionToggle, segment
  buttons, "Insert template"/"Copy format", Cancel, and Save get the press vocabulary;
  Save additionally gains AT-21 semantics (own the pending state in the sheet's local
  state and derive `aria-busy`/`aria-disabled`, guard the handler against double submit,
  keep the button mounted and focused, spinner swapped into the same box).
  - *Preserve:* `fieldset disabled={isSaving || readOnly}` (keeps data integrity),
    `readOnly` = "View only", the discard-confirm flow, all `aria-invalid`/
    `aria-describedby`/`role="alert"` field wiring.
  - *Enables:* AT-21, AT-22. *Blocks:* 1.5.
- [ ] **3.4 `AccessLinkShareSheet` + `AccessLinkPresentView`.** Press states on Share,
  Copy Link, Present, Download QR, Open student link, closes; replace the local `copied`
  `setTimeout` with the shared transient hook (5.5) so the confirmation gesture is
  identical everywhere.
- [ ] **3.5 Dashboard header/chrome.** Error-banner Refresh + dismiss get press states;
  "New Student Link" keeps the `SatPrimaryButton` treatment (now shared).

### Phase 4 — Row interaction

- [ ] **4.1 Adopt the shared row vocabulary.** `AccessLinkRow`: add `sat-list-row`, drop
  the shadowed `hover:bg-*` literal, keep `min-h-[76px]`, keep the absolute 40 px menu box,
  and give the button a stable id attribute for 4.4.
  - *Depends on:* 2.1. *Preserve:* no nested buttons; `aria-current`; `aria-label="Open X"`.
  - *Enables:* AT-01, AT-02, AT-05.
- [ ] **4.2 Row pending state.** New optional props `busy?: boolean` and
  `pendingAction?: 'pause' | 'resume' | 'revoke' | 'duplicate' | 'update' | null`; render
  `aria-busy`, an inline pending label in the meta line, and the shared `.sat-spinner`
  inside the existing trigger box; disable menu items while busy.
  - *Depends on:* 2.6, 5.1. *Preserve:* row height and menu position.
  - *Enables:* AT-07, AT-09.
- [ ] **4.3 Settled presentation.** After resolution, the pill/label revert with the
  state transition (no entrance re-animation, no reorder flash): update the memo
  comparator for the new props.
  - *Enables:* AT-08, AT-20. *Note:* the comparator is explicit — new props must be added
    or rows will not re-render (a silent, easily-missed defect).
- [ ] **4.4 Keyboard scroll-into-view.** In the dashboard's ArrowUp/Down handler, scroll the
  newly selected row into view via its id (`block: 'nearest'`), never `scrollIntoView`
  on the whole page.
  - *Enables:* AT-06. *Preserve:* `/` shortcut and the "skip inside inputs" guard.
- [ ] **4.5 Transient row confirmation.** Row-level "Copied"/"Paused" confirmation rendered
  in the row's meta line for ~1.6 s via the shared hook; source is the dashboard, passed
  down as a prop (keeps the row presentational and memo-friendly).
  - *Enables:* AT-11.

### Phase 5 — Detail pane micro-interactions

- [ ] **5.1 Detail scroll + focus plumbing.** Ref on the scroll container; reset `scrollTop`
  to 0 when `link.id` changes (AT-16); build the row→detail and detail→row focus link used
  by AT-17 (Escape in the pane returns focus to the selected row).
- [ ] **5.2 Sliding tab indicator.** `motion.span` with a shared `layoutId` inside the
  `relative` tablist (pattern: `src/products/sat/ui/SegmentedControl.tsx`), replacing the
  `border-b-2` swap; keep `role="tab"`, `aria-selected`, `aria-controls`,
  `aria-labelledby`, and the `jsx-a11y` disable comment (rewrite its rationale if the
  structure changes).
  - *Depends on:* 2.5. *Preserve:* existing test ids/panel ids; ArrowRight/Left behavior.
  - *Enables:* AT-14.
- [ ] **5.3 Complete the tab pattern.** Roving `tabIndex`, focus follows the newly selected
  tab, Home/End support, and `aria-orientation` left default.
  - *Enables:* AT-15. *Preserve:* AT-14's ArrowLeft/Right assertions and the existing
    tab-click flow.
- [ ] **5.4 Panel fade.** Keyed `motion.div` (opacity only, initial={false}, ~140 ms) around
  the active panel; no height animation, no translate, no double render.
  - *Enables:* AT-14. *Preserve:* the content swap must not delay input.
- [ ] **5.5 Local copy confirmation in the detail.** Overview Copy and Settings "Copy link ID"
  swap to check + "Copied" for ~1.6 s (shared hook from 5.6), keeping `.break-all` URLs and
  the `aria-label="Copy link ID"` name.
- [ ] **5.6 Shared transient-flag hook.** Add `useTransientFlag(durationMs)` to
  `access-links/accessLinkUi.ts` (or a `use*` sibling if the file is meant to stay
  framework-free — **OPEN QUESTION (Q-3)**: the file currently holds only pure helpers and
  is imported by tests as pure logic; prefer a new `useTransientFlag.ts` if purity matters).
  *Blocks:* 3.4, 4.5, 5.5.

### Phase 6 — Toolbar immediacy

- [ ] **6.1 Search echo fast path.** Implement D-6 in `StudentLinksDashboard`
  (`useDeferredValue` is acceptable to keep typing smooth if list size warrants it, but the
  *filter input* must no longer be delayed behind a timer for small lists).
  - *Enables:* AT-19. *Preserve:* Escape-to-clear, `role="status"` count, and the
    `StudentLinksDashboard.test.tsx` debounce-outcome assertions.
- [ ] **6.2 Filter pill selection glide.** One `layoutId` thumb across the pill row
  (interruptible spring), disabled under reduced motion by `MotionConfig`.
  - *Enables:* AT-18. *Preserve:* counts in labels (`All 3`, `Live 1`), `aria-pressed`.

### Phase 7 — Feedback channel and banner

- [ ] **7.1 Error banner without layout shift.** Render the banner with `.sat-banner-enter`,
  single `role="alert"`, and ensure the two-pane card's rows do not move when it appears
  (either keep it inside the list section so the card geometry is fixed, or reserve its
  space — decide with the visual baseline from 0.3).
  - *Enables:* AT-12, AT-13. *Preserve:* stale-conflict copy + Refresh wiring,
    `setActionError`/`setStaleConflict` reset semantics.
- [ ] **7.2 Toast host (only if 0.1 approves).** Mount one viewport for
  `useNotificationStore` notifications (e.g. inside `SatRoot`), using the existing
  `components/ui/Toast.tsx` primitive with a store→item adapter; per-toast `role="alert"`,
  `aria-live` not duplicated on the container (see `GlobalToast.tsx` for the a11y notes),
  `position: top-right`, motion-respecting.
  - *Depends on:* 0.1. *Preserve:* store API and durations; no change to
    `GlobalToast`/`BuilderRoot` behavior.
  - *Enables:* off-screen-event acknowledgement for create/duplicate confirmations.
- [ ] **7.3 De-duplicate feedback.** Ensure no action double-announces (inline confirmation
  + toast + pending label). One acknowledgement per event per channel:
  local control for local actions, toast only for events whose origin is off-screen.
  *Enables:* AT-19 semantics, a11y sanity.

### Phase 8 — Regression and docs

- [ ] **8.1 Update `access-links/README.md`** with: the press/pending vocabulary, the
  transient-confirmation rule, the "no entrance animation on poll" rule, the pending
  derivation, and the new keyboard behavior (scroll-into-view, Escape-to-row, roving tabs).
  *Verify:* README matches code (this file already documents layout/keyboard — keep both).
- [ ] **8.2 Full local suite.** `bun run typecheck && bun run lint && bun run test:run`
  plus the touched-module filters. *Verify:* AT-26.
- [ ] **8.3 Shared-surface regression pass.** Manually verify (preview + WebKit) that
  Sessions, Results, Exam Library and the session room keep their hover/press behavior
  after 2.1/2.2/2.5/2.7 — these are the only surfaces the shared CSS edit can reach.
- [ ] **8.4 Manual interaction review.** With the preview server: press-and-hold each
  control class (row, pill, icon trigger, detail action, sheet footer), then repeat with
  OS reduce-motion enabled, then with increased contrast, then forced-colors.
  *Verify:* AT-03, AT-04, AT-24, AT-25.

---

## 8. File-by-File Change Plan

| File | Existing responsibility | Required modification | Reason | ATs |
| --- | --- | --- | --- | --- |
| `src/index.css` | Shared SAT staff tokens, chrome, motion vocabulary, reduced-motion/contrast/forced-colors blocks | Add `.sat-press` / `.sat-press-row` + press-scale tokens and press fills; replace literal timings with existing staff motion tokens; add reduced-motion + `touch-action` guards | One press vocabulary; F-2, F-5, F-9 | AT-01,02,04,18,24,25 |
| `src/products/sat/ui/SatPage.tsx` | Staff primitives (`SatContainer`, `SatPrimaryButton`, `SatSearchField`, `SatListRow`, pills, skeletons, errors) | Press/settle polish on the primary button; press on the search-clear; document the row contract unchanged | Shared primitives are the press baseline for every SAT staff page | AT-01,02,22,23 |
| `src/products/sat/ui/Menu.tsx` | Radix + static menu, compact/full triggers, item semantics | Pressed states on triggers and items; optional busy/disabled passthrough | F-2, F-3 (row overflow trigger is the most-used control on the page) | AT-23,07 |
| `src/features/exam-authoring/ui/access-links/AccessLinkRow.tsx` | Memoized two-line row + pill + overflow menu | `sat-list-row`, pending/`aria-busy` props, transient confirmation slot, stable id, comparator update | F-2, F-3, F-9 | AT-01,05,07,09,11,20 |
| `…/access-links/LinksToolbar.tsx` | Search field + status pills + result count | Pill press, sliding selection thumb | F-2, F-6 | AT-01,18,19 |
| `…/access-links/AccessLinkDetail.tsx` | Tabbed detail, share block, funnel metrics, activity list, settings | Press on all controls; sliding tab indicator; roving tabindex + focus; panel fade; scroll reset; Escape→row; local copy confirmation | F-2, F-6, F-7, F-10 | AT-01,10,14,15,16,17,22 |
| `…/access-links/AccessLinkEditorSheet.tsx` | Create/edit sheet, roster validation, discard confirm | Press on choices/toggles/segments/helpers/footer; Save pending without focus loss or double submit | F-2, F-4 | AT-01,21,22 |
| `…/access-links/AccessLinkShareSheet.tsx` | Share sheet, present view, QR hook | Press on all actions/closes; transient copied via shared hook | F-2 | AT-01,03,10,22 |
| `…/access-links/StudentLinksDashboard.tsx` | Orchestration: filters, selection, mutations, dialogs, toasts | Pending derivation, transient flags, scroll-into-view, Escape-to-row, banner enter, search fast path | F-3, F-5, F-7, F-8 | AT-06,07,08,09,11,12,13,16,17,19 |
| `…/access-links/accessLinkUi.ts` (+ new `useTransientFlag.ts` if Q-3 says so) | Pure helpers (URL, status copy, roster parse, clipboard) | Add the transient-flag hook and pending-state derivations | One implementation of "acknowledge then revert" | AT-10,11 |
| `…/access-links/__tests__/*` | Unit/behavior tests | New ATs 1.1–1.5 | ATDD backbone | all RTL ATs |
| `src/products/sat/ui/__tests__/satPressCss.test.ts` | — (new) | CSS contract for the press vocabulary | Guard the vocabulary | AT-01,02,04,24,25 |
| `src/products/sat/ui/__tests__/satContractsCss.test.ts` | Token/contrast/system contracts | Add the two geometry tokens to EXEMPT | D-1 | AT-24,26 |
| `e2e/sat-access-links-interaction.spec.ts` (+ `e2e/fixtures/*` if 0.6 chooses extraction) | — (new) | Browser press/pending/no-replay ATs | Real press geometry is not jsdom-testable | AT-01,03,04,07,20,23,25 |
| `…/access-links/README.md` | Contract + layout + keyboard documentation | Document the interaction vocabulary and new keyboard behavior | This file is the page's contract | — |
| `app/store/notificationStore.ts` / `SatRoot.tsx` | Store; SAT shell | Only if 7.2 is approved: mount a viewport (adapter) | F-1 | — |

No files are deleted. Exact new-file names for the e2e harness are marked `0.6` (discovery),
not fabricated.

---

## 9. Data / State Lifecycle

No server state, schema, or contract changes. The client state touched:

| State | Created | Lives | Mutated by | Expires | Source of truth |
| --- | --- | --- | --- | --- | --- |
| `overview.links` | Query `accessLinkKeys.overview(examId)` | react-query cache (30 s stale, 30–35 s poll) | refetch, `authoringEffects.accessChanged` invalidation | poll/eviction | **Server** |
| Room values `access/{id}` | `collaboration.seedValue` after `ready && localReady`, and on every successful mutation | coedit document (Yjs/Hocuspocus) | `setValue`/`setValues` | room lifetime | Server echo, room is the fan-out channel |
| `links` (merged) | `useMemo` over `sourceLinks ⊕ room values` | render | room updates, poll | — | derived |
| Selection `selectedId` | Dashboard state | mount | row click, ArrowUp/Down, filter reconciliation, create/duplicate (`setSelectedId`) | remount | client |
| Search / filter | Dashboard state | mount | input, Escape, pills | — | client |
| **Pending (new)** | derived from `mutation.isPending` + `mutation.variables.linkId` | render only | mutation lifecycle | on settle | client, **must not be persisted or broadcast** |
| **Transient confirmation (new)** | `useTransientFlag` in dashboard (row) / detail (copy) | component | the action that triggered it | ~1.6 s timer, cleared on unmount and on `link.id` change | client |
| Detail scroll position | DOM | component | user scroll; **new reset on `link.id`** | link change | client |
| Toast notifications | `notificationStore` | module store | `addSuccess` etc. | 4–8 s by type | client (write-only today — F-1) |

Rules:

- Pending/transient state must never reach the room or the query cache: a sibling tab must
  not render another operator's in-flight press as persisted reality (D-3).
- The room remains the only optimistic channel; the poll remains the reconciliation channel.
- Transient timers must be cleared on unmount, on link change, and on repeated triggers
  (last-trigger-wins) to prevent a stale "Copied" flashing on a different link.

---

## 10. Error and Edge-Case Matrix

| Condition | Expected behavior | Layer | AT |
| --- | --- | --- | --- |
| Lifecycle/update rejects with a stale revision | End pending, restore rest state, banner "This link changed elsewhere. Refresh and retry." + Refresh | Dashboard banner | AT-13 |
| Lifecycle/update rejects otherwise | End pending, banner "Student Link could not be changed." | Dashboard banner | AT-12 |
| Copy rejects (clipboard unavailable) | No false "Copied"; banner "Link could not be copied. Clipboard is unavailable."; button returns to rest immediately | Detail/row/dashboard | AT-10,12 |
| Duplicate rejects | End pending on that row; link count unchanged; no phantom row | Row + dashboard | AT-09 |
| Two actions on the same link in sequence | Second press allowed only after the first settles (busy disables its own menu items); no double POST | Row | AT-07 |
| Actions on two different links concurrently | Both proceed; each row shows its own pending | Row | AT-09 |
| Poll lands while a write is in flight | Pending label wins visually; on settle the server value wins; no flicker back to the pre-write value (compare `revision`) | Merge memo | AT-08,20 |
| Room echo lands while pending | Echo applies; pending ends when the mutation settles (not when the echo fires) | Dashboard | AT-08 |
| Another tab changes the link while the editor sheet is open | Existing behavior preserved: `editingLink` follows the live revision; save sends the current revision | Dashboard/editor | AT-26 |
| Link removed from the visible filter while a write is in flight | Pending state is dropped with the row; on failure the banner still surfaces (the alert is outside the filter) | Dashboard | AT-12 |
| Selection falls off the filtered list | Existing reconciliation picks the next visible link; the detail pane scroll resets to top | Dashboard/detail | AT-16 |
| 30–35 s poll with changed metrics only | Numbers update in place; **no entrance motion, no remount** | Row | AT-20 |
| `prefers-reduced-motion: reduce` | All of the above pass with instant state changes and `transform: none` | CSS | AT-04 |
| `forced-colors: active` | Press is communicated by fill/underline/weight; no state depends on hue | CSS | AT-24 |
| Touch (coarse pointer) | 44 px minimum targets, pressed state does not shrink the hit box, no delayed tap (`touch-action: manipulation`) | CSS | AT-25 |
| Keyboard only | Everything above reachable: search, rows, menu, tabs, detail actions, sheet | RTL | AT-06,15,17 |
| Editor save in flight, user presses Escape | Existing discard guard preserved; save in flight is not interrupted | Editor | AT-21,26 |

---

## 11. Compatibility and Migration

- **Persisted data:** none. No schema, migration, backfill, or default changes.
- **API/contracts:** none. `AssessmentAccessLink`, `AccessDistributionOverview`, and request
  types are untouched; no new endpoint is called.
- **Old clients / other tabs:** unchanged wire protocol; the room's `access/{id}` payload
  contract is untouched, so a tab running the old bundle and a tab running the new bundle
  interleave exactly as today. No version negotiation needed.
- **Feature flags:** none. The change is presentational/interaction-level and ships in one
  bundle; a flag would create two interaction vocabularies, which is the failure mode the
  repo's CSS contract tests exist to prevent.
- **CSS compatibility:** `.sat-press*` rules use only long-standing properties
  (`transform`, `transition`, `background-color`, `touch-action`), with no `:has()` or
  newer selectors, matching the room/`index.css` baseline. `-webkit-tap-highlight-color`
  is already handled globally for the SAT product scope.
- **Downgrade behavior:** reverting the bundle restores today's behavior with no data
  consequences (no writes rely on the new client state).
- **Third-party surface:** none (no QR/`qrcode` change, no `navigator.share` change).

---

## 12. Test Strategy

### 12.1 Acceptance tests (behavior)

`StudentLinksDashboard.interaction.test.tsx` (or the existing dashboard test extended),
`AccessLinkRow.test.tsx`, `LinksToolbar.test.tsx`, `AccessLinkDetail.test.tsx`,
`AccessLinkEditorSheet.test.tsx`, `AccessLinkShareSheet.test.tsx`. Risk protected: feedback
that exists in the write path but never reaches the eye; regressions in the pending/settled
contract; keyboard reachability.

### 12.2 Integration tests (boundaries)

- Mutation→UI: pending derivation reads real TanStack `mutation.variables`, not a local
  mirror — assert via the existing mocked hooks extended to expose `isPending`/`variables`.
- Room→UI: assert the memo merge still prefers the room value and that pending state does
  not write into the room (spy on `setValue`/`setValues`).
- Banner→no-shift: assert the row container's DOM position/class list is unchanged when the
  banner appears.

### 12.3 Unit tests (isolated logic)

- `useTransientFlag`: start/expire/clear-on-unmount/last-trigger-wins (fake timers).
- Pending derivation helper (if extracted): busy only for the matching `linkId`.
- Keep `accessLinkUi.test.ts` (URL/status/roster) and `rosterValidation.test.ts` untouched
  and green.

### 12.4 CSS contract tests (the repo's established pattern)

`satPressCss.test.ts` reading `index.css`: press-in duration is 0 ms; scale comes from a
token (no literals); two scales only; pressed fills use staff tokens; reduced-motion reset
lists `.sat-press`/`.sat-press-row`; `touch-action: manipulation` present; every new
`--sat-staff-*` token has a dark twin or exemption. Risk protected: silent vocabulary drift,
and the "every token inverts" audit that already guards dark mode.

### 12.5 Browser tests (real press geometry, not jsdom)

`e2e/sat-access-links-interaction.spec.ts` (new; seeding per 0.6): press-and-hold computed
`transform`; release settle; reduced-motion emulation; `document.getAnimations()` count
before/after a forced refetch (AT-20); 44 px target measurement under a coarse-pointer
device profile. Risk protected: the one class of defect this whole task is about —
feedback that feels right in a unit test and wrong under a real pointer.

### 12.6 Regression tests

Full existing access-links suite plus `satContractsCss`, `satTypeFloor`,
`satContrastTokens`, `SatPage.test.tsx`, `Menu.test.tsx`, `SegmentedControl.test.tsx`,
`SatResultsRoutes.test.tsx`, `SatSessionsRoute.test.tsx` (shared CSS consumers), and
`e2e/sat-product-workspace.spec.ts` (the end-to-end access flow, unchanged semantics).

### 12.7 Deliberately NOT written

No new unit tests asserting Tailwind class strings for their own sake, no snapshot tests of
motion, and no test that pins a specific ms value beyond the tokens — those would lock
presentation details the design may legitimately tune.

---

## 13. Observability

- **No new metrics, traces, or analytics.** The change is presentation-only; there is no
  new decision point, no new failure mode, and no server-visible behavior to measure.
- **Existing logging stays**: `logError(err, { feature: "student-access", action, linkId })`
  on every failed mutation, and on clipboard failure. Verify these contexts still fire after
  the pending refactor (a refactor that swallows the error path silently would remove the
  only production signal this page has).
- **Diagnosability note (F-1):** if D-5's toast host is *not* approved, record in the README
  that this page relies exclusively on inline feedback, so a future reader does not
  reintroduce `showToast` as a silent no-op. If the host *is* approved, add one DEV-only
  assertion (or a store unit test) that a write to `notificationStore` always has a mounted
  subscriber — the current silent-drop class of bug is exactly what that test prevents.
- **Alerting:** none warranted.

---

## 14. Rollout and Rollback

Single deployable (frontend bundle). Recommended order:

```text
1. Merge shared vocabulary + contract tests (index.css, SatPage, Menu)     ← widest blast radius, lands first
2. Merge row/toolbar/detail/sheet interaction changes                      ← page-local
3. Merge feedback-channel changes (banner, transient, optional toast host)  ← most visible to staff
4. Verify: preview pass (mouse, keyboard, touch emulation), WebKit pass,
   reduced-motion / increased-contrast / forced-colors pass,
   e2e access flow (sat-product-workspace), full unit suite
5. Rollback trigger: any regression on Sessions / Results / Exam Library
   hover/press, any a11y regression (focus loss, unannounced state), or any
   visible layout shift on the access page
6. Rollback mechanism: revert the commit range; no data implications, no
   warm-up state, no flag to flip
```

Deployment notes: steps 1 and 2 can ship together (step 1 alone has no visible effect
except `.sat-list-row`-adjacent primitives); step 3 is the only user-visible-behavior change
for staff. No zero-downtime sequencing concerns (no API/DB), no cache invalidation.

---

## 15. Final Acceptance Checklist

```text
- [ ] Every AT-01…AT-26 scenario passes (RTL / CSS / browser / manual as labeled).
- [ ] Existing access-links suite passes unchanged.
- [ ] satContractsCss / satTypeFloor / satContrastTokens gates pass.
- [ ] Sessions, Results, Exam Library, session room hover/press verified unchanged.
- [ ] Reduced motion: transform press removed, state still legible (AT-04).
- [ ] Reduced transparency, increased contrast, forced-colors verified (AT-24).
- [ ] Touch: 44 px targets, no hit-area shrink, no delayed tap (AT-25).
- [ ] Keyboard: search, rows (scrolled into view), menu, tabs (roving/Home/End), detail
      actions, sheet — all reachable and focus never lost on press-to-pending (AT-06,15,17,21).
- [ ] No layout shift when the error banner appears (AT-12).
- [ ] Pending is per link, honest (never optimistic status), and never broadcast (AT-07,09).
- [ ] No entrance motion replays on poll refresh (AT-20); row memo comparator updated.
- [ ] Transient confirmations clear on unmount/link change (timer hygiene).
- [ ] README documents the vocabulary, feedback rules, and keyboard behavior.
- [ ] logError contexts preserved for every failure path.
- [ ] `bun run typecheck`, `bun run lint`, `bun run test:run` clean.
```

---

## Open Questions / Assumptions to Verify

- **Q-1 (BLOCKER for 7.2).** Is a global staff toast host in scope? Today
  `notificationStore` is write-only (F-1). Plan A (inline-only feedback) needs no shell
  change; Plan B adds a viewport in `SatRoot`.
- **Q-2 (BLOCKER for 6.1).** Confirm the search fast-path threshold (proposed
  `FAST_PATH_MAX = 150`) or approve dropping the debounce entirely. *(Verified: existing
  tests assert outcomes, not timing, so both choices stay green.)*
- **Q-3.** Keep `accessLinkUi.ts` pure (new `useTransientFlag.ts`) or add the hook to it?
  *Assumption to verify:* the file is currently pure and imported by pure-logic tests.
- **Q-4 (BLOCKER for 1.7 / 0.6).** Which seeding path is accepted for the new browser spec:
  extract `startSatAttempt` from `e2e/sat-product-workspace.spec.ts` into `e2e/fixtures/`,
  or seed via the backend API?
- **Q-5.** Should the row's metric numbers flash when they change between polls? *Marked
  MAY / out of required scope* — deliberately excluded to respect the "no motion on refresh"
  rule.
- **Assumption (verified).** The page is reachable only for `providerKey === 'sat'` exams
  (`SatAccessRoute` guard) and requires a published version, so every AT fixture needs a
  published SAT exam; the "no published version" empty state is legacy-gated and out of
  scope for interaction work.
