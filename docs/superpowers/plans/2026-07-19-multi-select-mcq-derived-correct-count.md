# Multi-Select MCQ Derived Correct Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make marked-correct `MULTI_MCQ` options determine the authoring rule, student selection limit, grading key, and export count while preserving real submitted option IDs.

**Architecture:** Add one public utility for Multi-Select MCQ answer-key derivation and safe edits. Keep `requiredSelections` as a synchronized compatibility projection, but migrate behavioral consumers to the marked-correct count so old mismatched drafts cannot create grading or export drift.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, jsPDF grading export.

---

### Task 1: Add the Multi-Select MCQ answer-key seam

**Files:**
- Create: `src/utils/multiSelectMcq.ts`
- Create: `src/utils/__tests__/multiSelectMcq.test.ts`

- [ ] **Step 1: Write one failing domain test** asserting that marked option IDs determine the effective selection count despite a stale `requiredSelections` value.
- [ ] **Step 2: Run** `npm test -- --run src/utils/__tests__/multiSelectMcq.test.ts` and confirm the missing utility causes RED.
- [ ] **Step 3: Implement** `getMultiSelectCorrectOptionIds`, `getMultiSelectCorrectCount`, and `getMultiSelectSelectionLimit`; the limit is the marked count with a safe minimum of one.
- [ ] **Step 4: Run the focused test** and confirm GREEN.
- [ ] **Step 5: Add one failing test** for `setMultiSelectOptionCorrectness`: it synchronizes `requiredSelections` and refuses to clear the final correct option.
- [ ] **Step 6: Implement the immutable edit helper**, then rerun the focused test to GREEN.

### Task 2: Update Builder authoring surfaces

**Files:**
- Modify: `src/components/blocks/MultiSelectMCQBlock.tsx`
- Create: `src/components/blocks/__tests__/MultiSelectMCQBlock.test.tsx`
- Modify: `src/features/builder/utils/answerKeyOverview.ts`
- Modify: `src/features/builder/utils/__tests__/answerKeyOverview.test.ts`

- [ ] **Step 1: Write one failing component test** proving the Required Correct select is absent and clearing the final marked option emits no invalid block.
- [ ] **Step 2: Run the focused component test** and confirm RED against the existing dropdown/unchecked behavior.
- [ ] **Step 3: Replace local correctness mutation** with `setMultiSelectOptionCorrectness`, remove the dropdown, and display the derived marked-correct count.
- [ ] **Step 4: Rerun the component test** and confirm GREEN.
- [ ] **Step 5: Write one failing answer-key utility test** proving `set_multi_mcq_correct` keeps at least one correct option and synchronizes `requiredSelections`.
- [ ] **Step 6: Route the answer-key edit through the domain utility**, then rerun the test to GREEN.

### Task 3: Derive student selection and numbering from the answer key

**Files:**
- Modify: `src/components/student/QuestionRenderer.tsx`
- Modify: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- Modify: `src/utils/examUtils.ts`
- Modify: `src/utils/__tests__/examUtils.questionCounting.test.ts`
- Modify: `src/services/examAdapterService.ts`
- Modify: `src/services/__tests__/examAdapterService.studentQuestions.test.ts`

- [ ] **Step 1: Write one failing student behavior test** with two marked-correct options and stale `requiredSelections: 4`; assert only two options can be selected and the answer callback receives the real two option IDs.
- [ ] **Step 2: Run the focused student test** and confirm RED.
- [ ] **Step 3: Use `getMultiSelectSelectionLimit` in the renderer**, preserving the existing ID-array answer contract; rerun to GREEN.
- [ ] **Step 4: Write one failing counting/descriptor test** proving marked-correct count overrides stale `requiredSelections`.
- [ ] **Step 5: Use the derived count** in canonical question counting and adapter descriptors; rerun both focused suites to GREEN.
- [ ] **Step 6: Update MULTI_MCQ validation** to require at least one marked option without requiring equality to an independently authored count; run the validation/count tests.

### Task 4: Guard grading and export behavior

**Files:**
- Modify: `src/components/admin/__tests__/gradingAnswerUtils.test.ts`
- Modify: `src/utils/examTextExport.ts`
- Modify: `src/utils/__tests__/examTextExport.test.ts`
- Modify: `src/components/admin/__tests__/gradingReviewUtils.test.ts`

- [ ] **Step 1: Add a grading regression case** with stale `requiredSelections` and assert the exact submitted ID set is compared against `option.isCorrect` IDs.
- [ ] **Step 2: Run the focused grading test**; if already GREEN, retain it as a characterization/memory artifact.
- [ ] **Step 3: Add a failing text-export test** proving question slots and answer text follow the marked options rather than stale `requiredSelections`.
- [ ] **Step 4: Update text export to use the shared utility**, then rerun to GREEN.
- [ ] **Step 5: Add a grading review/export-row regression** asserting real student answer text and correct option text survive into the PDF input model; run the focused test.

### Task 5: Document and verify

**Files:**
- Modify: `docs/failure-cases.md`
- Modify: `docs/architecture/builder-answer-key-overview.md`
- Modify: `docs/architecture/grading-export.md` only if the PDF row contract changes

- [ ] **Step 1: Record the drift failure case**: `requiredSelections` could disagree with `option.isCorrect`, causing builder, student limits, numbering, and exports to diverge.
- [ ] **Step 2: Document marked options as authoritative** and `requiredSelections` as compatibility projection.
- [ ] **Step 3: Run targeted Vitest suites** for the domain utility, builder, student renderer, counting/adapter, grading, and export.
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint`, and `npm run build`; report any pre-existing or new failures separately.
- [ ] **Step 5: Review the final diff** for submitted-answer immutability, append-only audit invariants, unrelated changes, and duplicated derivation logic.
