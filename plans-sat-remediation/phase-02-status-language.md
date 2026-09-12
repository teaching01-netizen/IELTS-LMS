# Phase 02 — Status Language, Search Scope, Writing Consistency (PLAN ONLY)

## Objective

Apply the copy-only remediation from the Apple-design audit (Lens 5 Content) to the SAT staff workspace with zero layout or behavior change, except one mandated line deletion:

1. Delete the duplicated 8px outcome caption in `SatResultsRoute.tsx` so each result row exposes exactly one status signal (the `SatStatusPill`), removing the single largest sub-floor type instance on that route.
2. Replace four under-specified search placeholders with scope-explicit placeholders that name the fields the filter predicate actually matches.
3. Normalize button/menu copy to Title Case: `Clear search` → `Clear Search` (2 empty-state actions), `Sign out` → `Sign Out` (sidebar icon button + account menu item).
4. Delete the jargon footnote `"Module identifiers as delivered."` in `SatResultDetailRoute.tsx`.
5. Align the exam-creation action name: primary `New SAT` → `Create SAT` (header button, empty-state button, dialog title).

No layout, filtering, polling, routing, or dialog-behavior change. One line deleted, remainder string-only swaps. Dark-mode, type-scale, density, and dirty-guard work belongs to Phases 01 / 03 / 04 / 05 and is explicitly out of scope here.

## Dependencies

- **Phase 01 (hard dependency, must land first):** the 6-step type scale with the 11px floor (`floor 11px medium`, `eyebrow 11px caps/0.12`) must exist in tokens/primitives before this phase lands. This phase consumes the floor classes but defines none. It deletes sub-11px copy (8px line, 10px jargon line) and must not introduce any new sub-11px text.
- **Frozen contracts consumed from Phase 01:** `satOutcomeTone` single status-tone table (do not fork or rename tones); `SatStatusPill`, `SatSearchField` (incl. its `Clear <label>` X-button), `SatPrimaryButton`, `SatFormDialog` APIs unchanged; contrast floor (all text ≥ 4.5:1 — copy swaps must not introduce new hex literals or new colors).
- **Parallel peers (no dependency, disjoint files):** Phase 03 (dirty-guard in `SatFormDialog`/`NewSatSessionSheet`) and Phase 04 (Session Room roster/detail compress) may run concurrently. Do not touch their files except the one room placeholder swap listed below (string-only, no markup change, no conflict with Phase 04 row compression).
- **Phase 05 ordering note:** status-pill text content changed here (row caption removed; pill text itself unchanged) is final copy before Phase 05 dark-appearance verification. No color work in this phase.

## Affected / new files (with line refs where known)

Source files owned by this phase (all paths relative to repo root; line numbers from pre-remediation read):

| # | File | Line(s) | Change |
|---|------|---------|--------|
| 1 | `src/products/sat/routes/SatResultsRoute.tsx` | L118 (delete); L73 (placeholder); L163 context | Delete 8px duplicate outcome line; swap placeholder |
| 2 | `src/products/sat/routes/SatResultDetailRoute.tsx` | L127 (delete) | Delete jargon footnote |
| 3 | `src/products/sat/routes/SatExamLibraryRoute.tsx` | L123 (placeholder); L126 (header CTA); L163 (empty-state actions); L167 (dialog title) | 1 placeholder + 3 action-name swaps + 1 Title-Case swap |
| 4 | `src/products/sat/routes/SatSessionsRoute.tsx` | L111 (placeholder); L176 (empty-state CTA) | 1 placeholder + 1 Title-Case swap |
| 5 | `src/products/sat/routes/SatSessionRoomRoute.tsx` | L177 (placeholder) | 1 placeholder swap only |
| 6 | `src/products/sat/SatRoot.tsx` | L125 (`aria-label="Sign out"`); L159 (menu `label: 'Sign out'`) | Title-Case → `Sign Out` (2 sites) |
| 7 | `src/products/sat/ui/SatPage.tsx` | L59 (`const clearLabel = 'Clear ' + label;`) | NO CHANGE — already Title-Case `Clear`; documented to prevent accidental edit |

Test files that pin current copy and MUST be updated alongside (same phase, test-only edits):

| File | Lines pinning old copy |
|------|------------------------|
| `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` | L76–102 (pill/caption assertions); L272 (jargon assertion) |
| `src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx` | L50, L72–76, L97, L109–112 (`New SAT`, `Search exams`, `Clear search`) |
| `src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx` | L128, L132, L148–150 (`Search sessions`, `Clear search`) |
| `src/products/sat/__tests__/SatRoot.test.tsx` | L76, L97, L119, L186, L189, L216 (`Sign out`) |
| `src/products/sat/ui/__tests__/SatPage.test.tsx` | L48, L62, L106–114, L256, L262, L271 — asserts `New SAT` / `Clear Search tests` as *prop-driven* values; NO source change needed (see Contracts) |
| `src/products/sat/ui/__tests__/Dialogs.test.tsx` | L97–127 (`title="New SAT"` passed as prop) — prop-driven; update only if the shared helper test is aligned to the new canonical title (optional, prefer leaving) |

New test file (1 added):

| File | Purpose |
|------|---------|
| `src/products/sat/routes/__tests__/SatPhase02Copy.test.tsx` | Copy-contract assertions for this phase (placeholder scope, Title Case, jargon absence, single-pill rows, Create SAT naming) |

No other files. In particular: NO edit to `src/index.css`, `SatPage.tsx`, `ConfirmDialog.tsx`, `SegmentedControl.tsx`, `Menu.tsx`, `.sat-ui` / student-delivery, or any store/network/auth module.

## Contracts / interfaces (frozen inputs from Phase 01 if relevant; what you must not break)

1. **`satOutcomeTone(outcomeStatus)` single table — DO NOT fork.** Row pill keeps `tone={satOutcomeTone(result.outcomeStatus)}` and child `{outcomeLabel(result.outcomeStatus)}` exactly as today. Deleting L118 removes the *duplicate plain-text* caption, not the pill. Outcome strings (`Exam terminated by proctor`, `Exam ended before scoring`, `Scoring pending`, `Practice`) and tone mapping are unchanged.
2. **Filter predicates are frozen.** Placeholder swaps must describe the existing predicate, never widen it:
   - Results L49–50 matches `[studentName, studentId, examTitle, cohortName]`.
   - Sessions L92 matches `[examTitle, cohortName, institution]`.
   - Library L67 matches `exam.title` only.
   - Room L76 matches `[name, studentId, email]`.
   - No change to trim/lowercase/empty-needle behavior, sort order, empty-state branching, or count announcers.
3. **`SatSearchField` clear-X contract untouched.** `SatPage.tsx:59` derives `aria-label={'Clear ' + label}` from the field `label` prop (already Title-Case `Clear`, e.g. `Clear Search tests`). Do not edit. The `Clear search` → `Clear Search` fix applies ONLY to the two `SatPrimaryButton` empty-state actions (Library L163, Sessions L176), which are independent string literals.
4. **Dialog/form contracts untouched.** `SatFormDialog open/eyebrow/title/onClose` props, form submit/validation, focus-frame effect, pristine/dirty behavior stay identical (dirty-guard is Phase 03). Renaming dialog `title="New SAT"` → `title="Create SAT"` changes only the visible heading / accessible dialog name.
5. **Navigation/logout behavior untouched.** `SatRoot` `logout()` wiring, menu item `id: 'signout'`, icon-button hit area, and nav labels (`Exam Library`, `Sessions`, `Results`) stay identical; only the two human-visible `Sign out` strings change case.
6. **No new colors, tokens, classes, or layout.** Copy swaps reuse existing classes verbatim. The two deletions remove markup; they add nothing. Do not touch target sizes (Phase 01), stagger, glass, or motion.
7. **Accessibility-name stability (except intended renames).** Search field `label` props (`Search SAT results`, `Search SAT exams`, `Search SAT sessions`, `Search students`) are unchanged, so field accessible names and Escape-to-clear are unchanged. Intended accessible-name changes: dialog `New SAT` → `Create SAT`; buttons `Clear search` → `Clear Search`; `Sign out` → `Sign Out`. Tests querying by accessible name must be updated to match.

## Step-by-step implementation (ordered, each step names exact file + exact change: old class/token → new class/token, old string → new string)

> All string replacements are literal. Preserve surrounding whitespace/JSX structure. No class changes in any step except whole-line deletions.

**Step 1 — Delete the duplicated 8px outcome caption (Results rows).**
File: `src/products/sat/routes/SatResultsRoute.tsx` L118.
Delete this entire line (and only this line):
```tsx
// OLD (delete whole line 118):
                  <span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{outcomeLabel(result.outcomeStatus)} · Practice · {result.releaseStatus}</span>
```
Keep L119 (the pill) verbatim:
```tsx
// KEEP (unchanged):
                  <span className="mt-1.5 flex justify-end"><SatStatusPill tone={satOutcomeTone(result.outcomeStatus)}>{outcomeLabel(result.outcomeStatus)}</SatStatusPill></span>
```
Rationale: L118 duplicates the pill text (audit: "duplicates pill"), is the only `text-[8px]` on this route, and violates the 11px floor. Net effect: one status signal per row. No other markup moves.

**Step 2 — Scope the Results search placeholder.**
File: `src/products/sat/routes/SatResultsRoute.tsx` L73.
```
OLD: placeholder="Search results"
NEW: placeholder="Search name, ID, exam, cohort"
```
Matches the L49–50 predicate (`studentName, studentId, examTitle, cohortName`). `label="Search SAT results"` unchanged.

**Step 3 — Scope the Library search placeholder.**
File: `src/products/sat/routes/SatExamLibraryRoute.tsx` L123.
```
OLD: placeholder="Search exams"
NEW: placeholder="Search exam title"
```
Matches the L67 title-only predicate. `label="Search SAT exams"` unchanged. (Audit's verbatim example string `"Search name, ID, exam, cohort"` is adopted for Results in Step 2 where it matches the predicate; Library/Sessions/Room use the same pattern scoped to their own predicates — see Key-code note.)

**Step 4 — Scope the Sessions search placeholder.**
File: `src/products/sat/routes/SatSessionsRoute.tsx` L111.
```
OLD: placeholder="Search sessions"
NEW: placeholder="Search exam, cohort, institution"
```
Matches the L92 predicate (`examTitle, cohortName, institution`). `label="Search SAT sessions"` unchanged.

**Step 5 — Scope the Room roster search placeholder.**
File: `src/products/sat/routes/SatSessionRoomRoute.tsx` L177 (inside the `SatSearchField` props on that line).
```
OLD: placeholder="Search students"
NEW: placeholder="Search name, ID, email"
```
Matches the L76 predicate (`name, studentId, email`). `id="sat-room-student-search"`, `label="Search students"`, `widthClassName="w-full"` unchanged. This is the ONLY edit to the room file in this phase (Phase 04 owns all other room changes).

**Step 6 — Title-Case the Library empty-state CTA.**
File: `src/products/sat/routes/SatExamLibraryRoute.tsx` L163 (second branch of the `action` ternary).
```
OLD: <SatPrimaryButton onClick={() => setSearch('')}>Clear search</SatPrimaryButton>
NEW: <SatPrimaryButton onClick={() => setSearch('')}>Clear Search</SatPrimaryButton>
```
First branch of the same ternary is handled in Step 9.

**Step 7 — Title-Case the Sessions empty-state CTA.**
File: `src/products/sat/routes/SatSessionsRoute.tsx` L176.
```
OLD: action={search.trim() ? <SatPrimaryButton onClick={() => setSearch('')}>Clear search</SatPrimaryButton> : undefined}
NEW: action={search.trim() ? <SatPrimaryButton onClick={() => setSearch('')}>Clear Search</SatPrimaryButton> : undefined}
```

**Step 8 — Title-Case Sign Out (2 sites, same file).**
File: `src/products/sat/SatRoot.tsx`.
Site A, L125:
```
OLD: aria-label="Sign out"
NEW: aria-label="Sign Out"
```
Site B, L159 (account menu item):
```
OLD: { id: 'signout', label: 'Sign out', onSelect: () => void logout() },
NEW: { id: 'signout', label: 'Sign Out', onSelect: () => void logout() },
```
`id: 'signout'` (lowercase, stable key) unchanged. No behavior change.

**Step 9 — Align the exam-creation action name (3 sites, same file).**
File: `src/products/sat/routes/SatExamLibraryRoute.tsx`.
Site A, L126 (header primary with Plus icon):
```
OLD: <SatPrimaryButton onClick={openCreate} icon={<Plus size={15} aria-hidden="true" />}>New SAT</SatPrimaryButton>
NEW: <SatPrimaryButton onClick={openCreate} icon={<Plus size={15} aria-hidden="true" />}>Create SAT</SatPrimaryButton>
```
Site B, L163 (empty-state primary, first branch):
```
OLD: action={!search ? <SatPrimaryButton onClick={openCreate}>New SAT</SatPrimaryButton> : ...
NEW: action={!search ? <SatPrimaryButton onClick={openCreate}>Create SAT</SatPrimaryButton> : ...
```
(Combined with Step 6, the full new L163 reads: `action={!search ? <SatPrimaryButton onClick={openCreate}>Create SAT</SatPrimaryButton> : <SatPrimaryButton onClick={() => setSearch('')}>Clear Search</SatPrimaryButton>}`.)
Site C, L167 (dialog title):
```
OLD: <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="New SAT" onClose={() => setCreateOpen(false)}>
NEW: <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="Create SAT" onClose={() => setCreateOpen(false)}>
```
`"New Session"` in `SatSessionsRoute` is OUT OF SCOPE — do not rename. The dialog submit button `Create` (L178) and input placeholder `Practice Test 06` (L171) are unchanged.

**Step 10 — Delete the jargon footnote.**
File: `src/products/sat/routes/SatResultDetailRoute.tsx` L127.
Delete this entire line (and only this line):
```tsx
// OLD (delete whole line 127):
              {sectionIndex === 0 ? <p className="mt-3 text-[10px] leading-5 text-slate-400">Module identifiers as delivered.</p> : null}
```
Keep the surrounding `{modules.length > 0 ? (...) : null}` block and the closing `</div>` structure intact. Net effect: the module `dl` (with its `aria-label`) and scores render unchanged; only the footnote paragraph is gone.

**Step 11 — Update existing tests that pin old copy (test-only edits, same phase).**
- `SatResultsRoutes.test.tsx`: rewrite L76–102 assertions to the single-pill contract (see Tests); change L272 to assert ABSENCE of the jargon string.
- `SatExamLibraryRoute.test.tsx`: `'New SAT'` → `'Create SAT'` (L50, L97); `getByPlaceholderText('Search exams')` → `getByPlaceholderText('Search exam title')` (L74, L109, L112); `'Clear search'` → `'Clear Search'` (L76).
- `SatSessionsRoute.test.tsx`: `getByPlaceholderText('Search sessions')` → `getByPlaceholderText('Search exam, cohort, institution')` (L128, L148, L150); `'Clear search'` → `'Clear Search'` (L132).
- `SatRoot.test.tsx`: `'Sign out'` → `'Sign Out'` (L76, L97, L119, L186, L189, L216). Case-sensitive queries (`getByRole(..., { name: 'Sign Out' })`) must use the new case.
- Do NOT edit `SatPage.test.tsx` /`Dialogs.test.tsx` expectations unless the implementation agent confirms a shared-helper canonical change; they pass props directly and are unaffected by route copy.

**Step 12 — Add the Phase 02 copy-contract test file** at `src/products/sat/routes/__tests__/SatPhase02Copy.test.tsx` (see Tests for assertion sketches), then run Verification.

## Key code / pseudocode (dirty-guard logic, token blocks, row markup — only what your phase needs)

No dirty-guard logic. No token blocks. The only markup context the implementer needs:

**Results row after Step 1 (right-side block, L116–120 post-edit):**
```tsx
<span className="shrink-0 text-right">
  <span className="block text-[17px] font-semibold tabular-nums tracking-[-0.025em] text-slate-900">{result.outcomeStatus === 'scored' && result.totalScore != null ? result.totalScore : '—'}</span>
  {/* L118 duplicate caption DELETED — no replacement element */}
  <span className="mt-1.5 flex justify-end"><SatStatusPill tone={satOutcomeTone(result.outcomeStatus)}>{outcomeLabel(result.outcomeStatus)}</SatStatusPill></span>
</span>
```

**Placeholder-scope rationale (why four different strings):** each placeholder must name the fields its route's filter predicate actually tests (Contracts §2). The audit's verbatim example `"Search name, ID, exam, cohort"` is the Results string because the Results predicate is exactly `[studentName, studentId, examTitle, cohortName]`. The other three follow the identical pattern scoped to their predicates:
- Library predicate: `exam.title` → `"Search exam title"`
- Sessions predicate: `[examTitle, cohortName, institution]` → `"Search exam, cohort, institution"`
- Room predicate: `[name, studentId, email]` → `"Search name, ID, email"`
If the Main Agent instead requires byte-uniform placeholders, fall back to the audit's single string on all four — but the scoped variants above are the recommended implementation (overall-plan criterion 7 says "scoped search placeholders").

**Title-Case rule for this phase:** buttons and menu items use Title Case on every major word: `Clear Search`, `Sign Out`, `Create SAT` (SAT is an acronym, always all-caps), `Show archived`/`Hide archived` are NOT touched (sentence-case toggle chips owned by Phase 01 target/density work — leave alone). The in-field clear-X (`Clear <label>`) already complies.

## Edge cases (empty states, loading/error, polling refresh, keyboard, reduced-motion/transparency/contrast, forced-colors, 320px, 200% text)

- **Empty states:** Library and Sessions filtered-zero states keep their `SatResultCount` + hint + CTA composition; only CTA label case changes (`Clear Search`). Query echo (`No sessions match "…"`) unchanged. Library unfiltered-empty keeps its `Create SAT` primary (renamed, same position/handler). Results empty states have no CTA — unaffected.
- **Loading:** `SatListSkeleton` rows/labels (`Loading SAT exams/sessions/results`) unchanged; deletions remove no loading path. Detail-page `LoadingSurface`/`ErrorSurface` copy unchanged.
- **Error:** `ErrorSurface` titles/descriptions/actionLabels (`Retry`, `Back to Results`) unchanged on all five routes.
- **Polling refresh:** Sessions 4s poll and Results/Session refetch keep identical behavior. The Results `Updating…` cue (L104) is untouched; deleting L118 does not add or remove any live region. Detail-page fetching cue (L97) untouched.
- **Keyboard / screen reader:** Search fields keep `label` (accessible name), `id`, Escape-to-clear, and X-button `aria-label`; only `placeholder` (non-name hint) changes — AT behavior preserved. Dialog rename `New SAT` → `Create SAT` changes the dialog's accessible name; focus-frame effect and labelled controls (`SAT exam name`) unchanged. Menu item `Sign out` → `Sign Out` is a case-only accessible-name change; menu keyboard (arrow/Enter/Escape) owned by `SatMenu`, untouched. Row buttons keep their names (student/exam titles); removing the duplicate caption shortens the row's accessible description without removing any control name — verify with the single-pill test.
- **Reduced-motion / transparency / contrast / forced-colors:** no motion, opacity, color, or token change in this phase; Phase 01 answers and Phase 05 matrix are unaffected. New placeholders inherit the existing `placeholder:text-tertiary` style (tertiary #6e6e73, 5.07:1 — passes).
- **320px / 200% text:** deletions strictly reduce row/card height; placeholder length grows modestly (longest: `Search exam, cohort, institution`, 31 chars) inside fluid `sm:w-*` search fields with truncation — no overflow risk beyond what the existing responsive header already handles. No min-width or wrapping change.
- **i18n/l10n:** strings remain inline literals (existing pattern, no i18n framework in scope); replacements are plain ASCII with no interpolation change. No PII in new copy; no logging change.
- **Stale-contract trap:** the biggest risk is leaving an old-copy assertion (especially the Results caption tests and `Sign out` tests) un-updated so the suite goes red. Step 11 lists every pinning line; the new copy-contract test (Step 12) guards the new strings so future edits cannot silently revert.

## Tests (which existing tests must pass; which new unit/contract tests to add, with file paths and assertion sketches)

**Existing suites — must be green AFTER the Step 11 test-only updates (behavior contracts unchanged):**
- `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` — all cases; L76–102 and L272 rewritten (below).
- `src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx` — all cases with renamed queries.
- `src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx` — all cases with renamed queries.
- `src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx` — unaffected behaviorally; placeholder query update only if it queries the old placeholder.
- `src/products/sat/__tests__/SatRoot.test.tsx` — with `Sign Out` case fix.
- `src/products/sat/ui/__tests__/SatPage.test.tsx`, `Dialogs.test.tsx`, `Menu.test.tsx`, `SegmentedControl.test.tsx`, `useSatListParams.test.tsx`, `satContractsCss.test.ts`, `scheduleValidation.test.ts` — must pass UNCHANGED (if any fails, the implementation regressed a contract — stop and fix source, do not "fix" these tests except the noted canonical-title exception).

**Mandatory test edits (old assertions that WILL fail post-change and must be rewritten, not deleted):**
1. `SatResultsRoutes.test.tsx` L91–95 — old: `getAllByText('Practice')` length 1 + `getByText('Scoring pending · Practice · ready_to_release')`. New: assert exactly one status text per row via the pill, e.g. `expect(screen.getByText('Scoring pending')).toBeInTheDocument()` + `expect(screen.queryByText('Scoring pending · Practice · ready_to_release')).not.toBeInTheDocument()`.
2. `SatResultsRoutes.test.tsx` L101 — old: `getByText('Practice · Practice · ready_to_release')`. New: `expect(screen.queryByText(/Practice · Practice/)).not.toBeInTheDocument()` + pill `getByText('Practice')` still present once.
3. `SatResultsRoutes.test.tsx` L272 — old: `getAllByText('Module identifiers as delivered.')` length 1. New: `expect(screen.queryByText('Module identifiers as delivered.')).not.toBeInTheDocument()` while `getByLabelText('Reading & Writing module raw scores')` still present.

**New file: `src/products/sat/routes/__tests__/SatPhase02Copy.test.tsx`** (5 test cases, all render-only with the existing mock patterns from sibling suites):
1. `placeholders name their filter scope` — render Library/Sessions/Results routes (+ Room with controller mock) and assert `getByPlaceholderText('Search exam title')`, `('Search exam, cohort, institution')`, `('Search name, ID, exam, cohort')`, `('Search name, ID, email')` respectively; assert old placeholders (`Search exams`/`Search sessions`/`Search results`/`Search students`) are absent.
2. `empty-state CTAs are Title Case` — drive Library and Sessions to filtered-zero (`zzz-no-match`) and assert `getByRole('button', { name: 'Clear Search' })`; assert `queryByRole('button', { name: 'Clear search' })` is null.
3. `exam creation is named Create SAT` — Library: header `getByRole('button', { name: 'Create SAT' })`; open dialog → `getByRole('dialog', { name: 'Create SAT' })`; assert `queryByRole('button', { name: 'New SAT' })` null. (Dialog-name query works because `SatFormDialog title` feeds the dialog accessible name.)
4. `result rows expose a single status signal` — Results with scored+pending+invalidated fixtures: each `.sat-list-row` contains exactly one `[data-tone]`/pill element (or exactly one outcome-text node); assert `queryByText(/· Practice ·/)` null (no `· Practice ·` caption anywhere).
5. `jargon footnote is gone; module scores stay` — Detail with section+modules: `queryByText('Module identifiers as delivered.')` null; `getByLabelText('Reading & Writing module raw scores')` + `getByText('rw-base')` present. (Room `Sign Out` case is covered by updated `SatRoot.test.tsx`; do not duplicate.)

## Verification (exact commands: vitest paths, tsc, eslint, grep gates, contrast recompute)

Run from repo root, in order. Phase passes only if ALL succeed.

1. Scoped unit tests (new + touched suites):
```bash
npx vitest run src/products/sat/routes/__tests__/SatPhase02Copy.test.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx src/products/sat/__tests__/SatRoot.test.tsx src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
```
2. Full SAT suite (no collateral):
```bash
npx vitest run src/products/sat
```
3. Typecheck + lint + build:
```bash
npx tsc --noEmit
npx eslint src/products/sat/routes/SatResultsRoute.tsx src/products/sat/routes/SatResultDetailRoute.tsx src/products/sat/routes/SatExamLibraryRoute.tsx src/products/sat/routes/SatSessionsRoute.tsx src/products/sat/routes/SatSessionRoomRoute.tsx src/products/sat/SatRoot.tsx src/products/sat/routes/__tests__/SatPhase02Copy.test.tsx
npm run build
```
4. Copy grep gates (zero stale strings; each must print NO matches):
```bash
rg -n "Module identifiers as delivered" src/products/sat/routes/ || echo "GATE PASS: jargon gone"
rg -n 'text-\[8px\]' src/products/sat/routes/SatResultsRoute.tsx src/products/sat/routes/SatResultDetailRoute.tsx || echo "GATE PASS: no 8px on touched result routes"
rg -n 'placeholder="Search (exams|sessions|results|students)"' src/products/sat/routes/ || echo "GATE PASS: placeholders rescoped"
rg -n '>Clear search<|label: .Sign out.|aria-label="Sign out"|name: .New SAT.|>New SAT<|title="New SAT"' src/products/sat/routes/ src/products/sat/SatRoot.tsx || echo "GATE PASS: Title-Case + Create SAT applied"
rg -n "Practice · Practice|· Practice ·" src/products/sat/routes/SatResultsRoute.tsx || echo "GATE PASS: duplicate caption gone"
```
5. No-scope-leak gates (must print NO matches — proves copy-only):
```bash
git diff --name-only | rg -v "plans-sat-remediation/phase-02|src/products/sat/(routes/Sat(ResultsRoute|ResultDetailRoute|ExamLibraryRoute|SessionsRoute|SessionRoomRoute)\.tsx|SatRoot\.tsx|routes/__tests__/(SatPhase02Copy|SatResultsRoutes|SatExamLibraryRoute|SatSessionsRoute)\.test\.tsx|__tests__/SatRoot\.test\.tsx)" || echo "GATE PASS: file scope clean"
git diff -- src/features/student-delivery src/ | head -5 || echo "GATE PASS: no .sat-ui / student diff"
rg -n "#[0-9a-fA-F]{3,6}" src/products/sat/routes/SatResultsRoute.tsx src/products/sat/routes/SatResultDetailRoute.tsx src/products/sat/routes/SatExamLibraryRoute.tsx src/products/sat/routes/SatSessionsRoute.tsx src/products/sat/routes/SatSessionRoomRoute.tsx | rg -v "var\(--sat-staff" || echo "GATE PASS: no new hex literals"
```
6. Contrast: recompute NOT required for this phase (no color/token change). State in the phase report: "contrast table carried over from Phase 01; new placeholders inherit tertiary #6e6e73 (5.07:1 PASS); deletions remove text, add none."
7. a11y e2e (deferred to Phase 06 per overall plan, but run if green): `npm run e2e:sat-a11y` or documented equivalent.

## Definition of done (checklist, measurable)

- [ ] `SatResultsRoute.tsx` L118 8px caption deleted; each result row contains exactly one status element (the pill); `rg 'text-\[8px\]'` on Results/ResultDetail routes returns zero matches.
- [ ] Four placeholders read exactly: `Search exam title` (Library) / `Search exam, cohort, institution` (Sessions) / `Search name, ID, exam, cohort` (Results) / `Search name, ID, email` (Room); old placeholder strings return zero matches.
- [ ] Empty-state CTAs read exactly `Clear Search` (Library, Sessions); `Clear search` returns zero matches in `src/products/sat/routes/`.
- [ ] `SatRoot.tsx` exposes `Sign Out` (icon `aria-label` + menu item) and zero `Sign out` strings; `id: 'signout'` unchanged; logout behavior verified by updated `SatRoot.test.tsx`.
- [ ] Exam creation reads exactly `Create SAT` in all three Library sites (header, empty-state, dialog title); `New SAT` returns zero matches in `src/products/sat/routes/`.
- [ ] `"Module identifiers as delivered."` returns zero matches in `src/`; module `dl` scores + accessible names still render (new test case 5 green).
- [ ] No layout/class/token/behavior change: `git diff` on source touches ONLY the 6 files × listed lines; no `.sat-ui` diff; no new hex; filter/sort/poll/dialog/focus logic byte-identical outside the listed lines.
- [ ] Tests: full `npx vitest run src/products/sat` green (incl. new `SatPhase02Copy.test.tsx` 5 cases + rewritten caption/jargon assertions); `tsc --noEmit`, scoped `eslint`, and `npm run build` green.
- [ ] E2e note recorded: `e2e:sat-a11y` run in Phase 06 (or green now with log attached).
