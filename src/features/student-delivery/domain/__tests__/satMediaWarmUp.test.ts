import { describe, expect, it } from "vitest";
import type { StructuredContent } from "../../../exam-rendering/api/assessmentContracts";
import { satMediaWarmUp, type SatMediaQuestion } from "../satMediaWarmUp";

function figures(...assetIds: string[]): StructuredContent {
  return {
    version: 2,
    nodes: [],
    document: { type: "doc", content: assetIds.map((assetId) => ({ type: "image", attrs: { assetId } })) },
  };
}

function question(
  examQuestionId: string,
  stimulus: string[],
  options?: string[][],
): SatMediaQuestion {
  return {
    examQuestionId,
    stimulus: figures(...stimulus),
    prompt: figures(),
    answer: options
      ? { kind: "single_choice", options: options.map((ids, index) => ({ id: `${examQuestionId}-${index}`, content: figures(...ids) })) }
      : { kind: "student_produced_response", normalizeFraction: true, normalizeDecimal: true, numericTolerance: null },
  };
}

const moduleQuestions = [
  question("q1", ["a1"]),
  question("q2", ["a2"], [["o2-a"], [], ["o2-c"]]),
  question("q3", []),
  question("q4", ["a4", "a1"]),
  question("q5", ["a5"]),
];

describe("satMediaWarmUp", () => {
  it("puts the question on screen first, then the questions after it, then wraps round", () => {
    expect(satMediaWarmUp(moduleQuestions, "q4")).toEqual({
      onScreen: ["a4", "a1"],
      rest: ["a5", "a2", "o2-a", "o2-c"],
    });
  });

  it("includes figures inside answer choices", () => {
    expect(satMediaWarmUp(moduleQuestions, "q2").onScreen).toEqual(["a2", "o2-a", "o2-c"]);
  });

  it("lists a figure shared by several questions once", () => {
    const { onScreen, rest } = satMediaWarmUp(moduleQuestions, "q5");
    expect(rest).toEqual(["a1", "a2", "o2-a", "o2-c", "a4"]);
    expect(new Set([...onScreen, ...rest]).size).toBe(onScreen.length + rest.length);
  });

  it("starts from the first question when none is on screen", () => {
    expect(satMediaWarmUp(moduleQuestions, null)).toEqual({
      onScreen: [],
      rest: ["a1", "a2", "o2-a", "o2-c", "a4", "a5"],
    });
  });

  it("leaves out images the browser loads directly", () => {
    const direct = [question("q1", ["data:image/png;base64,AAAA", "https://cdn.example.test/f.png", "a1"])];
    expect(satMediaWarmUp(direct, "q1")).toEqual({ onScreen: ["a1"], rest: [] });
  });
});
