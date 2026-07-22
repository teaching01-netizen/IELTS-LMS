import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamLifecycleService } from '../examLifecycleService';
import { examRepository, type IExamRepository } from '../examRepository';
import { createDefaultConfig } from '../../constants/examDefaults';
import type {
  Exam,
  ExamState,
  SessionAuditLog,
  SessionNote,
  ViolationRule,
} from '../../types';
import type {
  CohortControlEvent,
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamSessionRuntime,
  ExamVersion,
  ExamVersionBuilderContent,
  ExamVersionMetadata,
  ExamVersionSummary,
} from '../../types/domain';

const originalFetch = global.fetch;

function buildState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: {
      passages: [
        {
          id: 'p1',
          title: 'Passage 1',
          content: 'Hello world',
          wordCount: 2,
          images: [],
          blocks: [
            {
              id: 'b1',
              type: 'TFNG',
              mode: 'TFNG',
              instruction: 'Read',
              questions: [{ id: 'q1', statement: 'S', correctAnswer: 'T' }],
            },
          ],
        },
      ],
    },
    listening: {
      parts: [
        {
          id: 'l1',
          title: 'Part 1',
          audioUrl: '',
          pins: [],
          blocks: [
            {
              id: 'b2',
              type: 'CLOZE',
              instruction: 'Fill',
              answerRule: 'TWO_WORDS',
              questions: [{ id: 'q2', prompt: 'A ____', correctAnswer: 'test' }],
            },
          ],
        },
      ],
    },
    writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2' },
    speaking: { part1Topics: ['t'], cueCard: 'c', part3Discussion: ['d'] },
  };
}

function buildUndersizedSharedPoolState(): ExamState {
  const state = buildState();
  const passage = state.reading.passages[0];
  if (!passage) {
    throw new Error('Expected the publish-readiness fixture to contain a passage');
  }

  passage.blocks.push({
    id: 'shared-sentence-block',
    type: 'SENTENCE_COMPLETION',
    instruction: 'Complete the sentence',
    questions: [
      {
        id: 'shared-sentence-question',
        sentence: 'The ____ is ____.',
        blanks: [
          { id: 'shared-blank-1', correctAnswer: '', acceptedAnswers: [], position: 0 },
          { id: 'shared-blank-2', correctAnswer: '', acceptedAnswers: [], position: 1 },
        ],
        answerRule: 'ONE_WORD',
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['alpha', 'ALPHA'],
      },
    ],
  });

  return state;
}

class LocalReadinessRepository implements IExamRepository {
  constructor(
    private exam: ExamEntity,
    private version: ExamVersion,
  ) {}

  async getAllExamsWithLegacyMigration(): Promise<ExamEntity[]> { return [this.exam]; }
  async getAllExams(): Promise<ExamEntity[]> { return [this.exam]; }
  async getExamById(id: string): Promise<ExamEntity | null> {
    return id === this.exam.id ? this.exam : null;
  }
  async saveExam(exam: ExamEntity): Promise<void> { this.exam = exam; }
  async deleteExam(_id: string): Promise<void> {}
  async getAllVersions(_examId: string): Promise<ExamVersion[]> { return [this.version]; }
  async getVersionSummaries(_examId: string): Promise<ExamVersionSummary[]> { return []; }
  async getVersionById(id: string): Promise<ExamVersion | null> {
    return id === this.version.id ? this.version : null;
  }
  async getVersionMetadata(_id: string): Promise<ExamVersionMetadata | null> { return null; }
  async getVersionBuilderContent(_id: string): Promise<ExamVersionBuilderContent | null> { return null; }
  async saveVersion(version: ExamVersion): Promise<void> { this.version = version; }
  async getEvents(_examId: string, _limit?: number): Promise<ExamEvent[]> { return []; }
  async saveEvent(_event: ExamEvent): Promise<void> {}
  async getAllSchedules(): Promise<ExamSchedule[]> { return []; }
  async getSchedulesByExam(_examId: string): Promise<ExamSchedule[]> { return []; }
  async saveSchedule(_schedule: ExamSchedule): Promise<void> {}
  async deleteSchedule(_id: string): Promise<void> {}
  async getRuntimeByScheduleId(_scheduleId: string): Promise<ExamSessionRuntime | null> { return null; }
  async saveRuntime(_runtime: ExamSessionRuntime): Promise<void> {}
  async deleteRuntime(_scheduleId: string): Promise<void> {}
  async getControlEventsByScheduleId(_scheduleId: string): Promise<CohortControlEvent[]> { return []; }
  async saveControlEvent(_event: CohortControlEvent): Promise<void> {}
  async getAuditLogsByScheduleId(_scheduleId: string): Promise<SessionAuditLog[]> { return []; }
  async getAllAuditLogs(): Promise<SessionAuditLog[]> { return []; }
  async saveAuditLog(_log: SessionAuditLog): Promise<void> {}
  async getSessionNotesByScheduleId(_scheduleId: string): Promise<SessionNote[]> { return []; }
  async getAllSessionNotes(): Promise<SessionNote[]> { return []; }
  async saveSessionNote(_note: SessionNote): Promise<void> {}
  async deleteSessionNote(_noteId: string): Promise<void> {}
  async getViolationRulesByScheduleId(_scheduleId: string): Promise<ViolationRule[]> { return []; }
  async saveViolationRule(_rule: ViolationRule): Promise<void> {}
  async deleteViolationRule(_ruleId: string): Promise<void> {}
  async migrateFromLegacy(_legacyExams: Exam[]): Promise<ExamEntity[]> { return []; }
}

describe('ExamLifecycleService publish readiness', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('computes question counts in backend mode instead of returning zeros', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();
    const fetchMock = vi
      .fn()
      // backend validation summary (shallow)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { canPublish: true, errors: [], warnings: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // exam entity
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'exam-1',
              slug: 'exam',
              title: 'Exam',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              currentDraftVersionId: 'ver-1',
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // version
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'ver-1',
              examId: 'exam-1',
              versionNumber: 1,
              parentVersionId: null,
              contentSnapshot: state,
              configSnapshot: state.config,
              createdBy: 'owner-1',
              createdAt: '2026-01-01T00:00:01.000Z',
              isDraft: true,
              isPublished: false,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // schedules list
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);
    const readiness = await service.getPublishReadiness('exam-1');

    expect(readiness.questionCounts.total).toBeGreaterThan(0);
    expect(readiness.questionCounts.reading).toBeGreaterThan(0);
    expect(readiness.questionCounts.listening).toBeGreaterThan(0);
  });

  it('routes undersized shared sentence pool validation to warnings in local readiness', async () => {
    const state = buildUndersizedSharedPoolState();
    const exam: ExamEntity = {
      id: 'local-exam-1',
      slug: 'local-exam-1',
      title: 'Local Exam',
      type: 'Academic',
      status: 'draft',
      visibility: 'organization',
      owner: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: 'local-version-1',
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: 4,
    };
    const version: ExamVersion = {
      id: 'local-version-1',
      examId: exam.id,
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: state,
      configSnapshot: state.config,
      createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      isDraft: true,
      isPublished: false,
    };

    const service = new ExamLifecycleService(new LocalReadinessRepository(exam, version));
    const readiness = await service.getPublishReadiness(exam.id);
    const sharedPoolErrors = readiness.errors.filter(
      (entry) => entry.field === 'questions[0].sharedAcceptedAnswers',
    );
    const sharedPoolWarnings = readiness.warnings.filter(
      (entry) => entry.field === 'questions[0].sharedAcceptedAnswers',
    );

    expect(readiness.canPublish).toBe(true);
    expect(sharedPoolErrors).toHaveLength(0);
    expect(sharedPoolWarnings).toHaveLength(1);
  });
});
