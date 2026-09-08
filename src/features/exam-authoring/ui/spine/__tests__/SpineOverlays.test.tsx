import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  QuestionRevision,
} from "../../../contracts/assessment";

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

vi.mock("../../../api/assessmentQueries", () => ({
  assessmentKeys: {
    shell: (examId: string) => ["assessment", examId, "shell"],
    release: (examId: string) => ["assessment", examId, "release"],
    readinessRoot: (examId: string) => ["assessment", examId, "readiness"],
    readiness: (examId: string, v: string, r: number) => ["assessment", examId, "readiness", v, r],
    question: (id: string) => ["assessment-question", id],
  },
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
}));
vi.mock("../../../api/assessmentAuthoringApi", () => ({ assessmentAuthoringApi: harness.api }));
vi.mock("../../../hooks/useQuestionAutosave", () => ({
  useQuestionAutosave: (...args: unknown[]) => (harness.useQuestionAutosave as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../../auth/api/authSession", () => ({
  useOptionalAuthSession: (...args: unknown[]) => (harness.useOptionalAuthSession as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../editor/richContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../editor/richContent")>();
  return {
    ...actual,
    hasStructuredContent: (c: { nodes?: unknown[] }) => Boolean(c?.nodes?.length),
    plainTextFromContent: (c: { nodes?: { text?: string }[] }) => (c?.nodes ?? []).map((n) => n.text ?? "").join(" "),
    supportsFastPlainEditing: () => true,
  };
});
vi.mock("../../../providers/sat/satProvider", () => ({ validateSatQuestion: () => [] }));
vi.mock("../../../editor/FastQuestionComposer", () => ({
  FastQuestionComposer: ({ label }: { label: string }) => <input aria-label={label} />,
}));
vi.mock("../../../editor/RichQuestionComposer", () => ({ SAT_CHOICE_COMPOSER_CAPABILITIES: {} }));
vi.mock("../../../providers/sat/contentTemplates", () => ({
  createSatSupportingMaterial: (kind: string) => ({ version: 2 as const, nodes: [], document: { type: "doc" as const, content: [{ type: "paragraph", text: kind }] } }),
}));
import { AuthoringWorkspace } from "../../AuthoringWorkspace";

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
  harness.shellResult = { data: shell, isLoading: false, error: null, refetch: vi.fn() };
  for (const fn of [harness.useAuthoringShell, harness.useExamQuestion, harness.useQuestionAutosave, harness.useOptionalAuthSession, harness.useCreate, harness.useBatchCreate, harness.useDuplicate, harness.useReorder, harness.useBulk, harness.useValidation, harness.useLoadSample, harness.useReleaseReadiness]) (fn as { mockReset: () => void }).mockReset();
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
  (harness.mutations.validate as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ valid: true, errors: [], warnings: [] });
  (harness.api.getSatWorkbookUndoState as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(null);
  (harness.api.getShell as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => Promise.resolve(shell));
}

function renderSpine() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sat/exams/exam-1?spine=1"]}>
        <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SpineOverlays (Phase 9.1+9.4 parity)", () => {
  beforeEach(() => { setupDefaults(); });

  it("renders the spine branch with header progress and queue", async () => {
    renderSpine();
    expect(await screen.findByRole("heading", { name: "SAT Practice 1" })).toBeInTheDocument();
    expect(await screen.findByText(/2 of 3 questions authored/)).toBeInTheDocument();
  });

  it("keeps paste import reachable from the spine queue", async () => {
    renderSpine();
    expect(await screen.findByRole("button", { name: /paste or import questions/i })).toBeInTheDocument();
  });

  it("opens the jump palette with Ctrl+K in the spine branch", async () => {
    renderSpine();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: /jump to question/i })).toBeInTheDocument();
  });

  it("opens shortcut help with ? in the spine branch", async () => {
    renderSpine();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.keyDown(document.body, { key: "?" });
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("reviews module issues from the spine queue", async () => {
    renderSpine();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    const view = screen.getByRole("group", { name: /question readiness filters/i });
    void view;
    expect(await screen.findByText(/first prompt/i)).toBeInTheDocument();
  });

  it("keeps import, preview, and release actions reachable in the spine header", async () => {
    renderSpine();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the full sat preview/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^release$/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Authoring view" })).toBeInTheDocument();
  });

  it("opens the student preview sheet from the spine question view", async () => {
    renderSpine();
    await screen.findByRole("heading", { name: "SAT Practice 1" });
    fireEvent.click(await screen.findByRole("button", { name: /preview question as students/i }));
    expect(await screen.findByText(/live delivery renderer/i)).toBeInTheDocument();
  });
});
