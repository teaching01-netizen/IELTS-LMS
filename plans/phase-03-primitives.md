# Phase 03 - List-System Primitives (PLAN ONLY)

Workflow: ai-planning-workflow. Stage: PLAN ONLY - no product code touched.
Scope boundary: SAT staff workspace only (src/products/sat plus .sat-product CSS in src/index.css).
Exam-mode Bluebook (.sat-ui, src/features/student-delivery) is READ-ONLY. IELTS surfaces plus backend are out of scope.
Overall plan: plans/overall-plan.md sections 1-5. Phase 03 owns the list-system primitives, depends on 01,
runs parallel with 02, feeds 04A plus 04B, and is gated by 05.
Style guide: 2026 direction from overall plan section 1 - soft spatial UI (1px border plus very soft shadow,
16-24px radii, calm F5F5F7-family canvas), glass sparingly with solid fallback (NOT in primitives - primitives
are solid cards), bento where it pays (primitives enable it, pages compose it), editorial type (keep the 30px
page title with -0.045em tracking), warm human texture max one detail (empty state only), 2026 components
(44-52px inputs and buttons with 12-16px radii plus strong focus rings, pill badges with dot-plus-label,
150-200ms transitions, no lift-on-hover, no spring in ops lists), no neon, no heavy gradients, no neumorphism.

## 1. Objective

Bring all list-system primitives to 2026 component styling on top of Phase-01 tokens, with zero behavioral
or accessibility regression.
A. Tokenize SatPage.tsx, Menu.tsx, SegmentedControl.tsx, ConfirmDialog.tsx from inline hex and arbitrary
   Tailwind alphas onto --sat-staff tokens (canvas, surface, border, text, accent, focus, radius, shadow,
   motion) supplied by Phase 01. Solid readable cards. No glass in primitives.
B. 2026 finish: 1px token border plus very soft token shadow, 12-16px control radii and 16px card radii,
   confident type scale (titles 13-14px semibold, meta 10-11px, tabular-nums where numeric), 150-200ms
   cubic-bezier(.2,0,0,1) transitions, hover equals border plus shadow or color only (never lift),
   shimmer skeletons (never pulse), capped stagger (first 6 rows only).
C. Keep every exported API plus DOM, ARIA, and class hook identical so 04A and 04B call sites and all
   existing tests keep passing. Hooks: sat-list-row, sat-row-chevron, sat-segmented family, sat-menu family,
   sat-dialog family, sat-skeleton-shimmer, sat-row-enter, sat-live-dot, sat-search-clear, sat-quiet-button,
   sat-spinner, sat-route-enter.
D. Hold all a11y invariants: dot-plus-label status, skeleton-XOR rule, polite live regions, radiogroup plus
   roving tabindex plus sliding thumb, Radix plus static fallback with aria-current, AlertDialog Cancel-focused
   plus backdrop-tap-never-dismisses, focus-visible rings, 44px targets with 32px search-clear exemption,
   full prefers-reduced-motion, transparency, contrast, and forced-colors opt-outs (via existing CSS).

Non-goals: no filtering, polling, proctor-action, or routing change. No new stores. No .sat-ui edits.
No src/index.css edits (Phase 01 owns it). No route-file edits (04A and 04B own them).
No SatRoot edits (Phase 02 owns it).

## 2. Dependencies

Phase 01 Staff Token Foundation - HARD, must finish first.
  Phase 01 lands the complete .sat-product token set in src/index.css (see section 5 token table).
  Tokens exist and are unused by components yet. CSS contract tests stay green (satContractsCss.test.ts,
  F-A6 plus F-A12). Phase 03 consumes via var(--sat-staff-X, fallback) and Tailwind arbitrary var refs.
  Phase 03 never defines tokens itself. If a token is missing, record blocked-on-Phase-01, do not hardcode.

Phase 02 App Shell - parallel, disjoint ownership, no code dependency.
  Informational only. Inspected SatRoot.tsx (195 lines): it consumes SatMenu with triggerContent, compact,
  icon, align, width (workspace switcher 212px, mobile 208px, account menu) and uses sat-route-enter for the
  mobile top indicator. Phase 03 must not change SatMenu props in a way that breaks SatRoot.

Phases 04A and 04B - downstream consumers.
  They compose Phase-03 primitives (row content hierarchy, StatStrip-as-bento, room header, confirm and menu
  wiring). Phase 03 keeps prop shapes plus class hooks stable so their plans can assume the section 4 API.
  The one intentional test-assertion update (InlineError accent, section 8) must be flagged to 04A, 04B, 05.

Phase 05 Verification - downstream verifier.
  Runs the full matrix (typecheck plus full vitest plus eslint plus e2e sat-a11y plus contrast and motion audit).
  Phase 03 lists scoped verification in section 9. Phase 05 reruns everything.

Wave order per overall plan section 5: Wave 1 is 01. Wave 2 is 02 plus 03 in parallel.
Wave 3 is 04A plus 04B. Wave 4 is 05 alone.
Gates: a phase unlocks only when implementation is finished plus tests, typecheck, lint pass plus Definition
of Done is satisfied plus Main Agent verifies. Never unlock dependents early.
## 3. Affected and new files (ownership lock)

MAY edit (and only these):
  - src/products/sat/ui/SatPage.tsx (442 lines): SatContainer, SatPageHeader, SatSearchField,
    SatPrimaryButton, SatStatusPill plus satOutcomeTone, SatList, SatListRow, SatStatStrip, SatResultCount,
    SatEmptyState, SatListSkeleton, SatInlineError, SatReleaseTag, SatEyebrow, SatSectionCard, SatMeta.
  - src/products/sat/ui/Menu.tsx (233 lines): SatMenu with Radix plus static fallback.
  - src/products/sat/ui/SegmentedControl.tsx (81 lines): SatSegmentedControl.
  - src/products/sat/ui/ConfirmDialog.tsx (208 lines): SatConfirmDialog plus SatFormDialog plus Static fallbacks.
  - src/products/sat/ui/__tests__/SatPage.test.tsx (231 lines), Menu.test.tsx (93),
    SegmentedControl.test.tsx (49), Dialogs.test.tsx (185): scoped assertion updates and additions only.
    satContractsCss.test.ts is READ-ONLY (Phase 01 contract).
  - This plan file only: plans/phase-03-primitives.md. No other plans edits.

MUST NOT touch (other phases own them, read-only for inspection):
  - src/index.css: Phase 01 owns the entire SAT product block (.sat-product, sat-menu, sat-dialog,
    sat-segmented, sat-row-enter, shimmer, live-dot, spinner, search-clear F-A6, route-fade F-A12,
    reduced-motion and transparency and contrast guards). If Phase 03 needs a CSS-hook tweak, file it
    as a Phase-01 follow-up request (section 5.3), do not edit.
  - src/products/sat/SatRoot.tsx: Phase 02 owns shell, sidebar, mobile bars, route fade.
  - src/products/sat/routes files (ExamLibrary 183, Sessions 248, SessionRoom 290, Results 138,
    ResultDetail 178, Access 36): Phases 04A and 04B own all route composition including row inner content
    (sat-row-chevron slots), --sat-row-index call sites with min(rowIndex,5), StatStrip values, search/filter.
  - .sat-ui, src/features/student-delivery, IELTS, backend: out of scope entirely.

New files: none. No new components, stores, or CSS files. If implementation finds a shared token-alias helper
unavoidable, prefer inline var with fallback over a new module. Any new module needs Main-Agent approval.

## 4. Contracts and interfaces to preserve (do-not-break list)

Verified 2026-09-11 by reading owned files plus tests plus route usages plus src/index.css lines 1577-2066.
Implementation must keep ALL of these behaviorally identical.

### 4.1 Exported API shapes (props stay identical, only className strings change)

  SatContainer: children ReactNode, className optional string.
  SatPageHeader: eyebrow string, title string, description optional string, actions optional ReactNode.
  SatSearchField: id string, label string, value string, onChange(value string) void, placeholder string,
    widthClassName optional string.
  SatPrimaryButton: onClick void, icon optional ReactNode, ariaLabel optional string, children ReactNode,
    pending default false, disabled default false. Disabled equals pending OR disabled. aria-busy when pending.
  SatStatusTone union: published, live, changes, paused, info, ready, invalidated, draft, archived,
    finished, cancelled, neutral, pending.
  satOutcomeTone(outcome string): scored maps to ready. pending maps to pending.
    invalidated_proctor and invalidated_timeout map to invalidated. Anything else maps to neutral.
    DO NOT FORK - results lanes import this single table.
  SatStatusPill: tone SatStatusTone, pulse optional boolean, children ReactNode.
  SatList: children ReactNode. Renders div mt-4 space-y-2.
  SatListRow: onOpen void, ariaLabel optional string, children ReactNode, index optional number.
    Index is optional position for capped stagger. Omit for no entrance.
  SatStat: id string, label string, value string-or-number, hint optional string, onSelect optional void.
    onSelect present renders a button with aria-label label-colon-value, else a div.
  SatResultCount: total number, visible number, itemLabel string, scopeLabel optional string.
    scopeLabel overrides itemLabel as the unit word. Backward compatible when absent.
  SatStatStrip: stats SatStat array, label default Summary. Renders section with aria-label.
  SatEmptyState: icon ReactNode, title string, hint string, action optional ReactNode.
  SatListSkeleton: rows default 3, label default Loading.
  SatInlineError: title string, description string, onRetry optional void, retryLabel default Retry.
  SatReleaseTag: releaseStatus string. Renders text Practice middle-dot releaseStatus.
  SatEyebrow: id optional string, className optional string, children ReactNode. Renders p.
    SessionRoom passes text-9px override which must still win.
  SatSectionCard: labelledBy optional string, className optional string, children ReactNode.
    Renders div with aria-labelledby passthrough.
  SatMeta: className optional string, children ReactNode. Renders p.
  SatMenuItem: id string, label string, onSelect void, disabled optional, destructive optional,
    current optional, separatorBefore optional.
  SatMenuProps: label string, items SatMenuItem array, triggerContent optional ReactNode,
    icon optional LucideIcon, compact optional boolean, align start-or-end, width optional number.
  SatMenu(props): Radix branch when supportsNativeMenu is true, else StaticMenu.
    supportsNativeMenu means window defined AND window.matchMedia is a function.
  SatSegmentedControl generic over string: label string, value T, options readonly array of
    value-plus-label, onChange(value T) void, className optional string.
  SatConfirmDialog: open boolean, title string, description string, confirmLabel string,
    destructive default false, onCancel void, onConfirm void.
  SatFormDialog: open boolean, eyebrow string, title string, onClose void, children ReactNode.
### 4.2 DOM, ARIA, and class hooks (tests plus CSS plus routes pin these)

  sat-list-row on the button frame in SatListRow. SatPage.test asserts button.sat-list-row. Routes render
    inner content only. Keep button type button plus aria-label passthrough.
  sat-row-enter plus style --sat-row-index only when index is defined. Test: no enter class without index,
    enter class plus --sat-row-index with index. Routes pass min(rowIndex,5). CSS caps with
    min(var(--sat-row-index,0),5) and delay min(index,5) times 60ms. Keep the conditional and var name.
  No translate-y in the row class. Test asserts never lifts on hover. Hover stays border plus shadow or color
    only. Press scale 0.99 is CSS-owned and allowed.
  sat-row-chevron: routes own the chevron slot (ArrowRight with sat-row-chevron class). CSS nudges
    translateX 2px on row hover. Primitives must NOT render a chevron themselves.
  sat-segmented, sat-segmented-option, sat-segmented-thumb, sat-segmented-label: SegmentedControl.test pins
    exactly one thumb on the selected segment. CSS lines 1875-1920 own the look. Keep all names. Keep role
    radiogroup with aria-label. Children role radio with aria-checked and roving tabIndex (selected 0,
    else -1). Thumb is motion.span with layoutId from useId and aria-hidden. Keep capitalize class.
  sat-menu, sat-menu-item, sat-menu-trigger-chevron, data-sat-menu-animate, --sat-menu-origin: Menu.test pins
    menu and menuitem and separator roles, data-destructive, aria-current true, animate attribute. Keep in
    BOTH Radix and static branches.
  sat-dialog-overlay plus sat-dialog plus sat-dialog-center plus sat-product scope on overlay AND content.
    Dialogs.test portal-scope tests pin this (Radix portals mount at body, scope must ride the portal nodes).
    Keep OVERLAY_CLASS sat-dialog-overlay sat-product. CONFIRM_CLASS sat-dialog sat-dialog-center sat-product
    with w calc(100vw-40px) max-w 390px p-5. FORM_CLASS sat-dialog sat-dialog-center sat-product with w
    calc(100vw-40px) max-w 480px overflow-hidden.
  sat-quiet-button on Cancel. Keep on Cancel in both branches.
  sat-skeleton-shimmer, never animate-pulse. SatPage.test pins shimmer present and animate-pulse absent.
    Keep shimmer class, role status with aria-label, sr-only label, aria-hidden bars.
  sat-live-dot only when pulse is true. Pill pulse test pins this. Keep dot aria-hidden plus rounded-full.
  sat-search-clear. F-A6 CSS contract pins top 50 percent important, translateY(-50 percent), 32px min block
    and inline size. Keep the class on the clear button. Keep aria-label Clear-plus-label, Escape-to-clear,
    hidden-when-empty.
  sat-spinner on the PrimaryButton pending indicator. Keep spinner span plus aria-busy plus disabled.
  Dialog semantics. Confirm: role alertdialog, aria-modal true, aria-labelledby, aria-describedby, useId-scoped,
    unique when stacked. Form: role dialog, aria-modal true, aria-labelledby, useId-scoped. open false renders
    null. Escape cancels or closes. Cancel-focused (cancelRef.focus in static branch, AlertDialog.Cancel
    default in Radix). Backdrop-tap-never-dismisses: no onPointerDownOutside or onInteractOutside dismiss.
  Menu semantics. Trigger always carries aria-label label in compact and non-compact branches. Popup role menu
    with aria-label. Items role menuitem plus data-current and data-destructive plus aria-current true when
    current (stays clickable, still fires onSelect). separatorBefore with index greater than 0 renders a
    separator. Escape closes without selecting. Closed renders no interactive menu nodes.
  Live regions. ResultCount is p role status aria-live polite. Skeleton-XOR rule: callers render EITHER
    skeleton OR ResultCount, never both (avoids double announce). ResultCount returns null when total is 0
    or less (empty-state owns the announce). InlineError is role alert with optional retry.
  Focus. Keep focus-visible ring classes in TSX (rings also enforced by global CSS lines 1616-1620). Keep
    ring-offset canvas semantics via the canvas token (section 6.2).
  Motion guards. Keep 160ms row-enter, 140-160ms route and banner, ease 0.22-1-0.36-1, stagger delay
    min(index,5) times 60ms. No springs in lists. Reduced-motion, transparency, contrast, forced-colors stay
    handled in CSS. TSX adds no new animation.

### 4.3 Route call-site assumptions (04A and 04B keep consuming, do not force churn)

  Library, Sessions, Results compose SatContainer, then SatPageHeader with search plus primary-button actions,
    then optional StatStrip, then optional SegmentedControl, then either Skeleton XOR (ResultCount plus List
    of ListRow with 13px semibold title, 10px meta, 9px tabular-nums time, StatusPill, sat-row-chevron)
    XOR (ResultCount plus EmptyState). Row inner markup stays in routes. SatListRow stays a dumb button frame.
  SessionRoom consumes SatEyebrow, SatSearchField, SatSectionCard, SatStatusPill, SatMenu, SatConfirmDialog.
  ResultDetail consumes SatSectionCard and SatStatusPill. Library consumes SatFormDialog. Sessions consumes
    SatFormDialog via the New Session sheet. None of these imports may break.
  satOutcomeTone stays the single source of the outcome-to-tone table. Routes must not fork it.

## 5. Phase-01 token dependency (requirement, NOT an edit)

Phase 03 does not create or edit tokens. It requires Phase 01 to have landed the following .sat-product-scoped
tokens in src/index.css. Names per overall plan section 3 Layer 0: --sat-staff forked from shared values where
semantics diverge. Never mutate .sat-ui or --sat-accent-core.

### 5.1 Required token table (implementation uses var(--sat-staff-X, fallback))

  --sat-staff-canvas: page canvas, today F5F5F7.
  --sat-staff-surface: card, input, menu, dialog fill, today FFFFFF.
  --sat-staff-border: 1px card and input hairline, today rgba black 0.06 to 0.08.
  --sat-staff-border-strong: hover and emphasis border.
  --sat-staff-text: primary, today slate-950 and 1d1d1f.
  --sat-staff-text-secondary: secondary, today slate-500 and 515154.
  --sat-staff-text-tertiary: meta, eyebrow, count, today slate-400 and 6e6e73.
  --sat-staff-accent: today 0071e3 (equals --sat-accent-core, do not redefine core).
  --sat-staff-accent-hover: today 0077ed.
  --sat-staff-accent-active: today 0067c9.
  --sat-staff-accent-tint: focus ring wash, today rgba 0-113-227 0.10 to 0.25.
  --sat-staff-danger: today d70015 and b42318 family.
  --sat-staff-success and --sat-staff-warning: plus text and dot variants for pills. May reuse existing
    emerald, amber, red scales if Phase 01 maps them to semantic names.
  --sat-staff-focus: today color-mix accent 72 percent white, 3px outline and 4px ring.
  --sat-staff-radius-sm: 8-10px for menu items, segmented options, dialog buttons.
  --sat-staff-radius-md: 12px for inputs and primary buttons.
  --sat-staff-radius-lg: 16px for cards, rows, dialogs (rounded-2xl).
  --sat-staff-radius-pill: 999px for pills.
  --sat-staff-shadow-card: today 0 1px 2px rgba black 0.04 plus hairline half-px.
  --sat-staff-shadow-menu: existing sat-menu-elevation value.
  --sat-staff-shadow-dialog: existing sat-dialog-elevation value.
  --sat-staff-motion-fast: 120-140ms.
  --sat-staff-motion-medium: 150-200ms with ease cubic-bezier(.2,0,0,1).

Acceptance: Phase 01 documents the final token table plus fallbacks plus AA pairs. Phase 03 implementation
step 0 verifies each token exists (grep src/index.css for --sat-staff-) and records any missing token as
blocked-on-Phase-01 rather than inventing a one-off hex.

### 5.2 Consumption pattern (how TSX references tokens without breaking Tailwind)

  Prefer Tailwind arbitrary-value token refs so no new CSS is needed. Examples in plain words:
    background surface token, border token, secondary text token, accent bg with hover and active variants,
    focus ring with accent-tint token, shadow with shadow-card token, radius with radius-md token, each with
    a documented hex fallback where Tailwind allows one (for example surface token falling back to FFF).
  Keep literal Tailwind status scales (emerald, amber, red, slate) inside TONE_PILL_CLASS and TONE_DOT_CLASS
    unless Phase 01 provides semantic pill tokens - then swap the map values to token refs in one place
    (single table edit, no call-site churn). Do not scatter tone logic.
  Inline style stays reserved for --sat-row-index only. No new inline styles.

### 5.3 CSS-hook follow-ups (do NOT edit src/index.css)

  If a needed CSS-hook change surfaces (for example segmented 44px, menu-item 44px - see section 7 item 5),
  record it as PHASE-01 FOLLOW-UP with selector plus reason in the implementation summary. Rely on the
  coarse-pointer 44px floor plus 32px search-clear exemption in the meantime (both already in CSS, F-A6 pins it).

## 6. Step-by-step implementation plan (execute in order, stop-and-verify at each gate)

Each step edits ONLY section-3-owned files. Keep diffs mechanical: className strings plus pill tables only.
No prop, role, hook, or copy changes except the one flagged test-assertion update in step 10.

Step 0 - Pre-flight (read-only, about 15 min).
  1. Re-read the overall plan plus this plan plus the src/index.css SAT block (about lines 1577-2066) to
     confirm final Phase-01 token names (they may differ slightly from the section 5.1 draft - adopt Phase 01
     actual names, update the mapping in the summary).
  2. Run baseline gates and record green: npx tsc --noEmit; npm run test:run with the four primitive suites
     (SatPage, Menu, SegmentedControl, Dialogs); npx eslint on the four owned components.
  3. Grep owned files for hardcoded staff chrome to build the replacement checklist: 0071e3, 0077ed, 0067c9,
     d70015, f5f5f7, black with alpha, slate-, shadow 0_1px, rounded-.

Step 1 - SatContainer plus SatPageHeader plus Eyebrow, Meta, SectionCard (editorial frame).
  SatContainer: keep mx-auto max-w-1180px px-4 sm:px-6 lg:px-10 pb-14 pt-7 md:pt-10 layout exactly.
    No background (canvas comes from shell). Ensure no hardcoded color remains.
  SatPageHeader: tokenize divider border-black 0.065 to border token. Eyebrow matches SatEyebrow scale.
    Title keeps 30px semibold with -0.045em tracking, color to text token.
    Description keeps 13px with leading-5, color to secondary token. Actions row keeps flex gap-2.
  SatEyebrow: 10px semibold uppercase with 0.14em tracking, slate-400 to tertiary token.
    Keep id and className passthrough (SessionRoom passes text-9px which must still win).
  SatMeta: 11px slate-400 to tertiary token. Keep passthrough.
  SatSectionCard: rounded-2xl border bg-white p-5 sm:p-6 with card shadow becomes radius-lg token,
    border token, surface token, shadow-card token. Keep aria-labelledby and className passthrough.
  Gate: scoped SatPage tests pass. Visual: header divider hairline, title ink, no layout shift.

Step 2 - SatSearchField (44px field, 32px clear exemption).
  Field: h-10 becomes h-11 (44px). rounded-12px becomes radius-md token. border-black 0.075 becomes border.
    bg-white becomes surface token. text-slate-900 becomes text token. placeholder becomes tertiary token.
    Search icon size 15 tertiary token.
  Focus: keep the focus border plus 4px ring shape but point at tokens (accent border, accent-tint ring).
    Ring width 4 stays - strong 2026 ring. Global 3px outline in CSS remains as backstop.
  Clear button: KEEP class sat-search-clear with h-6 w-6 rounded-full plus aria-label Clear-plus-label plus
    conditional-render-when-value plus Escape-to-clear exactly. CSS F-A6 (32px important, centered) overrides
    size - do not fix with TSX sizing. Hover fill becomes a token-border equivalent.
  Keep type search, aria-label label, and the webkit-search-cancel-button hidden rule (prevents double clear).
  Gate: SearchField tests (clear click, hidden-when-empty, Escape) pass. F-A6 CSS test untouched and green.

Step 3 - SatPrimaryButton plus SatInlineError retry (one accent recipe).
  Primary: h-10 becomes min-h-11 and h-11 (44px). px-3.5 becomes px-4. rounded-12px becomes radius-md token.
    bg 0071e3 with hover 0077ed and active 0067c9 become accent, accent-hover, accent-active tokens.
    Keep 12px semibold white text. Accent shadow becomes token shadow or retained soft shadow (no lift).
    Keep focus-visible 4px ring in accent-tint. Keep active scale 0.97 (press only; reduced-motion CSS nulls it).
    Keep disabled slate pair or move to a disabled token pair from Phase 01 (retain slate pair if no token).
    Keep aria-busy plus disabled-equals-pending-or-disabled plus spinner.
  InlineError card: tokenize like SectionCard (radius-lg token, border token, surface, shadow-card).
    Title 14px semibold -0.01em to text token. Description 12px with leading-5 to secondary token.
    Retry button uses the SAME accent recipe as Primary but KEEPS min-h-10 class literally (test pins min-h-10;
    coarse-pointer CSS lifts touch targets to 44px; do not bump to min-h-11 in TSX - see section 8).
  Gate: PrimaryButton plus InlineError tests pass (except the planned accent-assertion update in step 10).

Step 4 - SatStatusPill plus satOutcomeTone (dot-plus-label, single table).
  Keep the SatStatusTone union plus satOutcomeTone mapping function byte-identical.
  Keep pill frame: inline-flex gap-1.5 rounded-full border px-2.5 py-1 text-10px semibold plus dot span
    aria-hidden rounded-full h-1.5 w-1.5 plus label span.
  Tokenize TONE_PILL_CLASS and TONE_DOT_CLASS values in place: info and ready blue to accent tokens;
    published and live emerald; changes, paused, pending amber; invalidated red;
    draft, archived, finished, cancelled, neutral slate - to Phase-01 semantic tokens if present,
    else keep current Tailwind scales (single-table swap later). Selection stays weight plus position plus dot,
    never color alone. Pulse only adds sat-live-dot (CSS 1.6s opacity pulse, reduced-motion nulled).
  Gate: StatusPill plus satOutcomeTone tests pass (dot present plus rounded-full, pulse only when asked).

Step 5 - SatList plus SatListRow (tactile, never lift, capped stagger).
  SatList: keep mt-4 space-y-2 exactly (pages set density).
  SatListRow: keep button type button with onClick, aria-label, style --sat-row-index, class sat-list-row group
    plus conditional sat-row-enter, plus inner span min-w-0 flex-1. Tokenize: keep min-h-76px (exceeds 44px).
    rounded-2xl to radius-lg token. border-black 0.06 to border token. bg-white to surface token.
    Card shadow to shadow token. Focus ring-2 accent-tint with ring-offset-2 and offset canvas token.
    Do NOT add translate lift, hover translate, hover shadow-lg, springs, or chevron markup.
    Hover stays border plus shadow or color per existing CSS hover rule. Press scale 0.99 is CSS-owned, keep.
  Stagger: keep index passthrough plus --sat-row-index plus sat-row-enter (160ms plus min(index,5) times 60ms
    delay in CSS). Routes already cap with min(rowIndex,5) - do not re-cap in the primitive.
  Gate: ListRow tests pass (click, stagger-conditional, no translate-y).

Step 6 - SatStatStrip (bento-ready summary cards).
  Keep section with aria-label, grid grid-cols-3 gap-2 mt-5 sat-route-enter, plus the onSelect bifurcation
    (button with aria-label label-colon-value versus div), plus truncate label, value, hint.
  Tokenize card: rounded-2xl border bg-white px-3.5 py-3 with card shadow becomes radius-lg, border, surface,
    shadow tokens. Label 10px uppercase 0.12em tertiary. Value 22px semibold tabular-nums -0.03em primary.
    Hint 10px tertiary. Button variant hover fill becomes surface-tint token plus focus-visible ring-2
    accent-tint. Clickable stats meet 44px via content plus padding already. Coarse CSS backstops.
    Do not force a fixed height - values must not clip.
  Gate: StatStrip tests pass (all values render, button only when onSelect, section aria-label child count).

Step 7 - SatResultCount plus SatEmptyState plus SatListSkeleton plus SatReleaseTag.
  ResultCount: keep early null when total is 0 or less, plus unit equals scopeLabel or itemLabel, plus the
    visible-of-total versus total strings, plus p role status aria-live polite with mt-3 11px medium
    tabular-nums tertiary (tokenize color only). Keep the skeleton-XOR code comment.
  EmptyState: keep sat-route-enter flex min-h-360px column center with px-6 text-center, plus 48px icon card
    (tokenize border, surface, shadow), plus h2 16px semibold -0.02em, plus hint 12px with leading-5 tertiary
    max-w-sm, plus action mt-4. One human detail max (existing icon slot). No illustration library.
  Skeleton: keep div role status with aria-label plus mt-4 space-y-2, sr-only label, rows mapped to div
    aria-hidden sat-skeleton-shimmer with min-h-76px rounded-2xl border bg-white px-4 py-3 and bars.
    Tokenize border, surface, bar fills. NEVER add animate-pulse (test forbids). Row height matches ListRow.
  ReleaseTag: keep span 10px medium tertiary with Practice middle-dot releaseStatus (tokenize color only).
  Gate: ResultCount, EmptyState, Skeleton, ReleaseTag tests pass.
Step 8 - SatSegmentedControl (radiogroup, roving tabindex, sliding thumb).
  Keep everything behavioral: role radiogroup with aria-label; container sat-segmented plus className;
    group-level ArrowRight and ArrowDown plus ArrowLeft and ArrowUp with wrap (from plus delta plus len)
    mod len plus onChange plus focus; per-option button type button role radio with aria-checked and tabIndex
    (selected 0, else -1) and class sat-segmented-option capitalize with onClick; selected-only motion.span
    with layoutId from thumbId via useId and aria-hidden plus class sat-segmented-thumb with 0.16 transition
    and ease 0.22-1-0.36-1; plus span sat-segmented-label. Keep optionsRef focus array plus APG eslint comment.
  TSX styling: no hardcoded colors exist (all in CSS lines 1875-1920) - NO TSX color change needed.
    Only verify: capitalize kept (routes pass capitalized labels), className passthrough kept (Sessions mt-5
    max-w-360px, Results similar). 44px target, ring, thumb, reduced-motion are CSS-owned (MotionConfig
    reducedMotion user at roots) - file any shortfall as Phase-01 follow-up, do not inline styles.
  Gate: all 5 SegmentedControl tests pass (radiogroup, roving, pointer, arrows, single thumb on selected).

Step 9 - SatMenu (Radix plus static fallback, aria-current).
  Keep SatMenuItem and SatMenuProps types, supportsNativeMenu, ItemFace (truncate plus Check size 13 in accent
    token), StaticMenu (state, useId, refs, current-or-first focus on open, pointerdown-outside plus Escape
    close with focus restore, ArrowDown and Up and Home and End roving, aria-haspopup menu with aria-expanded,
    aria-controls, aria-label, chevron sat-menu-trigger-chevron with data-open), and the Radix branch
    (DropdownMenu Root, Trigger asChild, Portal, Content with align, sideOffset 6, aria-label,
    data-sat-menu-animate, style minWidth width-or-176 plus boxShadow MENU_ELEVATION plus --sat-menu-origin,
    class sat-menu sat-product z-110; Item with data-destructive, data-current, aria-current, onSelect;
    Separator).
  Tokenize triggers: COMPACT_TRIGGER_CLASS (h-10 w-10 rounded-10px) and WORKSPACE_TRIGGER_CLASS (min-h-11
    rounded-xl px-3) move to token surface, text, fill, focus equivalents. Keep h-10 w-10 and min-h-11 sizes
    literally (coarse CSS lifts to 44px; compact icon-only stays 40px desktop by design). Tokenize
    MENU_ELEVATION var(--sat-menu-elevation) to point at --sat-staff-shadow-menu with the existing value as
    fallback (keep the --sat-menu-elevation var name as alias - CSS owns the value).
  Keep: trigger always aria-label label; current item stays clickable plus aria-current true plus check glyph
    in BOTH branches; separatorBefore only when index greater than 0; disabled items; minWidth width-or-176;
    z-50 static and z-110 Radix; data-sat-menu-animate plus --sat-menu-origin.
  Gate: all 7 Menu tests pass (open, select, close; destructive plus separator; Escape-no-select;
    nothing-until-opened; animate attribute; aria-current-clickable; non-compact name).

Step 10 - Confirm and Form dialogs (AlertDialog, Cancel-focused, backdrop never dismisses).
  Keep constants hook parts literally: OVERLAY_CLASS sat-dialog-overlay sat-product.
    CONFIRM_CLASS sat-dialog sat-dialog-center sat-product with w calc(100vw-40px) max-w-390px p-5.
    FORM_CLASS sat-dialog sat-dialog-center sat-product with w calc(100vw-40px) max-w-480px overflow-hidden.
    Tokenize only color, radius, shadow, focus inside the TSX class strings: card bg-white to surface token;
    title tracking -0.025em keep; description slate-500 to secondary token; eyebrow slate-400 to tertiary token.
  Buttons: CANCEL_BUTTON_CLASS (sat-quiet-button min-h-10 rounded-10px px-3.5 12px semibold) moves text, fill,
    ring to tokens. CONFIRM_BUTTON_CLASS (min-h-10 accent) to accent tokens.
    DESTRUCTIVE_BUTTON_CLASS (danger bg) to danger token. CLOSE_BUTTON_CLASS (h-9 w-9 rounded-full) to token
    (keep 36px - dialog close is a secondary affordance; coarse CSS lifts the touch target; do not bump).
  Behavior (both Radix and static branches): open false renders null; matchMedia gate to static; static Cancel
    autofocus (cancelRef.focus) plus Escape listener plus useId-scoped labelledby and describedby (unique when
    stacked); Radix AlertDialog Root with open and onOpenChange that calls onCancel when closing (Escape to
    cancel via Radix) plus Cancel asChild and Action asChild; Form Dialog Root, Portal, Overlay, Content plus
    Title asChild plus Close asChild; overlay carries sat-product scope in both branches (portal survival);
    NEVER add onPointerDownOutside or onInteractOutside dismiss - backdrop tap never dismisses an alert.
  Gate: all 9 Dialogs tests pass (alert name, description, answers; Cancel path; Escape path; closed-null twice;
    form named dialog plus Escape plus Close; portal scope twice; stacked unique ids twice).

Step 11 - Self-review sweep (no springs, no lift, no glass, no neon).
  1. Grep owned files: must return zero hits for translate-y, shadow-lg, backdrop-blur, bg-gradient,
     animate-pulse, and staff hexes 0071e3, f5f5f7, black alpha outside a var fallback.
  2. Confirm every interactive element reaches 44px via TSX size or the coarse-CSS floor, except sat-search-clear
     (32px exemption pinned by F-A6).
  3. Confirm transitions only 120-200ms ease-out or 0.22-1-0.36-1. No spring, no layoutId outside the segmented
     thumb, no new motion components.
  4. Confirm forced-colors, contrast, transparency behavior unchanged (no new hardcoded color bypassing tokens).

Step 12 - Handoff notes for 04A and 04B (in the summary, not code).
  List final token names used plus any Phase-01 fallback actually hit.
  Flag the section 8 InlineError assertion update.
  Confirm 04A and 04B can assume: row frame API unchanged, chevron still route-owned, index stagger still
  opt-in capped at 5, StatStrip button a11y unchanged, Segmented, Menu, Dialog props unchanged.

## 6. Important code and pseudocode (sketches - NOT full files)

Token consumption idiom (repeat per primitive). Before: a class string with h-10, rounded-12px, bg hex 0071e3,
focus ring hex. After (adopt Phase 01 exact token names): h-11 min-h-11, rounded radius-md token,
bg accent token with hover and active token variants, focus ring accent-tint token. Card idiom: rounded
radius-lg token, border token, surface token with FFF fallback, shadow-card token. Text idioms: primary text
token, secondary text token, tertiary text token. Each Tailwind arbitrary var ref carries a documented fallback
where Tailwind allows one.

SatListRow sketch - frame identical, values tokenized. Keep button type button with onClick, aria-label,
style --sat-row-index conditional on index defined, class sat-list-row group flex min-h-76px w-full items-center
rounded radius-lg token border token bg surface token px-4 text-left shadow-card token plus focus-visible ring-2
accent-tint plus ring-offset-2 plus offset canvas token, plus conditional sat-row-enter. Inner span min-w-0 flex-1.

SatSearchField sketch - input keeps type search, aria-label, Escape-to-clear, webkit-cancel hidden. Classes move
to h-11, radius-md token, border token, surface token, text token, tertiary placeholder, accent focus border and
accent-tint 4px ring. Clear button keeps sat-search-clear, h-6 w-6, rounded-full, aria-label Clear-plus-label.

SatStatusPill sketch - frame identical (inline-flex gap-1.5 rounded-full border px-2.5 py-1 text-10px semibold
plus dot plus label). Only the two tone tables change values to tokens (info and ready to accent; published
and live emerald; changes, paused, pending amber; invalidated red; rest slate) or keep current Tailwind scales
if Phase 01 has no pill tokens yet. satOutcomeTone function stays byte-identical.

SatSegmentedControl sketch - no visual TSX change (CSS-owned). Keep role radiogroup, aria-label, sat-segmented
plus className, group Arrow wrap with onChange plus focus, per-option role radio with aria-checked and roving
tabIndex and sat-segmented-option capitalize, selected-only motion.span layoutId thumbId with sat-segmented-thumb,
plus sat-segmented-label span.

SatMenu sketch - both branches keep aria-label label on trigger and role menu with aria-label on popup.
Trigger classes move to token surface, text, fill, focus refs while keeping h-10 w-10 and min-h-11 sizes.
Content keeps sat-menu sat-product, minWidth width-or-176, boxShadow MENU_ELEVATION (aliased to staff shadow-menu
token with existing fallback), --sat-menu-origin by align, data-sat-menu-animate. Items keep sat-menu-item plus
data-destructive, data-current, aria-current, onSelect. ItemFace keeps truncate plus Check size 13 accent token.

Dialog sketch - hook class strings stay literal (overlay, sat-dialog, sat-dialog-center, sat-product, widths).
Only colors move to tokens (surface card, secondary description, tertiary eyebrow, accent confirm, danger
destructive, token text and ring on quiet Cancel, token ring on close). Static branches keep cancelRef.focus plus
Escape plus useId ids. Radix branches keep AlertDialog Cancel and Action asChild, Dialog Title and Close asChild.
Never add pointer-outside dismiss.
## 7. Edge cases (must handle and verify - no behavior change)

  1. jsdom and no-matchMedia (tests plus constrained engines): Radix branches unmountable, so static fallbacks
     (StaticMenu, StaticConfirmDialog, StaticFormDialog) must render the same roles, hooks, aria-current,
     portal-scope, and Escape handling. Existing tests already run in jsdom - they pin the static branch.
     Do not gate new styling on matchMedia.
  2. Stacked dialogs: two confirms or two forms open at once means useId-scoped aria-labelledby and describedby
     must stay unique (tests pin). No shared module-level id.
  3. Portal escape: Radix overlay plus content mount at document.body, outside the SatRoot .sat-product ancestor,
     so the sat-product class must stay on the portal nodes themselves (tests pin). Token var refs resolve
     against those nodes own scope - verify visually (bottom-left pileup means lost scope).
  4. Skeleton-XOR plus live regions: never render skeleton plus ResultCount together (double announce);
     ResultCount null on total 0 or less; skeleton role status with sr-only label plus aria-hidden bars;
     error role alert replaces loading output. Keep the call-site rule in code comments.
  5. Target sizes: 44px floor via TSX (h-11 and min-h-11) for search, primary, stat-buttons, menu workspace
     trigger; 32px sat-search-clear exemption (F-A6) stays; 36px menu items, 32px segmented options, 36px dialog
     close rely on the coarse-pointer CSS floor - record as Phase-01 follow-up if the audit shows shortfall,
     do not invent per-item fixed heights that clip localized labels.
  6. Focus: Cancel-focused alerts (never confirm-focused, especially destructive); menu opens focus current-or-first
     item, closes restore trigger focus; segmented arrows move selection AND focus (roving); all focus rings
     visible on tokens plus in forced-colors (Highlight) plus at 200 percent zoom.
  7. Motion: 150-200ms ease-out only; stagger delay min(index,5) times 60ms (first 6 rows cascade, rest instant);
     shimmer sweep 1.35s plus live-dot 1.6s plus spinner 0.8s are CSS-owned decoration - text and spinner Working
     state carry meaning when reduced-motion nulls them. No new animation, no spring, no lift, no layout shift
     between skeleton (76px) and rows (76px).
  8. Contrast: pill dot-plus-label (never color alone); menu current equals weight plus check plus aria-current;
     segmented selected equals weight plus position plus thumb; tertiary 10-11px text must pass AA on surface
     (Phase 01 pair check - Phase 03 just consumes the token, never lightens it).
  9. Long content: truncate paths (stat label, value, hint; menu item; row title and meta; session time
     tabular-nums) must not wrap or break cards; min-w-0 flex-1 chains preserved; dialog max-w 390 and 480px
     plus mobile bottom-sheet dock under 640px preserved with safe-area padding.
  10. Destructive plus disabled: destructive menu item plus separator rendering; disabled items non-interactive
      (opacity plus pointer-events none in CSS); pending primary disabled plus aria-busy; dialog destructive
      confirm uses danger token plus danger focus ring.
  11. PII discipline: no student IDs or emails in new code, comments, logs, or tests (SessionRoom PII rule
      carries over - primitives stay PII-free).
  12. No-glass rule: primitives stay solid (surface token plus solid fallback). No backdrop-blur, no translucency
      over busy backgrounds in SatPage, Menu, Segmented, Dialog TSX (dialog scrim blur is CSS-owned overlay,
      not content glass).

## 8. Tests to add and update (owned __tests__ only)

Keep green (no assertion change): all of Menu.test.tsx (7 tests), SegmentedControl.test.tsx (5),
Dialogs.test.tsx (9), plus SatPage.test.tsx StatusPill (2), SearchField (3), ListRow (3), PrimaryButton (2),
Skeleton (1), EmptyState (1), StatStrip (2), satOutcomeTone (1), ResultCount (3), ReleaseTag (1).
satContractsCss.test.ts (F-A6 and F-A12) is read-only - Phase 03 must leave it green without editing.

One intentional assertion update (flag to 04A, 04B, 05):
  SatPage.test.tsx InlineError test (announces via role alert with a 40px primary retry button): today asserts
  retry className contains bg hex 0071e3. After tokenization the class becomes bg with var(--sat-staff-accent)
  plus hex fallback. Update the assertion to check the accent TOKEN, not the literal hex - for example match on
  sat-staff-accent or 0071e3 fallback - or assert computed background via token fallback.
  KEEP the min-h-10 assertion literally (TSX keeps min-h-10; touch 44px comes from coarse CSS).
  Document the change in the summary as the only test-logic edit in Phase 03.

Recommended additions (same files, no new files unless the runner prefers):
  SatPage.test.tsx: (a) token-hygiene: no owned-primitive class string contains 0071e3, f5f5f7, or black-alpha
    outside a var fallback (guards against hex regression); (b) focus-ring presence: search input, primary button,
    list row, stat button each carry focus-visible ring; (c) search-clear hook: clear button carries sat-search-clear
    plus aria-label starting with Clear; (d) stagger cap documentation: row with index 9 still renders
    sat-row-enter (cap lives in CSS min-5, not a TSX clamp - documents the contract).
  Menu.test.tsx: static-branch aria-current plus trigger aria-label already pinned - add: disabled item renders
    disabled and does not fire onSelect; separatorBefore on the first item renders no separator (index guard).
  SegmentedControl.test.tsx: add wrap-around (ArrowLeft on first selects last, calling onChange with last value)
    plus className passthrough (for example max-w-360px reaches the radiogroup).
  Dialogs.test.tsx: add backdrop-tap-never-dismisses (pointerDown or mouseDown on the overlay does NOT call
    onCancel or onClose) plus Cancel auto-focus on open (static branch: document.activeElement is Cancel).

Out-of-scope test work (leave to Phase 05): full-suite vitest, sat-a11y Playwright, contrast spot-checks,
motion and reduced-motion audit, cross-route radii and shadow and type and tone consistency.

## 9. Verification commands (run scoped; Phase 05 runs the full matrix)

  Commands (run from the workspace root, one at a time):
    npx tsc --noEmit
    npm run test:run -- src/products/sat/ui/__tests__/SatPage.test.tsx
      src/products/sat/ui/__tests__/Menu.test.tsx
      src/products/sat/ui/__tests__/SegmentedControl.test.tsx
      src/products/sat/ui/__tests__/Dialogs.test.tsx
    npm run test:run -- src/products/sat/ui/__tests__/satContractsCss.test.ts
    npm run test:run -- src/products/sat/routes src/products/sat/ui/__tests__/useSatListParams.test.tsx
    npx eslint src/products/sat/ui/SatPage.tsx src/products/sat/ui/Menu.tsx
      src/products/sat/ui/SegmentedControl.tsx src/products/sat/ui/ConfirmDialog.tsx
      src/products/sat/ui/__tests__/SatPage.test.tsx src/products/sat/ui/__tests__/Menu.test.tsx
      src/products/sat/ui/__tests__/SegmentedControl.test.tsx src/products/sat/ui/__tests__/Dialogs.test.tsx
  Full matrix (Phase 05 owns the run; Phase 03 notes readiness): npm run test:run (full vitest),
  npm run e2e:sat-a11y (sat-a11y Playwright: keyboard, focus, live regions, dialogs, menus, reduced-motion).

  Manual spot-checks (dev server, no new server needed): Library, Sessions, Results list rhythm
  (search to skeleton to count to rows to empty); Sessions bucket segmented plus StatStrip; SessionRoom menu
  plus confirms plus search; ResultDetail pills plus section cards; dialogs at 390 and 480px desktop plus
  bottom-sheet under 640px; keyboard-only pass (Tab, Arrows, Escape, Enter); prefers-reduced-motion
  (no stagger, shimmer, pulse, or thumb glide); coarse-pointer 44px targets; forced-colors legibility.

## 10. Definition of Done (Phase 03 implementation gate - Main Agent verifies)

  - --sat-staff tokens consumed in all four owned components (zero hardcoded staff hex or alpha outside var
    fallbacks); token names match the Phase 01 table; any missing token filed as Phase-01 follow-up, not hardcoded.
  - All 15 SatPage primitives plus Segmented plus Menu plus Confirm and Form dialogs visually 2026 (soft 1px
    token border plus very-soft token shadow cards, 12px controls with 16px cards and pill radii, editorial type
    preserved, tabular-nums numeric, 150-200ms transitions, hover border and shadow only, shimmer skeletons,
    capped stagger).
  - Every section 4 contract preserved: exported props; ARIA roles and labels; class hooks (sat-list-row,
    route-owned sat-row-chevron, sat-segmented family, sat-menu family, sat-dialog family, shimmer, live-dot,
    spinner, search-clear, quiet-button); skeleton-XOR; dot-plus-label; live regions; roving tabindex plus thumb;
    aria-current in both branches; Cancel-focused plus backdrop-never-dismisses; useId scoping; portal scope.
  - 44px targets (TSX size or coarse-CSS floor) everywhere except the 32px sat-search-clear exemption (F-A6
    green); focus-visible rings on every interactive primitive; reduced-motion, transparency, contrast, and
    forced-colors behavior unchanged (F-A12 green).
  - Scoped vitest (4 primitive suites plus CSS contracts plus route consumers) green; npx tsc --noEmit clean;
    npx eslint on owned files clean; only the section-8-flagged test assertion changed.
  - No edits outside section-3-owned files (verified via git status --short - only SatPage.tsx, Menu.tsx,
    SegmentedControl.tsx, ConfirmDialog.tsx plus owned __tests__ plus this plan file).
  - Handoff summary written: tokens used, fallbacks hit, Phase-01 follow-ups (if any), InlineError assertion
    change, confirmation that 04A and 04B can consume the unchanged APIs.
  - No implementation performed in this planning stage (this file is the only output).

