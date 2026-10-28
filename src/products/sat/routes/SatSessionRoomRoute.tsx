import { useSatNavigate } from "../ui/useSatNavigate";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, UserRound } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { isExamDeliveryPath } from './satReturnPath';
import { SatButton, SatPageError, SatPageLoading } from '../ui/SatPage';
import { logError, logInfo } from '../../../shared/observability/errorLogger';
import { useAuthSession } from '../../../features/auth/authSession';
import { useAuthoritativeDeadlineClock, useRoomClockMs } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { proctorMutations } from '../../../features/proctor/api/proctorMutations';
import { SatStatusPill } from '../ui/SatPage';
import { SatSessionControls } from '../ui/SatSessionControls';
import { useScheduleFormState } from '@/src/features/assessment-forms/api/assessmentForms';
import { SatSessionContextBar, getSatRoomMode, roomStatusTone, runtimeLabel } from '../ui/SatSessionContextBar';
import { SAT_SESSION_WARN_MESSAGE, SatSessionRoomConfirmDialog, type SatSessionRoomConfirmation } from '../ui/SatSessionRoomConfirmDialog';
import { SatSessionRoomInspector } from '../ui/SatSessionRoomInspector';
import { useSatRoomLayout } from '../ui/useSatRoomLayout';
import { SatSessionRoomRoster, type SatRosterSort } from '../ui/SatSessionRoomRoster';
import { SatSessionRoomTimeline } from '../ui/SatSessionRoomTimeline';
import { StudentDetail, studentAttentionReason } from '../ui/SatSessionRoomStudents';
import { satListReturnTarget } from '../ui/useSatListReturn';
import { rememberRoom } from '../ui/recentRooms';
import { SatStudentLinkPresent } from '../ui/SatStudentLink';
import { SatRoomNeedsAttention } from '../ui/SatRoomNeedsAttention';
import { StudentShareDialog } from '../../../features/exam-authoring/ui/access-links/AccessLinkShareSheet';
import { describeAccessLinkAudience, formatAccessLinkStatus, roomEntryUrl } from '../../../features/exam-authoring/ui/access-links/accessLinkUi';
import { buildSatRunSheet, formatRunSheetClockWithSeconds, formatRunSheetRemaining, satRunSheetCurrentRows, satRunSheetTimingPlan } from '../ui/sessionRunSheet';
import { isSatStageLive } from '../ui/satStage';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { ACCESS_LINK_SECTION_LABELS, effectiveAccessLinkSections } from '../../../features/exam-authoring/contracts/accessLinks';
import { sessionPhaseFromRuntime, sessionStatusLine } from '../../../features/exam-authoring/ui/delivery/sessionState';
import { examWorkspacePath } from '../../../features/exam-authoring/ui/shell/examLifecycle';
import { SatWaitingRoomPanel } from '../ui/SatWaitingRoomPanel';
import { SatStartCodePanel } from '../ui/SatStartCodePanel';
import type { SatStaffRouteAssignment } from '../ui/SatStaffRoutePanel';
import { useSatRoomEntryInfo } from '../api/satRoomEntryInfo';
import { isCommandConfirmed, type CommandOutcome } from '../../../features/proctor/api/proctorRoomApi';
import { SatRoomEntryPanel } from '../ui/room/SatRoomEntryPanel';
import { SatRoomHeader } from '../ui/room/SatRoomHeader';
import { SatRoomWorkspace } from '../ui/room/SatRoomWorkspace';
import '../ui/sat-session-room.css';

const RELOAD_FAILED_SUFFIX = ' However, the live view could not refresh. Retry to confirm.';
const EMPTY_PENDING_ACTIONS: ReadonlySet<string> = new Set();
type RoomMessage = { kind: 'success' | 'error'; text: string };
export function SatSessionRoomRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useSatNavigate();
  // Arriving from a test's Sessions tab keeps Back pointed at that test and session.
  const location = useLocation();
  const arrival = location.state as { from?: unknown; satCreatedRoom?: unknown } | null;
  const from = arrival?.from;
  const createdRoom = Boolean(scheduleId && arrival?.satCreatedRoom === scheduleId);
  const [dismissedCreation, setDismissedCreation] = useState<string | null>(null);
  const creationDismissed = dismissedCreation === scheduleId;
  const deliveryReturn = isExamDeliveryPath(from) ? from : null;
  const { session } = useAuthSession();
  const controller = useProctorRouteController({ providerKey: 'sat', initialScheduleId: scheduleId ?? null });
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingByRoom, setPendingByRoom] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map());
  const pendingActions = useMemo(() => {
    const entries = pendingByRoom.get(scheduleId ?? '');
    if (!entries) return EMPTY_PENDING_ACTIONS;
    const visible = new Set<string>();
    for (const entry of entries) {
      const [targetId, key] = JSON.parse(entry) as [string | null, string];
      if (targetId === null || targetId === selectedStudentId) visible.add(key);
    }
    return visible;
  }, [pendingByRoom, scheduleId, selectedStudentId]);
  const pendingKeysRef = useRef(new Set<string>());
  const pendingAttemptsRef = useRef(new Set<string>());
  const selectedStudentIdRef = useRef(selectedStudentId);
  selectedStudentIdRef.current = selectedStudentId;
  const [message, setMessage] = useState<RoomMessage | null>(null);
  const deferredMessagesRef = useRef(new Map<string, RoomMessage>());
  const [confirm, setConfirm] = useState<SatSessionRoomConfirmation | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'needs'>('all');
  const [rosterSort, setRosterSort] = useState<SatRosterSort>('name');
  const [pendingTransfers, setPendingTransfers] = useState<ReadonlySet<string>>(() => new Set());
  const [routeAssignmentReasons, setRouteAssignmentReasons] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [shareOpen, setShareOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [startCode, setStartCode] = useState<string | null>(null);
  const messageRef = useRef(message);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const completeConfirmTriggerRef = useRef<HTMLElement | null>(null);
  const { layout: roomLayout, ref: roomLayoutRef } = useSatRoomLayout();
  messageRef.current = message;
  const mountedRef = useRef(true);
  const roomIdentityRef = useRef({ scheduleId, generation: 0 });
  useLayoutEffect(() => {
    if (roomIdentityRef.current.scheduleId !== scheduleId) {
      roomIdentityRef.current = { scheduleId, generation: roomIdentityRef.current.generation + 1 };
      deferredMessagesRef.current.clear();
      setMessage(null);
      setConfirm(null);
    }
  }, [scheduleId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const schedule = controller.schedules.find((item) => item.id === scheduleId) ?? null;
  const runtime = controller.runtimeSnapshots.find((item) => item.scheduleId === scheduleId) ?? null;
  const roomReady = Boolean(schedule && runtime);
  useEffect(() => {
    if (!createdRoom || !roomReady) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      const active = document.activeElement;
      if (active === document.body || active?.id === 'sat-main') {
        document.querySelector<HTMLElement>('[data-sat-room-title]')?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createdRoom, roomReady, location.key]);
  const rememberedExamId = schedule?.examId ?? null;
  useEffect(() => {
    if (scheduleId && rememberedExamId) rememberRoom(scheduleId, rememberedExamId);
  }, [rememberedExamId, scheduleId]);
  const runtimeStatus = runtime?.status ?? 'not_started';
  const students = useMemo(() => controller.sessions.filter((item) => item.scheduleId === scheduleId), [controller.sessions, scheduleId]);
  const isAdmin = session?.user.role === 'admin';
  const canReadRoomEntryInfo = isAdmin || session?.user.role === 'proctor';
  const entryInfoQuery = useSatRoomEntryInfo(scheduleId ?? '', Boolean(schedule) && canReadRoomEntryInfo);
  const entryInfo = canReadRoomEntryInfo && !entryInfoQuery.isError ? entryInfoQuery.data : undefined;
  const accessLink = entryInfo?.link ?? null;
  const expectedStudents = entryInfo?.roster ?? [];
  const entryUrl = entryInfo && !entryInfoQuery.isError
    ? roomEntryUrl({ accessLinkId: accessLink?.id ?? null, scheduleId: scheduleId ?? '' })
    : null;
  const identificationInstructions = !accessLink
    ? 'Students enter their Student ID/WCODE, name, and email.'
    : accessLink.audienceType === 'selected_students'
      ? 'Listed students enter their assigned Student ID/WCODE. Any name or email included in the list must match.'
      : accessLink.accessMode === 'student_code'
        ? 'Students enter their Student ID/WCODE, name, and email. The code identifies them but is not checked against a roster.'
        : 'Students enter their name and email. No Student ID/WCODE is needed.';
  const startMode = schedule?.satStartMode === 'access_code' ? 'access_code' : 'proctor';
  const startInstructions = startMode === 'access_code'
    ? startCode ? 'After check-in, students enter the six-digit exam start code shown here.' : 'After check-in, students need the six-digit exam start code. Ask staff for the current code.'
    : 'After check-in, students wait here until you start the exam.';
  const attentionReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const student of students) {
      const reason = [
        studentAttentionReason(student, pendingTransfers.has(student.id), controller.alerts
          .filter((alert) => !alert.isAcknowledged && alert.studentId === student.studentId)
          .map((alert) => alert.message)),
        routeAssignmentReasons.get(student.id),
      ].filter(Boolean).join(' · ');
      if (reason) reasons.set(student.id, reason);
    }
    return reasons;
  }, [controller.alerts, pendingTransfers, routeAssignmentReasons, students]);
  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch = !needle || [student.name, student.studentId, student.email].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesAttention = attentionFilter === 'all' || attentionReasons.has(student.id);
      return matchesSearch && matchesAttention;
    });
  }, [attentionFilter, attentionReasons, search, students]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;
  // The room's own clock, resolved by the controller: ONE server instant plus the
  // shared 1s tick. The hero clock, the run sheet, every roster row and the
  // inspector all read this same instant, so no two windows on this page can
  // count the same deadline seconds apart.
  const roomClock = controller.roomClock;
  const serverNowMs = useRoomClockMs(roomClock);
  const stageRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
    serverNow: runtime?.serverNow ?? null,
    fallbackSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
    running: isSatStageLive(runtime),
    roomClock,
  });
  // ONE projection for the header and the table: the room builds the run sheet
  // from its own ticking clock and hands the same rows to the table, so "which
  // section and which module are we in?" has exactly one answer on the page.
  const runSheet = useMemo(
    () => buildSatRunSheet({
      plan: runtime?.examPlan ?? null,
      runtime: runtime ?? null,
      scheduledStartAt: schedule?.startTime ?? null,
      now: new Date(serverNowMs).toISOString(),
      // The stored timing plan decides what the rows MEAN: a personal-model
      // session is handed a per-candidate window (the section rows are this
      // sheet's projection), a cohort one is capped by the shared section clock.
      timingModel: runtime?.timingModel ?? null,
    }),
    [runtime, schedule?.startTime, serverNowMs],
  );
  const stageRows = satRunSheetCurrentRows(runSheet);
  const cohortStageRemainingSeconds = stageRows.break?.remainingSeconds ?? stageRemainingSeconds;
  const roomMode = runtime ? getSatRoomMode(runtime.status) : 'prestart';
  const sessionLive = runtime?.status === 'live' || runtime?.status === 'paused';
  const sessionFinished = runtime?.status === 'completed';
  const formState = useScheduleFormState(scheduleId);
  const evaOpen = formState.data?.collection === 'open';
  const evaMode = formState.data?.evaSimEnabled ? formState.data.mode : null;
  const currentStage = sessionFinished
    ? 'Room finished'
    : runtime?.status === 'cancelled'
      ? 'Room cancelled'
      : stageRows.break
        ? 'Break'
        : runtime?.sections.find((section) => section.sectionKey === runtime.currentSectionKey)?.label
          ?? runtime?.currentSectionKey
          ?? (runtime?.status === 'not_started' ? 'Ready to begin' : 'Waiting for next section');
  const attentionCount = attentionReasons.size;
  const statusLine = sessionStatusLine(accessLink?.status ?? null, sessionPhaseFromRuntime(runtime?.status, schedule?.status));
  const sectionsLabel = accessLink
    ? effectiveAccessLinkSections(accessLink.enabledSections, accessLink.publishScope).map((key) => ACCESS_LINK_SECTION_LABELS[key]).join(' and ') || 'None available'
    : satPublishScopeCopy(schedule?.publishScope ?? 'full');
  const readyCount = controller.scheduleMetrics[scheduleId ?? '']?.joinReadyCount ?? null;
  const selectStudent = (studentId: string, trigger: HTMLElement) => {
    inspectorTriggerRef.current = trigger;
    setSelectedStudentId(studentId);
    setInspectorOpen(true);
  };
  const updateRouteAssignments = useCallback((assignments: readonly SatStaffRouteAssignment[]) => {
    const sectionsByAttempt = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const section = assignment.sectionKey === 'math' ? 'Math' : 'Reading & Writing';
      const sections = sectionsByAttempt.get(assignment.attemptId) ?? new Set<string>();
      sections.add(section);
      sectionsByAttempt.set(assignment.attemptId, sections);
    }
    const next = new Map<string, string>();
    for (const [attemptId, sections] of sectionsByAttempt) {
      next.set(attemptId, `Module 2 choice needed · ${[...sections].join(' and ')}`);
    }
    setRouteAssignmentReasons((current) => {
      if (current.size === next.size && [...current].every(([id, reason]) => next.get(id) === reason)) return current;
      return next;
    });
  }, []);
  const updateStartCode = useCallback((code: string | null) => setStartCode(code), []);
  useEffect(() => {
    if (roomMode === 'review') updateRouteAssignments([]);
  }, [roomMode, updateRouteAssignments]);
  useEffect(() => {
    setStartCode(null);
    setShareOpen(false);
    setPresentOpen(false);
  }, [scheduleId]);
  const activeStudentCount = students.filter((student) => student.status === 'active').length;
  const proctorName = session?.user.displayName?.trim() || session?.user.email || 'Proctor';
  const openAlerts = controller.alerts.filter((alert) => !alert.isAcknowledged).length;
  const isStale = Boolean(controller.error);
  const lastUpdatedLabel = controller.lastSuccessfulRefreshAt
    ? `${formatRunSheetClockWithSeconds(controller.lastSuccessfulRefreshAt)} ICT`
    : 'unknown';

  useEffect(() => {
    if (!selectedStudentId && students[0]) setSelectedStudentId(students[0].id);
    if (selectedStudentId && !students.some((student) => student.id === selectedStudentId)) setSelectedStudentId(students[0]?.id ?? null);
  }, [selectedStudentId, students]);

  // F-B16: success scoping — clear transient success banners on selection
  // change so a stale "added N minutes" never follows the next student.
  // Errors persist until the next action clears them explicitly.
  useEffect(() => {
    if (messageRef.current?.kind === 'success') setMessage(null);
    if (!selectedStudentId) return;
    const key = JSON.stringify([scheduleId ?? '', selectedStudentId]);
    const deferred = deferredMessagesRef.current.get(key);
    if (deferred) {
      deferredMessagesRef.current.delete(key);
      setMessage(deferred);
    }
  }, [scheduleId, selectedStudentId]);

  const setActionPending = useCallback((roomId: string, key: string, targetId: string | undefined, active: boolean) => {
    setPendingByRoom((current) => {
      const existing = current.get(roomId) ?? EMPTY_PENDING_ACTIONS;
      const entry = JSON.stringify([targetId ?? null, key]);
      if (existing.has(entry) === active) return current;
      const next = new Map(current);
      const roomPending = new Set(existing);
      if (active) roomPending.add(entry);
      else roomPending.delete(entry);
      if (roomPending.size > 0) next.set(roomId, roomPending);
      else next.delete(roomId);
      return next;
    });
  }, []);

  const run = useCallback(async (key: string, action: () => Promise<void>, success: string | (() => string), propagateFailure = false, targetStudentId?: string) => {
    const roomId = scheduleId ?? '';
    const generation = roomIdentityRef.current.generation;
    const isCurrentRoom = () => mountedRef.current && roomIdentityRef.current.scheduleId === scheduleId &&
      roomIdentityRef.current.generation === generation;
    const reportMessage = (next: RoomMessage) => {
      if (!isCurrentRoom()) return;
      if (targetStudentId && selectedStudentIdRef.current !== targetStudentId) {
        deferredMessagesRef.current.set(JSON.stringify([roomId, targetStudentId]), next);
      } else {
        setMessage(next);
      }
    };
    if (isStale) {
      const error = new Error('This action was not completed because room data is out of date. Retry to confirm the current room state.');
      setMessage({ kind: 'error', text: error.message });
      if (propagateFailure) throw error;
      return;
    }
    const pendingKey = JSON.stringify([roomId, targetStudentId ?? null, key]);
    const attemptKey = targetStudentId ? JSON.stringify([roomId, targetStudentId]) : null;
    if (pendingKeysRef.current.has(pendingKey) || (attemptKey && pendingAttemptsRef.current.has(attemptKey))) {
      if (propagateFailure) throw new Error('This action is already in progress.');
      return;
    }
    pendingKeysRef.current.add(pendingKey);
    if (attemptKey) pendingAttemptsRef.current.add(attemptKey);
    setActionPending(roomId, key, targetStudentId, true);
    if (!targetStudentId || selectedStudentIdRef.current === targetStudentId) setMessage(null);
    const startedAt = Date.now();
    try {
      await action();
      try {
        await controller.reload();
      } catch (reloadError) {
        logError(reloadError, { scope: 'sat.session.action.reload', action: key, scheduleId, latencyMs: Date.now() - startedAt });
        reportMessage({ kind: 'error', text: `${typeof success === 'function' ? success() : success}${RELOAD_FAILED_SUFFIX}` });
        return;
      }
      // IDs only — never student names or emails (PII).
      logInfo('sat.session.action', { action: key, scheduleId, latencyMs: Date.now() - startedAt, outcome: 'success' });
      reportMessage({ kind: 'success', text: typeof success === 'function' ? success() : success });
    } catch (error) {
      logError(error, { scope: 'sat.session.action', action: key, scheduleId, latencyMs: Date.now() - startedAt });
      reportMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The action could not be completed.' });
      if (propagateFailure) throw error instanceof Error ? error : new Error('The action could not be completed.');
    } finally {
      pendingKeysRef.current.delete(pendingKey);
      if (attemptKey) pendingAttemptsRef.current.delete(attemptKey);
      if (mountedRef.current) setActionPending(roomId, key, targetStudentId, false);
    }
  }, [controller, isStale, scheduleId, setActionPending]);

  const requireConfirmedAction = (outcome: CommandOutcome) => {
    if (outcome.kind === 'uncertain') {
      void controller.reload().catch(() => undefined);
      throw new Error(outcome.error);
    }
    if (outcome.kind === 'rejected') throw new Error(outcome.error);
  };

  const runStudentAction = async (key: string, action: () => Promise<CommandOutcome>, success: string, targetStudentId?: string) => run(key, async () => {
    requireConfirmedAction(await action());
  }, success, false, targetStudentId);

  const confirmCurrentAction = () => {
    const action = confirm;
    setConfirm(null);
    if (!action || !scheduleId) return;
    if (action.kind === 'start') {
      void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Exam started.');
      return;
    }
    if (action.kind === 'complete') {
      // Report only what the server confirmed: the runtime command result,
      // then the re-read Eva closure time.
      let completeMessage = 'Room completed.';
      const generation = roomIdentityRef.current.generation;
      void run('complete', async () => {
        requireConfirmedAction(await proctorMutations.completeRuntime(scheduleId, proctorName));
        try {
          const forms = await formState.refetch();
          const closedAt = forms.data?.closedAt ? new Date(forms.data.closedAt) : null;
          if (closedAt && !Number.isNaN(closedAt.getTime())) {
            completeMessage = `Room completed. Eva SIM closed at ${closedAt.toLocaleTimeString()}.`;
          }
        } catch (error) {
          logError(error, { scope: 'sat.session.action.forms-refresh', scheduleId });
        }
        requestAnimationFrame(() => {
          if (roomIdentityRef.current.generation === generation && !completeConfirmTriggerRef.current?.isConnected) document.querySelector<HTMLElement>('[data-sat-room-title]')?.focus();
        });
      }, () => completeMessage);
      return;
    }
    if (action.kind === 'extend-session') {
      void runStudentAction(`extend-${action.minutes}`, () => proctorMutations.extendSection(scheduleId, proctorName, action.minutes, action.sectionKey, action.runtimeRevision), `Added ${action.minutes} minutes to ${action.stage}.`);
      return;
    }
    const bound = students.find((student) => student.id === action.studentId);
    if (!bound) {
      if (mountedRef.current) {
        const outcome = action.kind === 'warn'
          ? 'no warning was sent'
          : action.kind === 'extend-student'
            ? 'no time was added'
            : 'their attempt was not ended';
        setMessage({ kind: 'error', text: `${action.studentName} is no longer in this room, so ${outcome}.` });
      }
      return;
    }
    if (action.kind === 'warn') {
      void runStudentAction('student-warn', () => proctorMutations.warnStudent(bound.id, SAT_SESSION_WARN_MESSAGE, proctorName), `Warning sent to ${bound.name}.`, bound.id);
      return;
    }
    if (action.kind === 'extend-student') {
      void runStudentAction(`student-extend-${action.minutes}`, () => proctorMutations.extendStudent(bound.id, proctorName, action.minutes, action.moduleId), `Added ${action.minutes} minutes for ${bound.name}.`, bound.id);
      return;
    }
    void runStudentAction('student-terminate', () => proctorMutations.terminateStudent(bound.id, proctorName), `${bound.name}’s attempt ended.`, bound.id);
  };

  const inspectorContent = selectedStudent ? (
        <StudentDetail
          key={selectedStudent.id}
          student={selectedStudent}
          runtime={runtime}
          roomClock={roomClock}
          variant={roomMode === 'review' ? 'review' : 'operational'}
          pendingActions={pendingActions}
          blocked={isStale}
          onAddTime={(minutes) => {
            if (isStale) return;
            setConfirm({
              kind: 'extend-student',
              minutes,
              moduleId: selectedStudent.runtimeCurrentModuleId ?? '',
              studentId: selectedStudent.id,
              studentName: selectedStudent.name,
              remainingLabel: formatRunSheetRemaining(selectedStudent.runtimeTimeRemainingSeconds ?? selectedStudent.timeRemaining),
            });
          }}
          onWarn={() => setConfirm({ kind: 'warn', studentId: selectedStudent.id, studentName: selectedStudent.name })}
          onPause={() => void runStudentAction('student-pause', () => proctorMutations.pauseStudent(selectedStudent.id, proctorName), `${selectedStudent.name} paused.`, selectedStudent.id)}
          onResume={() => void runStudentAction('student-resume', () => proctorMutations.resumeStudent(selectedStudent.id, proctorName), `${selectedStudent.name} resumed.`, selectedStudent.id)}
          onTerminate={() => setConfirm({ kind: 'terminate', studentId: selectedStudent.id, studentName: selectedStudent.name })}
          onResolveRecovery={({ resolutionId, reason }) => {
            const moduleAttemptId = selectedStudent.satRecoveryModuleAttemptId;
            const expectedBoundaryRevision = selectedStudent.satRecoveryBoundaryRevision;
            if (!moduleAttemptId || expectedBoundaryRevision == null || !scheduleId) {
              return Promise.reject(new Error('The recovery state could not be verified. Refresh the room and review it again.'));
            }
            const action = selectedStudent.satRecoveryKind === 'entry' ? 'activate_entry' : 'continue_confirmed';
            return run(
              `sat-recovery-${selectedStudent.id}`,
              async () => {
                const outcome = await controller.commands.resolveRecovery({
                  scheduleId, attemptId: selectedStudent.id, resolutionId, moduleAttemptId, expectedBoundaryRevision, action, reason,
                });
                if (outcome.kind === 'uncertain') void controller.reload().catch(() => undefined);
                if (!isCommandConfirmed(outcome)) throw new Error(outcome.error);
              },
              selectedStudent.satRecoveryKind === 'entry'
                ? `${selectedStudent.name}’s module started.`
                : `${selectedStudent.name} continued with server-confirmed answers.`,
              true,
              selectedStudent.id,
            );
          }}
        />
      ) : (
        <div className="flex min-h-60 flex-col items-center justify-center px-4 py-8 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)]" aria-hidden="true"><UserRound size={20} /></span>
          <p className="mt-3 text-[16px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{sessionFinished ? 'Room finished' : sessionLive ? 'Select a student' : runtimeStatus === 'not_started' ? 'Waiting to begin' : 'Room cancelled'}</p>
          <p className="mt-1 max-w-[34ch] text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            {sessionLive
              ? 'Choose a student in the roster to inspect their progress, timing, and integrity events.'
              : sessionFinished
                ? 'The run sheet remains available for a review of the completed session.'
                : runtimeStatus === 'not_started'
                  ? 'Students appear in the roster as they open their exam link. Select one to check their details.'
                  : 'This room was cancelled. The run sheet shows the timeline recorded so far.'}
          </p>
          {runtimeStatus === 'not_started' ? <SatButton variant="secondary" onClick={() => setShareOpen(true)} className="mt-4">Share student link</SatButton> : null}
        </div>
      );

  if (!scheduleId) return <SatPageError title="SAT room not found" description="A valid SAT room is required." retryLabel="Back to Rooms" onRetry={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && (!schedule || !runtime)) return <SatPageLoading label={createdRoom ? "Room created. Opening your room…" : "Opening SAT room…"} />;
  if (controller.error && (!schedule || !runtime)) return <SatPageError title={createdRoom ? "Room created, but its page could not load" : "SAT room could not load"} description={controller.error} retryLabel="Retry" onRetry={() => void controller.reload()} />;
  if (!schedule || !runtime) return <SatPageError title="SAT room not found" description="This room is not part of the Digital SAT workspace." retryLabel="Back to Rooms" onRetry={() => navigate('/sat/sessions')} />;

  // The exam's Rooms tab reopens with this room highlighted and its settings open.
  const roomSettingsPath = `${examWorkspacePath(schedule.examId, 'delivery')}${accessLink ? `?${new URLSearchParams({ link: accessLink.id, edit: '1' })}` : ''}`;
  // Admins review inside the test workspace; proctors use the global Results list, filtered to this session.
  const resultsPath = isAdmin
    ? `${examWorkspacePath(schedule.examId, 'responses')}?${new URLSearchParams({ access: schedule.id })}`
    : `/sat/results?${new URLSearchParams({ exam: schedule.examId, access: schedule.id })}`;
  const goBack = () => {
    if (deliveryReturn) { navigate(deliveryReturn); return; }
    const back = satListReturnTarget('/sat/sessions');
    navigate(back.to, back.state ? { state: back.state } : undefined);
  };

  const title = accessLink?.name ?? schedule.cohortName;
  const entryPanel = roomMode === 'review' ? null : (
    <SatRoomEntryPanel
      key="entry"
      entryUrl={entryUrl}
      cohortName={schedule.cohortName}
      status={entryUrl ? 'ready' : entryInfoQuery.isLoading ? 'loading' : entryInfoQuery.isError ? 'error' : 'unavailable'}
      identificationInstructions={identificationInstructions}
      startInstructions={startInstructions}
      onRetry={() => void entryInfoQuery.refetch()}
      onOpenShare={() => setShareOpen(true)}
      onPresent={() => setPresentOpen(true)}
    />
  );
  const attentionPanel = roomMode === 'review' ? null : (
    <SatRoomNeedsAttention
      key="attention"
      scheduleId={scheduleId}
      blocked={isStale}
      students={students}
      alerts={controller.alerts}
      onSelectStudent={selectStudent}
      onPendingTransfersChange={setPendingTransfers}
      onPendingAssignmentsChange={updateRouteAssignments}
    />
  );
  // Code-start rooms lead with the shared start code, large, right under the
  // stage: it is what students copy from the front of the room. Then, before
  // the start, joining is the job; once running, open issues come first.
  // Keyed so the panels move rather than remount when the room starts.
  const startCodePanel = roomMode !== 'review' && startMode === 'access_code' && entryUrl
    ? <SatStartCodePanel key="start-code" scheduleId={scheduleId} blocked={isStale} onCodeChange={updateStartCode} />
    : null;
  const roomPanels = roomMode === 'prestart'
    ? [startCodePanel, entryPanel, attentionPanel]
    : [startCodePanel, attentionPanel, entryPanel];
  const notices = isStale || message || (createdRoom && !creationDismissed) ? (
    <>
      {createdRoom && !creationDismissed ? (
        <div role="status" className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface)] px-4 py-2 text-[14px]">
          <p><span className="font-semibold">Room created.</span> Your room is ready to manage.</p>
          <SatButton variant="quiet" onClick={() => setDismissedCreation(scheduleId ?? null)} aria-label="Dismiss room creation confirmation">Dismiss</SatButton>
        </div>
      ) : null}
      {isStale ? (
        <div role="alert" className="sat-banner-enter flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[var(--sat-staff-radius-card,14px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-4 py-2 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
          <p className="min-w-0 flex-1 basis-60"><span className="font-semibold">Data may be out of date.</span> Risky room actions are paused until reconnection.</p>
          <SatButton variant="secondary" onClick={() => void controller.reload()}>Retry</SatButton>
        </div>
      ) : null}
      {message ? (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`sat-banner-enter rounded-[var(--sat-staff-radius-card,14px)] px-4 py-2.5 text-[14px] font-medium leading-5 ${message.kind === 'error'
            ? 'bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] text-[var(--sat-staff-danger,#b42318)]'
            : 'border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] text-[var(--sat-staff-text-secondary,#515154)]'}`}
        >
          {message.text}
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <>
      <SatRoomWorkspace
        layoutRef={roomLayoutRef}
        layout={roomLayout}
        mode={roomMode}
        header={(
          <SatRoomHeader
            title={title}
            status={<SatStatusPill tone={roomStatusTone(runtime.status)} pulse={runtime.status === 'live'}>{runtimeLabel(runtime.status)}</SatStatusPill>}
            details={`${schedule.examTitle}${accessLink ? ` · Version ${accessLink.versionNumber}` : ''} · ${satPublishScopeCopy(schedule.publishScope ?? 'full')}`}
            statusLine={sessionFinished && formState.data?.evaSimEnabled
              ? `${statusLine} · Eva SIM ${evaOpen ? 'open' : 'closed'}`
              : statusLine}
            onBack={goBack}
            actions={(
              <>
                {controller.error ? <span role="status" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--sat-staff-warning-text,#92400e)]"><AlertTriangle size={16} aria-hidden="true" />Reconnecting</span> : null}
                {isAdmin ? <SatButton variant="quiet" onClick={() => navigate(roomSettingsPath)}>Room settings</SatButton> : null}
                <SatSessionControls runtimeStatus={runtime.status} pendingActions={pendingActions} blocked={isStale} onViewResponses={roomMode === 'review' ? () => navigate(resultsPath) : undefined} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Exam paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Exam resumed.')} onExtend={(minutes) => {
                  if (isStale) return;
                  const revision = runtime.revision;
                  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || !runtime.activeSectionKey) {
                    setMessage({ kind: 'error', text: 'Refresh the room before adding time. Its current stage could not be confirmed.' });
                    return;
                  }
                  setConfirm({ kind: 'extend-session', minutes, stage: currentStage, sectionKey: runtime.activeSectionKey, runtimeRevision: revision, remainingLabel: formatRunSheetRemaining(cohortStageRemainingSeconds) });
                }} evaOpen={evaOpen} onComplete={(trigger) => {
                  completeConfirmTriggerRef.current = trigger;
                  setConfirm({ kind: 'complete', evaMode, runtimeCompleted: runtime.status === 'completed' });
                }} />
                {scheduleId && formState.data && formState.data.collection !== 'not_applicable' ? (
                  <SatButton variant="quiet" onClick={() => navigate(`/sat/forms?form=eva_sim&scheduleId=${encodeURIComponent(scheduleId)}`)}>Form responses</SatButton>
                ) : null}
              </>
            )}
          />
        )}
        summary={(
          <SatSessionContextBar
            runtime={runtime}
            scheduledStartAt={schedule.startTime}
            joinedCount={students.length}
            activeCount={activeStudentCount}
            readyCount={readyCount}
            attentionCount={attentionCount}
            openAlerts={openAlerts}
            isStale={isStale}
            lastUpdatedLabel={lastUpdatedLabel}
            onNeedsAttention={() => setAttentionFilter('needs')}
          />
        )}
        notices={notices}
        students={(
          <SatSessionRoomRoster
            students={students}
            expectedStudents={expectedStudents}
            visibleStudents={visibleStudents}
            selectedStudent={selectedStudent}
            runtime={runtime}
            roomClock={roomClock}
            search={search}
            onSearchChange={setSearch}
            attentionFilter={attentionFilter}
            onAttentionFilterChange={setAttentionFilter}
            attentionCount={attentionCount}
            attentionReasons={attentionReasons}
            sort={rosterSort}
            onSortChange={setRosterSort}
            onSelect={selectStudent}
            onShareLink={roomMode === 'review' || !entryUrl ? undefined : () => setShareOpen(true)}
          />
        )}
        context={(
          <SatSessionRoomTimeline
            key={runtime.scheduleId}
            runtime={runtime}
            scheduledStartAt={schedule.startTime}
            runSheet={runSheet}
            roomMode={roomMode}
            sessionLive={sessionLive}
            currentStage={currentStage}
            remainingSeconds={cohortStageRemainingSeconds}
            startMode={startMode}
            studentEntry={roomMode === 'prestart' ? (
              <SatWaitingRoomPanel
                versionLabel={accessLink ? `Version ${accessLink.versionNumber}` : null}
                sectionsLabel={sectionsLabel}
                startPending={pendingActions.has('start')}
                startBlocked={isStale}
                onStart={startMode === 'proctor'
                  ? () => setConfirm({ kind: 'start', joinedCount: students.length, readyCount, sectionsLabel, perCandidateTiming: satRunSheetTimingPlan(runtime.timingModel)?.perCandidate ?? null })
                  : undefined}
              />
            ) : undefined}
          >
            {roomPanels}
          </SatSessionRoomTimeline>
        )}
        inspector={(
          <SatSessionRoomInspector
            open={inspectorOpen}
            docked={roomLayout === 'wide'}
            onOpenChange={setInspectorOpen}
            restoreFocusTarget={() => inspectorTriggerRef.current}
          >
            {inspectorContent}
          </SatSessionRoomInspector>
        )}
      />

      <SatSessionRoomConfirmDialog
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmCurrentAction}
        restoreFocusTarget={confirm?.kind === 'complete' ? completeConfirmTriggerRef.current : null}
      />

      <StudentShareDialog
        open={shareOpen && Boolean(entryUrl)}
        url={entryUrl ?? ''}
        roomName={title}
        examTitle={schedule.examTitle}
        versionNumber={accessLink?.versionNumber ?? null}
        audience={accessLink ? describeAccessLinkAudience(accessLink) : null}
        checkIn={accessLink ? formatAccessLinkStatus(accessLink.status) : null}
        checkInOpen={accessLink
          ? accessLink.status === 'live'
          : ['scheduled', 'live'].includes(schedule.status)
            && serverNowMs >= Date.parse(schedule.startTime)
            && serverNowMs < Date.parse(schedule.endTime)}
        studentInstructions={`${identificationInstructions} ${startInstructions}`}
        startCode={startMode === 'access_code' ? startCode : null}
        onClose={() => setShareOpen(false)}
        onPresent={() => { setShareOpen(false); setPresentOpen(true); }}
      />
      <SatStudentLinkPresent
        open={presentOpen && Boolean(entryUrl)}
        url={entryUrl ?? ''}
        examTitle={schedule.examTitle}
        cohortName={schedule.cohortName}
        startCode={startMode === 'access_code' ? startCode : null}
        joinedCount={students.length}
        activeCount={activeStudentCount}
        onClose={() => setPresentOpen(false)}
      />
    </>
  );
}
