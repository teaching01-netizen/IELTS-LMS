import { examRepository, type IExamRepository } from './examRepository';
import {
  CohortControlEvent,
  ExamSchedule,
  ExamSessionRuntime,
  ExamVersion,
  ProctorPresence,
  RuntimeStatus,
  SectionRuntimeState,
  SectionRuntimeStatus
} from '../types/domain';
import { ExamConfig, ModuleType, ValidationError } from '../types';
import { normalizeExamConfig } from '../constants/examDefaults';
import { isScheduleReadyToStart } from '../utils/scheduleUtils';

export interface SectionPlanItem {
  sectionKey: ModuleType;
  label: string;
  order: number;
  durationMinutes: number;
  gapAfterMinutes: number;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface SectionPlan {
  sections: SectionPlanItem[];
  plannedDurationMinutes: number;
}

export interface ScheduleWindowValidationResult {
  isValid: boolean;
  plannedDurationMinutes: number;
  windowMinutes: number;
  errors: ValidationError[];
}

export interface RuntimeMutationResult {
  success: boolean;
  runtime?: ExamSessionRuntime | null;
  error?: string;
}

interface ScheduleContext {
  schedule: ExamSchedule;
  version: ExamVersion;
  config: ExamConfig;
  plan: SectionPlan;
}

const MODULE_ORDER: ModuleType[] = ['listening', 'reading', 'writing', 'speaking'];

const completionReasonMap = {
  autoTimeout: 'auto_timeout' as const,
  proctorEnd: 'proctor_end' as const,
  proctorComplete: 'proctor_complete' as const
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function sortSections(config: ExamConfig) {
  return MODULE_ORDER
    .filter(sectionKey => config.sections[sectionKey].enabled)
    .map(sectionKey => ({
      sectionKey,
      config: config.sections[sectionKey]
    }))
    .sort((a, b) => {
      if (a.config.order !== b.config.order) {
        return a.config.order - b.config.order;
      }
      return MODULE_ORDER.indexOf(a.sectionKey) - MODULE_ORDER.indexOf(b.sectionKey);
    });
}

function createSectionRuntimeState(
  planItem: SectionPlanItem,
  status: SectionRuntimeStatus,
  availableAt: string | null,
  actualStartAt: string | null,
  actualEndAt: string | null,
  pausedAt: string | null,
  accumulatedPausedSeconds = 0,
  extensionMinutes = 0,
  completionReason?: SectionRuntimeState['completionReason']
): SectionRuntimeState {
  return {
    sectionKey: planItem.sectionKey,
    label: planItem.label,
    order: planItem.order,
    plannedDurationMinutes: planItem.durationMinutes,
    gapAfterMinutes: planItem.gapAfterMinutes,
    status,
    availableAt,
    actualStartAt,
    actualEndAt,
    pausedAt,
    accumulatedPausedSeconds,
    extensionMinutes,
    completionReason,
    projectedStartAt: availableAt,
    projectedEndAt: null
  };
}

function buildRuntimeFromPlan(
  context: ScheduleContext,
  nowMs: number,
  status: RuntimeStatus,
  firstSectionLive: boolean
): ExamSessionRuntime {
  const { schedule, plan } = context;
  const runtimeStart = firstSectionLive ? nowMs : null;
  const cursor = runtimeStart;

  const sections = plan.sections.map((item, index) => {
    const projectedStart = cursor !== null ? cursor + item.startOffsetMinutes * 60_000 : null;
    const projectedEnd = cursor !== null ? cursor + item.endOffsetMinutes * 60_000 : null;
    const sectionStatus: SectionRuntimeStatus = firstSectionLive
      ? (index === 0 ? 'live' : 'locked')
      : 'locked';
    const actualStartAt = firstSectionLive && index === 0 ? toIso(nowMs) : null;
    const availableAt = cursor !== null ? toIso(cursor + item.startOffsetMinutes * 60_000) : null;
    const section = createSectionRuntimeState(
      item,
      sectionStatus,
      availableAt,
      actualStartAt,
      null,
      null
    );
    section.projectedStartAt = projectedStart !== null ? toIso(projectedStart) : null;
    section.projectedEndAt = projectedEnd !== null ? toIso(projectedEnd) : null;
    return section;
  });

  const firstSection = sections[0];
  return {
    id: generateId('runtime'),
    scheduleId: schedule.id,
    examId: schedule.examId,
    examTitle: schedule.examTitle,
    cohortName: schedule.cohortName,
    deliveryMode: schedule.deliveryMode,
    status,
    actualStartAt: runtimeStart !== null ? toIso(runtimeStart) : null,
    actualEndAt: null,
    activeSectionKey: firstSectionLive ? firstSection?.sectionKey ?? null : null,
    currentSectionKey: firstSectionLive ? firstSection?.sectionKey ?? null : null,
    currentSectionRemainingSeconds: firstSectionLive ? (firstSection?.plannedDurationMinutes ?? 0) * 60 : 0,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections,
    createdAt: toIso(nowMs),
    updatedAt: toIso(nowMs)
  };
}

function findScheduleVersion(schedule: ExamSchedule, version?: ExamVersion | null): string | null {
  if (schedule.publishedVersionId) return schedule.publishedVersionId;
  return version?.id || null;
}

export class ExamDeliveryService {
  constructor(private repository: IExamRepository = examRepository) {}

  buildSectionPlan(config: ExamConfig): SectionPlan {
    const normalized = normalizeExamConfig(config);
    const enabledSections = sortSections(normalized);

    let runningOffset = 0;
    const sections = enabledSections.map((entry, index) => {
      const durationMinutes = entry.config.duration;
      const gapAfterMinutes = entry.config.gapAfterMinutes ?? 0;
      const startOffsetMinutes = runningOffset;
      const endOffsetMinutes = runningOffset + durationMinutes;

      if (index < enabledSections.length - 1) {
        runningOffset = endOffsetMinutes + gapAfterMinutes;
      } else {
        runningOffset = endOffsetMinutes;
      }

      return {
        sectionKey: entry.sectionKey,
        label: entry.config.label,
        order: entry.config.order,
        durationMinutes,
        gapAfterMinutes,
        startOffsetMinutes,
        endOffsetMinutes
      };
    });

    return {
      sections,
      plannedDurationMinutes: runningOffset
    };
  }

  validateScheduleWindow(
    config: ExamConfig,
    startTime: string,
    endTime: string
  ): ScheduleWindowValidationResult {
    const normalized = normalizeExamConfig(config);
    const plan = this.buildSectionPlan(normalized);
    const errors: ValidationError[] = [];

    const enabledSections = sortSections(normalized);
    if (enabledSections.length === 0) {
      errors.push({
        field: 'sections',
        message: 'At least one enabled section is required',
        type: 'error'
      });
    }

    const orders = new Map<number, number>();
    enabledSections.forEach(({ sectionKey, config: section }) => {
      if (section.duration <= 0) {
        errors.push({
          field: `sections.${sectionKey}.duration`,
          message: 'Section duration must be greater than 0',
          type: 'error'
        });
      }

      if (section.gapAfterMinutes < 0) {
        errors.push({
          field: `sections.${sectionKey}.gapAfterMinutes`,
          message: 'Gap after section cannot be negative',
          type: 'error'
        });
      }

      orders.set(section.order, (orders.get(section.order) ?? 0) + 1);
    });

    orders.forEach((count, order) => {
      if (count > 1) {
        errors.push({
          field: 'sections.order',
          message: `Duplicate section order ${order} detected`,
          type: 'error'
        });
      }
    });

    const startMs = toMs(startTime);
    const endMs = toMs(endTime);
    if (startMs === null || endMs === null || endMs <= startMs) {
      errors.push({
        field: 'window',
        message: 'Scheduled end time must be after start time',
        type: 'error'
      });
    }

    const windowMinutes = startMs !== null && endMs !== null ? (endMs - startMs) / 60_000 : 0;
    if (windowMinutes < plan.plannedDurationMinutes) {
      errors.push({
        field: 'window',
        message: `Scheduled window must be at least ${plan.plannedDurationMinutes} minutes`,
        type: 'error'
      });
    }

    return {
      isValid: errors.filter(error => error.type === 'error').length === 0,
      plannedDurationMinutes: plan.plannedDurationMinutes,
      windowMinutes,
      errors
    };
  }

  async startRuntime(scheduleId: string, actor: string, now: Date | string = new Date()): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) {
      return { success: false, error: 'Schedule not found' };
    }

    const existing = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (existing) {
      return { success: false, error: 'Runtime already exists for this schedule' };
    }

    if (!isScheduleReadyToStart(context.schedule, null, now)) {
      const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
      const startMs = toMs(context.schedule.startTime);
      const endMs = toMs(context.schedule.endTime);

      if (startMs !== null && nowMs < startMs) {
        return { success: false, error: 'Scheduled session is not ready yet' };
      }

      if (endMs !== null && nowMs >= endMs) {
        return { success: false, error: 'Scheduled window has already ended' };
      }

      return { success: false, error: 'Scheduled session is not ready to start' };
    }

    const windowValidation = this.validateScheduleWindow(
      context.config,
      context.schedule.startTime,
      context.schedule.endTime
    );
    if (!windowValidation.isValid) {
      return { success: false, error: windowValidation.errors.map(error => error.message).join('; ') };
    }

    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
    const runtime = buildRuntimeFromPlan(context, nowMs, 'live', true);
    await this.repository.saveRuntime(runtime);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: runtime.id,
      examId: context.schedule.examId,
      actor,
      action: 'start_runtime',
      timestamp: toIso(nowMs),
      payload: {
        cohortName: context.schedule.cohortName,
        plannedDurationMinutes: context.plan.plannedDurationMinutes
      }
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  async getRuntimeSnapshot(scheduleId: string, now: Date | string = new Date()): Promise<ExamSessionRuntime | null> {
    const context = await this.loadContext(scheduleId);
    if (!context) return null;

    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();

    if (!runtime) {
      return this.buildNotStartedSnapshot(context, nowMs);
    }

    const snapshot = clone(runtime);
    const { changed, events } = this.advanceRuntime(snapshot, context, nowMs);
    this.decorateRuntimeSnapshot(snapshot, context, nowMs);

    if (changed) {
      for (const event of events) {
        await this.repository.saveControlEvent(event);
      }
      snapshot.updatedAt = toIso(nowMs);
      await this.repository.saveRuntime(snapshot);
    }

    return snapshot;
  }

  async sendHeartbeat(
    scheduleId: string,
    proctorId: string,
    proctorName: string
  ): Promise<void> {
    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return;

    const now = new Date().toISOString();
    const currentPresence = runtime.proctorPresence ?? [];
    const existingPresence = currentPresence.find(p => p.proctorId === proctorId);

    let updatedPresence: ProctorPresence[];

    if (existingPresence) {
      // Update existing proctor's heartbeat
      updatedPresence = currentPresence.map(p =>
        p.proctorId === proctorId
          ? { ...p, lastHeartbeat: now }
          : p
      );
    } else {
      // Add new proctor to presence
      const newPresence: ProctorPresence = {
        proctorId,
        proctorName,
        joinedAt: now,
        lastHeartbeat: now
      };
      updatedPresence = [...(runtime.proctorPresence || []), newPresence];
    }

    // Clean up stale presences (older than 5 minutes)
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const cleanedPresence = updatedPresence.filter(p => p.lastHeartbeat > staleThreshold);

    const updatedRuntime = {
      ...runtime,
      proctorPresence: cleanedPresence,
      updatedAt: now
    };

    await this.repository.saveRuntime(updatedRuntime);
  }

  async removeProctorPresence(scheduleId: string, proctorId: string): Promise<void> {
    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return;

    const updatedPresence = (runtime.proctorPresence || []).filter(p => p.proctorId !== proctorId);

    const updatedRuntime = {
      ...runtime,
      proctorPresence: updatedPresence,
      updatedAt: new Date().toISOString()
    };

    await this.repository.saveRuntime(updatedRuntime);
  }

  async warnStudent(attemptId: string, message: string, actor: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { studentAttemptRepository } = await import('./studentAttemptRepository');
      const allAttempts = await studentAttemptRepository.getAllAttempts();
      const attempt = allAttempts.find(a => a.id === attemptId);
      if (!attempt) {
        return { success: false, error: 'Attempt not found' };
      }

      const timestamp = new Date().toISOString();
      const warningId = generateId('violation');
      const updatedAttempt = {
        ...attempt,
        violations: [
          ...attempt.violations,
          {
            id: warningId,
            type: 'PROCTOR_WARNING',
            severity: 'medium' as const,
            timestamp,
            description: message,
          }
        ],
        proctorStatus: 'warned' as const,
        proctorNote: message,
        proctorUpdatedAt: timestamp,
        proctorUpdatedBy: actor,
        lastWarningId: warningId,
        updatedAt: timestamp,
      };

      await studentAttemptRepository.saveAttempt(updatedAttempt);
      await this.repository.saveAuditLog({
        id: generateId('audit'),
        timestamp,
        actor,
        actionType: 'STUDENT_WARN',
        targetStudentId: attempt.id,
        sessionId: attempt.scheduleId,
        payload: {
          candidateId: attempt.candidateId,
          message,
          warningId,
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to warn student' };
    }
  }

  async pauseStudentAttempt(attemptId: string, actor: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { studentAttemptRepository } = await import('./studentAttemptRepository');
      const allAttempts = await studentAttemptRepository.getAllAttempts();
      const attempt = allAttempts.find(a => a.id === attemptId);
      if (!attempt) {
        return { success: false, error: 'Attempt not found' };
      }

      const timestamp = new Date().toISOString();
      const updatedAttempt = {
        ...attempt,
        proctorStatus: 'paused' as const,
        proctorUpdatedAt: timestamp,
        proctorUpdatedBy: actor,
        updatedAt: timestamp,
      };

      await studentAttemptRepository.saveAttempt(updatedAttempt);
      await this.repository.saveAuditLog({
        id: generateId('audit'),
        timestamp,
        actor,
        actionType: 'STUDENT_PAUSE',
        targetStudentId: attempt.id,
        sessionId: attempt.scheduleId,
        payload: {
          candidateId: attempt.candidateId,
          previousPhase: attempt.phase,
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to pause student' };
    }
  }

  async resumeStudentAttempt(attemptId: string, actor: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { studentAttemptRepository } = await import('./studentAttemptRepository');
      const allAttempts = await studentAttemptRepository.getAllAttempts();
      const attempt = allAttempts.find(a => a.id === attemptId);
      if (!attempt) {
        return { success: false, error: 'Attempt not found' };
      }

      const timestamp = new Date().toISOString();
      const updatedAttempt = {
        ...attempt,
        proctorStatus:
          attempt.lastWarningId && attempt.lastWarningId !== attempt.lastAcknowledgedWarningId
            ? ('warned' as const)
            : ('active' as const),
        proctorUpdatedAt: timestamp,
        proctorUpdatedBy: actor,
        updatedAt: timestamp,
      };

      await studentAttemptRepository.saveAttempt(updatedAttempt);
      await this.repository.saveAuditLog({
        id: generateId('audit'),
        timestamp,
        actor,
        actionType: 'STUDENT_RESUME',
        targetStudentId: attempt.id,
        sessionId: attempt.scheduleId,
        payload: {
          candidateId: attempt.candidateId,
          nextStatus: updatedAttempt.proctorStatus,
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to resume student' };
    }
  }

  async terminateStudentAttempt(attemptId: string, actor: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { studentAttemptRepository } = await import('./studentAttemptRepository');
      const allAttempts = await studentAttemptRepository.getAllAttempts();
      const attempt = allAttempts.find(a => a.id === attemptId);
      if (!attempt) {
        return { success: false, error: 'Attempt not found' };
      }

      const timestamp = new Date().toISOString();
      const updatedAttempt = {
        ...attempt,
        phase: 'post-exam' as const,
        proctorStatus: 'terminated' as const,
        proctorUpdatedAt: timestamp,
        proctorUpdatedBy: actor,
        updatedAt: timestamp,
      };

      await studentAttemptRepository.saveAttempt(updatedAttempt);
      await this.repository.saveAuditLog({
        id: generateId('audit'),
        timestamp,
        actor,
        actionType: 'STUDENT_TERMINATE',
        targetStudentId: attempt.id,
        sessionId: attempt.scheduleId,
        payload: {
          candidateId: attempt.candidateId,
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to terminate student' };
    }
  }

  async pauseRuntime(
    scheduleId: string,
    actor: string,
    reason = 'proctor_pause',
    now: Date | string = new Date()
  ): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) return { success: false, error: 'Schedule not found' };

    const snapshot = await this.getRuntimeSnapshot(scheduleId, now);
    if (!snapshot) return { success: false, error: 'Runtime not found' };
    if (snapshot.status !== 'live' || !snapshot.activeSectionKey) {
      return { success: false, error: 'No live section to pause' };
    }

    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
    const section = snapshot.sections.find(item => item.sectionKey === snapshot.activeSectionKey);
    if (!section) return { success: false, error: 'Active section not found' };
    if (section.status !== 'live') return { success: false, error: 'Active section is not live' };

    section.status = 'paused';
    section.pausedAt = toIso(nowMs);
    snapshot.status = 'paused';
    snapshot.updatedAt = toIso(nowMs);

    await this.repository.saveRuntime(snapshot);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: snapshot.id,
      examId: snapshot.examId,
      actor,
      action: 'pause_runtime',
      timestamp: toIso(nowMs),
      reason
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  async resumeRuntime(
    scheduleId: string,
    actor: string,
    now: Date | string = new Date()
  ): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) return { success: false, error: 'Schedule not found' };

    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return { success: false, error: 'Runtime not found' };
    if (runtime.status !== 'paused' || !runtime.activeSectionKey) {
      return { success: false, error: 'Runtime is not paused' };
    }

    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
    const snapshot = clone(runtime);
    const section = snapshot.sections.find(item => item.sectionKey === snapshot.activeSectionKey);
    if (!section || section.status !== 'paused' || !section.pausedAt) {
      return { success: false, error: 'Active paused section not found' };
    }

    const pausedStartMs = toMs(section.pausedAt);
    if (pausedStartMs !== null) {
      section.accumulatedPausedSeconds += Math.max(0, (nowMs - pausedStartMs) / 1000);
    }
    section.pausedAt = null;
    section.status = 'live';
    snapshot.status = 'live';
    snapshot.updatedAt = toIso(nowMs);

    await this.repository.saveRuntime(snapshot);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: snapshot.id,
      examId: snapshot.examId,
      actor,
      action: 'resume_runtime',
      timestamp: toIso(nowMs)
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  async extendCurrentSection(
    scheduleId: string,
    actor: string,
    minutes: number,
    now: Date | string = new Date()
  ): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) return { success: false, error: 'Schedule not found' };

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return { success: false, error: 'Extension minutes must be positive' };
    }

    if (context.config.delivery.allowedExtensionMinutes.length > 0 &&
        !context.config.delivery.allowedExtensionMinutes.includes(minutes)) {
      return { success: false, error: 'Extension amount is not allowed by delivery policy' };
    }

    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return { success: false, error: 'Runtime not found' };

    const snapshot = await this.getRuntimeSnapshot(scheduleId, now);
    if (!snapshot || (!snapshot.activeSectionKey && snapshot.status !== 'paused')) {
      return { success: false, error: 'No active section to extend' };
    }

    const targetKey = snapshot.activeSectionKey ?? runtime.activeSectionKey;
    if (!targetKey) return { success: false, error: 'No active section to extend' };

    const section = snapshot.sections.find(item => item.sectionKey === targetKey);
    if (!section || (section.status !== 'live' && section.status !== 'paused')) {
      return { success: false, error: 'Active section is not extendable' };
    }

    section.extensionMinutes += minutes;
    snapshot.updatedAt = typeof now === 'string' ? now : now.toISOString();
    await this.repository.saveRuntime(snapshot);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: snapshot.id,
      examId: snapshot.examId,
      actor,
      action: 'extend_section',
      minutes,
      timestamp: typeof now === 'string' ? now : now.toISOString(),
      payload: { sectionKey: section.sectionKey }
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  async endCurrentSectionNow(
    scheduleId: string,
    actor: string,
    now: Date | string = new Date()
  ): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) return { success: false, error: 'Schedule not found' };

    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return { success: false, error: 'Runtime not found' };

    const snapshot = await this.getRuntimeSnapshot(scheduleId, now);
    if (!snapshot || !snapshot.activeSectionKey) {
      return { success: false, error: 'No active section to end' };
    }

    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
    const currentIndex = snapshot.sections.findIndex(item => item.sectionKey === snapshot.activeSectionKey);
    if (currentIndex < 0) return { success: false, error: 'Active section not found' };
    const currentSection = snapshot.sections[currentIndex];
    if (!currentSection) return { success: false, error: 'Active section not found' };

    this.completeSection(currentSection, nowMs, completionReasonMap.proctorEnd);

    const nextSection = snapshot.sections[currentIndex + 1];
    if (nextSection) {
      nextSection.status = 'live';
      nextSection.availableAt = toIso(nowMs);
      nextSection.actualStartAt = toIso(nowMs);
      nextSection.actualEndAt = null;
      nextSection.pausedAt = null;
      snapshot.activeSectionKey = nextSection.sectionKey;
      snapshot.currentSectionKey = nextSection.sectionKey;
      snapshot.status = 'live';
      snapshot.waitingForNextSection = false;
    } else {
      snapshot.activeSectionKey = null;
      snapshot.currentSectionKey = null;
      snapshot.status = 'completed';
      snapshot.actualEndAt = toIso(nowMs);
      snapshot.waitingForNextSection = false;
    }

    snapshot.updatedAt = toIso(nowMs);
    await this.repository.saveRuntime(snapshot);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: snapshot.id,
      examId: snapshot.examId,
      actor,
      action: 'end_section_now',
      timestamp: toIso(nowMs),
      payload: { sectionKey: currentSection.sectionKey }
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  async completeRuntime(
    scheduleId: string,
    actor: string,
    now: Date | string = new Date()
  ): Promise<RuntimeMutationResult> {
    const context = await this.loadContext(scheduleId);
    if (!context) return { success: false, error: 'Schedule not found' };

    const runtime = await this.repository.getRuntimeByScheduleId(scheduleId);
    if (!runtime) return { success: false, error: 'Runtime not found' };

    const snapshot = await this.getRuntimeSnapshot(scheduleId, now);
    if (!snapshot) return { success: false, error: 'Runtime not found' };
    if (snapshot.status === 'completed' || snapshot.status === 'cancelled') {
      return { success: true, runtime: snapshot };
    }

    const nowMs = typeof now === 'string' ? toMs(now) ?? Date.now() : now.getTime();
    const activeIndex = snapshot.sections.findIndex(item => item.status === 'live' || item.status === 'paused');

    if (activeIndex >= 0) {
      const activeSection = snapshot.sections[activeIndex];
      if (activeSection) {
        this.completeSection(activeSection, nowMs, completionReasonMap.proctorComplete);
      }
    }

    for (let index = activeIndex + 1; index < snapshot.sections.length; index += 1) {
      const section = snapshot.sections[index];
      if (section && section.status !== 'completed') {
        section.status = 'completed';
        section.completionReason = completionReasonMap.proctorComplete;
        section.actualStartAt = section.actualStartAt ?? null;
        section.actualEndAt = section.actualEndAt ?? toIso(nowMs);
        section.availableAt = section.availableAt ?? toIso(nowMs);
      }
    }

    snapshot.status = 'completed';
    snapshot.activeSectionKey = null;
    snapshot.currentSectionKey = null;
    snapshot.actualEndAt = toIso(nowMs);
    snapshot.waitingForNextSection = false;
    snapshot.updatedAt = toIso(nowMs);

    await this.repository.saveRuntime(snapshot);
    await this.repository.saveControlEvent({
      id: generateId('evt'),
      scheduleId,
      runtimeId: snapshot.id,
      examId: snapshot.examId,
      actor,
      action: 'complete_runtime',
      timestamp: toIso(nowMs)
    });

    return { success: true, runtime: await this.getRuntimeSnapshot(scheduleId, now) };
  }

  private async loadContext(scheduleId: string): Promise<ScheduleContext | null> {
    const schedules = await this.repository.getAllSchedules();
    const schedule = schedules.find(item => item.id === scheduleId) || null;
    if (!schedule) return null;

    const versionId = findScheduleVersion(schedule, await this.loadFallbackVersion(schedule));
    if (!versionId) return null;

    const version = await this.repository.getVersionById(versionId);
    if (!version) return null;

    const config = normalizeExamConfig(version.configSnapshot);
    return {
      schedule: {
        ...schedule,
        publishedVersionId: versionId,
        deliveryMode: schedule.deliveryMode || 'proctor_start',
        plannedDurationMinutes: schedule.plannedDurationMinutes ?? this.buildSectionPlan(config).plannedDurationMinutes
      },
      version,
      config,
      plan: this.buildSectionPlan(config)
    };
  }

  private async loadFallbackVersion(schedule: ExamSchedule): Promise<ExamVersion | null> {
    if (schedule.publishedVersionId) return null;
    const exam = await this.repository.getExamById(schedule.examId);
    if (!exam) return null;
    if (exam.currentPublishedVersionId) {
      return this.repository.getVersionById(exam.currentPublishedVersionId);
    }
    if (exam.currentDraftVersionId) {
      return this.repository.getVersionById(exam.currentDraftVersionId);
    }
    return null;
  }

  private buildNotStartedSnapshot(context: ScheduleContext, nowMs: number): ExamSessionRuntime {
    const { schedule, plan } = context;
    return {
      id: `runtime-${schedule.id}-pending`,
      scheduleId: schedule.id,
      examId: schedule.examId,
      examTitle: schedule.examTitle,
      cohortName: schedule.cohortName,
      deliveryMode: schedule.deliveryMode,
      status: 'not_started',
      actualStartAt: null,
      actualEndAt: null,
      activeSectionKey: null,
      currentSectionKey: null,
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: plan.sections.map(item => createSectionRuntimeState(item, 'locked', null, null, null, null)),
      createdAt: toIso(nowMs),
      updatedAt: toIso(nowMs)
    };
  }

  private advanceRuntime(
    snapshot: ExamSessionRuntime,
    context: ScheduleContext,
    nowMs: number
  ): { changed: boolean; events: CohortControlEvent[] } {
    let changed = false;
    const events: CohortControlEvent[] = [];

    while (snapshot.status === 'live') {
      const activeIndex = snapshot.sections.findIndex(item => item.status === 'live');
      if (activeIndex >= 0) {
        const activeSection = snapshot.sections[activeIndex];
        if (!activeSection) {
          break;
        }
        const activeStartMs = toMs(activeSection.actualStartAt) ?? nowMs;
        const endMs = this.calculateLiveSectionEnd(activeSection, activeStartMs);

        if (nowMs < endMs) {
          break;
        }

        this.completeSection(activeSection, endMs, completionReasonMap.autoTimeout);
        events.push({
          id: generateId('evt'),
          scheduleId: snapshot.scheduleId,
          runtimeId: snapshot.id,
          examId: snapshot.examId,
          actor: 'system',
          action: 'auto_timeout',
          sectionKey: activeSection.sectionKey,
          timestamp: toIso(endMs),
          payload: {
            sectionKey: activeSection.sectionKey,
            reason: completionReasonMap.autoTimeout
          }
        });
        changed = true;

        const nextSection = snapshot.sections[activeIndex + 1];
        if (!nextSection) {
          snapshot.status = 'completed';
          snapshot.activeSectionKey = null;
          snapshot.currentSectionKey = null;
          snapshot.actualEndAt = toIso(endMs);
          snapshot.waitingForNextSection = false;
          break;
        }

        const gapMs = activeSection.gapAfterMinutes * 60_000;
        nextSection.availableAt = toIso(endMs + gapMs);
        nextSection.projectedStartAt = nextSection.availableAt;
        nextSection.projectedEndAt = toIso(endMs + gapMs + nextSection.plannedDurationMinutes * 60_000);
        snapshot.activeSectionKey = null;
        snapshot.currentSectionKey = null;
        snapshot.waitingForNextSection = gapMs > 0;
        snapshot.status = 'live';
        continue;
      }

      const nextIndex = snapshot.sections.findIndex(item => item.status === 'locked');
      if (nextIndex < 0) {
        snapshot.status = 'completed';
        snapshot.actualEndAt = snapshot.actualEndAt ?? toIso(nowMs);
        snapshot.activeSectionKey = null;
        snapshot.currentSectionKey = null;
        snapshot.waitingForNextSection = false;
        changed = true;
        break;
      }

      const nextSection = snapshot.sections[nextIndex];
      if (!nextSection) {
        break;
      }
      const availableAtMs = toMs(nextSection.availableAt);
      if (availableAtMs === null || availableAtMs > nowMs) {
        snapshot.waitingForNextSection = snapshot.status === 'live';
        break;
      }

      nextSection.status = 'live';
      nextSection.actualStartAt = toIso(availableAtMs);
      nextSection.pausedAt = null;
      nextSection.projectedStartAt = toIso(availableAtMs);
      nextSection.projectedEndAt = toIso(availableAtMs + nextSection.plannedDurationMinutes * 60_000 + nextSection.extensionMinutes * 60_000);
      snapshot.activeSectionKey = nextSection.sectionKey;
      snapshot.currentSectionKey = nextSection.sectionKey;
      snapshot.waitingForNextSection = false;
      snapshot.status = 'live';
      changed = true;
    }

    return { changed, events };
  }

  private decorateRuntimeSnapshot(snapshot: ExamSessionRuntime, context: ScheduleContext, nowMs: number): void {
    const scheduleEndMs = toMs(context.schedule.endTime);
    let cursorMs = toMs(snapshot.actualStartAt);
    let totalPausedSeconds = 0;
    let currentRemainingSeconds = 0;
    let activeSectionKey: ModuleType | null = null;
    let currentSectionKey: ModuleType | null = null;

    snapshot.sections.forEach(section => {
      if (section.status === 'completed') {
        const startMs = toMs(section.actualStartAt) ?? cursorMs ?? nowMs;
        const endMs = toMs(section.actualEndAt) ?? this.calculateLiveSectionEnd(section, startMs);
        section.projectedStartAt = toIso(startMs);
        section.projectedEndAt = toIso(endMs);
        section.availableAt = section.actualStartAt ?? section.availableAt ?? toIso(startMs);
        cursorMs = endMs + section.gapAfterMinutes * 60_000;
        totalPausedSeconds += section.accumulatedPausedSeconds;
        return;
      }

      if (section.status === 'live') {
        const startMs = toMs(section.actualStartAt) ?? cursorMs ?? nowMs;
        const endMs = this.calculateLiveSectionEnd(section, startMs);
        section.projectedStartAt = toIso(startMs);
        section.projectedEndAt = toIso(endMs);
        section.availableAt = section.actualStartAt ?? section.availableAt ?? toIso(startMs);
        currentRemainingSeconds = Math.max(0, Math.ceil((endMs - nowMs) / 1000));
        activeSectionKey = section.sectionKey;
        currentSectionKey = section.sectionKey;
        cursorMs = endMs + section.gapAfterMinutes * 60_000;
        totalPausedSeconds += section.accumulatedPausedSeconds;
        return;
      }

      if (section.status === 'paused') {
        const startMs = toMs(section.actualStartAt) ?? cursorMs ?? nowMs;
        const pausedAtMs = toMs(section.pausedAt) ?? nowMs;
        const elapsedBeforePause = Math.max(0, pausedAtMs - startMs - section.accumulatedPausedSeconds * 1000);
        const totalDurationMs = (section.plannedDurationMinutes + section.extensionMinutes) * 60_000;
        const remainingMs = Math.max(0, totalDurationMs - elapsedBeforePause);
        section.projectedStartAt = toIso(startMs);
        section.projectedEndAt = toIso(nowMs + remainingMs);
        section.availableAt = section.actualStartAt ?? section.availableAt ?? toIso(startMs);
        currentRemainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
        activeSectionKey = section.sectionKey;
        currentSectionKey = section.sectionKey;
        cursorMs = pausedAtMs + remainingMs + section.gapAfterMinutes * 60_000;
        totalPausedSeconds += section.accumulatedPausedSeconds + Math.max(0, (nowMs - pausedAtMs) / 1000);
        return;
      }

      const availableAtMs = toMs(section.availableAt);
      const startMs = cursorMs ?? availableAtMs ?? nowMs;
      const endMs = startMs + (section.plannedDurationMinutes + section.extensionMinutes) * 60_000;
      section.projectedStartAt = toIso(startMs);
      section.projectedEndAt = toIso(endMs);
      section.availableAt = section.availableAt ?? toIso(startMs);
      cursorMs = endMs + section.gapAfterMinutes * 60_000;
    });

    snapshot.activeSectionKey = activeSectionKey;
    snapshot.currentSectionKey = currentSectionKey;
    snapshot.currentSectionRemainingSeconds = currentRemainingSeconds;
    snapshot.totalPausedSeconds = totalPausedSeconds;
    snapshot.waitingForNextSection = snapshot.status === 'live' && !activeSectionKey && snapshot.sections.some(section => section.status === 'locked');
    const hasProjectedOverrun = scheduleEndMs !== null && snapshot.sections.some(section => {
      const projectedEndMs = toMs(section.projectedEndAt);
      return projectedEndMs !== null && projectedEndMs > scheduleEndMs && section.status !== 'completed';
    });
    snapshot.isOverrun = snapshot.status !== 'completed' && scheduleEndMs !== null && (
      hasProjectedOverrun ||
      nowMs > scheduleEndMs
    );
  }

  private calculateLiveSectionEnd(section: SectionRuntimeState, startMs: number): number {
    const pausedMs = section.accumulatedPausedSeconds * 1000;
    const extensionMs = section.extensionMinutes * 60_000;
    return startMs + section.plannedDurationMinutes * 60_000 + extensionMs + pausedMs;
  }

  private completeSection(
    section: SectionRuntimeState,
    completionMs: number,
    reason: SectionRuntimeState['completionReason']
  ): void {
    if (section.status === 'paused' && section.pausedAt) {
      const pausedAtMs = toMs(section.pausedAt);
      if (pausedAtMs !== null) {
        section.accumulatedPausedSeconds += Math.max(0, (completionMs - pausedAtMs) / 1000);
      }
    }

    section.status = 'completed';
    section.actualEndAt = toIso(completionMs);
    section.pausedAt = null;
    section.completionReason = reason;
    section.projectedEndAt = section.actualEndAt;
  }
}

export const examDeliveryService = new ExamDeliveryService();
