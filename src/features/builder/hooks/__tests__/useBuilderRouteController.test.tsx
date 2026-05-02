import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import type { ExamEntity } from '../../../../types/domain';
import { useBuilderRouteController } from '../useBuilderRouteController';

const mockNavigate = vi.fn();
const mockGetExamById = vi.fn();
const mockGetVersionById = vi.fn();
const mockGetVersionSummaries = vi.fn();
const mockSaveDraft = vi.fn();
const mockGetPublishReadiness = vi.fn();
const mockPublishExam = vi.fn();
const mockSchedulePublish = vi.fn();
const mockUnpublishExam = vi.fn();
const mockArchiveExam = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@services/examRepository', () => ({
  examRepository: {
    getExamById: (...args: unknown[]) => mockGetExamById(...args),
    getVersionById: (...args: unknown[]) => mockGetVersionById(...args),
    getVersionSummaries: (...args: unknown[]) => mockGetVersionSummaries(...args),
  },
}));

vi.mock('@services/examLifecycleService', () => ({
  examLifecycleService: {
    saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
    getPublishReadiness: (...args: unknown[]) => mockGetPublishReadiness(...args),
    publishExam: (...args: unknown[]) => mockPublishExam(...args),
    schedulePublish: (...args: unknown[]) => mockSchedulePublish(...args),
    unpublishExam: (...args: unknown[]) => mockUnpublishExam(...args),
    archiveExam: (...args: unknown[]) => mockArchiveExam(...args),
  },
}));

function buildExamEntity(overrides: Partial<ExamEntity> = {}): ExamEntity {
  return {
    id: 'exam-1',
    slug: 'mock-ielts-exam',
    title: 'Mock IELTS Exam',
    type: 'Academic',
    status: 'draft',
    visibility: 'organization',
    owner: 'owner-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    currentDraftVersionId: 'ver-1',
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 1,
    ...overrides,
  };
}

describe('useBuilderRouteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDraft.mockResolvedValue({ success: true });
    mockPublishExam.mockResolvedValue({ success: true });
    mockSchedulePublish.mockResolvedValue({ success: true });
    mockUnpublishExam.mockResolvedValue({ success: true });
    mockArchiveExam.mockResolvedValue({ success: true });
  });

  it('loads builder content via exam + current version only', async () => {
    const state = createInitialExamState('Mock IELTS Exam', 'Academic');
    mockGetExamById.mockResolvedValue(buildExamEntity());
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      contentSnapshot: state,
      configSnapshot: state.config,
    });

    const { result } = renderHook(() => useBuilderRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.state?.title).toBe('Mock IELTS Exam');
    expect(mockGetExamById).toHaveBeenCalledTimes(1);
    expect(mockGetExamById).toHaveBeenCalledWith('exam-1');
    expect(mockGetVersionById).toHaveBeenCalledTimes(1);
    expect(mockGetVersionById).toHaveBeenCalledWith('ver-1');
    expect(mockGetVersionSummaries).not.toHaveBeenCalled();
    expect(mockGetPublishReadiness).not.toHaveBeenCalled();
  });

  it('saves draft updates without metadata refresh fan-out', async () => {
    const state = createInitialExamState('Mock IELTS Exam', 'Academic');
    const updatedState = {
      ...state,
      title: 'Edited Mock IELTS Exam',
      config: {
        ...state.config,
        general: {
          ...state.config.general,
          title: 'Edited Mock IELTS Exam',
        },
      },
    };

    mockGetExamById.mockResolvedValue(buildExamEntity());
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      contentSnapshot: state,
      configSnapshot: state.config,
    });

    const { result } = renderHook(() => useBuilderRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleUpdateExamContent(updatedState);
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).toHaveBeenCalledWith('exam-1', updatedState, 'System');
    expect(result.current.state?.title).toBe('Edited Mock IELTS Exam');
    expect(mockGetExamById).toHaveBeenCalledTimes(1);
    expect(mockGetVersionById).toHaveBeenCalledTimes(1);
    expect(mockGetVersionSummaries).not.toHaveBeenCalled();
    expect(mockGetPublishReadiness).not.toHaveBeenCalled();
  });

  it('reload re-fetches exam and current version', async () => {
    const initialState = createInitialExamState('Mock IELTS Exam', 'Academic');
    const refreshedState = createInitialExamState('Refreshed IELTS Exam', 'Academic');

    mockGetExamById
      .mockResolvedValueOnce(buildExamEntity({ title: 'Mock IELTS Exam' }))
      .mockResolvedValueOnce(
        buildExamEntity({
          title: 'Refreshed IELTS Exam',
          currentDraftVersionId: 'ver-2',
          updatedAt: '2026-01-01T00:05:00.000Z',
        }),
      );
    mockGetVersionById
      .mockResolvedValueOnce({
        id: 'ver-1',
        contentSnapshot: initialState,
        configSnapshot: initialState.config,
      })
      .mockResolvedValueOnce({
        id: 'ver-2',
        contentSnapshot: refreshedState,
        configSnapshot: refreshedState.config,
      });

    const { result } = renderHook(() => useBuilderRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.state?.title).toBe('Mock IELTS Exam');
    });

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.state?.title).toBe('Refreshed IELTS Exam');
    });

    expect(mockGetExamById).toHaveBeenCalledTimes(2);
    expect(mockGetVersionById).toHaveBeenCalledTimes(2);
    expect(mockGetVersionSummaries).not.toHaveBeenCalled();
    expect(mockGetPublishReadiness).not.toHaveBeenCalled();
  });
});
