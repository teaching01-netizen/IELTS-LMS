import type {
  AssessmentDeliveryBootstrap,
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
