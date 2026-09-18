/**
 * "Where the author is looking" has ONE adoption path.
 *
 * A shell replacement (a newly opened draft version, a workbook import, the
 * sample exam) changes every placement id, and a deep link names a question
 * outright. Both used to set the two selection ids themselves, which skipped
 * `onQuestionAdopted` — the signal that clears the open draft — and left the
 * previous shell's question rendered beside the new shell. These tests pin that
 * every automatic path goes through the same adoption, so a draft can never
 * survive the shell it belonged to.
 */
import { renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentModuleShell,
  AssessmentQuestionSummary,
} from "../../contracts/assessment";
import { useAuthoringSelection } from "../useAuthoringSelection";

let currentSearch = "";

const LocationProbe = () => {
  currentSearch = useLocation().search;
  return null;
};

function question(examQuestionId: string, displayOrder = 1): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId: `question-${examQuestionId}`,
    questionRevisionId: `revision-${examQuestionId}`,
    displayOrder,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: examQuestionId,
    answerKeyPreview: "B",
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready" },
  };
}

function module(id: string, questions: AssessmentQuestionSummary[]): AssessmentModuleShell {
  return {
    id,
    moduleKey: id,
    title: id,
    displayOrder: 1,
    durationSeconds: 1_800,
    targetQuestionCount: questions.length,
    adaptiveRole: "none",
    toolPolicy: {},
    revision: 1,
    questions,
  };
}

function shell(versionId: string, modules: AssessmentModuleShell[]): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId,
    versionRevision: 1,
    sections: [
      {
        id: `section-${versionId}`,
        sectionKey: "reading-writing",
        title: "Reading and Writing",
        displayOrder: 1,
        durationSeconds: 1_800,
        breakAfterSeconds: 0,
        revision: 1,
        routingPolicy: null,
        modules,
      },
    ],
  };
}

function renderSelection(input: {
  shell: AssessmentAuthoringShell;
  onQuestionAdopted?: (id: string | null) => void;
  onDeepLinkField?: (path: string | null) => void;
  entries?: string[];
}) {
  currentSearch = "";
  const view = renderHook(
    (props: {
      shell: AssessmentAuthoringShell;
      onQuestionAdopted: (id: string | null) => void;
      onDeepLinkField: (path: string | null) => void;
    }) =>
      useAuthoringSelection({
        shell: props.shell,
        onQuestionAdopted: props.onQuestionAdopted,
        onDeepLinkField: props.onDeepLinkField,
      }),
    {
      initialProps: {
        shell: input.shell,
        onQuestionAdopted: input.onQuestionAdopted ?? (() => undefined),
        onDeepLinkField: input.onDeepLinkField ?? (() => undefined),
      },
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={input.entries ?? ["/sat/exams/exam-1"]}>
          <LocationProbe />
          {children}
        </MemoryRouter>
      ),
    },
  );
  return view;
}

describe("authoring selection adoption", () => {
  it("adopts the new shell's question through the same path as a click", () => {
    const onQuestionAdopted = vi.fn();
    const oldShell = shell("version-1", [module("old-module", [question("old-eq")])]);
    const newShell = shell("version-2", [module("new-module", [question("new-eq")])]);
    const { result, rerender } = renderSelection({
      shell: oldShell,
      onQuestionAdopted,
    });

    // First shell: the workspace lands on its first question.
    expect(onQuestionAdopted).toHaveBeenCalledWith("old-eq");
    expect(result.current.selectedExamQuestionId).toBe("old-eq");
    onQuestionAdopted.mockClear();

    // The published → draft cycle returns a shell of a DIFFERENT version, with
    // different placements for the same authoring content.
    rerender({
      shell: newShell,
      onQuestionAdopted,
      onDeepLinkField: () => undefined,
    });

    // The draft is cleared for the question being LEFT, not silently for the
    // new one: without this the previous version's question stayed open.
    expect(onQuestionAdopted).toHaveBeenCalledWith("new-eq");
    expect(result.current.selectedModuleId).toBe("new-module");
    expect(result.current.selectedExamQuestionId).toBe("new-eq");
  });

  it("adopts a deep-linked question through the same path and strips the link", () => {
    const onQuestionAdopted = vi.fn();
    const onDeepLinkField = vi.fn();
    const { result } = renderSelection({
      shell: shell("version-1", [
        module("module-1", [question("eq-1")]),
        module("module-2", [question("eq-22")]),
      ]),
      onQuestionAdopted,
      onDeepLinkField,
      entries: ["/sat/exams/exam-1?question=eq-22&field=prompt"],
    });

    // A deep link is an INPUT to the selection, not a second source of truth:
    // it adopts (clearing whatever draft was open) exactly like a click would.
    expect(onQuestionAdopted).toHaveBeenCalledWith("eq-22");
    expect(result.current.selectedModuleId).toBe("module-2");
    expect(result.current.selectedExamQuestionId).toBe("eq-22");
    expect(onDeepLinkField).toHaveBeenCalledWith("prompt");
    // Consumed once, then removed from the URL.
    expect(currentSearch).toBe("");
  });

  it("drops a deep link naming a question this shell does not contain", () => {
    const onQuestionAdopted = vi.fn();
    const onDeepLinkField = vi.fn();
    const { result } = renderSelection({
      shell: shell("version-1", [module("module-1", [question("eq-1")])]),
      onQuestionAdopted,
      onDeepLinkField,
      entries: ["/sat/exams/exam-1?question=eq-does-not-exist&field=prompt"],
    });

    expect(onQuestionAdopted).toHaveBeenCalledWith("eq-1");
    expect(result.current.selectedExamQuestionId).toBe("eq-1");
    expect(onDeepLinkField).not.toHaveBeenCalled();
  });
});
