import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProctorAlert, SessionNote, StudentSession, ViolationRule } from '../../../types';
import type { SatRecoveryCommand } from '../contracts';
import { proctorMutations } from '../api/proctorMutations';
import { isCommandConfirmed, type CommandOutcome } from '../domain/commandOutcome';
import { applyConfirmedStudentAction, type StudentAction } from '../domain/proctorSnapshot';
import { LOCAL_ALERT_PREFIX, type ProctorMonitoring } from './useProctorMonitoring';

/** Cohort commands are issued as the room's proctor role, as before. */
const COHORT_ACTOR = 'Proctor';
const CONFIRMED: CommandOutcome = { kind: 'confirmed' };

type AutoRuleState = {
  fired: Map<string, Set<string>>;
  inFlight: Map<string, Set<string>>;
  generations: Map<string, Map<string, number>>;
};
const autoRuleStates = new WeakMap<QueryClient, AutoRuleState>();
function autoRuleStateFor(client: QueryClient): AutoRuleState {
  const existing = autoRuleStates.get(client);
  if (existing) return existing;
  const state: AutoRuleState = { fired: new Map(), inFlight: new Map(), generations: new Map() };
  client.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (event.type === 'removed' && key[0] === 'proctoring' && key[1] === 'detail' && typeof key[2] === 'string') {
      // Logout clears the query cache. Do not carry the prior actor's rule
      // memory into the next session, and leave pending writes guarded until
      // their original promises settle.
      state.fired.delete(key[2]);
      state.generations.delete(key[2]);
    }
  });
  autoRuleStates.set(client, state);
  return state;
}

/**
 * The violations a rule counts, in the order the server recorded them.
 * Shared by evaluation and trigger identity so both agree on the crossing.
 */
function matchingViolations(rule: ViolationRule, session: StudentSession) {
  switch (rule.triggerType) {
    case 'violation_count':
      return session.violations;
    case 'specific_violation_type':
      return session.violations.filter((violation) => violation.type === rule.specificViolationType);
    case 'severity_threshold':
      return session.violations.filter((violation) => violation.severity === rule.specificSeverity);
    default:
      return [];
  }
}

/**
 * Server operation id for one automatic enforcement: the rule, the attempt
 * (the server's receipt scope), and the violation that crossed the threshold.
 * Hashed to fit the server's 64-byte operation id limit.
 */
async function autoRuleOperationId(rule: ViolationRule, session: StudentSession): Promise<string> {
  const crossing = matchingViolations(rule, session)[rule.threshold - 1]?.id ?? `count-${rule.threshold}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([rule.id, session.id, crossing])));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `auto-rule:${hex}`;
}

function rulesForRoom(rooms: Map<string, Set<string>>, scheduleId: string): Set<string> {
  const existing = rooms.get(scheduleId);
  if (existing) return existing;
  const rules = new Set<string>();
  rooms.set(scheduleId, rules);
  return rules;
}

function generationsForRoom(rooms: Map<string, Map<string, number>>, scheduleId: string): Map<string, number> {
  const existing = rooms.get(scheduleId);
  if (existing) return existing;
  const generations = new Map<string, number>();
  rooms.set(scheduleId, generations);
  return generations;
}

/**
 * Related writes run one at a time per key (room, attempt, alert, note,
 * rule); unrelated keys stay independent. A browser queue prevents ordinary
 * duplicates only — the server still owns authorization and revisions.
 */
function useWriteSerializer() {
  const chains = useRef(new Map<string, Promise<unknown>>());
  return useCallback(<T,>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    chains.current.set(key, next);
    void next.catch(() => undefined).finally(() => {
      if (chains.current.get(key) === next) chains.current.delete(key);
    });
    return next;
  }, []);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Staff commands for proctor monitoring. Every command captures its target
 * (room, attempt, revision) when it is issued, returns a typed outcome, and
 * reconciles the original entity's cache, whatever the view shows by then.
 */
export function useProctorCommands(monitoring: ProctorMonitoring) {
  const queryClient = useQueryClient();
  const autoRuleState = useMemo(() => autoRuleStateFor(queryClient), [queryClient]);
  const serialize = useWriteSerializer();
  const {
    reconcileAfterCommand,
    invalidateRoomDetail,
    markRoomDetailStale,
    setError,
    setCommandError,
    patchSession,
    setAlertAcknowledged,
    forgetAlertAcknowledgement,
    confirmAlertAcknowledgements,
    addLocalAlerts,
    noteOverlay,
    ruleOverlay,
  } = monitoring;
  const runtimeSnapshotsRef = useRef(monitoring.runtimeSnapshots);
  runtimeSnapshotsRef.current = monitoring.runtimeSnapshots;

  // ---------------------------------------------------------------- cohort
  /** Cohort handlers keep their throwing contract: anything but a confirmation rejects. */
  const cohortCommand = useCallback(
    (scheduleId: string, issue: () => Promise<CommandOutcome>, clearsError = false) =>
      serialize(`room:${scheduleId}`, async () => {
        const outcome = await issue();
        if (outcome.kind === 'rejected') throw new Error(outcome.error);
        if (outcome.kind === 'uncertain') {
          // Never resend blindly: read the room so the proctor sees what happened.
          void reconcileAfterCommand(scheduleId, 'uncertain');
          throw new Error(outcome.error);
        }
        if (clearsError) setError(null);
        await reconcileAfterCommand(scheduleId);
      }),
    [reconcileAfterCommand, serialize, setError],
  );

  /** The section and runtime revision the proctor is looking at, captured when the command is issued. */
  const capturedSection = useCallback((scheduleId: string) => {
    const runtime = runtimeSnapshotsRef.current.find((candidate) => candidate.scheduleId === scheduleId);
    return {
      sectionKey: runtime?.activeSectionKey ?? runtime?.currentSectionKey ?? undefined,
      revision: runtime?.revision ?? undefined,
    };
  }, []);

  const handleStartScheduledSession = useCallback(
    (scheduleId: string) => cohortCommand(scheduleId, () => proctorMutations.startRuntime(scheduleId, COHORT_ACTOR)),
    [cohortCommand],
  );
  const handlePauseCohort = useCallback(
    (scheduleId: string) => cohortCommand(scheduleId, () => proctorMutations.pauseRuntime(scheduleId, COHORT_ACTOR)),
    [cohortCommand],
  );
  const handleResumeCohort = useCallback(
    (scheduleId: string) => cohortCommand(scheduleId, () => proctorMutations.resumeRuntime(scheduleId, COHORT_ACTOR)),
    [cohortCommand],
  );
  const handleEndSectionNow = useCallback(
    (scheduleId: string) => {
      const { sectionKey, revision } = capturedSection(scheduleId);
      return cohortCommand(scheduleId, () => proctorMutations.endSection(scheduleId, COHORT_ACTOR, sectionKey, revision), true);
    },
    [capturedSection, cohortCommand],
  );
  const handleExtendCurrentSection = useCallback(
    (scheduleId: string, minutes: number) => {
      const { sectionKey, revision } = capturedSection(scheduleId);
      return cohortCommand(
        scheduleId,
        () => proctorMutations.extendSection(scheduleId, COHORT_ACTOR, minutes, sectionKey, revision),
        true,
      );
    },
    [capturedSection, cohortCommand],
  );
  const handleCompleteExam = useCallback(
    (scheduleId: string) => cohortCommand(scheduleId, () => proctorMutations.completeRuntime(scheduleId, COHORT_ACTOR)),
    [cohortCommand],
  );

  // ---------------------------------------------------------------- students
  const resolveRecovery = useCallback(
    (request: SatRecoveryCommand) => serialize(`attempt:${request.attemptId}`, async () => {
      const outcome = await proctorMutations.resolveRecovery(request);
      void markRoomDetailStale(request.scheduleId);
      return outcome;
    }),
    [markRoomDetailStale, serialize],
  );

  const studentAction = useCallback(
    (session: Pick<StudentSession, 'id' | 'scheduleId'>, action: StudentAction, actor: string, message?: string) =>
      serialize(`attempt:${session.id}`, async () => {
        const warning = message ?? 'Warning issued by proctor';
        const outcome =
          action === 'warn' ? await proctorMutations.warnStudent(session.id, warning, actor)
          : action === 'pause' ? await proctorMutations.pauseStudent(session.id, actor)
          : action === 'resume' ? await proctorMutations.resumeStudent(session.id, actor)
          : await proctorMutations.terminateStudent(session.id, actor);
        if (isCommandConfirmed(outcome)) {
          patchSession(session.scheduleId, session.id, (current) =>
            applyConfirmedStudentAction(current, action, {
              message: warning,
              violationId: newId('proctor-warning'),
              at: new Date().toISOString(),
            }),
          );
        } else if (outcome.kind === 'uncertain') {
          void invalidateRoomDetail(session.scheduleId);
        }
        return outcome;
      }),
    [invalidateRoomDetail, patchSession, serialize],
  );

  const extendStudent = useCallback(
    (session: Pick<StudentSession, 'id' | 'scheduleId' | 'runtimeCurrentModuleId'>, minutes: number, actor: string) =>
      serialize(`attempt:${session.id}`, async (): Promise<CommandOutcome> => {
        const outcome = await proctorMutations.extendStudent(session.id, actor, minutes, session.runtimeCurrentModuleId);
        if (isCommandConfirmed(outcome)) {
          patchSession(session.scheduleId, session.id, (current) => ({
            ...current,
            timeRemaining: current.timeRemaining + minutes * 60,
            runtimeTimeRemainingSeconds: (current.runtimeTimeRemainingSeconds ?? current.timeRemaining) + minutes * 60,
          }));
        } else if (outcome.kind === 'uncertain') {
          void invalidateRoomDetail(session.scheduleId);
        }
        return outcome;
      }),
    [invalidateRoomDetail, patchSession, serialize],
  );

  // ---------------------------------------------------------------- alerts
  /**
   * Acknowledge on the server (shown at once, rolled back if not confirmed).
   * Reopening is display-only: the server has no reopen command.
   */
  const acknowledgeAlerts = useCallback(
    async (scheduleId: string | null, alertIds: readonly string[], acknowledged: boolean): Promise<CommandOutcome> => {
      setAlertAcknowledged(alertIds, acknowledged);
      if (!acknowledged) return CONFIRMED;
      const serverIds = alertIds.filter((id) => !id.startsWith(LOCAL_ALERT_PREFIX));
      const outcomes = await Promise.all(
        serverIds.map((id) => serialize(`alert:${id}`, () => proctorMutations.acknowledgeAlert(id)).then((outcome) => ({ id, outcome }))),
      );
      const failed = outcomes.filter(({ outcome }) => !isCommandConfirmed(outcome));
      for (const { id } of failed) forgetAlertAcknowledgement(id);
      if (scheduleId) {
        confirmAlertAcknowledgements(scheduleId, outcomes.filter(({ outcome }) => isCommandConfirmed(outcome)).map(({ id }) => id));
      }
      if (scheduleId) void invalidateRoomDetail(scheduleId);
      return failed[0]?.outcome ?? CONFIRMED;
    },
    [confirmAlertAcknowledgements, forgetAlertAcknowledgement, invalidateRoomDetail, serialize, setAlertAcknowledged],
  );

  // ---------------------------------------------------------------- notes and rules
  const persistOverlay = useCallback(
    async <T extends { id: string; scheduleId: string }>(
      overlay: typeof noteOverlay | typeof ruleOverlay,
      begin: () => number,
      row: Pick<T, 'id' | 'scheduleId'>,
      issue: () => Promise<CommandOutcome>,
    ): Promise<CommandOutcome> => {
      const operation = begin();
      const outcome = await serialize(`row:${row.id}`, issue);
      if (isCommandConfirmed(outcome)) overlay.confirm(row.id, operation);
      else overlay.rollback(row.id, operation);
      void invalidateRoomDetail(row.scheduleId);
      return outcome;
    },
    [invalidateRoomDetail, serialize],
  );

  const saveNote = useCallback(
    (note: SessionNote) => persistOverlay(noteOverlay, () => noteOverlay.beginUpsert(note), note, () => proctorMutations.saveNote(note)),
    [noteOverlay, persistOverlay],
  );
  const deleteNote = useCallback(
    (note: Pick<SessionNote, 'id' | 'scheduleId'>) =>
      persistOverlay(noteOverlay, () => noteOverlay.beginDelete(note), note, () => proctorMutations.deleteNote(note.id)),
    [noteOverlay, persistOverlay],
  );
  const saveRule = useCallback(
    (rule: ViolationRule) => persistOverlay(ruleOverlay, () => ruleOverlay.beginUpsert(rule), rule, () => proctorMutations.saveRule(rule)),
    [persistOverlay, ruleOverlay],
  );
  const deleteRule = useCallback(
    (rule: Pick<ViolationRule, 'id' | 'scheduleId'>) =>
      persistOverlay(ruleOverlay, () => ruleOverlay.beginDelete(rule), rule, () => proctorMutations.deleteRule(rule.id)),
    [persistOverlay, ruleOverlay],
  );

  // ---------------------------------------------------------------- automatic rules
  // Fired-rule dedupe: a rule fires once while its condition remains true for
  // a session. Warning/pause actions append or mutate session state, so using
  // the raw violation count would fire the same rule again after its own
  // action was recorded.
  //
  // This dedupe is per query client. Across tabs, operators, and reloads the
  // server deduplicates: warn/pause carry an operation id derived from the
  // rule and the violation that crossed its threshold, which every browser
  // computes identically, and the server applies one id once per attempt.
  // Terminate needs no id: a second terminate is refused as already terminal.
  const violationRulesRef = useRef(monitoring.violationRules);
  violationRulesRef.current = monitoring.violationRules;
  const evaluateViolationRules = useCallback(
    async (scheduleId: string, studentSessions: StudentSession[]) => {
      const rules = violationRulesRef.current.filter((rule) => rule.scheduleId === scheduleId);
      const activeRules = rules.filter((rule) => rule.isEnabled);

      if (activeRules.length === 0) {
        return;
      }

      const notifyAlerts: ProctorAlert[] = [];
      let uncertainAction = false;
      const firedRules = rulesForRoom(autoRuleState.fired, scheduleId);
      const inFlightRules = rulesForRoom(autoRuleState.inFlight, scheduleId);
      const generations = generationsForRoom(autoRuleState.generations, scheduleId);

      for (const session of studentSessions) {
        if (session.scheduleId !== scheduleId) {
          continue;
        }

        for (const rule of activeRules) {
          const shouldTrigger = matchingViolations(rule, session).length >= rule.threshold;

          const fireKey = JSON.stringify([rule.id, session.id]);
          if (!shouldTrigger) {
            if (firedRules.delete(fireKey) || inFlightRules.has(fireKey)) {
              generations.set(fireKey, (generations.get(fireKey) ?? 0) + 1);
            }
            continue;
          }

          if (session.status === 'terminated') {
            continue;
          }

          // Dedupe until the trigger condition drops below its threshold.
          if (firedRules.has(fireKey) || inFlightRules.has(fireKey)) {
            continue;
          }

          inFlightRules.add(fireKey);
          const generation = generations.get(fireKey) ?? 0;
          try {
            let outcome: CommandOutcome | null = null;
            if (rule.action === 'warn') {
              const operationId = await autoRuleOperationId(rule, session);
              outcome = await proctorMutations.warnStudent(session.id, `Auto-warning triggered by ${rule.triggerType}`, 'system', operationId);
            } else if (rule.action === 'pause') {
              const operationId = await autoRuleOperationId(rule, session);
              outcome = await proctorMutations.pauseStudent(session.id, 'system', operationId);
            } else if (rule.action === 'notify_proctor') {
              const latestViolationId = session.violations.at(-1)?.id ?? 'none';
              notifyAlerts.push({
                id: `${LOCAL_ALERT_PREFIX}${rule.id}:${session.id}:${latestViolationId}:${session.violations.length}`,
                severity: rule.specificSeverity ?? 'high',
                type: 'RULE_NOTIFY_PROCTOR',
                studentName: session.name,
                studentId: session.studentId,
                timestamp: new Date().toISOString(),
                message: `Auto-rule notification: ${rule.triggerType} threshold reached for ${session.name}.`,
                isAcknowledged: false,
              });
            } else if (rule.action === 'terminate') {
              outcome = await proctorMutations.terminateStudent(session.id, 'system');
            }
            if (outcome && !isCommandConfirmed(outcome)) {
              if (outcome.kind === 'uncertain') {
                if ((generations.get(fireKey) ?? 0) === generation) firedRules.add(fireKey);
                uncertainAction = true;
              }
              continue;
            }
            if ((generations.get(fireKey) ?? 0) === generation) firedRules.add(fireKey);
          } finally {
            inFlightRules.delete(fireKey);
          }
        }
      }

      // Keep the explicit evaluator contract fresh even when no threshold
      // was met; the caller also uses this method after a manual refresh.
      await reconcileAfterCommand(scheduleId, uncertainAction ? 'uncertain' : 'confirmed');
      if (uncertainAction) {
        setCommandError(scheduleId, 'Automatic action outcome is uncertain. Check the student before retrying.');
      }

      if (notifyAlerts.length > 0) addLocalAlerts(scheduleId, notifyAlerts);
    },
    [addLocalAlerts, autoRuleState, reconcileAfterCommand, setCommandError]
  );

  // Evaluate rules at the selected monitoring boundary so automatic
  // responses work for both polling and WebSocket recovery without requiring
  // a proctor to call an internal callback manually.
  const { isLoading, selectedScheduleId, sessions, violationRules } = monitoring;
  const autoEvaluationSignature = useMemo(() => {
    if (!selectedScheduleId || isLoading) {
      return null;
    }

    const activeRules = violationRules
      .filter((rule) => rule.scheduleId === selectedScheduleId && rule.isEnabled)
      .map((rule) => ({
        id: rule.id,
        triggerType: rule.triggerType,
        threshold: rule.threshold,
        specificViolationType: rule.specificViolationType ?? null,
        specificSeverity: rule.specificSeverity ?? null,
        action: rule.action,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (activeRules.length === 0) {
      return null;
    }

    const scopedSessions = sessions
      .filter((session) => session.scheduleId === selectedScheduleId)
      .map((session) => ({
        id: session.id,
        status: session.status,
        violations: session.violations.map((violation) =>
          `${violation.id}:${violation.type}:${violation.severity}`
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return JSON.stringify({ rules: activeRules, sessions: scopedSessions });
  }, [isLoading, selectedScheduleId, sessions, violationRules]);

  const lastAutoEvaluationSignatureRef = useRef<string | null>(null);
  const autoEvaluationInFlightRef = useRef(false);
  const [autoEvaluationTick, setAutoEvaluationTick] = useState(0);

  useEffect(() => {
    if (!autoEvaluationSignature || !selectedScheduleId) {
      lastAutoEvaluationSignatureRef.current = null;
      return;
    }
    if (
      autoEvaluationSignature === lastAutoEvaluationSignatureRef.current ||
      autoEvaluationInFlightRef.current
    ) {
      return;
    }

    lastAutoEvaluationSignatureRef.current = autoEvaluationSignature;
    autoEvaluationInFlightRef.current = true;
    void evaluateViolationRules(selectedScheduleId, sessions)
      .catch((evaluationError) => {
        setError(
          evaluationError instanceof Error
            ? evaluationError.message
            : 'Failed to evaluate violation rules'
        );
      })
      .finally(() => {
        autoEvaluationInFlightRef.current = false;
        setAutoEvaluationTick((current) => current + 1);
      });
  }, [
    autoEvaluationSignature,
    autoEvaluationTick,
    evaluateViolationRules,
    isLoading,
    selectedScheduleId,
    sessions,
    setError,
  ]);

  return {
    handleStartScheduledSession,
    handlePauseCohort,
    handleResumeCohort,
    handleEndSectionNow,
    handleExtendCurrentSection,
    handleCompleteExam,
    studentAction,
    resolveRecovery,
    extendStudent,
    acknowledgeAlerts,
    saveNote,
    deleteNote,
    saveRule,
    deleteRule,
    evaluateViolationRules,
    newNoteId: () => newId('note'),
    newRuleId: () => newId('rule'),
  };
}

export type ProctorCommands = ReturnType<typeof useProctorCommands>;
