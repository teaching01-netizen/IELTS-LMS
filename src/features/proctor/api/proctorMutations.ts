import type { SessionNote, ViolationRule } from '../../../types';
import { proctorGateway } from '../infrastructure/proctorGateway';
import { classifyCommandError, deliveryCommandOutcome, type CommandOutcome, type DeliveryCommandResult } from '../domain/commandOutcome';
import type { SatRecoveryCommand } from '../contracts';

async function run(call: () => Promise<unknown>, fallback: string): Promise<CommandOutcome> {
  try {
    await call();
    return { kind: 'confirmed' };
  } catch (error) {
    return classifyCommandError(error, fallback);
  }
}

/** Delivery service commands report `{success, error}` instead of throwing. */
async function runDelivery(
  call: () => Promise<DeliveryCommandResult>,
  fallback: string,
): Promise<CommandOutcome> {
  try {
    return deliveryCommandOutcome(await call(), fallback);
  } catch (error) {
    return classifyCommandError(error, fallback);
  }
}

const delivery = proctorGateway.examDeliveryService;
const repository = proctorGateway.examRepository;

export const proctorMutations = {
  resolveRecovery: ({ scheduleId, attemptId, ...request }: SatRecoveryCommand) =>
    run(() => proctorGateway.backendPost(
      `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/attempts/${encodeURIComponent(attemptId)}/recovery/resolve`,
      request,
      { retries: 0 },
    ), 'The recovery decision could not be confirmed.'),
  acknowledgeAlert: (alertId: string) =>
    run(() => proctorGateway.backendPost(`/v1/proctor/alerts/${encodeURIComponent(alertId)}/ack`), 'Failed to acknowledge alert'),
  saveNote: (note: SessionNote) => run(() => repository.saveSessionNote(note), 'Failed to save note.'),
  deleteNote: (noteId: string) => run(() => repository.deleteSessionNote(noteId), 'Failed to delete note.'),
  saveRule: (rule: ViolationRule) => run(() => repository.saveViolationRule(rule), 'Failed to save rule.'),
  deleteRule: (ruleId: string) => run(() => repository.deleteViolationRule(ruleId), 'Failed to delete rule.'),

  startRuntime: (scheduleId: string, actor: string) =>
    runDelivery(() => delivery.startRuntime(scheduleId, actor), 'Failed to start runtime'),
  pauseRuntime: (scheduleId: string, actor: string) =>
    runDelivery(() => delivery.pauseRuntime(scheduleId, actor), 'Failed to pause runtime'),
  resumeRuntime: (scheduleId: string, actor: string) =>
    runDelivery(() => delivery.resumeRuntime(scheduleId, actor), 'Failed to resume runtime'),
  endSection: (scheduleId: string, actor: string, expectedSectionKey?: string, revision?: number) =>
    runDelivery(() => delivery.endCurrentSectionNow(scheduleId, actor, expectedSectionKey, revision), 'Failed to end section'),
  extendSection: (scheduleId: string, actor: string, minutes: number, expectedSectionKey?: string, revision?: number) =>
    runDelivery(() => delivery.extendCurrentSection(scheduleId, actor, minutes, expectedSectionKey, revision), 'Failed to extend section'),
  completeRuntime: (scheduleId: string, actor: string) =>
    runDelivery(() => delivery.completeRuntime(scheduleId, actor), 'Failed to complete exam'),

  warnStudent: (attemptId: string, message: string, actor: string) =>
    runDelivery(() => delivery.warnStudent(attemptId, message, actor), 'Failed to execute student action'),
  pauseStudent: (attemptId: string, actor: string) =>
    runDelivery(() => delivery.pauseStudentAttempt(attemptId, actor), 'Failed to execute student action'),
  resumeStudent: (attemptId: string, actor: string) =>
    runDelivery(() => delivery.resumeStudentAttempt(attemptId, actor), 'Failed to execute student action'),
  terminateStudent: (attemptId: string, actor: string) =>
    runDelivery(() => delivery.terminateStudentAttempt(attemptId, actor), 'Failed to execute student action'),
  /** Time is granted to one module; without its identity the grant is refused, never guessed. */
  extendStudent: async (attemptId: string, actor: string, minutes: number, moduleId: string | null | undefined): Promise<CommandOutcome> =>
    moduleId
      ? runDelivery(() => delivery.extendStudentAttempt(attemptId, actor, minutes, moduleId), 'Failed to extend student time')
      : { kind: 'rejected', error: 'The student’s current module is unavailable. Refresh the session before adding time.' },
};
