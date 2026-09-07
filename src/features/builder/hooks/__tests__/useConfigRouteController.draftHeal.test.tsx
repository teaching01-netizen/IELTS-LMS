import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { useConfigRouteController } from '../useConfigRouteController';

const mockNavigate = vi.fn();
const mockGetExamById = vi.fn();
const mockGetVersionById = vi.fn();
const mockSaveDraft = vi.fn();

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
  },
}));

describe('useConfigRouteController draft heal', () => {
  it('falls back to the published snapshot when the draft row is gone', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const currentState = createInitialExamState('Clone DB Exam', 'Academic');
    currentState.config = config;
    mockGetExamById.mockReset();
    mockGetVersionById.mockReset();
    mockSaveDraft.mockReset();

    // Exam row kept a stale draft pointer (clone-database row whose draft was
    // deleted) plus a live published seal.
    mockGetExamById.mockResolvedValue({
      id: 'exam-clone',
      currentDraftVersionId: 'ver-stale',
      currentPublishedVersionId: 'ver-pub',
    });
    mockGetVersionById.mockImplementation(async (id: string) => {
      if (id === 'ver-stale') return null;
      return {
        id: 'ver-pub',
        configSnapshot: config,
        contentSnapshot: currentState,
      };
    });

    const { result } = renderHook(() => useConfigRouteController('exam-clone'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.config).toBeDefined();
  });
});
