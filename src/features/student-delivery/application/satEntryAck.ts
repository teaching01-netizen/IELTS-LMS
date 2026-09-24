import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleEntryStateAck,
} from "../contracts/assessmentDelivery";

export function isEntryAck(
  value: AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck,
): value is AssessmentModuleEntryStateAck {
  return "moduleAttemptId" in value;
}

/** Apply one committed module row to the already loaded immutable exam tree. */
export function applyEntryAck(
  base: AssessmentDeliveryBootstrap,
  ack: AssessmentModuleEntryStateAck,
): AssessmentDeliveryBootstrap | null {
  if (ack.scheduleId !== base.scheduleId || ack.attemptId !== base.attempt.id) return null;
  const sections = ack.selectedSection
    ? [...base.sections.map((section) => section.id === ack.selectedSection!.id
      ? { ...section, modules: [
          ...section.modules.filter((module) => !ack.selectedSection!.modules.some((selected) => selected.id === module.id)),
          ...ack.selectedSection!.modules,
        ] }
      : section), ...(base.sections.some((section) => section.id === ack.selectedSection!.id) ? [] : [ack.selectedSection])]
    : base.sections;
  if (!sections.some((section) => section.modules.some((module) => module.id === ack.moduleId))) {
    return null;
  }
  const existing = base.attempt.moduleAttempts.find((item) => item.id === ack.moduleAttemptId);
  if (!existing || existing.moduleId !== ack.moduleId) return null;
  const moduleAttempts = base.attempt.moduleAttempts.map((item) => item.id !== ack.moduleAttemptId
    ? item
    : {
        ...item,
        state: ack.state,
        revision: ack.moduleRevision,
        startedAt: ack.startedAt ?? null,
        deadlineAt: ack.deadlineAt ?? null,
        remainingSeconds: ack.remainingSeconds ?? null,
        entryGeneration: ack.entryGeneration,
        entryStartsAt: ack.entryStartsAt ?? null,
        entryConfirmedAt: ack.entryConfirmedAt ?? null,
        entryEnteredAt: ack.entryEnteredAt ?? null,
      });
  return {
    ...base,
    serverNow: ack.serverNow,
    timing: { ...base.timing, serverNow: ack.serverNow, runtimeRevision: ack.runtimeRevision },
    attempt: { ...base.attempt, moduleAttempts },
    sections,
  };
}
