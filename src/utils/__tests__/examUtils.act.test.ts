import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../constants/examDefaults";
import {
  canPublishExam,
  getActScienceTotalQuestions,
  validateActScienceModule,
} from "../examUtils";
import {
  createActScienceBlock,
  createActScienceQuestion,
} from "../../components/ActScienceQuestionBuilderPane";
import type { ActScienceStimulus, Exam } from "../../types";

function buildActExam(questionCount: number): Exam {
  const questions = Array.from({ length: questionCount }, (_, index) => ({
    ...createActScienceQuestion(`question-${index + 1}`),
    stem: `Question ${index + 1}`,
  }));
  const block = createActScienceBlock("block-1");
  const stimulus: ActScienceStimulus = {
    id: "stimulus-1",
    title: "Experiment 1",
    content: "<p>Experiment data</p>",
    blocks: [
      {
        ...block,
        stem: questions[0]?.stem ?? "",
        options: questions[0]?.options ?? block.options,
        questions,
      },
    ],
  };
  const state = {
    title: "ACT Science Practice",
    type: "ACT" as const,
    activeModule: "science" as const,
    activePassageId: "",
    activeListeningPartId: "",
    activeScienceStimulusId: stimulus.id,
    config: createDefaultConfig("ACT", "ACT Science"),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: "",
      task2Prompt: "",
      part3Discussion: [],
      cueCard: "",
      part1Topics: [],
    },
    speaking: { part1Topics: [], cueCard: "", part3Discussion: [] },
    science: { stimuli: [stimulus] },
  };

  return {
    id: "exam-1",
    title: state.title,
    type: "ACT",
    status: "Draft",
    author: "Admin",
    lastModified: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    content: state,
  };
}

describe("ACT Science validation and question counting", () => {
  it("allows a complete 10-question draft to publish with a non-blocking 40-question warning", () => {
    const exam = buildActExam(10);
    const validation = validateActScienceModule(exam.content.science.stimuli);

    expect(getActScienceTotalQuestions(exam.content.science.stimuli)).toBe(10);
    expect(validation.some((error) => error.type === "error")).toBe(false);
    expect(validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "warning",
          message: expect.stringContaining("full-set target is 40"),
        }),
      ])
    );
    expect(canPublishExam(exam).canPublish).toBe(true);
  });

  it("blocks publishing when an ACT question does not have exactly four choices", () => {
    const exam = buildActExam(1);
    const stimulus = exam.content.science.stimuli[0];
    const block = stimulus?.blocks[0];
    const question = block?.questions?.[0];
    if (!stimulus || !block || !question) {
      throw new Error("Test fixture did not create an ACT question");
    }

    const invalidExam: Exam = {
      ...exam,
      content: {
        ...exam.content,
        science: {
          stimuli: [
            {
              ...stimulus,
              blocks: [
                {
                  ...block,
                  questions: [{ ...question, options: question.options.slice(0, 3) }],
                },
              ],
            },
          ],
        },
      },
    };

    expect(canPublishExam(invalidExam).canPublish).toBe(false);
  });
});
