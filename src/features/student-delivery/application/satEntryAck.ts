import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliverySection,
  AssessmentModuleCloseAck,
  AssessmentModuleEntryStateAck,
} from "../contracts/assessmentDelivery";

export function isEntryAck(
  value: AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck,
): value is AssessmentModuleEntryStateAck {
  return "moduleAttemptId" in value;
}

/**
 * Merge one acked section into the loaded tree: its modules replace same-id
 * modules (a content-withheld stub is replaced by the full module, and vice
 * versa never happens because a started module is never withheld), and an
 * unknown section is appended. The immutable tree is copied, never mutated.
 */
function mergeSelectedSection(
  sections: AssessmentDeliverySection[],
  selected: AssessmentDeliverySection,
): AssessmentDeliverySection[] {
  const merged = sections.map((section) => section.id === selected.id
    ? {
        ...section,
        modules: [
          ...section.modules.filter((module) => !selected.modules.some((candidate) => candidate.id === module.id)),
          ...selected.modules,
        ],
      }
    : section);
  return sections.some((section) => section.id === selected.id) ? merged : [...merged, selected];
}

/** Apply one committed module row to the already loaded immutable exam tree. */
export function applyEntryAck(
  base: AssessmentDeliveryBootstrap,
  ack: AssessmentModuleEntryStateAck,
): AssessmentDeliveryBootstrap | null {
  if (ack.scheduleId !== base.scheduleId || ack.attemptId !== base.attempt.id) return null;
  const sections = ack.selectedSection ? mergeSelectedSection(base.sections, ack.selectedSection) : base.sections;
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

/**
 * Apply a module-close ack: the attempt's module rows after the close are
 * authoritative and replace the list (the routed follow-up row is new to the
 * browser), and the follow-up module's section is merged — metadata only while
 * the follow-up waits for this browser to start it.
 */
export function applyCloseAck(
  base: AssessmentDeliveryBootstrap,
  ack: AssessmentModuleCloseAck,
): AssessmentDeliveryBootstrap | null {
  if (ack.scheduleId !== base.scheduleId || ack.attemptId !== base.attempt.id) return null;
  const sections = ack.selectedSection ? mergeSelectedSection(base.sections, ack.selectedSection) : base.sections;
  return {
    ...base,
    serverNow: ack.serverNow,
    timing: { ...base.timing, serverNow: ack.serverNow },
    attempt: { ...base.attempt, moduleAttempts: ack.moduleAttempts },
    sections,
  };
}
