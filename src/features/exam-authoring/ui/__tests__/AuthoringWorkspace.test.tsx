import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  QuestionRevision,
} from "../../contracts/assessment";

/* ------------------------------------------------------------------ */
/* Harness: controllable stand-ins for every store/query dependency.   */
/* ------------------------------------------------------------------ */

const harness = vi.hoisted(() => ({
  shellResult: {
    data: null as unknown,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  details: {} as Record<string, AssessmentQuestionDetail>,
  questionRefetch: vi.fn(),
  useAuthoringShell: vi.fn(),
  useExamQuestion: vi.fn(),
  useQuestionAutosave: vi.fn(),
  useOptionalAuthSession: vi.fn(),
  useCreate: vi.fn(),
  useBatchCreate: vi.fn(),
  useDuplicate: vi.fn(),
  useReorder: vi.fn(),
  useBulk: vi.fn(),
  useValidation: vi.fn(),
  useLoadSample: vi.fn(),
  autosave: {
    status: "saved",
    lastSavedAt: null as Date | null,
    isOffline: false,
    hasPendingChanges: false,
    scheduleAutosave: vi.fn(),
    flushNow: vi.fn(),
    commitAndAdvance: vi.fn(),
    retry: vi.fn(),
  },
  mutations: {
    create: vi.fn(),
    batchCreate: vi.fn(),
    duplicate: vi.fn(),
    reorder: vi.fn(),
    bulk: vi.fn(),
    validate: vi.fn(),
    loadSample: vi.fn(),
  },
  api: {
    getSatWorkbookUndoState: vi.fn(),
    getShell: vi.fn(),
    getQuestion: vi.fn(),
    saveQuestionRevision: vi.fn(),
    deleteQuestion: vi.fn(),
  },
}));

vi.mock("../../api/assessmentQueries", () => ({
  assessmentKeys: {
    shell: (examId: string) => ["assessment", examId, "shell"],
    release: (examId: string) => ["assessment", examId, "release"],
    readinessRoot: (examId: string) => ["assessment", examId, "readiness"],
    readiness: (examId: string, versionId: string, versionRevision: number) => [
      "assessment",
      examId,
      "readiness",
      versionId,
      versionRevision,
    ],
    question: (examQuestionId: string) => ["assessment-question", examQuestionId],
  },
  useAuthoringShell: (...args: any[]) => (harness.useAuthoringShell as any)(...args),
  useExamQuestion: (...args: any[]) => (harness.useExamQuestion as any)(...args),
  useCreateAssessmentQuestion: (...args: any[]) => (harness.useCreate as any)(...args),
  useBatchCreateAssessmentQuestions: (...args: any[]) =>
    (harness.useBatchCreate as any)(...args),
  useDuplicateAssessmentQuestion: (...args: any[]) =>
    (harness.useDuplicate as any)(...args),
  useReorderAssessmentQuestions: (...args: any[]) => (harness.useReorder as any)(...args),
  useBulkAssessmentQuestions: (...args: any[]) => (harness.useBulk as any)(...args),
  useAssessmentValidation: (...args: any[]) => (harness.useValidation as any)(...args),
  useLoadSatSampleExam: (...args: any[]) => (harness.useLoadSample as any)(...args),
}));

vi.mock("../../api/assessmentAuthoringApi", () => ({
  assessmentAuthoringApi: harness.api,
}));

vi.mock("../../hooks/useQuestionAutosave", () => ({
  useQuestionAutosave: (...args: any[]) => (harness.useQuestionAutosave as any)(...args),
}));

vi.mock("../../../auth/api/authSession", () => ({
  useOptionalAuthSession: (...args: any[]) =>
    (harness.useOptionalAuthSession as any)(...args),
}));

vi.mock("../../editor/richContent", () => ({
  hasStructuredContent: (content: any) => Boolean(content?.nodes?.length),
  plainTextFromContent: (content: any) =>
    (content?.nodes ?? []).map((node: any) => node.text ?? "").join(" "),
  supportsFastPlainEditing: () => true,
}));

vi.mock("../../providers/sat/satProvider", () => ({
  validateSatQuestion: () => [],
}));

/* ------------------------------------------------------------------ */
/* Light stand-ins for heavy children. Each one still propagates the   */
/* callbacks the workspace depends on.                                 */
/* ------------------------------------------------------------------ */

vi.mock("../QuestionEditor", () => ({
  QuestionEditor: (props: any) => (
    <div data-testid="question-editor">
      <span data-testid="editor-question-id">{props.question.id}</span>
      <span data-testid="editor-save-status">{props.saveStatus}</span>
      <button type="button" onClick={() => props.onSaveNow()}>
        Save now
      </button>
      <button type="button" onClick={() => props.onSaveAndNext()}>
        Save and next
      </button>
      <button type="button" onClick={() => props.onDuplicate()}>
        Duplicate question
      </button>
      <button
        type="button"
        onClick={() => {
          void props.onDelete();
        }}
      >
        Delete question
      </button>
      <button type="button" onClick={() => props.onChange({ ...props.question })}>
        Edit question
      </button>
      <button
        type="button"
        aria-pressed={props.keepMetadataForNext}
        onClick={() => props.onKeepMetadataForNextChange(!props.keepMetadataForNext)}
      >
        Keep metadata
      </button>
    </div>
  ),
}));

vi.mock("../QuestionListPane", () => ({
  QuestionListPane: (props: any) => (
    <section aria-label={`${props.module.title} questions`}>
      <input
        type="search"
        aria-label="Search questions"
        value={props.searchQuery}
        onChange={(event: any) => props.onSearchQueryChange(event.target.value)}
      />
      <span data-testid="list-filter">{props.filter}</span>
      {props.module.questions.map((question: any) => (
        <button
          key={question.examQuestionId}
          type="button"
          data-testid={`select-${question.examQuestionId}`}
          aria-pressed={props.selectedQuestionId === question.examQuestionId}
          onClick={() => props.onSelectQuestion(question.examQuestionId)}
        >
          {question.promptPreview || question.examQuestionId}
        </button>
      ))}
      <button type="button" onClick={() => props.onCreateQuestion()}>
        Create question
      </button>
      <button type="button" onClick={() => props.onFilterChange("ready")}>
        Filter ready
      </button>
    </section>
  ),
}));

vi.mock("../QuestionInspectorPane", () => ({
  QuestionInspectorPane: (props: any) => (
    <aside aria-label="Question inspector">
      <span data-testid="inspector-question-id">{props.question.id}</span>
      <span data-testid="inspector-section">{props.activeSection}</span>
      <button type="button" onClick={() => props.onSectionChange("answers")}>
        Inspector answers tab
      </button>
      <button type="button" onClick={() => props.onChange({ ...props.question })}>
        Inspector change
      </button>
      {props.onClose ? (
        <button
          type="button"
          aria-label="Close question inspector"
          onClick={() => props.onClose()}
        >
          Close inspector
        </button>
      ) : null}
    </aside>
  ),
}));

vi.mock("../QuestionQuickPreview", () => ({
  QuestionQuickPreview: (props: any) =>
    props.open ? (
      <div role="complementary" aria-label="Student question preview">
        <button type="button" onClick={() => props.onClose()}>
          Close preview
        </button>
      </div>
    ) : null,
}));

vi.mock("../SaveStatusIndicator", () => ({
  SaveStatusIndicator: (props: any) => (
    <div data-testid="save-status">{props.status}</div>
  ),
}));

vi.mock("../SampleExamLoadDialog", () => ({
  SampleExamLoadDialog: (props: any) =>
    props.open ? (
      <div role="dialog" aria-label="Load sample SAT">
        <button type="button" disabled={props.busy} onClick={() => props.onConfirm()}>
          Load 147 questions
        </button>
        <button type="button" onClick={() => props.onCancel()}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock("../../import/QuestionImportSheet", () => ({
  QuestionImportSheet: (props: any) =>
    props.open ? (
      <div role="dialog" aria-label="Paste or import SAT questions">
        <button
          type="button"
          onClick={() => {
            void props.onImport([]);
          }}
        >
          Import now
        </button>
        <button type="button" onClick={() => props.onClose()}>
          Close import
        </button>
      </div>
    ) : null,
}));

vi.mock("../../import/SatWorkbookImportSheet", () => ({
  SatWorkbookImportSheet: (props: any) =>
    props.open ? (
      <div role="dialog" aria-label="SAT workbook import">
        <button type="button" onClick={() => props.onClose()}>
          Close workbook
        </button>
      </div>
    ) : null,
}));

vi.mock("../WorkbookImportUndoBanner", () => ({
  WorkbookImportUndoBanner: (props: any) => (
    <div data-testid="workbook-undo">
      <button type="button" disabled={props.busy} onClick={() => props.onUndo()}>
        Undo Import
      </button>
    </div>
  ),
}));

vi.mock("../AuthoringPaneResizer", () => ({
  AuthoringPaneResizer: () => <div data-testid="pane-resizer" />,
}));

vi.mock("../../../../products/sat/ui/Menu", () => ({
  SatMenu: (props: any) => (
    <div data-testid="sat-menu">
      <button type="button" aria-label={props.label}>
        menu trigger
      </button>
      <div>
        {(props.items ?? []).map((item: any) => (
          <button key={item.id} type="button" disabled={item.disabled} onClick={item.onSelect}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ),
}));

import { AuthoringWorkspace } from "../AuthoringWorkspace";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function structuredText(id: string, text: string) {
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id, text }] };
}

function emptyContent() {
  return { version: 1 as const, nodes: [] as Array<{ type: "paragraph"; id: string; text: string }> };
}

function makeDraft(id: string, promptText: string): QuestionRevision {
  const option = (optionId: string, text: string) => ({
    id: optionId,
    content: structuredText(`opt-${optionId}-${id}`, text),
  });
  return {
    id,
    questionId: `q-${id}`,
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: emptyContent(),
    prompt: structuredText(`prompt-${id}`, promptText),
    answer: {
      kind: "single_choice" as const,
      options: [option("A", "First"), option("B", "Second"), option("C", "Third"), option("D", "Fourth")],
      correctOptionId: "A",
    },
    rationale: emptyContent(),
    metadata: {
      sectionKey: "reading-writing",
      domain: "Algebra",
      skill: "Linear equations",
      difficulty: "medium",
      tags: [],
    },
    accessibility: { longDescription: null },
  };
}

function makeSummary(
  examQuestionId: string,
  revisionId: string,
  promptPreview: string,
  status: "ready" | "incomplete" | "error",
): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId: `q-${revisionId}`,
    questionRevisionId: revisionId,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview,
    answerKeyPreview: "A",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: {
      status,
      blockingIssueCount: status === "error" ? 1 : 0,
      warningCount: 0,
    },
  };
}

function makeShell(summaries: AssessmentQuestionSummary[]): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v-1",
    versionRevision: 3,
    sections: [
      {
        id: "sec-rw",
        sectionKey: "reading-writing",
        title: "Reading & Writing",
        displayOrder: 0,
        durationSeconds: 3840,
        breakAfterSeconds: 0,
        revision: 1,
        routingPolicy: null,
        modules: [
          {
            id: "mod-1",
            moduleKey: "rw-m1",
            title: "Module 1",
            displayOrder: 0,
            durationSeconds: 1920,
            targetQuestionCount: 3,
            adaptiveRole: "base",
            toolPolicy: {},
            revision: 1,
            questions: summaries,
          },
        ],
      },
    ],
  };
}

function defaultShell(): AssessmentAuthoringShell {
  return makeShell([
    makeSummary("eq-1", "rev-1", "First prompt", "ready"),
    makeSummary("eq-2", "rev-2", "Second prompt", "error"),
  ]);
}

function defaultDetails(): Record<string, AssessmentQuestionDetail> {
  const first = makeDraft("rev-1", "First prompt");
  const second = makeDraft("rev-2", "Second prompt");
  return {
    "eq-1": {
      examQuestionId: "eq-1",
      moduleId: "mod-1",
      moduleKey: "rw-m1",
      sectionKey: "reading-writing",
      displayOrder: 0,
      isPretest: false,
      question: first,
    },
    "eq-2": {
      examQuestionId: "eq-2",
      moduleId: "mod-1",
      moduleKey: "rw-m1",
      sectionKey: "reading-writing",
      displayOrder: 1,
      isPretest: false,
      question: second,
    },
  };
}

function setupDefaults() {
  const shell = defaultShell();
  harness.details = defaultDetails();
  harness.shellResult = { data: shell, isLoading: false, error: null, refetch: vi.fn() };
  harness.questionRefetch.mockReset();
  for (const fn of [
    harness.useAuthoringShell,
    harness.useExamQuestion,
    harness.useQuestionAutosave,
    harness.useOptionalAuthSession,
    harness.useCreate,
    harness.useBatchCreate,
    harness.useDuplicate,
    harness.useReorder,
    harness.useBulk,
    harness.useValidation,
    harness.useLoadSample,
  ]) {
    (fn as any).mockReset();
  }
  for (const fn of Object.values(harness.mutations)) (fn as any).mockReset();
  for (const fn of Object.values(harness.api)) (fn as any).mockReset();
  const autosave = harness.autosave;
  for (const fn of [autosave.scheduleAutosave, autosave.flushNow, autosave.commitAndAdvance, autosave.retry]) {
    (fn as any).mockReset();
  }
  autosave.status = "saved";
  autosave.lastSavedAt = null;
  autosave.isOffline = false;
  autosave.hasPendingChanges = false;
  (autosave.flushNow as any).mockResolvedValue({ ok: true, isLatest: true });
  (autosave.commitAndAdvance as any).mockResolvedValue({ ok: true, isLatest: true });

  (harness.useAuthoringShell as any).mockImplementation(() => harness.shellResult);
  (harness.useExamQuestion as any).mockImplementation((id: string | null) => {
    if (!id) {
      return { data: undefined, isLoading: false, isPending: false, error: null, refetch: harness.questionRefetch };
    }
    const detail = harness.details[id];
    if (detail) {
      return { data: detail, isLoading: false, isPending: false, error: null, refetch: harness.questionRefetch };
    }
    return { data: undefined, isLoading: false, isPending: false, error: null, refetch: harness.questionRefetch };
  });
  (harness.useQuestionAutosave as any).mockImplementation(() => harness.autosave);
  (harness.useOptionalAuthSession as any).mockImplementation(() => ({
    session: { user: { id: "staff-1" } },
  }));
  (harness.useCreate as any).mockImplementation(() => ({ mutateAsync: harness.mutations.create, isPending: false }));
  (harness.useBatchCreate as any).mockImplementation(() => ({ mutateAsync: harness.mutations.batchCreate, isPending: false }));
  (harness.useDuplicate as any).mockImplementation(() => ({ mutateAsync: harness.mutations.duplicate, isPending: false }));
  (harness.useReorder as any).mockImplementation(() => ({ mutateAsync: harness.mutations.reorder, isPending: false }));
  (harness.useBulk as any).mockImplementation(() => ({ mutateAsync: harness.mutations.bulk, isPending: false }));
  (harness.useValidation as any).mockImplementation(() => ({ mutateAsync: harness.mutations.validate, isPending: false, data: null }));
  (harness.useLoadSample as any).mockImplementation(() => ({ mutateAsync: harness.mutations.loadSample, isPending: false }));

  (harness.mutations.create as any).mockResolvedValue({
    examQuestionId: "eq-new",
    question: makeDraft("rev-new", "Brand new prompt"),
  });
  (harness.mutations.duplicate as any).mockResolvedValue({
    examQuestionId: "eq-copy",
    question: makeDraft("rev-copy", "Copied prompt"),
  });
  (harness.mutations.reorder as any).mockResolvedValue({});
  (harness.mutations.bulk as any).mockResolvedValue({});
  (harness.mutations.batchCreate as any).mockResolvedValue({ createdQuestionIds: [], questions: [] });
  (harness.mutations.validate as any).mockResolvedValue({ valid: true, errors: [], warnings: [] });
  (harness.mutations.loadSample as any).mockResolvedValue(shell);

  (harness.api.getSatWorkbookUndoState as any).mockResolvedValue(null);
  (harness.api.getShell as any).mockImplementation(() => Promise.resolve(harness.shellResult.data));
  (harness.api.getQuestion as any).mockImplementation((id: string) =>
    Promise.resolve(harness.details[id] ?? null),
  );
  (harness.api.saveQuestionRevision as any).mockImplementation(() =>
    Promise.resolve(makeDraft("rev-saved", "Saved prompt")),
  );
  (harness.api.deleteQuestion as any).mockResolvedValue({});
}

function renderWorkspace(query = "?spine=0") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/sat/exams/exam-1${query}`]}>
        <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AuthoringWorkspace", () => {
  beforeEach(() => {
    setupDefaults();
  });

  it("renders the loading surface while the shell loads", () => {
    harness.shellResult = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
    renderWorkspace();
    expect(screen.getByRole("status")).toHaveTextContent("Opening SAT workspace…");
  });

  it("renders the error surface with retry when the shell fails", () => {
    const refetch = vi.fn();
    harness.shellResult = {
      data: undefined,
      isLoading: false,
      error: new Error("Shell unavailable"),
      refetch,
    };
    renderWorkspace();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to load the SAT authoring workspace",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders the workspace shell with navigator, editor, and inspector", async () => {
    renderWorkspace();
    expect(await screen.findByTestId("question-editor")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "SAT Practice 1" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 questions authored")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Authoring view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");

    expect(
      screen.getByRole("region", { name: "Module 1 questions" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent("rev-1");
    expect(
      screen.getByRole("complementary", { name: "Question inspector" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-question-id")).toHaveTextContent("rev-1");
  });

  it("switches the editor when another question is selected", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");
    expect(screen.getByTestId("editor-question-id")).toHaveTextContent("rev-1");

    fireEvent.click(screen.getByTestId("select-eq-2"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-question-id")).toHaveTextContent("rev-2"),
    );
    expect(screen.getByTestId("select-eq-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("inspector-question-id")).toHaveTextContent("rev-2");
  });

  it("runs validation and shows the issues pane in issues mode", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    const group = screen.getByRole("group", { name: "Authoring view" });
    fireEvent.click(within(group).getByRole("button", { name: /issues/i }));

    await waitFor(() => expect(harness.mutations.validate).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Validation across the current SAT draft"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run validation to review authoring issues."),
    ).toBeInTheDocument();
  });

  it("flushes the draft when save now is triggered", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    await waitFor(() =>
      expect(harness.autosave.flushNow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rev-1" }),
      ),
    );
  });

  it("schedules autosave when the editor or inspector change the draft", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspector change" }));

    expect(harness.autosave.scheduleAutosave).toHaveBeenCalledTimes(2);
    expect(harness.autosave.scheduleAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rev-1" }),
    );
  });

  it("propagates search and filter changes to the question list", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    const search = screen.getByRole("searchbox", { name: "Search questions" });
    fireEvent.change(search, { target: { value: "algebra" } });
    expect(search).toHaveValue("algebra");

    fireEvent.click(screen.getByRole("button", { name: "Filter ready" }));
    expect(screen.getByTestId("list-filter")).toHaveTextContent("ready");
  });

  it("creates a question from the navigator and opens it", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    fireEvent.click(screen.getByRole("button", { name: "Create question" }));

    await waitFor(() => expect(harness.mutations.create).toHaveBeenCalledWith("mod-1"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-question-id")).toHaveTextContent("rev-new"),
    );
  });

  it("shows the empty editor and creates the next question when the module is empty", async () => {
    harness.shellResult = {
      data: makeShell([]),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    renderWorkspace();

    expect(await screen.findByText("Choose a question in Module 1")).toBeInTheDocument();
    expect(screen.queryByTestId("question-editor")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Question inspector" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create next question" }));
    await waitFor(() => expect(harness.mutations.create).toHaveBeenCalledWith("mod-1"));
  });

  it("shows the editor skeleton while the selected question loads", () => {
    harness.shellResult = {
      data: makeShell([makeSummary("eq-9", "rev-9", "Ninth prompt", "incomplete")]),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    (harness.useExamQuestion as any).mockImplementation((id: string | null) =>
      id
        ? { data: undefined, isLoading: true, isPending: true, error: null, refetch: harness.questionRefetch }
        : { data: undefined, isLoading: false, isPending: false, error: null, refetch: harness.questionRefetch },
    );
    renderWorkspace();
    expect(screen.getByRole("status", { name: "Loading question" })).toBeInTheDocument();
  });

  it("shows the question load error with retry", async () => {
    harness.shellResult = {
      data: makeShell([makeSummary("eq-9", "rev-9", "Ninth prompt", "incomplete")]),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    (harness.useExamQuestion as any).mockImplementation((id: string | null) =>
      id
        ? {
            data: undefined,
            isLoading: false,
            isPending: false,
            error: new Error("Question gone"),
            refetch: harness.questionRefetch,
          }
        : { data: undefined, isLoading: false, isPending: false, error: null, refetch: harness.questionRefetch },
    );
    renderWorkspace();

    expect(await screen.findByText("Question could not be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
    expect(harness.questionRefetch).toHaveBeenCalledOnce();
  });

  it("switches the inspector section and closes the inspector", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    fireEvent.click(screen.getByRole("button", { name: "Inspector answers tab" }));
    expect(screen.getByTestId("inspector-section")).toHaveTextContent("answers");

    fireEvent.click(screen.getByRole("button", { name: "Close question inspector" }));
    expect(
      screen.queryByRole("complementary", { name: "Question inspector" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("question-editor")).toBeInTheDocument();
  });

  it("opens the quick preview and sample dialog from the actions menu", async () => {
    renderWorkspace();
    await screen.findByTestId("question-editor");

    fireEvent.click(screen.getByRole("button", { name: "Preview current question" }));
    expect(
      screen.getByRole("complementary", { name: "Student question preview" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(
      screen.queryByRole("complementary", { name: "Student question preview" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load sample exam…" }));
    expect(screen.getByRole("dialog", { name: "Load sample SAT" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Load sample SAT" })).not.toBeInTheDocument();
  });
});
