import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearExamRevision, getExamRevision, rememberExamRevision } from '../backendBridge';
import { examRepository } from '../examRepository';
import type { ExamEntity } from '../../types/domain';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status < 400,
      data,
      metadata: { requestId: 'req-test', timestamp: '2026-01-01T00:00:00.000Z' },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );

const errorResponse = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function examEntity(id: string, title = 'Draft Exam'): ExamEntity {
  return {
    id,
    slug: 'draft-exam',
    title,
    type: 'Academic',
    status: 'draft',
    visibility: 'organization',
  } as unknown as ExamEntity;
}

const entityPayload = (id: string, revision: number) => ({
  id,
  slug: 'draft-exam',
  title: 'Draft Exam',
  examType: 'Academic',
  status: 'draft',
  visibility: 'organization',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  currentDraftVersionId: null,
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 3,
  revision,
});

describe('examRepository save conflict handling (finding #5)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    clearExamRevision('exam-1');
    clearExamRevision('exam-cold');
  });

  it('carries the revision returned by an update into the next save (no stale revision, no spurious conflict)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    rememberExamRevision('exam-1', 5);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'exam-1', revision: 6 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'exam-1', revision: 7 }));
    global.fetch = fetchMock as typeof fetch;

    await examRepository.saveExam(examEntity('exam-1'));
    await examRepository.saveExam(examEntity('exam-1', 'Second save'));

    // Two PATCHes, no refresh GET: the second save must use the revision the
    // first update returned rather than replaying the stale one and eating a
    // 409 that the auto-retry used to convert into an undetected overwrite.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['PATCH', 'PATCH']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ revision: 5 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ revision: 6 });
    expect(getExamRevision('exam-1')).toBe(7);
  });

  it('converges a cold-cache create that conflicts onto the update path instead of failing', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    clearExamRevision('exam-cold');
    const fetchMock = vi
      .fn()
      // Blind create for an exam that already exists → duplicate-slug conflict.
      .mockResolvedValueOnce(errorResponse(409, 'Exam slug "draft-exam" is already taken.'))
      // Hydration read publishes the existing revision.
      .mockResolvedValueOnce(jsonResponse(entityPayload('exam-cold', 9)))
      // Converged update succeeds and republishes the next revision.
      .mockResolvedValueOnce(jsonResponse({ id: 'exam-cold', revision: 10 }));
    global.fetch = fetchMock as typeof fetch;

    await examRepository.saveExam(examEntity('exam-cold'));

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'PATCH']);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ revision: 9 });
    expect(getExamRevision('exam-cold')).toBe(10);
  });

  it('rethrows the create conflict when the id does not exist server-side (slug genuinely taken)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    clearExamRevision('exam-cold');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(409, 'Exam slug "draft-exam" is already taken.'))
      .mockResolvedValueOnce(errorResponse(404, 'Exam not found.'));
    global.fetch = fetchMock as typeof fetch;

    await expect(examRepository.saveExam(examEntity('exam-cold'))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
  });
});
