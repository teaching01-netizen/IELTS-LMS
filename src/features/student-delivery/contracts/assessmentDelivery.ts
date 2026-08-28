import type {
  AccessibilityMetadata,
  ChoiceOption,
  DeliveredAnswerDefinition,
  DeliveredQuestion,
  QuestionKind,
  QuestionMetadata,
  StructuredContent,
} from '../../exam-authoring/api/assessmentContracts';

export type { DeliveredAnswerDefinition, DeliveredQuestion };

export interface AssessmentDeliveryModule {
  id: string;
  moduleKey: string;
  title: string;
  displayOrder: number;
  durationSeconds: number;
  targetQuestionCount: number;
  adaptiveRole: string;
  toolPolicy: Record<string, unknown> | string[];
  questions: DeliveredQuestion[];
}

export interface AssessmentDeliverySection {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  durationSeconds: number;
  breakAfterSeconds: number;
  modules: AssessmentDeliveryModule[];
}

export interface AssessmentModuleAttemptSnapshot {
  id: string;
  moduleId: string;
  state: string;
  allocatedSeconds: number;
  availableAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  accumulatedPausedSeconds: number;
  extensionSeconds: number;
  deadlineAt: string | null;
  remainingSeconds: number;
  completionReason: string | null;
  rawCorrect: number | null;
  operationalQuestionCount: number | null;
  toolState: Record<string, boolean>;
  revision: number;
}

export interface AssessmentResponseSnapshot {
  id: string;
  moduleAttemptId: string;
  examQuestionId: string;
  response: string | number | null;
  markedForReview: boolean;
  eliminatedOptions: string[];
  annotations: Record<string, unknown>;
  revision: number;
}

export interface AssessmentAttemptSnapshot {
  id: string;
  moduleAttempts: AssessmentModuleAttemptSnapshot[];
  responses: AssessmentResponseSnapshot[];
}

export interface AssessmentDeliveryBootstrap {
  scheduleId: string;
  examId: string;
  providerKey: 'sat';
  versionId: string;
  serverNow: string;
  scheduleRuntimeStatus: string;
  proctorStatus: string;
  proctorNote: string | null;
  deviceFingerprintHash: string | null;
  sections: AssessmentDeliverySection[];
  attempt: AssessmentAttemptSnapshot;
  result: AssessmentResult | null;
}

export interface AssessmentResponseRequest {
  revision: number;
  response: string | null;
  markedForReview: boolean;
  eliminatedOptions: string[];
  annotations: Record<string, unknown>;
}

export interface AssessmentModuleStartRequest {
  moduleId: string;
}

export interface AssessmentModuleSubmitRequest {
  moduleId: string;
}

export interface AssessmentSubmitRequest {
  submissionId: string;
}

export interface AssessmentSectionResult {
  sectionKey: string;
  route: 'lower' | 'higher' | null;
  rawCorrect: number;
  operationalQuestionCount: number;
  scaledScore: number | null;
  details: Record<string, unknown>;
}

export interface AssessmentResult {
  id: string;
  submissionId: string;
  providerKey: 'sat';
  totalScore: number | null;
  scorePayload: Record<string, unknown>;
  scoreKind: 'practice';
  sections: AssessmentSectionResult[];
}

export type AssessmentDeliveryQuestion = DeliveredQuestion & {
  questionType: QuestionKind;
  stimulus: StructuredContent;
  prompt: StructuredContent;
  metadata: QuestionMetadata;
  accessibility: AccessibilityMetadata;
  answer: DeliveredAnswerDefinition;
  options?: ChoiceOption[];
};
