import type {
  AuthoringEntityRef,
  AuthoringEventFrame,
  AuthoringEventKind,
  AuthoringEventV1,
} from "../contracts";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
} from "../../contracts/assessment";

const questionEntity: AuthoringEntityRef = {
  kind: "question",
  examQuestionId: "eq-1",
  questionId: "q-1",
  moduleId: "m-1",
};

export function entityForKind(kind: AuthoringEventKind): AuthoringEntityRef {
  switch (kind) {
    case "exam.changed":
    case "exam.published":
      return { kind: "exam", examId: "exam-1" };
    case "draft.opened":
    case "draft.replaced":
      return { kind: "draft", examId: "exam-1", draftVersionId: "draft-7" };
    default:
      return questionEntity;
  }
}

export function makeEvent(overrides: Partial<AuthoringEventV1> = {}): AuthoringEventV1 {
  return {
    version: 1,
    kind: "question.changed",
    eventId: "evt-1",
    occurredAt: "2026-09-12T00:00:00.000Z",
    actor: { id: "user-alice", kind: "staff" },
    scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-7" },
    entity: questionEntity,
    revision: 3,
    draftRevision: 194,
    changedFields: ["prompt"],
    ...overrides,
  };
}

export function makeEventFrame(
  cursor: number,
  overrides: Partial<AuthoringEventV1> = {},
): AuthoringEventFrame {
  return { type: "authoring.event", v: 1, cursor, event: makeEvent(overrides) };
}

export function makeSummary(
  examQuestionId: string,
  displayOrder = 0,
): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId: `q-${examQuestionId}`,
    questionRevisionId: `rev-${examQuestionId}`,
    displayOrder,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: "preview",
    answerKeyPreview: null,
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  } as AssessmentQuestionSummary;
}

export function makeShell(ids: string[], draftVersionId = "draft-7"): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId: draftVersionId,
    versionRevision: 5,
    sections: [
      {
        id: "sec-1",
        sectionKey: "rw",
        title: "Reading & Writing",
        displayOrder: 1,
        durationSeconds: 1920,
        breakAfterSeconds: 600,
        revision: 1,
        routingPolicy: null,
        modules: [
          {
            id: "mod-1",
            moduleKey: "rw-1",
            title: "Module 1",
            displayOrder: 1,
            durationSeconds: 1920,
            targetQuestionCount: 27,
            adaptiveRole: "none",
            toolPolicy: {},
            revision: 1,
            questions: ids.map((id, index) => makeSummary(id, index)),
          },
        ],
      },
    ],
  } as AssessmentAuthoringShell;
}

export function makeQuestionDetail(examQuestionId: string): AssessmentQuestionDetail {
  return {
    examQuestionId,
    moduleId: "mod-1",
    moduleKey: "rw-1",
    sectionKey: "rw",
    displayOrder: 0,
    isPretest: false,
    question: {},
  } as unknown as AssessmentQuestionDetail;
}
