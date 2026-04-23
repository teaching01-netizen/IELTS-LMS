import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useConfigRouteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the existing draft content when saving config changes', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const currentState = createInitialExamState('Mock IELTS Exam', 'Academic');
    currentState.config = config;
    currentState.reading.passages[0] = {
      ...currentState.reading.passages[0],
      content: 'Some passage text',
      wordCount: 3,
      blocks: [
        {
          id: 'b1',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Read and answer',
          questions: [{ id: 'q1', statement: 'Statement 1', correctAnswer: 'T' }],
        },
      ],
    };
    currentState.listening.parts[0] = {
      ...currentState.listening.parts[0],
      audioUrl: '',
      pins: [],
      blocks: [
        {
          id: 'b2',
          type: 'CLOZE',
          instruction: 'Complete the notes',
          answerRule: 'TWO_WORDS',
          questions: [{ id: 'q2', prompt: 'A ____ answer', correctAnswer: 'test' }],
        },
      ],
    };
    currentState.writing.task1Prompt = 'Task 1 prompt';
    currentState.writing.task2Prompt = 'Task 2 prompt';
    currentState.writing.customPromptTemplates = [];

    mockGetExamById.mockResolvedValue({
      id: 'exam-1',
      currentDraftVersionId: 'ver-1',
    });
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      configSnapshot: config,
      contentSnapshot: currentState,
    });
    mockSaveDraft.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useConfigRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.config).toBeDefined();
    });

    const nextConfig = {
      ...config,
      general: {
        ...config.general,
        title: 'Updated Exam Title',
      },
    };

    await act(async () => {
      await result.current.handleUpdateConfig(nextConfig);
    });

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).toHaveBeenCalledWith(
      'exam-1',
      expect.objectContaining({
        activePassageId: currentState.activePassageId,
        activeListeningPartId: currentState.activeListeningPartId,
        reading: currentState.reading,
        listening: currentState.listening,
        writing: expect.objectContaining({
          customPromptTemplates: [],
        }),
        config: expect.objectContaining({
          general: expect.objectContaining({
            title: 'Updated Exam Title',
          }),
        }),
      }),
      'System',
    );
  });

  it('surfaces save errors when draft persistence fails', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const currentState = createInitialExamState('Mock IELTS Exam', 'Academic');
    currentState.config = config;

    mockGetExamById.mockResolvedValue({
      id: 'exam-1',
      currentDraftVersionId: 'ver-1',
    });
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      configSnapshot: config,
      contentSnapshot: currentState,
    });
    mockSaveDraft.mockResolvedValue({ success: false, error: 'Draft has been modified by another user' });

    const { result } = renderHook(() => useConfigRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(result.current.error).toContain('Draft has been modified');
  });

  it('saves config before navigating to the builder', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const currentState = createInitialExamState('Mock IELTS Exam', 'Academic');
    currentState.config = config;

    mockGetExamById.mockResolvedValue({
      id: 'exam-1',
      currentDraftVersionId: 'ver-1',
    });
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      configSnapshot: config,
      contentSnapshot: currentState,
    });
    mockSaveDraft.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useConfigRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleNavigateToBuilder();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/builder/exam-1/builder');
    expect(mockSaveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0],
    );
  });

  it('blocks navigation when config save fails', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const currentState = createInitialExamState('Mock IELTS Exam', 'Academic');
    currentState.config = config;

    mockGetExamById.mockResolvedValue({
      id: 'exam-1',
      currentDraftVersionId: 'ver-1',
    });
    mockGetVersionById.mockResolvedValue({
      id: 'ver-1',
      configSnapshot: config,
      contentSnapshot: currentState,
    });
    mockSaveDraft.mockResolvedValue({ success: false, error: 'Revision mismatch' });

    const { result } = renderHook(() => useConfigRouteController('exam-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleNavigateToBuilder();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Revision mismatch');
  });
});
