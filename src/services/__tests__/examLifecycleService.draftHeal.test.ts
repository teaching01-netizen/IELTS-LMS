import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import { ExamLifecycleService } from '../examLifecycleService';
import { examRepository } from '../examRepository';
import type { ExamState } from '../../types';

const originalFetch = global.fetch;

function buildState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Healed Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function examPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'clone-db-exam',
    title: 'Clone DB Exam',
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
    ...overrides,
  };
}

describe('ExamLifecycleService draft heal (clone-database orphans)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('reopens a missing draft before saving so clone-database exams stop failing', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();
    const fetchMock = vi
      .fn()
      // ensureBackendDraftVersionRevision: exam has no draft pointer
      .mockResolvedValueOnce(jsonResponse(examPayload()))
      // healed draft from the reopen endpoint
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 1,
          parentVersionId: null,
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          isDraft: true,
          isPublished: false,
          revision: 0,
        }),
      )
      // fence revision for the healed draft
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 1,
          parentVersionId: null,
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          isDraft: true,
          isPublished: false,
          revision: 0,
        }),
      )
      // save draft
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 1,
          parentVersionId: null,
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:02.000Z',
          isDraft: true,
          isPublished: false,
          revision: 1,
        }),
      )
      // refresh exam after save
      .mockResolvedValueOnce(
        jsonResponse(
          examPayload({ currentDraftVersionId: 'ver-healed', revision: 1 }),
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);
    const result = await service.saveDraft(
      '22222222-2222-2222-2222-222222222222',
      state,
      'owner-1',
    );

    expect(result.success).toBe(true);
    const reopenCall = fetchMock.mock.calls.find(
      (call) =>
        call[0] ===
          '/api/v1/exams/22222222-2222-2222-2222-222222222222/draft/reopen' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(reopenCall).toBeDefined();
    const draftCall = fetchMock.mock.calls.find(
      (call) =>
        call[0] ===
          '/api/v1/exams/22222222-2222-2222-2222-222222222222/draft' &&
        (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(draftCall).toBeDefined();
  });

  it('reopens a sealed published exam before publishing so entry keeps working', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const state = buildState();
    const fetchMock = vi
      .fn()
      // getPublishReadiness: validation gate
      .mockResolvedValueOnce(
        jsonResponse({ canPublish: true, errors: [], warnings: [] }),
      )
      // readiness enrichment: exam has published pointer only
      .mockResolvedValueOnce(
        jsonResponse(
          examPayload({
            status: 'published',
            currentDraftVersionId: null,
            currentPublishedVersionId: 'ver-pub',
            revision: 7,
          }),
        ),
      )
      // readiness enrichment: published version
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-pub',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 3,
          parentVersionId: null,
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          isDraft: false,
          isPublished: true,
          revision: 2,
        }),
      )
      // ensureBackendDraftVersionRevision: sealed, no draft pointer
      .mockResolvedValueOnce(
        jsonResponse(
          examPayload({
            status: 'published',
            currentDraftVersionId: null,
            currentPublishedVersionId: 'ver-pub',
            revision: 7,
          }),
        ),
      )
      // reopen heal returns a fresh editable draft
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 4,
          parentVersionId: 'ver-pub',
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:02.000Z',
          isDraft: true,
          isPublished: false,
          revision: 0,
        }),
      )
      // fence revision for the healed draft
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 4,
          parentVersionId: 'ver-pub',
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:02.000Z',
          isDraft: true,
          isPublished: false,
          revision: 0,
        }),
      )
      // publish seals the healed draft
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ver-healed',
          examId: '22222222-2222-2222-2222-222222222222',
          versionNumber: 4,
          parentVersionId: 'ver-pub',
          contentSnapshot: state,
          configSnapshot: state.config,
          createdBy: 'owner-1',
          createdAt: '2026-01-01T00:00:03.000Z',
          isDraft: false,
          isPublished: true,
          revision: 1,
        }),
      )
      // refresh exam after publish
      .mockResolvedValueOnce(
        jsonResponse(
          examPayload({
            status: 'published',
            currentDraftVersionId: null,
            currentPublishedVersionId: 'ver-healed',
            revision: 8,
          }),
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const service = new ExamLifecycleService(examRepository);
    const result = await service.publishExam(
      '22222222-2222-2222-2222-222222222222',
      'owner-1',
    );

    expect(result.success).toBe(true);
    const reopenCall = fetchMock.mock.calls.find(
      (call) =>
        call[0] ===
          '/api/v1/exams/22222222-2222-2222-2222-222222222222/draft/reopen' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(reopenCall).toBeDefined();
  });
});
