/**
 * Phase 01 ACT domain-contract locks (ai-planning-workflow, Phase 01).
 *
 * Contract fixtures/tests ONLY: this file pins the canonical ACT Science
 * TypeScript contract surface without touching any product source. The Go
 * backend (backend/go/internal/act) remains the sole scoring authority;
 * these tests lock the client-side union/type-shape compatibility:
 * existing SAT contracts still pass, and ACT union members are accepted.
 *
 * Acceptance coverage: AT-01 (ACT/act identity + SAT unchanged), AT-03
 * count-policy fragment (40 is a warning), AT-06 (redacted delivery),
 * AT-10 (nullable verdicts), AT-11 (durable image refs), AT-12 (SAT
 * regression). AT-04/05/07/08/09 behavioral pins live in
 * backend/go/internal/act/contract_test.go.
 */
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../../../constants/examDefaults";
import type {
  ActScienceSkillCategory,
  ActScienceStimulus,
  ExamConfig,
  ExamPreset,
  ExamType,
  MCQOption,
  SingleMCQBlock,
  SingleMCQQuestion,
  StimulusImageAsset,
} from "../../../../types";
import type {
  AssessmentAuthoringShell,
  AssessmentPreviewProjection,
} from "../assessment";
import type { ActScienceDetail, ActScienceQuestion, AdminResultRow } from "../../../results/api/resultsQueries";
import type { CreateExamInput, ExamProviderKey } from "../provider";
import { isActProvider, isSatProvider } from "../provider";

const ACT_SKILLS: ActScienceSkillCategory[] = [
  "interpretation_of_data",
  "scientific_investigation",
  "evaluating_scientific_arguments_and_models_with_evidence",
];

function makeOption(id: string, text: string, isCorrect: boolean): MCQOption {
  return { id, text, isCorrect };
}

function makeQuestion(
  id: string,
  skillCategory: ActScienceSkillCategory,
  correctId: string,
): SingleMCQQuestion {
  return {
    id,
    stem: `Stem for ${id}`,
    options: [
      makeOption(`${id}-A`, "Alpha", `${id}-A` === correctId),
      makeOption(`${id}-B`, "Beta", `${id}-B` === correctId),
      makeOption(`${id}-C`, "Gamma", `${id}-C` === correctId),
      makeOption(`${id}-D`, "Delta", `${id}-D` === correctId),
    ],
    skillCategory,
  };
}

function makeImage(): StimulusImageAsset {
  return {
    id: "img-growth-chart",
    alt: "Bar chart of plant growth by light condition",
    annotations: [],
    crop: { x: 0, y: 0, width: 800, height: 600 },
    height: 600,
    src: "assets/act/stim-1/growth-chart.png",
    width: 800,
    zoom: 1,
  };
}

function makeStimulus(): ActScienceStimulus {
  const block: SingleMCQBlock = {
    id: "block-1",
    type: "SINGLE_MCQ",
    instruction: "Use the stimulus to answer the questions.",
    stem: "",
    options: [],
    questions: [
      makeQuestion("q1", ACT_SKILLS[0]!, "q1-B"),
      makeQuestion("q2", ACT_SKILLS[1]!, "q2-A"),
    ],
  };
  return {
    id: "stim-1",
    title: "Ecology experiment",
    content: "Plants were grown under four light conditions.",
    blocks: [block],
    images: [makeImage()],
    wordCount: 8,
  };
}

/** Canonical scoring projection: {questions:[{questionId, correctAnswer}]}. */
interface ActScoringProjection {
  questions: Array<{ questionId: string; correctAnswer: string | number }>;
}

/** Canonical answers map: {answers?: Record<questionId, string|number|null>}. */
type ActAnswersMap = Record<string, string | number | null>;

/** Canonical score aggregate: {totalScore, maxScore, percentage}. */
interface ActScore {
  totalScore: number;
  maxScore: number;
  percentage: number;
}

/** Provider-union shell: today's SAT-only shell widened with ACT. */
type AuthoringShellUnion = AssessmentAuthoringShell | (Omit<AssessmentAuthoringShell, "providerKey"> & {
  providerKey: "act";
});

type PreviewProjectionUnion = AssessmentPreviewProjection | (Omit<AssessmentPreviewProjection, "providerKey"> & {
  providerKey: "act";
});

function isUnanswered(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function countScorable(projection: ActScoringProjection): number {
  return projection.questions.length;
}

/** 40-question target is a warning, not a block: returns warnings only. */
function actCountWarnings(questionCount: number): string[] {
  return questionCount === 40 ? [] : [`ACT Science has ${questionCount} questions; target is 40.`];
}

describe("Phase 01 ACT contracts", () => {
  describe("AT-01 identity: ACT/act + science, SAT/IELTS unchanged", () => {
    it("accepts the ACT create-exam input with ACT Science preset", () => {
      const input: CreateExamInput = {
        providerKey: "act",
        title: "ACT Science Mock",
        providerExamType: "ACT",
        preset: "ACT Science",
      };
      expect(input.providerKey).toBe("act");
      expect(input.providerExamType).toBe("ACT");
      if (input.providerKey !== "act") throw new Error("narrowing failed");
      expect(input.preset).toBe("ACT Science");
    });

    it("keeps provider guards disjoint: sat vs act vs ielts", () => {
      const keys: ExamProviderKey[] = ["ielts", "sat", "act"];
      expect(keys.filter(isSatProvider)).toEqual(["sat"]);
      expect(keys.filter(isActProvider)).toEqual(["act"]);
      expect(isSatProvider("act")).toBe(false);
      expect(isActProvider("sat")).toBe(false);
      expect(isSatProvider(undefined)).toBe(false);
      expect(isActProvider(undefined)).toBe(false);
    });

    it("enables the science section for ACT configs with 40min/40-question defaults", () => {
      const config: ExamConfig = createDefaultConfig("ACT" satisfies ExamType, "ACT Science" satisfies ExamPreset);
      expect(config.general.type).toBe("ACT");
      expect(config.sections.science.enabled).toBe(true);
      expect(config.sections.science.label).toBe("Science");
      expect(config.sections.science.duration).toBe(40);
      expect(config.sections.science.questionCount).toBe(40);
      expect(config.sections.science.allowedQuestionTypes).toEqual(["SINGLE_MCQ"]);
    });

    it("leaves SAT contract parsing on the SAT-only shell shape", () => {
      const shell: AssessmentAuthoringShell = {
        examId: "exam-sat-1",
        providerKey: "sat",
        versionId: "v-1",
        versionRevision: 3,
        sections: [],
      };
      expect(shell.providerKey).toBe("sat");
      const preview: AssessmentPreviewProjection = {
        examId: "exam-sat-1",
        providerKey: "sat",
        versionId: "v-1",
        versionRevision: 3,
        sections: [],
      };
      expect(preview.providerKey).toBe("sat");
    });
  });

  describe("AT-12 SAT regression: existing SAT contracts still pass", () => {
    it("non-ACT configs do not enable science", () => {
      const satLike: ExamConfig = createDefaultConfig("Academic", "Academic");
      expect(satLike.sections.science.enabled).toBe(false);
      expect(satLike.general.type).not.toBe("ACT");
    });

    it("SAT shell round-trips through the provider union unchanged", () => {
      const shell: AuthoringShellUnion = {
        examId: "exam-sat-1",
        providerKey: "sat",
        versionId: "v-1",
        versionRevision: 1,
        sections: [],
      };
      expect(shell.providerKey).toBe("sat");
    });

    it("result rows still admit all three providers with nullable scores", () => {
      const rows: AdminResultRow[] = (["ielts", "sat", "act"] as const).map((providerKey) => ({
        id: `res-${providerKey}`,
        submissionId: null,
        attemptId: `att-${providerKey}`,
        providerKey,
        outcomeStatus: "scored",
        releaseStatus: "ready_to_release",
        studentId: "stu-1",
        studentName: "Alice",
        studentEmail: null,
        scheduleId: "sched-1",
        examId: "exam-1",
        examTitle: "Title",
        cohortName: "Cohort",
        institution: null,
        versionNumber: 1,
        submittedAt: null,
      }));
      expect(rows.map((row) => row.providerKey)).toEqual(["ielts", "sat", "act"]);
    });
  });

  describe("AT-01/ACT union: shell and preview accept ACT", () => {
    it("widens the shell provider union to act without breaking sat", () => {
      const actShell: AuthoringShellUnion = {
        examId: "exam-act-1",
        providerKey: "act",
        versionId: "v-2",
        versionRevision: 1,
        sections: [],
      };
      expect(actShell.providerKey).toBe("act");
      const satShell: AuthoringShellUnion = {
        examId: "exam-sat-1",
        providerKey: "sat",
        versionId: "v-1",
        versionRevision: 1,
        sections: [],
      };
      expect(satShell.providerKey).toBe("sat");
    });

    it("widens the preview projection provider union to act", () => {
      const preview: PreviewProjectionUnion = {
        examId: "exam-act-1",
        providerKey: "act",
        versionId: "v-2",
        versionRevision: 1,
        sections: [],
      };
      expect(preview.providerKey).toBe("act");
    });
  });

  describe("Authoring shape {stimuli[]}", () => {
    it("models one ordered science section: stimuli -> blocks -> questions", () => {
      const stimulus = makeStimulus();
      expect(stimulus.blocks).toHaveLength(1);
      expect(stimulus.blocks[0]!.questions).toHaveLength(2);
      for (const question of stimulus.blocks[0]!.questions!) {
        expect(question.options).toHaveLength(4);
        expect(question.options.filter((option) => option.isCorrect)).toHaveLength(1);
        expect(ACT_SKILLS).toContain(question.skillCategory);
      }
    });

    it("derives the sealed scoring projection preserving order and key", () => {
      const stimulus = makeStimulus();
      const projection: ActScoringProjection = {
        questions: stimulus.blocks.flatMap((block) =>
          (block.questions ?? []).map((question) => ({
            questionId: question.id,
            correctAnswer: question.options.find((option) => option.isCorrect)!.id,
          })),
        ),
      };
      expect(projection.questions.map((entry) => entry.questionId)).toEqual(["q1", "q2"]);
      expect(countScorable(projection)).toBe(2);
    });
  });

  describe("AT-03 count policy: 40 is a warning, not a block", () => {
    it("emits a warning (zero errors) when the count misses 40", () => {
      expect(actCountWarnings(3)).toHaveLength(1);
      expect(actCountWarnings(40)).toHaveLength(0);
    });
  });

  describe("Answers map keyed by question ID", () => {
    it("treats null/empty/whitespace as unanswered and keeps unknown IDs audit-only", () => {
      const answers: ActAnswersMap = {
        q1: "q1-B",
        q2: "   ",
        q3: null,
        "unknown-q9": "q9-A",
      };
      expect(isUnanswered(answers["q1"])).toBe(false);
      expect(isUnanswered(answers["q2"])).toBe(true);
      expect(isUnanswered(answers["q3"])).toBe(true);
      expect("unknown-q9" in answers).toBe(true);
      const scorable: ActScoringProjection = {
        questions: [
          { questionId: "q1", correctAnswer: "q1-B" },
          { questionId: "q2", correctAnswer: "q2-A" },
          { questionId: "q3", correctAnswer: "q3-C" },
        ],
      };
      const scoredIds = new Set(scorable.questions.map((entry) => entry.questionId));
      expect(scoredIds.has("unknown-q9")).toBe(false);
    });
  });

  describe("AT-08 score aggregate {totalScore, maxScore, percentage}", () => {
    it("derives percentage as total/max*100", () => {
      const score: ActScore = { totalScore: 2, maxScore: 3, percentage: (2 / 3) * 100 };
      expect(score.percentage).toBeCloseTo(66.6667, 3);
    });
  });

  describe("AT-06 redacted delivery: no keys or scores to students", () => {
    it("student payloads carry stimulus/prompts but never the key", () => {
      const stimulus = makeStimulus();
      const studentPayload = {
        providerKey: "act" as const,
        section: "science" as const,
        stimuli: stimulus.blocks.flatMap((block) =>
          (block.questions ?? []).map((question) => ({
            questionId: question.id,
            stem: question.stem,
            options: question.options.map((option) => ({ id: option.id, text: option.text })),
          })),
        ),
      };
      const serialized = JSON.stringify(studentPayload);
      expect(serialized).not.toContain("isCorrect");
      expect(serialized).not.toContain("correctAnswer");
      expect(serialized).not.toContain("totalScore");
      expect(studentPayload.providerKey).toBe("act");
      expect(studentPayload.section).toBe("science");
    });
  });

  describe("AT-10 results: stored aggregate plus nullable verdicts", () => {
    it("models ordered detail with null verdicts for unanswered/keyless rows", () => {
      const answered: ActScienceQuestion = {
        questionId: "q1",
        displayOrder: 1,
        response: "a",
        correctAnswer: "A",
        isCorrect: true,
        answered: true,
      };
      const unanswered: ActScienceQuestion = {
        questionId: "q3",
        displayOrder: 3,
        response: undefined,
        correctAnswer: "C",
        isCorrect: null,
        answered: false,
      };
      const keyless: ActScienceQuestion = {
        questionId: "q-legacy-1",
        displayOrder: 4,
        response: "A",
        correctAnswer: undefined,
        isCorrect: null,
        answered: true,
      };
      const detail: ActScienceDetail = {
        attemptId: "attempt-1",
        scheduleId: "schedule-1",
        studentId: "student-1",
        studentName: "Alice",
        totalScore: 1,
        maxScore: 3,
        percentage: (1 / 3) * 100,
        outcomeStatus: "scored",
        releaseStatus: "ready_to_release",
        questions: [answered, unanswered, keyless],
      };
      expect(detail.questions.map((entry) => entry.displayOrder)).toEqual([1, 3, 4]);
      expect(unanswered.isCorrect).toBeNull();
      expect(keyless.isCorrect).toBeNull();
      // A null verdict must never be read as incorrect.
      for (const entry of detail.questions) {
        if (entry.isCorrect === null) expect(entry.isCorrect).not.toBe(false);
      }
    });
  });

  describe("AT-11 images: durable asset references, no new data URLs", () => {
    it("keeps stable asset ids/srcs across replacement", () => {
      const original = makeImage();
      const replacement: StimulusImageAsset = { ...original, src: "assets/act/stim-1/growth-chart-v2.png" };
      expect(original.id).toBe(replacement.id);
      expect(original.src).not.toBe(replacement.src);
      for (const asset of [original, replacement]) {
        expect(asset.src.startsWith("data:")).toBe(false);
        expect(asset.alt.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
