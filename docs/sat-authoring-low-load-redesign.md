# SAT Authoring — Low Cognitive Load Redesign
Goal: author one SAT question with minimum working memory, minimum clicks, zero mode confusion.
Method: infinite-parameter-model (architect + domain + implementer + critic + adversary + verifier) × cognitive-load-conversion. Prototype: docs/sat-authoring-low-load-redesign.html

## 1. Load budget (the law)
Per question, visible at once: **≤7 interactive elements, 1 primary action, 1 status line.**
- Primary action everywhere: **Save & next →**. Everything else secondary/ghost/automatic.
- Status in exactly 2 places, same component: topbar pill + sticky footer line. No third copy.
- Errors: **one banner max** above the canvas ("N things stop this question…"), each row with a Go button. No scattered red dots to decode.
- Counts: today ~46 raw controls across surfaces compete on sight; target ≤12 on first paint, rest behind numbered steps already in view (scroll, not tabs).

## 2. IA: one column, reading order, numbered steps
Replace prompt-first + inspector-tabs with 5 numbered steps in SAT-cognitive order:
1. **What students read first** (stimulus; collapsible; starters only when empty; no "N/A" placeholder hacks)
2. **The actual question** (stem; 1-sentence hint; live search-preview note)
3. **Answer — pick the key** (single radio-card surface; clicking IS grading key; SPR variant keeps primary+equivalents but same step)
4. **File it so it's findable** (Domain ▾ / Skill ▾ dependent / Difficulty 3-radio / Pretest; pre-filled from previous question — "carry filing")
5. **Why the key is right** (rationale + alt/long-desc; visible, marked internal · shown at review — never in a disclosure)

Why: numbers offload sequencing from memory; reading order matches student cognition (stimulus→stem), killing the prompt-first confusion; rationale visible at review-time prevents late rework.

## 3. Kill the three confusions (biggest load wins)
- **C1 — Two answer-key editors (canvas + inspector) → ONE.** Inspector Answer tab becomes read-only summary + "Go to answer" anchor. List A–D becomes status display. Effort: S. Load saved: removes "which one is real?" decision on every question.
- **C2 — Build/Issues mode swap destroys navigation → Issues becomes a filter + right-rail Checks tab.** Left list never unmounts. Banner count in topbar seg (Write/Checks) only. Effort: M. Load saved: no context loss, no re-orientation per validation cycle.
- **C3 — Three previews (drawer/route/release) → ONE live renderer, two placements.** Right-rail "Student view" tab (same ExamQuestionRenderer) + wide-screen split pin. Delete QuestionQuickPreview drawer concept. Full-exam preview route relabelled "Full exam preview". Effort: M.

## 4. Defaults > decisions (-one click per question compounds over 148)
- Carry filing ON by default: Domain/Skill/Difficulty inherit from previous question in module; UI shows "was: X · changed" provenance, one click to accept-all (do nothing) — replaces per-question triple-dropdown grind.
- R&W locks response type to MCQ (rule already validated: sat.rw.question_type) — hide the type switcher in R&W instead of showing-then-erroring. Math shows MC/SPR segmented once.
- Choice composers get minimal toolbar (B/I/math only); full toolbar only on stimulus/stem. Prevents broken-table-in-choice errors at author time.
- Image insert requires alt text in-dialog (validation sat.media stays as backstop). SPR composer shows the %, $, comma rule inline (already in help text — promote to placeholder + live check, already built).
- Empty module slots collapse to one "+ Add (N remaining)" row (today: N dashed buttons = N visual items for zero information).

## 5. Progressive disclosure map (what hides, where, and its trigger)
| Surface | Shows first | Hides until | Trigger |
|---|---|---|---|
| Canvas steps 1–5 | All headers + current-step body | Step bodies below the fold | Scroll (not tabs) — position memory is cheaper than tab memory |
| Step 1 starters | Only when stimulus empty | — | Emptiness (paired texts / student notes / data table) |
| Step 4 details | Domain/Skill/Difficulty row | Tags + Pretest + capacity note | "More filing options" expander |
| Footer | Save-state + Save & next | Duplicate / Delete / shortcuts | "•••" overflow; shortcuts in ? sheet |
| Left list | Module progress + status chips | Bulk toolbar | ≥1 selection; adds "Select all needs-work" |
| Import | Single Add ▾ menu | Paste mapping preview / workbook metrics | Chosen path (paste vs workbook vs sample) |
| Shortcuts | ⌘↵ + ⌘1–4 hints inline | Full map | ? dialog |

## 6. Language (UX writing fixes — cheap, high-load-reduction)
- "Supporting material" → "What students read first". "Question prompt" → "The actual question". "Student-produced response" → "Grid-in answer (SPR)". "Carry metadata" → "Carry filing to next". "Needs work/Errors" chips → verb-first: "Needs key", "Needs stem", "Missing alt text".
- Validation messages → action-first + location: "Pick one choice below — grading is blocked until then. [Go]" (replaces code-like "sat.choice.key.required").
- Save states → calm past-tense: "Saved · 10:42" / "Saving…" / "Paused — offline, kept on this device (3)". Never "Not saved" alone — always with Retry.

## 7. Visual calm (2026 soft-minimal on existing au-* tokens)
- Canvas max-w 940→760px (student line-length fidelity doubles as load reduction: shorter lines scan faster).
- Section number discs: 26px, fill; done=green ✓, attention=red !, todo=neutral numeral. Status readable without reading.
- Choice cards: radio semantics, 30px letter tiles, selected = green ring + "KEY" tag. One glance = key confidence.
- Motion: keep authoringMotion springs; REMOVE layout animation on choice cards while typing (jitter = extraneous load); animate selection/completion only. Honor reduced-motion everywhere incl. skeleton/shimmer.
- No new palette. Chips always icon+text, never color-alone (fixes role="img" dot issue).

## 8. A11y as load reduction (same work, both win)
- Segmented single-selects → radiogroup/radio + aria-checked (Build/Checks, response type, difficulty, filters). Tabs in rail → real tablist.
- Answer key radiogroup labelled "Correct answer, Question 14"; options "Choice B: <text>".
- longDescription field currently has NO UI — add to step 5 (dead model field = hidden rework risk).
- After Save & next: focus stem of Q(n+1) + announce "Question 15 of 27". After delete: focus fallback row. Esc always returns focus to list row.
- Touch: all row actions ≥24px, always visible on coarse pointers + :focus-visible (extend existing max-[900px]:opacity-100 rule).

## 9. Mobile (<900px): same order, stacked
Single column = steps 1–5; navigator + rail become sheets (keep current infra); footer Carry-filing visible (fix hidden sm:flex bug); preview = bottom sheet with handle; shortcuts replaced by visible buttons (shortcuts disabled while editing today = 95% of mobile time has no accelerators).

## 10. Build slices (each shippable, each lowers load alone)
- S1 (S): single answer-key surface — inspector tab → summary+anchor; list A–D → status. Tests: QuestionEditor/InspectorPane/ListPane suites.
- S2 (S): step-4 inline filing + carry-by-default + R&W type lock. Tests: QuestionProperties, satProvider rw-type rule.
- S3 (M): no mode swap — Checks tab in rail + list filters; banner component. Tests: AuthoringWorkspace mode tests will need updating (flag it).
- S4 (M): preview unification — rail Student view, retire drawer; relabel route. Tests: QuickPreview suite retires into rail test.
- S5 (S): row redesign (chips, keydot, collapsed empties) + composer toolbar tiers + alt-required dialog + longDescription UI.
- S6 (S): Add ▾ unified menu; paste mapping preview reusing workbook metrics pattern.
Order by load-per-effort: S1 → S2 → S5 → S3 → S4 → S6.

## 11. What we deliberately did NOT add
No AI autofill, no new fields, no model/API/validation-rule changes, no new deps. Autosave durability (useQuestionAutosave + durableDraftStore, 800ms, offline queue) stays untouched — only its surfacing unifies. Six-module blueprint UI stays — navigator adopts StructurePane progress language.
