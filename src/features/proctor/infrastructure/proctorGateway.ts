import {
  backendGet,
  getAttemptSchedule,
  mapBackendRuntime,
  mapBackendSchedule,
  rememberAttemptSchedule,
} from '@services/backendBridge';
import { examDeliveryService } from '@services/examDeliveryService';

const PREVIEW_RUNTIME_COHORT_PREFIX = '__preview_runtime__';

function isPreviewRuntimeCohortName(cohortName: string): boolean {
  return cohortName.startsWith(`${PREVIEW_RUNTIME_COHORT_PREFIX}:`);
}

export const proctorGateway = {
  backendGet,
  getAttemptSchedule,
  mapBackendRuntime,
  mapBackendSchedule,
  rememberAttemptSchedule,
  examDeliveryService,
  isPreviewRuntimeCohortName,
};
