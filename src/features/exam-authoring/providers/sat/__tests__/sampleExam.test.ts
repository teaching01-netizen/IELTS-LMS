import { describe, expect, it } from "vitest";
import type { AssessmentAuthoringShell } from "../../../contracts/assessment";
import { plainTextFromContent } from "../../../editor/richContent";
import { SAT_BLUEPRINT } from "../satProvider";
import { buildCompleteSatSample } from "../sampleExam";

function shell(): AssessmentAuthoringShell {
  return {
    examId: "exam-sample",
    providerKey: "sat",
    versionId: "draft-v1",
    versionRevision: 9,
    sections: SAT_BLUEPRINT.map((section, sectionIndex) => ({
      id: `section-${section.key}`,
      sectionKey: section.key,
      title: section.title,
      displayOrder: sectionIndex,
      durationSeconds: section.modules[0]!.durationSeconds * 2,
      breakAfterSeconds: section.breakAfterSeconds,
      revision: 0,
      routingPolicy: null,
      modules: section.modules.map((module, moduleIndex) => ({
        id: `module-${module.key}`,
        moduleKey: module.key,
        title: module.title,
        displayOrder: moduleIndex,
        durationSeconds: module.durationSeconds,
        targetQuestionCount: module.questionCount,
        adaptiveRole: module.adaptiveRole,
        toolPolicy: module.tools,
        revision: 0,
        questions: [],
      })),
    })),
  };
}

describe("complete SAT sample fixture", () => {
  it("fills every authoring slot with valid original content", () => {
    const request = buildCompleteSatSample(shell());
    expect(request.expectedVersionId).toBe("draft-v1");
    expect(request.expectedVersionRevision).toBe(9);
    expect(request.modules).toHaveLength(6);
    expect(request.modules.reduce((sum, module) => sum + module.questions.length, 0)).toBe(147);
    expect(JSON.stringify(request).length).toBeLessThan(500_000);
    for (const module of request.modules) {
      expect(module.questions.filter((question) => question.isPretest)).toHaveLength(2);
      for (const question of module.questions) {
        expect(plainTextFromContent(question.prompt)).not.toBe("");
        expect(plainTextFromContent(question.rationale)).not.toBe("");
        expect(question.metadata.domain).toBeTruthy();
        expect(question.metadata.skill).toBeTruthy();
      }
    }
  });

  it("covers every Reading & Writing skill and both Math response kinds", () => {
    const request = buildCompleteSatSample(shell());
    const questions = request.modules.flatMap((module) => module.questions);
    const rwSkills = new Set(
      questions
        .filter((q) => q.metadata.sectionKey === "reading-writing")
        .map((q) => q.metadata.skill)
    );
    const mathQuestions = questions.filter((q) => q.metadata.sectionKey === "math");
    const mathKinds = new Set(mathQuestions.map((q) => q.questionType));
    const mathSkills = new Set(mathQuestions.map((q) => q.metadata.skill));
    expect(rwSkills.size).toBe(11);
    expect(mathSkills.size).toBe(20);
    expect(mathKinds).toEqual(new Set(["single_choice", "student_produced_response"]));
  });

  it("does not duplicate a complete stimulus and prompt across the sample", () => {
    const request = buildCompleteSatSample(shell());
    const bodies = request.modules.flatMap((module) =>
      module.questions.map(
        (question) =>
          `${plainTextFromContent(question.stimulus)}\n${plainTextFromContent(question.prompt)}`
      )
    );
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});
