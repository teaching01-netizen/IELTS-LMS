import { beforeEach, describe, expect, it } from 'vitest';
import { ExamDeliveryService } from '../examDeliveryService';
import { LocalStorageExamRepository } from '../examRepository';
import { ExamConfig, ExamState } from '../../types';
import { createDefaultConfig } from '../../constants/examDefaults';
import { ExamEntity, ExamSchedule, ExamVersion, SCHEMA_VERSION } from '../../types/domain';

describe('ExamDeliveryService', () => {
  let repository: LocalStorageExamRepository;
  let service: ExamDeliveryService;

  beforeEach(() => {
    localStorage.clear();
    repository = new LocalStorageExamRepository();
    service = new ExamDeliveryService(repository);
  });

  const now = new Date('2026-01-01T00:00:00.000Z');

  const createContent = (config: ExamConfig): ExamState => ({
    title: 'Mock IELTS Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1',
      task2Prompt: 'Task 2'
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: []
    }
  });

  const seedSchedule = async (config: ExamConfig, overrides: Partial<ExamSchedule> = {}) => {
    const plan = service.buildSectionPlan(config);
    const examId = 'exam-1';
    const versionId = 'ver-1';
    const exam: ExamEntity = {
      id: examId,
      slug: 'mock-ielts-exam',
      title: 'Mock IELTS Exam',
      type: 'Academic',
      status: 'published',
      visibility: 'organization',
      owner: 'Author',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      currentDraftVersionId: null,
      currentPublishedVersionId: versionId,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: SCHEMA_VERSION
    };
    const version: ExamVersion = {
      id: versionId,
      examId,
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: createContent(config),
      configSnapshot: config,
      createdBy: 'Author',
      createdAt: now.toISOString(),
      isDraft: false,
      isPublished: true
    };
    const schedule: ExamSchedule = {
      id: 'sched-1',
      examId,
      examTitle: 'Mock IELTS Exam',
      publishedVersionId: versionId,
      cohortName: 'Cohort A',
      institution: 'Test Center',
      startTime: now.toISOString(),
      endTime: new Date(now.getTime() + Math.max(plan.plannedDurationMinutes, 1) * 60_000 + 60_000).toISOString(),
      plannedDurationMinutes: plan.plannedDurationMinutes,
      deliveryMode: 'proctor_start',
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: now.toISOString(),
      createdBy: 'Admin',
      updatedAt: now.toISOString(),
      ...overrides
    };

    await repository.saveExam(exam);
    await repository.saveVersion(version);
    await repository.saveSchedule(schedule);

    return { exam, version, schedule, plan };
  };

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

    expect(plan.sections.map(section => section.sectionKey)).toEqual(['listening', 'reading', 'writing', 'speaking']);
    expect(plan.sections[0].startOffsetMinutes).toBe(0);
    expect(plan.sections[0].endOffsetMinutes).toBe(30);
    expect(plan.sections[1].startOffsetMinutes).toBe(35);
    expect(plan.sections[2].startOffsetMinutes).toBe(95);
    expect(plan.plannedDurationMinutes).toBe(180);
  });

  it('validates schedule windows against planned duration and section rules', () => {
    const config = createRuntimeConfig();
    const validation = service.validateScheduleWindow(
      config,
      now.toISOString(),
      new Date(now.getTime() + 179 * 60_000).toISOString()
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(error => error.field === 'window')).toBe(true);
    expect(validation.plannedDurationMinutes).toBe(180);
  });

  it('starts runtime with the first section live and persists the control event', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig());

    const result = await service.startRuntime(schedule.id, 'Proctor', now);

    expect(result.success).toBe(true);
    expect(result.runtime?.status).toBe('live');
    expect(result.runtime?.activeSectionKey).toBe('listening');
    expect(result.runtime?.sections[0].status).toBe('live');
    expect(result.runtime?.sections.slice(1).every(section => section.status === 'locked')).toBe(true);

    const events = await repository.getControlEventsByScheduleId(schedule.id);
    expect(events.map(event => event.action)).toEqual(['start_runtime']);
  });

  it('only starts a scheduled session once the schedule is ready', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig(), {
      startTime: new Date(now.getTime() + 10 * 60_000).toISOString(),
      endTime: new Date(now.getTime() + 200 * 60_000).toISOString()
    });

    const earlyStart = await service.startRuntime(schedule.id, 'Proctor', now);
    expect(earlyStart.success).toBe(false);
    expect(earlyStart.error).toContain('not ready');

    const tooLate = await service.startRuntime(
      schedule.id,
      'Proctor',
      new Date(now.getTime() + 205 * 60_000)
    );
    expect(tooLate.success).toBe(false);
    expect(tooLate.error).toContain('ended');

    const onTime = await service.startRuntime(
      schedule.id,
      'Proctor',
      new Date(now.getTime() + 10 * 60_000)
    );
    expect(onTime.success).toBe(true);
    expect(onTime.runtime?.status).toBe('live');
  });

  it('pauses and resumes a live runtime without losing elapsed time', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig());
    await service.startRuntime(schedule.id, 'Proctor', now);

    const pauseAt = new Date(now.getTime() + 10 * 60_000);
    const pauseResult = await service.pauseRuntime(schedule.id, 'Proctor', 'manual_pause', pauseAt);
    expect(pauseResult.success).toBe(true);
    expect(pauseResult.runtime?.status).toBe('paused');
    expect(pauseResult.runtime?.sections[0].status).toBe('paused');

    const resumeAt = new Date(now.getTime() + 25 * 60_000);
    const resumeResult = await service.resumeRuntime(schedule.id, 'Proctor', resumeAt);
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.runtime?.status).toBe('live');
    expect(resumeResult.runtime?.sections[0].status).toBe('live');
    expect(resumeResult.runtime?.currentSectionRemainingSeconds).toBe(20 * 60);

    const events = await repository.getControlEventsByScheduleId(schedule.id);
    expect(events.map(event => event.action)).toEqual(['start_runtime', 'pause_runtime', 'resume_runtime']);
  });

  it('extends the active section and shifts downstream projections', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig());
    await service.startRuntime(schedule.id, 'Proctor', now);

    const before = await service.getRuntimeSnapshot(schedule.id, now);
    const beforeReadingStart = before?.sections[1].projectedStartAt;

    const result = await service.extendCurrentSection(schedule.id, 'Proctor', 10, now);
    expect(result.success).toBe(true);

    const after = result.runtime;
    expect(after?.sections[0].extensionMinutes).toBe(10);
    expect(after?.sections[1].projectedStartAt).not.toBe(beforeReadingStart);
    expect(after?.sections[1].projectedStartAt).toBe(new Date(now.getTime() + 45 * 60_000).toISOString());
  });

  it('ends the current section early and opens the next section immediately', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig());
    await service.startRuntime(schedule.id, 'Proctor', now);

    const endAt = new Date(now.getTime() + 10 * 60_000);
    const result = await service.endCurrentSectionNow(schedule.id, 'Proctor', endAt);

    expect(result.success).toBe(true);
    expect(result.runtime?.sections[0].status).toBe('completed');
    expect(result.runtime?.sections[0].completionReason).toBe('proctor_end');
    expect(result.runtime?.sections[1].status).toBe('live');
    expect(result.runtime?.sections[1].actualStartAt).toBe(endAt.toISOString());
  });

  it('auto-transitions on timeout and honors section gaps', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig());
    await service.startRuntime(schedule.id, 'Proctor', now);

    const firstCheck = new Date(now.getTime() + 31 * 60_000);
    const snapshot = await service.getRuntimeSnapshot(schedule.id, firstCheck);

    expect(snapshot?.sections[0].status).toBe('completed');
    expect(snapshot?.sections[0].completionReason).toBe('auto_timeout');
    expect(snapshot?.waitingForNextSection).toBe(true);
    expect(snapshot?.activeSectionKey).toBeNull();
    expect(snapshot?.sections[1].status).toBe('locked');

    const secondCheck = new Date(now.getTime() + 36 * 60_000);
    const afterGap = await service.getRuntimeSnapshot(schedule.id, secondCheck);

    expect(afterGap?.sections[1].status).toBe('live');
    expect(afterGap?.sections[1].actualStartAt).toBe(new Date(now.getTime() + 35 * 60_000).toISOString());
  });

  it('completes a runtime after the final section ends', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.listening.enabled = false;
    config.sections.reading.enabled = true;
    config.sections.reading.duration = 5;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;
    config.delivery.allowedExtensionMinutes = [5];

    const { schedule } = await seedSchedule(config, {
      endTime: new Date(now.getTime() + 10 * 60_000).toISOString()
    });

    await service.startRuntime(schedule.id, 'Proctor', now);
    const completed = await service.getRuntimeSnapshot(schedule.id, new Date(now.getTime() + 6 * 60_000));

    expect(completed?.status).toBe('completed');
    expect(completed?.actualEndAt).toBe(new Date(now.getTime() + 5 * 60_000).toISOString());
  });

  it('flags an overrun when an extension pushes beyond the scheduled window', async () => {
    const { schedule } = await seedSchedule(createRuntimeConfig(), {
      endTime: new Date(now.getTime() + 185 * 60_000).toISOString()
    });

    await service.startRuntime(schedule.id, 'Proctor', now);
    const extended = await service.extendCurrentSection(schedule.id, 'Proctor', 15, now);

    expect(extended.success).toBe(true);
    expect(extended.runtime?.isOverrun).toBe(true);
  });
});
