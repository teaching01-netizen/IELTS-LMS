# P3.1 — Renderer-to-answer contract table (2026-09-12)

Inventory of every answer-control call site in the supported question renderers,
per [phase-03-controls-navigation.md](phase-03-controls-navigation.md) P3.1.
Owners: `QuestionRenderer.tsx` (all in-file render helpers), `TableCompletionSlotCell.tsx`,
`SubAnswerTreeQuestionList.tsx`, wired by `StudentQuestionBlockSection.tsx`.

Shared invariants (hold for every row below):

- **Display numbers ≠ answer identity.** Numbers come from `slotNumbers`/`numberLabel`
  (display only); answers are keyed by `answerKey` (scalar) or `slotIds[index]` (array slot).
  Grouped scoring slots share `rootId::…::group::…` for navigation dedupe but keep
  per-leaf slot IDs for answers.
- **One mutation path.** Scalar families call `commitAnswerChange(value)`; array families
  call `updateIndexedAnswer(index, value, slotCount, slotId)`. Both forward
  `StudentAnswerMutationMeta` (slotId/slotIndex/slotCount/interactionType) and mirror into
  the live-answer registry (`registerLiveAnswer`). No renderer writes answers directly.
- **Cardinality.** Scalar = one value per answer key. Array = fixed-length string array of
  `slotCount`; empty slot is `''`. Multi-MCQ = string array with `arrayUpdateMode: 'replace'`.
- **Empty-value representation is `''`** everywhere; selects use the `ProtectedExamSelect`
  clear action mapped to `''` (no magic strings in authored-ID space).
- **Flag/elimination state is separate from answer state** and never changes the answer.

| Family (block type) | Renderer | Control | Displayed label | Persisted value | Answer key | Slot ID | Slot number | Empty | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TFNG / YNNG | `renderTFNG` | Native radio group (`ProtectedChoiceInput`-compatible markup; native input kept per P3.2.2) | `TRUE`/`FALSE`/`NOT GIVEN`, `YES`/`NO`/`NOT GIVEN` | Option key `T`/`F`/`NG`, `Y`/`N`/`NG` | `q.id` (descriptor answerKey) | question root id | `number` | none (radio) | scalar |
| CLOZE | `renderCloze` | `ProtectedInput` text | prompt | string | block answerKey | question id | `number` | `''` | scalar |
| MATCHING (headings) | `renderMatching` | `ProtectedExamSelect` (P3.3) | `i.`–`x.` + heading text (roman = persisted value, label is display) | roman `i`–`x` | descriptor answerKey | question id | `number` | `''` via clear action | scalar |
| MULTI_MCQ | `renderMultiMCQ` | Native checkbox group, sr-only inputs + visual box | `A.` + option text | string array of option IDs | block answerKey | block id | `blockNum` | `[]` | bounded array (limit = correct count; see P3.2.3) |
| MAP (diagram labels) | `renderMap` | `ProtectedInput` per label | label text | string in array | block answerKey | `slotIds[i]` ?? `mapId:labelId` | `slotNumbers[i]` ?? `number+i` | `''` | array |
| SINGLE_MCQ | `renderSingleMCQ` | Native radio group; eliminate toggle as sibling button (P3.2.2) | `A.` + option text (+ optional option figure) | option ID | descriptor answerKey (question-level options win over block-level) | question id | `number` | none (radio) | scalar |
| SHORT_ANSWER | `renderShortAnswer` | `ProtectedInput` text | prompt | string | descriptor answerKey | question id | `number` | `''` | scalar |
| SENTENCE_COMPLETION | `renderSentenceCompletion` | Inline `ProtectedInput` + inline flag | sentence text with blanks | string in array | block answerKey | `slotIds[i]` ?? `qId:index` | `slotNumbers[i]` ?? `number+i` | `''` | array |
| NOTE_COMPLETION | `renderNoteCompletion` | Inline `ProtectedInput` + inline flag | note text with blanks | string in array | block answerKey | `slotIds[i]` ?? `noteId:index` | `slotNumbers[i]` ?? `number+i` | `''` | array |
| TABLE_COMPLETION | `renderTableCompletion` + `TableCompletionSlotCell` | `ProtectedInput` in cell (+ flag in cell footer) | header/cell text | string in array | block answerKey | `slotIds[i]` ?? `tableId:cellId` (coordinate dedupe for shared cells) | `slotNumbers[i]` ?? `number+i` | `''` | array |
| CLASSIFICATION | `renderClassification` | `ProtectedExamSelect` per item (+ flag) | category string | category string | block answerKey | `slotIds[i]` ?? `blockId:itemId` | `slotNumbers[i]` ?? `number+i` | `''` via clear action | array |
| MATCHING_FEATURES | `renderMatchingFeatures` | `ProtectedExamSelect` per feature (+ flag) | option string | option string | block answerKey | `slotIds[i]` ?? `blockId:featureId` | `slotNumbers[i]` ?? `number+i` | `''` via clear action | array |
| Sub-answer trees | `SubAnswerTreeQuestionList` | `ProtectedInput` per leaf (+ per-leaf flag) | leaf `numberLabel`/root number | string | leaf slot id (`leaf.id`) | leaf id | `numberLabel` ?? root number | `''` | scalar per leaf |
| Flow-chart completion | in-file flow chart helper | `ProtectedInput` + flag | step text | string in array | block answerKey | `slotIds[i]` ?? `flowChartId:stepId` | `slotNumbers[i]` ?? `number+i` | `''` | array |

### Selects: value/label discipline (P3.1 requirement)

`ProtectedExamSelect` option values are stable IDs: roman numerals for MATCHING headings,
authored category/option strings for CLASSIFICATION/MATCHING_FEATURES. Duplicate display
labels are legal and never used as identity (covered by
`ProtectedExamSelect.test.tsx` "selects by ID, not label").

### Display-number sources

- `slotNumbers` is supplied by `StudentQuestionBlockSection` from
  `descriptor.rootNumber ?? blockStartQ + index` and tolerates duplicates via the
  `hasDuplicateSlotNumbers` flag (affects aria suffixes only).
- Navigator/sheet labels come from `getQuestionNumberLabel` through the shared view model
  (`studentQuestionNavigation.ts`) — the same labels students see in chips.

### Metadata preservation

`commitAnswerChange`/`updateIndexedAnswer` meta is unchanged by the P3.3 select migration:
`onValueChange(value)` maps 1:1 to the previous `event.target.value`. `answerCommands.test.ts`
pins mutation-ID stability downstream.

---

# P3.2 — Row-geometry audit (2026-09-12)

Audit of every answer row against the four P3.2 sub-requirements. Fixes applied the same
pass; each finding lists its evidence and test.

## P3.2.1 — Number/content/flag grid with reserved flag space

| Family | Layout | Verdict |
| --- | --- | --- |
| Inline blanks (sentence/note) | flag inside the blank pill, pill wraps as a unit | OK — flag never separates from its blank |
| Table cells | dedicated footer row `flex flex-wrap items-center gap-2` holds all flags | OK — flags reserve their own row, never squeeze cell text |
| Classification rows | `md:flex-row md:items-center`, text `md:flex-1`, flag `flex-shrink-0` (shared `renderFlagButton`) | OK |
| Matching features / headings | flag after the select, `flex-shrink-0` | OK |
| Sub-answer tree leaves | flag after input in `flex items-center gap-3` — **was missing `flex-shrink-0`** | **Fixed** (see P3.2.2) |

## P3.2.2 — Full-row hit targets; flag/elimination outside label activation

- **Eliminate/restore toggle** (SINGLE_MCQ) sits outside the option `<label>` — correct
  activation separation — but was a `px-2 py-1 text-xs` text button, far below the 44px
  floor. **Fixed:** joins the `student-touch-target` contract, so the shell-wide
  touch-mode rule (min 2.75/3rem, `index.css`) sizes it like every other control.
- **Shared flag button** (`renderFlagButton`): 40×40 circle, lifted to 44/48px by the
  same touch-mode rule; always a sibling of inputs/selects, never inside their labels. OK.
- **Tree leaf flags:** kept their own 36/32px sizing but could compress when long leaf
  prompts wrapped, shrinking the hit area. **Fixed:** `flex-shrink-0` added
  (`SubAnswerTreeQuestionList.test.tsx` 'keeps the leaf flag button from compressing').
- TFNG/Y/N/NG keeps native radios per the plan's P3.2.2 intent (full-row label hit).

## P3.2.3 — Multi-select limits: explained, never silently discarded

The `MULTI_MCQ` limit (derived from `requiredSelections`) silently blocked extra clicks:
the visual counter existed but was not programmatically associated with the options, and
`disabled` options left the limit undiscoverable. **Fixed:**

- the counter is now an `aria-live="polite"` status node referenced by every option via
  `aria-describedby`, so each option announces `n/limit required`;
- at the limit the status explains the remedy: `"limit reached. Deselect an option to
  choose another."` — announced live and readable on focus;
- options keep the disabled-state cap (the value cannot exceed the limit), so no click is
  *discarded* — it is refused with an explanation.

Test: `StudentQuestionExperience.test.tsx` 'explains the multi-select limit instead of
silently discarding (P3.2.3)'.

## P3.2.4 — Shared typography/focus; overflow without clipping

- **Inline blanks used `text-sm`** while every other control family used the
  `--student-control-font-size` token — inconsistent glyph metrics between a blank and
  its surrounding sentence. **Fixed:** inline blanks now use
  `text-[length:var(--student-control-font-size,1rem)]`
  (test: 'sizes inline passage blanks with the shared control typography token').
- Multi-MCQ counter also moved from a raw `text-[length:var(--student-meta-font-size)]`
  to the fallback-bearing form `var(--student-meta-font-size,0.875rem)`.
- Focus: every text/select control keeps the shared
  `focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/25` recipe;
  buttons route through the shell-wide `student-touch-target`/`.exam-control` focus rules. OK.
- Overflow: text containers use `break-words`/`whitespace-pre-wrap` (`FormattedText`) and
  long tokens wrap; inputs shrink via `min-w-0` inside `flex` rows; nothing clips — the
  classification/table grids verified above degrade to column layout in compact panes. OK.
