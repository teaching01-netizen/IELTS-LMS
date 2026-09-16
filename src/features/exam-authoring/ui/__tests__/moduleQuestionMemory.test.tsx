import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
} from "../../contracts/assessment";
import {
  questionBelongsToModule,
  resolveModuleEntry,
  useModuleQuestionSelection,
  type ModuleQuestionMemory,
} from "../moduleQuestionMemory";

function summary(examQuestionId: string, questionId = `${examQuestionId}-base`): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId,
    questionRevisionId: `${questionId}-rev`,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: "Prompt",
    answerKeyPreview: "A",
    domain: "algebra",
    skill: "Linear equations",
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  };
}

function module(id: string, examQuestionIds: string[]): AssessmentModuleShell {
  return {
    id,
    moduleKey: id,
    title: id,
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount: examQuestionIds.length,
    adaptiveRole: "base",
    toolPolicy: {},
    revision: 1,
    questions: examQuestionIds.map((examQuestionId) => summary(examQuestionId)),
  };
}

const mathModule = module("math-m1", ["m-1", "m-2"]);
const rwModule = module("rw-m1", ["q-1", "q-2"]);

describe("resolveModuleEntry", () => {
  it("returns the question the module was left on", () => {
    const memory: ModuleQuestionMemory = new Map([["rw-m1", "q-2"]]);
    expect(resolveModuleEntry(memory, rwModule)).toBe("q-2");
  });

  it("falls back to the first question when nothing was remembered", () => {
    expect(resolveModuleEntry(new Map(), rwModule)).toBe("q-1");
  });

  it("falls back to the first question when the remembered one left the module", () => {
    // A deleted or moved question must not resolve to a question this module
    // does not have: that is how a Math question came to be open inside a
    // Reading & Writing module.
    const memory: ModuleQuestionMemory = new Map([["rw-m1", "m-1"]]);
    expect(resolveModuleEntry(memory, rwModule)).toBe("q-1");
  });

  it("answers nothing for a module with no questions", () => {
    expect(resolveModuleEntry(new Map(), module("empty", []))).toBeNull();
  });
});

describe("questionBelongsToModule", () => {
  it("is true only for the module's own questions", () => {
    expect(questionBelongsToModule(rwModule, "q-1")).toBe(true);
    expect(questionBelongsToModule(rwModule, "m-1")).toBe(false);
    expect(questionBelongsToModule(rwModule, null)).toBe(false);
  });
});

describe("useModuleQuestionSelection", () => {
  it("adopts the target module's question instead of keeping another module's", () => {
    const onAdoptQuestion = vi.fn();
    renderHook(() =>
      useModuleQuestionSelection({
        module: rwModule,
        selectedExamQuestionId: "m-1",
        onAdoptQuestion,
      }),
    );
    expect(onAdoptQuestion).toHaveBeenCalledWith("q-1");
  });

  it("keeps a selection that does belong to the module", () => {
    const onAdoptQuestion = vi.fn();
    renderHook(() =>
      useModuleQuestionSelection({
        module: rwModule,
        selectedExamQuestionId: "q-2",
        onAdoptQuestion,
      }),
    );
    expect(onAdoptQuestion).not.toHaveBeenCalled();
  });

  it("leaves the module's own questions, and a deliberate empty selection, alone", () => {
    // Nothing is invented: a module with no questions (or a question that was
    // just deleted) stays empty instead of silently opening another question.
    const onAdoptQuestion = vi.fn();
    const { rerender } = renderHook(
      (props: { module: AssessmentModuleShell | null; selectedExamQuestionId: string | null }) =>
        useModuleQuestionSelection({
          module: props.module,
          selectedExamQuestionId: props.selectedExamQuestionId,
          onAdoptQuestion,
        }),
      { initialProps: { module: rwModule, selectedExamQuestionId: null } },
    );
    rerender({ module: module("empty", []), selectedExamQuestionId: null });
    expect(onAdoptQuestion).not.toHaveBeenCalled();
  });

  it("does not touch anything while the shell has not resolved the module", () => {
    const onAdoptQuestion = vi.fn();
    renderHook(() =>
      useModuleQuestionSelection({
        module: null,
        selectedExamQuestionId: "m-1",
        onAdoptQuestion,
      }),
    );
    expect(onAdoptQuestion).not.toHaveBeenCalled();
  });

  it("returns to the question a module was left on", () => {
    const { result, rerender } = renderHook(
      (props: { module: AssessmentModuleShell; selectedExamQuestionId: string }) =>
        useModuleQuestionSelection({
          module: props.module,
          selectedExamQuestionId: props.selectedExamQuestionId,
          onAdoptQuestion: vi.fn(),
        }),
      { initialProps: { module: rwModule, selectedExamQuestionId: "q-1" } },
    );
    // The author works on q-2 in Reading & Writing, then leaves for Math.
    rerender({ module: rwModule, selectedExamQuestionId: "q-2" });
    rerender({ module: mathModule, selectedExamQuestionId: "m-1" });

    // Coming back to Reading & Writing lands on q-2, not on its first question.
    expect(result.current.entryQuestionFor(rwModule)).toBe("q-2");
    // Math kept its own place, and an unknown module still opens somewhere real.
    expect(result.current.entryQuestionFor(mathModule)).toBe("m-1");
    expect(result.current.entryQuestionFor(null)).toBeNull();
  });
});
