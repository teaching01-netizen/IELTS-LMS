import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  QuestionRevision,
} from "../../contracts/assessment";

const harness = vi.hoisted(() => ({
  shellResult: { data: null as unknown, isLoading: false, error: null as unknown, refetch: vi.fn() },
  details: {} as Record<string, AssessmentQuestionDetail>,
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
  useReleaseReadiness: vi.fn(),
  useEnsureDraft: vi.fn(),
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
  mutations: { create: vi.fn(), batchCreate: vi.fn(), duplicate: vi.fn(), reorder: vi.fn(), bulk: vi.fn(), validate: vi.fn(), loadSample: vi.fn() },
  api: { getSatWorkbookUndoState: vi.fn(), getShell: vi.fn(), getQuestion: vi.fn(), saveQuestionRevision: vi.fn(), deleteQuestion: vi.fn() },
}));

vi.mock("../../api/assessmentQueries", () => ({
  assessmentKeys: {
    shell: (examId: string) => ["assessment", examId, "shell"],
    release: (examId: string) => ["assessment", examId, "release"],
    readinessRoot: (examId: string) => ["assessment", examId, "readiness"],
    readiness: (examId: string, v: string, r: number) => ["assessment", examId, "readiness", v, r],
    question: (id: string) => ["assessment-question", id],
  },
  setReadyShell: vi.fn(),
  useAuthoringShell: (...args: unknown[]) => (harness.useAuthoringShell as (...a: unknown[]) => unknown)(...args),
  useExamQuestion: (...args: unknown[]) => (harness.useExamQuestion as (...a: unknown[]) => unknown)(...args),
  useCreateAssessmentQuestion: (...args: unknown[]) => (harness.useCreate as (...a: unknown[]) => unknown)(...args),
  useBatchCreateAssessmentQuestions: (...args: unknown[]) => (harness.useBatchCreate as (...a: unknown[]) => unknown)(...args),
  useDuplicateAssessmentQuestion: (...args: unknown[]) => (harness.useDuplicate as (...a: unknown[]) => unknown)(...args),
  useReorderAssessmentQuestions: (...args: unknown[]) => (harness.useReorder as (...a: unknown[]) => unknown)(...args),
  useBulkAssessmentQuestions: (...args: unknown[]) => (harness.useBulk as (...a: unknown[]) => unknown)(...args),
  useAssessmentValidation: (...args: unknown[]) => (harness.useValidation as (...a: unknown[]) => unknown)(...args),
  useAssessmentReleaseReadiness: (...args: unknown[]) => (harness.useReleaseReadiness as (...a: unknown[]) => unknown)(...args),
  useLoadSatSampleExam: (...args: unknown[]) => (harness.useLoadSample as (...a: unknown[]) => unknown)(...args),
  useEnsureDraftShell: (...args: unknown[]) => (harness.useEnsureDraft as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../api/assessmentAuthoringApi", () => ({ assessmentAuthoringApi: harness.api }));
vi.mock("../../hooks/useQuestionAutosave", () => ({
  useQuestionAutosave: (...args: unknown[]) => (harness.useQuestionAutosave as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../auth/api/authSession", () => ({
  useOptionalAuthSession: (...args: unknown[]) => (harness.useOptionalAuthSession as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../editor/richContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../editor/richContent")>();
  return {
    ...actual,
    hasStructuredContent: (c: { nodes?: unknown[] }) => Boolean(c?.nodes?.length),
    plainTextFromContent: (c: { nodes?: { text?: string }[] }) => (c?.nodes ?? []).map((n) => n.text ?? "").join(" "),
    supportsFastPlainEditing: () => true,
  };
});
vi.mock("../../providers/sat/satProvider", () => ({ validateSatQuestion: () => [] }));
vi.mock("../../editor/FastQuestionComposer", () => ({
  FastQuestionComposer: ({ label }: { label: string }) => <input aria-label={label} />,
}));
vi.mock("../../editor/RichQuestionComposer", () => ({ SAT_CHOICE_COMPOSER_CAPABILITIES: {} }));
vi.mock("../../providers/sat/contentTemplates", () => ({
  createSatSupportingMaterial: (kind: string) => ({ version: 2 as const, nodes: [], document: { type: "doc" as const, content: [{ type: "paragraph", text: kind }] } }),
}));
import { SAVE_CONFLICT_COPY } from "../../realtime/connectionCopy";
import { AuthoringWorkspace } from "../AuthoringWorkspace";

function structuredText(id: string, text: string) {
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id, text }] };
}
function emptyContent() {
  return { version: 1 as const, nodes: [] as { type: "paragraph"; id: string; text: string }[] };
}
function makeDraft(id: string, promptText: string): QuestionRevision {
  return {
    id, questionId: `q-${id}`, semanticRevision: 1, revision: 1, state: "draft",
    questionType: "single_choice", stimulus: emptyContent(), prompt: structuredText(`p-${id}`, promptText),
    answer: {
      kind: "single_choice" as const,
      options: ["A", "B", "C", "D"].map((o) => ({ id: o, content: structuredText(`${o}-${id}`, o) })),
      correctOptionId: "A",
    },
    rationale: emptyContent(),
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}
function makeSummary(examQuestionId: string, promptPreview: string): AssessmentQuestionSummary {
  return {
    examQuestionId, questionId: `q-${examQuestionId}`, questionRevisionId: `rev-${examQuestionId}`,
    displayOrder: 0, isPretest: false, questionType: "single_choice", semanticRevision: 1, revision: 1,
    promptPreview, answerKeyPreview: "A", domain: null, skill: null, difficulty: "medium", tags: [],
    hasStimulus: false, contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  };
}
function makeShell(): AssessmentAuthoringShell {
  return {
    examId: "exam-1", providerKey: "sat", versionId: "v-1", versionRevision: 3,
    sections: [{
      id: "sec-rw", sectionKey: "reading-writing", title: "Reading & Writing", displayOrder: 0,
      durationSeconds: 3840, breakAfterSeconds: 0, revision: 1, routingPolicy: null,
      modules: [{
        id: "mod-1", moduleKey: "rw-m1", title: "Module 1", displayOrder: 0, durationSeconds: 1920,
        targetQuestionCount: 3, adaptiveRole: "base", toolPolicy: {}, revision: 1,
        questions: [makeSummary("eq-1", "First prompt"), makeSummary("eq-2", "Second prompt")],
      }],
    }],
  };
}

function setupDefaults() {
  window.localStorage.clear();
  const shell = makeShell();
  const first = makeDraft("rev-1", "First prompt");
  const second = makeDraft("rev-2", "Second prompt");
  const details: Record<string, AssessmentQuestionDetail> = {
    "eq-1": { examQuestionId: "eq-1", moduleId: "mod-1", moduleKey: "rw-m1", sectionKey: "reading-writing", displayOrder: 0, isPretest: false, question: first },
    "eq-2": { examQuestionId: "eq-2", moduleId: "mod-1", moduleKey: "rw-m1", sectionKey: "reading-writing", displayOrder: 1, isPretest: false, question: second },
  };
  harness.details = details;
  // The shell cache holds a lifecycle envelope: READY carries the shell.
  harness.shellResult = {
    data: { state: "READY", shell },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
  for (const fn of [harness.useAuthoringShell, harness.useExamQuestion, harness.useQuestionAutosave, harness.useOptionalAuthSession, harness.useCreate, harness.useBatchCreate, harness.useDuplicate, harness.useReorder, harness.useBulk, harness.useValidation, harness.useLoadSample, harness.useReleaseReadiness, harness.useEnsureDraft]) (fn as { mockReset: () => void }).mockReset();
  for (const fn of Object.values(harness.mutations)) (fn as { mockReset: () => void }).mockReset();
  for (const fn of Object.values(harness.api)) (fn as { mockReset: () => void }).mockReset();
  const autosave = harness.autosave;
  for (const fn of [autosave.scheduleAutosave, autosave.flushNow, autosave.commitAndAdvance, autosave.retry]) (fn as { mockReset: () => void }).mockReset();
  autosave.status = "saved"; autosave.lastSavedAt = null; autosave.isOffline = false; autosave.hasPendingChanges = false;
  (autosave.flushNow as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, isLatest: true });
  (autosave.commitAndAdvance as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, isLatest: true });
  (harness.useAuthoringShell as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => harness.shellResult);
  (harness.useExamQuestion as unknown as { mockImplementation: (f: (id: string | null) => unknown) => void }).mockImplementation((id: string | null) => {
    if (!id) return { data: undefined, error: null, refetch: vi.fn() };
    return { data: details[id], error: null, refetch: vi.fn() };
  });
  (harness.useQuestionAutosave as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => harness.autosave);
  (harness.useOptionalAuthSession as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ session: { user: { id: "staff-1" } } }));
  (harness.useCreate as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.create, isPending: false }));
  (harness.useBatchCreate as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.batchCreate, isPending: false }));
  (harness.useDuplicate as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.duplicate, isPending: false }));
  (harness.useReorder as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.reorder, isPending: false }));
  (harness.useBulk as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.bulk, isPending: false }));
  (harness.useValidation as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.validate, isPending: false, data: null }));
  (harness.useLoadSample as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: harness.mutations.loadSample, isPending: false }));
  (harness.useReleaseReadiness as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ data: null, isPending: false }));
  (harness.useEnsureDraft as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutate: () => undefined, mutateAsync: (...args: unknown[]) => Promise.resolve(args), isPending: false, error: null }));
  (harness.mutations.validate as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ valid: true, errors: [], warnings: [] });
  (harness.api.getSatWorkbookUndoState as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(null);
  (harness.api.getShell as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => Promise.resolve(shell));
}

function workspaceTree() {
  return (
    <QueryClientProvider client={renderWorkspaceClient()}>
      <MemoryRouter initialEntries={["/sat/exams/exam-1"]}>
        <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWorkspaceClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderWorkspace() {
  return render(workspaceTree());
}

describe("AuthoringWorkspace (spine-only)", () => {
  beforeEach(() => { setupDefaults(); });

  it("renders the spine branch with header progress and queue", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "SAT Practice 1" })).toBeInTheDocument();
    expect(await screen.findByText(/of \d+ authored/)).toBeInTheDocument();
  });

  it("keeps paste import reachable from the spine queue", async () => {
    renderWorkspace();
    expect(await screen.findByRole("button", { name: /^add question$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "More authoring actions"}));
    expect(screen.getByRole("menuitem", {name: "Import from workbook"})).toBeInTheDocument();
  });

  it("opens the jump palette with Ctrl+K in the spine branch", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: /jump to question/i })).toBeInTheDocument();
  });

  it("opens shortcut help with ? in the spine branch", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.keyDown(document.body, { key: "?" });
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("reviews module issues from the spine queue", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    const view = screen.getByRole("button", { name: /question readiness filters/i });
    void view;
    expect(await screen.findByText(/first prompt/i)).toBeInTheDocument();
  });

  it("keeps import, preview, and release actions reachable in the spine header", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    expect(screen.getByRole("button", { name: "More authoring actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the full sat preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^release$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Authoring view" })).not.toBeInTheDocument();
  });

  it("duplicates the explicit noncurrent row after exactly one dirty-draft flush",async()=>{
    harness.autosave.status="unsaved";
    harness.mutations.duplicate.mockResolvedValue({examQuestionId:"eq-3",question:makeDraft("rev-3","Copy")});
    renderWorkspace();await screen.findByRole("heading",{name:"Question 1"});
    fireEvent.click(screen.getByRole("button",{name:"Question 2 actions"}));fireEvent.click(screen.getByRole("menuitem",{name:"Duplicate"}));
    await waitFor(()=>expect(harness.mutations.duplicate).toHaveBeenCalledOnce());
    expect(harness.autosave.flushNow).toHaveBeenCalledOnce();
    expect(harness.mutations.duplicate).toHaveBeenCalledWith(expect.objectContaining({examQuestionId:"eq-2",request:expect.objectContaining({insertAfterExamQuestionId:"eq-2",operationKey:expect.any(String)})}));
  });
  it("confirms deletion of another row without changing the active draft",async()=>{
    harness.api.deleteQuestion.mockResolvedValue(undefined);renderWorkspace();await screen.findByRole("heading",{name:"Question 1"});
    fireEvent.click(screen.getByRole("button",{name:"Question 2 actions"}));fireEvent.click(screen.getByRole("menuitem",{name:"Delete"}));
    expect(harness.api.deleteQuestion).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Delete question"}));
    await waitFor(()=>expect(harness.api.deleteQuestion).toHaveBeenCalledWith("eq-2"));
    await waitFor(()=>expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading",{name:"Question 1"})).toBeInTheDocument();
  });
  it("stops row mutations when the dirty draft cannot flush",async()=>{
    harness.autosave.status="error";harness.autosave.flushNow.mockResolvedValue({ok:false,isLatest:true});renderWorkspace();await screen.findByRole("heading",{name:"Question 1"});
    fireEvent.click(screen.getByRole("button",{name:"Question 2 actions"}));fireEvent.click(screen.getByRole("menuitem",{name:"Duplicate"}));
    await waitFor(()=>expect(harness.autosave.flushNow).toHaveBeenCalledOnce());expect(harness.mutations.duplicate).not.toHaveBeenCalled();
  });
  it("keeps save inside editors and gives Shift+S precedence outside editors",async()=>{
    renderWorkspace();const prompt=await screen.findByLabelText('Question prompt');
    fireEvent.keyDown(prompt,{key:'s',ctrlKey:true});await waitFor(()=>expect(harness.autosave.flushNow).toHaveBeenCalledOnce());
    fireEvent.keyDown(document.body,{key:'S',ctrlKey:true,shiftKey:true});
    expect(screen.getByRole('region',{name:'Question inspector'})).toBeInTheDocument();
    expect(harness.autosave.flushNow).toHaveBeenCalledOnce();
  });
  it("guards settings shortcut in text and exposes command actions with Ctrl+K",async()=>{
    renderWorkspace();const prompt=await screen.findByLabelText('Question prompt');
    fireEvent.keyDown(prompt,{key:'S',ctrlKey:true,shiftKey:true});expect(screen.queryByRole('region',{name:'Question inspector'})).not.toBeInTheDocument();
    fireEvent.keyDown(document.body,{key:'k',ctrlKey:true});
    expect(screen.getByRole('option',{name:/Open question settings/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option',{name:/Open question settings/}));
    expect(screen.getByRole('region',{name:'Question inspector'})).toBeInTheDocument();
  });
  it("opens the student preview sheet from the spine question view", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.click(await screen.findByRole("button", {name:"Question actions"}));
    fireEvent.click(screen.getByRole("menuitem", {name:/preview question as students/i}));
    expect(await screen.findByText(/local unsaved edits included|saved draft revision/i)).toBeInTheDocument();
  });
});

/**
 * Phase 05 parity: the fence (HTTP 409) and the socket event are the same
 * product condition, so they must reach the same surface with the same words.
 * These run with EVERY capability OFF (the harness leaves the VITE kill
 * switches unset), which is exactly the degraded case that used to strand the
 * author on "reload the latest version, then reapply your changes".
 */
describe("AuthoringWorkspace conflict routing without a socket", () => {
  beforeEach(() => { setupDefaults(); });

  function tree() {
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <MemoryRouter initialEntries={["/sat/exams/exam-1"]}>
          <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("turns a fenced write into divergence and opens Review", async () => {
    const attempted = harness.details["eq-1"]!.question;
    harness.autosave.status = "conflict";
    harness.autosave.hasPendingChanges = true;
    // The fence is the only signal: HTTP is authoritative, so the newer
    // revision is learned by fetching, never by arithmetic on the error.
    harness.api.getQuestion.mockResolvedValue({
      ...harness.details["eq-1"],
      question: { ...attempted, revision: attempted.revision + 1 },
    });

    renderWorkspace();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    await waitFor(() => expect(harness.api.getQuestion).toHaveBeenCalledWith("eq-1"));
    expect(await screen.findByTestId("conflict-resolver")).toBeInTheDocument();
    // Diverged, not failed: the notice carries the calm wording and the
    // mandatory promise that the local work is safe.
    expect(await screen.findByTestId("remote-update-notice")).toBeInTheDocument();
    expect(screen.getByTestId("remote-update-notice")).toHaveTextContent(
      /new changes available/i,
    );
  });

  it("speaks one conflict vocabulary in the header and the footer", async () => {
    harness.autosave.status = "conflict";
    harness.autosave.hasPendingChanges = true;
    // The server is NOT ahead, so nothing is routed: this is purely about the
    // two save-cluster sites agreeing with each other.
    harness.api.getQuestion.mockResolvedValue({ ...harness.details["eq-1"] });

    renderWorkspace();
    // The save area only exists once a draft is open (the header slot and the
    // spine footer both render from it).
    await screen.findByLabelText("Question prompt");
    const reviews = await screen.findAllByRole("button", { name: /review changes/i });
    expect(reviews).toHaveLength(2);
    // Both sites derive from the same copy module: they say exactly the same
    // thing. The footer used to speak its own dialect and tell the author to
    // reload and retype work the app was already holding.
    const titles = reviews.map((button) => button.getAttribute("title"));
    expect(new Set(titles).size).toBe(1);
    expect(titles[0]).toBe(`${SAVE_CONFLICT_COPY.fenced} ${SAVE_CONFLICT_COPY.keptOnDevice}`);
    expect(document.body.textContent ?? "").not.toMatch(/reload the latest version/i);

    // Both sites open the SAME surface, including the footer directly under the
    // editor — the one the author actually reads while typing.
    fireEvent.click(reviews[reviews.length - 1]!);
    expect(await screen.findByTestId("conflict-resolver")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("conflict-resolver")).not.toBeInTheDocument();
    fireEvent.click(reviews[0]!);
    expect(await screen.findByTestId("conflict-resolver")).toBeInTheDocument();
  });

  /**
   * What the editor would actually send: the draft, never the query cache. Each
   * case gets its own render so no divergence history leaks between them.
   */
  async function flushDraftPromptAfterRefetch(args: {
    dirty: boolean;
    text: string;
  }): Promise<string> {
    const view = render(tree());
    await screen.findByLabelText("Question prompt");
    harness.autosave.hasPendingChanges = args.dirty;
    harness.details["eq-1"] = {
      ...harness.details["eq-1"]!,
      question: { ...makeDraft("rev-1", args.text), revision: 2 },
    };
    view.rerender(tree());
    const prompt = await screen.findByLabelText("Question prompt");
    fireEvent.keyDown(prompt, { key: "s", ctrlKey: true });
    await waitFor(() => expect(harness.autosave.flushNow).toHaveBeenCalledOnce());
    const payload = (harness.autosave.flushNow as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as { prompt: { nodes: { text?: string }[] } };
    return payload.prompt.nodes.map((node) => node.text ?? "").join(" ");
  }

  it("never replaces a DIRTY editor from a refetch", async () => {
    // Otherwise the very fetch that reveals a newer revision discards the draft
    // the notice beside it promises to keep, and the device copy becomes the
    // only survivor — which resurfaces as "recovered unsaved changes" on the
    // next reload, exactly what this surface exists to prevent.
    expect(
      await flushDraftPromptAfterRefetch({ dirty: true, text: "Rewritten on the server" }),
    ).toBe("First prompt");
  });

  it("still replaces a CLEAN editor from a refetch", async () => {
    // The guard protects local work; it must not freeze the freshness path.
    expect(
      await flushDraftPromptAfterRefetch({ dirty: false, text: "Rewritten on the server" }),
    ).toBe("Rewritten on the server");
  });

  it("reports a recovered device draft as a device fact, never as a conflict", async () => {
    renderWorkspace();
    await screen.findByLabelText("Question prompt");
    // The LAST call, not the first: each render passes a fresh options object,
    // and only the current one closes over a selected question.
    const calls = (harness.useQuestionAutosave as { mock: { calls: unknown[][] } }).mock.calls;
    const options = calls[calls.length - 1]![0] as { onRecover: (revision: QuestionRevision) => void };
    act(() => { options.onRecover(makeDraft("rev-1", "Typed while offline")); });
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/recovered unsaved changes from this device/i);
    expect(banner).toHaveTextContent(/not saved on the server yet/i);
    expect(banner.textContent ?? "").not.toMatch(/another author|reload/i);
  });
});

/**
 * The question-load state machine.
 *
 * WHY THIS FILE EXISTS (this describe, specifically)
 * --------------------------------------------------
 * The editor rendered from the open draft, and the draft was installed by an
 * adoption rule that answered with a bare boolean — so a 200 that was declined
 * (recovery held, local work protected, stale payload) was indistinguishable
 * from a request still in flight, and the loading skeleton meant two things.
 * The second meaning — "the question arrived and was dropped" — is the state
 * machine hole that stranded a successful question behind an indefinite
 * skeleton. The invariant these tests pin: the skeleton renders ONLY while the
 * question query has not answered; a 200 always lands on a surface.
 */
describe("AuthoringWorkspace question load state machine", () => {
  beforeEach(() => { setupDefaults(); });

  async function renderAndAnswer(): Promise<ReturnType<typeof renderWorkspace>> {
    const view = renderWorkspace();
    await screen.findByLabelText("Question prompt");
    return view;
  }

  it("renders the editor from a successful question response", async () => {
    await renderAndAnswer();
    expect(screen.queryByTestId("editor-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Question could not be loaded" })).toBeNull();
  });

  it("renders the skeleton only while the question query has not answered", async () => {
    // The real query is pending until it answers; the mock must say so.
    (harness.useExamQuestion as unknown as { mockImplementation: (f: (id: string | null) => unknown) => void }).mockImplementation(
      (id: string | null) => {
        if (!id) return { data: undefined, error: null, isPending: false, refetch: vi.fn() };
        const detail = harness.details[id];
        return detail
          ? { data: detail, error: null, isPending: false, refetch: vi.fn() }
          : { data: undefined, error: null, isPending: true, refetch: vi.fn() };
      },
    );
    // The query is genuinely pending: no detail exists yet.
    harness.details = {};
    const client = renderWorkspaceClient();
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/sat/exams/exam-1"]}>
          <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("editor-skeleton")).toBeInTheDocument();

    // The request answers, and the skeleton gives way to the editor.
    harness.details = {
      "eq-1": {
        examQuestionId: "eq-1",
        moduleId: "mod-1",
        moduleKey: "rw-m1",
        sectionKey: "reading-writing",
        displayOrder: 0,
        isPretest: false,
        question: makeDraft("rev-1", "First prompt"),
      },
    };
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/sat/exams/exam-1"]}>
          <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByLabelText("Question prompt");
    expect(screen.queryByTestId("editor-skeleton")).not.toBeInTheDocument();
  });

  it("surfaces a failed request as a retryable load error", async () => {
    (harness.useExamQuestion as unknown as { mockImplementation: (f: (id: string | null) => unknown) => void }).mockImplementation(
      (id: string | null) =>
        id
          ? { data: undefined, error: new Error("The service refused the request"), isPending: false, refetch: vi.fn() }
          : { data: undefined, error: null, isPending: false, refetch: vi.fn() },
    );
    renderWorkspace();
    await screen.findByRole("heading", { name: "Question could not be loaded" });
    const alert = screen.getAllByRole("alert").find((node) =>
      node.textContent?.includes("The service refused the request"),
    );
    expect(alert).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry question" })).toBeInTheDocument();
    expect(screen.queryByTestId("editor-skeleton")).not.toBeInTheDocument();
  });

  it("never leaves a successful response in the skeleton, even when it cannot be adopted", async () => {
    // The stale-payload shape: the queue named eq-1, but the answer describes
    // eq-2. The adoption rule must decline it ("stale-selection") — and the
    // workspace must then surface that fact, not sit on an unexplained
    // skeleton forever as it used to.
    harness.details["eq-1"] = harness.details["eq-2"];
    renderWorkspace();

    await screen.findByRole("heading", { name: "Question could not be loaded" });
    const alert = screen.getAllByRole("alert").find((node) =>
      node.textContent?.includes(
        "The question loaded successfully but could not be opened. Try again, or reopen it from the question list.",
      ),
    );
    expect(alert).toBeDefined();
    expect(screen.queryByTestId("editor-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Question prompt")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry question" })).toBeInTheDocument();
  });
});
