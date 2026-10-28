import { proctorGateway } from '../infrastructure/proctorGateway';

type PresenceAction = 'join' | 'heartbeat' | 'leave';

/** Proctor presence for one room. Throws on failure; callers decide whether to retry. */
export function updateProctorPresence(scheduleId: string, action: PresenceAction): Promise<unknown> {
  return proctorGateway.backendPost(
    `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/presence`,
    { action },
    { retries: 0 },
  );
}

const delivery = proctorGateway.examDeliveryService;

export const isScheduleReadyToStart: typeof delivery.isScheduleReadyToStart = (...args) =>
  delivery.isScheduleReadyToStart(...args);

export const formatExamGroupScheduledStartTime: typeof delivery.formatExamGroupScheduledStartTime = (...args) =>
  delivery.formatExamGroupScheduledStartTime(...args);

const roomPath = (scheduleId: string) => `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}`;

/** SAT room start code: read, and rotate against the generation the proctor saw. */
export function fetchStartCode<T>(scheduleId: string): Promise<T> {
  return proctorGateway.backendGet<T>(`${roomPath(scheduleId)}/start-code`);
}

export function rotateStartCode<T>(scheduleId: string, expectedGeneration: number): Promise<T> {
  return proctorGateway.backendPost<T>(`${roomPath(scheduleId)}/start-code/rotate`, { expectedGeneration }, { retries: 0 });
}

/** SAT Module 2 route queue. The panel owns its retry loop, so no transport backoff. */
export function fetchRouteQueue<T>(scheduleId: string): Promise<T> {
  return proctorGateway.backendGet<T>(`${roomPath(scheduleId)}/route-queue`, { retries: 0 });
}

export function assignModuleRoute(
  scheduleId: string,
  attemptId: string,
  sectionKey: string,
  route: 'lower' | 'higher',
): Promise<unknown> {
  return proctorGateway.backendPost(
    `${roomPath(scheduleId)}/attempts/${encodeURIComponent(attemptId)}/route`,
    { sectionKey, route },
    { retries: 0 },
  );
}

export { isCommandConfirmed, type CommandOutcome } from '../domain/commandOutcome';
