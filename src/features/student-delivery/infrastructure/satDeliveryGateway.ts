import {
  assessmentDeliveryApi,
  configureAssessmentDeliveryAttempt,
} from '../api/assessmentDeliveryApi';
import type { SatDeliveryGateway } from '../application/ports/SatDeliveryGateway';

export const satDeliveryGateway: SatDeliveryGateway = assessmentDeliveryApi;
export const configureSatDeliveryAttempt = configureAssessmentDeliveryAttempt;
