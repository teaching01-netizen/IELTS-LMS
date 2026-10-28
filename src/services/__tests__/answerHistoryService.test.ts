import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAnswerHistoryExport,
  fetchAnswerHistoryOverviewByAttempt,
  fetchAnswerHistoryOverviewBySubmission,
  fetchAnswerHistoryTargetDetail,
  fetchAnswerHistoryTargetDetailByAttempt,
} from '../answerHistoryService';

describe('answerHistoryService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('requests submission overview endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { submissionId: 'sub-1', attemptId: 'attempt-1', questionSummaries: [], sectionStats: [], signals: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await fetchAnswerHistoryOverviewBySubmission('sub-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/answer-history/submissions/sub-1/overview',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects an incomplete overview instead of returning it to the screen', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as typeof fetch;
    await expect(fetchAnswerHistoryOverviewBySubmission('sub-incomplete')).rejects.toThrow(/incomplete/i);
  });

  it('requests attempt overview endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { attemptId: 'attempt-1', questionSummaries: [], sectionStats: [], signals: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await fetchAnswerHistoryOverviewByAttempt('attempt-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/answer-history/attempts/attempt-1/overview',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns null for missing in-progress attempt overview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(fetchAnswerHistoryOverviewByAttempt('attempt-missing')).resolves.toBeNull();
  });

  it('encodes target detail query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { targetId: 'q1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await fetchAnswerHistoryTargetDetail({
      submissionId: 'sub-1',
      targetId: 'q 1',
      targetType: 'objective',
      cursor: 10,
      limit: 50,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/answer-history/submissions/sub-1/targets/q%201?targetType=objective&cursor=10&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('encodes attempt target detail query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { targetId: 'q1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await fetchAnswerHistoryTargetDetailByAttempt({
      attemptId: 'attempt-1',
      targetId: 'q 1',
      targetType: 'objective',
      cursor: 10,
      limit: 50,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/answer-history/attempts/attempt-1/targets/q%201?targetType=objective&cursor=10&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('encodes export query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { format: 'csv', filename: 'x.csv', contentType: 'text/csv', content: 'a,b' },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await fetchAnswerHistoryExport({
      submissionId: 'sub-1',
      targetId: 'task 2',
      targetType: 'writing',
      format: 'csv',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/answer-history/submissions/sub-1/export?targetType=writing&targetId=task+2&format=csv',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
