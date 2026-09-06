# Frontend Rewrite Behavior Map — per component, both lineages (tests as spec)

> Purpose: what the rewrite must reproduce in the React SPA, **per component/feature**, so the team ports *features* instead of *files*.
> Method: behavior is read from the test suites themselves (Vitest + Playwright) — each component lists its behaviors with the suite(s) that pin them and the component file. Verified 2026-09-04.
> Lineages (same as `docs/backend-rewrite-map.md`):
> - **epic** = local `main` @ `9b4414a` (IELTS + SAT; V2 durability). Files read on disk.
> - **fork** = `origin/main` @ `6671ad1` (IELTS + **ACT**; ACT Science; parallel student/admin refactor). Files read via `git show origin/main:<path>`.
> Anchor notation: `component: src/…` / `suite: src/…/X.test.tsx`. Where a suite exists on both lineages with the same basename, we say **shared**; behavior deltas between the two versions are called out (measured line-by-line).
> Companion: `docs/backend-rewrite-map.md` (backend behavior, both lineages) and `invariant1.md` (BEX/FEX contract matrix on the epic).

## 0. Evidence summary (what differs, what is shared)

| Area | Suites epic | Suites fork | Verdict |
|---|---|---|---|
| `src/components/student` | 92 | 92 | ~91 shared suites, behaviorally near-identical (title diffs 0–5 lines/suite). fork adds **StudentScience**; epic adds **StudentAttemptProvider.v2**. |
| `src/components/admin` | 24 | 25 | ~23 shared. fork adds **AdminExams.act**, **AdminResults**; epic adds **AdminExams.empty-state**. Shared grading suites differ only in ACT-Science cases. |
| `src/features/builder` | 20 | 20 | 19 shared. epic adds **useBuilderAutosave.durability**; fork adds **ActScienceConfigTabs**. |
| `src/features/exam-authoring` | 34 | small | **Different architectures** (epic = SAT authoring shell; fork = hexagonal IELTS/ACT exam management). Not directly comparable — see §4. |
| `src/features/proctor` | 4 | 4 | Same 4 suites; controller suites identical, backend-hybrid suite differs in 2 expectations (§5). |

Product surface of the builder (per product owner): **IELTS** (epic `features/builder`), **SAT** (epic `features/exam-authoring`), **ACT** (fork builder + ACT Science components). The rewrite must merge all three into one authoring product.

---

## 1. Builder — one product surface, three exam families

### 1.1 IELTS builder (shared, both lineages)
- Components: `features/builder/components/` — exam config tabs (`ExamConfigTabs`, `BasicInfoTab`, `ModulesTab`, `TimingTab`), publish surface (`PublishActions`, `PublishConfirmationModal`), `SecurityTab`, `ValidationSummary`, answer-key routes (`ExamAnswerKeyRoute`, `ExamReviewRoute`, `ExamConfigRoute`, `ExamPreviewRoute`), `BuilderRoot`.
- Behaviors pinned by suites (identical 11-case `PublishActions.test`, `SecurityTab`, `ValidationSummary`, `ExamConfigRoute.error-retry`, `ExamAnswerKeyRoute.error-retry`, `BuilderRoot.review-navigation`, `ExamPreviewRoute`, `answerKeyOverview`, `builderStateRecovery`, `previewRuntimeSessionService`):
  - publish flow with confirmation modal and error/retry states; answer-key overview; config/review/preview route guards with error-retry.
  - preview schedules run through `previewRuntimeSessionService` (preview runtime ≠ real proctor runtime; backend checks `is_preview_runtime_schedule`).
- Hooks: `useBuilderRouteController`, `useConfigRouteController`, `useReviewRouteController`, `useLazyVersionLoad`, `useBuilderAutosave` (shared). **Epic-only**: `useBuilderAutosave.durability` — *“staff builder draft durability laws: restores a locally committed edit after the editor process dies before debounce; keeps the recovery draft after a server revision conflict and clears it only after acknowledgement.”* (suite: `features/builder/hooks/__tests__/useBuilderAutosave.durability.test.tsx`)

### 1.2 SAT authoring (epic-only)
- Surface: `features/exam-authoring/ui/` — `AuthoringWorkspace`, `QuestionEditor`, `QuestionListPane`, `StructurePane`, `QuestionInspectorPane`, `QuestionPaper`, `ModuleScopePicker`, `QuestionProperties`, `QuestionMetadataBar`, `SatStudentResponseEditor`, `SatDeliveryReleasePage`, `SatAuthoringStateSurfaces`, `SampleExamLoadDialog`, `AuthoringSegmented`, `SaveStatusIndicator`, `QuestionQuickPreview`, access-links (`AccessLinkEditorSheet`, `AccessLinkShareSheet`, `StudentLinksDashboard`), workbook undo banner, `authoringPrimitives`/`authoringMotion`.
- Domain/templates: `features/exam-authoring/providers/sat/` (question/student-response content templates, sample exam, provider validation) and `features/exam-authoring/import/` (SAT workbook import + parser).
- Editor: `features/exam-authoring/editor/` (`RichQuestionComposer`, `EditableMathExtension`, rich-content schema).
- Behaviors pinned by epic suites (gates): `AuthoringDialog`, `AuthoringPaneResizer`, `ConfirmPopover`, `ModuleScopePicker`, `AccessLinkEditorSheet`, `RichQuestionComposer`, `EditableMathExtension`, `richContent`, `examQueries`, `questionImportParser`, `SatWorkbookImportSheet`, `useQuestionAutosave.durability/offline`, `providers/sat/{satProvider,sampleExam,contentTemplates,studentResponse}`, `assessmentMediaApi`, `routes/…/ProviderBuilderRoute.split`.
- Architecture: layered UI/contracts/api + providers (SAT). **The fork does not have this surface** (it predates SAT) — the fork’s `features/exam-authoring` is a different, hexagonal IELTS/ACT surface (§4.2). Rewrite must decide the canonical authoring shell and port SAT content/editor features into it.

### 1.3 ACT authoring (fork-only)
- Config: `src/constants/examDefaults.ts` — type `ACT`, preset `"ACT Science"`, `DEFAULT_ACT_EXAM_SUMMARY = "Standard ACT Exam"`; switching an untouched default config to ACT enables only the `science` section; a custom summary survives type switches; `normalizeModuleConfig(base.sections.science, …)`.
- Builder tab: `features/builder/components/…/ActScienceConfigTabs` — behaviors (suite `ActScienceConfigTabs.test`): hides IELTS-only Standards for ACT while keeping them for IELTS; exposes ACT as a type with Science section enabled; uses ACT summary defaults; shows only ACT Science module settings with a **40-question default**; renders **one continuous 40-minute Science section** and allows duration changes.
- Stimuli editor: `src/components/ActScienceWorkspace.tsx` + `ActScienceQuestionBuilderPane.tsx` (shared with student rendering via `StimulusPane`/`Workspace`): stimulus model `{id, title, content, blocks, images, wordCount}` (`createActScienceStimulus`, `createActScienceBlock`); multi-question blocks (`getBlockQuestionCount`); builder mutates `ExamState` through `setState`. Suites: `ActScienceWorkspace.test`, `ActScienceQuestionBuilderPane.test`.
- Admin creation: `AdminExams.act.test` — *“creates an ACT Science draft without changing the IELTS create options.”*

### 1.4 Builder product-switch law (union)
Same config machinery drives IELTS (defaults/band tables/standards/writing rubrics), SAT modules (epic), and ACT (science 40/40). The rewrite’s builder config schema must keep: per-type defaults, per-type section enablement, per-type hidden tabs/Standards, summary inheritance on type switch, and per-section module/duration presets (ACT: 40 questions, 40 min, single section).

---

## 2. Student experience (`src/components/student`)

### 2.1 Shell, phases & providers
- `StudentApp` (suite shared, epic 29 / fork 30 cases; fork adds *“renders ACT Science through the complete student app workspace”*) — orchestrates phases: pre-check → lobby → exam → post-exam (+ entry card, completion summary).
- Providers (components under `src/components/student/providers/`): `StudentAttemptProvider` (+ **epic-only** `.v2.test`: *“does not redirect a save into a replacement attempt while recovery is pending; does not let a refreshed legacy snapshot overwrite a visible V2 response; keeps preview attempts on local persistence even when the V2 flag is supplied”*), `StudentRuntimeProvider`, `StudentUIProvider` (+ highlight), `StudentProctoringProvider`, `StudentNetworkProvider`, `StudentKeyboardProvider`.
- Orchestration/policy: `useStudentSubmissionOrchestration` (shared, 4/4 identical), `useStudentAutoSubmitBoundary`, `blockingStateMachine` (+priority), `studentExamViewportPolicy`, `useStudentExamViewport`, `layoutMode`/`layout css`, `tabletMode`, `accessibilityScale`/`preferences`, `appleMobileDevice`, `prefersReducedMotion`, `timeExtensionPolicy`, `useStudentTranslationGuard`, `useStudentWarningVisibility`, `preCheckChecks`, `studentCapabilities`, `examPageZoomGuard`.

### 2.2 Question interaction workspace
- `StudentExamWorkspace`, `StudentExamShell`, `StudentMaterialWithQuestionPane`, split panes, zoomable media; question presentation: `QuestionRenderer`, `StudentQuestionExperience/Number/Callout/Css`, block-section layout, `SubAnswerTreeQuestionList`, `TableCompletionSlotCell`.
- Inputs: `ProtectedInput/Select/ChoiceInput` (copy/paste guards), `resolveObjectiveAnswerUpdate` (+`.slots`), `answerUndoRedoGuard`, writing area (`StudentWriting.*`: lifecycle/clipboard/undo/a11y — 13 cases identical on both lineages), listening (`a11y`, `PlaybackRate`), speaking (`a11y`), reading readability controls, stimulus readability controls, tool sheet, `useSplitPaneResize`, question navigator/writing-task navigator/compact navigation.
- Highlight engine: `RichTextHighlighter`, `HighlightableSurfaceDomStability`, highlight persistence (`highlightPersistence`, `StudentAppWrapperHighlightPersistence`, `studentHighlightToolContext`, `highlightSelectionManager.state`, `highlightSelectionPort`, `highlightV2Engine`, `StudentUIProviderHighlight`, `StudentHeaderHighlightHint`) — shared by both lineages.
- Header/footer/motion/accessibility CSS & interaction suites (`StudentInteractionMotion`, `StudentDialogCss`, `StudentFooterOverlayLayout`, `CompactStudentHeader`, `StudentSplitPaneCss`, `StudentViewportCss`, `StudentHighlightSelectionCss`, `StudentTranslationGuardCss`, `StudentQuestionCalloutCss`, `StudentTypingPerformance`, `studentLayoutCss`).

### 2.3 Proctoring & network UX
- `StudentProctorInterventions`, `StudentProctoringProvider`, `WarningOverlay`, `SubmitConfirmation`, `StudentNetworkProvider`/network states (backend publishes `schedule_alert` network events — see backend map §11), auto-submit boundary, `StudentExamPreview`, `StudentCompletionSummary`, `StudentPostExamView`.

### 2.4 ACT Science (fork-only) — `StudentScience`
Suite `StudentScience.test` pins: hides choice-elimination controls until a toolbar mode is enabled; one stimulus with one ACT Science question + four choices; select and replace an answer; eliminate/restore a choice **without changing the answer**; elimination limited to options **A–D** and hidden for non-ACT exams; eliminations **independent per question**; multiple questions under one stimulus with back-and-forth navigation; stimulus tables + annotated images open in the shared zoom view; PC-style text selection highlight persists on the stimulus. (Anchors: `src/components/student/StudentScience.tsx`, question/answer rendering shared with the epic reader components above.)

### 2.5 Cross-cutting client services (epic V2 vs shared)
- Shared mutation pipeline (both): `src/services/studentAttemptRepository*` (compaction, normalization, backend hybrid), `studentMutationOutbox*` (coalescence, conflicts, flushNow), `studentSessionTransport`, `studentIntegrityService.policy`, `studentAuditService`, `attemptCredentialAdapter`, `backendBridge`, `examDeliveryService`, `examLifecycleService` — these are the client halves of the backend v1/v2 protocols (backend map §7–§8).
- **Epic-only**: V2 durability client (attempt-lease/epoch handling + the `.v2` provider suite above). V2 is now structural; the former `VITE_USE_V2_DURABILITY_ENGINE` / `RESPONSE_DURABILITY_V2_ENABLED` rollout flags have no production consumers.

---

## 3. Admin grading & results (`src/components/admin`)

### 3.1 Review workspace (shared)
- `GradingSessionDetail` (+`printWriting`), `StudentReviewWorkspace` (`answers`/`printWriting`), `QuestionTracebackPanel`, `ObjectiveOverridesPanel`, `ExamObjectiveOverviewPanel`; util libs `gradingReviewUtils`, `gradingAnswerUtils`, `studentAnswerComparison`.
- Behaviors (shared suites): per-student review of answers vs. snapshot; question traceback w/ override support; objective overrides; print/writing review; **per-student exports**: zip/pdf generation with filename templates, objective table rows, writing PDF grids, export profiles & filters (`gradingPerStudent*`, `buildPerStudentZipPdfExportInput`, `ExportBuilderFilters`, `GradingExportButtons`, `gradingExportPlan`).
- Fork adds to shared suites only ACT-Science cases: *“shows only ACT Science with traceback details and supports answer overrides”*; *“adds ACT Science correct counts by skill category after total score; builds ACT Science CSV with labelled choices and per-question scores; calculates ACT Science category percentages from each category total”* (`StudentReviewWorkspace.answers.test`, `gradingReviewUtils.test`).
- Epic-only: `AdminExams.empty-state` — *“guides the first exam creation when the library is empty.”*

### 3.2 Admin scheduling / exam admin (shared)
`AdminScheduling`, `ExamBulkActionBar`, `ExamSettingsDrawer`, `ExamVersionHistory`, `AdminExams` core. Fork-only `AdminExams.act.test` (ACT Science draft creation), fork-only `AdminResults.test` — *“shows IELTS results and ACT Science reports from their shared backend grading data”* (frontend consumes `GET /api/v1/results/act-science` via `src/services/gradingService.ts` — backend map §18.4).

### 3.3 Grading backend coupling
The grading UI reads the worker **projection** read-models and uses release/review state machine endpoints (`features`/services call `/api/v1/grading/*` — backend map §4.13/§6.6). Science scoring is server-authoritative (seal-time `compute_act_science_score`, never client-supplied — backend map §18.3).

---

## 4. Exam-authoring surfaces (two architectures — decide one)

- **Epic (`features/exam-authoring`)** = SAT authoring shell (see §1.2): UI/contracts/providers layered, editor with math extensions, workbook import/undo, sample-load, access links, delivery release. Suites are the feature gate list.
- **Fork (`features/exam-authoring`)** = hexagonal slice for IELTS/ACT exam management: `api/examAuthoringBackendGateway|Facade`, `application/examAuthoringFacade`, `infrastructure/examAuthoringGateway|BackendGateway`, `contracts/examList`, `routes/ExamsRoute`, `ui/ExamList/ExamList`. Different file architecture, different route surface (`ExamsRoute`), no SAT.
- **Rewrite decision (open):** pick the epic authoring shell as the canonical editor and re-home the fork’s IELTS/ACT creation + list surface into it (recommended, preserves SAT investment), or rebuild around the fork’s facade layering and re-port SAT. Port the union of suite-verified behaviors: ACT Science draft creation + IELTS options intact (fork `AdminExams.act`), SAT module/adaptive authoring + workbook + editor math (epic suites §1.2), IELTS draft durability (epic `useBuilderAutosave.durability`).

---

## 5. Proctor session room (`src/features/proctor`)

- Suites (4, shared): `proctorQueries`, `useProctorRouteController` (2/2 identical), `.live-update` (2/2 identical), `.backend` hybrid (10 cases; **2 expectations diverge**): epic sends “the rendered runtime revision with cohort timing mutations”; fork “surfaces a failed runtime start instead of refreshing as if the exam started”.
- Controller responsibilities (cross-ref backend map §4.9/§6.4): roster & live session detail; cohort controls (end-section-now / extend-section / complete-exam) and per-student controls (warn / pause / resume / extend / terminate) via `/api/v1/proctor/*`; live roster refresh from websocket `schedule_roster`/`attempt` events (backend map §11); presence heartbeat.
- Render surface lives with admin/`components` and `e2e` Playwright (proctor monitor flows; note `e2e/TEST_STATUS.md` on the epic records selector drift on legacy monitor surfaces — verify against the rewritten UI).

---

## 6. Port guidance & gates

1. **Port features, not files.** For any shared-named component, the two implementations are near-identical (0–5 title lines differ) — diff them, keep one, re-add the ACT/V2 deltas listed above.
2. **Feature union checklist (frontend):** builder = IELTS + SAT + ACT (science 40q/40min single-section, per-type config rules); student = full shared workspace + ACT Science rendering + V2 durability client + ACT choice-elimination; admin grading = review/override/traceback + per-student exports + ACT Science reports/CSVs + IELTS results; exam-authoring = pick shell (§4); proctor = shared controller + fork’s failed-start surfacing + epic’s runtime-revision timing sends.
3. **Test gates:** rerun the *union* of suites: all shared suites (from whichever lineage you keep), plus fork-only (`StudentScience`, `AdminExams.act`, `AdminResults`, `ActScienceConfigTabs`, ACT cases inside shared suites), plus epic-only (`StudentAttemptProvider.v2`, `useBuilderAutosave.durability`, all SAT exam-authoring suites, `AdminExams.empty-state`), plus `e2e/` Playwright and backend contract suites referenced in the backend map.
4. **Types/API:** regenerate `src/types*` and service contracts from the rewritten backend; the two lineages’ `types/domain.ts` already diverge (both changed it) — the rewrite owns the single canonical version.
5. **Known gaps in this map:** student/admin component *interior* behavior was characterized from suite names/titles (hundreds of cases) rather than line-by-line reads; treat each listed suite as the exact gate. Deep per-component prose coverage is a follow-up if needed.

---

*End. Companion: `docs/backend-rewrite-map.md` (backend behavior, both lineages). Verified 2026-09-04 against epic `9b4414a` (disk) and fork `origin/main` `6671ad1` (`git show`).*
