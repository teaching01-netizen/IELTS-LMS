import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentPreviewProjection,
  DeliveredAssessmentModule,
  DeliveredAssessmentSection,
} from "../../../exam-authoring/api/assessmentContracts";
import { useSatPreviewController } from "../useSatPreviewController";

const getPreviewMock = vi.hoisted(() => vi.fn());
vi.mock("../../../exam-authoring/api/assessmentAuthoringApi", () => ({
  assessmentAuthoringApi: { getPreview: getPreviewMock },
}));

const emptyContent = { version: 1 as const, nodes: [] };
const question = (id: string, order: number, sectionKey: string) => ({
  examQuestionId: id,
  questionId: `question-${id}`,
  displayOrder: order,
  isPretest: false,
  questionType: "single_choice" as const,
  stimulus: emptyContent,
  prompt: emptyContent,
  answer: { kind: "single_choice" as const, options: [] },
  metadata: { sectionKey, domain: null, skill: null, difficulty: "medium" as const, tags: [] },
  accessibility: { longDescription: null },
});

const module = (
  id: string,
  title: string,
  order: number,
  adaptiveRole: string,
  sectionKey: string,
  tools: string[] = []
): DeliveredAssessmentModule => ({
  id,
  moduleKey: id,
  title,
  displayOrder: order,
  durationSeconds: 600,
  targetQuestionCount: 2,
  adaptiveRole,
  instructions: emptyContent,
  toolPolicy: tools,
  questions: [question(`${id}-q1`, 0, sectionKey), question(`${id}-q2`, 1, sectionKey)],
});

const section = (
  id: string,
  key: string,
  order: number,
  modules: DeliveredAssessmentModule[],
  breakAfterSeconds = 0
): DeliveredAssessmentSection => ({
  id,
  sectionKey: key,
  title: key === "math" ? "Math" : "Reading & Writing",
  displayOrder: order,
  durationSeconds: 1_200,
  breakAfterSeconds,
  instructions: emptyContent,
  modules,
});

const projection: AssessmentPreviewProjection = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "draft-v1",
  versionRevision: 4,
  sections: [
    section(
      "rw",
      "reading-writing",
      0,
      [
        module("rw-m1", "Module 1", 0, "base", "reading-writing"),
        module("rw-m2-lower", "Module 2", 1, "lower_branch", "reading-writing"),
        module("rw-m2-higher", "Module 2", 2, "higher_branch", "reading-writing"),
      ],
      600
    ),
    section("math", "math", 1, [
      module("math-m1", "Module 1", 0, "base", "math", ["calculator", "reference_sheet"]),
    ]),
  ],
};

describe("useSatPreviewController", () => {
  it("keeps general notes in the v2 aggregate across question navigation", async () => {
    const { result } = renderHook(() => useSatPreviewController("exam-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.commands.setNote("Compare the evidence"));
    act(() => result.current.commands.nextQuestion());
    act(() => result.current.commands.previousQuestion());
    expect(result.current.response?.annotations).toEqual({
      version: 2, annotations: [], legacyQuestionNote: "Compare the evidence",
    });
  });
  beforeEach(() => {
    getPreviewMock.mockReset();
    getPreviewMock.mockResolvedValue(projection);
  });

  it("exposes every adaptive branch and navigates modules and sections without runtime mutations", async () => {
    const { result } = renderHook(() => useSatPreviewController("exam-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.modules.map((candidate) => candidate.id)).toEqual([
      "rw-m1",
      "rw-m2-lower",
      "rw-m2-higher",
    ]);

    act(() => result.current.commands.nextModule());
    expect(result.current.module?.id).toBe("rw-m2-lower");
    act(() => result.current.commands.nextModule());
    expect(result.current.module?.id).toBe("rw-m2-higher");
    act(() => result.current.commands.nextSection());
    expect(result.current.section?.sectionKey).toBe("math");
    expect(result.current.tools).toEqual({ calculator: true, referenceSheet: true });

    act(() => result.current.commands.setAnswer("A"));
    expect(result.current.response?.answer).toBe("A");
    expect(getPreviewMock).toHaveBeenCalledTimes(1);
  });

  it("detects a changed draft on focus without silently replacing the visible projection", async () => {
    const changed = { ...projection, versionRevision: 5 };
    const { result } = renderHook(() => useSatPreviewController("exam-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    getPreviewMock.mockResolvedValueOnce(changed);

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.pendingRefresh?.versionRevision).toBe(5));
    expect(result.current.projection?.versionRevision).toBe(4);

    act(() => result.current.commands.applyPendingRefresh());
    expect(result.current.projection?.versionRevision).toBe(5);
  });

  it("forbids Math tools in a Reading and Writing draft even when its module advertises them", async () => {
    const draft = structuredClone(projection);
    draft.sections[0]!.modules[0]!.toolPolicy = ["calculator", "reference_sheet"];
    getPreviewMock.mockResolvedValue(draft);
    const { result } = renderHook(() => useSatPreviewController("exam-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tools).toEqual({ calculator: false, referenceSheet: false });
  });
});
