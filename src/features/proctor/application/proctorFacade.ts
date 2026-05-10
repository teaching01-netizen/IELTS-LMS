import { proctorGateway } from '../infrastructure/proctorGateway';

export const proctorFacade = {
  getAttemptSchedule: proctorGateway.getAttemptSchedule,
  mapRuntime: proctorGateway.mapBackendRuntime,
  mapSchedule: proctorGateway.mapBackendSchedule,
  rememberAttemptSchedule: proctorGateway.rememberAttemptSchedule,
  delivery: proctorGateway.examDeliveryService,
  isPreviewRuntimeCohortName: proctorGateway.isPreviewRuntimeCohortName,
};
