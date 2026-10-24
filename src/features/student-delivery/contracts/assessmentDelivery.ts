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
import type { ResponseAcknowledgementV2, ResponseCommandV2 } from "../../../shared/durability/types";

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
  /**
   * Set on a routed module waiting for the browser to start it (client_start
   * handoff): the browser starts it with StartModule as soon as it can render
   * it; the server starts its clock at this instant if the browser never does.
   */
  autoStartAt?: string | null;
  satBoundary?: AssessmentSATModuleBoundarySnapshot | null;
  completionReason: string | null;
  rawCorrect: number | null;
  operationalQuestionCount: number | null;
  toolState: Record<string, boolean>;
  revision: number;
}

export interface AssessmentSATModuleBoundarySnapshot {
  phase: "preparing" | "working" | "collecting" | "blocked" | "settled" | "ended" | string;
  policyVersion: string;
  workDeadlineAt: string | null;
  entryDeadlineAt: string | null;
  recoveryDeadlineAt: string | null;
  nextActionAt: string | null;
  resolution: "continue_confirmed" | "ended" | null;
  resolvedAt: string | null;
  resolutionReceipt?: SATRecoveryResolutionReceipt | null;
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

/**
 * GET …/answered-exam (docs/sat-result.md §4–5): a sealed attempt's pinned
 * version narrowed to the modules it started, keyless, with the responses the
 * server accepted.
 */
export interface AssessmentAnsweredExam {
  attemptId: string;
  examTitle: string;
  candidateName: string;
  versionId: string;
  sections: AssessmentDeliverySection[];
  attempt: AssessmentAttemptSnapshot;
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
  /**
   * The server-derived SAT entry object. `access_code` sessions require this
   * candidate's own six-digit code redemption before any module starts;
   * absent for non-SAT providers.
   */
  satStartPolicy?: SatStartPolicy | null;
  /** Classroom staff_selects: Module 1 is closed and staff have not chosen Easy/Hard yet. */
  awaitingStaffRoute?: boolean;
  satDeliveryPolicy?: SATDeliveryPolicy | null;
  satSessionMode?: "practice" | "classroom";
}

export interface SATRecoveryResolutionRequest {
  resolutionId: string;
  moduleAttemptId: string;
  expectedBoundaryRevision: number;
  action: "continue_confirmed" | "activate_entry";
  reason?: string;
}

export interface SATRecoveryResolutionReceipt {
  receiptId: string;
  resolutionId: string;
  scheduleId: string;
  attemptId: string;
  moduleAttemptId: string;
  moduleId: string;
  action: "continue_confirmed" | "activate_entry";
  actorType: "student" | "staff";
  resolvedAt: string;
  excludedAnswers: string;
  replayed?: boolean;
}

export interface SATDeliveryPolicy {
  version: "sat_recovery_v1";
  recoverySeconds: 120;
  entryRecoverySeconds: 120;
  lateAnswerPolicy: "frozen_arrival_window";
}

export type SatStartState = "code_required" | "started" | "closed";
export type SatStartBlockedReason = "not_open" | "paused" | "revoked" | "rate_limited";

/**
 * Never carries the code, its ciphertext or guess counts. A code-mode
 * session with a missing or unknown policy fails closed (no automatic entry).
 */
export type SatStartPolicy =
  | { mode: "proctor" }
  | {
      mode: "access_code";
      state: SatStartState;
      opensAt?: string | null;
      closesAt?: string | null;
      serverNow?: string | null;
      blockedReason?: SatStartBlockedReason | null;
      retryAfterSeconds?: number | null;
    };

export interface SatStartWithCodeRequest {
  /** Exactly six ASCII digits, as a string (leading zeros preserved). */
  code: string;
  /** The attempt control epoch the client holds; required. */
  controlEpoch: number;
}

export type SatStartWithCodeResponse =
  | { kind: "started"; entry: AssessmentModuleEntryStateAck }
  | { kind: "resume"; bootstrap: AssessmentDeliveryBootstrap };

export type AssessmentDeliveryState = Omit<AssessmentDeliveryBootstrap, "sections">;

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
  /** Request the chosen immutable module only when it is absent locally. */
  needContent?: boolean;
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

/**
 * The derived entry verdict the recovery read reports. It is one closed
 * vocabulary so the client never re-implements the precedence: an acknowledged
 * first frame outranks a confirmation, which outranks a still-future
 * unconfirmed offer.
 */
export type AssessmentModuleEntryState = "none" | "armed" | "confirmed" | "entered";

/**
 * The compact, authoritative answer to "where is this module entry right now?".
 *
 * Delivery transitions answer this instead of asking the client to replay the
 * command: a replay of StartModule/EnterModule against a saturated database was
 * how "Retry now" failed where a page refresh succeeded, because only the
 * refresh read authoritative state.
 */
export interface AssessmentModuleEntryStateAck {
  scheduleId: string;
  attemptId: string;
  moduleId: string;
  moduleAttemptId: string;
  moduleRevision: number;
  selectedSection?: AssessmentDeliverySection;
  /** The raw assessment_module_attempts row state. */
  state: string;
  /** The schedule runtime's timing model; a personal offer only exists under `sat_personal_v1`. */
  timingModel: string;
  entryState: AssessmentModuleEntryState;
  entryGeneration: number;
  entryStartsAt?: string;
  entryConfirmedAt?: string;
  entryEnteredAt?: string;
  startedAt?: string;
  deadlineAt?: string;
  remainingSeconds?: number;
  serverNow: string;
  controlEpoch: number;
  runtimeRevision: number;
}

/**
 * The first-active-paint acknowledgment's response. The candidate is already
 * looking at the module when it fires, so the server answers with a compact ack
 * rather than a second full attempt projection.
 */
export interface AssessmentStageVisibleAck {
  acknowledged: boolean;
  moduleId: string;
  entryGeneration: number;
  serverNow: string;
}

export interface AssessmentBreakEntryRequest {
  breakId: string;
  generation: number;
  controlEpoch?: number;
}

export interface AssessmentModuleSubmitRequest {
  moduleId: string;
}

/** One close-manifest entry: the latest write the browser holds for a question. */
export interface AssessmentModuleCloseAnswer {
  questionId: string;
  writeId: string;
  clientVersion: number;
  /** Required for sat_recovery_v1; SHA-256 of the canonical response payload. */
  contentHash?: string;
}

export interface AssessmentModuleCloseIntentRequest {
  protocol: "sat_recovery_v1";
  moduleId: string;
  moduleAttemptId: string;
  registrationId: string;
  leaseEpoch: number;
  controlEpoch: number;
  answers: Array<AssessmentModuleCloseAnswer & { contentHash: string }>;
}

export interface AssessmentModuleCloseIntentAck {
  registrationId: string;
  moduleAttemptId: string;
  manifestHash: string;
  boundaryPhase: "collecting";
  boundaryRevision: number;
  registeredAt: string;
  replayed?: boolean;
}

/**
 * The browser's confirmation that every answer it holds for a timed-out
 * module reached the server, so the server can route immediately.
 */
export interface AssessmentModuleCloseRequest {
  moduleId: string;
  moduleAttemptId: string;
  closeId: string;
  answers: AssessmentModuleCloseAnswer[];
  protocol?: "sat_recovery_v1";
  leaseEpoch?: number;
  controlEpoch?: number;
  finalCommands?: ResponseCommandV2[];
}

/**
 * The compact close answer: every module row of the attempt after the close,
 * and the follow-up module's section (metadata only while it waits for the
 * browser to start it).
 */
export interface AssessmentModuleCloseAck {
  scheduleId: string;
  attemptId: string;
  moduleId: string;
  moduleAttemptId: string;
  routeBasis?: string;
  alreadyClosed: boolean;
  moduleAttempts: AssessmentModuleAttemptSnapshot[];
  nextModuleId: string | null;
  selectedSection?: AssessmentDeliverySection;
  serverNow: string;
  finalAcks?: ResponseAcknowledgementV2[];
  responseRevision?: number;
  boundaryPhase?: string;
}

/** Answers kept on the device after their module closed (review evidence only). */
export interface AssessmentLateEvidenceRequest {
  moduleId: string;
  answers: Array<{
    questionId: string;
    writeId: string;
    response: unknown;
    originLeaseEpoch: number | null;
    clientVersion: number | null;
    clientReceivedAt?: string;
  }>;
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
  attemptId: string;
  providerKey: AssessmentDeliveryProviderKey;
  outcomeStatus: string;
  releaseStatus: string;
  totalScore: number | null;
  scorePayload: Record<string, unknown> | null;
  /** Empty while the server returns a score-free completion receipt. */
  scoreKind: string;
  /** Null while the server withholds scored section details. */
  sections: AssessmentSectionResult[] | null;
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
