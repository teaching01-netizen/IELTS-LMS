import type { ExamSchedule, ExamSessionRuntime } from '../types/domain';
import type { ExamConfig, ModuleType, ValidationError } from '../types';
import { normalizeExamConfig } from '../constants/examDefaults';
import {
  backendGet,
  backendPost,
  getAttemptSchedule,
  mapBackendRuntime,
  mapBackendSchedule,
} from './backendBridge';

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

export interface DerivedScheduleWindow {
  startTime: string;
  endTime: string;
  plannedDurationMinutes: number;
}

export interface ScheduleWindowSnapshot {
  startTime: string;
  endTime: string;
  plannedDurationMinutes: number;
}

export interface RuntimeMutationResult {
  success: boolean;
  runtime?: ExamSessionRuntime | null;
  error?: string;
}

const MODULE_ORDER: ModuleType[] = ['listening', 'reading', 'writing', 'speaking', 'science'];

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sortSections(config: ExamConfig) {
  return MODULE_ORDER
    .filter((sectionKey) => config.sections[sectionKey].enabled)
    .map((sectionKey) => ({
      sectionKey,
      config: config.sections[sectionKey],
    }))
    .sort((a, b) => {
      if (a.config.order !== b.config.order) {
        return a.config.order - b.config.order;
      }
      return MODULE_ORDER.indexOf(a.sectionKey) - MODULE_ORDER.indexOf(b.sectionKey);
    });
}

async function resolveAttemptScheduleId(attemptId: string): Promise<string | null> {
  const rememberedSchedule = getAttemptSchedule(attemptId);
  if (rememberedSchedule) {
    return rememberedSchedule;
  }

  const { studentAttemptRepository } = await import('./studentAttemptRepository');
  const attempt = (await studentAttemptRepository.getAllAttempts()).find(
    (candidate) => candidate.id === attemptId,
  );

  return attempt?.scheduleId ?? null;
}

export class ExamDeliveryService {
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
        endOffsetMinutes,
      };
    });

    return {
      sections,
      plannedDurationMinutes: runningOffset,
    };
  }

  deriveProctorStartScheduleWindow(
    config: ExamConfig,
    now: Date | string = new Date(),
  ): DerivedScheduleWindow {
    const plan = this.buildSectionPlan(config);
    const start = typeof now === 'string' ? new Date(now) : new Date(now.getTime());
    const end = new Date(start.getTime() + plan.plannedDurationMinutes * 60_000);

    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      plannedDurationMinutes: plan.plannedDurationMinutes,
    };
  }

  resolveProctorStartScheduleWindow(options: {
    config: ExamConfig;
    now?: Date | string;
    existingSchedule?: ScheduleWindowSnapshot | null | undefined;
  }): DerivedScheduleWindow {
    if (options.existingSchedule) {
      return {
        startTime: options.existingSchedule.startTime,
        endTime: options.existingSchedule.endTime,
        plannedDurationMinutes: options.existingSchedule.plannedDurationMinutes,
      };
    }

    return this.deriveProctorStartScheduleWindow(options.config, options.now ?? new Date());
  }

  isScheduleWindowOpen(
    schedule: Pick<ExamSchedule, 'startTime' | 'endTime'>,
    now: Date | string = new Date(),
  ): boolean {
    const nowMs = typeof now === 'string' ? toMs(now) : now.getTime();
    const startMs = toMs(schedule.startTime);
    const endMs = toMs(schedule.endTime);

    if (nowMs == null || startMs == null || endMs == null) {
      return false;
    }

    return nowMs >= startMs && nowMs < endMs;
  }

  isScheduleReadyToStart(
    schedule: Pick<ExamSchedule, 'status' | 'startTime' | 'endTime'>,
    runtime?: Pick<ExamSessionRuntime, 'status'> | null,
    now: Date | string = new Date(),
  ): boolean {
    if (schedule.status !== 'scheduled') {
      return false;
    }

    if (runtime && runtime.status !== 'not_started') {
      return false;
    }

    return this.isScheduleWindowOpen(schedule, now);
  }

  formatExamGroupScheduledStartTime(iso: string): string {
    const parsed = new Date(iso);
    if (!Number.isFinite(parsed.getTime())) {
      return 'Invalid time';
    }

    return parsed.toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    });
  }

  validateScheduleWindow(
    config: ExamConfig,
    startTime: string,
    endTime: string,
  ): ScheduleWindowValidationResult {
    const normalized = normalizeExamConfig(config);
    const plan = this.buildSectionPlan(normalized);
    const errors: ValidationError[] = [];

    const enabledSections = sortSections(normalized);
    if (enabledSections.length === 0) {
      errors.push({
        field: 'sections',
        message: 'At least one enabled section is required',
        type: 'error',
      });
    }

    const orders = new Map<number, number>();
    enabledSections.forEach(({ sectionKey, config: section }) => {
      if (section.duration <= 0) {
        errors.push({
          field: `sections.${sectionKey}.duration`,
          message: 'Section duration must be greater than 0',
          type: 'error',
        });
      }

      if (section.gapAfterMinutes < 0) {
        errors.push({
          field: `sections.${sectionKey}.gapAfterMinutes`,
          message: 'Gap after section cannot be negative',
          type: 'error',
        });
      }

      orders.set(section.order, (orders.get(section.order) ?? 0) + 1);
    });

    orders.forEach((count, order) => {
      if (count > 1) {
        errors.push({
          field: 'sections.order',
          message: `Duplicate section order ${order} detected`,
          type: 'error',
        });
      }
    });

    const startMs = toMs(startTime);
    const endMs = toMs(endTime);
    if (startMs === null || endMs === null || endMs <= startMs) {
      errors.push({
        field: 'window',
        message: 'Scheduled end time must be after start time',
        type: 'error',
      });
    }

    const windowMinutes = startMs !== null && endMs !== null ? (endMs - startMs) / 60_000 : 0;
    if (windowMinutes < plan.plannedDurationMinutes) {
      errors.push({
        field: 'window',
        message: `Scheduled window must be at least ${plan.plannedDurationMinutes} minutes`,
        type: 'error',
      });
    }

    return {
      isValid: errors.filter((error) => error.type === 'error').length === 0,
      plannedDurationMinutes: plan.plannedDurationMinutes,
      windowMinutes,
      errors,
    };
  }

  async startRuntime(
    scheduleId: string,
    _actor: string,
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/schedules/${scheduleId}/runtime/commands`,
        {
          action: 'start_runtime',
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start runtime',
      };
    }
  }

  async getRuntimeSnapshot(
    scheduleId: string,
    _now: Date | string = new Date(),
  ): Promise<ExamSessionRuntime | null> {
    try {
      const [schedulePayload, runtimePayload] = await Promise.all([
        backendGet<any>(`/v1/schedules/${scheduleId}`),
        backendGet<any>(`/v1/schedules/${scheduleId}/runtime`),
      ]);

      return mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload));
    } catch {
      return null;
    }
  }

  async warnStudent(
    attemptId: string,
    message: string,
    actor: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scheduleId = await resolveAttemptScheduleId(attemptId);
      if (!scheduleId) {
        return { success: false, error: 'Attempt not found' };
      }

      await backendPost(`/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/warn`, {
        actorId: actor,
        message,
      }, { retries: 0 });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to warn student',
      };
    }
  }

  async pauseStudentAttempt(
    attemptId: string,
    actor: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scheduleId = await resolveAttemptScheduleId(attemptId);
      if (!scheduleId) {
        return { success: false, error: 'Attempt not found' };
      }

      await backendPost(`/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/pause`, {
        actorId: actor,
      }, { retries: 0 });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause student',
      };
    }
  }

  async resumeStudentAttempt(
    attemptId: string,
    actor: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scheduleId = await resolveAttemptScheduleId(attemptId);
      if (!scheduleId) {
        return { success: false, error: 'Attempt not found' };
      }

      await backendPost(`/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/resume`, {
        actorId: actor,
      }, { retries: 0 });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume student',
      };
    }
  }

  async terminateStudentAttempt(
    attemptId: string,
    actor: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scheduleId = await resolveAttemptScheduleId(attemptId);
      if (!scheduleId) {
        return { success: false, error: 'Attempt not found' };
      }

      await backendPost(`/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/terminate`, {
        actorId: actor,
      }, { retries: 0 });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to terminate student',
      };
    }
  }

  async pauseRuntime(
    scheduleId: string,
    _actor: string,
    reason = 'proctor_pause',
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/schedules/${scheduleId}/runtime/commands`,
        {
          action: 'pause_runtime',
          reason,
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause runtime',
      };
    }
  }

  async resumeRuntime(
    scheduleId: string,
    _actor: string,
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/schedules/${scheduleId}/runtime/commands`,
        {
          action: 'resume_runtime',
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume runtime',
      };
    }
  }

  async extendCurrentSection(
    scheduleId: string,
    actor: string,
    minutes: number,
    expectedActiveSectionKey?: string | null,
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/proctor/sessions/${scheduleId}/control/extend-section`,
        {
          actorId: actor,
          minutes,
          expectedActiveSectionKey: expectedActiveSectionKey ?? undefined,
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extend section',
      };
    }
  }

  async endCurrentSectionNow(
    scheduleId: string,
    actor: string,
    expectedActiveSectionKey?: string | null,
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/proctor/sessions/${scheduleId}/control/end-section-now`,
        {
          actorId: actor,
          expectedActiveSectionKey: expectedActiveSectionKey ?? undefined,
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to end section',
      };
    }
  }

  async completeRuntime(
    scheduleId: string,
    actor: string,
    _now: Date | string = new Date(),
  ): Promise<RuntimeMutationResult> {
    try {
      const schedulePayload = await backendGet<any>(`/v1/schedules/${scheduleId}`);
      const runtimePayload = await backendPost<any>(
        `/v1/proctor/sessions/${scheduleId}/control/complete-exam`,
        {
          actorId: actor,
        },
        { retries: 0 },
      );

      return {
        success: true,
        runtime: mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete runtime',
      };
    }
  }
}

export const examDeliveryService = new ExamDeliveryService();
