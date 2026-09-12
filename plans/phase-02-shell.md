# Phase 02 — App Shell (SatRoot) Implementation Plan

> Stage: PLAN ONLY — no product code touched. This plan is executed by a future implementation agent.
> Scope: SAT staff workspace shell only. Owns `src/products/sat/SatRoot.tsx` (+ its test). All other files are READ-ONLY / dependency requirements.
> Style direction: 2026 soft-spatial UI per `plans/overall-plan.md` §1 — one glass nav layer + solid readable surfaces, 16–24px radii, editorial type, pill badges with dot+label, 150–200ms ease-out motion, no springs in lists, no neon/gradients/neumorphism.

## 1. Objective

Make the frame feel premium without changing behavior:

- Glass desktop sidebar (244px) with solid fallback for reduced-transparency / no-backdrop-filter.
- Active-pill desktop nav (shared-layout pill glide) + top-indicator mobile bottom nav.
- Workspace switcher (SatMenu: SAT current + IELTS jump via role-aware landing) preserved.
- Account block (avatar initials + name + role + logout) + mobile compact Account menu preserved.
- Mobile sticky header + bottom nav with safe-area insets + blur.
- `SatRouteFade` (160ms opacity fade, `useReducedMotion` + `MotionConfig reducedMotion="user"`) with CSS reduced-motion guard (`.sat-route-fade`).
- Keep role-based nav mapping (builder/grader/proctor/admin) and detail-page chrome-hiding regex byte-identical in behavior.

Non-goals: no nav destination changes, no new routes, no auth changes, no token system authoring (that is Phase 01's output — consume it), no primitive restyling (Phase 03), no page-layout changes (Phase 04A/04B), no `.sat-ui` / Bluebook / IELTS / backend work.

## 2. Dependencies

### 2.1 Depends on Phase 01 (Staff Token Foundation) — REQUIRED before implementing

Phase 01 must land the complete `.sat-product`-scoped token set in `src/index.css`. Phase 02 consumes (does NOT author) these tokens. If any token below is missing, the Phase 02 implementer must STOP and request Phase 01 — do not invent ad-hoc hex/alphas:

| Needed in SatRoot.tsx | Expected Phase-01 token (fallback if absent) |
|---|---|
| Staff canvas behind shell | `--sat-staff-canvas` → fallback `--sat-canvas` (`#F5F5F7` family, current `bg-[#f5f5f7]`) |
| Sidebar / header / bottom-nav glass surface | `--sat-staff-chrome` + `--sat-staff-chrome-solid` (opaque fallback, e.g. `#FFFFFF`) |
| Hairline borders (sidebar right, header bottom, bottom-nav top, account divider) | `--sat-staff-border` → fallback `--sat-separator` / current `border-black/[0.06~0.07]` |
| Primary text / secondary text / tertiary text | `--sat-staff-text` / `--sat-staff-text-2` / `--sat-staff-text-3` → fallbacks `--sat-label` / `--sat-secondary-label` / `--sat-tertiary-label` |
| Accent (mobile active nav, top indicator) | `--sat-staff-accent` → fallback `--sat-accent-core` / `--sat-accent` (`#0071E3`, single-blue rule) |
| Hover/active fills (nav pill, account row, logout hover) | `--sat-staff-fill` / `--sat-staff-fill-hover` → fallbacks `--sat-fill` / `rgba(120,120,128,·)` |
| Focus ring | `--sat-staff-focus` → fallback `--sat-accent` at 40%/72% ring recipe (see §5.4) |
| Radius scale | `--sat-staff-radius-md/lg` (12px trigger/row, 16px pill, 9px badge) |
| Shell shadow (sidebar hairline + pill) | `--sat-staff-shadow-sm` → fallback `--au-elevation-card` |
| Motion | `--sat-staff-motion-fast: 160ms` / `--sat-staff-motion: 180ms` + `--sat-staff-ease: cubic-bezier(.2,0,0,1)` (≈ current `[0.22,1,0.36,1]`; use token value verbatim) |
| Glass blur | `--sat-staff-blur: blur(24px) saturate(1.4)` or Phase-01 value; reduced-transparency fallback = solid surface, no blur |

Contract with Phase 01: tokens live under `.sat-product` scope only; shared `--sat-accent-core: #0071E3` and `.sat-ui` values are READ-ONLY — if a staff need diverges, Phase 01 forks it as `--sat-staff-*` (overall plan §3 rule). Phase 02 must not edit `src/index.css` except — preferably never — and any shell-class addition must be requested via Phase 01/05, not authored here.

### 2.2 Parallel with Phase 03 (no coordination needed beyond token names)

Phase 03 owns `ui/SatPage.tsx, Menu.tsx, SegmentedControl.tsx, ConfirmDialog.tsx`. SatRoot consumes `SatMenu` as a black box (see §3 contract). Do not plan Menu visual changes here; if a trigger-spacing need arises, express it via existing `SatMenu` props (`triggerContent`, `compact`, `align`, `width`) only.

### 2.3 Downstream consumers (must not break)

Phases 04A/04B render inside `<Outlet/>` wrapped by `SatRouteFade`; they rely on `#sat-main`, `.sat-product` scope, and stable shell chrome visibility rules. Keep all hooks stable.

## 3. Affected / New Files

| File | Action | Notes |
|---|---|---|
| `src/products/sat/SatRoot.tsx` (195 lines) | EDIT (only product file in this phase) | Tokenize shell chrome; glass+fallback; keep all logic identical |
| `src/products/sat/__tests__/SatRoot.test.tsx` (128 lines) | EDIT (owned test) | Keep all 6 existing tests green; ADD shell-token/a11y tests per §7 |
| `plans/phase-02-shell.md` | CREATE (this file) | Only file this planning agent writes |
| `src/index.css` | DO NOT EDIT | Phase 01 owns. If a `.sat-shell-*` helper class is truly needed, file it as a Phase-01 requirement (§2.1), defaulting to inline token references (`bg-[var(--sat-staff-*)]`) instead |
| `src/products/sat/ui/*`, `src/products/sat/routes/*`, `src/features/student-delivery/**`, `.sat-ui` CSS | READ-ONLY | Never touch |

## 4. Contracts / Interfaces to Preserve (DO NOT BREAK)

All verified by reading the current sources on 2026-09-11. The implementation agent must keep every item below passing:

### 4.1 Exported API
- `export function SatRoot()` — no props, no signature change. Internal helpers `navForRole(role)`, `ieltsLanding(role)`, `SatRouteFade({routeKey, children})` keep names/behavior (tests and future agents may import/mirror them).
- `SatNavItem = { label, path, icon: LucideIcon }`.

### 4.2 Role-based nav logic (byte-identical behavior)
```ts
builder → [{ Exam Library → /sat/exams }]
grader  → [{ Results → /sat/results }]
proctor → [{ Sessions → /sat/sessions }, { Results → /sat/results }]
else (admin/undefined/unknown) → [Exam Library, Sessions, Results]  // exact labels + paths + order
ieltsLanding: grader → /admin/grading; proctor → /proctor; else → /admin/exams
```
- Icons fixed: `BookOpen` (Library), `Radio` (Sessions), `BarChart3` (Results), `LogOut` (desktop), `UserRound` (mobile account trigger). No icon swaps.
- No new destinations; no path renames. Unknown/undefined role falls through to admin set (don't "fix" to empty).

### 4.3 Detail-page chrome-hiding regex (identical)
```ts
const isDetailPage = /^\/sat\/exams\/[^/]+($|\/(release|preview)\/?$)/.test(location.pathname);
```
- Hides desktop `<aside>`, mobile `<header>`, mobile bottom `<nav>`; `<main>` loses `pb-20 md:pb-0` padding on detail pages.
- MUST keep sidebar VISIBLE on `/sat/sessions/:id`, `/sat/results/:id`, `/sat/exams/:examId/access` (pinned by test "keeps the sidebar…"). Do not generalize the regex.

### 4.4 ARIA / DOM hooks (tests + a11y depend on these)
- `.sat-product` scope class stays on the shell root div (drives every `.sat-product …` CSS rule).
- Skip link: `<a href="#sat-main" class="skip-link">Skip to main content</a>`; `<main id="sat-main" tabIndex={-1}>` (test resolves href target + focus).
- Desktop nav + mobile bottom nav: both `<nav aria-label="Digital SAT">` (duplicate accessible names are intentional — desktop hidden on mobile via `md:` classes and vice versa).
- Desktop links are `NavLink` (active state via React Router `isActive` render prop); mobile links are `NavLink`.
- Workspace switcher triggers: accessible name `"Digital SAT"` in BOTH sidebars (desktop + mobile header) — test clicks `getAllByRole('button', {name: /digital sat/i })[0]`.
- `SatMenu` items contract: SAT item `{id:'sat', current:true}` (keeps check glyph + `aria-current="true"`); IELTS item navigates via `ieltsLanding(role)`. Mobile Account menu: `{id:'identity', disabled:true}` (disabled, shows `"Name · role"`) + `{id:'signout', label:'Sign out'}`.
- Desktop logout: `<button aria-label="Sign out">` in account block; mobile sign-out: menuitem `"Sign out"`. Both call `void logout()` from `useAuthSession`.
- Bottom-nav active indicator: decorative `<span aria-hidden="true">` (current `sat-route-enter absolute inset-x-6 top-0 h-0.5 …` — keep aria-hidden; see §5.5 for restyle).
- Active desktop pill: decorative `<motion.span aria-hidden="true" layoutId="sat-desktop-nav-pill">`.
- Display-name fallback chain identical: `session?.user.displayName?.trim() || session?.user.email || 'Staff'`; role caption `"role ?? 'staff'"` capitalized; avatar initials `displayName.slice(0,2).toUpperCase()`.
- No live regions owned by the shell (result counts live in pages — don't add `role="status"` to shell chrome).

### 4.5 Motion contract
- `SatRouteFade`: `initial={reduce ? false : {opacity:0}} animate={{opacity:1}} transition={{duration:0.16, ease:[0.22,1,0.36,1]}}`, keyed by `location.pathname` (`routeKey` prop = pathname). Outer `MotionConfig reducedMotion="user" transition={{duration:0.18}}`.
- Desktop pill glide: `layoutId="sat-desktop-nav-pill"` + same 160ms ease. No springs anywhere in shell.
- CSS guards (read-only, must keep passing `satContractsCss.test.ts`): `.sat-route-fade{animation:none}` + `@media (prefers-reduced-motion:reduce){.sat-route-fade{opacity:1!important;…}}`; the global reduced-motion block kills transitions/animations under `.sat-product`; the reduced-transparency block forces opaque surfaces for `aside/header/nav[aria-label]`. Do not rename `.sat-route-fade`, `.sat-route-enter`.

### 4.6 Touch / focus / visual rules (never regress)
- 44px targets: desktop NavLink `min-h-11` (44px), account row `min-h-12`, mobile bottom NavLink `min-h-12 min-w-[72px]`, compact Account trigger 40px via `COMPACT_TRIGGER_CLASS` (existing exemption path — coarse-pointer CSS floors to 44px anyway). The only sanctioned sub-44 exemption is the search-clear 32px rule (not in this file — don't touch).
- Focus: every interactive element must keep a visible `focus-visible` ring (global `.sat-product :is(…):focus-visible` rule). Do not add `focus:outline-none` without a ring replacement — `main#sat-main` keeps `focus:outline-none` ONLY because it is a programmatic target (skip-link), which is correct.
- Hover only on fine pointers (existing `@media (hover:hover) and (pointer:fine)` gate in CSS — keep relying on it; don't add hover-only affordances like title-only chevrons).
- 2026 motion: 150–200ms ease-out only; no lift-on-hover (translate) on nav; press-scale at most on discrete buttons (current shell has none — don't add).

### 4.7 What the shell does NOT own
- Skeleton-XOR rule, dot+label pills, shimmer, stagger caps, Cancel-focused alerts, roving tabindex: owned by Phase 03 primitives — shell must not duplicate or restyle them. Shell renders no skeletons, pills, dialogs, or segmented controls directly (only SatMenu triggers).

## 5. Step-by-Step Implementation Plan

> All edits inside `src/products/sat/SatRoot.tsx` only. Keep the component structure (aside / header / main / bottom-nav) and all logic; change only surface values (classes + inline styles) to consume Phase-01 tokens. Suggested order below minimizes breakage; verify with §8 after each step.

### Step 0 — Baseline (no code)
1. `git status --short` clean; record baseline: `npm run test:run -- src/products/sat/__tests__/SatRoot.test.tsx src/products/sat/ui/__tests__/satContractsCss.test.ts` green, `npx tsc --noEmit` green.
2. Confirm Phase-01 tokens exist: grep `--sat-staff-` in `src/index.css`. Map each to §2.1 table; write the resolved token-name list at the top of the implementation commit message. If any §2.1 token is missing, STOP — file the gap against Phase 01, use the documented fallback for that slot only, and note it in the PR.

### Step 1 — Root + main container tokenization (mechanical, zero-risk)
Current: `<div className="sat-product min-h-screen bg-[#f5f5f7] text-slate-950 md:flex">`.
Replace hardcoded canvas/ink with tokens (keep layout classes):
```tsx
<div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,var(--sat-canvas))] text-[var(--sat-staff-text,var(--sat-label))] md:flex">
```
- `main`: keep `id="sat-main" tabIndex={-1}`, keep conditional `pb-20 md:pb-0`; no color classes to change (inherits root ink). No other main changes.

### Step 2 — Desktop sidebar glass + solid fallback (the premium move)
Current aside: `hidden w-[244px] shrink-0 border-r border-black/[0.07] bg-white/82 backdrop-blur-2xl md:flex md:min-h-screen md:flex-col`.
Target sketch (width + layout + border position IDENTICAL; only surface recipe changes):
```tsx
<aside className="hidden w-[244px] shrink-0 border-r border-[var(--sat-staff-border,var(--sat-separator))] bg-[var(--sat-staff-chrome-solid,#fff)] md:flex md:min-h-screen md:flex-col md:[background:var(--sat-staff-chrome)] md:[backdrop-filter:var(--sat-staff-blur)] md:[-webkit-backdrop-filter:var(--sat-staff-blur)]">
```
Implementation notes:
- Solid-first: the base `bg-[var(--sat-staff-chrome-solid)]` is the readable fallback (no-blur environments, reduced-transparency, tests). The glass layer applies at `md:` only (sidebar only exists at md+), so mobile never pays for blur it can't see.
- Border: single 1px right hairline via token; remove alpha hex (`border-black/[0.07]`).
- Keep `w-[244px] shrink-0` EXACT (layout contract with content max-width 1180px). Keep `md:min-h-screen md:flex-col`.
- Do NOT add shadow to the sidebar (hairline only — soft-spatial rule: one separation carrier, not two). Do NOT add gradients.
- Reduced-transparency + no-backdrop-filter safety already handled by existing CSS (`prefers-reduced-transparency` forces `background-color: var(--sat-surface)` on aside/header/nav); solid-first base makes this doubly safe. Verify both paths in §7 test 5.

### Step 3 — Desktop nav: active-pill polish (behavior identical, surface tokenized)
Keep: `navForRole` map, `NavLink` + `isActive` render prop, `layoutId="sat-desktop-nav-pill"` glide, icon size 17 / stroke 1.8, `min-h-11 gap-3 rounded-xl px-3 text-[13px]`.
Change only the two state surfaces:
```tsx
// active pill (was bg-black/[0.065]):
<motion.span layoutId="sat-desktop-nav-pill" aria-hidden="true"
  className="absolute inset-0 rounded-xl bg-[var(--sat-staff-fill-hover,rgba(120,120,128,0.18))]"
  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} />
// idle hover wash (was hover:bg-black/[0.035]):
<span aria-hidden="true" className="absolute inset-0 rounded-xl transition-colors hover:bg-[var(--sat-staff-fill,rgba(120,120,128,0.12))]" />
// label colors (were text-slate-950 / text-slate-500 hover:text-slate-900):
isActive ? 'font-semibold text-[var(--sat-staff-text,var(--sat-label))]'
         : 'font-medium text-[var(--sat-staff-text-2,var(--sat-secondary-label))] hover:text-[var(--sat-staff-text,var(--sat-label))]'
```
- Typography stays 13px; weight carries selection (semibold vs medium) + fill, never color alone.
- Focus ring: NavLinks get it from the global `:focus-visible` rule — add nothing. Do NOT wrap in extra focus classes that fight the global outline.
- `nav aria-label="Digital SAT" className="flex-1 px-3 py-4"` + inner `space-y-1` unchanged.

### Step 4 — Workspace switcher (SatMenu) — props only, no visual fork
Both triggers (desktop block in `div.px-3.pb-3.pt-3` + mobile header) keep identical `label/items/align/width/triggerContent`. Tokenize ONLY the custom badge glyph inside `triggerContent`:
- Desktop badge: `bg-slate-950 text-white` → `bg-[var(--sat-staff-text,var(--sat-label))] text-[var(--sat-staff-surface,#fff)]` (keeps near-black chip in both themes; forced-colors maps via Phase-01 tokens).
- Mobile badge `h-7 w-7 text-[9px]` same treatment.
- The `Workspace` caption `text-slate-400` inherits the raised-contrast tertiary mapping — leave the class as-is (global `.sat-product .text-slate-400` rule already remaps it; changing it would churn snapshots for zero gain).
- Items array, `current:true` check glyph, `aria-current`, IELTS `onSelect → navigate(ieltsLanding(role))`: untouched.

### Step 5 — Account block + logout (desktop) / Account menu (mobile) — tokenize, keep targets
Desktop block: keep structure (`border-t … p-3` → tokenize border to `border-[var(--sat-staff-border,…)]`; row `min-h-12 gap-2.5 rounded-xl px-2.5` unchanged).
- Avatar: `bg-black/[0.06] text-slate-600` → `bg-[var(--sat-staff-fill,rgba(120,120,128,0.12))] text-[var(--sat-staff-text-2,var(--sat-secondary-label))]`; initials logic untouched.
- Name `text-[11px] font-semibold` + role `text-[9px] capitalize`: keep sizes (role caption at 9px is exempt as non-essential metadata adjacent to the 11px name — do not grow it; raising to 10px would shift sidebar rhythm owned by no test but reviewed in Phase 05 consistency pass).
- Logout button: keep `h-8 w-8 rounded-full aria-label="Sign out"`; hover wash → `hover:bg-[var(--sat-staff-fill,…)]`; icon color `text-slate-400 hover:text-slate-700` stays (global remap handles contrast).
Mobile header Account `SatMenu compact icon={UserRound}`: props untouched. Identity item stays `disabled:true`; sign-out still `void logout()`.

### Step 6 — Mobile sticky header + bottom nav: safe-area + blur + indicator restyle
Header (mobile only, `md:hidden`): `sticky top-0 z-40 flex min-h-14 … border-b bg-white/88 backdrop-blur-2xl px-4` →
```tsx
<header className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-2 border-b border-[var(--sat-staff-border,var(--sat-separator))] bg-[var(--sat-staff-chrome-solid,#fff)] px-4 [backdrop-filter:var(--sat-staff-blur)] [-webkit-backdrop-filter:var(--sat-staff-blur)] md:hidden [padding-top:env(safe-area-inset-top)]">
```
- `min-h-14` (56px) + sticky + `z-40` unchanged. Safe-area: add top inset padding so notched devices don't clip the 56px bar (content stays 56px min, inset adds above it).
Bottom nav (mobile only): keep `fixed inset-x-0 bottom-0 z-40 border-t … px-2 pt-1.5 md:hidden` + `pb-[max(env(safe-area-inset-bottom),8px)]` (already correct — DO NOT alter the safe-area expression); tokenize surface/border:
```tsx
<nav aria-label="Digital SAT" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--sat-staff-border,var(--sat-separator))] bg-[var(--sat-staff-chrome-solid,#fff)] px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 [backdrop-filter:var(--sat-staff-blur)] [-webkit-backdrop-filter:var(--sat-staff-blur)] md:hidden">
```
Active indicator restyle (keep position + a11y, refresh surface): current `sat-route-enter absolute inset-x-6 top-0 h-0.5 rounded-full bg-[#0071e3]` → `bg-[var(--sat-staff-accent,var(--sat-accent-core))]`; keep `aria-hidden`, `inset-x-6 top-0 h-0.5 rounded-full`, and the `sat-route-enter` class (it gives the 160ms fade; removing it would orphan the keyframe reference). Label colors: active `text-[#0071e3]` → `text-[var(--sat-staff-accent,…)]`; idle `text-slate-400` stays (global remap). Icon 18/stroke 1.9, `min-h-12 min-w-[72px]`, `text-[9px] font-semibold` unchanged.

### Step 7 — SatRouteFade: keep motion component, harden reduced-motion
No visual change. Keep `motion.div key={routeKey} initial={reduce?false:{opacity:0}} …` + `MotionConfig reducedMotion="user"` EXACTLY. Two hardenings allowed (both test-pinned, see §7):
1. Add the CSS-gate class so the F-A12 reduced-motion guard covers the fade even if Motion is mocked: `<motion.div className="sat-route-fade" …>`. This is the ONLY new class in the phase, and it maps to an existing CSS rule (`animation:none` + reduced-motion opacity guard) — no new CSS needed.
2. Do NOT switch to AnimatePresence/exit fades (would delay navigation + break `routeKey=pathname` simplicity); do NOT add translate/scale (fade-only per motion vocabulary).

### Step 8 — Forced-colors + contrast sanity (no new code paths)
- Rely on existing `@media (forced-colors:active)` block (maps label/surface/accent to CanvasText/Canvas/Highlight). After tokenizing, verify: sidebar badge, active pill, mobile indicator, avatar all resolve to system colors (token fallbacks chain to `--sat-*` which the block overrides). If any arbitrary *non-token* color remains in SatRoot after Steps 1–6, that is a bug — remove it.
- Text pairs: sidebar 13px medium/semibold on chrome, account 11px semibold, bottom-nav 9px semibold semibold-on-chrome — all ≥ AA for their roles after the tertiary-contrast raise; Phase 05 runs the meter, Phase 02 just avoids new low-contrast pairs.

## 6. Important Code / Pseudocode (sketches — not full files)

Token-reference idiom used throughout (fallback chain lets the shell render before/after Phase 01 without breakage):
```tsx
// pattern: bg-[var(--sat-staff-X,<fallback>)]
"bg-[var(--sat-staff-chrome-solid,#fff)]"
"border-[var(--sat-staff-border,var(--sat-separator))]"
"text-[var(--sat-staff-text,var(--sat-label))]"
"bg-[var(--sat-staff-fill-hover,rgba(120,120,128,0.18))]"
```

Role nav (COPY VERBATIM — do not refactor, do not sort, do not dedupe):
```tsx
function navForRole(role: string | undefined): SatNavItem[] {
  if (role === 'builder') return [{ label: 'Exam Library', path: '/sat/exams', icon: BookOpen }];
  if (role === 'grader') return [{ label: 'Results', path: '/sat/results', icon: BarChart3 }];
  if (role === 'proctor') return [
    { label: 'Sessions', path: '/sat/sessions', icon: Radio },
    { label: 'Results', path: '/sat/results', icon: BarChart3 },
  ];
  return [
    { label: 'Exam Library', path: '/sat/exams', icon: BookOpen },
    { label: 'Sessions', path: '/sat/sessions', icon: Radio },
    { label: 'Results', path: '/sat/results', icon: BarChart3 },
  ];
}
```

Chrome gate (COPY VERBATIM):
```tsx
const isDetailPage = /^\/sat\/exams\/[^/]+($|\/(release|preview)\/?$)/.test(location.pathname);
```

SatRouteFade target (only sanctioned diff = added className):
```tsx
function SatRouteFade({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="sat-route-fade" key={routeKey}
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
```

Desktop NavLink class recipe (function of isActive — keep render-prop form):
```tsx
className={({ isActive }) =>
  `relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] ` +
  (isActive
    ? 'font-semibold text-[var(--sat-staff-text,var(--sat-label))]'
    : 'font-medium text-[var(--sat-staff-text-2,var(--sat-secondary-label))] hover:text-[var(--sat-staff-text,var(--sat-label))]')}
```

## 7. Edge Cases

1. **Unknown/undefined role** → admin triple-nav (fallthrough). Don't render empty nav; don't crash on missing session (optional chaining already guards; displayName falls back to email → 'Staff').
2. **Long display names / emails** → `truncate` + `min-w-0 flex-1` preserved; avatar `slice(0,2)` never wraps (`shrink-0`).
3. **Detail regex near-misses**: `/sat/exams` (list) shows chrome; `/sat/exams/ex-1/access` shows chrome; `/sat/exams/ex-1/release/extra` shows chrome (regex anchors release|preview as terminal segment, optional trailing slash only). `/sat/exams//release` doesn't match ([^/]+ requires an id) → chrome shows, which is correct for a malformed URL. Query strings don't affect `pathname`. Trailing slash on `/sat/exams/ex-1/` still hides chrome (covered by `($|…)`).
4. **Single-item nav (builder/grader)** → `justify-around` bottom bar + `max-w-md` still fine with one child; desktop `space-y-1` fine. No empty-state needed.
5. **No-backdrop-filter / reduced-transparency / forced-colors** → solid base color carries readability in all three; blur is enhancement-only. Never gate content visibility on blur support.
6. **Safe-area devices** → header top inset + bottom-nav `max(env(safe-area-inset-bottom),8px)` keep 8px minimum on devices without insets; `main pb-20` keeps content clear of the fixed bottom bar on list pages (detail pages intentionally drop it — authoring owns its own chrome).
7. **Reduced-motion** → MotionConfig + `useReducedMotion` + `.sat-route-fade` guard + global CSS kill-switch quadruple-cover fade, pill glide, indicator fade, chevron rotate. No JS-animated opacity may leave content at opacity 0 (fade is animate-to-1 with no exit fade — safe).
8. **IELTS jump from any role** → `navigate(ieltsLanding(role))` unmounts SAT tree; no SAT state to clean (no stores owned here).
9. **Logout race** → `void logout()` fire-and-forget in both triggers; no redirect logic owned by shell (auth layer owns it — don't add).
10. **Motion library mocked/absent in tests** → `.sat-route-fade` CSS class keeps content visible (opacity guard); jsdom static-Menu branch keeps switcher/account operable (no shell change needed — just don't break the `supportsNativeMenu` contract by assuming Radix).

## 8. Tests to Add / Update

### 8.1 Keep green (no edits to expectations unless the plan says so)
- `src/products/sat/__tests__/SatRoot.test.tsx` — all 6 tests: admin triple-nav; IELTS switch; skip-link focus; mobile Account sign-out; sidebar-kept on session/result/access; chrome-hidden on authoring. Surface tokenization must not alter any queried text/role/label.
- `src/products/sat/ui/__tests__/satContractsCss.test.ts` — F-A6 (search-clear 32px) + F-A12 (route-fade guard). Phase 02 adds no CSS, so these pass untouched; the new `sat-route-fade` className in Step 7 is what the F-A12 gate was built for.

### 8.2 Add to `src/products/sat/__tests__/SatRoot.test.tsx` (new `describe('SatRoot shell polish', …)` block)
1. **Role matrix**: builder → only Exam Library; grader → only Results; proctor → Sessions+Results, no Library. (Extends existing admin/proctor coverage to the full `navForRole` table.)
2. **Detail-regex matrix**: parametrize entries → chrome expectation: `/sat/exams`→chrome; `/sat/exams/ex-1`→hidden; `/sat/exams/ex-1/release`→hidden; `/sat/exams/ex-1/preview/`→hidden; `/sat/exams/ex-1/access`→chrome; `/sat/sessions/s-1`→chrome; `/sat/results/r-1`→chrome. Assert via workspace-switcher presence (`button[name=/digital sat/i]`) + sign-out absence/presence.
3. **Route-fade guard**: render + assert `#sat-main > .sat-route-fade` exists (pins Step 7 class without testing Motion internals).
4. **Desktop logout calls logout**: click `button[aria-label="Sign out"]` → `logout` called once (mirrors existing mobile test; pins the desktop path through the restyle).
5. **Solid-fallback surfaces**: assert aside/header/bottom-nav computed class list contains a `var(--sat-staff-` reference OR the opaque fallback (e.g. `\""). Fails if any `bg-white/8`, `bg-white/9`, `black/[0.0` alpha remains in SatRoot source — implement as a source-grep test OR a class-contains assertion; either pins "no hardcoded alpha chrome".
6. **Bottom-nav safe-area**: assert bottom nav class contains `env(safe-area-inset-bottom)` (pins Step 6 against accidental removal).
7. **Reduced-motion smoke** (optional, cheap): mock `motion/react` `useReducedMotion→true`, render, assert main content visible (no opacity-0 inline style stuck). If flaky, drop in favor of the CSS F-A12 contract test.

### 8.3 Explicitly NOT adding
- Visual snapshot tests (brittle across token renames — Phase 05 does human spot-checks instead).
- Contrast-meter unit tests (Phase 05 runs real meters; here we only avoid new pairs).
- Menu/Dialog/Segmented tests (Phase 03 owns; shell touches none of their APIs).

## 9. Verification Commands (run in this order; all must pass)

```bash
# 1. Scoped shell + CSS-contract tests (fast gate)
npm run test:run -- src/products/sat/__tests__/SatRoot.test.tsx src/products/sat/ui/__tests__/satContractsCss.test.ts

# 2. Typecheck (shell token classes are arbitrary-value Tailwind — a typo here is a silent no-op, so tsc + grep both matter)
npx tsc --noEmit

# 3. Lint owned files only
npx eslint src/products/sat/SatRoot.tsx src/products/sat/__tests__/SatRoot.test.tsx

# 4. Regression: full SAT suite (shell changes can break route tests via Outlet/chrome)
npm run test:run -- src/products/sat

# 5. Manual a11y pass (keyboard: Tab→skip-link→nav→switcher→account→logout; SR: nav names announced; zoom 200%: sidebar 244px + 1180px container no h-overlap; forced-colors + reduced-motion + reduced-transparency spot-checks)
npm run e2e:sat-a11y
```
Full-matrix (typecheck + full vitest + eslint + sat-a11y) is Phase 05's job — Phase 02 runs the scoped subset above + the SAT-suite regression (step 4) and hands off.

## 10. Definition of Done

- [ ] `src/products/sat/SatRoot.tsx` is the ONLY product file changed; no `.tsx/.css` outside §3 table touched; `.sat-ui`, student-delivery, IELTS, backend untouched.
- [ ] Zero hardcoded staff-chrome hex/alphas remain in SatRoot (no `#f5f5f7`, `#0071e3`, `black/[0.0…]`, `white/8…/9…`, `slate-950` as chrome surface — text-token `slate-*` classes remapped by the global rule are acceptable where noted in Steps 3–5, but every *surface/border/fill/accent* resolves through `var(--sat-staff-*,fallback)`).
- [ ] Sidebar still 244px, still hidden below `md`, still hidden on authoring regex only; mobile header sticky + bottom nav fixed with safe-area; widths/breakpoints/z-indexes unchanged.
- [ ] Role nav + IELTS landings + display-name fallbacks + logout wiring behavior-identical (all 6 existing tests + 7 new tests green).
- [ ] `SatRouteFade` still 160ms fade-only, reduced-motion quadruple-covered, carries `.sat-route-fade` gate class.
- [ ] Keyboard: skip-link → main focus works; all nav/switcher/account/logout reachable with visible focus rings; 44px targets preserved (32px exemption untouched — different file).
- [ ] `npx tsc --noEmit`, scoped vitest, SAT-suite vitest, eslint on owned files, `npm run e2e:sat-a11y` all pass.
- [ ] No NEW CSS classes invented (single exception: reuse of existing `.sat-route-fade`); no new stores, deps, routes, or behavioral logic.
- [ ] Commit message lists the resolved Phase-01 token names consumed (audit trail for Phase 05 consistency pass).
