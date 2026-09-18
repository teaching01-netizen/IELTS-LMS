import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";

const harness = vi.hoisted(() => ({
  shellResult: { data: null as unknown, isLoading: false, error: null as unknown, refetch: vi.fn() },
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
  ensureState: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  authValue: { session: { user: { id: "staff-1", role: "builder" } } },
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
vi.mock("../../api/assessmentAuthoringApi", () => ({
  assessmentAuthoringApi: {
    getSatWorkbookUndoState: vi.fn(),
    getShell: vi.fn(),
    getQuestion: vi.fn(),
    saveQuestionRevision: vi.fn(),
    deleteQuestion: vi.fn(),
  },
}));
vi.mock("../../hooks/useQuestionAutosave", () => ({
  useQuestionAutosave: (...args: unknown[]) => (harness.useQuestionAutosave as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../../auth/api/authSession", () => ({
  useOptionalAuthSession: (...args: unknown[]) => (harness.useOptionalAuthSession as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("../../editor/richContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../editor/richContent")>();
  return { ...actual, supportsFastPlainEditing: () => true };
});
vi.mock("../../providers/sat/satProvider", () => ({ validateSatQuestion: () => [] }));
vi.mock("../../editor/FastQuestionComposer", () => ({
  FastQuestionComposer: ({ label }: { label: string }) => <input aria-label={label} />,
}));
vi.mock("../../editor/RichQuestionComposer", () => ({ SAT_CHOICE_COMPOSER_CAPABILITIES: {} }));
vi.mock("../../providers/sat/contentTemplates", () => ({
  createSatSupportingMaterial: (kind: string) => ({ version: 2 as const, nodes: [], document: { type: "doc" as const, content: [{ type: "paragraph", text: kind }] } }),
}));
import { AuthoringWorkspace } from "../AuthoringWorkspace";

const NO_DRAFT = { state: "NO_DRAFT" as const, shell: null };

function setupLifecycle(
  shellData: unknown,
  role: string | null,
  shellError: unknown = null
) {
  harness.shellResult = { data: shellData, isLoading: false, error: shellError, refetch: vi.fn() };
  for (const fn of [harness.useAuthoringShell, harness.useExamQuestion, harness.useQuestionAutosave, harness.useOptionalAuthSession, harness.useCreate, harness.useBatchCreate, harness.useDuplicate, harness.useReorder, harness.useBulk, harness.useValidation, harness.useLoadSample, harness.useReleaseReadiness, harness.useEnsureDraft]) (fn as { mockReset: () => void }).mockReset();
  harness.ensureState = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  (harness.useAuthoringShell as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => harness.shellResult);
  (harness.useExamQuestion as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ data: undefined, error: null, refetch: vi.fn() }));
  (harness.useQuestionAutosave as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({
    status: "saved", lastSavedAt: null, isOffline: false, hasPendingChanges: false,
    scheduleAutosave: vi.fn(), flushNow: vi.fn(), commitAndAdvance: vi.fn(), retry: vi.fn(),
  }));
  harness.authValue = role
    ? { session: { user: { id: "staff-1", role } } }
    : { session: null } as unknown as typeof harness.authValue;
  (harness.useOptionalAuthSession as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => harness.authValue);
  for (const fn of [harness.useCreate, harness.useBatchCreate, harness.useDuplicate, harness.useReorder, harness.useBulk]) (fn as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: vi.fn(), isPending: false }));
  (harness.useValidation as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: vi.fn(), isPending: false, data: null }));
  (harness.useLoadSample as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ mutateAsync: vi.fn(), isPending: false }));
  (harness.useReleaseReadiness as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({ data: null, isPending: false }));
  (harness.useEnsureDraft as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => harness.ensureState);
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sat/exams/exam-1"]}>
        <AuthoringWorkspace examId="exam-1" examTitle="SAT Practice 1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuthoringWorkspace shell lifecycle surfaces", () => {
  beforeEach(() => { setupLifecycle(NO_DRAFT, "builder"); });

  it("renders NO_DRAFT as a distinct state with an Open draft CTA for editors", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "No editable draft" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unable to load the SAT authoring workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Exam not found" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open draft" })).toBeInTheDocument();
  });

  it("disables the CTA while the ensure is pending (single-flight)", async () => {
    harness.ensureState.isPending = true;
    renderWorkspace();
    const cta = await screen.findByRole("button", { name: "Opening draft…" });
    expect(cta).toBeDisabled();
    // A disabled button cannot dispatch click events: no ensure call happens.
    fireEvent.click(cta);
    expect(harness.ensureState.mutate).not.toHaveBeenCalled();
  });

  it("calls the ensure mutation once per explicit CTA click", async () => {
    renderWorkspace();
    const cta = await screen.findByRole("button", { name: "Open draft" });
    fireEvent.click(cta);
    expect(harness.ensureState.mutate).toHaveBeenCalledTimes(1);
  });

  it("hides the CTA and never triggers ensure for preview-only roles", async () => {
    setupLifecycle(NO_DRAFT, "proctor");
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "No editable draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open draft/i })).not.toBeInTheDocument();
    expect(harness.ensureState.mutate).not.toHaveBeenCalled();
    expect(harness.ensureState.mutateAsync).not.toHaveBeenCalled();
  });

  it("hides the CTA for signed-out sessions", async () => {
    setupLifecycle(NO_DRAFT, null);
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "No editable draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open draft/i })).not.toBeInTheDocument();
    expect(harness.ensureState.mutate).not.toHaveBeenCalled();
  });

  it("surfaces ensure failure (409) without auto-looping", async () => {
    setupLifecycle(NO_DRAFT, "admin");
    harness.ensureState.error = new ApiError({ code: "VERSION_CONFLICT", message: "draft changed", status: 409 });
    renderWorkspace();
    expect(await screen.findByText(/draft changed while opening/i)).toBeInTheDocument();
    expect(harness.ensureState.mutate).not.toHaveBeenCalled();
  });

  it("distinguishes a missing exam from a missing draft and offers no Open draft CTA", async () => {
    // EXAM_NOT_FOUND is a 404 error, NOT the no-draft lifecycle state: the two
    // must never share a surface, because opening a draft for an exam that does
    // not exist cannot succeed.
    setupLifecycle(
      undefined,
      "admin",
      new ApiError({ code: "EXAM_NOT_FOUND", message: "Exam not found.", status: 404 })
    );
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "Exam not found" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No editable draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open draft/i })).not.toBeInTheDocument();
    expect(harness.ensureState.mutate).not.toHaveBeenCalled();
  });

  it("renders permission failures as their own surface", async () => {
    setupLifecycle(
      undefined,
      "proctor",
      new ApiError({ code: "FORBIDDEN", message: "nope", status: 403 })
    );
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "You cannot author this exam" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open draft/i })).not.toBeInTheDocument();
  });

  it("keeps an unexpected failure recoverable with a retry action", async () => {
    setupLifecycle(undefined, "admin", new ApiError({ code: "INTERNAL", message: "boom", status: 500 }));
    renderWorkspace();
    expect(
      await screen.findByRole("heading", { name: "Unable to load the SAT authoring workspace" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(harness.shellResult.refetch).toHaveBeenCalledTimes(1);
  });
});
