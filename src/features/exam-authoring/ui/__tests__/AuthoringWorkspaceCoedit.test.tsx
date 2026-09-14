/**
 * AuthoringWorkspace × prompt co-editing integration.
 *
 * Drives the REAL workspace, spine, composers, co-edit hook and provider class.
 * Only the transport boundary is faked: the Hocuspocus WebSocket provider, its
 * IndexedDB attachment, the private co-edit token POST, and the authoring event
 * socket (a different transport, present only for the capability flags). Every
 * behavior asserted below — the projection the composers emit, the partial save
 * the workspace performs, the save truth it renders, the recovery surface — is
 * produced by the shipped code.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  QuestionRevision,
  StructuredContent,
} from "../../contracts/assessment";
import { plainContentFromText } from "../../editor/richContent";
import { stateVectorHash } from "../../realtime/coedit/saveState";

const DOCUMENT_NAME = "coedit:v1:2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";

interface FakeTransport {
  name: string;
  document: Y.Doc;
  sentTokens: number;
  destroyed: boolean;
  /** The room reached initial sync. */
  sync: () => void;
  /** Transport status, as the real provider reports it. */
  status: (status: string) => void;
  /** The server acknowledged a committed state hash. */
  ack: (payload: { stateHash: string; questionRevision?: number }) => void;
  /** The service rejected the session (expired, or the room is gone). */
  authenticationFailed: () => void;
  /** The socket dropped. */
  drop: () => void;
  /** The service closed the room, carrying its reason on the wire. */
  close: (reason: string) => void;
  /** An arbitrary stateless frame, including frame types we do not define. */
  stateless: (payload: unknown) => void;
}

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
  useAuthoringRealtime: vi.fn(),
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
    saveQuestionRevisionFields: vi.fn(),
    deleteQuestion: vi.fn(),
  },
  backendPost: vi.fn(),
  transports: [] as FakeTransport[],
  tokenRequests: 0,
  spineProps: [] as { question: QuestionRevision; promptCollaboration?: unknown }[],
}));

vi.mock("@hocuspocus/provider", async () => {
  const Yjs = await import("yjs");
  // The real provider exposes a real y-protocols Awareness; the caret
  // extension writes to it, so a hand-rolled stub would break the binding.
  const { Awareness } = await import("y-protocols/awareness");
  class FakeHocuspocusProvider implements FakeTransport {
    readonly name: string;
    readonly document: Y.Doc;
    sentTokens = 0;
    destroyed = false;
    awareness: InstanceType<typeof Awareness>;
    private readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown> & { name: string }) {
      this.options = options;
      this.name = options.name;
      this.document = (options.document as Y.Doc) ?? new Yjs.Doc();
      this.awareness = new Awareness(this.document);
      harness.transports.push(this);
    }
    async sendToken(): Promise<void> {
      this.sentTokens += 1;
    }
    destroy(): void {
      this.destroyed = true;
      this.awareness.destroy();
    }
    sync(): void {
      (this.options["onSynced"] as (() => void) | undefined)?.();
    }
    status(status: string): void {
      (this.options["onStatus"] as ((a: { status: string }) => void) | undefined)?.({ status });
    }
    stateless(payload: unknown): void {
      (this.options["onStateless"] as ((a: { payload: string }) => void) | undefined)?.({
        payload: JSON.stringify(payload),
      });
    }
    ack(payload: { stateHash: string; questionRevision?: number }): void {
      this.stateless({
        type: "coedit.ack",
        documentName: this.name,
        stateHash: payload.stateHash,
        questionRevision: payload.questionRevision ?? 2,
        materializedRevision: payload.questionRevision ?? 2,
      });
    }
    authenticationFailed(): void {
      (this.options["onAuthenticationFailed"] as (() => void) | undefined)?.();
    }
    drop(): void {
      (this.options["onDisconnect"] as (() => void) | undefined)?.();
    }
    close(reason: string): void {
      (
        this.options["onClose"] as ((a: { event: { code: number; reason: string } }) => void) | undefined
      )?.({ event: { code: 1000, reason } });
    }
  }
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    async destroy(): Promise<void> {}
    async clearData(): Promise<void> {}
  },
}));

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendPost: (...args: unknown[]) => (harness.backendPost as never)(...args),
  backendGet: vi.fn(),
  backendPatch: vi.fn(),
  backendDelete: vi.fn(),
  hasBackendStatusCode: (error: unknown, statusCode: number) =>
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode === statusCode,
  isBackendNotFound: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode === 404,
}));

vi.mock("../../api/assessmentQueries", () => ({
  assessmentKeys: {
    shell: (examId: string) => ["assessment", examId, "shell"],
    release: (examId: string) => ["assessment", examId, "release"],
    readinessRoot: (examId: string) => ["assessment", examId, "readiness"],
    readiness: (examId: string, v: string, r: number) => ["assessment", examId, "readiness", v, r],
    question: (id: string) => ["assessment-question", id],
  },
  useAuthoringShell: (...a: unknown[]) => (harness.useAuthoringShell as never)(...a),
  useExamQuestion: (...a: unknown[]) => (harness.useExamQuestion as never)(...a),
  useCreateAssessmentQuestion: (...a: unknown[]) => (harness.useCreate as never)(...a),
  useBatchCreateAssessmentQuestions: (...a: unknown[]) => (harness.useBatchCreate as never)(...a),
  useDuplicateAssessmentQuestion: (...a: unknown[]) => (harness.useDuplicate as never)(...a),
  useReorderAssessmentQuestions: (...a: unknown[]) => (harness.useReorder as never)(...a),
  useBulkAssessmentQuestions: (...a: unknown[]) => (harness.useBulk as never)(...a),
  useAssessmentValidation: (...a: unknown[]) => (harness.useValidation as never)(...a),
  useAssessmentReleaseReadiness: (...a: unknown[]) => (harness.useReleaseReadiness as never)(...a),
  useLoadSatSampleExam: (...a: unknown[]) => (harness.useLoadSample as never)(...a),
  useEnsureDraftShell: (...a: unknown[]) => (harness.useEnsureDraft as never)(...a),
}));
vi.mock("../../api/assessmentAuthoringApi", () => ({ assessmentAuthoringApi: harness.api }));
vi.mock("../../hooks/useQuestionAutosave", () => ({
  useQuestionAutosave: (...a: unknown[]) => (harness.useQuestionAutosave as never)(...a),
}));
vi.mock("../../../auth/api/authSession", () => ({
  useOptionalAuthSession: (...a: unknown[]) => (harness.useOptionalAuthSession as never)(...a),
}));
// The authoring event socket is a different transport from the co-edit room;
// its only role here is the capability flags the co-edit gate reads.
vi.mock("../../realtime/useAuthoringRealtime", () => ({
  useAuthoringRealtime: (...a: unknown[]) => (harness.useAuthoringRealtime as never)(...a),
}));
vi.mock("../../providers/sat/satProvider", () => ({ validateSatQuestion: () => [] }));
vi.mock("../../providers/sat/contentTemplates", () => ({
  createSatSupportingMaterial: (kind: string) => plainContentFromText(kind),
}));
vi.mock("../spine/SpineQuestionView", async () => {
  const actual = await vi.importActual<typeof import("../spine/SpineQuestionView")>(
    "../spine/SpineQuestionView",
  );
  return {
    SpineQuestionView: (props: { question: QuestionRevision; promptCollaboration?: unknown }) => {
      harness.spineProps.push(props);
      return actual.SpineQuestionView(props as never);
    },
  };
});

import { AuthoringWorkspace } from "../AuthoringWorkspace";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeDraft(id: string, promptText: string): QuestionRevision {
  return {
    id,
    questionId: `q-${id}`,
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: plainContentFromText(""),
    prompt: plainContentFromText(promptText),
    answer: {
      kind: "single_choice" as const,
      options: ["A", "B", "C", "D"].map((letter) => ({
        id: letter,
        content: plainContentFromText(letter),
      })),
      correctOptionId: "A",
    },
    rationale: plainContentFromText(""),
    metadata: {
      sectionKey: "reading-writing",
      domain: null,
      skill: null,
      difficulty: "medium",
      tags: [],
    },
    accessibility: { longDescription: null },
  };
}

function makeSummary(examQuestionId: string, promptPreview: string): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId: `q-${examQuestionId}`,
    questionRevisionId: `rev-${examQuestionId}`,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview,
    answerKeyPreview: "A",
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  };
}

function makeShell(): AssessmentAuthoringShell {
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
            questions: [makeSummary("eq-1", "First prompt")],
          },
        ],
      },
    ],
  };
}

function promptText(content: StructuredContent): string {
  return (content.document?.content ?? [])
    .flatMap((node) => node.content ?? [])
    .map((node) => node.text ?? "")
    .join(" ");
}

/** Mutates the shared room document the way a collaborator's update would. */
function writeIntoRoom(transport: FakeTransport, text: string): void {
  const fragment = transport.document.getXmlFragment("prompt");
  transport.document.transact(() => {
    const body = new Y.XmlText();
    body.insert(0, text);
    if (fragment.length === 0) {
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [body]);
      fragment.insert(0, [paragraph]);
      return;
    }
    const paragraph = fragment.get(0) as Y.XmlElement;
    paragraph.insert(paragraph.length, [body]);
  });
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function setupDefaults(): void {
  window.localStorage.clear();
  harness.transports.length = 0;
  harness.spineProps.length = 0;
  harness.tokenRequests = 0;
  const shell = makeShell();
  const details: Record<string, AssessmentQuestionDetail> = {
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
  harness.details = details;
  harness.shellResult = { data: shell, isLoading: false, error: null, refetch: vi.fn() };

  const hookMocks = [
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
    harness.useReleaseReadiness,
    harness.useEnsureDraft,
    harness.useAuthoringRealtime,
  ];
  for (const fn of hookMocks) (fn as { mockReset: () => void }).mockReset();
  for (const fn of Object.values(harness.mutations)) (fn as { mockReset: () => void }).mockReset();
  for (const fn of Object.values(harness.api)) (fn as { mockReset: () => void }).mockReset();
  (harness.backendPost as { mockReset: () => void }).mockReset();

  const autosave = harness.autosave;
  for (const fn of [
    autosave.scheduleAutosave,
    autosave.flushNow,
    autosave.commitAndAdvance,
    autosave.retry,
  ])
    (fn as { mockReset: () => void }).mockReset();
  autosave.status = "saved";
  autosave.lastSavedAt = null;
  autosave.isOffline = false;
  autosave.hasPendingChanges = false;
  (autosave.flushNow as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    ok: true,
    isLatest: true,
  });
  (
    autosave.commitAndAdvance as unknown as { mockResolvedValue: (v: unknown) => void }
  ).mockResolvedValue({ ok: true, isLatest: true });

  harness.useAuthoringShell.mockImplementation(() => harness.shellResult);
  harness.useExamQuestion.mockImplementation((id: string | null) =>
    id && details[id]
      ? { data: details[id], error: null, refetch: vi.fn() }
      : { data: undefined, error: null, refetch: vi.fn() }
  );
  harness.useQuestionAutosave.mockImplementation(() => harness.autosave);
  // The write-capable role is one of the co-edit gates: a preview-only role
  // never opens a room, so the fixture must be an author.
  harness.useOptionalAuthSession.mockImplementation(() => ({
    session: { user: { id: "staff-1", role: "builder" } },
  }));
  harness.useAuthoringRealtime.mockImplementation(() => ({
    connectionState: "disabled",
    sendFrame: vi.fn(),
    selfConnectionId: null,
    isDirty: false,
  }));
  harness.useCreate.mockImplementation(() => ({ mutateAsync: harness.mutations.create, isPending: false }));
  harness.useBatchCreate.mockImplementation(() => ({
    mutateAsync: harness.mutations.batchCreate,
    isPending: false,
  }));
  harness.useDuplicate.mockImplementation(() => ({
    mutateAsync: harness.mutations.duplicate,
    isPending: false,
  }));
  harness.useReorder.mockImplementation(() => ({
    mutateAsync: harness.mutations.reorder,
    isPending: false,
  }));
  harness.useBulk.mockImplementation(() => ({ mutateAsync: harness.mutations.bulk, isPending: false }));
  harness.useValidation.mockImplementation(() => ({
    mutateAsync: harness.mutations.validate,
    isPending: false,
    data: null,
  }));
  harness.useLoadSample.mockImplementation(() => ({
    mutateAsync: harness.mutations.loadSample,
    isPending: false,
  }));
  harness.useReleaseReadiness.mockImplementation(() => ({ data: null, isPending: false }));
  harness.useEnsureDraft.mockImplementation(() => ({
    mutate: () => undefined,
    mutateAsync: (...args: unknown[]) => Promise.resolve(args),
    isPending: false,
    error: null,
  }));
  harness.mutations.validate.mockResolvedValue({ valid: true, errors: [], warnings: [] });
  harness.api.getSatWorkbookUndoState.mockResolvedValue(null);
  harness.api.getShell.mockImplementation(() => Promise.resolve(shell));

  // The token endpoint is the private boundary Go owns. The fake answers with
  // the real wire shape, including the opaque name the service parses.
  (harness.backendPost as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(
    () => {
      harness.tokenRequests += 1;
      return Promise.resolve({
        token: "coedit-token",
        documentName: DOCUMENT_NAME,
        serviceUrl: "ws://127.0.0.1:1235",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        schemaVersion: 1,
        fieldSet: "prompt",
        mode: "write",
        actorId: "staff-1",
        displayName: "Staff One",
        capability: true,
      });
    }
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_AUTHORING_REALTIME_EVENTS", "true");
  vi.stubEnv("VITE_AUTHORING_REALTIME_DELIVERY", "true");
  vi.stubEnv("VITE_AUTHORING_REALTIME_COEDITING", "true");
  setupDefaults();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

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

/** Renders the workspace and waits until the collaborative room owns the prompt. */
async function renderWithRoom(): Promise<{
  transport: FakeTransport;
  editor: HTMLElement;
  view: ReturnType<typeof render>;
}> {
  const view = render(tree());
  await waitFor(() => expect(harness.transports).toHaveLength(1), { timeout: 5_000 });
  const transport = harness.transports[0]!;
  await act(async () => {
    // A live socket, in both directions: synced and connected. Without the
    // status the save state correctly refuses to claim anything (it reports an
    // unconnected room), which is not the condition these tests are about.
    transport.status("connected");
    transport.sync();
  });
  await waitFor(() => expect(harness.spineProps.at(-1)?.promptCollaboration).toBeTruthy());
  const editor = await screen.findByRole("textbox", { name: "Question prompt" });
  return { transport, editor, view };
}

function autosaveOptions(): {
  save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
} {
  const calls = harness.useQuestionAutosave.mock.calls;
  return calls[calls.length - 1]![0] as {
    save: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  };
}

function currentDraft(): QuestionRevision {
  const props = harness.spineProps.at(-1);
  if (!props) throw new Error("the spine has not rendered a draft yet");
  return props.question;
}

function saveStatusText(): string {
  return screen
    .queryAllByText(/Saved|Saving…|Editing|Not saved/)
    .map((node) => node.textContent ?? "")
    .join(" | ");
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("AuthoringWorkspace × prompt co-editing", () => {
  it("threads the room binding into the spine when every gate is on", async () => {
    const { transport } = await renderWithRoom();
    const binding = harness.spineProps.at(-1)?.promptCollaboration as
      | { ready: boolean; readOnly: boolean; extensions: unknown[] }
      | undefined;
    expect(binding).toBeTruthy();
    expect(binding?.ready).toBe(true);
    expect(binding?.readOnly).toBe(false);
    expect(binding?.extensions.length).toBeGreaterThan(0);
    expect(transport.name).toBe(DOCUMENT_NAME);
    expect(harness.tokenRequests).toBe(1);
    expect(screen.getAllByText("Saving…")).toHaveLength(1);
    expect(screen.queryByText("Who's here")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Carry metadata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and move to the next question" })).toBeInTheDocument();
  });

  describe("the partial, prompt-free save", () => {
    it("sends exactly the changed allow-listed fields and never the prompt", async () => {
      await renderWithRoom();
      const draft = currentDraft();
      const edited: QuestionRevision = {
        ...draft,
        metadata: { ...draft.metadata, difficulty: "hard" },
      };
      harness.api.saveQuestionRevisionFields.mockResolvedValue({ ...edited, revision: 2 });

      await act(async () => {
        await autosaveOptions().save(edited);
      });

      expect(harness.api.saveQuestionRevisionFields).toHaveBeenCalledTimes(1);
      const [revisionId, request] = harness.api.saveQuestionRevisionFields.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(revisionId).toBe(draft.id);
      // Exactly one field, plus the fencing counter — not a whole revision.
      expect(Object.keys(request).sort()).toEqual(["metadata", "revision"]);
      expect(request["revision"]).toBe(draft.revision);
      // The legacy whole-revision save is never used while a room owns the prompt.
      expect(harness.api.saveQuestionRevision).not.toHaveBeenCalled();
    });

    it("writes nothing at all for a prompt-only change", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));

      let result: QuestionRevision | void | undefined;
      await act(async () => {
        result = await autosaveOptions().save(currentDraft());
      });

      expect(harness.api.saveQuestionRevisionFields).not.toHaveBeenCalled();
      expect(harness.api.saveQuestionRevision).not.toHaveBeenCalled();
      // `undefined` is the contract the autosave caller turns into "durably
      // handled": no write happened, so nothing is claimed.
      expect(result).toBeUndefined();
    });

    it("keeps the author's newer prompt projection after a partial save", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));

      // The server's materialized projection still carries the older text: the
      // store that would advance it has not landed yet.
      const draft = currentDraft();
      harness.api.saveQuestionRevisionFields.mockResolvedValue({
        ...draft,
        revision: 2,
        metadata: { ...draft.metadata, difficulty: "hard" },
        prompt: plainContentFromText("First prompt"),
      });

      await act(async () => {
        await autosaveOptions().save({
          ...draft,
          metadata: { ...draft.metadata, difficulty: "hard" },
        });
      });

      // The revision advanced, but the projection the editors and the validator
      // read must NOT move backwards to a stale server projection: while the
      // room is open the Y.Doc is the source of truth for the prompt.
      expect(currentDraft().revision).toBe(2);
      expect(promptText(currentDraft().prompt)).toContain("typed in the room");
    });
  });

  describe("autosave ownership", () => {
    it("suppresses the legacy autosave for a prompt-only edit", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));
      // The composers really did emit the change; only the WRITE is withheld.
      expect(harness.autosave.scheduleAutosave).not.toHaveBeenCalled();
    });

    it("still schedules the legacy autosave for a non-prompt field edit", async () => {
      await renderWithRoom();
      fireEvent.click(await screen.findByRole("radio", { name: /choice b/i }));

      await waitFor(() => expect(harness.autosave.scheduleAutosave).toHaveBeenCalledTimes(1));
      const scheduled = harness.autosave.scheduleAutosave.mock.calls[0]![0] as QuestionRevision;
      expect(scheduled.answer.kind === "single_choice" && scheduled.answer.correctOptionId).toBe("B");
    });
  });

  describe("one save truth", () => {
    it("does not report Saved while the collaborative prompt is unacknowledged", async () => {
      const { transport } = await renderWithRoom();
      // The legacy half is perfectly saved; the room's half is not.
      expect(harness.autosave.status).toBe("saved");
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));
      expect(saveStatusText()).not.toContain("Saved");
    });

    it("does not report Saved while the legacy field save is pending", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await act(async () => {
        transport.ack({ stateHash: stateVectorHash(Y.encodeStateVector(transport.document)) });
      });
      await waitFor(() => expect(saveStatusText()).toContain("Saved"));

      // Now the room is saved and the field save is not. One writer claiming
      // the other's work would say Saved again.
      harness.autosave.status = "unsaved";
      fireEvent.click(await screen.findByRole("radio", { name: /choice c/i }));

      await waitFor(() => expect(saveStatusText()).not.toContain("Saved"));
    });

    it("reports Saved only once both writers are saved", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      // Unacknowledged: no claim of durability yet.
      expect(saveStatusText()).not.toContain("Saved");
      await act(async () => {
        transport.ack({ stateHash: stateVectorHash(Y.encodeStateVector(transport.document)) });
      });
      await waitFor(() => expect(saveStatusText()).toContain("Saved"));
    });
  });

  describe("recovery surface", () => {
    it("does not open a legacy prompt writer when room creation fails", async () => {
      harness.backendPost.mockRejectedValueOnce(new Error("service unavailable"));
      render(tree());

      await waitFor(() => {
        const binding = harness.spineProps.at(-1)?.promptCollaboration as
          | { ready: boolean; readOnly: boolean }
          | undefined;
        expect(binding?.ready).toBe(false);
        expect(binding?.readOnly).toBe(true);
      });
      expect(await screen.findByText("Couldn’t save · Retry")).toBeInTheDocument();
      expect(screen.queryByText(/service unavailable/i)).toBeNull();
    });

    it("explains a rejected session and re-mints on Retry", async () => {
      const { transport } = await renderWithRoom();
      const before = harness.tokenRequests;
      await act(async () => {
        transport.authenticationFailed();
      });

      expect(await screen.findByText("Couldn’t save · Retry")).toBeInTheDocument();
      // The failure also shows in the single save vocabulary, not only in the
      // banner: a refused session has no acknowledgement coming, so the area
      // must not claim durability for the work it is still holding.
      expect(saveStatusText()).not.toContain("Saved");

      fireEvent.click(screen.getByRole("button", { name: /Couldn’t save.*Retry save/i }));
      await waitFor(() => expect(harness.tokenRequests).toBeGreaterThan(before));
    });

    it("does not present a plain disconnect as a lifecycle failure", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        transport.drop();
      });
      // Losing the socket is an unsaved/reconnecting condition, not a room that
      // cannot continue: no failure banner, no export offer.
      expect(screen.queryByText(/requesting a new session/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy prompt" })).toBeNull();
      expect(saveStatusText()).not.toContain("Saved");
    });

    it("uses human offline and reconnecting copy without generic connection labels", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        transport.drop();
      });
      expect(await screen.findByText("Offline · Changes kept on this device")).toBeInTheDocument();
      expect(screen.queryByText(/^Online$/)).toBeNull();
      expect(screen.queryByText(/^Connected$/)).toBeNull();

      await act(async () => {
        transport.status("connecting");
      });
      expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
    });

    it("projects a retryable persistence failure as an inline retry action", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        transport.stateless({
          type: "coedit.save_failed",
          documentName: DOCUMENT_NAME,
          retryable: true,
        });
      });
      expect(await screen.findByText("Couldn’t save · Retry")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Couldn’t save.*Retry save/i })).toBeInTheDocument();
    });

    it("offers the prompt export when the service closes a replaced room", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      const written: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (value: string) => (written.push(value), Promise.resolve()) },
      });

      await act(async () => {
        transport.close("coedit:draft_replaced");
      });

      // The design: a replaced draft freezes the old editor and offers
      // copy/export of the prompt before the new draft opens.
      const recovery = await screen.findByTestId("coedit-recovery-surface");
      expect(recovery).toHaveTextContent(
        "A newer version is active. Your unsaved changes are still available.",
      );
      expect(within(recovery).getByRole("button", { name: "Open current draft" })).toBeInTheDocument();
      expect(within(recovery).getByRole("button", { name: "Review my changes" })).toBeInTheDocument();
      const copy = within(recovery).getByRole("button", { name: "Copy my work" });
      // Frozen, not silently writable: the room no longer accepts writes.
      const binding = harness.spineProps.at(-1)?.promptCollaboration as
        | { readOnly: boolean }
        | undefined;
      expect(binding?.readOnly).toBe(true);
      expect(saveStatusText()).not.toContain("Saved");

      fireEvent.click(copy);
      await waitFor(() => expect(written).toHaveLength(1));
      // The export is the room's own content, not a stale HTTP projection.
      expect(written[0]).toContain("typed in the room");
    });

    it("offers the export for a room closed by any other lifecycle reason", async () => {
      const { transport } = await renderWithRoom();
      await act(async () => {
        transport.close("coedit:exam_published");
      });
      await waitFor(() => expect(screen.getByText("View only")).toBeInTheDocument());
      expect(screen.queryByTestId("coedit-recovery-surface")).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy my work" })).toBeNull();
      const binding = harness.spineProps.at(-1)?.promptCollaboration as
        | { readOnly: boolean }
        | undefined;
      expect(binding?.readOnly).toBe(true);
    });

    it("applies the durable draft.replaced signal when the socket close is lost", async () => {
      await renderWithRoom();
      const options = harness.useAuthoringRealtime.mock.calls.at(-1)![0] as {
        onLifecycle: (signal: string) => void;
      };

      await act(async () => {
        options.onLifecycle("draft-replaced");
      });

      const recovery = await screen.findByTestId("coedit-recovery-surface");
      expect(recovery).toHaveTextContent(
        "A newer version is active. Your unsaved changes are still available.",
      );
      expect(within(recovery).getByRole("button", { name: "Open current draft" })).toBeInTheDocument();
      expect(within(recovery).getByRole("button", { name: "Review my changes" })).toBeInTheDocument();
      expect(within(recovery).getByRole("button", { name: "Copy my work" })).toBeInTheDocument();
    });

    it("keeps a close with no lifecycle reason on the offline path", async () => {
      const { transport } = await renderWithRoom();
      // Hocuspocus' own close reasons (e.g. its "Reset Connection" sweep) are
      // transport events: they carry no lifecycle prefix and must not be
      // mistaken for a service decision.
      await act(async () => {
        transport.close("Reset Connection");
      });

      expect(screen.queryByRole("button", { name: "Copy prompt" })).toBeNull();
      expect(screen.queryByTestId("coedit-recovery-surface")).toBeNull();
      expect(saveStatusText()).not.toContain("Saved");
    });

    it("freezes the mounted editor through the private publish lifecycle and restores it on active", async () => {
      const { transport } = await renderWithRoom();
      const lifecycle = {
        type: "coedit.lifecycle",
        documentName: DOCUMENT_NAME,
        phase: "freezing",
        reason: "publish",
      } as const;

      await act(async () => {
        transport.stateless(lifecycle);
      });
      await waitFor(() => {
        const binding = harness.spineProps.at(-1)?.promptCollaboration as
          | { readOnly: boolean }
          | undefined;
        expect(binding?.readOnly).toBe(true);
      });
      expect(await screen.findByText("Finishing changes…")).toBeInTheDocument();

      await act(async () => {
        transport.stateless({ ...lifecycle, phase: "active" });
      });
      await waitFor(() => {
        const binding = harness.spineProps.at(-1)?.promptCollaboration as
          | { readOnly: boolean }
          | undefined;
        expect(binding?.readOnly).toBe(false);
      });
      expect(screen.queryByText("Finishing changes…")).toBeNull();

      // A malformed lifecycle frame is advisory noise and cannot change the
      // provider's editability.
      await act(async () => {
        transport.stateless({ type: "coedit.lifecycle", documentName: DOCUMENT_NAME, phase: "frozen", reason: "publish" });
      });
      await waitFor(() => {
        const binding = harness.spineProps.at(-1)?.promptCollaboration as
          | { readOnly: boolean }
          | undefined;
        expect(binding?.readOnly).toBe(false);
      });
    });
  });

  it("shows a collaborator's edit in the live editor and the projection", async () => {
    const { transport, editor } = await renderWithRoom();
    // The room's document is the source of truth while it is open: the editor
    // is NOT seeded from the props. Nothing has been stored for this room yet,
    // so it is empty here (the service seeds the room on first open).
    expect(editor.textContent).toBe("");

    await act(async () => {
      writeIntoRoom(transport, "typed in the room");
    });

    // The real path a second author's keystroke takes: their Yjs update enters
    // the shared document, the bound editor renders it, and the projection the
    // workspace reads follows.
    await waitFor(() => expect(editor.textContent).toBe("typed in the room"));
    expect(promptText(currentDraft().prompt)).toContain("typed in the room");
  });

  describe("refetch guard while the room owns the prompt", () => {
    it("does not let a refetch replace the newer local prompt", async () => {
      const { transport, view } = await renderWithRoom();
      await act(async () => {
        writeIntoRoom(transport, "typed in the room");
      });
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));

      // A refetch lands with a different server revision while the room is open.
      harness.details["eq-1"] = {
        ...harness.details["eq-1"]!,
        question: { ...makeDraft("rev-1", "Rewritten on the server"), revision: 2 },
      };
      await act(async () => {
        view.rerender(tree());
      });

      // The draft is content-dirty versus its base even though the legacy
      // autosave has nothing pending, so the refetch-replace path must stand
      // down: otherwise the newer prompt projection is silently discarded.
      await waitFor(() => expect(promptText(currentDraft().prompt)).toContain("typed in the room"));
      expect(promptText(currentDraft().prompt)).not.toContain("Rewritten on the server");
    });
  });
});
