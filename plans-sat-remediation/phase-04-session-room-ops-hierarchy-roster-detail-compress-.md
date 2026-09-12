# Phase 04 — Session Room Ops Hierarchy (Roster + Detail Compress)

## Objective

Compress the SAT Session Room to a 2-line-max ops hierarchy a proctor can scan live — with zero behavior change (polling, filtering, actions, confirms, listbox keyboard, clocks all identical).

Concrete outcomes:

- Zero text below 11px in the owned file (consume Phase 01 6-step scale; fix every 8px / 9px / 10px instance owned here).
- Roster rows (SatRoomStudentRow, line 273): 3 meta lines (section + timer + status) become 2 lines max (name line + single merged section-status line, timer alone on the right).
- Detail meta (StudentDetail dl line 285, session aside dl line 228, InfoRow line 290): compress density (padding/gap), unify labels on the 11px eyebrow floor, keep the 3-card grid shape on sm+ at tighter density.
- Keep pinned and intact: attention filter (All / Needs attention), stage clock (36px tabular hero), SessionControls (Start/Pause/Resume + Session actions menu), stale/message banners, listbox keyboard contract.
- Compact widths keep stacking roster above detail with the stage clock visible (no DOM reorder).

## Dependencies

- Phase 01 (REQUIRED, Wave 1 merged first): frozen 6-step type scale, .sat-product token block in src/index.css, slate remaps (.sat-product .text-slate-*), neutral-dot fix (--sat-staff-neutral-dot #6e6e73), SatEyebrow / SatStatusPill / SatSearchField contracts in src/products/sat/ui/SatPage.tsx. This phase CONSUMES those contracts; it does not re-tokenize.
  - If Phase 01 already did the mechanical 9px-to-floor swaps in SatSessionRoomRoute.tsx, treat those hunks as done (idempotent: verify with the grep gate, do not re-edit).
  - Frozen scale to consume: H1 30px/-0.045, hero 36px stage clock only (tracking -0.045em, tabular), H2 16-17px/-0.025, title/body 13-14px/-0.012, control/hint 12px semibold, floor 11px medium, eyebrow 11px caps/0.12em. Nothing below 11px ships.
- Phase 02 (parallel, disjoint): owns search placeholder scope strings and Title-Case buttons. Do NOT change placeholder Search students (line 177) or menu labels (Add 5 minutes, Send warning, End attempt) here.
- Phase 03 (parallel, disjoint): owns ConfirmDialog dirty-guard. Do NOT touch the SatConfirmDialog call (line 236) except to keep it compiling.
- Phase 05 (later, alone): owns dark .sat-product block. Do NOT add dark variants here; use existing var(--sat-staff-*) refs so dark rides free.

## Affected / new files (with line refs where known)

Owned file (ONLY file this phase edits):

- src/products/sat/routes/SatSessionRoomRoute.tsx (290 lines):
  - Lines 44-49: studentTone() forked dot mapping (+ stray 0 typo on line 46).
  - Line 160: Back Sessions button (text 11px, already floor; verify only).
  - Line 162: header title (text 13px) + cohort line (text 9px text-slate-400).
  - Line 163: Overrun badge (text 9px).
  - Line 164: Reconnecting indicator (text 9px).
  - Line 165: N-need-attention pill (text 9px).
  - Line 166: SessionControls call site (keep props/logic identical).
  - Line 170: stale banner (text 10px body + Retry text 10px).
  - Line 171: transient message banner (text 10px).
  - Lines 173-174: main grid lg:grid-cols-[310px_minmax(0,1fr)] + roster section aria-label Students (stacking; no change).
  - Line 176: roster header Students (text 10px), counts (text 9px), mini clock (text 10px).
  - Line 177: SatSearchField (keep placeholder; Phase 02 owns copy).
  - Lines 178-181: attention filter group (min-h-8, text 10px x2, aria-pressed, toggle semantics).
  - Lines 183-204: listbox (role listbox, aria-activedescendant, ArrowUp/Down handler, max-h-44vh / lg:max-h-calc) + line 203 empty states.
  - Lines 211-212: stage block (SatEyebrow Current stage override text 9px; h1 text 25px; hint text 10px; hero clock text 36px tabular — KEEP).
  - Line 216: attention shortcut banner (text 11px, already floor; keep).
  - Line 222: StudentDetail call site + No student selected empty (text 12px / text 10px).
  - Lines 227-229: session aside (SatEyebrow Session override text 9px; dl.mt-4.space-y-3.5 with 5 InfoRows; overrun note text 10px).
  - Lines 241-257: SessionControls definition (primary text 10px; keep logic/labels).
  - Lines 259-273: SatRoomStudentRow (clocks, coarse flag, row button min-h-64px, 3-line markup to compress).
  - Lines 276-288: StudentDetail (menu items, 3-card dl.mt-7.grid.gap-2.sm:grid-cols-3, Attention section).
  - Line 285: detail cards (dt text 9px x3; dd text 12px / text 19px / text 12px).
  - Line 286: Attention rows (header text 12px; empty text 10px; warning text 10px; violation title text 10px + desc text 9px).
  - Line 290: InfoRow (dt text 8px uppercase tracking 0.1em + dd text 11px).

Read-only references (DO NOT EDIT):

- src/products/sat/ui/SatPage.tsx: SatEyebrow (lines 394-408, base text 10px becomes Phase 01 floor text 11px), SatStatusPill (lines 189-204), SatSearchField (lines 44-90), SatSectionCard (lines 410-430).
- src/index.css: .sat-product token block (about lines 1592-1814): --sat-staff-neutral-dot, --sat-staff-success-dot, --sat-staff-warning-dot, slate remaps (lines 1704-1710), reduced-motion / reduced-transparency / increased-contrast answers (lines 1752-1814+).
- src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx (261 lines, about 17 tests): frozen contract (see Contracts).

New files: NONE. No new stores, network, auth, or CSS files.

## Contracts / interfaces (frozen inputs from Phase 01 if relevant; what you must not break)

Frozen Phase 01 inputs this phase consumes (do not fork or re-literalize):

1. Type floor: nothing below text 11px ships. SatEyebrow default resolves to text 11px semibold uppercase tracking 0.12em tertiary; local className text-9px overrides on lines 211/227/284 MUST be deleted (fall back to the primitive default).
2. Dot tokens: --sat-staff-neutral-dot #6e6e73 (5.07:1 PASS), --sat-staff-success-dot, --sat-staff-warning-dot #d97706. studentTone() must resolve to these tokens, not raw bg-slate-300 / bg-emerald-500.
3. Text remaps: .sat-product .text-slate-400 maps to var(--sat-tertiary-label) etc. (index.css lines 1704-1710). Keep text-slate-* class names where they already resolve through the remap; do not introduce new hex literals in TSX.
4. Targets: primaries/rows keep 44px or more; filter chips 28px or more (min-h-7); search-clear 28px or more (owned by SatSearchField, untouched here).
5. Motion: sat-banner-enter, sat-live-dot pulse, row transition-[background-color,border-color,box-shadow] duration var(--sat-staff-motion-row,160ms) stay; reduced-motion / reduced-transparency / contrast / forced-colors answers in CSS stay and automatically cover new markup (no new animation).

Behavioral contracts that MUST NOT break (guarded by existing tests):

- useProctorRouteController with providerKey sat + initialScheduleId (test: opens the controller explicitly in the SAT provider boundary).
- Filtering: visibleStudents = search (name/studentId/email, case-insensitive, trimmed) AND attention (warnings > 0 OR violations.length > 0). Attention chip toggles all/needs with aria-pressed; Needs attention label string UNCHANGED.
- Selection: selectedStudent = find(selectedStudentId) ?? students[0] ?? null; auto-select first / rebind on roster change; success-banner clear on selection change. Terminate confirm binds the student captured at open even if selection moves; no-longer-in-session error path. All UNCHANGED.
- Actions: per-key pendingActions isolation (student-extend never freezes session Pause); stale (controller.error) disables risky session + student actions (blocked); run() / runStudentAction() success + RELOAD_FAILED_SUFFIX copy UNCHANGED.
- Confirms: exact title/description/confirmLabel strings for complete / terminate / warn (exact WARN_MESSAGE Please return your attention to the exam.) / extend-session / extend-student. Four tests assert these strings — DO NOT reword.
- Listbox keyboard: single tab stop on the listbox (tabIndex 0 or -1), rows tabIndex -1, role option, aria-selected, aria-label Open + name, aria-activedescendant sat-room-student-id, ArrowDown/ArrowUp moves selection + focus(). Test: moves through the roster with arrow keys from a single tab stop.
- Clocks: useAuthoritativeDeadlineClock wiring (deadlineAt/serverNow/fallback/running/coarse when fallbackSeconds > 300) UNCHANGED; formatRemaining() UNCHANGED; stage hero timer + roster timers keep tabular-nums (test: keeps timers on tabular-nums).
- Banners: stale role alert (Data may be out of date. + Retry), message role alert-or-status, sat-banner-enter hook. Two tests cover these.
- Status: runtimeLabel() / roomStatusTone() mapping + SatStatusPill pulse-when-live UNCHANGED; Overrun + Reconnecting indicators UNCHANGED in string/condition.

## Step-by-step implementation (ordered, each step names exact file + exact change)

All edits in src/products/sat/routes/SatSessionRoomRoute.tsx unless noted. Order matters (dots, header, roster, stage, detail, gates). No user-visible copy changes to strings asserted by tests.

Step 1 — Fix studentTone() fork + stray-0 typo (lines 44-49).
  Old: terminated returns bg-slate-300; paused/warned/violations returns bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))]0 (note trailing 0); connecting/idle returns bg-slate-300; default returns bg-emerald-500.
  New: terminated returns bg-[var(--sat-staff-neutral-dot,#6e6e73)]; paused/warned/violations returns bg-[var(--sat-staff-warning-dot,#d97706)] (delete trailing 0; dot token, not tint wash); connecting/idle returns bg-[var(--sat-staff-neutral-dot,#6e6e73)]; default returns bg-[var(--sat-staff-success-dot,#059669)].
  Rationale: aliases the single tone table, fixes the 2.81:1 neutral-dot FAIL to 5.07:1 PASS, removes the invalid class. Same 4 branches, same order, no logic change.

Step 2 — Header cohort + badges to floor (lines 162-165).
  Line 162 cohort: old p mt-0.5 truncate text-[9px] text-slate-400 becomes p mt-0.5 truncate text-[11px] font-medium text-slate-400. Title text-[13px] UNCHANGED.
  Line 163 Overrun: old px-2 py-1 text-[9px] font-semibold becomes px-2.5 py-1 text-[11px] font-semibold. Border/tint/text tokens UNCHANGED. String Overrun UNCHANGED.
  Line 164 Reconnecting: old text-[9px] font-semibold tabular-nums becomes text-[11px] font-semibold tabular-nums. Icon size 11 UNCHANGED. String Reconnecting UNCHANGED.
  Line 165 need-attention pill: old px-2.5 py-1.5 text-[9px] font-semibold tabular-nums becomes px-2.5 py-1.5 text-[11px] font-semibold tabular-nums. Count + need attention template UNCHANGED.
  Back button line 160 (text-[11px]): VERIFY ONLY, no edit.

Step 3 — Stale + message banners to floor (lines 170-171).
  Line 170 stale body: old px-3.5 py-2.5 text-[10px] font-medium text-amber-800 becomes px-3.5 py-2.5 text-[11px] font-medium text-amber-800. Retry button old min-h-9 + text-[10px] font-semibold becomes min-h-9 + text-[11px] font-semibold. Copy (Data may be out of date., Last updated label, Risky session actions are paused until reconnection., Retry) UNCHANGED. role alert + sat-banner-enter UNCHANGED.
  Line 171 message: old px-3.5 py-2.5 text-[10px] font-medium (both branches) becomes px-3.5 py-2.5 text-[11px] font-medium. Tone classes + role logic UNCHANGED.

Step 4 — Roster header to scale + chips to 28px target (lines 176-181).
  Line 176 Students: old p text-[10px] font-semibold text-slate-700 becomes p text-[12px] font-semibold text-slate-700 (control/hint band).
  Line 176 counts: old p mt-0.5 text-[9px] tabular-nums text-slate-400 becomes p mt-0.5 text-[11px] font-medium tabular-nums text-slate-400. Template n joined / m active UNCHANGED.
  Line 176 mini clock: old span text-[10px] font-semibold tabular-nums text-slate-400 becomes span text-[11px] font-semibold tabular-nums text-slate-400. Keep tabular-nums.
  Lines 179-180 filter chips (x2, identical): old min-h-8 rounded-full px-3 text-[10px] font-semibold becomes min-h-7 rounded-full px-3 text-[12px] font-semibold (28px min target; control band). aria-pressed, toggle handlers, bg-slate-900 text-white selected / chip-fill unselected tokens, labels All + Needs attention ALL UNCHANGED.

Step 5 — Roster row 3-line to 2-line compress + type floor (line 273, SatRoomStudentRow).
  Button frame: old min-h-[64px] grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 becomes min-h-[56px] with same grid/gap/padding. Keeps 44px-plus target, tightens scan density. Keep rounded-xl border, selected/hover branches, focus ring, row cross-fade transition, id, role option, aria-selected, aria-label Open + name, tabIndex -1 EXACTLY.
  Left line 1 (name): old p truncate text-[11px] font-semibold text-slate-800 becomes p truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-800 (title/body band; the row primary identifier). Dot + warning icon UNCHANGED (dot now token-backed from Step 1; AlertTriangle size 11 UNCHANGED).
  Left line 2 (MERGED meta, the compress): old two elements p mt-1 truncate pl-3.5 text-[8px] text-slate-400 with section (left) + p mt-1 text-[8px] capitalize text-slate-400 with status (right) become ONE element in the left cell: p mt-0.5 truncate pl-3.5 text-[11px] font-medium capitalize text-slate-400 rendering section + middle-dot + status (section = String(student.runtimeCurrentSection ?? student.currentSection), status = student.status). DELETE the right-cell status p entirely. Result: left cell = name + one meta line; right cell = timer only.
  Right timer: old p text-[11px] font-semibold tabular-nums text-slate-600 becomes p text-[12px] font-semibold tabular-nums text-slate-600 (control band; keeps tabular-nums for the no-shift-on-tick contract). formatRemaining(remaining) UNCHANGED.
  Empty-state line 203 (px-5 py-10 text-center text-[11px]): VERIFY ONLY. Strings No matching students. / Students appear here when they join. UNCHANGED.
  Hooks/clocks lines 264-272 (fallbackSeconds, running, useAuthoritativeDeadlineClock + coarse flag): NO CHANGE.

Step 6 — Stage block: eyebrow override delete + H1 compress, clock pinned (lines 211-212).
  Line 211: old SatEyebrow className text-[9px] tracking-[0.13em] with Current stage becomes SatEyebrow with Current stage and NO className (delete override; inherit Phase 01 11px caps/0.12em). String UNCHANGED.
  Line 212 stage title: old h1 text-[25px] font-semibold tracking-[-0.04em] becomes h1 text-[17px] font-semibold tracking-[-0.025em] (H2 band; removes an off-scale 25px step). currentStage UNCHANGED.
  Line 212 hint: old p mt-1 text-[10px] text-slate-400 with Server-authoritative session clock becomes p mt-1 text-[11px] font-medium text-slate-400. String UNCHANGED (test-asserted).
  Line 212 hero clock p text-[36px] font-semibold tabular-nums tracking-[-0.045em] text-slate-900: VERIFY ONLY, NO CHANGE (sanctioned 36px hero exception; keeps tabular-nums).

Step 7 — Session aside compress (lines 227-229 + 290).
  Line 227: old SatEyebrow className text-[9px] tracking-[0.13em] with Session becomes SatEyebrow with Session and NO className.
  Line 228 list: old dl mt-4 space-y-3.5 becomes dl mt-3 space-y-2.5. Five InfoRow entries (Status / Current stage / Joined / Active / Warnings) and order UNCHANGED.
  Line 290 InfoRow: old dt text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400 becomes dt text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400; old dd mt-1 text-[11px] font-semibold text-slate-700 becomes dd mt-0.5 text-[12px] font-semibold text-slate-700 (dt to eyebrow floor; dd to control band).
  Line 229 overrun note: old px-3 py-3 text-[10px] leading-5 becomes px-3 py-2.5 text-[11px] font-medium leading-5. Copy (Running beyond the scheduled window. + Review current time extensions before ending the session.) UNCHANGED.

Step 8 — StudentDetail meta compress (lines 284-286; menu logic untouched).
  Line 284 header: old SatEyebrow className text-[9px] tracking-[0.13em] with Student becomes SatEyebrow with Student and NO className. Name old h2 mt-1 truncate text-[22px] font-semibold tracking-[-0.035em] becomes h2 mt-1 truncate text-[17px] font-semibold tracking-[-0.025em] (H2 band; removes 22px step). Identity line old p mt-1 text-[10px] text-slate-400 becomes p mt-1 text-[11px] font-medium text-slate-400 (studentId + email template UNCHANGED). SatMenu Student actions items/ids/labels/disabled logic UNCHANGED.
  Line 285 card grid: old dl mt-7 grid gap-2 sm:grid-cols-3 becomes dl mt-5 grid gap-2 sm:grid-cols-3 (compress; keep 3-col shape on sm+). Cards old px-3.5 py-3 (x3) become px-3 py-2.5 (x3). Borders/surface tokens UNCHANGED.
  Card 1 Current module: old dt text-[9px] text-slate-400 becomes dt text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400; dd mt-1 text-[12px] font-semibold text-slate-700 UNCHANGED.
  Card 2 Time remaining: dt same swap; dd old mt-1 text-[19px] font-semibold tabular-nums tracking-[-0.03em] becomes mt-0.5 text-[17px] font-semibold tabular-nums tracking-[-0.025em] (H2 band; keeps tabular-nums).
  Card 3 Attempt: dt same swap; dd text-[12px] font-semibold capitalize UNCHANGED.
  Line 286 Attention: header h3 text-[12px] font-semibold tracking-[-0.01em] VERIFY ONLY. Empty old text-[10px] becomes text-[11px] font-medium (dot bg-emerald-500 becomes bg-[var(--sat-staff-success-dot,#059669)]; string No current warnings or integrity events. UNCHANGED). Warning count old text-[10px] becomes text-[11px] font-medium. Violation cards title old text-[10px] font-semibold becomes text-[11px] font-semibold; desc old mt-1 text-[9px] leading-4 becomes mt-0.5 text-[11px] font-medium leading-5. violations.slice(0, 5) + type replace UNCHANGED.
  Line 222 no-student empty: title text-[12px] font-semibold VERIFY ONLY; hint old p mt-1 text-[10px] text-slate-400 (Select a student to inspect their SAT attempt.) becomes text-[11px] font-medium. Icon UserRound size 24 + text-slate-300 UNCHANGED.
  Line 216 attention shortcut banner (text-[11px]): VERIFY ONLY.

Step 9 — SessionControls density (lines 241-257; logic frozen).
  Line 253 primary: old px-3 text-[10px] font-semibold becomes px-3 text-[12px] font-semibold. Keep min-h-10, accent tokens, spinner sat-spinner, disabled = primaryBusy OR blocked, aria-busy, labels Start / Pause / Resume / Working, icons size 13 EXACTLY.
  sessionItems (Add 5/10 minutes, Finish session), SatMenu compact align end width 176, blocked mapping: NO CHANGE.

Step 10 — Layout/stack gate (no edit; verify lines 173, 207-208, 225).
  Confirm main mx-auto grid min-h-calc(100vh-64px) max-w-1500px lg:grid-cols-[310px_minmax(0,1fr)] still stacks roster section aria-label Students above detail section (min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7) below lg, and the stage clock block (lines 210-213) precedes StudentDetail in DOM order. No reorder, no new breakpoints. Detail grid xl:grid-cols-[minmax(0,1fr)_250px] + aside xl:border-l UNCHANGED.

Step 11 — Grep + contrast gates (same session, before tests).
  Gate A must print NO matches: rg text-8px / text-9px / text-10px utility pattern in SatSessionRoomRoute.tsx (any remaining text-10px is a miss: fix to 11px, or escalate to Phase 01 only if it sits in a shared primitive).
  Gate B must print NO matches: rg bg-slate-300 / bg-emerald-500 / #9b9a97 / slate-300 in SatSessionRoomRoute.tsx (dots must be token-backed).
  Gate C confirm: rg roomStatusTone / SatStatusPill in SatSessionRoomRoute.tsx shows the single tone table still used, no fork.

Step 12 — Run focused tests, then hand off (no copy changes if red).
  vitest run on SatSessionRoomRoute.test.tsx must be green with existing assertions UNMODIFIED. If a text-visibility assertion breaks, the implementation over-changed copy: revert the string, keep the class change.

## Key code / pseudocode (dirty-guard logic, token blocks, row markup — only what your phase needs)

No dirty-guard logic in this phase (Phase 03 owns it). No token-block edits (Phase 01/05 own src/index.css). The only logic-adjacent change is the presentational studentTone():

```tsx
// SatSessionRoomRoute.tsx — Step 1 (presentational only; branch order unchanged)
function studentTone(student: StudentSession): string {
  if (student.status === 'terminated') return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  if (student.status === 'paused' || student.status === 'warned' || student.violations.length > 0)
    return 'bg-[var(--sat-staff-warning-dot,#d97706)]';
  if (student.status === 'connecting' || student.status === 'idle')
    return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  return 'bg-[var(--sat-staff-success-dot,#059669)]';
}
```

Roster row compress (Step 5) — structure sketch (classes abbreviated; logic/hooks identical):

```tsx
// BEFORE (3 meta lines): left [name 11px / section 8px] + right [timer 11px / status 8px]
// <div left> dot + name(11px) + warn-icon; section(8px) </div>
// <div right> timer(11px tabular) + status(8px) </div>
// AFTER (2 lines max): left [name 13px / section mid-dot status 11px] + right [timer 12px]
// <div left> dot + name(13px, tracking -0.012em) + warn-icon;
//   merged meta p: mt-0.5 truncate pl-3.5 text-[11px] font-medium capitalize:
//   section-string + middle-dot + student.status </div>
// <div right> timer p: text-[12px] font-semibold tabular-nums </div>
```

InfoRow compress (Step 7):

```tsx
// BEFORE: dt text-[8px] font-semibold uppercase tracking-[0.1em]; dd mt-1 text-[11px] font-semibold
// AFTER:  dt text-[11px] font-semibold uppercase tracking-[0.12em]; dd mt-0.5 text-[12px] font-semibold
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className=`text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400`>{label}</dt>
      <dd className=`mt-0.5 text-[12px] font-semibold text-slate-700`>{value}</dd>
    </div>
  );
}
```

What is deliberately NOT in this phase: search placeholder scope copy (Phase 02), confirm-dialog dirty-guard (Phase 03), dark .sat-product variants (Phase 05), any change to visibleStudents, run(), clock hooks, or listbox key handling.

## Edge cases (empty states, loading/error, polling refresh, keyboard, reduced-motion/transparency/contrast, forced-colors, 320px, 200% text)

- Empty roster (never joined): line 203 Students appear here when they join. at 11px centered; listbox tabIndex -1 when visibleStudents is empty; roster header counts 0 joined / 0 active; detail shows No student selected empty. Verify no orphan timer or filter crash.
- Empty filter result: No matching students. replaces rows (not alongside); aria-activedescendant becomes undefined when no selection; attention + search AND semantics preserved after row markup change.
- Loading / error-before-data: controller.isLoading without schedule renders LoadingSurface Opening SAT session; controller.error without schedule renders ErrorSurface with Retry reload. Untouched; skeleton-XOR rule holds (no new loading UI here).
- Stale-while-loaded (polling failure): banners (Step 3) + Reconnecting + disabled SessionControls / student menu items; merged roster meta line still renders last-known section/status; timers freeze on fallback seconds (no NaN: formatRemaining clamps at 0).
- Polling refresh / 300-row rooms: row stays a cross-fade only (background/border/shadow transition); no layout animation on 1s ticks; coarse clock (fallbackSeconds > 300: 15s) vs precise (under 5min: 1s) unchanged; selection ring (aria-selected + bg/shadow swap) must not shift layout (min-h-56px fixed floor, truncate on both text lines).
- Keyboard: listbox single tab stop; ArrowDown/Up + focus() contract; rows tabIndex -1 clickable via native button Enter/Space; aria-label Open + name still gives the exact accessible name the tests match (merged section-status line is description text, aria-label wins).
- Screen reader: status dot stays decorative (no new announcement); warning triangle stays decorative alongside text meta; SatStatusPill text (Ready/Live/Paused/Finished/Cancelled) still carries state, never color alone.
- Reduced motion: sat-banner-enter / sat-live-dot / row cross-fade collapse under existing prefers-reduced-motion CSS. No new keyframes added here; verify attention + stale banners appear instantly.
- Reduced transparency: header (--sat-staff-glass-room) + roster (--sat-staff-glass-roster) collapse to solid fallback via existing media query. Merged row markup inherits it (no new glass surface introduced).
- Increased contrast / forced-colors: tertiary/secondary remaps + strengthened separators cover the new 11px meta lines; dots keep 3:1 or better (neutral 5.07:1); focus rings (accent-ring) survive forced-colors via the existing focus-visible treatment. Verify row focus visible against selected bg in forced-colors mode.
- 320px width: header wraps (title truncate + pill + controls); roster stacks above detail (single column); merged section-status truncates (no wrap, no push of timer); hero clock (36px) wraps below stage title via existing flex-col sm:flex-row; aside cards stack (sm:grid-cols-3 collapses to 1 col).
- 200% text / Dynamic Type: two-line clamp holds (name truncate, meta truncate); min-h-56px grows gracefully (min-, not fixed-height); 36px clock keeps tabular-nums so 1s ticks do not reflow; detail 17px headings wrap, not clip.
- Long strings: 60-char stage names, Reading and Writing Module 1 + long cohort names truncate with ellipsis; email in identity line truncates within min-w-0; violation desc at 11px wraps (leading-5, max 5 shown: unchanged cap).

## Tests (which existing tests must pass; which new unit/contract tests to add, with file paths and assertion sketches)

Existing suite — MUST pass UNMODIFIED (src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx, about 17 tests):

1. opens the controller explicitly in the SAT provider boundary (asserts Reading and Writing Module 1 x2, Server-authoritative session clock, Ananda S. x2)
2. keeps per-action pending isolated
3. tones error banners as alerts and success banners as status
4. moves through the roster with arrow keys from a single tab stop (role option name Open Ananda S., aria-selected true)
5. pins the attention queue when alerts are open
6. previews a warning with exact copy before sending
7. previews a time extension with remaining context before applying
8. filters the roster to students needing attention (aria-pressed toggle)
9. binds the terminate confirm to the student captured at open, even if selection moves
10. shows an error instead of acting when the bound student left the roster
11. marks loaded session data stale and disables risky actions while reconnecting
12. renders the Overrun badge when the session runs beyond its window
13. shows Reconnecting in the header while stale
14. keeps timers on tabular-nums (2 or more .tabular-nums nodes: still true after compress — hero clock + roster timer + detail timer)
15. combines search and attention filters with AND semantics
16. disables student menu items while stale
17. keeps banners on the entrance hook and confirms extend-session success copy (.sat-banner-enter)

Related suites that must stay green (no edits expected, run as regression): src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx, src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx, src/products/sat/ui/__tests__/satContractsCss.test.ts, src/products/sat/ui/__tests__/SatPage.test.tsx.

New unit/contract tests to ADD (implementation agent writes these; all in existing test dirs, no new infra):

- File src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx (append a describe block named session room ops hierarchy (phase 04)):
  - renders roster rows with at most two text lines: render default fixture; get option Open Ananda S.; assert button querySelectorAll(p).length is 2 (name + merged meta) and merged p text matches section-active pattern.
  - keeps the type floor at 11px in the room: assert container has no text-8px / text-9px / text-10px utility classes.
  - dots resolve to staff tokens, not slate literals: assert no bg-slate-300 / bg-emerald-500 classes; selected row dot has a --sat-staff- token class.
  - keeps hero clock and tabular timers after compress: hero clock still text-36px + tabular-nums; roster timer still tabular-nums.
  - InfoRow labels sit on the eyebrow floor: session-aside dt elements carry text-11px and uppercase.
- File (optional, only if the team prefers contract-level): src/products/sat/ui/__tests__/satContractsCss.test.ts — extend, do not fork: add assertion SatSessionRoomRoute has no sub-11px text classes that reads the route source and rejects text-8px / text-9px / text-10px (source-grep contract mirroring the Verification gate).

Assertion sketch:

```tsx
describe('session room ops hierarchy (phase 04)', () => {
  it('renders roster rows with at most two text lines', () => {
    render(room());
    const row = screen.getByRole('option', { name: 'Open Ananda S.' });
    expect(row.querySelectorAll('p')).toHaveLength(2);
    expect(row).toHaveTextContent(/reading/);
    expect(row.querySelector('.tabular-nums')).toBeInTheDocument();
  });
  it('keeps the type floor at 11px', () => {
    const { container } = render(room());
    expect(container.querySelector('[class*=text-8px]')).toBeNull();
    expect(container.querySelector('[class*=text-9px]')).toBeNull();
    expect(container.querySelector('[class*=text-10px]')).toBeNull();
  });
});
```

## Verification (exact commands: vitest paths, tsc, eslint, grep gates, contrast recompute)

Run in order from the repo root; all must be green before handoff to Phase 06:

1. Focused suite: npx vitest run src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
2. Product regression: npx vitest run src/products/sat
3. Typecheck: npx tsc --noEmit
4. Lint (owned file + touched tests): npx eslint src/products/sat/routes/SatSessionRoomRoute.tsx src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
5. Sub-floor grep gate (must print NO matches): rg for the text-8px / text-9px / text-10px utility pattern in src/products/sat/routes/SatSessionRoomRoute.tsx
6. Dot-literal gate (must print NO matches): rg for bg-slate-300 / bg-emerald-500 / #9b9a97 / slate-300 in src/products/sat/routes/SatSessionRoomRoute.tsx
7. Scope gate (no leakage): git diff --name-only must list ONLY src/products/sat/routes/SatSessionRoomRoute.tsx (+ tests); git diff on student-delivery paths and on src/index.css + src/products/sat/ui must be EMPTY.
8. Contrast recompute (verify, not eyeball): neutral dot #6e6e73 on white 4.5:1 or better (about 5.07 PASS), warning/secondary/info/success/danger text values unchanged from the audit table; white-on-accent 4.70 PASS untouched (SessionControls primary unchanged in hue).
9. Build + a11y (Phase 06 owns the full run, but this phase must not break it): npx vite build and the existing e2e:sat-a11y session-room scenario (listbox keyboard + banner roles) stay green.

## Definition of done (checklist, measurable)

- [ ] rg for text-8px/text-9px in owned file: 0 matches; rg for text-10px: 0 matches (floor 11px holds).
- [ ] rg for bg-slate-300/bg-emerald-500/#9b9a97 in owned file: 0 matches; dots resolve to --sat-staff-neutral-dot / -success-dot / -warning-dot.
- [ ] Stray trailing-0 class on line 46 removed (no bracket-zero substring in file).
- [ ] Roster rows render exactly 2 p nodes per option (name 13px + merged section-status 11px) with timer 12px tabular alone on the right; min-h-56px.
- [ ] Stage hero clock still text-36px tabular-nums tracking -0.045em; stage h1 17px/-0.025, detail h2 17px/-0.025, detail timer 17px tabular; no 25px/22px/19px sizes remain.
- [ ] All three SatEyebrow overrides (Current stage / Session / Student) deleted; eyebrows inherit the 11px caps primitive.
- [ ] Filter chips min-h-7 text-12px, aria-pressed + toggle semantics unchanged; Needs attention string unchanged.
- [ ] Attention filter, stage clock, SessionControls, stale/message banners, listbox keyboard, confirm strings, clock wiring all behavior-identical (17 existing tests green UNMODIFIED + 4-5 new hierarchy tests green).
- [ ] npx vitest run src/products/sat + npx tsc --noEmit + npx eslint on touched files + npx vite build all green; git diff --name-only shows no .sat-ui, src/index.css, or primitive leakage.
- [ ] 320px (stack, truncate, clock wraps below title) + 200% text (no clip, rows grow) + reduced-motion/transparency/contrast + forced-colors spot-checked with no new violations.
