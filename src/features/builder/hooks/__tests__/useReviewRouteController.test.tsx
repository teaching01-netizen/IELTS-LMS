import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewRouteController } from '../useReviewRouteController';

const mockNavigate = vi.fn();
const mockGetExamById = vi.fn();
const mockGetVersionById = vi.fn();
const mockGetVersionSummaries = vi.fn();
const mockGetSchedulesByExam = vi.fn();
const mockGetPublishReadiness = vi.fn();
const mockHydrateExamState = vi.fn((snapshot: unknown) => snapshot);

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../exam-authoring/api/examAuthoringFacade', () => ({
  examAuthoringFacade: {
    repository: {
      getExamById: (...args: unknown[]) => mockGetExamById(...args),
      getVersionById: (...args: unknown[]) => mockGetVersionById(...args),
      getVersionSummaries: (...args: unknown[]) => mockGetVersionSummaries(...args),
      getSchedulesByExam: (...args: unknown[]) => mockGetSchedulesByExam(...args),
    },
    lifecycle: {
      getPublishReadiness: (...args: unknown[]) => mockGetPublishReadiness(...args),
    },
    hydrateExamState: (...args: unknown[]) => mockHydrateExamState(...args),
  },
}));

describe('useReviewRouteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetExamById.mockReset().mockResolvedValue({
      id: 'exam-1',
      currentDraftVersionId: 'ver-1',
      title: 'Review Exam',
      type: 'Academic',
      status: 'draft',
      owner: 'owner-1',
    });
    mockGetVersionSummaries.mockReset().mockResolvedValue([]);
    mockGetSchedulesByExam.mockReset().mockResolvedValue([]);
    mockGetPublishReadiness.mockReset().mockResolvedValue({
      canPublish: true,
      errors: [],
      warnings: [],
      missingFields: [],
      questionCounts: { reading: 0, listening: 0, total: 0 },
    });
    mockGetVersionById.mockReset().mockResolvedValue({
      id: 'ver-1',
      contentSnapshot: { title: 'Draft Content' },
    });
  });

  it('does not fetch the full draft content on load', async () => {
    const { result } = renderHook(() => useReviewRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 3000 });

    expect(mockGetExamById).toHaveBeenCalledWith('exam-1');
    expect(mockGetVersionSummaries).toHaveBeenCalledWith('exam-1');
    expect(mockGetSchedulesByExam).toHaveBeenCalledWith('exam-1');
    expect(mockGetPublishReadiness).toHaveBeenCalledWith('exam-1');
    expect(mockGetVersionById).not.toHaveBeenCalled();
  });

  it('loads the draft content lazily when scheduling opens', async () => {
    const { result } = renderHook(() => useReviewRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.loadScheduleContent();
    });

    expect(mockGetVersionById).toHaveBeenCalledWith('ver-1');
    expect(result.current.state).toEqual({ title: 'Draft Content' });
  });

  it('does not refetch content already loaded for the same draft', async () => {
    const { result } = renderHook(() => useReviewRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.loadScheduleContent();
      await result.current.loadScheduleContent();
    });

    expect(mockGetVersionById).toHaveBeenCalledTimes(1);
  });
});