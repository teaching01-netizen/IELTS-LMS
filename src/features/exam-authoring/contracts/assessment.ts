export type QuestionKind = "single_choice" | "student_produced_response";

export interface RichTextDocument {
  type: "doc";
  content?: RichTextNode[] | undefined;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: RichTextNode[] | undefined;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> | undefined }> | undefined;
  text?: string | undefined;
}

export interface StructuredContent {
  version: 1 | 2;
  nodes: ContentNode[];
  document?: RichTextDocument | undefined;
}

export type ContentNode =
  | { type: "paragraph"; id: string; text: string }
  | { type: "heading"; id: string; level: number; text: string }
  | { type: "equation"; id: string; latex: string; display: boolean }
  | { type: "image"; id: string; assetId: string; alt: string; caption?: string | null }
  | { type: "table"; id: string; rows: string[][] };

export interface ChoiceOption {
  id: string;
  content: StructuredContent;
}

export type AnswerDefinition =
  | {
      kind: "single_choice";
      options: ChoiceOption[];
      correctOptionId: string | null;
    }
  | {
      kind: "student_produced_response";
      acceptedResponses: string[];
      normalizeFraction: boolean;
      normalizeDecimal: boolean;
      numericTolerance: string | null;
    };

export type Difficulty = "easy" | "medium" | "hard";

export interface QuestionMetadata {
  sectionKey: string;
  domain: string | null;
  skill: string | null;
  difficulty: Difficulty;
  tags: string[];
}

export interface AccessibilityMetadata {
  longDescription: string | null;
}

export interface QuestionRevision {
  id: string;
  questionId: string;
  semanticRevision: number;
  revision: number;
  state: "draft" | "sealed";
  questionType: QuestionKind;
  stimulus: StructuredContent;
  prompt: StructuredContent;
  answer: AnswerDefinition;
  rationale: StructuredContent;
  metadata: QuestionMetadata;
  accessibility: AccessibilityMetadata;
}

export type SaveQuestionRevisionRequest = Omit<
  QuestionRevision,
  "id" | "questionId" | "semanticRevision" | "state"
>;

export type QuestionReadinessStatus = "ready" | "incomplete" | "error";

export interface QuestionReadinessSummary {
  status: QuestionReadinessStatus;
  blockingIssueCount: number;
  warningCount: number;
}

export interface AssessmentQuestionSummary {
  examQuestionId: string;
  questionId: string;
  questionRevisionId: string;
  displayOrder: number;
  isPretest: boolean;
  questionType: QuestionKind;
  semanticRevision: number;
  revision: number;
  readiness: QuestionReadinessSummary;
}

export interface AssessmentModuleShell {
  id: string;
  moduleKey: string;
  title: string;
  displayOrder: number;
  durationSeconds: number;
  targetQuestionCount: number;
  adaptiveRole: "none" | "base" | "lower_branch" | "higher_branch";
  toolPolicy: Record<string, unknown> | string[];
  revision: number;
  questions: AssessmentQuestionSummary[];
}

export interface AssessmentRoutingPolicyShell {
  id: string;
  baseModuleId: string;
  lowerModuleId: string;
  higherModuleId: string;
  policyKey: string;
  minimumCorrectForHigher: number;
  operationalQuestionCount: number;
  revision: number;
}

export interface AssessmentSectionShell {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  durationSeconds: number;
  breakAfterSeconds: number;
  revision: number;
  routingPolicy: AssessmentRoutingPolicyShell | null;
  modules: AssessmentModuleShell[];
}

export interface ModuleTimingUpdate {
  moduleId: string;
  durationSeconds: number;
  expectedRevision: number;
}

export interface UpdateSectionDeliverySettingsRequest {
  expectedSectionRevision: number;
  breakAfterSeconds: number;
  moduleTimings: ModuleTimingUpdate[];
  minimumCorrectForHigher: number;
  expectedRoutingRevision: number;
}

export interface AssessmentAuthoringShell {
  examId: string;
  providerKey: "sat";
  versionId: string;
  versionRevision: number;
  sections: AssessmentSectionShell[];
}

export interface AssessmentQuestionDetail {
  examQuestionId: string;
  moduleId: string;
  moduleKey: string;
  sectionKey: string;
  displayOrder: number;
  isPretest: boolean;
  question: QuestionRevision;
}

export type DeliveredAnswerDefinition =
  | { kind: "single_choice"; options: ChoiceOption[] }
  | {
      kind: "student_produced_response";
      normalizeFraction: boolean;
      normalizeDecimal: boolean;
      numericTolerance: string | null;
    };

export interface DeliveredQuestion {
  examQuestionId: string;
  questionId: string;
  displayOrder: number;
  isPretest: boolean;
  questionType: QuestionKind;
  stimulus: StructuredContent;
  prompt: StructuredContent;
  answer: DeliveredAnswerDefinition;
  metadata: QuestionMetadata;
  accessibility: AccessibilityMetadata;
}

export interface AssessmentValidationIssue {
  code: string;
  path: string;
  message: string;
  blocking: boolean;
  examQuestionId?: string;
  field?:
    | "stimulus"
    | "prompt"
    | "answer"
    | "rationale"
    | "domain"
    | "skill"
    | "asset"
    | "accessibility"
    | "structure";
}

export interface ReorderQuestionsRequest {
  expectedQuestionIds: string[];
  questionIds: string[];
}

export interface DuplicateQuestionRequest {
  destinationModuleId?: string;
  insertAfterExamQuestionId?: string;
}

export type BulkQuestionAction =
  | { type: "move"; destinationModuleId: string }
  | { type: "duplicate"; destinationModuleId: string }
  | { type: "set_pretest"; value: boolean }
  | { type: "delete" };

export interface BulkQuestionRequest {
  questionIds: string[];
  action: BulkQuestionAction;
}

export interface AssessmentValidationReport {
  examId: string;
  versionId: string;
  versionRevision: number;
  valid: boolean;
  errors: AssessmentValidationIssue[];
  warnings: AssessmentValidationIssue[];
}

export interface PublishAssessmentRequest {
  revision: number;
  expectedDraftVersionId: string;
  expectedDraftRevision: number;
  publishNotes?: string;
}

export interface PublishedAssessmentVersion {
  id: string;
  examId: string;
  versionNumber: number;
  revision: number;
  isDraft: boolean;
  isPublished: boolean;
  publishNotes?: string | null;
  createdAt: string;
}
