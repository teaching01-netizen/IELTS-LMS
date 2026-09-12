# Phase 04B — Detail & Ops Pages (Session Room / Result Detail / Access)

> PLAN ONLY — no product code edited in this stage.
> Scope: SAT staff workspace only (`src/products/sat/**` + `.sat-product` CSS). Exam-mode Bluebook (`.sat-ui`, `src/features/student-delivery/**`) is READ-ONLY. IELTS + backend out of scope.

## 1. Objective

Make the three dense operational routes scannable and premium **without hiding controls or changing behavior**:

- `SatSessionRoomRoute.tsx` — sticky glass room header (timer tabular-nums, overrun / reconnecting states), roster listbox rows + attention filter, current-stage hero + student-detail bento + session aside bento. `SessionControls` + `SatConfirmDialog` / `SatMenu` wiring untouched. No polling / action / timing change. PII discipline preserved (IDs only in logs).
- `SatResultDetailRoute.tsx` — result hero (52px score, practice caption), performance bento (section cards + module dl), `QuestionRawTable` wrapper per section. No scoring / verdict change.
- `SatAccessRoute.tsx` — wrapper back-link rhythm only. `StudentLinksDashboard` internals are OUT OF SCOPE (owned by exam-authoring lane).

2026 direction, applied sparingly: soft spatial cards (1px border + very soft shadow, 16–24px radii, calm canvas), **one** glass layer (room sticky header only; solid fallback), bento where it pays (stage/detail/aside; performance), editorial type (confident titles, short descriptions, no tiny-gray-everywhere, no gradient text), 2026 components (44px targets with 32px search-clear exemption, pill badges dot+label, 150–200ms ease-out, no lift-on-hover, no springs in lists, no neon/gradients/neumorphism).

## 2. Dependencies

### 2.1 Depends on Phase 01 — Staff Token Foundation (MUST be done first)

Phase 04B consumes but never defines tokens. Require Phase 01 to provide (exact names may differ; map in implementation, do not fork new ones here):

- `--sat-staff-canvas` / `--sat-staff-surface` / `--sat-staff-surface-subtle`
- `--sat-staff-border` / `--sat-staff-border-strong`
- `--sat-staff-text` / `--sat-staff-text-secondary` / `--sat-staff-text-tertiary`
- `--sat-staff-accent` / `--sat-staff-accent-hover` / `--sat-staff-focus-ring`
- `--sat-staff-warning-bg/border/text`, `--sat-staff-danger-*` (banner + overrun + invalidated)
- `--sat-staff-radius-lg/xl` (16–24px), `--sat-staff-shadow-card/menu`
- `--sat-staff-motion-fast` (150–200ms `cubic-bezier(.2,0,0,1)`), shimmer + spinner tokens
- Solid fallbacks for every glass surface; `prefers-reduced-transparency` opaque fallback; `prefers-reduced-motion` opt-out; `prefers-contrast: more` + `forced-colors` mappings.
- Rule: if a value must diverge from shared `.sat-ui` variables, Phase 01 forks it as `--sat-staff-*`. Phase 04B MUST NOT edit `src/index.css` or `.sat-ui` values.

### 2.2 Depends on Phase 03 — List-System Primitives (MUST be done first)

Phase 04B composes these APIs exactly as Phase 03 leaves them. If Phase 03 changes class hooks or props, adopt without forking:

- `SatEyebrow`, `SatSectionCard`, `SatSearchField` (Escape-clears, clear button `sat-search-clear`), `SatStatusPill` + `satOutcomeTone()`, `SatMeta`, `SatInlineError` (only if needed — the room currently uses bespoke banners, see section 5 step 3).
- `SatMenu` — Radix + static fallback, trigger always carries `aria-label`, `aria-current` contract for current items.
- `SatConfirmDialog` — Radix AlertDialog + static fallback, Cancel-focused, Escape cancels, backdrop-tap never dismisses.
- `SatSegmentedControl` — NOT used on these three routes today; do not introduce it here.
- Motion / CSS hooks owned by Phase 01+03: `.sat-product`, `.sat-row-enter` (capped stagger, `--sat-row-index` cap 5), `.sat-route-enter`, `.sat-banner-enter`, `.sat-spinner`, `.sat-live-dot`, `.sat-skeleton-shimmer`, `.sat-list-row` (hover = border+shadow only, never lift), `.sat-row-chevron`, `.sat-search-clear` (32px exemption), `.sat-route-fade` reduced-motion guard.

### 2.3 Parallel with Phase 04A — disjoint ownership

04A owns `SatExamLibraryRoute / SatSessionsRoute / SatResultsRoute`. 04B owns the three files in section 3.1. No file is touched by both phases. Shared learning (bento rhythm, header rhythm) should converge visually but neither phase edits the other files.

### 2.4 Phase 05 runs last

Full matrix (typecheck + full vitest + eslint + sat-a11y + contrast/motion audit) is the Phase 05 gate. Phase 04B verification is scoped (see section 9).

## 3. Affected / new files

### 3.1 Owned — MAY edit (implementation stage only, not now)

1. `src/products/sat/routes/SatSessionRoomRoute.tsx` (290 lines today) — all room layout/styling; logic untouched.
2. `src/products/sat/routes/SatResultDetailRoute.tsx` (178 lines) — hero + performance + questions layout; helpers untouched.
3. `src/products/sat/routes/SatAccessRoute.tsx` (36 lines) — wrapper only (guards + passthrough props). Tight boundary in section 5 step 5.

### 3.2 Explicitly NOT owned — MUST NOT edit

- `src/products/sat/ui/SatPage.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `ConfirmDialog.tsx` (Phase 03).
- `src/products/sat/SatRoot.tsx` (Phase 02).
- `src/index.css` and any `.sat-product` / `sat-*` rules (Phase 01; fixes via Phase 05).
- `src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx` + its tests/README (out of scope — internals, header, filters, mutations stay as-is).
- `src/components/results/QuestionRawTable.tsx` (shared results table — consume only).
- `useProctorRouteController`, `useAuthoritativeDeadlineClock`, `examDeliveryService`, `satResultsQueries`, `assessmentAccessLinkQueries`, `examQueries` (timing/polling/scoring/auth untouched).
- `.sat-ui` Bluebook tokens/components, IELTS surfaces, backend.

### 3.3 Tests — MAY extend in implementation (no new product files)

- `src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx` — extend (see section 7).
- `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` — extend (detail cases live here).
- Do NOT create new test files unless a contract needs isolation; prefer extending the two above.
- Do NOT edit `satContractsCss.test.ts`, `SatPage.test.tsx`, `Menu.test.tsx`, `Dialogs.test.tsx`, `SegmentedControl.test.tsx` except to keep them green (they should already pass — styling must not break them).

### 3.4 New files

None. No new components, stores, hooks, or CSS files. If a repeated layout cries out for a shared helper, inline it in the route file and note it for Phase 05 consistency review — do not create a shared file in this phase.
## 4. Contracts / interfaces to preserve (DO NOT BREAK)

### 4.1 Session Room — behavioral contracts (from `SatSessionRoomRoute.test.tsx`, 11 tests)

- Controller boundary: `useProctorRouteController({ providerKey: `sat`, initialScheduleId })` — exact args.
- Visible copy pins: `Reading & Writing · Module 1` appears twice (stage hero + session aside context), `Server-authoritative session clock` present, student name appears twice (roster row + detail header) — tests use `getAllByText`.
- Per-action pending isolation: one in-flight student action MUST NOT disable session primary (test asserts `Pause` stays enabled while extend is pending). Keep `pendingActions: ReadonlySet<string>` keyed per action (`start/pause/resume/extend-N/student-*`) and `aria-busy` on the busy primary only.
- Banner roles: error → `role="alert"`, success → `role="status"`. Reload-failure suffix copy: ` However, the live view could not refresh. Retry to confirm.` appended to success text on reload failure. Stale banner: `role="alert"` with `Data may be out of date` + `Last updated {label}` + `Retry` button calling `controller.reload()`.
- Roster listbox: container `role="listbox"` `aria-label="Students in this session. Use arrow keys to move between students."`, `aria-activedescendant={sat-room-student-{id}}`, `tabIndex={visible ? 0 : -1}`; ArrowDown/ArrowUp move selection + focus `#sat-room-student-{id}`; rows `role="option"` `aria-label={Open {name}}` `aria-selected` `aria-current={selected||undefined}` `tabIndex={-1}` `id={sat-room-student-{id}}`. Single tab stop invariant — do NOT add Home/End or extra tab stops.
- Attention: filter buttons `All` / `Needs attention` with `aria-pressed`; chip toggles (needs click again → all, per current code); attention banner button `/...needs? attention/` sets filter to `needs`; `openAlerts` = unacknowledged alerts count; `{n} need attention` pill in header.
- Confirm previews, exact copy (tests assert substrings):
  - warn: title `Send warning to {name}?`, body contains `WARN_MESSAGE = Please return your attention to the exam.` as `The student will see exactly: “{WARN_MESSAGE}”`, confirm `Send Warning`.
  - extend-student: `Add {m} minutes for {name}?` + `Current remaining: {label}.` + `The extension applies to this attempt immediately.`, confirm `Add {m} Minutes`.
  - extend-session: `Add {m} minutes to {stage}?` + `Current stage remaining: {label}.` + `...current stage immediately.`.
  - terminate: `End {name}’s attempt?` + `This ends the student’s current attempt. Their recorded answers remain available.`, confirm `End Attempt`, `destructive`.
  - complete: `Finish this SAT session?` + `The session will be completed for the cohort. This should only be used when testing is finished.`, confirm `Finish Session`, `destructive`.
- Terminate binding: confirm captures `{studentId, studentName}` at OPEN; selection may move while dialog is open — confirm still acts on captured id; if captured id left the roster, show error (`{name} is no longer in this session...`) and do NOT call gateway.
- Stale mode (`controller.error` truthy + schedule loaded): `isStale=true` → session primary `disabled`, all `SatMenu` items `disabled: blocked || pending`, student actions blocked, `Reconnecting` badge in header, stale banner with Retry. `onExtend/onAddTime` early-return when stale.
- Success scoping (F-B16): transient success clears on `selectedStudentId` change; errors persist until next action. Keep `messageRef` + effect.
- PII discipline: `logInfo(`sat.session.action`, { action, scheduleId, latencyMs, outcome })` and `logError(err, { scope, action, scheduleId, latencyMs })` — IDs only, never names/emails. Success toasts MAY contain names (user-visible); logs MUST NOT.
- Hooks-before-returns: all `useMemo/useState/useCallback/useEffect/useAuthoritativeDeadlineClock` run unconditionally before early `ErrorSurface/LoadingSurface` returns.
- Timing: `useAuthoritativeDeadlineClock({ deadlineAt, serverNow, fallbackSeconds, running })` args unchanged; row-level `coarse: running && fallbackSeconds > 300` (far-from-deadline 15s coarse, under 5min 1s precise). No interval/polling change. `formatRemaining` (`H:MM:SS` / `M:SS`, clamped ≥ 0) unchanged.
- `SessionControls` contract: primary by `runtimeStatus` (`not_started→Start(Play)`, `live→Pause(Pause)`, `paused→Resume(Play)`, else null); busy → spinner `.sat-spinner` + `Working…` + `aria-busy` + `disabled`; `active = live||paused` gates `SatMenu label="Session actions" compact align="end" width={176} icon={MoreHorizontal}` with items `extend-5/extend-10/finish(destructive, separatorBefore)`.
- `StudentDetail` contract: `SatMenu label="Student actions"` items `extend-5(Add 5 minutes…)/warn(Send warning…)/toggle(Pause↔Resume)/terminate(End attempt…, destructive, separatorBefore)`, all disabled when `anyStudentPending || blocked`; info `dl` 3 cards (Current module / Time remaining / Attempt); Attention section (clean dot+text vs warnings/violations list, max 5 violations, `type.replace(/_/g,` `)`).
- Status visuals: `runtimeLabel` (not_started→Ready, live→Live, paused→Paused, completed→Finished, else Cancelled) + `roomStatusTone` (live→live pulse, paused→paused, not_started→info, completed→finished, else cancelled) via `SatStatusPill pulse={live}`; `studentTone` dot (terminated→slate, paused/warned/violations→amber, connecting/idle→slate, else emerald) + `AlertTriangle` when warnings/violations.
- Overrun: `runtime.isOverrun` → header `Overrun` badge + aside overrun card (`Running beyond the scheduled window…`).

### 4.2 Result Detail — behavioral contracts (from `SatResultsRoutes.test.tsx` detail cases)

- Back control: `<button aria-label="Back to SAT results">` with visible `Results` + `ArrowLeft`.
- Hero caption: scored+scaled → `Scaled practice score · Practice · {releaseStatus}`; scored unscaled → `Raw correct {c}/{q} — scaled score unavailable · Practice · {releaseStatus}`; unscored → `{outcomeLabel} · Practice · {releaseStatus}`. `outcomeLabel`: invalidated_proctor→`Exam terminated by proctor`, invalidated_timeout→`Exam ended before scoring`, pending→`Scoring pending`, else→`Practice score`.
- Policy footnote pinned below questions: matches `/generated by this practice assessment system/i` — keep as plain `<p>`, do not restyle into a callout that changes hierarchy.
- Static outcome (unscored): `No score was produced for this attempt.` with NO `role` attribute (test asserts `not.toHaveAttribute(`role`)`) — no redundant live region.
- Hero value: invalidated→`Not scored`; scaled→`{totalScore}`; scored-unscaled→`{correct}/{questions}`; else→`Pending`. 52px tabular-nums preserved (section 5 step 4).
- `Updating…` iff `query.isFetching && !query.isLoading`.
- Helpers unchanged: `sectionTitle()` (reading/writing→Reading & Writing, math→Math, else Title-Case), `rawTotals()`, `formatDate()` (long month/day/year/hour/minute, `—` fallback), `moduleRoleLabel()` (base/lower_branch/higher_branch), `formatRawValue()` (`empty→(empty)`, null→`—`, object→JSON, else String), `questionsBySection` memo grouping.
- Performance cards: per section `sat-row-enter` + `style={{`--sat-row-index`: min(sectionIndex,5)}}`; grid `min-h-[82px]`; `Raw` + `Practice score` eyebrow labels; `Adaptive route · Higher/Lower` only when `section.route`; module `dl aria-label="{Section} module raw scores"` with `dt=moduleKey`, `dd={roleLabel} · {state}`, `dd={rawCorrect} / {operational}`; `Module identifiers as delivered.` only after first section.
- Questions: per section with rows → `SatSectionCard` + `h3={Section}` + `QuestionRawTable rows caption={Section question responses}`; row shape `{key: section:module:qid, index, question: qid · module, section: Title, studentAnswer, correctAnswer, isCorrect, badges}`; badges `Pretest · excluded / Marked for review / Unanswered`; empty → `No question-level responses recorded for this result.`; header `Question-level responses ({n})`. Never fabricate verdicts: null `isCorrect` renders `Not scored`, never `Incorrect` (test asserts 1 Correct + 1 Incorrect + 2 Not scored).
- Outcome pill (unscored path): `SatStatusPill tone={invalidated?`invalidated`:`pending`}` + `sat-outcome-heading` + `SatSectionCard labelledBy`.
- No IELTS band language anywhere (`overall band`, `6.5` forbidden — enforced by list tests; keep detail free of it too).

### 4.3 Access wrapper contracts

- Props passthrough to `StudentLinksDashboard`: `{exam, overview, isLoading, error, onRefresh, onBackToRelease}` — exact prop names.
- Guards in order: `!examId` → ErrorSurface `Student Access could not load / A valid SAT exam is required. / Back to Exam Library → /sat/exams`; `examQuery.isLoading` → LoadingSurface `Opening Student Access…`; `examQuery.error || !data` → ErrorSurface; `exam.providerKey !== `sat`` → ErrorSurface `This is not a SAT exam / Open this exam from its IELTS workspace instead.`.
- `distributionQuery`: `overview={data ?? null}`, `isLoading={isLoading && !data}`, `error={error instanceof Error ? message : null}`, `onRefresh={() => refetch()}`, `onBackToRelease={() => navigate(/sat/exams/{id}/release)}`.
- Dashboard header back-link rhythm (`Release` + ArrowLeft, `min-h-11`, focus ring) lives INSIDE the dashboard — observe but do not restyle from this phase.

### 4.4 Universal a11y / motion invariants (never break)

- dot+label status (tone never carries state alone); skeleton-XOR rule (never skeleton + count together — room/detail have no such pair today, keep it that way); polite live regions only where they exist; roving tabindex (roster listbox); focus-visible rings on every interactive element; 44px targets (coarse-pointer floor) with 32px `sat-search-clear` exemption intact; Cancel-focused alerts; backdrop-tap-never-dismisses; reduced-motion kills row/route/banner/spinner/live-dot/shimmer; reduced-transparency forces opaque glass fallback; contrast/forced-colors mappings.
## 5. Step-by-step implementation plan

Do these in order. Each step is styling/layout only — stop and revert if any test, ARIA role, label, or timing arg would change.

### Step 0 — Baseline (no edits yet)

1. Run scoped tests to record a green baseline: `npm run test:run -- src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx`.
2. Open the three routes at desktop (1280px+), tablet (~768px), mobile (390px) + keyboard-only pass + `prefers-reduced-motion` pass. Note current pain: room header crowding, flat roster/detail/aside grid, result hero + performance density, access back-link rhythm.

### Step 1 — Session Room header: sticky glass, timer tabular-nums, state badges (keep all wiring)

File: `SatSessionRoomRoute.tsx` header block only.

1. Keep element and focus order: back `Sessions` arrow, divider, title block, Overrun?, Reconnecting?, attention pill?, `SessionControls`. Do not reorder DOM for visual effect.
2. Restyle with Phase-01 tokens (use actual Phase-01 names; fall back to current hex only if a token is missing and leave a `TODO(phase-05)` comment): header `sticky top-0 z-50 border-b` + glass background token + `backdrop-blur-2xl` + opaque fallback under `prefers-reduced-transparency`; title 13px semibold tracking -0.01em + `SatStatusPill` unchanged; cohort line keep 9px tertiary unless the Phase-03 type ramp explicitly blesses 10px (prefer keep — density is load-bearing in this header).
3. Badges: Overrun (amber border/bg/text via warning tokens), Reconnecting (amber text + AlertTriangle size 11), attention pill (amber dot+label, tabular-nums count). All keep current text.
4. Timers MUST keep `tabular-nums` (roster head + stage hero already have it — verify) so 1s ticks do not shift layout. Keep `formatRemaining` output identical.
5. `SessionControls` visual pass only: primary keeps `min-h-10 rounded-[10px]` + accent tokens + spinner `.sat-spinner` + `Working…` + `aria-busy`; compact `SatMenu` trigger keeps 40px target. No item add/remove/rename, no `blocked` logic change.
6. Verify: header never pushes controls off-screen at 390px (title truncates, controls shrink-0); focus ring visible on back + primary + menu trigger; stale still disables primary (existing test).

### Step 2 — Roster: listbox rows + attention filter (perf-safe, no animation on ticks)

File: `SatSessionRoomRoute.tsx` roster section (aria-label Students) only.

1. Keep: `SatSearchField id="sat-room-student-search" label="Search students" widthClassName="w-full"`, filter `role="group" aria-label="Roster filter"` + `aria-pressed` buttons (toggle semantics: needs click again goes to all), listbox keyboard handler (ArrowUp/Down only — do NOT add Home/End), `aria-activedescendant`, empty strings (`No matching students.` / `Students appear here when they join.`).
2. Row (`SatRoomStudentRow`) premium pass, structure unchanged (button grid 1fr/auto, name row + section line on the left, timer + status on the right): selected gets border token + white surface + card shadow; unselected stays `border-transparent hover:border + hover:bg-white`; transition `background-color,border-color,box-shadow` ONLY (already correct — keep; this is why 300-row rooms stay jank-free on clock ticks).
3. Type: name 11px semibold, status dot h-1.5 w-1.5 rounded-full + studentTone, warning AlertTriangle 11 amber, section 8px tertiary truncate pl-3.5, timer 11px semibold tabular-nums, status 8px capitalize tertiary. Keep sizes unless the Phase-03 type ramp explicitly blesses +1px.
4. Focus: `focus-visible:ring-2` with the Phase-01 focus-ring token (same geometry, tokenized color). Filter chips: `min-h-8 rounded-full px-3 10px semibold`, active `bg-slate-900 text-white` maps to a staff inverse token only if Phase 01 provides one, else keep literal (do not invent a token here).
5. Count line stays tabular-nums. Scroll regions (`max-h-[44vh] lg:max-h-[calc(100vh-166px)]`) unchanged.
6. Verify: single tab stop (Tab lands on listbox once), arrows move + focus rows, screen reader announces Open-name + selected; search + attention combine with AND semantics.

### Step 3 — Room detail bento: stage hero + student detail + session aside

File: `SatSessionRoomRoute.tsx` main grid only.

1. Keep grid skeleton: `lg:grid-cols-[310px_minmax(0,1fr)]` roster/detail + inner `xl:grid-cols-[minmax(0,1fr)_250px]` detail/aside. Collapse order on mobile stays roster, stage, student, aside (current DOM order already does this — do not reorder DOM).
2. Stage hero: `SatEyebrow Current stage` + h1 25px tracking -0.04em + caption `Server-authoritative session clock` + big timer 36px semibold tabular-nums tracking -0.045em. Tokenize border (border-b) and text colors; keep sizes and letter-spacing — editorial confidence lives here.
3. Attention banner (when openAlerts>0 and a student is selected): keep as a button that sets filter to needs; classes `sat-banner-enter rounded-2xl amber border/bg/text 11px` + focus ring. Do not convert to div.
4. Stale + message banners: keep `sat-banner-enter`, role=alert/status mapping, rounded-2xl amber / red-50 / neutral fills via Phase-01 tokens. Keep Retry min-h-9 secondary button.
5. `StudentDetail` bento: header (SatEyebrow Student + h2 22px + 10px tertiary id-email line + SatMenu Student actions), 3-card dl grid sm:grid-cols-3 gap-2 (rounded-2xl border bg-white; Time remaining 19px tabular-nums), Attention section (h3 12px + clean dot+text vs warnings/violations, max 5). Tokenize borders/fills; keep copy, menu items, disabled logic, and onAddTime/onWarn/onPause/onResume/onTerminate wiring identical.
6. Aside: single `SatSectionCard` (SatEyebrow Session + dl space-y-3.5 InfoRow list Status/Current stage/Joined/Active/Warnings + overrun card). InfoRow keeps 8px uppercase tracking label / 11px semibold value. Do not add a timeline or progress widget — there is no data contract for one; the overall-plan word means this dl + overrun note, not a new component.
7. Empty student state: keep icon + `No student selected / Select a student…` centered block.
8. Verify: dense but scannable at 1280px (roster 310px never squeezes detail; aside 250px wraps below at <xl); 44px targets on all menus/buttons; no horizontal scroll at 390px.

### Step 4 — Result Detail: hero + performance bento + questions wrapper

File: `SatResultDetailRoute.tsx` only.

1. Container: keep `max-w-[900px] px-4 sm:px-6 lg:px-10 pb-16 pt-6 md:pt-9`. Back button: keep `aria-label="Back to SAT results"`, -ml-2 min-h-10 rounded-[10px] px-2 12px semibold, ArrowLeft 15. Back link sits above the hero, left-aligned — do not restyle into a pill.
2. Hero: keep eyebrow (examTitle + Version n, 10px uppercase 0.14em tertiary), h1 30px tracking -0.045em text-balance, meta 11px tertiary (id, cohort, date), score 52px semibold tabular-nums leading-none tracking -0.045em, caption 9px semibold uppercase 0.13em tertiary (hero-basis caption incl. release status), Updating line. Tokenize colors/border (border-b); keep all sizes — the 52px hero is the page signature.
3. Performance (scored): section aria-labelledby sat-performance-heading + h2 17px tracking -0.025em + space-y-2 cards. Each card: `sat-row-enter rounded-2xl border bg-white p-4 sm:p-5 shadow-card` + row-index custom property min(i,5); inner grid min-h-82px (1fr/auto, sm 1fr/130px/130px); title 13px semibold, route 9px tertiary, numbers 16px semibold tabular-nums, eyebrows 8px uppercase 0.1em tertiary (Raw / Practice score); module dl rounded-xl bg-subtle p-3 space-y-1.5 + row 12px + role 10px capitalize tertiary + score tabular-nums. This IS the performance bento — no new chart or summary widget.
4. Outcome (unscored): `SatSectionCard labelledBy=sat-outcome-heading mt-7` + h2 17px + `SatStatusPill` + 13px/6 max-w-xl paragraph ending `No score was produced…`. Keep pill tone map; keep paragraph role-less.
5. Questions (scored): section aria-labelledby sat-questions-heading border-t py-7 + h2 17px Question-level responses (n) + space-y-8 per-section `SatSectionCard > h3 13px` + `QuestionRawTable rows caption`. Row-mapping code unchanged (key/index/question/section/answers/badges). Empty goes to a plain 13px paragraph. Footnote 10px/5 tertiary max-w-xl stays pinned last.
6. Verify: hero caption + footnote exact strings (tests); module dl aria-label; Correct/Incorrect/Not-scored counts; no band language; focus order back then content; tabular-nums on every score.

### Step 5 — Access: wrapper rhythm only

File: `SatAccessRoute.tsx` only (36 lines stays about 36 lines).

1. Keep all guards, hooks, and prop mapping exactly (section 4.3). The file renders no back link directly — the dashboard owns its Release back control — so in practice expect no visual change unless the wrapper needs a container to match room/detail rhythm (it does not today).
2. Do NOT wrap `StudentLinksDashboard` in extra containers, headers, or cards; do NOT restyle its sticky header, SatContainer, SatPageHeader, error/empty states, or buttons. Any back-link rhythm ask is satisfied by the existing dashboard control + Phase-03 primitives.
3. If the wrapper ErrorSurface/LoadingSurface instances need token alignment, leave them — they are shared surfaces, not staff primitives; changing them is out of scope.
4. Verify: non-SAT guard message, missing-exam guard, loading label, passthrough props — all covered by dashboard tests + manual nav to `/sat/exams/:examId/access`.

### Step 6 — Token adoption sweep (inside owned files only)

1. Replace inline staff hex/alphas in the three routes with Phase-01 `--sat-staff-*` tokens or Phase-03 primitive props: #f5f5f7 goes to canvas, white goes to surface, black alpha borders go to border, slate text goes to text tokens, #0071e3/#0077ed go to accent/hover, amber/red banners go to warning/danger tokens, arbitrary shadows go to shadow-card, rounded and ring hexes go to radius/focus tokens.
2. Keep functional literals that are NOT staff chrome: status-dot fills in `studentTone` (slate/amber/emerald — also mirrored by text labels, so color-never-alone holds), `QuestionRawTable` internals, `ErrorSurface/LoadingSurface` styles.
3. Never add a new `sat-*` CSS class, keyframe, or token — if something is missing, consume the closest existing token and log a Phase-05 TODO comment (plain `// TODO(phase-05): …` referencing the Phase-01 token name).
## 6. Important code / pseudocode (sketches — not full files)

### 6.1 Token consumption pattern (routes only consume)

BEFORE (current, illustrative): header with `sticky top-0 z-50 border-b border-black/[0.065] bg-white/90 backdrop-blur-2xl`. AFTER: same layout with the Phase-01 glass background token and border token (confirm exact names with the Phase 01 plan; do not define tokens here). Fallback rule: every glass surface keeps an opaque paint underneath so `prefers-reduced-transparency` and no-blur engines stay readable. Never put low-contrast text on glass; content cards stay solid surface tokens.

### 6.2 Room header sketch (order frozen)

Header keeps this DOM order: back Sessions button, divider, min-w-0 flex-1 title block (13px title + SatStatusPill + cohort line), conditional Overrun badge, conditional Reconnecting badge, conditional attention pill with tabular-nums count, then SessionControls with identical props. Only class strings change (tokenized border/background/text/focus colors); handlers and conditions stay character-identical.

### 6.3 Roster row sketch (structure frozen, classes tokenized)

API signature unchanged: `SatRoomStudentRow({ student: StudentSession; runtime: ExamSessionRuntime | null; selected: boolean; onSelect: () => void })`. Element stays `button#sat-room-student-{id}[role=option]` with grid 1fr/auto, left name/status block and right timer/status block, transition background-color/border-color/box-shadow only. Selected state: border token + white surface + card shadow. Unselected: border-transparent with hover border + hover white surface. Focus ring geometry identical, color from the Phase-01 focus token.

### 6.4 Confirm wiring (untouched — reference only)

State type stays: `type ConfirmState = { kind: 'complete' } | { kind: 'terminate'; studentId: string; studentName: string } | { kind: 'warn'; studentId: string; studentName: string } | { kind: 'extend-session'; minutes: number; stage: string; remainingLabel: string } | { kind: 'extend-student'; minutes: number; studentId: string; studentName: string; remainingLabel: string }`. Render stays `<SatConfirmDialog open title description confirmLabel destructive={terminate||complete} onCancel={() => setConfirm(null)} onConfirm={...} />` with title/description/confirmLabel builders character-identical (section 4.1). Destructive only for terminate/complete. Cancel stays focused; backdrop tap never dismisses.

### 6.5 Result hero + performance sketch

Hero keeps: eyebrow (examTitle + Version n), h1 30px student name, meta (id, cohort, date), score 52px tabular-nums (Not scored | totalScore | raw c/q | Pending), caption (basis + Practice + releaseStatus), Updating line. Scored path renders section sat-performance-heading with per-section cards (row-enter + capped row-index + module dl). Unscored path renders SatSectionCard labelledBy sat-outcome-heading with pill + role-less paragraph. Scored questions path renders section sat-questions-heading with per-section SatSectionCard + QuestionRawTable. Footnote paragraph stays pinned last.

### 6.6 Access wrapper (frozen shape)

Stays: `export function SatAccessRoute()` reading `useParams examId` + `useNavigate`; early `!examId` ErrorSurface; `useExamQuery(examId)` + `useAccessDistributionOverview(examId ?? "")`; isLoading / error / providerKey guards in order; final `<StudentLinksDashboard exam overview={data ?? null} isLoading error onRefresh onBackToRelease={() => navigate(/sat/exams/{id}/release)} />`. Do not reorder hooks vs guards beyond what tests already accept.

## 7. Edge cases

1. Overrun + stale at once — Overrun badge + Reconnecting badge + stale banner stack without pushing controls off-screen; risky actions stay disabled; overrun aside card still renders.
2. 300-row rooms — no per-tick animation (row transition excludes transform except press-scale; selection is a cross-fade only); coarse clock above 5min vs precise below 5min preserved; listbox scroll regions unchanged.
3. Search + attention filter — AND semantics (matchesSearch and matchesAttention); empty-match copy differs (filtered vs never-joined); aria-activedescendant undefined when empty; container tabIndex -1 when empty.
4. Selection leaves mid-dialog — captured-id error path, no gateway call, dialog closes via explicit Cancel/Confirm only (backdrop tap never dismisses).
5. Pending storms — per-key isolation; double-click same action no-ops; success/error banner replaces previous (setMessage null at start); success clears on selection change, errors persist.
6. Long names/titles — truncate with min-w-0/truncate; timer never wraps (tabular-nums + shrink-0 controls).
7. Unscaled / pending / invalidated results — hero truthfulness (raw fallback, Not scored, Pending), outcome pill tones, no verdict fabrication in table.
8. Object/empty answers — formatRawValue JSON/empty/dash paths render without breaking table layout.
9. Accessibility preferences — reduced-motion (no row/banner/spinner/pulse), reduced-transparency (opaque header/menus), contrast-more + forced-colors (labels/separators/focus survive), coarse-pointer 44px (search-clear stays 32px), keyboard-only (roster arrows, menu arrows/Escape, dialog Escape-to-Cancel, shell skip-link).
10. PII — names/emails visible in UI + success toasts only; logs carry IDs + scheduleId + latencyMs. No student identifiers added to new attributes, titles, or analytics.
11. Non-SAT exam at access URL — IELTS redirect copy preserved; no SAT styling leaks into IELTS.

## 8. Tests to add / update

### 8.1 Update (implementation stage)

- `src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx`: keep all 11 existing tests green without touching their assertions (they pin contracts). ADD: header badges — overrun renders Overrun when isOverrun; reconnecting renders when error is set; timers carry tabular-nums class (hero + row). ADD: roster filter composition — search needle + Needs attention AND semantics (warned student matches, clean student hidden when filter is on). ADD: stale disables student menu items (open Student actions, assert items disabled) in addition to the existing Pause-disabled assert. ADD (cheap): banners keep sat-banner-enter class; extend-session success text ends `Added 5 minutes to the current stage.`.
- `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` (detail cases): keep all 14 existing tests green. ADD: hero score element has tabular-nums; performance cards carry sat-row-enter + row-index custom property capped at 5 (render 7 sections, assert the 7th still carries index 5). ADD: module dl has accessible name ending module raw scores; Module identifiers as delivered. appears exactly once (first section only). ADD: questions empty state `No question-level responses recorded for this result.`; unscored detail renders no Question-level responses section.
- No changes to `StudentLinksDashboard.test.tsx` (out of scope) or CSS contract tests.

### 8.2 Manual checks (implementation must do, Phase 05 re-verifies)

- Keyboard: Tab to listbox, arrows move, menus via Arrow/Escape, dialogs via Escape, back links reachable, focus rings visible everywhere.
- Breakpoints 390 / 768 / 1280 / 1500px: no horizontal scroll, header controls visible, roster/detail/aside stacking correct.
- Prefs emulation: prefers-reduced-motion, prefers-reduced-transparency, prefers-contrast more, forced-colors, coarse pointer.
- Contrast spot-check: body/secondary/tertiary text, amber/red banners, accent buttons (AA on text pairs).

## 9. Verification commands (scoped — Phase 04B gate)

Run these exact commands; all must pass. The full matrix is Phase 05 work, not this phase.

```bash
# Typecheck (whole repo — required; owned files must introduce zero errors)
npx tsc --noEmit

# Scoped route tests (must be green)
npm run test:run -- src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx

# Primitive + CSS contract regression (must stay green — proves no contract drift)
npm run test:run -- src/products/sat/ui/__tests__/SatPage.test.tsx src/products/sat/ui/__tests__/Menu.test.tsx src/products/sat/ui/__tests__/Dialogs.test.tsx src/products/sat/ui/__tests__/SegmentedControl.test.tsx src/products/sat/ui/__tests__/satContractsCss.test.ts

# Lint owned files
npx eslint src/products/sat/routes/SatSessionRoomRoute.tsx src/products/sat/routes/SatResultDetailRoute.tsx src/products/sat/routes/SatAccessRoute.tsx src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx

# Accessibility e2e (SAT suite — run; file bugs in foreign files to owning phases, do not fix them here)
npm run e2e:sat-a11y
```

Full matrix (for Phase 05, NOT this phase): full `npm run test:run` + `npx tsc --noEmit` + `npx eslint <all sat>` + `npm run e2e:sat-a11y` + contrast/motion audit + cross-route consistency + TODO sweep. Phase 04B must not claim the full matrix — only the scoped commands above.

## 10. Definition of Done

- [ ] `SatSessionRoomRoute.tsx`: sticky glass header with solid fallback (timer tabular-nums, Overrun/Reconnecting/attention states), roster listbox + attention filter premium but structurally identical, detail bento (stage hero / student cards / attention / session aside), SessionControls + confirm/menu wiring character-identical, no polling/action/timing/PII change.
- [ ] `SatResultDetailRoute.tsx`: 52px tabular hero + practice caption + Updating rule, performance bento with capped stagger + module dl, per-section QuestionRawTable wrapper, outcome static paragraph role-less, policy footnote pinned, no verdict fabrication, no band language.
- [ ] `SatAccessRoute.tsx`: wrapper guards + passthrough identical; zero dashboard-internal edits; back-link rhythm verified via the existing dashboard control.
- [ ] Inline hex/alphas in owned files mapped to Phase-01 tokens / Phase-03 props; no new tokens, classes, keyframes, stores, or shared files; `.sat-ui` untouched.
- [ ] All contracts in section 4 preserved: exported component names, ARIA roles/names, class hooks (sat-banner-enter/sat-row-enter/sat-spinner/sat-live-dot/sat-search-clear), test expectations, skeleton-XOR, dot+label, live regions, reduced-motion/transparency, focus rings, 44px targets (32px search-clear exemption), Cancel-focused alerts.
- [ ] Tests: existing 11 + 14 green; new tests in section 8.1 added and green; primitive + CSS contract suites green.
- [ ] Verification: `npx tsc --noEmit`, scoped vitest paths, `npx eslint` on owned files, `npm run e2e:sat-a11y` executed with results recorded; failures in foreign files routed to owning phases, not patched here.
- [ ] No product code edited outside the three owned route files (+ their two test files); plan-file-only rule respected in this stage.