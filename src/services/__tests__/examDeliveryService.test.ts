import { describe, expect, it } from 'vitest';
import { ExamDeliveryService } from '../examDeliveryService';
import { createDefaultConfig } from '../../constants/examDefaults';

describe('ExamDeliveryService', () => {
  const service = new ExamDeliveryService();

  const createRuntimeConfig = () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.listening.duration = 30;
    config.sections.listening.gapAfterMinutes = 5;
    config.sections.reading.duration = 60;
    config.sections.reading.gapAfterMinutes = 0;
    config.sections.writing.duration = 60;
    config.sections.writing.gapAfterMinutes = 10;
    config.sections.speaking.duration = 15;
    config.sections.speaking.gapAfterMinutes = 0;
    config.delivery.allowedExtensionMinutes = [5, 10, 15];
    return config;
  };

  it('builds section plans with gaps and planned duration', () => {
    const plan = service.buildSectionPlan(createRuntimeConfig());

    expect(plan.sections.map((section) => section.sectionKey)).toEqual([
      'listening',
      'reading',
      'writing',
      'speaking',
    ]);
    expect(plan.sections[0].startOffsetMinutes).toBe(0);
    expect(plan.sections[0].endOffsetMinutes).toBe(30);
  });

  it('validates schedule windows against planned duration and section rules', () => {
    const config = createRuntimeConfig();
    const plan = service.buildSectionPlan(config);
    const startTime = '2026-01-01T00:00:00.000Z';
    const endTime = new Date(
      new Date(startTime).getTime() + (plan.plannedDurationMinutes + 1) * 60_000,
    ).toISOString();

    const result = service.validateScheduleWindow(config, startTime, endTime);

    expect(result.isValid).toBe(true);
    expect(result.plannedDurationMinutes).toBe(plan.plannedDurationMinutes);
  });

  it('derives an internal proctor-start schedule window from the section plan', () => {
    const config = createRuntimeConfig();
    const plan = service.buildSectionPlan(config);

    const window = service.deriveProctorStartScheduleWindow(config, '2026-01-01T00:00:00.000Z');

    expect(window).toEqual({
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: new Date(Date.parse('2026-01-01T00:00:00.000Z') + plan.plannedDurationMinutes * 60_000).toISOString(),
      plannedDurationMinutes: plan.plannedDurationMinutes,
    });
  });

  it('resolves schedule windows by preserving existing schedule snapshots', () => {
    const config = createRuntimeConfig();
    const existing = {
      startTime: '2026-01-02T00:00:00.000Z',
      endTime: '2026-01-02T01:00:00.000Z',
      plannedDurationMinutes: 60,
    };

    const resolved = service.resolveProctorStartScheduleWindow({
      config,
      now: '2026-01-01T00:00:00.000Z',
      existingSchedule: existing,
    });

    expect(resolved).toEqual(existing);
  });

  it('checks schedule-window readiness using schedule status + runtime status + window-open', () => {
    const schedule = {
      status: 'scheduled',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
    } as const;

    expect(service.isScheduleWindowOpen(schedule, '2026-01-01T00:30:00.000Z')).toBe(true);
    expect(service.isScheduleWindowOpen(schedule, '2026-01-01T01:00:00.000Z')).toBe(false);

    expect(
      service.isScheduleReadyToStart(schedule, { status: 'not_started' }, '2026-01-01T00:30:00.000Z'),
    ).toBe(true);
    expect(service.isScheduleReadyToStart(schedule, { status: 'live' }, '2026-01-01T00:30:00.000Z')).toBe(false);
    expect(service.isScheduleReadyToStart({ ...schedule, status: 'completed' }, null, '2026-01-01T00:30:00.000Z')).toBe(false);
  });
});
