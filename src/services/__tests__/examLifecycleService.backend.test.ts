import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import { ExamLifecycleService } from '../examLifecycleService';
import { examRepository } from '../examRepository';
import type { ExamState } from '../../types';

const originalFetch = global.fetch;

function buildState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Backend-backed Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    activeScienceStimulusId: '',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    science: { stimuli: [] },
  };
}

describe('ExamLifecycleService backend mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('uses the revision of the loaded config snapshot instead of a newer editor revision', async () => {
    const state = buildState();
    const examId = 'config-conflict-exam';
    const exam = {
      id: examId, slug: examId, title: state.title, examType: 'Academic', status: 'draft',
      visibility: 'organization', ownerId: 'owner-1', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', currentDraftVersionId: 'draft-1',
      currentPublishedVersionId: null, schemaVersion: 3, revision: 2,
    };
    const version = {
      id: 'draft-1', examId, versionNumber: 1, parentVersionId: null,
      contentSnapshot: state, configSnapshot: state.config, createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z', isDraft: true, isPublished: false, revision: 2,
    };
    let sentRevision: number | undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/v1/exams/${examId}/draft` && init?.method === 'PATCH') {
        sentRevision = JSON.parse(String(init.body)).revision;
        const status = sentRevision === 2 ? 200 : 409;
        return new Response(JSON.stringify(status === 200
          ? { success: true, data: version }
          : { success: false, error: { code: 'CONFLICT', message: 'Draft changed while you were editing' } }),
        { status, headers: { 'content-type': 'application/json' } });
      }
      const data = url === '/api/v1/versions/draft-1' ? version : exam;
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await new ExamLifecycleService(examRepository).saveDraft(examId, state, 'owner-1', {
      versionId: 'draft-1', revision: 1, isDraft: true,
    });

    expect(sentRevision).toBe(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/changed|conflict/i);
  });

  it.each([
    { reopenedRevision: 0, expectedSuccess: true },
    { reopenedRevision: 1, expectedSuccess: false },
  ])('saves a published fallback only when its reopened draft has not changed (revision $reopenedRevision)', async ({ reopenedRevision, expectedSuccess }) => {
    const state = buildState();
    state.config.general.title = state.title;
    const examId = 'config-fallback-exam';
    const exam = {
      id: examId, slug: examId, title: state.title, examType: 'Academic', status: 'published',
      visibility: 'organization', ownerId: 'owner-1', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', currentDraftVersionId: null,
      currentPublishedVersionId: 'published-1', schemaVersion: 3, revision: 1,
    };
    const draft = {
      id: 'draft-reopened', examId, versionNumber: 2, parentVersionId: 'published-1',
      contentSnapshot: state, configSnapshot: state.config, createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z', isDraft: true, isPublished: false, revision: reopenedRevision,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const data = url === `/api/v1/exams/${examId}` ? exam : draft;
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await new ExamLifecycleService(examRepository).saveDraft(examId, state, 'owner-1', {
      versionId: 'published-1', revision: 3, isDraft: false,
    });

    expect(result.success).toBe(expectedSuccess);
    const writes = fetchMock.mock.calls.filter(([url, init]) => String(url) === `/api/v1/exams/${examId}/draft` && init?.method === 'PATCH');
    expect(writes).toHaveLength(expectedSuccess ? 1 : 0);
    if (expectedSuccess) expect(JSON.parse(String(writes[0]?.[1]?.body)).revision).toBe(0);
    else expect(result.error).toMatch(/changed/i);
  });

  it('refuses a fenced config save when the loaded draft has no revision', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const result = await new ExamLifecycleService(examRepository).saveDraft('exam-1', buildState(), 'owner-1', {
      versionId: 'draft-1', revision: null, isDraft: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/revision.*unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a saved draft separately from a failed follow-up exam read', async () => {
    const state = buildState();
    const examId = 'config-refresh-failure';
    const exam = {
      id: examId, slug: examId, title: state.title, examType: 'Academic', status: 'draft',
      visibility: 'organization', ownerId: 'owner-1', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', currentDraftVersionId: 'draft-1',
      currentPublishedVersionId: null, schemaVersion: 3, revision: 1,
    };
    const savedVersion = {
      id: 'draft-1', examId, versionNumber: 1, parentVersionId: null,
      contentSnapshot: state, configSnapshot: state.config, createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z', isDraft: true, isPublished: false, revision: 2,
    };
    let examReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/v1/exams/${examId}` && init?.method !== 'PATCH' && ++examReads > 1) {
        return new Response(JSON.stringify({ success: false, error: { message: 'Refresh denied' } }), {
          status: 403, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: init?.method === 'PATCH' ? savedVersion : exam }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await new ExamLifecycleService(examRepository).saveDraft(examId, state, 'owner-1', {
      versionId: 'draft-1', revision: 1, isDraft: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/draft saved.*refresh/i);
    expect(result.version?.revision).toBe(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  it('creates an exam and its initial draft through the backend', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'Backend-backed Exam',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              currentDraftVersionId: null,
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'ver-1',
              examId: '11111111-1111-1111-1111-111111111111',
              versionNumber: 1,
              parentVersionId: null,
              contentSnapshot: state,
              configSnapshot: state.config,
              createdBy: 'owner-1',
              createdAt: '2026-01-01T00:00:01.000Z',
              isDraft: true,
              isPublished: false,
              revision: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'Backend-backed Exam',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:01.000Z',
              currentDraftVersionId: 'ver-1',
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 1,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);
    const result = await service.createExam('Backend-backed Exam', 'Academic', state, 'owner-1');

    expect(result.success).toBe(true);
    expect(result.exam?.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.exam?.currentDraftVersionId).toBe('ver-1');
    expect(result.version?.id).toBe('ver-1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/exams',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/exams/11111111-1111-1111-1111-111111111111/draft',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('sends SAT create idempotency in the header without adding it to the request body', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { id: 'sat-idem-1', revision: 0 } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          success: true,
          data: {
            id: 'sat-idem-1',
            slug: 'retryable-sat',
            title: 'Retryable SAT',
            providerKey: 'sat',
            providerExamType: 'SAT',
            examType: 'Academic',
            status: 'draft',
            visibility: 'organization',
            ownerId: 'owner-1',
            currentDraftVersionId: 'draft-1',
            schemaVersion: 4,
            revision: 0,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const timing = { module1Minutes: 32, module2LowerMinutes: 32, module2HigherMinutes: 32, breakAfterMinutes: 10, minimumCorrectForHigher: 15 };
    const configuration = { showClassroomScoreReport: true, sections: { 'reading-writing': timing, math: timing } };
    const result = await new ExamLifecycleService(examRepository).createProviderExam({
      providerKey: 'sat',
      providerExamType: 'SAT',
      title: 'Retryable SAT',
      operationKey: 'same-operation-key',
      configuration,
    }, 'owner-1');

    expect(result.success).toBe(true);
    expect(result.exam?.id).toBe('sat-idem-1');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/exams');
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('same-operation-key');
    const body = JSON.parse(String(options.body));
    expect(body.configuration).toEqual(configuration);
    expect(body).not.toHaveProperty('operationKey');
  });

  it('updates the exam title metadata when saving a draft', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();
    state.title = 'New Backend Title';
    state.config.general.title = 'New Backend Title';

    const fetchMock = vi
      .fn()
      // initial exam fetch to resolve the draft version id
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'Backend-backed Exam',
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
      // fresh draft version read for the fence revision
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'ver-1',
              examId: '11111111-1111-1111-1111-111111111111',
              versionNumber: 1,
              parentVersionId: null,
              contentSnapshot: state,
              configSnapshot: state.config,
              createdBy: 'owner-1',
              createdAt: '2026-01-01T00:00:01.000Z',
              isDraft: true,
              isPublished: false,
              revision: 7,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // save draft
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'ver-2',
              examId: '11111111-1111-1111-1111-111111111111',
              versionNumber: 2,
              parentVersionId: null,
              contentSnapshot: state,
              configSnapshot: state.config,
              createdBy: 'owner-1',
              createdAt: '2026-01-01T00:00:02.000Z',
              isDraft: true,
              isPublished: false,
              revision: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // refresh exam after draft save (old title, new revision)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'Backend-backed Exam',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:02.000Z',
              currentDraftVersionId: 'ver-2',
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 1,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // patch exam metadata
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'New Backend Title',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:03.000Z',
              currentDraftVersionId: 'ver-2',
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 2,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // refresh exam after metadata update
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              slug: 'backend-backed-exam',
              title: 'New Backend Title',
              examType: 'Academic',
              status: 'draft',
              visibility: 'organization',
              ownerId: 'owner-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:03.000Z',
              currentDraftVersionId: 'ver-2',
              currentPublishedVersionId: null,
              schemaVersion: 3,
              revision: 2,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);

    const result = await service.saveDraft('11111111-1111-1111-1111-111111111111', state, 'owner-1');

    expect(result.success).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          call[0] === '/api/v1/exams/11111111-1111-1111-1111-111111111111/draft' &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          call[0] === '/api/v1/exams/11111111-1111-1111-1111-111111111111' &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(true);
  });

  it('rechecks the latest exam revision immediately before publishing', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();

    const examPayload = {
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'backend-backed-exam',
      title: 'Backend-backed Exam',
      examType: 'Academic',
      status: 'draft',
      visibility: 'organization',
      ownerId: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: 'ver-latest',
      currentPublishedVersionId: null,
      schemaVersion: 3,
    };
    const versionPayload = {
      id: 'ver-latest',
      examId: '11111111-1111-1111-1111-111111111111',
      versionNumber: 3,
      parentVersionId: 'ver-2',
      contentSnapshot: state,
      configSnapshot: state.config,
      createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:03.000Z',
      isDraft: true,
      isPublished: false,
      revision: 0,
    };

    const fetchMock = vi
      .fn()
      // backend validation succeeds against the currently saved draft
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              canPublish: true,
              errors: [],
              warnings: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // validation enrichment: exam fetch (revision 5) then version fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...examPayload,
              revision: 5,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: versionPayload,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // publish fence: exam fetch for the draft id, then fresh version read (revision 6)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...examPayload,
              updatedAt: '2026-01-01T00:00:04.000Z',
              revision: 6,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...versionPayload,
              revision: 6,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // post-publish exam refresh
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...examPayload,
              updatedAt: '2026-01-01T00:00:04.000Z',
              revision: 6,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...versionPayload,
              isDraft: false,
              isPublished: true,
              publishNotes: 'publish latest',
              createdAt: '2026-01-01T00:00:05.000Z',
              revision: 1,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              ...examPayload,
              status: 'published',
              currentDraftVersionId: null,
              currentPublishedVersionId: 'ver-latest',
              publishedAt: '2026-01-01T00:00:05.000Z',
              updatedAt: '2026-01-01T00:00:05.000Z',
              revision: 7,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);
    const result = await service.publishExam(
      '11111111-1111-1111-1111-111111111111',
      'owner-1',
      'publish latest',
    );

    expect(result.success).toBe(true);
    const publishCall = fetchMock.mock.calls.find(
      (call) =>
        call[0] === '/api/v1/exams/11111111-1111-1111-1111-111111111111/publish' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(publishCall).toBeDefined();
    expect(JSON.parse((publishCall?.[1] as RequestInit).body as string)).toMatchObject({
      publishNotes: 'publish latest',
      revision: 6,
    });
  });
});
