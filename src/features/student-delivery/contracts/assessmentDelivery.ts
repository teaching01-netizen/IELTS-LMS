import type {
  AccessibilityMetadata,
  ChoiceOption,
  DeliveredAnswerDefinition,
  DeliveredAssessmentModule,
  DeliveredAssessmentSection,
  DeliveredQuestion,
  QuestionKind,
  QuestionMetadata,
  StructuredContent,
} from "../../exam-authoring/api/assessmentContracts";
import type { TimingModel } from "../../../types/domain";

export type { DeliveredAnswerDefinition, DeliveredQuestion };

export type AssessmentDeliveryModule = DeliveredAssessmentModule;
export type AssessmentDeliverySection = DeliveredAssessmentSection;

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
  remainingSeconds: number | null;
  /**
   * What entering this module will actually grant, on the room's clock: the
   * server's own StartModule clamp published BEFORE entry, so a late arrival is
   * not promised the authored length. Present only while the module has not
   * started — a started module's deadlineAt/remainingSeconds are the truth —
   * and absent on older payloads and on non-cohort providers.
   */
  entryWindowSeconds?: number | null;
  /** Personal-model future-start offer (absent on cohort and legacy payloads). */
  entryGeneration?: number | null;
  entryStartsAt?: string | null;
  entryConfirmedAt?: string | null;
  entryEnteredAt?: string | null;
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
  personalBreaks?: AssessmentPersonalBreakSnapshot[];
  /**
   * V2 provisional terminal claim already committed server-side
   * (delivery_status='submitted', submitted_at still NULL) while the scoring
   * result is absent. Recovery uses this to skip response resubmission and
   * drive straight to result completion (SAT-001). Absent on older payloads.
   */
  provisionalSubmitted?: boolean;
}

export interface AssessmentPersonalBreakSnapshot {
  id: string;
  afterSectionId: string;
  durationSeconds: number;
  state: "pending" | "armed" | "active" | "completed" | string;
  startsAt: string | null;
  deadlineAt: string | null;
  enteredAt: string | null;
  pausedAt: string | null;
  accumulatedPausedSeconds: number;
  entryGeneration: number;
  entryStartsAt: string | null;
  entryConfirmedAt: string | null;
  entryEnteredAt: string | null;
  remainingSeconds: number;
  revision: number;
}

export interface AssessmentTimingSnapshot {
  authority: "cohort_runtime" | "legacy_attempt";
  timingModel: TimingModel;
  stageKey: string | null;
  stageStatus: string | null;
  serverNow: string;
  deadlineAt: string | null;
  remainingSeconds: number;
  /**
   * Between-sections window only: the server's authoritative instant the next
   * section goes live (previous section end + its authored gap). Present while
   * the room is on the shared break; absent/null outside it, when the active
   * section's own deadlineAt is the live clock. The break countdown is driven
   * by this — the finished section's clock is already past and reads 0:00.
   */
  nextSectionStartAt?: string | null;
  /**
   * Between-sections state, mirrored from the runtime: the active section is
   * complete and the next has not gone live. This flag — not the mere
   * presence of nextSectionStartAt — is what opens the break window, so the
   * client reads the same state the server writes.
   */
  waitingForNextSection?: boolean;
  runtimeRevision: number;
}

/**
 * Phase 04 ACT reconciliation: provider union for the delivery bootstrap.
 * SAT remains the deployed provider; "act" is accepted so ACT Science
 * bootstraps validate without SAT regressions. Unknown providers stay
 * rejected by narrowing guards at consumption sites.
 */
export type AssessmentDeliveryProviderKey = "sat" | "act";

export function isAssessmentDeliveryProviderKey(value: unknown): value is AssessmentDeliveryProviderKey {
  return value === "sat" || value === "act";
}

export interface AssessmentDeliveryBootstrap {
  scheduleId: string;
  examId: string;
  providerKey: AssessmentDeliveryProviderKey;
  versionId: string;
  serverNow: string;
  candidateName: string;
  scheduleRuntimeStatus: string;
  timing: AssessmentTimingSnapshot;
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
  moduleAttemptId?: string;
  stageKey?: string | null;
  runtimeRevision?: number | null;
  clientWriteId?: string;
}

export interface AssessmentModuleStartRequest {
  moduleId: string;
  generation?: number;
  /**
   * The control epoch the client believed it held when it issued the command.
   * A pause/resume between belief and arrival bumps the attempt's epoch, so a
   * stale command is refused instead of arming a module under a frozen clock.
   */
  controlEpoch?: number;
}

export interface AssessmentModuleEntryRequest {
  moduleId: string;
  generation: number;
  controlEpoch?: number;
}

export interface AssessmentBreakEntryRequest {
  breakId: string;
  generation: number;
  controlEpoch?: number;
}

export interface AssessmentModuleSubmitRequest {
  moduleId: string;
}

export interface AssessmentSubmitRequest {
  submissionId: string;
}

export interface AssessmentSectionResult {
  sectionKey: string;
  route: "lower" | "higher" | null;
  rawCorrect: number;
  operationalQuestionCount: number;
  scaledScore: number | null;
  details: Record<string, unknown>;
}

export interface AssessmentResult {
  id: string;
  submissionId: string;
  providerKey: AssessmentDeliveryProviderKey;
  totalScore: number | null;
  scorePayload: Record<string, unknown>;
  scoreKind: "practice";
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
