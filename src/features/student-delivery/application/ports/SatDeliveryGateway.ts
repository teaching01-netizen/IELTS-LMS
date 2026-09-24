import type {
  AssessmentDeliveryBootstrap,
  AssessmentBreakEntryRequest,
  AssessmentModuleEntryRequest,
  AssessmentModuleStartRequest,
  AssessmentModuleSubmitRequest,
  AssessmentResponseRequest,
  AssessmentResponseSnapshot,
  AssessmentResult,
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
  ): Promise<AssessmentDeliveryBootstrap>;
  enterModule?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
  markStageVisible?(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap>;
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
