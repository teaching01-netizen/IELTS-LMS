# Phase 04A - List Pages (Library, Sessions, Results) - Implementation Plan

Stage: PLAN ONLY - no product code edited. Implementation agent executes this file.
Scope boundary: SAT staff workspace only (`src/products/sat/`` plus `.sat-product` CSS in `src/index.css`). Exam-mode Bluebook (`.sat-ui`, `src/features/student-delivery/``) is READ-ONLY. IELTS surfaces plus backend are out of scope.
Style direction (2026, per overall plan): soft spatial UI, glass sparingly with solid fallback, bento where it pays, editorial type, 2026 components, 150-200ms motion, no springs in lists, no neon or gradients or neumorphism.

---

## 1. Objective

Compose Phase-03 primitives into three confident, coherent bento list experiences without changing behavior:

- `src/products/sat/routes/SatExamLibraryRoute.tsx` - Exam Library list plus New SAT sheet.
- `src/products/sat/routes/SatSessionsRoute.tsx` (plus `NewSatSessionSheet` defined in the same file) - Sessions list plus bucket filter plus New Session sheet.
- `src/products/sat/routes/SatResultsRoute.tsx` - Results list plus score-availability filter.

Concretely:

- Editorial headers: keep confident 30px titles; tighten description copy to one clause each; keep `SatPageHeader` eyebrow plus title plus description plus actions composition, only adjust responsive wrap.
- StatStrip-as-bento: Sessions plus Results `SatStatStrip` becomes a true 3-up bento summary (label eyebrow plus 22px tabular value plus optional hint line); Library stays header-only (do not invent counts).
- Search plus filter rhythm: one shared vertical rhythm - header, then stat bento, then segmented or filter row, then result-count live line, then list or empty - identical spacing across the three routes.
- Row hierarchy: title 13-14px semibold, meta 10-11px secondary, timestamps plus counts plus scores with tabular-nums; trailing `SatStatusPill` (dot plus label) plus always-visible `.sat-row-chevron`.
- Empty states: one human detail max per state (existing copy already complies - preserve, only re-tone where noted).
- Filters preserved exactly: archived toggle (Library), bucket segmented (Sessions), score-availability segmented (Results).
- Sheets: New SAT plus New Session sheets get 2026 field styling on Phase-01 tokens; zero validation or routing or facade change.
- No query, facade, validation, polling-interval, routing, or sorting change.

---

## 2. Dependencies

### 2.1 Hard dependencies (must land before 04A implementation starts)

- Phase 01 - Staff Token Foundation (`src/index.css`, `.sat-product` scope). 04A consumes these tokens; it does not define or rename them. Required token names (fork as `--sat-staff-*`, never mutate shared `.sat-ui` values):
  - `--sat-staff-canvas` (page, maps to #F5F5F7 family), `--sat-staff-surface` (cards plus rows plus sheets, solid fallback), `--sat-staff-surface-subtle`
  - `--sat-staff-border` plus `--sat-staff-border-strong` (1px hairlines), `--sat-staff-text` plus `--sat-staff-text-secondary` plus `--sat-staff-text-tertiary`
  - `--sat-staff-accent` (maps to `--sat-accent-core: #0071e3`), `--sat-staff-accent-hover`, `--sat-staff-accent-pressed`, `--sat-staff-focus` (focus ring)
  - `--sat-staff-radius-md` plus `-lg` plus `-xl` (about 12, 16, 20-24px), `--sat-staff-shadow-card` (0 1px 2px rgba(0,0,0,0.04) plus 0.5px hairline), `--sat-staff-shadow-pop` (sheets only)
  - `--sat-staff-motion` (150-200ms cubic-bezier(.2,0,0,1)), `--sat-staff-shimmer` (skeleton gradient stops)
  - Status tone tokens are consumed through `SatStatusPill` plus `satOutcomeTone` only (04A never hardcodes tone hex).
- Phase 03 - List-System Primitives (`src/products/sat/ui/SatPage.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `ConfirmDialog.tsx`). 04A is a pure call-site composition layer: it must compile unchanged against the Phase-03 exported API. Any Phase-03 visual change flows through automatically; 04A adds no primitive CSS.

### 2.2 Dependency requirements on Phase 01 plus 03 (requests, NOT 04A edits)

04A must not edit `src/index.css` or `src/products/sat/ui/*`. If any item below is missing after Phase 01 plus 03, file a drift flag and use the documented fallback instead of editing outside ownership:

1. StatStrip bento density: 04A expects `SatStatStrip` to accept current props `{ stats: SatStat[]; label?: string }` where `SatStat = { id; label; value; hint?; onSelect? }` and to render bento card classes internally (tokenized). Fallback: if hint support is missing, use label plus value only (no per-route hint markup - call sites must not hand-roll stat cards; they own content, not frame CSS).
2. Row frame tokens: 04A expects `SatListRow` to keep signature `{ onOpen; ariaLabel?; children; index? }`, root classes `.sat-list-row` (plus `.sat-row-enter` plus `--sat-row-index` when index is given), and tokenized border plus shadow plus focus. 04A passes `index={Math.min(rowIndex, 5)}` (capped stagger, first 6 rows) and never adds its own entrance animation.
3. Search plus button plus dialog APIs: `SatSearchField { id; label; value; onChange; placeholder; widthClassName? }`, `SatPrimaryButton { onClick; icon?; ariaLabel?; pending?; disabled? }`, `SatFormDialog { open; eyebrow; title; onClose; children }`, `SatConfirmDialog { open; title; description; confirmLabel; destructive?; onCancel; onConfirm }`, `SatSegmentedControl { label; value; options; onChange; className? }` - all backward compatible. No new props required.
4. Outcome tone table: `satOutcomeTone(outcome: string): SatStatusTone` frozen mapping (scored maps to ready, pending maps to pending, invalidated proctor plus timeout map to invalidated, else neutral). If Phase 03 extends tones, 04A keeps importing the table and does not fork.

### 2.3 Wave plus gate position

- Wave 3, parallel with Phase 04B (disjoint route ownership). Unlocks only when 01 plus 03 are implemented plus tests plus typecheck plus lint pass plus Main Agent verifies. Never start early. Phase 05 runs after 04A plus 04B.

---

## 3. Affected plus new files

### 3.1 Owned - MAY edit during implementation (and only these)

- `src/products/sat/routes/SatExamLibraryRoute.tsx` (183 lines): header plus actions rhythm, archived-toggle restyle (tokenized), row content hierarchy, empty-state polish, New SAT sheet field styling. No logic change.
- `src/products/sat/routes/SatSessionsRoute.tsx` (248 lines, includes `NewSatSessionSheet` plus `randomScheduleId` plus `defaultTimes` plus `toLocalDateTimeInput` helpers in-file): header plus actions rhythm, StatStrip-as-bento wiring, segmented rhythm, row content hierarchy (multi-line meta to two-line plus inline counts), empty-state polish, New Session sheet field styling plus discard-confirm wiring untouched. No logic change.
- `src/products/sat/routes/SatResultsRoute.tsx` (138 lines): header plus actions rhythm, StatStrip-as-bento wiring, segmented rhythm, row content hierarchy (score block plus pill), empty-state polish, Updating cue placement. No logic change.

### 3.2 Explicitly NOT owned - READ-ONLY for 04A

- `src/products/sat/ui/SatPage.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `ConfirmDialog.tsx` (plus `__tests__/`) - Phase 03 ownership. Import only.
- `src/products/sat/SatRoot.tsx` - Phase 02.
- `src/products/sat/routes/SatSessionRoomRoute.tsx`, `SatResultDetailRoute.tsx`, `SatAccessRoute.tsx`, `src/products/sat/routes/scheduleValidation.ts` - Phase 04B plus shared validation. `scheduleValidation.ts` (pure `validateSatScheduleTimes(start, end, now?)`, 15-minute minimum, past-start rejection) is consumed as-is.
- `src/index.css` - Phase 01 (04A may rely on `.sat-product` classes but never adds rules).
- Data layer: `useExamListQuery`, `useProctorSessionSummaries`, `useSatResultsQuery`, `useSaveScheduleMutation`, `examAuthoringFacade`, `proctorFacade` - no query or facade or validation change.

### 3.3 New files

None. No new components, hooks, utils, or CSS files. If a shared list-layout helper seems tempting, do not create it - duplicate the short rhythm per route (call sites own content; primitives own the frame). Test additions go in existing test files (see section 8).

---

## 4. Contracts plus interfaces to preserve

Every item below is pinned by an existing test or CSS contract. Implementation must keep all green without updating expectations (except additive assertions listed in section 8).

### 4.1 Exam Library (`SatExamLibraryRoute.test.tsx`, 7 tests)

- Query boundary: `useExamListQuery(true, `-SAT-`)` with provider sat - exact args; provider filter `exam.providerKey === `-SAT-`` in render with sat value; IELTS entity never rendered. (Note: `-SAT-` here stands in for the quoted sat string literal.)
- Copy: eyebrow `Digital SAT`, title `Exam Library`, description keep (may tighten to same meaning: practice tests with adaptive Reading plus Writing plus Math modules).
- Search: `SatSearchField id sat-exam-search label Search SAT exams placeholder Search exams`; Escape clears; clear button for Search SAT exams; filtered-zero maps to `SatEmptyState title No matching SAT exams hint Try a different name.` plus `Clear search` action; pristine-zero maps to `title No SAT exams yet` plus human-detail hint (keep: create one exam, standard Digital SAT structure is ready immediately) plus `New SAT` action.
- Archived toggle: button with `aria-pressed` bound to showArchived and text Show archived or Hide archived; default hidden; toggling never clears search.
- List: sort by `updatedAt` descending; `SatResultCount` with total set to sat-only unfiltered count and visible set to exams length; `SatListSkeleton rows 5 label Loading SAT exams` while loading with header still rendered; `SatListRow index capped at 5` with open navigating to exam detail.
- Row content: title 14px semibold with tight tracking, meta question count plus formatted date at 10px; `SatStatusPill` tone from status mapping where Published maps to published, Changes maps to changes, Archived maps to archived, else draft; chevron `ArrowRight className sat-row-chevron` with aria-hidden.
- New SAT sheet: `SatFormDialog` open from createOpen with eyebrow Digital SAT and title New SAT; input with aria-label SAT exam name and id sat-title and placeholder Practice Test 06 and maxLength 255; autofocus via rAF with cleanup; no provider selector (assert absent Assessment provider); Create disabled when title is blank or creating; submit calls lifecycle createProviderExam with providerKey sat plus providerExamType SAT plus trimmed title, actor is displayName or email or Staff; success maps to invalidateExamList then close then navigate to exam detail; failure maps to role alert paragraph; helper caption keep (Reading plus Writing, Math, adaptive modules, plus SAT tool policy are created as part of the exam); Cancel closes quietly.
- Error: `ErrorSurface title Exam Library could not load actionLabel Retry onAction refetch`.

### 4.2 Sessions (`SatSessionsRoute.test.tsx`, 10 tests plus `scheduleValidation.test.ts`)

- Query boundaries: `useProctorSessionSummaries(4000, sat)` exact; `useExamListQuery` with admin flag plus sat exact; preview cohorts excluded via proctor facade check.
- Bucketing (frozen): bucket function over schedule status plus runtime status - live or paused or live maps to live; completed or cancelled maps to finished; else upcoming. Counts derive from the same function. Auto-switch: upcoming 0 with live above 0 maps to setBucket live effect, keep as-is.
- Copy: eyebrow `Digital SAT`, title `Sessions`, description keep (proctored SAT administrations across cohorts).
- Search: id sat-session-search label Search SAT sessions placeholder Search sessions; matches examTitle plus cohortName plus institution (case-insensitive); filtered-zero maps to title No matching sessions plus hint echoing query (No sessions match ...) plus Clear search; `SatResultCount` with total summaries and visible 0 stays visible in zero state (0 of 1 sessions); bucket-empty hints keep per bucket (scheduled sessions wait here; live sessions appear once a proctor starts them; completed sessions move here automatically).
- StatStrip: label Session summary plus the three stats Upcoming plus Live plus Finished - keep ids plus labels plus values exactly; bento is visual only (Phase-03 frame change, no prop change).
- Segmented: label Session status plus Upcoming plus Live plus Finished, keep max width 360 class baseline (spacing may move to the shared rhythm value - keep max-width).
- List: sort by startTime ascending; `SatResultCount` with total summaries and visible length; skeleton rows 5 label Loading SAT sessions with header rendered; row index capped at 5, navigate to session detail.
- Row status (frozen): runtime paused maps to Paused; live-bucket maps to Live; finished plus schedule cancelled maps to Cancelled; finished maps to Finished; else Ready; tones via status tone helper (Live maps to live plus pulse, Paused maps to paused, Ready maps to ready, Finished maps to finished, Cancelled maps to cancelled); pulse dot only for Live.
- Row content baseline: title 13px semibold examTitle; meta cohortName plus optional institution; time via format helper (weekday short, month plus day, hour plus minute) tabular; counts joined plus active tabular. 04A may re-flow (see 5.3) but must keep all four data points plus pill plus chevron.
- New Session sheet (admin-only trigger New Session with CalendarPlus): exam options filtered to provider sat with published version present (IELTS option never present); labels SAT exam (select), Session name (placeholder September Mock Morning, maxLength 255), Institution (plus Optional), Session start time plus Session end time (datetime-local, aria-invalid plus aria-describedby when errored); first-field autofocus rAF; local-timezone caption with formatted range; submit builds ExamSchedule with providerKey sat plus deliveryMode proctor_start plus autoStart false plus autoStop false plus status scheduled plus plannedDurationMinutes 0 via random id helper; validation via validate helper messages verbatim (Choose a start time; Enter a valid start time; Choose an end time; Enter a valid end time; Start time is in the past; End time must be after the start time; Sessions must be at least 15 minutes long) in role alert without clearing the form; create errors in a second role alert; Schedule and Scheduling disabled state; success maps to session invalidation then close then bucket upcoming plus search reset; dirty-Cancel (cohort or institution non-blank) maps to confirm dialog title Discard this session with description about lost details and confirmLabel Discard destructive, with Discard closing both and Cancel-return keeping the form; pristine-Cancel closes quietly.
- Error: `ErrorSurface title SAT sessions could not load actionLabel Retry`.

### 4.3 Results (`SatResultsRoutes.test.tsx`, 10 tests including detail plus back-label)

- Query: `useSatResultsQuery()` no args; search across studentName plus studentId plus examTitle plus cohortName.
- Copy: eyebrow `Digital SAT`, title `Results`, description keep (practice scores plus attempt outcomes).
- Search: id sat-results-search label Search SAT results placeholder Search results.
- Score filter (frozen): segmented label Score availability with value scoreFilter and options All plus Score available plus Score unavailable; available means outcomeStatus scored with totalScore present; empty maps to title No matching SAT results with hint about search or filter; pristine-zero maps to No SAT results yet with completed attempts hint; `SatResultCount` total all visible 0 stays visible (0 of 1 results).
- StatStrip: label Results summary plus Total plus Scored plus Awaiting where scored is the available-count and awaiting is total minus scored. Visual-only bento.
- List: skeleton rows 5 label Loading SAT results; navigate to result detail; index capped at 5; isFetching without isLoading maps to Updating cue next to count.
- Row content (frozen semantics): name 13px semibold; studentId plus cohortName; examTitle plus Version plus date; score is totalScore when scored else em dash at 17px semibold tabular; caption is outcome label plus Practice plus releaseStatus (8px uppercase); `SatStatusPill` tone from outcome tone helper with pill text outcome label; no IELTS band language anywhere. Outcome labels: invalidated_proctor maps to Exam terminated by proctor, invalidated_timeout maps to Exam ended before scoring, pending maps to Scoring pending, else maps to Practice. Note the test pins a double-Practice caption for scored rows plus exactly one exact-Practice pill across a mixed 3-row fixture - do not dedupe or reword.
- Error: `ErrorSurface title SAT results could not load actionLabel Retry`.

### 4.4 Primitive plus CSS plus a11y invariants (never break)

- Dot plus label: every `SatStatusPill` keeps dot aria-hidden plus text; color never carries state alone.
- Skeleton-XOR: render EITHER `SatListSkeleton` (loading) OR `SatResultCount` (loaded); `SatResultCount` returns null when total is 0 or below (except the two pinned zero-filter states where total is above 0 - those keep rendering).
- Live regions: `SatResultCount role status aria-live polite`; skeleton role status named; form plus sheet errors role alert; confirm dialogs role alertdialog.
- Roving tabindex plus radiogroup: segmented keeps radiogroup plus radio roles, aria-checked, selected tabIndex 0 with others -1, arrow-key move plus single sliding thumb.
- Focus: visible rings on all controls; Cancel-focused alerts; `SatFormDialog` Close with aria-label Close; sheet first-field autofocus.
- Targets: 44px minimum (coarse-pointer CSS floor); 32px search-clear exemption (`.sat-search-clear` top 50 percent with 32px) stays; CSS contract tests F-A6 plus F-A12 (route fade reduced-motion guard) stay green.
- Motion: 150-200ms ease-out, capped stagger first 6 rows (`--sat-row-index`), shimmer not pulse (`.sat-skeleton-shimmer`, no animate-pulse), full prefers-reduced-motion opt-out, no springs in lists, hover is border plus shadow only (never translate lift).
- Class hooks preserved: `.sat-list-row .sat-row-chevron .sat-row-enter .sat-segmented .sat-search-clear .sat-live-dot .sat-skeleton-shimmer .sat-dialog .sat-route-enter`.
- PII discipline: student names plus ids only in rendered rows plus search match; never in logs (no new logging).

---

## 5. Step-by-step implementation plan

Do steps in order. After each route, run its scoped tests before moving on. No logic-file edits at any step.

### Step 0 - Read plus baseline (no edits)

1. Re-read `plans/overall-plan.md` sections 1-4 (style plus layer rules) and this plan fully.
2. Read the three owned routes plus `src/products/sat/routes/scheduleValidation.ts` (41 lines, frozen) plus the Phase-03 primitives actually shipped (note any drift versus 2.2 and record it; use fallbacks, do not edit).
3. Baseline: typecheck plus scoped tests (see section 9) - record green before touching anything.

### Step 1 - Shared list rhythm (all three routes, markup-only)

Goal: identical vertical cadence so the three pages feel like one product. Apply the same wrapper order in each route: SatContainer, then SatPageHeader, then SatStatStrip on Sessions plus Results only (Library has no strip), then segmented control or filter row, then loading skeleton or count plus list or empty, with sheets plus portals last.

- Spacing sketch (tokens, not hex - Phase-03 classes already tokenize; call-site wrappers use layout utilities only):
  - StatStrip wrapper: keep the primitive margin-top 5 (do not add a second margin).
  - Filter row: margin-top 5 for segmented (max-w 360px Sessions, max-w 420px Results); Library count plus toggle row with flex items-center justify-between gap-3 (unchanged structure).
  - `SatList` keeps its internal margin-top 4; `SatResultCount` keeps margin-top 3. Do not stack extra margins that double the gap.
- Actions row (responsive, no behavior change):
  - Library: SatSearchField with small-viewport flex-1 plus fixed width at sm breakpoint plus New SAT button with Plus size 15. Keep the SatPageHeader actions fragment as-is; only verify wrap: search flex-1 on mobile, fixed width at sm plus above, button shrink-0.
  - Sessions: SatSearchField plus admin-only New Session button with CalendarPlus size 15. Same wrap check.
  - Results: single SatSearchField full width on mobile plus fixed width at sm plus above.
- Do not change copy beyond the one-clause tighten allowed in section 4; do not reorder header versus stats versus filters.

### Step 2 - Exam Library composition

1. Header: keep eyebrow plus title plus description plus actions. No stat strip (resist adding counts - Library has no summary concept; archived toggle is the secondary control).
2. Count plus archived row (loaded plus non-empty only, structure unchanged): keep the flex row with SatResultCount plus the toggle button with aria-pressed. Tokenize only: replace the accent focus ring literal with the staff focus token; replace the active slate surface plus idle black-alpha surface with staff surface tokens if Phase 01 provides semantic toggle tokens, else keep current values (visual parity beats token purity at call site - primitives own token migration; call-site literal cleanup is opportunistic, never structural). Keep min-h-8 (32px) - this is a secondary toggle, not a primary target; primary actions (New SAT, Create, Clear search) stay at 40px or above.
3. Rows: keep the SatListRow frame; re-tone inner spans only. Title stays 14px semibold with tight tracking; meta line is question count plus formatted date at 10px with tabular-nums (the only addition versus today is tabular-nums so counts plus dates align). Keep status label plus tone plus format helpers byte-identical. Keep pill plus chevron.
4. Empty states: keep titles plus hints plus actions exactly (one human detail already: standard Digital SAT structure is ready immediately). No illustration beyond the existing Plus icon in its 48px bordered tile.
5. New SAT sheet: inside SatFormDialog, tokenize field chrome only. Label 11px semibold keep; input h-12 rounded 12px keep geometry; swap border black-alpha for the staff border-strong token (fallback: keep literal if token missing), swap accent focus literals for staff accent plus focus equivalents; footer hairline maps to staff border; Cancel min-h-10 keep shape; Create min-h-10 maps to staff accent plus hover plus pressed plus disabled via staff tokens where available. Keep rAF autofocus plus cleanup, maxLength 255, role alert error, helper caption, plus Cancel plus Create behavior exactly.
6. Self-check: archived toggle aria-pressed, skeleton-XOR, provider filter, create flow - run Library tests.

### Step 3 - Sessions composition (list plus bento plus sheet)

1. Header plus bento: keep SatPageHeader; wire SatStatStrip with label Session summary plus the existing three stats unchanged. Bento elevation comes from Phase 03 - 04A adds no card markup. Verify the 3-up grid collapses gracefully at 360px (primitive grid-cols-3 with gap-2; if Phase 03 made stats clickable-bento, do NOT pass onSelect - bucket switching stays on the segmented control to preserve the auto-switch effect plus test contract).
2. Segmented rhythm: keep label Session status, options, plus max-w 360px class.
3. Count plus Updating cue: keep SatResultCount with total summaries plus visible length. Sessions has no refetch cue today - do NOT add one (Results owns that pattern; consistency is not uniformity).
4. Rows: keep frame plus status logic; compress meta lines to a two-line hierarchy with inline counts. Line 1 is examTitle at 13px semibold with tight tracking; line 2 is cohortName plus optional institution at 10px; line 3 is formatted start plus joined count plus active count at 10px tabular-nums. Rationale: the current 9px lines are the smallest type in the workspace; merging time plus counts into one 10px tabular line keeps every data point while lifting minimum size to 10px. If design review prefers keeping two 9px lines, that is acceptable - data parity matters, not the merge. Never drop time, cohort, institution, or counts. Keep bucket plus tone plus format helpers identical; keep sort by startTime ascending plus search fields plus auto-switch effect.
5. Empty states: keep titles plus hints plus actions plus query echo verbatim (one human detail per bucket hint already). Icon stays the 8px slate dot in the standard tile - do not invent illustrations.
6. New Session sheet (NewSatSessionSheet in-file): tokenize field chrome exactly like New SAT (select plus inputs h-11 rounded 11px, datetime grid with 2 columns at sm, footer, Cancel plus Schedule min-h-10), preserving: option filter, labels plus aria-labels, aria-invalid plus aria-describedby wiring, timezone caption, validation messages plus role alert persistence, dirty-discard confirm, disabled rules, success invalidation plus bucket plus search reset. Keep defaultTimes plus toLocalDateTimeInput plus randomScheduleId helpers identical.
7. Self-check: bucket plus search plus sort, sheet validation times 3 policies, discard confirm, IELTS exclusion - run Sessions plus validation tests.

### Step 4 - Results composition (list plus bento plus score filter)

1. Header plus bento: keep header; SatStatStrip with label Results summary plus Total plus Scored plus Awaiting unchanged (visual-only bento via Phase 03).
2. Segmented: keep label Score availability plus three options plus max-w 420px class. Align to shared rhythm: if Steps 1-3 settled segmented at margin-top 5, move Results there too (single-class change, no test impact - tests query by role, not margin).
3. Count row: keep flex wrapper with SatResultCount plus the Updating cue at 11px secondary conditional on isFetching without isLoading. Preserve the 0 of 1 results zero-filter announcement.
4. Rows: keep frame plus tone plus label logic; polish hierarchy (data-identical). Left block is studentName at 13px semibold with tight tracking, then studentId plus cohortName at 10px tabular, then examTitle plus Version plus date at 10px tabular. Right block is score at 17px semibold tabular (or em dash when unavailable), then outcome caption at 8px uppercase, then right-aligned pill. Additions versus today: tabular-nums on the two meta lines (ids plus dates align); tight tracking on the name. Everything else byte-identical - especially the caption plus pill double-label (pinned by tests) plus the chevron that hides below sm breakpoint (keep: the score block already fills mobile trailing space).
5. Empty states: keep copy exactly; BarChart3 icon in the standard tile.
6. Self-check: availability filter, tone map, caption, Updating cue - run Results tests.

### Step 5 - Cross-route consistency sweep (still inside owned files only)

- Titles: Library 14px with Sessions 13px with Results 13px plus 17px score - intentional density ladder, document it with a one-line comment per route (no new docs files).
- Meta: 10px secondary everywhere after Steps 3-4 (Library already 10px; Sessions lifted 9px to 10px; Results already 10px plus an 8px caption that stays as micro-label, not body).
- Chevron: sat-row-chevron always rendered, aria-hidden true, slate-300 with group-hover slate-500 (Results keeps hidden below sm).
- Buttons: primary h-10 rounded 12px via SatPrimaryButton; sheet Cancel plus Schedule min-h-10; archived toggle min-h-8 (documented secondary exemption, not a 44px violation - coarse-pointer floor still applies via CSS).
- No glass, no gradients, no lift, no springs added. Confirm by grepping owned routes for translate lift, gradient, plus backdrop blur tokens plus finding only pre-existing hits (none expected in these three routes).

### Step 6 - Verify plus hand off

Run section 9 commands in order (typecheck, then scoped vitest, then eslint). Record results in the implementation message. Any failure in a file 04A does not own maps to stop, report to Main Agent for the owning phase; do not fix outside ownership.

---

## 6. Important code plus pseudocode (contracts, not full files)

### 6.1 Token consumption sketch (call-site level)

Phase 01 owns the block below - 04A only references it. Fallback chain: staff token, then current literal.

`.sat-product {`
`  --sat-staff-canvas: #F5F5F7;`
`  --sat-staff-surface: #FFFFFF;`
`  --sat-staff-surface-subtle: rgba(120, 120, 128, 0.06);`
`  --sat-staff-border: rgba(0, 0, 0, 0.06);`
`  --sat-staff-border-strong: rgba(0, 0, 0, 0.09);`
`  --sat-staff-text: #1d1d1f;`
`  --sat-staff-text-secondary: #515154;`
`  --sat-staff-text-tertiary: #6e6e73;`
`  --sat-staff-accent: var(--sat-accent-core);`
`  --sat-staff-accent-hover: #0077ed;`
`  --sat-staff-accent-pressed: #0067c9;`
`  --sat-staff-focus: rgba(0, 113, 227, 0.4);`
`  --sat-staff-radius-md: 12px;`
`  --sat-staff-radius-lg: 16px;`
`  --sat-staff-radius-xl: 20px;`
`  --sat-staff-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.04);`
`  --sat-staff-motion: 150ms cubic-bezier(.2, 0, 0, 1);`
`}`

Call-site rule: prefer keeping the primitive class (already tokenized by Phase 03). Where a route owns raw classes today (archived toggle, sheet inputs, row inner spans), swap accent hex for staff accent var, accent ring for staff focus var, plus black-alpha borders for staff border var, only where the token exists; otherwise keep the literal plus note it for Phase 05 polish. Never invent a one-off hex.

### 6.2 API signatures consumed (frozen - do not change or wrap)

`SatContainer(props: { children; className? }): element`
`SatPageHeader(props: { eyebrow; title; description?; actions? }): element`
`SatSearchField(props: { id; label; value; onChange; placeholder; widthClassName? }): element`
`SatPrimaryButton(props: { onClick; icon?; ariaLabel?; pending?; disabled?; children }): element`
`SatStatusPill(props: { tone; pulse?; children }): element`
`satOutcomeTone(outcome: string): tone - scored maps to ready, pending maps to pending, invalidated variants map to invalidated, else neutral`
`SatList(props: { children }): element`
`SatListRow(props: { onOpen; ariaLabel?; children; index? }): element`
`SatStatStrip(props: { stats; label? }): element - SatStat { id; label; value; hint?; onSelect? }`
`SatResultCount(props: { total; visible; itemLabel; scopeLabel? }): element or null`
`SatEmptyState(props: { icon; title; hint; action? }): element`
`SatListSkeleton(props: { rows?; label? }): element`
`SatSegmentedControl(props: { label; value; options; onChange; className? }): element`
`SatFormDialog(props: { open; eyebrow; title; onClose; children }): element`
`SatConfirmDialog(props: { open; title; description; confirmLabel; destructive?; onCancel; onConfirm }): element`
`validateSatScheduleTimes(start: string, end: string, now?: Date): errors - { start?; end? }`

### 6.3 Filter logic (frozen - reproduced here so the implementer does not improve it)

Library: provider gate plus archived gate plus substring plus updatedAt descending. Sessions: preview exclusion plus bucket plus substring over 3 fields plus startTime ascending. Results: availability gate plus substring over 4 fields, stable order with no sort (keep as-is).

---

## 7. Edge cases

1. Loading versus empty: skeleton-XOR - header always renders; list plus count plus empty render only after loading. Empty-data (total 0) renders SatEmptyState with NO count line (except the two pinned filtered-zero states where total is above 0 - those keep the zero-of-N announcer).
2. Search plus secondary filter interaction: archived toggle plus bucket plus score-filter compose with search via AND; clearing search never resets the secondary filter; switching the secondary filter never clears search (Library archived test pins this; mirror the discipline in Sessions plus Results).
3. Bucket auto-switch: Sessions effect (upcoming 0 with live above 0 maps to live) must survive recomposition - keep the effect plus its deps unchanged.
4. Sheet dirty tracking: New Session discard-confirm triggers on cohort or institution non-blank only (exam plus time changes do not dirty the form - matches current contract; do not fix).
5. Past-start versus end-before-start precedence: validator reports past-start first; tests use far-future fixtures for end-after-start plus year-2000 for past-start - keep validator import as-is; no date-math edits.
6. 15-minute minimum boundary: exactly-15-min passes (validator rejects only below 15 minutes); do not touch.
7. New SAT placeholder trap: Practice Test 06 is placeholder, Create stays disabled until typed - keep placeholder plus empty value plus disabled on blank trim.
8. Long titles plus PII overflow: every title plus meta line keeps truncate plus min-w-0 flex-1; score block shrink-0; chevron shrink-0. Test at 360px with a 120-char exam title plus a long cohort plus institution pair.
9. Timezone caption: New Session local-time caption only renders when both datetimes parse; invalid input renders nothing (no crash) - keep the NaN guard.
10. Non-admin Sessions: no New Session button, no extra exams query beyond the false arg - keep role gate; do not render a disabled placeholder button.
11. Preview cohorts: excluded from list AND counts (single summaries memo) - keep.
12. Cancelled versus Finished: finished-bucket status reads schedule status for the Cancelled plus Finished split - keep.
13. Reduced motion plus contrast plus forced-colors: no new animation or color-semantic markup; row stagger stays capped plus CSS-guarded; pills keep dot plus label (forced-colors safe via existing CSS).
14. IELTS leakage: any new option or copy must say SAT, never band scores; provider filters stay strict-equal sat.
15. Route-fade plus nav: untouched (Phase 02). 04A adds no motion imports - rows animate via SatListRow index only.

---

## 8. Tests to add plus update

Update none of the existing expectations. All files below must stay green as written; add only the additive cases listed.

### 8.1 Existing suites (must pass unchanged)

- `src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx` (7) - provider boundary, create flow, skeleton, count announce, clear-search, archived toggle, placeholder-disabled Create.
- `src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx` (10) - boundaries, IELTS exclusion, skeleton, count, sheet focus, 3 validation policies, discard confirm, filtered-zero echo.
- `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` (10) - band-language absence, skeleton, count, availability filter, invalidation copy, tone map, caption, Updating cue, zero-filter announcer, detail back-label.
- `src/products/sat/routes/__tests__/scheduleValidation.test.ts` - untouched (no validation change).
- `src/products/sat/ui/__tests__/SatPage.test.tsx`, `SegmentedControl.test.tsx`, `Dialogs.test.tsx`, `Menu.test.tsx`, `satContractsCss.test.ts` - regression only (04A does not own these files; failures here mean Phase-03 drift, escalate).

### 8.2 Additive tests (append to existing route files, not new files)

1. Library - archived toggle preserves search (in SatExamLibraryRoute.test.tsx): type a matching query, toggle Show archived, assert the match still renders plus the count line updates (pins Step-2 non-regression).
2. Sessions - bucket switch preserves search text (in SatSessionsRoute.test.tsx): type query, click Live radio, assert input value kept plus zero-state echo shows the query (mirrors Library discipline).
3. Sessions - meta merge keeps all data points: render the single-summary fixture, assert one row shows examTitle, cohortName, formatted start, 0 joined, 0 active, plus status pill - guards the Step-3 line merge against accidental data loss.
4. Results - tabular meta plus score block: assert score 1370 has a tabular-nums class ancestor plus both meta lines render studentId with cohort plus examTitle with version plus date (guards Step-4 hierarchy edit).
5. Cross-route - no lift or gradient or glass in owned routes (add a small assertion to each route file or to the Sessions file): render each route plus assert the list-row className lacks translate lift, plus innerHTML lacks gradient text (cheap style-guard; real visual check is Phase 05).

### 8.3 Manual plus Phase-05-deferred checks (do not automate in 04A)

Contrast spot-checks, reduced-motion audit, 360px overflow, keyboard-only sheet flow, plus the sat-a11y e2e run belong to Phase 05 full matrix - 04A only runs the scoped commands in section 9.

---

## 9. Verification commands

Run in this order during implementation (scoped, then type, then lint). Phase 05 owns the full matrix; 04A records it here for handoff, does not run it.

Scoped route tests (must all pass):
`npm run test:run -- src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx src/products/sat/routes/__tests__/scheduleValidation.test.ts`

Primitive regression (04A imports these - fail means Phase-03 drift, escalate, do not fix):
`npm run test:run -- src/products/sat/ui/__tests__/SatPage.test.tsx src/products/sat/ui/__tests__/SegmentedControl.test.tsx src/products/sat/ui/__tests__/Dialogs.test.tsx src/products/sat/ui/__tests__/Menu.test.tsx src/products/sat/ui/__tests__/satContractsCss.test.ts`

Typecheck:
`npx tsc --noEmit`

Lint owned files only:
`npx eslint src/products/sat/routes/SatExamLibraryRoute.tsx src/products/sat/routes/SatSessionsRoute.tsx src/products/sat/routes/SatResultsRoute.tsx`

Full matrix (Phase 05 runs; listed here so scope is unambiguous): run test suite, then typecheck, then eslint on sat folder, then sat-a11y e2e. Commands: `npm run test:run` then `npx tsc --noEmit` then `npx eslint src/products/sat/` then `npm run e2e:sat-a11y`.

---

## 10. Definition of Done

- [ ] SatExamLibraryRoute, SatSessionsRoute (plus in-file sheet), plus SatResultsRoute compose Phase-03 primitives with the shared header plus bento plus filter plus count plus list-or-empty rhythm; no other product file touched; no new files.
- [ ] StatStrip renders as bento on Sessions plus Results with frozen ids plus labels plus values; Library has no strip.
- [ ] Row hierarchy (Library 14px with Sessions 13px with Results 13px plus 17px score, 10-11px meta, tabular-nums on counts plus dates plus scores plus ids) applied with zero data points dropped plus zero copy rewording beyond the allowed one-clause header tighten.
- [ ] Archived toggle, bucket segmented plus auto-switch, score-availability segmented, all search behaviors, both sheets (validation messages, discard confirm, focus, disabled rules, navigation plus invalidation), plus all error plus loading plus empty states behave exactly as in section 4.
- [ ] Every contract in section 4 preserved: provider boundaries, sort orders, tone plus label tables, skeleton-XOR, dot plus label, live regions, roving tabindex, focus rings, 44px targets (32px search-clear exemption), Cancel-focused alerts, backdrop-tap-never-dismisses, class hooks, PII discipline.
- [ ] No query or facade or validation or routing or polling change; no .sat-ui or IELTS or backend touch; no hex or gradient or neon or neumorphism or glass or lift or spring introduced (grep check in Step 5 clean).
- [ ] Tests: all suites in 8.1 green; the five additive cases in 8.2 added plus green.
- [ ] Verification: scoped vitest plus primitive regression plus tsc plus owned-file eslint all pass; results recorded for Phase 05.
- [ ] Any missing Phase-01 token or Phase-03 API drift recorded as a dependency flag with the 2.2 fallback used - not as an out-of-ownership edit.
- [ ] No implementation performed by this plan itself (plan-only gate: only `plans/phase-04a-list-pages.md` written).