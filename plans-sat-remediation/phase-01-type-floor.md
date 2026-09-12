# Phase 01 — Type floor, contrast, density tokens + primitives

## Objective

Eliminate every sub-11px glyph in the SAT staff workspace, freeze the 6-step type
scale plus contrast floor plus minimum target sizes in tokens and the SatPage.tsx
primitive layer, and apply mechanical class swaps in SatRoot.tsx plus 5 routes
(SatResultsRoute, SatResultDetailRoute, SatSessionRoomRoute,
SatSessionsRoute, SatExamLibraryRoute) plus InfoRow. No layout
restructuring, no behavior change, no copy change beyond the audit-mandated token
remaps. Phase 02 and later build on the frozen scale defined here.

Audit drivers: CRITICAL sub-minimum type (8px and 9px, iOS min 11pt and macOS min 10pt);
HIGH (a) 11-step scale (9,10,11,12,13,14,16,18,19,22,30 plus one-off 25, 36, 52
heroes) compress to 6 steps; HIGH (b) is Phase 05 work (this phase only preserves the
light tokens and must not pre-build dark); HIGH (c) row-density cap is enforced
only via the type floor (roster and Results 3 to 2 line restructure belongs to
Phase 02 and Phase 04, not here). MEDIUM contrast and target fixes owned here: neutral dot
#9b9a97 to #6e6e73, chevron slate-300 to slate-400, search-clear 24px to 28px min, filter
chips min-h-8 to 28px equivalent.

## Dependencies

- Requires: plans-sat-remediation/overall-plan.md sections 2 to 5 (tokens to primitives to pages
  direction; frozen 6-step scale; contrast floor; target sizes; motion rules).
- Blocks: Phase 02 (needs frozen type scale plus contrast floor before status and copy work),
  Phase 03 (dirty-guard touches dialogs that sit on these tokens), Phase 04 (roster and detail
  compress), Phase 05 (dark variants extend the token block frozen here).
- Parallelization: Phase 01 runs alone in Wave 1 (overall-plan section 4) — it touches the
  shared .sat-product block and SatPage.tsx that every later phase reads.
- No dependency on student-delivery (.sat-ui), backend, auth, or network changes.

## Affected / new files (with line refs where known)

Scope is strictly src/index.css (.sat-product block) plus src/products/sat/.
No .sat-ui diff. No new source files except test additions under existing __tests__ directories.

1. src/index.css — .sat-product token block, currently lines 1592 to 1700
   (base tokens), 1702 to 1710 (slate remap), 1731 to 1740 (.sat-search-clear rule),
   1771 to 1830 (reduced-transparency plus contrast blocks), 1832 to 1915 (forced-colors).
   - Line 1674: --sat-staff-neutral-dot: #9b9a97 becomes fixed value (only hex change here).
   - Line 1647: --sat-staff-text-disabled: #9b9a97 — READ-ONLY in this phase; it is a
     disabled-text token, not the audited neutral dot. Do not change (would alter
     disabled-state contrast semantics owned by no phase; flag to Phase 06 if needed).
   - Lines 1735 to 1740: .sat-search-clear 32px rule retargeted to 28px min (see Step 3).
   - Add: frozen 6-step type-scale documentation comment plus optional
     --sat-staff-type-* aliases (Step 1). No other token renames.
2. src/products/sat/ui/SatPage.tsx (442 lines) — primitives layer.
   - Line 83: .sat-search-clear button h-6 w-6 (24px) becomes 28px (Step 4).
   - Lines 173 to 187 TONE_DOT_CLASS: 5 neutral entries with fallback #9b9a97
     become #6e6e73 (Step 2). TONE_PILL_CLASS (lines 142 to 156) untouched.
   - Lines 33, 199, 283, 285, 391, 404: existing text-[10px] eyebrow and pill and
     stat-label and hint and release-tag usages — READ-ONLY in this phase. They render at
     10px via Tailwind but the shipped contrast values already pass; the audit compress
     mandate moves the floor (8 and 9 to 11) only. Raising every 10px to 11px is
     explicitly out of scope (would reflow every row and card and belongs to
     a future density pass, not this audit). Document as intentional exception in the
     grep gate (see Verification).
   - SatEyebrow (lines 394 to 408): accepts className override already — call-site
     text-[9px] overrides are removed at call sites (Step 5), no primitive change.
3. src/products/sat/SatRoot.tsx (195 lines) — mechanical swaps only:
   - Line 123: role line text-[9px] becomes floor.
   - Line 142: mobile badge text-[9px] becomes floor.
   - Line 177: bottom-tab text-[9px] becomes floor.
   - (Line 70 desktop badge is already text-[11px] — untouched. Line 73
     text-[10px] Workspace and line 120 text-[10px] avatar — untouched per item 2 above.)
4. src/products/sat/routes/SatResultsRoute.tsx (139 lines):
   - Line 118: text-[8px] outcome line — READ-ONLY here (deletion owned by Phase 02,
     overall-plan Ownership map). Phase 01 must not delete it.
   - Line 121: chevron text-slate-300 becomes text-slate-400.
   - Lines 113 to 114 text-[10px] meta lines — untouched (floor exception).
5. src/products/sat/routes/SatResultDetailRoute.tsx (178 lines):
   - Line 96: text-[9px] scored and outcome summary line becomes floor.
   - Line 110: text-[9px] adaptive-route line becomes floor.
   - Lines 111 to 112: two text-[8px] Raw and Practice-score labels become floor (keep the
     uppercase tracking-[0.1em] styling, change size class only).
   - Line 127 jargon sentence (Module identifiers as delivered.) — READ-ONLY
     (deletion owned by Phase 02).
6. src/products/sat/routes/SatSessionRoomRoute.tsx (290 lines):
   - Line 162: cohort text-[9px] becomes floor.
   - Lines 163 to 165: Overrun and Reconnecting and attention pills text-[9px] become floor.
   - Line 176: text-[9px] joined-active count becomes floor.
   - Lines 179 to 180: filter chips min-h-8 (32px) become min-h-7 (28px) (Step 7).
   - Line 211 plus 227 plus 284: three SatEyebrow className text-[9px] overrides
     drop the text-[9px] token from the override (keep tracking-[0.13em]),
     letting the primitive default render (eyebrow is the sanctioned caps bridge exception).
   - Line 222: empty-state UserRound text-slate-300 becomes text-slate-400.
   - Line 273 (roster row): two text-[8px] (section plus status) become floor.
   - Line 285 (detail stat cards): three text-[9px] dt labels become floor.
   - Line 286: violation description text-[9px] becomes floor.
   - Line 290 InfoRow: dt text-[8px] becomes floor.
   - Lines 45 and 47 bg-slate-300 student-tone dots — READ-ONLY (status-dot tones for
     terminated and connecting and idle; remapping them to the neutral-dot token changes
     status semantics and is not the audited chevron fix; flag to Phase 02 which owns
     status language).
   - Line 173 empty-state dot bg-slate-300 in SatSessionsRoute.tsx — same:
     READ-ONLY for the same reason.
7. src/products/sat/routes/SatSessionsRoute.tsx:
   - Line 162: chevron text-slate-300 becomes text-slate-400.
   - Lines 158 to 159, 173, 235 to 236 text-[10px] and bg-slate-300 — untouched per above.
8. src/products/sat/routes/SatExamLibraryRoute.tsx:
   - Line 137: archive chip min-h-8 becomes min-h-7 (Step 7).
   - Line 151: chevron text-slate-300 becomes text-slate-400.
   - Lines 148, 174 text-[10px] — untouched per above.

## Contracts / interfaces (frozen inputs from Phase 01 if relevant; what you must not break)

These are the contracts Phase 01 FREEZES (later phases consume them) and the
contracts it must NOT break:

1. Frozen 6-step type scale (overall-plan section 5; audit HIGH-a). After this phase:
   - H1 30px with -0.045 tracking (SatPageHeader h1; ResultDetail h1; NOT the room 25px stage
     title — that one-off stays 25px, documented exception).
   - Hero: 52px with -0.045 tabular ResultDetail total (line 95) plus 36px room stage
     clock (line 212) — both already correct, untouched.
   - H2 16 to 17px with -0.025 (stat values 22px stay; section titles 13px stay; 17px Results
     score stays; ConfirmDialog 18px and 19px titles stay — compressing them is out of scope).
   - Title and body 13 to 14px with -0.012 (row titles 13 and 14px stay).
   - Control and hint 12px semibold (buttons, attention heading stay).
   - Floor 11px medium and above — everything that was 8 and 9px lands here.
   - Eyebrow 11px caps with 0.12 bridge: the primitive ships text-[10px] uppercase
     tracking-[0.14em]; call-site eyebrow overrides keep their tracking and drop to
     the primitive default. Do not invent a new eyebrow component.
2. satOutcomeTone single table (SatPage.tsx lines 166 to 171) — untouched; Phase 02 extends
   discipline to session tones. TONE_PILL_CLASS untouched.
3. Contrast floor: all text at least 4.5 to 1 (tertiary #6e6e73 at 5.07, secondary #515154 at 7.91,
   info-text #0067c9 at 5.55, success #067647 at 5.69, warning #92400e at 7.09, danger #b42318
   at 6.57, white-on-accent at 4.70 — all PASS, do not touch); dots at least 3 to 1 (success 3.77 ok,
   warning 3.19 ok; neutral 2.81 FAIL becomes fixed to 5.07 here). Chevron maps to tertiary
   via the existing .sat-product .text-slate-400 remap (index.css line 1704) — no new CSS.
4. Targets: primaries and rows keep 44px behavior (coarse-pointer floor plus min-h-11 and min-h-12
   untouched); search-clear becomes 28px; filter chips become 28px (min-h-7).
5. Motion and system answers preserved: capped stagger (first 6, Math.min(i,5) call sites
   untouched), MotionConfig reducedMotion user, reduced-motion and transparency and contrast and
   forced-colors blocks in index.css untouched except the neutral-dot value plus search-clear
   numbers. Glass-only-on-nav, Cancel-focused alerts, skeleton-XOR, empty-state actions,
   radiogroup-segmented plus listbox-roster keyboard, sidebar sign-out position — all untouched.
6. Must-not-break test contracts: SatPage.test.tsx (pill dot, search clear and Escape,
   row stagger, pending button, skeleton shimmer, empty state, stat strip, outcome table,
   result count), satContractsCss.test.ts (F-A6 search-clear rule, F-A12 route-fade
   guard — F-A6 assertions MUST be updated to the new 28px numbers), Dialogs,
   Menu, SegmentedControl, useSatListParams, all four route tests
   (SatExamLibraryRoute, SatSessionsRoute, SatResultsRoutes,
   SatSessionRoomRoute), SatRoot.test.tsx, scheduleValidation.test.ts.
   No test may be weakened to pass (only F-A6 numbers change, because the contract itself
   changes 32 to 28px).

## Step-by-step implementation (ordered, each step names exact file + exact change: old class/token → new class/token, old string → new string)

Order matters: tokens first, then primitives, then pages, then tests. Do not reorder.

Step 1 — src/index.css (near line 1606 comment plus line 1674 token): freeze scale docs,
fix neutral dot.
  1a. In the Staff foundation comment (lines 1606 to 1609), append a
      frozen-scale note (comment-only, no token rename):
      Type scale (frozen Phase 01): H1 30 with -0.045; hero 52 with -0.045 tabular plus 36 clock;
      H2 16-17 with -0.025; title and body 13-14 with -0.012; control and hint 12 semibold;
      floor 11 medium; eyebrow 11 caps with 0.12 (primitive ships 10px bridge, do not go below).
      Contrast floor: text at least 4.5 to 1, dots at least 3 to 1. Neutral dot #6e6e73 (5.07 to 1).
  1b. Line 1674 old to new (exact):
      old:   --sat-staff-neutral-dot: #9b9a97;
      new:   --sat-staff-neutral-dot: #6e6e73;
      (Forced-colors line 1882 GrayText stays. Dark variants are Phase 05 — do not add.)

Step 2 — src/products/sat/ui/SatPage.tsx lines 181 to 185: neutral-dot fallbacks.
  Old (5 lines, one each for draft and archived and finished and cancelled and neutral):
    bg-[var(--sat-staff-neutral-dot,#9b9a97)]
  New (5 lines):
    bg-[var(--sat-staff-neutral-dot,#6e6e73)]
  Keep the var() wrapper (call sites without the token still get the fixed hex).

Step 3 — src/index.css lines 1731 to 1740: search-clear target 32 to 28px.
  Old comment and rule:
    F-A6 search-clear fit: the in-field clear button stays vertically centered
    at a compact 32px target, explicitly exempted from the coarse 44px floor
    above (equal-specificity override placed after it) so it never overlaps
    the search glyph or clips the input edge.
    .sat-product .sat-search-clear: top 50 percent, translateY(-50 percent),
    min-block-size 32px, min-inline-size 32px (both important).
  New: same text with 28px target and 28px minima (both important).
  Exact new rule:
    .sat-product .sat-search-clear { top: 50% !important; transform: translateY(-50%);
      min-block-size: 28px !important; min-inline-size: 28px !important; }

Step 4 — src/products/sat/ui/SatPage.tsx line 83 (SatSearchField clear button):
  old: className sat-search-clear absolute right-2 top-2 flex h-6 w-6 items-center ...
  new: className sat-search-clear absolute right-2 top-2 flex h-7 w-7 items-center ...
  (Rest of the class string unchanged: justify-center rounded-full tertiary text etc.
  stays. h-7 w-7 is 28px so the Tailwind box matches the CSS min-target.)

Step 5 — Floor swaps: every text-[8px] becomes text-[11px], every text-[9px] becomes
text-[11px], preserving all other classes. Exact call sites:
  - src/products/sat/SatRoot.tsx line 123: old mt-0.5 text-[9px] capitalize text-slate-400
    becomes mt-0.5 text-[11px] capitalize text-slate-400.
  - SatRoot.tsx line 142: old rounded-[8px] badge with text-[9px] becomes text-[11px]
    (keep SAT glyph; 28px box already fits 11px).
  - SatRoot.tsx line 177: old rounded-xl text-[9px] font-semibold becomes text-[11px] font-semibold
    (bottom-tab labels; min-h-12 min-w-[72px] unchanged — no overlap at 320px because
    labels are short: Exams, Sessions, Results).
  - SatResultDetailRoute.tsx line 96: old mt-2 text-[9px] font-semibold uppercase tracking-[0.13em]
    becomes mt-2 text-[11px] font-semibold uppercase tracking-[0.13em].
  - SatResultDetailRoute.tsx line 110: old mt-1 text-[9px] font-medium becomes
    mt-1 text-[11px] font-medium.
  - SatResultDetailRoute.tsx line 111: old mt-1 text-[8px] font-semibold uppercase tracking-[0.1em]
    (Raw) becomes mt-1 text-[11px] font-semibold uppercase tracking-[0.1em].
  - SatResultDetailRoute.tsx line 112: same old to same new (Practice score).
  - SatSessionRoomRoute.tsx line 162: old mt-0.5 truncate text-[9px] becomes
    mt-0.5 truncate text-[11px].
  - SatSessionRoomRoute.tsx line 163: old px-2 py-1 text-[9px] font-semibold warning-text
    becomes same with text-[11px] (Overrun pill).
  - SatSessionRoomRoute.tsx line 164: old text-[9px] font-semibold tabular-nums
    becomes text-[11px] (Reconnecting).
  - SatSessionRoomRoute.tsx line 165: old px-2.5 py-1.5 text-[9px] font-semibold tabular-nums
    becomes text-[11px] (attention pill).
  - SatSessionRoomRoute.tsx line 176: old mt-0.5 text-[9px] tabular-nums becomes
    mt-0.5 text-[11px] tabular-nums.
  - SatSessionRoomRoute.tsx line 211: old SatEyebrow className text-[9px] tracking-[0.13em]
    with Current stage becomes bare SatEyebrow with Current stage (drop override entirely).
  - SatSessionRoomRoute.tsx line 227: old SatEyebrow override with Session becomes bare SatEyebrow.
  - SatSessionRoomRoute.tsx line 273 (roster row): old mt-1 truncate pl-3.5 text-[8px]
    becomes mt-1 truncate pl-3.5 text-[11px]; and old mt-1 text-[8px] capitalize
    becomes mt-1 text-[11px] capitalize.
    (Name stays 11px semibold; time stays 11px — row keeps 64px min-h, still 2 lines.)
  - SatSessionRoomRoute.tsx line 284: old SatEyebrow override with Student becomes bare SatEyebrow.
  - SatSessionRoomRoute.tsx line 285: old dt text-[9px] (3 places: Current module,
    Time remaining, Attempt) becomes dt text-[11px]; dd values unchanged.
  - SatSessionRoomRoute.tsx line 286: old mt-1 text-[9px] leading-4 violation description
    becomes mt-1 text-[11px] leading-5 (bump leading 4 to 5 so 11px descenders do not collide).
  - SatSessionRoomRoute.tsx line 290 InfoRow: old dt text-[8px] font-semibold uppercase tracking-[0.1em]
    becomes dt text-[11px] font-semibold uppercase tracking-[0.1em] (dd text-[11px] unchanged).

Step 6 — Chevron remap: text-slate-300 becomes text-slate-400 on chevron slots only
(the remap at index.css line 1704 turns slate-400 into tertiary #6e6e73 at 5.07 to 1):
  - SatSessionsRoute.tsx line 162: old sat-row-chevron shrink-0 text-slate-300 group-hover:text-slate-500
    becomes same with text-slate-400.
  - SatResultsRoute.tsx line 121: old sat-row-chevron hidden shrink-0 text-slate-300 group-hover:text-slate-500 sm:block
    becomes same with text-slate-400.
  - SatExamLibraryRoute.tsx line 151: old sat-row-chevron shrink-0 text-slate-300 group-hover:text-slate-500
    becomes same with text-slate-400.
  - SatSessionRoomRoute.tsx line 222: old UserRound size 24 className text-slate-300
    becomes className text-slate-400 (empty-state icon).
  - Do NOT touch bg-slate-300 dots (SessionRoom lines 45 and 47, Sessions line 173) — see Affected item 6.

Step 7 — Filter chips 32 to 28px (min-h-8 becomes min-h-7, keep all other classes):
  - SatSessionRoomRoute.tsx lines 179 plus 180 (All and Needs attention): old min-h-8 rounded-full px-3 text-[10px]
    becomes min-h-7 rounded-full px-3 text-[10px].
  - SatExamLibraryRoute.tsx line 137 (Show and Hide archived): old min-h-8 shrink-0 rounded-full px-3 text-[10px]
    becomes min-h-7 shrink-0 rounded-full px-3 text-[10px].
  - (SegmentedControl options are NOT chips — .sat-segmented-option CSS owns their size; untouched.)

Step 8 — Update the changed contract: src/products/sat/ui/__tests__/satContractsCss.test.ts
F-A6 test (lines 8 to 15): 32px becomes 28px in both assertions:
  old min-block-size 32px important becomes 28px important;
  old min-inline-size 32px important becomes 28px important.
  Title string may note 28px (optional, keep F-A6 prefix).

Step 9 — Add new contract tests (see Tests items 1 to 3), then run Verification.

## Key code / pseudocode (dirty-guard logic, token blocks, row markup — only what your phase needs)

No dirty-guard logic in this phase (Phase 03). Only token blocks plus row markup deltas:

CSS — Phase 01 frozen additions in src/index.css .sat-product block:
  --sat-staff-neutral-dot: #6e6e73; // was #9b9a97; 2.81 to 1 becomes 5.07 to 1 on white, meets 3 to 1 dot floor
  .sat-product .sat-search-clear { top: 50% !important; transform: translateY(-50%);
    min-block-size: 28px !important; min-inline-size: 28px !important; } // was 32px

TSX — SatPage.tsx TONE_DOT_CLASS neutral family after fix (5 identical lines):
  neutral: double-quoted bg-[var(--sat-staff-neutral-dot,#6e6e73)] double-quoted,
  (draft and archived and finished and cancelled share the same string)
  SatSearchField clear button is 28px box:
    className sat-search-clear absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full ...
  InfoRow after fix (SessionRoom line 290): dt text-[11px] font-semibold uppercase tracking-[0.1em],
  dd mt-1 text-[11px] font-semibold.
  Roster row after fix (SessionRoom line 273): still min-h-[64px], 2 text lines per side,
  section line mt-1 truncate pl-3.5 text-[11px], status line mt-1 text-[11px] capitalize.
  Eyebrow overrides after fix: bare primitive, for example SatEyebrow with Current stage
  (10px bridge from primitive, tracking from primitive).

## Edge cases (empty states, loading/error, polling refresh, keyboard, reduced-motion/transparency/contrast, forced-colors, 320px, 200% text)

- Empty states: no size change to empty titles (16px) and hints (12px) and actions; only the
  room empty icon (slate-300 to 400) changes. Sessions empty dot stays bg-slate-300 (intentional,
  non-text). Verify empty copy still wraps at 320px after floor bumps (11px lines are wider —
  cohort and student-id lines already truncate, so no overflow).
- Loading and error: skeleton (shimmer bars, no text) and SatInlineError (14px and 12px) untouched;
  SatResultCount (11px) untouched. Polling Updating lines are 11px already — untouched.
- Polling refresh: roster rows re-render on the 1s and 15s authoritative clock; class-only changes
  introduce no new renders, no timer changes, no layout thrash (font-size bumps are paint-only
  within fixed min-h rows; 64px roster min-h absorbs the 8 to 11px growth).
- Keyboard: no tabindex and role and aria change; listbox arrow-key nav, radiogroup segmented control,
  search Escape-to-clear, and skip-link all preserved. Focus-visible ring tokens untouched.
- Reduced-motion: stagger cap (first 6) and MotionConfig reducedMotion user untouched;
  size changes do not animate. Reduced-transparency glass fallbacks untouched.
- Contrast: recompute after the fix — neutral dot on white must read at least 3 to 1 (about 5.07 to 1 with
  #6e6e73); chevron slate-400 remaps to tertiary (#6e6e73, 5.07 to 1). Forced-colors block
  (GrayText and CanvasText) already covers the new dot value — no edit needed.
- 320px: bottom-tab labels at 11px in 72px min-width tabs still fit (short labels, centered);
  header pills (Overrun and Reconnecting and attention) may wrap under the title on narrow screens —
  existing flex layout already allows it; verify no horizontal scroll in room header at 320px.
- 200 percent text: floor-raised labels (11px) scale with user font settings like before; stat-card
  grid (sm:grid-cols-3) stacks on narrow widths already; verify the 3-card dl does not clip
  at 200 percent (cards grow vertically by design).
- Truncation: cohort line (room line 162) goes 9 to 11px but keeps truncate; long cohort names still
  ellipsis rather than push header actions off-screen.

## Tests (which existing tests must pass; which new unit/contract tests to add, with file paths and assertion sketches)

Existing (must all pass unmodified, except F-A6 numbers in Step 8):
1. src/products/sat/ui/__tests__/SatPage.test.tsx — pill dot, search clear and Escape, row
   stagger, pending button, skeleton shimmer, empty state, stat strip, outcome table, result count.
2. src/products/sat/ui/__tests__/satContractsCss.test.ts — F-A12 route-fade guard unchanged;
   F-A6 updated 32 to 28px.
3. src/products/sat/ui/__tests__/Dialogs.test.tsx, Menu.test.tsx,
   SegmentedControl.test.tsx, useSatListParams.test.tsx.
4. src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx,
   SatSessionsRoute.test.tsx, SatResultsRoutes.test.tsx,
   SatSessionRoomRoute.test.tsx, scheduleValidation.test.ts.
5. src/products/sat/__tests__/SatRoot.test.tsx.

New tests to add (implementation agent writes them; sketches only here):
1. src/products/sat/ui/__tests__/satTypeFloor.test.ts (new) — static source gate mirroring
   the grep exit gate so CI catches regressions. Sketch: read the 7 known files
   (SatRoot.tsx, SatResultsRoute.tsx, SatResultDetailRoute.tsx,
   SatSessionRoomRoute.tsx, SatSessionsRoute.tsx, SatExamLibraryRoute.tsx, SatPage.tsx);
   expect each source not to match text-[8px]; expect each source not to match text-[9px];
   intentional exceptions allowlist: SatResultsRoute line 118 8px line (Phase 02 deletes it)
   plus SatPage and ConfirmDialog eyebrow and pill 10px bridge (documented, not asserted).
   Assert neutral-dot fallback: source contains --sat-staff-neutral-dot with #6e6e73;
   assert no stale fallback remains: source does not contain #9b9a97.
   Keep the Results line 118 carve-out with a TODO Phase 02 comment so the gate turns fully
   strict the moment Phase 02 lands its deletion.
2. src/products/sat/ui/__tests__/satContrastTokens.test.ts (new) — token-value contract.
   Sketch: read src/index.css; extract --sat-staff-neutral-dot value; expect #6e6e73;
   extract .sat-search-clear min-block and inline-size; expect 28px;
   assert chevron slots use text-slate-400 (read the 3 route files, expect zero
   sat-row-chevron with text-slate-300 occurrences).
3. Extend satContractsCss.test.ts (existing file, Step 8) — no new file; the 28px F-A6
   update IS the chip and clear target regression test. Optionally assert
   min-h-7 present in the two chip call sites via source read (or leave to the grep gate).

## Verification (exact commands: vitest paths, tsc, eslint, grep gates, contrast recompute)

Run in repo root, in this order. All must be green before Phase 02 and later unlock.

  1. SAT unit plus contract suite: npx vitest run src/products/sat
  2. Typecheck: npx tsc --noEmit
  3. Lint scoped: npx eslint src/products/sat src/index.css
     (whole-repo npm run lint also acceptable)
  4. Grep gates — sub-11px floor (zero allowed outside documented exceptions):
     rg -n text-[8px] pattern src/products/sat — expect clean except Results line 118;
     rg -n text-[9px] pattern src/products/sat — expect clean (zero hits).
     Expected after Phase 01: ONLY src/products/sat/routes/SatResultsRoute.tsx line 118 (8px,
     Phase-02-owned deletion) may still match. Every other hit is a Phase 01 defect.
  5. Chevron gate — zero slate-300 chevrons remain:
     rg -n sat-row-chevron with slate-300 src/products/sat — expect clean.
  6. Neutral-dot gate — new value present, old value gone from SatPage fallbacks:
     rg -n neutral-dot with #9b9a97 src/products/sat — expect clean (stale fallback present is defect);
     rg -n --sat-staff-neutral-dot: #6e6e73 src/index.css — expect one hit.
  7. Target-size gates:
     rg -n sat-search-clear src/index.css (expect 28px rule);
     rg -n min-h-8 src/products/sat/routes — expect clean (no min-h-8 left in routes).
  8. No .sat-ui leakage: git diff --stat for sat-ui paths; git diff for sat-ui paths (expect empty).
  9. Production build: npm run build
  10. A11y e2e (or documented equivalent if runner unavailable): npm run e2e:sat-a11y
  11. Contrast recompute — verify with any WCAG calculator (relative-luminance):
     #6e6e73 on #ffffff must be at least 4.5 to 1 as text (about 5.07 to 1) and at least 3 to 1 as dot and chevron.
     Record the computed ratio in the implementation report; do not eyeball.

## Definition of done (checklist, measurable)

- [ ] rg text-[8px] hits only SatResultsRoute.tsx line 118 (Phase-02-owned); rg text-[9px] hits zero.
- [ ] --sat-staff-neutral-dot is #6e6e73 in src/index.css; zero #9b9a97 fallbacks left
  in SatPage.tsx (TONE_DOT_CLASS 5 places all #6e6e73).
- [ ] .sat-search-clear CSS min is 28px both axes; primitive button is h-7 w-7;
  F-A6 contract test asserts 28px and passes.
- [ ] All 4 chevron slots plus room empty icon are text-slate-400; zero slate-300 chevrons.
- [ ] All 3 filter and archive chips are min-h-7; zero min-h-8 in src/products/sat/routes.
- [ ] Frozen 6-step scale comment present in src/index.css; no token renamed; no dark block
  added (Phase 05); no .sat-ui diff.
- [ ] npx vitest run src/products/sat green (including 2 new test files plus updated F-A6).
- [ ] npx tsc --noEmit green; npx eslint src/products/sat src/index.css green.
- [ ] npm run build green; npm run e2e:sat-a11y green (or documented equivalent).
- [ ] Contrast ratio for #6e6e73-on-white recomputed and recorded (at least 4.5 to 1 text, at least 3 to 1 dot).
- [ ] No behavior change: filtering, polling intervals, proctor actions, confirm flows,
  routing, keyboard, motion, skeleton-XOR, empty-state actions all verified unchanged
  (existing route tests passing is the evidence).