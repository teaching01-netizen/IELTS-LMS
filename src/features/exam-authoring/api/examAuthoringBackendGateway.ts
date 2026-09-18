/**
 * The backend transport seam as other features see it (builder's runtime
 * session service, and that service's tests, which replace this exact path).
 * It is a re-export on purpose: consumers must not depend on
 * `infrastructure/` directly.
 */
export {
  backendPost,
  buildCreateSchedulePayload,
  hasBackendStatusCode,
  isBackendNotFound,
  mapBackendSchedule,
} from '../infrastructure/examAuthoringBackendGateway';
