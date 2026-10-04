import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryState,
  AssessmentBreakEntryRequest,
  AssessmentLateEvidenceRequest,
  AssessmentModuleCloseAck,
  AssessmentModuleCloseRequest,
  AssessmentModuleEntryRequest,
  AssessmentModuleEntryStateAck,
  AssessmentModuleStartRequest,
  AssessmentModuleSubmitRequest,
  AssessmentResponseRequest,
  AssessmentResponseSnapshot,
  AssessmentResult,
  AssessmentStageVisibleAck,
  AssessmentSubmitRequest,
} from '../../contracts/assessmentDelivery';

export interface SatDeliveryGateway {
  /**
   * Unconditional read of LIVE attempt state. There is deliberately no
   * conditional variant: the published exam version cannot validate module
   * attempts, the adaptive route, responses or the result, so a version-scoped
   * 304 could keep a student on the module the server already routed away from.
   */
  bootstrap(scheduleId: string, attemptId: string): Promise<AssessmentDeliveryBootstrap>;
  state?(scheduleId: string, attemptId: string): Promise<AssessmentDeliveryState>;
  saveResponse(
    scheduleId: string,
    attemptId: string,
    examQuestionId: string,
    request: AssessmentResponseRequest,
  ): Promise<AssessmentResponseSnapshot>;
  startModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleStartRequest,
  ): Promise<AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck>;
  /**
   * Legacy personal-timing offer confirmation. The SAT client uses the
   * single-operation `startModule` path instead. If this endpoint is wired
   * again, its raw ack must be passed through the controller's entry resolver
   * before the payload is merged (application/satEntryControlEpoch).
   */
  enterModule?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck>;
  /**
   * Authoritative, cheap entry read (no mutation). "Retry now" asks this before
   * it replays a transition command, so a committed entry whose response was
   * lost is discovered instead of re-executed against a saturated database.
   */
  entryState?(
    scheduleId: string,
    attemptId: string,
    moduleId: string,
  ): Promise<AssessmentModuleEntryStateAck>;
  /**
   * First-active-paint acknowledgment. It answers with a compact ack, never a
   * second attempt projection.
   */
  markStageVisible?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentStageVisibleAck>;
  startBreak?(
    scheduleId: string,
    attemptId: string,
    breakId: string,
    /** Optional control-epoch fence (see AssessmentBreakEntryRequest). */
    request?: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
  enterBreak?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
  markBreakVisible?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
  submitModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleSubmitRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
  /**
   * Confirms a timed-out module's final answers so the server routes it now
   * instead of waiting out the close window. Optional: a gateway without it
   * leaves routing to the server's close window.
   */
  closeModule?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleCloseRequest,
  ): Promise<AssessmentModuleCloseAck>;
  /** Uploads answers kept on the device after their module closed (evidence only). */
  recordLateEvidence?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentLateEvidenceRequest,
  ): Promise<{ recorded: number }>;
  submitAssessment(
    scheduleId: string,
    attemptId: string,
    request: AssessmentSubmitRequest,
  ): Promise<AssessmentResult>;
}
