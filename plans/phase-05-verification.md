# Phase 05 — Verification & Polish (SAT Staff Workspace)

> Workflow: ai-planning-workflow, Stage: PLAN ONLY (no implementation yet)
> Scope: SAT staff workspace only — src/products/sat/** plus .sat-product CSS in src/index.css. Exam-mode Bluebook (.sat-ui, src/features/student-delivery/**) is READ-ONLY. IELTS surfaces plus backend are out of scope.
> Wave: Wave 4 — runs last, alone, after Phase 01 + 02 + 03 + 04A + 04B are all gated done.
> Ownership: no product files. The Phase-05 agent never edits src/products/sat/** or src/index.css directly. On failure it files a repair ticket to the owning-phase agent (routing table in section 10) and re-verifies. Allowed direct writes: verification docs and logs under plans/ (and only paths no other phase owns).

---

## 1. Objective

Prove the SAT staff workspace went from 'clean functional ops UI' to 'high-end 2026 product UI' with zero behavioral or accessibility regressions and a coherent system across all six staff surfaces:

- Exam Library (SatExamLibraryRoute), Sessions (SatSessionsRoute), Session Room (SatSessionRoomRoute), Results (SatResultsRoute), Result Detail (SatResultDetailRoute), Student Access (SatAccessRoute wrapper chrome only)
- Shell (SatRoot.tsx) plus primitives (SatPage.tsx, Menu.tsx, SegmentedControl.tsx, ConfirmDialog.tsx) plus tokens (.sat-product scope in src/index.css)

'Prove' means a mechanical gate matrix (section 9) where every row has an explicit command, a pass/fail threshold, and a repair owner. 'Coherent' means cross-route checks on radii, shadow, type, tone, motion, focus, empty, loading, and error vocabulary — not just per-file green tests.

Non-goals (must NOT do in Phase 05):
- No visual redesign, no token rename, no new stores, no behavior change (filtering, polling, proctor actions, confirm flows, routing, polling intervals stay identical).
- No edits to .sat-ui Bluebook tokens or exam-mode components.
- No neon, no heavy gradients, no neumorphism, no chatbot-as-UI, no lift-on-hover, no springs in lists.
- No fixing-forward by editing another phase's files directly — route repairs (section 10).

---

## 2. Dependencies

### 2.1 Hard gates (all must be Main-Agent-verified before Phase 05 starts)

Phase 01 — Staff Token Foundation: complete .sat-product token set in src/index.css: --sat-staff-* canvas/surface/border/text/accent/focus/radius/shadow/motion; solid fallbacks for every glass surface; AA-checked text pairs; reduced-motion plus shimmer tokens; token table doc. Components reference tokens, not inline hex. Gate signal: Phase-01 plan DoD met plus CSS contract tests green.

Phase 02 — App Shell: final src/products/sat/SatRoot.tsx: glass sidebar with solid fallback, active-pill desktop nav plus top-indicator mobile nav, account block, workspace switcher, mobile header and bars with safe-area plus blur, SatRouteFade 160ms plus reduced-motion guard. No nav-logic change. Gate signal: SatRoot.test.tsx green plus shell visual spot-check.

Phase 03 — List-System Primitives: final SatPage.tsx, Menu.tsx, SegmentedControl.tsx, ConfirmDialog.tsx on Phase-01 tokens, APIs backward compatible. Gate signal: SatPage, Menu, Dialogs, SegmentedControl, and satContractsCss tests green.

Phase 04A — List Pages: final SatExamLibraryRoute.tsx, SatSessionsRoute.tsx (plus New Session sheet), SatResultsRoute.tsx composing Phase-03 primitives. No query or facade change. Gate signal: SatExamLibraryRoute, SatSessionsRoute, SatResultsRoutes tests green.

Phase 04B — Detail and Ops Pages: final SatSessionRoomRoute.tsx, SatResultDetailRoute.tsx, SatAccessRoute.tsx wrapper chrome. PII discipline (IDs only in logs) intact. Gate signal: SatSessionRoomRoute plus result-detail tests green.

### 2.2 API and contract dependencies (requirement, NOT an edit)

- If Phase 01 renamed or aliased any token Phase 05 audits against (for example --sat-staff-canvas versus legacy --sat-canvas or --color-au-*), Phase 05 reads the Phase-01 token table as source of truth — it does not invent token names.
- If Phase 03 changed any primitive prop or class hook, Phase 05 reads the Phase-03 API snapshot (section 4) — it does not patch call sites.
- If playwright.sat-a11y.config.ts or e2e harness routes changed during earlier phases, Phase 05 requires the owning agent to document the new invocation before the a11y run.

### 2.3 Execution order

    Wave 1: 01  ->  Wave 2: 02 + 03  ->  Wave 3: 04A + 04B  ->  Wave 4: 05 (this phase, alone)

Phase 05 never unlocks early. If any upstream gate re-opens (a repair lands), Phase 05 re-runs the full matrix from section 9 Row V1, not just the repaired row.

---

## 3. Affected and new files

### 3.1 Files Phase 05 READS (never writes)

Shell plus primitives (verify, do not touch):
- src/products/sat/SatRoot.tsx (195 lines — sidebar 244px, mobile header, bottom nav, SatRouteFade 160ms, MotionConfig reducedMotion=user, detail-page regex)
- src/products/sat/ui/SatPage.tsx (442 lines — SatContainer, SatPageHeader, SatSearchField, SatPrimaryButton, SatStatusPill plus satOutcomeTone, SatList, SatListRow, SatStatStrip, SatResultCount, SatEmptyState, SatListSkeleton, SatInlineError, SatReleaseTag, SatEyebrow, SatSectionCard, SatMeta)
- src/products/sat/ui/Menu.tsx (233 lines — Radix plus static fallback, aria-current contract)
- src/products/sat/ui/SegmentedControl.tsx (81 lines — radiogroup plus roving tabindex plus sliding thumb layoutId)
- src/products/sat/ui/ConfirmDialog.tsx (208 lines — AlertDialog plus static fallback, Cancel-focused, backdrop-tap-never-dismisses; SatFormDialog sheet)
- src/products/sat/ui/useSatListParams.ts (read-only reference for filter-state behavior)

Routes (verify, do not touch):
- src/products/sat/routes/SatExamLibraryRoute.tsx (183 lines)
- src/products/sat/routes/SatSessionsRoute.tsx (248 lines, includes New Session sheet plus StatStrip plus scheduleValidation)
- src/products/sat/routes/SatSessionRoomRoute.tsx (290 lines, sticky room header plus roster listbox plus SessionControls plus confirms)
- src/products/sat/routes/SatResultsRoute.tsx (138 lines, StatStrip plus availability filter)
- src/products/sat/routes/SatResultDetailRoute.tsx (178 lines, 52px score hero plus module dl plus QuestionRawTable wrapper)
- src/products/sat/routes/SatAccessRoute.tsx (36 lines, StudentLinksDashboard wrapper only)
- src/products/sat/routes/scheduleValidation.ts

CSS (verify, do not touch):
- src/index.css — .sat-product block (about lines 1579-2024: tokens, focus, coarse-pointer, search-clear, reduced-motion, reduced-transparency, contrast, elevations, menu, dialog, segmented, row, route, banner, skeleton, spinner, live-dot, list-row rules) plus the shared .sat-ui plus .sat-product --sat-accent-core #0071e3 rule (about line 1151). .sat-ui exam-mode values are READ-ONLY.

Tests (run, do not redesign):
- src/products/sat/ui/__tests__/SatPage.test.tsx (231 lines)
- src/products/sat/ui/__tests__/Menu.test.tsx (93 lines)
- src/products/sat/ui/__tests__/Dialogs.test.tsx (185 lines)
- src/products/sat/ui/__tests__/SegmentedControl.test.tsx (49 lines)
- src/products/sat/ui/__tests__/satContractsCss.test.ts (23 lines — F-A6 search-clear 32px, F-A12 route-fade reduced-motion)
- src/products/sat/ui/__tests__/useSatListParams.test.tsx (66 lines)
- src/products/sat/__tests__/SatRoot.test.tsx (128 lines)
- src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx (105 lines)
- src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx (145 lines)
- src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx (188 lines)
- src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx (203 lines)
- src/products/sat/routes/__tests__/scheduleValidation.test.ts

Configs and harnesses (read plus invoke):
- package.json scripts (section 9), tsconfig.json (strict, noEmit), vitest.config.ts (jsdom, src/test/setup.ts), eslint.config.js, playwright.sat-a11y.config.ts (testDir ./e2e, testMatch sat-student-accessibility.spec.ts, projects chromium/webkit/touch-chromium Pixel 5, webServer npm run dev -- --host 127.0.0.1 serving /__dev/sat-accessibility), e2e/sat-student-accessibility.spec.ts (940 lines, exam-mode guard), e2e/sat-product-workspace.spec.ts (484 lines, backend-backed workspace flow — needs ADMIN_STORAGE_STATE plus MySQL, see section 7 edge case 10).

### 3.2 Files Phase 05 MAY create or update (and only these)

- This plan file (written in planning stage): plans/phase-05-verification.md
- At implementation time only: a verification log, for example plans/phase-05-verification-log.md (run table with command, exit code, artifact), if the Main Agent asks for durable evidence. No product code. No new vitest files unless section 8 explicitly approves a gap-fill test AND the owning-phase agent authors it.
- Phase 05 does not own any src/** file. Any 'CSS fix' the overall plan mentions ('tests plus docs plus CSS fixes only, via owning-phase agents') means Phase 05 requests the fix from the owner (Phase 01 for tokens and CSS, Phase 02/03/04A/04B for components and routes) — it never applies the fix itself.

---

## 4. Contracts and interfaces to preserve (fail the run if any break)

These are inherited from the pre-redesign codebase and pinned by existing tests. Phase 05 proves they still hold after Waves 1-3.

### 4.1 Exported primitive APIs (backward compatible, no prop renames)

    SatContainer: children, className? — div mx-auto max-w-1180 container
    SatPageHeader: eyebrow, title, description?, actions? — p eyebrow, h1 30px -0.045em, p description
    SatSearchField: id, label, value, onChange(value), placeholder, widthClassName? — input type=search with aria-label, clear button, Escape clears
    SatPrimaryButton: onClick, icon?, ariaLabel?, children, pending=false, disabled=false — pending implies disabled plus aria-busy
    SatStatusTone: published | live | changes | paused | info | ready | invalidated | draft | archived | finished | cancelled | neutral | pending
    satOutcomeTone(outcome): scored->ready, pending->pending, invalidated_proctor/invalidated_timeout->invalidated, else neutral
    SatStatusPill: tone, pulse=false, children — dot span aria-hidden plus label span
    SatList: children — div mt-4 space-y-2
    SatListRow: onOpen, ariaLabel?, children, index? — button.sat-list-row, index given implies sat-row-enter plus --sat-row-index style
    SatStat: id, label, value, hint?, onSelect? — onSelect present implies button, else div
    SatResultCount: total, visible, itemLabel, scopeLabel? — null when total<=0; unit word is scopeLabel ?? itemLabel
    SatStatStrip: stats, label=Summary — section aria-label with stat cards
    SatEmptyState: icon, title, hint, action? — centered min-h-360 block
    SatListSkeleton: rows=3, label=Loading — div role=status with .sat-skeleton-shimmer rows, no animate-pulse
    SatInlineError: title, description, onRetry?, retryLabel=Retry — div role=alert with min-h-10 accent retry
    SatReleaseTag: releaseStatus — small text Practice plus status
    SatEyebrow: id?, className?, children — p 10px uppercase tracking
    SatSectionCard: labelledBy?, className?, children — div rounded-2xl border card
    SatMeta: className?, children — p 11px tertiary
    SatMenuItem: id, label, onSelect, disabled?, destructive?, current?, separatorBefore?
    SatSegmentedControl<T>: label, value, options[{value,label}], onChange, className? — radiogroup with roving tabindex
    SatConfirmDialog: open, title, description, confirmLabel, destructive=false, onCancel, onConfirm — alertdialog, Cancel-focused
    SatFormDialog: open, eyebrow, title, onClose, children — dialog sheet, Escape and Close button close

### 4.2 ARIA and DOM contracts (asserted by tests plus manual audit)

- Status pill is dot plus label: span aria-hidden dot with rounded-full plus visible text; color never carries state alone; sat-live-dot only when pulse (live sessions). Pinned by SatPage.test.tsx.
- Search field: aria-label equals label; clear button aria-label is 'Clear ' plus label and renders only when value is non-empty; Escape clears via onChange('') without remount; native cancel button hidden. Pinned by SatPage.test.tsx (3 tests).
- List row: button.sat-list-row; index defined implies sat-row-enter plus --sat-row-index style; never -translate-y (no lift on hover). Pinned by SatPage.test.tsx (3 tests).
- Primary button: pending implies disabled plus aria-busy=true with width-stable .sat-spinner. Pinned by SatPage.test.tsx.
- Skeleton: role=status plus aria-label plus .sat-skeleton-shimmer present plus .animate-pulse absent. Pinned by SatPage.test.tsx.
- Result count (skeleton-XOR): role=status aria-live=polite; total<=0 renders null (empty-state owns the announce); scopeLabel ?? itemLabel unit word; never rendered alongside skeleton. Pinned by SatPage.test.tsx (3 tests).
- Inline error: role=alert plus retry min-h-10 accent button; no retry button when onRetry absent. Pinned by SatPage.test.tsx. NOTE: if Phase 01/03 tokenized the bg hex, the assertion class may be an alias — see section 7 edge case 6.
- Outcome tones: satOutcomeTone exact 5-row map. Pinned by SatPage.test.tsx.
- Menu: closed renders no role=menu; open renders role=menu plus data-sat-menu-animate; destructive item has data-destructive; separator has role=separator; current item has aria-current=true and stays clickable; trigger always has aria-label=label; Escape closes without selecting. Pinned by Menu.test.tsx (7 tests).
- Segmented: wrapper role=radiogroup plus aria-label; children role=radio plus aria-checked; roving tabindex (selected 0, else -1); Arrow keys move selection and focus; exactly one .sat-segmented-thumb on the selected segment. Pinned by SegmentedControl.test.tsx (5 tests).
- Confirm alert: role=alertdialog with accessible name equal to title; Cancel plus confirm both present; Cancel-focused (safe choice gets initial focus, never the destructive confirm); Escape calls onCancel; open=false renders nothing; stacked alerts have unique aria-labelledby; overlay plus content carry .sat-product.sat-dialog-center (plus .sat-dialog-overlay) so portal positioning survives outside the workspace root; backdrop tap never dismisses. Pinned by Dialogs.test.tsx.
- Form sheet: role=dialog named by title; contains the form; Escape plus Close button call onClose; closed renders nothing; unique title ids; portal scope classes. Pinned by Dialogs.test.tsx (5 tests).
- Shell: 3 admin destinations (Exam Library, Sessions, Results; no Grading, no Dashboard); IELTS switcher navigates to the role landing; skip link href=#sat-main plus #sat-main tabindex=-1 focusable; compact Account menu signs out via logout; sidebar persists on /sat/sessions/ID, /sat/results/ID, /sat/exams/ID/access; chrome hidden on /sat/exams/ID plus release/preview. Pinned by SatRoot.test.tsx (6 tests).
- Routes: SAT provider boundary (useExamListQuery(true,'sat'), useProctorSessionSummaries(4000,'sat'), controller providerKey sat); IELTS entities never rendered and never offered; loading renders header plus skeleton (Loading SAT exams/sessions/results); loaded renders a single role=status count; filtered-zero renders empty state plus Clear search; archived toggle preserves search; per-action pending isolation in the room; error banners role=alert versus success banners role=status; no IELTS band language in Results; explicit proctor-invalidation copy. Pinned by all route tests.
- CSS system contracts: .sat-product .sat-search-clear equals top 50% important plus translateY(-50%) plus min-block-size and min-inline-size 32px important (32px exemption from the 44px coarse floor); .sat-route-fade animation none plus prefers-reduced-motion guard forcing opacity 1 important. Pinned by satContractsCss.test.ts (F-A6, F-A12).

### 4.3 Non-negotiable a11y invariants (never break, even if tests do not cover the exact line)

- dot-plus-label status; skeleton-XOR rule; polite live regions (counts, loading) versus assertive alerts (errors, confirms); roving tabindex (segmented); focus-visible rings (3px accent, offset at least 1px); 44px targets on coarse pointers with the 32px search-clear exemption intact; Cancel-focused alerts; backdrop-tap-never-dismisses; skip link; tabular-nums for timers, counts, and scores; weight-plus-position (never color alone) for selection; PII discipline (student IDs only in logs, never in verification artifacts).

### 4.4 2026 style invariants (from overall plan section 1 plus 2026ui direction)

- Soft spatial UI: 1px border plus very soft shadow, 16-24px radii (rows and cards 16/22px, inputs and buttons 10-12px, dialogs 22px, menus 13px), calm canvas.
- Glass sparingly: one glass nav layer (sidebar, sticky room header, mobile bars) plus solid content cards; every glass surface has an opaque fallback (prefers-reduced-transparency plus solid surface token).
- Bento where it pays; editorial type (30px minus 0.045em page titles kept, stronger section titles, short descriptions, no tiny-gray-everywhere, no gradient text).
- 2026 components: 44-52px inputs and buttons (desktop 40-44px min plus coarse-pointer 44px floor), pill badges dot-plus-label, minimal tables, 150-200ms ease-out transitions with cubic-bezier(.2,0,0,1) family, no lift-on-hover, no springs in ops lists, capped stagger (first 6 rows, 60ms step, 4px rise, opacity-led).

---

## 5. Step-by-step implementation plan (execute in order; stop-and-route on first red)

Notation: RUN means the Phase-05 agent executes. ROUTE means Phase-05 files a ticket, the owning agent fixes, and Phase-05 re-runs from Step 0. Phase 05 makes zero product edits.

### Step 0 — Preconditions plus baseline capture [RUN]

1. Confirm upstream gates: phase-01 through phase-04b plans all marked done plus Main-Agent-verified. If any gate is open, stop — do not start verification.
2. git status --short must be clean; record git rev-parse --short HEAD in the log. If dirty, stop and ask the Main Agent for a clean baseline.
3. Read (do not assume) the final versions of every file in section 3.1 plus the Phase-01 token table plus the Phase-03 API snapshot. Record the token names actually shipped (with --sat-staff-* versus legacy aliases) — later steps audit against that table, not against this plan's guesses.
4. Create (implementation-time) plans/phase-05-verification-log.md with a run table: number, check, command, exit, result, artifact.

### Step 1 — Typecheck, whole repo [RUN, ROUTE on fail]

    npm run typecheck        (equivalent: npx tsc --noEmit)

Pass: exit 0, zero errors. Fail ROUTEs to the error file's owner (tokens and CSS to 01, SatRoot to 02, ui files to 03, list routes to 04A, detail routes to 04B, shared or imported code outside SAT scope to the Main Agent). Do not patch types in Phase 05.

### Step 2 — Scoped SAT vitest, fast signal, SAT only [RUN, ROUTE on fail]

Run each path separately so the failing owner is obvious; record per-path exit codes:

    npm run test:run -- src/products/sat/ui/__tests__/SatPage.test.tsx
    npm run test:run -- src/products/sat/ui/__tests__/Menu.test.tsx
    npm run test:run -- src/products/sat/ui/__tests__/Dialogs.test.tsx
    npm run test:run -- src/products/sat/ui/__tests__/SegmentedControl.test.tsx
    npm run test:run -- src/products/sat/ui/__tests__/satContractsCss.test.ts
    npm run test:run -- src/products/sat/ui/__tests__/useSatListParams.test.tsx
    npm run test:run -- src/products/sat/__tests__/SatRoot.test.tsx
    npm run test:run -- src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx
    npm run test:run -- src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx
    npm run test:run -- src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
    npm run test:run -- src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx
    npm run test:run -- src/products/sat/routes/__tests__/scheduleValidation.test.ts

Pass: every path exits 0 (all tests passed, no skipped-without-reason). Fail ROUTEs to the failing file's owner (section 10). Exception: if a failure is caused by a Phase-01 token alias the test hardcodes (for example bg-hex versus accent token), the test update itself is authored by the owning-phase agent (03 for SatPage tests), not Phase 05 — Phase 05 only reports the mismatch with the exact assertion line.

### Step 3 — Full vitest, no collateral damage outside SAT [RUN, ROUTE or ESCALATE on fail]

    npm run test:run        (vitest run; jsdom; excludes e2e/**, covers all of src/**)

Pass: exit 0 across the repo (proves IELTS, Bluebook, and backend-adjacent suites still green). Fail: when the failure is inside src/products/sat/**, ROUTE to the owner per Step 2. When outside SAT scope, escalate to the Main Agent (Phase 05 does not own or fix non-SAT code; it only records the failing suite plus whether it failed on the pre-change baseline too).

### Step 4 — ESLint, scoped then repo signal [RUN, ROUTE on fail]

    npx eslint src/products/sat src/index.css e2e/sat-product-workspace.spec.ts playwright.sat-a11y.config.ts
    npm run lint

Pass: scoped run reports zero errors and warnings on SAT paths; full npm run lint introduces no new SAT-attributable findings versus baseline. Fail ROUTEs to the file's owner. Accessibility lint (jsx-a11y) failures are P0 — same routing, expedited.

### Step 5 — CSS contract plus token-hygiene audit [RUN, ROUTE on fail]

5a. Re-run the pinned CSS tests (already in Step 2) — satContractsCss.test.ts must stay green (F-A6 32px exemption, F-A12 reduced-motion guard).
5b. Static token-hygiene sweep (read-only greps; no auto-fix):

    rg -n '#0071e3|#f5f5f7|#0077ed|#0067c9' src/products/sat --glob '!**/__tests__/**'
    rg -n 'black/\[' src/products/sat --glob '!**/__tests__/**'
    rg -n 'sat-ui|student-delivery' src/products/sat
    rg -n 'backdrop-blur|bg-white/8|bg-white/9' src/products/sat
    rg -n '\-\-sat-staff-(canvas|surface|border|text|accent|focus|radius|shadow|motion)' src/index.css

Pass: (i) contract tests green; (ii) zero unexplained raw-hex hits (every remaining hit has a Phase-01-documented exemption, for example test assertions or dot colors mapped through tokens); (iii) zero sat-ui references in staff code; (iv) every glass usage pairs with an opaque fallback rule. Fail ROUTEs to Phase 01 (tokens and CSS) or the component owner for hardcoded values.

### Step 6 — sat-a11y Playwright [RUN, ROUTE on fail]

    npm run e2e:sat-a11y
    (equivalent: npx playwright test --config playwright.sat-a11y.config.ts; projects chromium plus webkit plus touch-chromium Pixel 5)

Scope note (read the config before running): the pinned testMatch is sat-student-accessibility.spec.ts (exam-mode /__dev/sat-accessibility harness: zoom and contrast reflow, pane switching, 44px controls, focus). It guards the Bluebook surface Phase 05 must not have touched — it must stay green to prove no shared-token collateral (--sat-accent-core, shared src/index.css block). Staff-workspace coverage lives in e2e/sat-product-workspace.spec.ts (backend-backed; see section 7 edge case 10).
Pass: all 3 projects green, no retries, traces clean. Fail: when an exam-mode failure traces to a shared CSS variable Phase 01 forked incorrectly, ROUTE to 01. When a staff-harness failure occurs, ROUTE to the owning shell, primitive, or route agent. When infra fails (webServer boot, port 3000 busy, browser download), retry once, then escalate to the Main Agent.

### Step 7 — Contrast spot-checks, manual plus computed [RUN, ROUTE on fail]

Check every pair below at default plus prefers-contrast:more plus forced-colors (DevTools rendering emulation). Compute ratios with the snippet in section 6.1; threshold AA is 4.5:1 normal text, 3:1 large text (18.66px bold and up, or 24px) and UI components and focus indicators.

    C1  staff text on canvas and surface — page titles, row titles (13-14px semibold)
    C2  staff text-secondary on surface — descriptions (13px), search input text
    C3  staff text-tertiary on surface — eyebrows (10px uppercase), meta (10-11px), result counts (11px); must still hit 4.5:1 (this is why .sat-product .text-slate-400 is remapped; flag any remaining text-slate-400 without remap)
    C4  accent text (0067c9 family) on accent tint — info and ready pills plus links
    C5  pill text per tone (emerald-700, amber-700, red-700, slate-500 on emerald-50, amber-50, red-50, black 3pct) — all SatStatusPill tones plus satOutcomeTone map
    C6  white on accent (0071e3, hover 0077ed, active 0067c9) — primary buttons, inline-error retry
    C7  focus ring (accent 72pct mix) against canvas plus against button bg — keyboard-only visibility
    C8  placeholder (remapped slate-400) on white — placeholders are not the label carrier, but must not be the only cue (a label exists)
    C9  overrun, reconnecting, paused, and warned states in Session Room — never color-alone (icon plus text present)

Pass: all pairs meet thresholds at the default theme; prefers-contrast:more strengthens separators and labels without changing status semantics; forced-colors maps to CanvasText and Highlight sanely. Fail ROUTEs to Phase 01 (token values) — component agents do not tune hex.

### Step 8 — Motion and reduced-motion audit [RUN, ROUTE on fail]

8a. Static sweeps:

    rg -n 'transition|animation|duration|layoutId|animate' src/products/sat --glob '!**/__tests__/**'
    rg -n 'prefers-reduced-motion|MotionConfig|useReducedMotion|reducedMotion' src/products/sat src/index.css
    rg -n 'spring|stiffness|damping|animate-pulse' src/products/sat src/index.css

8b. Expectations: all durations 150-200ms (rows and route 160ms, banner 140ms, dialog 220ms max-exception documented, menu 120-160ms) with the cubic-bezier(.2,0,0,1) family (codebase uses .22,1,.36,1 — accepted as the same ease-out intent; flag anything else); stagger capped at first 6 rows (min of row index and 5, 60ms step, opacity plus 4px translate only); no springs in lists; no animate-pulse (shimmer only); SatRouteFade honors useReducedMotion plus MotionConfig reducedMotion=user; the global .sat-product reduced-motion block collapses durations to 0.01ms and kills transforms and spins.
8c. Manual: turn Reduce Motion ON (or DevTools Rendering emulation of prefers-reduced-motion: reduce), then navigate Library to Sessions to Room to Results to Detail: no fades, slides, shimmer sweeps, spinner rotation, or live-pulse; content appears instantly at full opacity; segmented thumb swaps instantly; dialogs appear without scale.
Pass: sweeps match expectations plus manual reduced-motion pass on all 6 routes plus no stuck mid-fade content. Fail ROUTEs by file: motion curve, duration, or stagger issues to the owning component agent; a missing guard to 01 (CSS) or 02/03 (MotionConfig and useReducedMotion wiring) per file.

### Step 9 — Cross-route consistency sweep, the polish half [RUN, ROUTE on fail]

Walk all six routes at 390px, 768px, and 1280px plus touch emulation, comparing against this table (values state the post-Phase-01/03/04 intent; when a phase documented a deliberate deviation, that doc wins and this table is updated, not the product):

    Radii: cards and rows 16px (rounded-2xl), section cards 16px, inputs and buttons 10-12px, dialogs 22px (sheet 22px top on mobile), menus 13px, pills full, segmented 10px shell and 8px option. Check by eyeball plus rg rounded- per route.
    Shadow: 1px hairline border plus 0 1px 2px rgba(0,0,0,.04) resting; menu uses --sat-menu-elevation, dialog uses --sat-dialog-elevation; hover is border plus shadow only, never lift (-translate-y absent). Hover each row; grep -translate-y must return zero in SAT scope.
    Type: eyebrow 10px 0.14em uppercase tertiary; H1 30px -0.045em; description 13px/20px secondary; row title 13-14px semibold; meta 10-11px tertiary; stat value 22px -0.03em tabular; score hero 52px; timer tabular-nums. Compare side-by-side screenshots per route.
    Tone: pill tones identical hex per TONE_PILL_CLASS and TONE_DOT_CLASS plus satOutcomeTone map; no forked copies in routes. Grep tone maps; compare Results versus Library pills.
    Spacing rhythm: SatContainer max-1180 plus px-4 / sm:6 / lg:10 plus pt-7 / md:10 / pb-14; header border-b plus pb-6; list mt-4 space-y-2; stat strip mt-5 grid-cols-3 gap-2; search plus filter gap-2. Measure at 3 viewports.
    Empty, loading, error: loading shows header plus skeleton (never a blank page); loaded shows exactly one polite count; empty shows SatEmptyState (icon tile plus title plus hint plus at most one human detail plus action); error shows SatInlineError or full ErrorSurface with retry; never skeleton plus count or skeleton plus error together. Verify with Slow 3G throttle and forced errors.
    Focus: every interactive element shows the 3px accent focus ring; skip link first; dialogs trap with Cancel focused; menus return focus to trigger; segmented uses roving tabindex. Keyboard-only walkthrough per route.
    Targets: at least 44px on coarse pointers (search-clear 32px exempt; menu items 36px desktop density accepted only with the coarse-pointer floor intact — verify via Pixel 5 project plus DevTools touch).
    Glass: sidebar, sticky room header, and mobile bars only; content cards solid; reduced-transparency collapses to opaque.
    Copy: no IELTS band language in SAT surfaces; invalidation copy explicit ('Exam terminated by proctor'); practice caption on scores. Grep band and IELTS in SAT routes returns zero outside provider-guard tests.

Pass: zero unexplained deviations; every deviation is either fixed (via ROUTE) or recorded as an accepted exception with owner plus rationale in the log. Fail ROUTEs per file owner (section 10).

### Step 10 — Skeleton-XOR plus live-region plus focus audit, dedicated pass [RUN, ROUTE on fail]

1. Skeleton-XOR: for each list surface (Library, Sessions, Results, Room roster): under slow network assert skeleton visible AND count absent; when loaded assert count visible AND skeleton absent; when empty assert count absent AND empty-state present. Code-search SatListSkeleton versus SatResultCount call sites to prove mutual exclusion in every branch (loading, error, empty, data).
2. Live regions: exactly one role=status per list when loaded; aria-live polite; skeleton announces via its own role=status plus aria-label ('Loading SAT exams' and 'Loading SAT sessions' and 'Loading SAT results'); errors use role=alert; success banners use role=status; no double-announce (axe plus screen-reader smoke: count read once).
3. Focus: skip-link reaches main; search Escape does not drop focus; row activation moves focus to the detail H1 (or preserves logical order); dialog open focuses Cancel; dialog close returns focus to the invoking control; menu close returns focus to the trigger; segmented arrows move selection plus focus together.
Pass: all three sub-audits clean on all routes. Fail ROUTEs to the route or primitive owner that owns the broken call site.

### Step 11 — Unfinished-TODO and placeholder sweep [RUN, ROUTE or ESCALATE]

    rg -n 'TODO|FIXME|XXX|HACK|Lorem|xxx' src/products/sat src/index.css plans/phase-0*.md plans/phase-04*.md
    rg -n 'console\.log|console\.debug|debugger' src/products/sat --glob '!**/__tests__/**'
    rg -n 'placeholder=' src/products/sat/routes

Triage every hit: (a) legitimate user-facing placeholder attributes (for example 'Search exams', 'Practice Test 06' as placeholder-not-value with Create disabled until typed — pinned by test) record as accepted; (b) leftover dev TODO or console ROUTEs to the owner; (c) plan-doc TODO updates the doc.
PII check: rg studentName and studentEmail in SatSessionRoomRoute.tsx — names never land in logs or artifacts; only IDs in logError and logInfo.

### Step 12 — Plan-docs update plus sign-off [RUN]

1. Verify plans/ contains objective, deps, files, contracts, steps, pseudocode, edge-cases, tests, verification, and DoD for all six phase plans plus overall-plan consistency (no API drift between Phase-03 output and Phase-04 consumption; token names match the Phase-01 table).
2. Append the verification log summary (commit SHA, per-row exits, contrast table, motion notes, consistency exceptions, TODO triage) to the implementation-time log file.
3. Declare the initiative gate per section 11. When any row is red, do not sign off — leave the log open with the repair tickets pending.

---

## 6. Important code and pseudocode (audit sketches — not full files)

### 6.1 Contrast-ratio calculator (run in node against computed rgb from DevTools)

    function channelToLinear(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
    function luminance(rgb) { return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2]); }
    function ratio(fg, bg) { const hi = Math.max(luminance(fg), luminance(bg)); const lo = Math.min(luminance(fg), luminance(bg)); return (hi + 0.05) / (lo + 0.05); }
    PASS is ratio >= 4.5 (normal text) or >= 3.0 (large text and UI components and focus). Record each C1-C9 value in the log.

Token sketch (exact names from the Phase-01 table win; expected shape):

    .sat-product {
      --sat-staff-canvas: #F5F5F7;
      --sat-staff-surface: #FFFFFF;
      --sat-staff-surface-raised: #FBFBFD;
      --sat-staff-border: rgba(0,0,0,0.06);
      --sat-staff-text: #1D1D1F;
      --sat-staff-text-secondary: #515154;
      --sat-staff-text-tertiary: #6E6E73;
      --sat-staff-accent: var(--sat-accent-core);
      --sat-staff-accent-hover: #0077ED;
      --sat-staff-focus: color-mix(in srgb, var(--sat-staff-accent) 72%, white);
      --sat-staff-radius-card: 16px; --sat-staff-radius-dialog: 22px; --sat-staff-radius-pill: 999px;
      --sat-staff-shadow-card: 0 1px 2px rgba(0,0,0,0.04);
      --sat-staff-motion-state: 160ms; --sat-staff-motion-banner: 140ms;
      --sat-staff-ease: cubic-bezier(.2,0,0,1);
    }

Class-hook sketch (what the consistency sweep greps for; Phase 03 owns the definitions):

    .sat-list-row  button frame, hover is background-color only, active scale 0.99, never -translate-y
    .sat-row-chevron  trailing chevron, nudges 2px on row hover, static under reduced motion
    .sat-segmented / .sat-segmented-option[aria-checked] / .sat-segmented-thumb / .sat-segmented-label
    .sat-menu / .sat-menu-item (+ data-current, data-destructive) / .sat-menu-trigger-chevron
    .sat-dialog-overlay / .sat-dialog / .sat-dialog-center / .sat-quiet-button
    .sat-search-clear  32px centered exemption; .sat-route-fade  animation none plus reduced-motion guard
    .sat-row-enter  160ms both, delay min(index,5) x 60ms; .sat-route-enter  160ms; .sat-banner-enter  140ms
    .sat-skeleton-shimmer  gradient sweep 1.35s, animate-pulse forbidden; .sat-spinner  0.8s ring; .sat-live-dot  1.6s pulse

### 6.2 Skeleton-XOR branch proof (read every list route for this shape)

    loading:  Header plus SatListSkeleton (label Loading SAT exams/sessions/results); no count, no list
    error:    Header plus SatInlineError or ErrorSurface with retry; no skeleton, no count
    empty:    Header plus SatEmptyState (title plus hint plus action); no count (count returns null on total 0)
    data:     Header plus SatResultCount (one role=status) plus SatList of SatListRow
    never:    skeleton plus count together; error plus skeleton together; two live regions for one list

### 6.3 Reduced-motion manual script (DevTools, no code)

1. Rendering panel: emulate prefers-reduced-motion reduce (plus OS Reduce Motion ON for the Safari check).
2. Cold-load each route; assert: no fade or slide on rows or route chrome, no shimmer sweep, no spinner rotation (static ring plus text), no live-dot pulse, segmented thumb swaps instantly, dialog appears without scale, chevron nudge absent.
3. Remove emulation: motion returns (160ms fades, 60ms stagger, shimmer), proving the guard is conditional, not dead code.

### 6.4 E2E scope note (why two specs exist)

- npm run e2e:sat-a11y runs playwright.sat-a11y.config.ts against sat-student-accessibility.spec.ts — the exam-mode guard (must stay green; proves shared CSS did not leak).
- e2e/sat-product-workspace.spec.ts is the staff-workspace flow but backend-backed (ADMIN_STORAGE_STATE plus MySQL key plan plus live delivery transport). Phase 05 runs it only when the Main Agent provides backend plus storage state; otherwise records SKIP (no backend) with reason and relies on vitest plus the manual walkthrough for staff coverage. Never fake the DB or storage state to force it green.

---

## 7. Edge cases

1. Token-alias drift: Phase 01 may ship --sat-staff-* while tests or components still assert legacy hex (bg 0071e3, f5f5f7, black alphas). Treat as expected migration residue: fail the hygiene check, ROUTE to 01/03 for the alias plus test update — Phase 05 never edits either side.
2. useReducedMotion versus CSS guard overlap: SatRouteFade (JS guard) plus .sat-route-fade (CSS guard) plus the .sat-product global reduced-motion block all coexist. All three must be present; removing one because 'another covers it' is a regression.
3. Stagger cap: --sat-row-index may exceed 5 on long lists — CSS must clamp via min(index,5). Any route passing a raw index without the CSS-layer cap fails Step 8.
4. Search-clear versus coarse floor: the 32px exemption rule must come after the coarse 44px rule at equal specificity, with important on all four declarations — an order swap breaks it silently (covered by F-A6; eyeball the cascade too).
5. Dialog mobile sheet: .sat-dialog-center docks to the bottom at 640px and below with safe-area padding; desktop centers via translate(-50%,-50%). Reduced-motion must not strand it mid-transform.
6. Inline-error retry color: when Phase 03 tokenizes the accent hex into an accent token, the SatPage.test.tsx assertion on the hex class will fail — route to Phase 03 to update the test, do not revert the token.
7. Forced-colors and high-contrast: status pills must remain distinguishable without color (dot plus label plus weight survive); focus ring switches to Highlight; glass collapses to Canvas.
8. PII in artifacts: screenshots and recordings during verification may contain student names — keep them local, never paste into docs or logs; log excerpts use IDs only.
9. Flaky-network branches: skeleton, error, and empty states must be verified under throttled plus offline conditions, not just mocks — mocks prove logic, throttling proves no blank page.
10. Backend-backed e2e without backend: when MySQL or storage-state is unavailable, mark SKIP explicitly — a skipped e2e with reason passes the gate; a faked green fails it.

---

## 8. Tests to add or update (Phase 05 authors NONE directly — gap-fills below are requests to owners)

- No new test files planned. Existing coverage is dense (6 shell plus 5 primitive plus 5 route plus CSS contracts plus list-params plus schedule validation).
- Gap-fill requests Phase 05 may file (owner authors, Phase 05 verifies):
  - When the cross-route audit finds an untested invariant (for example bento stat-strip keyboard access, room-header timer tabular-nums, result-hero practice caption), file to Phase 03 (primitive) or 04A/04B (route) with the exact assertion text in section 4.2 style.
  - When token migration orphans an assertion (see section 7 edge case 6), file to the test's owner for the alias update.
  - When skeleton-XOR has a branch without coverage (for example error-during-refetch in Session Room), file to 04B.
- Forbidden: Phase 05 must not weaken any existing assertion (no threshold lowering, no snapshot deletion, no skip without Main-Agent approval).

---

## 9. Verification commands plus pass/fail gates (the full matrix)

V1  Typecheck: npm run typecheck (npx tsc --noEmit). Pass is exit 0. Fail routes to the file owner (section 10).
V2  Scoped SAT vitest, 12 paths (section 5 Step 2): npm run test:run -- <each path>. Pass is all 12 exit 0. Fail routes to the failing file's owner.
V3  Full vitest: npm run test:run. Pass is exit 0 repo-wide. SAT failures route to the owner; non-SAT failures escalate to the Main Agent.
V4  ESLint scoped: npx eslint src/products/sat src/index.css e2e/sat-product-workspace.spec.ts playwright.sat-a11y.config.ts. Pass is zero errors and warnings on SAT paths. Fail routes to the file owner.
V5  ESLint repo signal: npm run lint. Pass is no new SAT-attributable findings versus baseline. Fail routes to the file owner.
V6  CSS contracts: V2 satContractsCss.test.ts plus section 5.5b greps. Pass is F-A6 plus F-A12 green, zero unexplained hex, zero sat-ui refs, glass plus fallback paired. Fail routes to 01 (tokens) or the component owner.
V7  sat-a11y Playwright: npm run e2e:sat-a11y (playwright --config playwright.sat-a11y.config.ts, chromium plus webkit plus touch). Pass is all projects green. Fail routes to 01 (shared var), the shell owner, or infra to the Main Agent.
V8  Contrast: manual plus section 6.1 calculator for C1-C9 at default, more-contrast, and forced-colors. Pass is AA (4.5 normal, 3.0 large and UI) everywhere. Fail routes to 01.
V9  Motion audit: section 5 Step 8 greps plus reduced-motion walkthrough on 6 routes. Pass is 150-200ms ease-out, stagger cap 6, no springs or pulse, guards conditional. Fail routes to the component owner, 01, or 02/03 wiring.
V10 Consistency: section 5 Step 9 table at 390, 768, and 1280 plus touch. Pass is zero unexplained deviations. Fail routes to the file owner.
V11 Skeleton-XOR plus live-region plus focus: section 5 Step 10 protocol (throttled plus screen-reader smoke plus keyboard-only). Pass is XOR holds, one polite count, Cancel-focused, focus returns. Fail routes to the route or primitive owner.
V12 TODO sweep: section 5 Step 11 greps plus triage. Pass is zero untriaged hits and zero stray consoles. Fail routes to the owner or Main Agent.
V13 Docs: section 5 Step 12 checklist. Pass is all six plans complete plus no API drift plus log filed. Fail routes to the Main Agent.

Global gate: V1-V13 all green (or explicitly SKIP-with-reason for the backend-backed staff e2e without backend) on the same commit SHA. Any red re-opens Wave 4; after the owning agent lands a fix, Phase 05 re-runs from V1, not just the red row.

---

## 10. Repair routing (Phase 05 never patches — it tickets)

Token value, missing --sat-staff-*, contrast, glass fallback, global reduced-motion, or .sat-ui leak via a shared variable goes to Phase 01. Example: tertiary-label ratio 3.9:1; raw accent hex left in components; sidebar unreadable under reduced-transparency.
Sidebar, mobile header, bottom nav, route fade, skip link, or role nav goes to Phase 02. Example: pill missing on the active nav; chrome visible on /sat/exams/ID; fade stuck mid-opacity.
Search, button, pill, row, stat-strip, count, empty, skeleton, inline-error, section-card, menu, segmented, dialog, their tests, or class hooks (.sat-list-row, .sat-row-chevron, .sat-segmented-*, .sat-menu-*, .sat-dialog-*) goes to Phase 03. Example: dot-without-label; animate-pulse back; Cancel not focused; thumb duplicated.
Library, Sessions, New Session sheet, Results content, filters, empty copy, or stat bento goes to Phase 04A. Example: IELTS exam offered; count double-announces; archived toggle loses search.
Room header, timer, roster, detail bento, confirms, menus, Result hero, modules, QuestionRawTable wrapper, or Access wrapper chrome goes to Phase 04B. Example: pending freezes session controls; overrun color-alone; band language in Results.
Non-SAT suite red, infra (ports, browsers, DB, storage state), or scope conflict goes to the Main Agent. Example: IELTS suite failed on baseline too; port 3000 busy; MySQL unreachable.
Plan-doc drift or API mismatch between 03 output and 04 consumption goes to the Main Agent (who assigns). Example: a route imports a prop the primitive no longer exports.

Repair ticket shape (file in the log): failing gate (V number), command plus exit, minimal repro, owning phase, suspected file and line, contract violated (section 4 ref), no product edit by Phase 05.

---

## 11. Definition of Done

- [ ] V1-V13 matrix (section 9) all green (or SKIP-with-reason) on one clean commit SHA, recorded in the verification log with exit codes.
- [ ] Every section 4 contract holds: all 12 scoped suites plus full suite plus F-A6/F-A12 plus route boundary, provider, polling, confirm, and PII behaviors intact.
- [ ] Contrast C1-C9 meets AA at the default theme plus sane at more-contrast and forced-colors (values logged).
- [ ] Motion: 150-200ms ease-out everywhere, stagger capped at 6, no springs, pulse, or lift; reduced-motion kills all non-essential motion without stranding content.
- [ ] Consistency: radii, shadow, type, tone, spacing, empty-loading-error, focus, targets, glass, and copy coherent across all six routes at 390, 768, and 1280 plus touch, with zero untracked deviations.
- [ ] Skeleton-XOR plus live-region plus focus audits clean; TODO sweep triaged to zero; no stray consoles; PII discipline intact.
- [ ] No product file edited by Phase 05; every failure routed per section 10 and re-verified from V1 after the fix.
- [ ] plans/ docs consistent (six phase plans plus overall plan, no API drift); verification log filed.
- [ ] No implementation performed in the planning stage (this file is plan-only) — implementation runs Wave 4, alone, after all upstream gates.
