import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// The commands own the ORCHESTRATION: the barrier, the flight guard, the
// announcement and the selection move. The transport and the cache effects are
// the composition root's, so they are faked here rather than exercised.
vi.mock("../../api/assessmentAuthoringApi", () => ({
  assessmentAuthoringApi: {
    deleteQuestion: vi.fn(async () => undefined),
    saveQuestionRevision: vi.fn(async () => ({ id: "rev-1", revision: 2 })),
  },
}));
vi.mock("../../api/authoringQueryEffects", () => ({
  authoringEffects: {
    questionRemoved: vi.fn(async () => undefined),
    shellChanged: vi.fn(async () => undefined),
  },
}));
import type { AssessmentModuleShell, AssessmentSectionShell, QuestionRevision } from "../../contracts/assessment";
import {
  useAuthoringQuestionCommands,
  type AuthoringQuestionCommandsInput,
} from "../useAuthoringQuestionCommands";

const revision = (id: string, revisionNumber = 1) =>
  ({
    id,
    revision: revisionNumber,
    metadata: { domain: "algebra", skill: "linear", difficulty: "easy" },
  }) as unknown as QuestionRevision;

function moduleShell(id: string, questionIds: string[], target = 4): AssessmentModuleShell {
  return {
    id,
    targetQuestionCount: target,
    questions: questionIds.map((examQuestionId) => ({ examQuestionId })),
  } as unknown as AssessmentModuleShell;
}

function sections(...modules: AssessmentModuleShell[]): AssessmentSectionShell[] {
  return [{ id: "sec-1", modules }] as unknown as AssessmentSectionShell[];
}

type CommandInput = AuthoringQuestionCommandsInput;

/** One override per group, so a test names the fact it is changing. */
interface CommandOverrides {
  identity?: Partial<CommandInput["identity"]>;
  selection?: Partial<CommandInput["selection"]>;
  draft?: Partial<CommandInput["draft"]>;
  collaboration?: Partial<CommandInput["collaboration"]>;
  durability?: Partial<CommandInput["durability"]>;
  reporting?: Partial<CommandInput["reporting"]>;
  mutations?: CommandInput["mutations"];
}

function setup(overrides: CommandOverrides = {}) {
  const setSelectedExamQuestionId = vi.fn();
  const setSelectedModuleId = vi.fn();
  const setDraft = vi.fn();
  const setSelectedIds = vi.fn();
  const setNavigationError = vi.fn();
  const announce = vi.fn();
  const clearSelectionAnchor = vi.fn();
  const flushBeforeNavigation = vi.fn(async () => true);
  const moduleA = moduleShell("mod-a", ["q-1", "q-2"]);
  const mutations: AuthoringQuestionCommandsInput["mutations"] = {
    createQuestion: vi.fn(async () => ({
      examQuestionId: "q-9",
      question: revision("rev-9"),
    })),
    batchCreate: vi.fn(async () => ({ createdQuestionIds: ["q-9"] })),
    duplicateQuestion: vi.fn(async () => ({
      examQuestionId: "q-3",
      question: revision("rev-3"),
    })),
    reorderQuestions: vi.fn(async () => undefined),
    bulkQuestions: vi.fn(async () => undefined),
    validateExam: vi.fn(async () => undefined),
  };

  const input: AuthoringQuestionCommandsInput = {
    identity: { examId: "exam-1", queryClient: {} as never, ...overrides.identity },
    selection: {
      selectedModuleId: "mod-a",
      selectedModule: moduleA,
      shellSections: sections(moduleA),
      selectedExamQuestionId: "q-1",
      setSelectedModuleId,
      setSelectedExamQuestionId,
      setSelectedIds,
      clearSelectionAnchor,
      ...overrides.selection,
    },
    draft: { draft: revision("rev-1"), keepMetadataForNext: true, setDraft, ...overrides.draft },
    collaboration: {
      workspaceCollaboration: null,
      coeditDisplayStatus: null,
      ...overrides.collaboration,
    },
    durability: {
      flushBeforeNavigation,
      commitAndAdvance: vi.fn(async () => ({ ok: true, isLatest: true })),
      ...overrides.durability,
    },
    reporting: {
      updateSummaryCache: vi.fn(),
      announce,
      setNavigationError,
      setWorkspaceMode: vi.fn(),
      setImportOpen: vi.fn(),
      ...overrides.reporting,
    },
    mutations: overrides.mutations ?? mutations,
  };

  const view = renderHook(() => useAuthoringQuestionCommands(input));
  return {
    view,
    announce,
    setDraft,
    setNavigationError,
    setSelectedExamQuestionId,
    setSelectedIds,
    clearSelectionAnchor,
    flushBeforeNavigation,
    mutations,
  };
}

describe("useAuthoringQuestionCommands", () => {
  it("creates a question only after the open draft is durable", async () => {
    const ctx = setup();
    const order: string[] = [];
    ctx.flushBeforeNavigation.mockImplementation(async () => {
      order.push("flush");
      return true;
    });
    (ctx.mutations.createQuestion as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("create");
      return { examQuestionId: "q-9", question: revision("rev-9") };
    });

    await act(() => ctx.view.result.current.createQuestion());

    expect(order).toEqual(["flush", "create"]);
    expect(ctx.setSelectedExamQuestionId).toHaveBeenCalledWith("q-9");
    expect(ctx.announce).toHaveBeenCalledWith("question.created", {
      questionId: "q-9",
      moduleId: "mod-a",
    });
  });

  it("refuses to create into a full module without spending a write", async () => {
    const full = moduleShell("mod-a", ["q-1", "q-2"], 2);
    const ctx = setup({ selection: { shellSections: sections(full), selectedModule: full } });

    await act(() => ctx.view.result.current.createQuestion());

    expect(ctx.mutations.createQuestion).not.toHaveBeenCalled();
    expect(ctx.flushBeforeNavigation).not.toHaveBeenCalled();
  });

  it("never issues a write when the durability barrier refuses", async () => {
    const ctx = setup();
    ctx.flushBeforeNavigation.mockResolvedValue(false);

    await act(() => ctx.view.result.current.createQuestion());
    const deleted = await act(() => ctx.view.result.current.deleteQuestion("q-2"));

    expect(ctx.mutations.createQuestion).not.toHaveBeenCalled();
    expect(deleted).toBe(false);
  });

  it("resolves the module that owns a named row, not the selected one", async () => {
    // A context-menu duplicate names a row the author is not on. Resolving from
    // the selection would move the new question into the wrong module.
    const moduleA = moduleShell("mod-a", ["q-1"]);
    const moduleB = moduleShell("mod-b", ["q-7"]);
    const ctx = setup({
      selection: {
        selectedModuleId: "mod-a",
        selectedModule: moduleA,
        shellSections: sections(moduleA, moduleB),
      },
    });

    await act(() => ctx.view.result.current.duplicateQuestion("q-7"));

    expect(ctx.mutations.duplicateQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ examQuestionId: "q-7" })
    );
  });

  it("ignores a row that is no longer in the tree", async () => {
    const ctx = setup();

    await act(() => ctx.view.result.current.duplicateQuestion("q-gone"));

    expect(ctx.mutations.duplicateQuestion).not.toHaveBeenCalled();
  });

  it("holds the flight guard across the whole duplicate, including a failure", async () => {
    const ctx = setup();
    let release: (() => void) | null = null;
    (ctx.mutations.duplicateQuestion as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          release = () => reject(new Error("network"));
        })
    );

    let pending: Promise<void> | null = null;
    await act(async () => {
      pending = ctx.view.result.current.duplicateQuestion("q-1");
      // A second command issued while the first is in flight must be refused:
      // two fast clicks used to be able to create two questions.
      await ctx.view.result.current.duplicateQuestion("q-2");
    });

    expect(ctx.mutations.duplicateQuestion).toHaveBeenCalledTimes(1);
    expect(ctx.view.result.current.rowMutationBusy).toBe(true);

    await act(async () => {
      release?.();
      await pending;
    });

    expect(ctx.view.result.current.rowMutationBusy).toBe(false);
    expect(ctx.setNavigationError).toHaveBeenCalledWith("network");
  });

  it("moves the selection to the delete fallback and drops the row from the multi-selection", async () => {
    const ctx = setup();

    const deleted = await act(() => ctx.view.result.current.deleteQuestion("q-1"));

    expect(deleted).toBe(true);
    // q-1 was the open question, so the survivor becomes the selection.
    expect(ctx.setSelectedExamQuestionId).toHaveBeenCalledWith("q-2");
    expect(ctx.setDraft).toHaveBeenCalledWith(null);
    expect(ctx.setSelectedIds).toHaveBeenCalledWith(expect.any(Function));
  });

  it("clears the multi-selection and the range anchor after a bulk action", async () => {
    const ctx = setup();

    await act(() =>
      ctx.view.result.current.bulkAction(["q-1", "q-2"], {
        type: "delete",
      } as never)
    );

    expect(ctx.setSelectedIds).toHaveBeenCalledWith(expect.any(Set));
    expect(ctx.clearSelectionAnchor).toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith("question.bulk_changed", expect.anything());
  });

  it("routes a fenced save's retry through the collaboration room instead of the queue", async () => {
    const retry = vi.fn();
    const ctx = setup({
      collaboration: { workspaceCollaboration: { retry } as never, coeditDisplayStatus: "error" },
    });

    await act(() => ctx.view.result.current.saveAndNext());

    expect(retry).toHaveBeenCalled();
    expect(ctx.view.result.current.rowMutationBusy).toBe(false);
  });

  it("does not open the next question when the durable write did not land", async () => {
    const ctx = setup({
      durability: { commitAndAdvance: vi.fn(async () => ({ ok: true, isLatest: false })) },
    });

    await act(() => ctx.view.result.current.saveAndNext());

    expect(ctx.setNavigationError).toHaveBeenCalledWith(
      "Save failed. The next question was not opened."
    );
    expect(ctx.setSelectedExamQuestionId).not.toHaveBeenCalled();
  });
});
