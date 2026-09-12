import { describe, expect, it } from "vitest";
import {
  ALL_QUESTION_TYPES,
  BROKEN_MEDIA,
  FIXTURE_MANIFEST,
  IME_DRAFT_SAMPLES,
  blockForType,
  longEssayDraft,
  makeActStimulus,
  makeExamFixture,
  makeGeneralTrainingPassage,
  makeIdenticalPromptTasks,
  makePassage,
  resetFixtureIds,
} from "../support/examFixtures";

/** P0.4 gate — the fixture manifest must stay complete and deterministic. */
describe("examFixtures manifest (P0.4)", () => {
  it("covers every supported QuestionType", () => {
    for (const type of ALL_QUESTION_TYPES) {
      const block = blockForType(type);
      expect(block.type, `${type} builder returns its own type`).toBe(type);
      expect(block.id, `${type} block carries a stable namespaced id`).toMatch(/^uxfx-/);
      expect(block.instruction.length, `${type} instruction is present`).toBeGreaterThan(0);
    }
  });

  it("keeps IDs deterministic across two build passes", () => {
    resetFixtureIds();
    const first = ALL_QUESTION_TYPES.map((type) => blockForType(type).id);
    resetFixtureIds();
    const second = ALL_QUESTION_TYPES.map((type) => blockForType(type).id);
    expect(first).toEqual(second);
  });

  it("provides identical prompts under distinct task IDs (P4.2 invariant)", () => {
    const [task1, task2] = makeIdenticalPromptTasks();
    expect(task1.prompt).toBe(task2.prompt);
    expect(task1.taskId).not.toBe(task2.taskId);
  });

  it("produces a 1,000+ word essay draft", () => {
    const draft = longEssayDraft();
    expect(draft.trim().split(/\s+/).length).toBeGreaterThanOrEqual(1000);
  });

  it("exposes IME, broken-media, and General Training invariants", () => {
    expect(IME_DRAFT_SAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(BROKEN_MEDIA.listeningAudio).toMatch(/^fixture:\/\//);
    expect(makeGeneralTrainingPassage().content).toContain("booking");
    expect(makePassage().content).toContain("<strong>A</strong>");
  });

  it("builds an ACT Science stimulus with a non-40 question count", () => {
    const stimulus = makeActStimulus({ questionCount: 35 });
    const questions = stimulus.blocks.flatMap((block) => block.questions);
    expect(questions.length).toBe(35);
    expect(stimulus.images?.[0]?.src).toBe(BROKEN_MEDIA.stimulusImage);
  });

  it("assembles a complete exam fixture for every provider type", () => {
    for (const type of ["Academic", "General Training", "ACT"] as const) {
      const exam = makeExamFixture({ type });
      expect(exam.type).toBe(type);
      expect(exam.content.config.general.type).toBe(type);
      expect(exam.content.config.general.ieltsMode).toBe(type !== "ACT");
    }
  });

  it("documents each invariant in the manifest", () => {
    expect(FIXTURE_MANIFEST.length).toBeGreaterThanOrEqual(8);
    for (const entry of FIXTURE_MANIFEST) {
      expect(entry.invariant.length, "every manifest entry names its invariant").toBeGreaterThan(10);
      expect(entry.builder.length).toBeGreaterThan(3);
    }
  });
});
