import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryState,
  AssessmentBreakEntryRequest,
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
  submitAssessment(
    scheduleId: string,
    attemptId: string,
    request: AssessmentSubmitRequest,
  ): Promise<AssessmentResult>;
}
