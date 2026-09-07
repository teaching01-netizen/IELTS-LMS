import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { useBuilderRouteController } from '../useBuilderRouteController';

const mockNavigate = vi.fn();
const mockGetExamById = vi.fn();
const mockGetVersionById = vi.fn();
const mockSaveDraft = vi.fn();
const mockReopenDraftVersion = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../auth/api/authSession', () => ({
  useOptionalAuthSession: () => ({
    session: { user: { id: 'builder-1', displayName: 'Builder User', email: 'builder@example.com' } },
  }),
}));

vi.mock('@services/examRepository', () => ({
  examRepository: {
    getExamById: (...args: unknown[]) => mockGetExamById(...args),
    getVersionById: (...args: unknown[]) => mockGetVersionById(...args),
  },
}));

vi.mock('@services/examLifecycleService', () => ({
  examLifecycleService: {
    saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
    getPublishReadiness: vi.fn(),
    publishExam: vi.fn(),
    schedulePublish: vi.fn(),
    unpublishExam: vi.fn(),
    archiveExam: vi.fn(),
    reopenDraftVersion: (...args: unknown[]) => mockReopenDraftVersion(...args),
  },
}));

describe('useBuilderRouteController draft heal', () => {
  it('heals an orphan exam once and loads the reopened draft', async () => {
    const healedState = createInitialExamState('Healed Exam', 'Academic');
    mockGetExamById.mockReset();
    mockGetVersionById.mockReset();
    mockReopenDraftVersion.mockReset();

    mockGetExamById
      .mockResolvedValueOnce({
        id: 'exam-orphan',
        currentDraftVersionId: null,
        currentPublishedVersionId: null,
      })
      .mockResolvedValueOnce({
        id: 'exam-orphan',
        currentDraftVersionId: 'ver-healed',
        currentPublishedVersionId: null,
      });
    mockGetVersionById.mockResolvedValue({
      id: 'ver-healed',
      contentSnapshot: healedState,
      configSnapshot: healedState.config,
    });
    mockReopenDraftVersion.mockImplementation(async () => {
      // The heal inserts the draft pointer the retry then loads.
      mockGetVersionById.mockResolvedValueOnce({
        id: 'ver-healed',
        contentSnapshot: healedState,
        configSnapshot: healedState.config,
      });
      return true;
    });

    const { result } = renderHook(() => useBuilderRouteController('exam-orphan'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockReopenDraftVersion).toHaveBeenCalledTimes(1);
    expect(mockReopenDraftVersion).toHaveBeenCalledWith('exam-orphan');
    expect(result.current.error).toBeNull();
    expect(result.current.state?.title).toBe('Healed Exam');
  });

  it('surfaces the load error when the heal fails', async () => {
    mockGetExamById.mockReset();
    mockGetVersionById.mockReset();
    mockReopenDraftVersion.mockReset();

    mockGetExamById.mockResolvedValue({
      id: 'exam-orphan',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
    });
    mockReopenDraftVersion.mockResolvedValue(false);

    const { result } = renderHook(() => useBuilderRouteController('exam-orphan'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toContain('has no version');
    expect(result.current.state).toBeNull();
  });
});
