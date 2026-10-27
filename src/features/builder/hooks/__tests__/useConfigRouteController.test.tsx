import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { useConfigRouteController } from '../useConfigRouteController';

function queryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}


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

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

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
      'Builder User',
    );
  });

  it('leaves the controller in a not-found state when the exam is missing', async () => {
    mockGetExamById.mockResolvedValue(null);

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.exam).toBeUndefined();
    expect(result.current.config).toBeUndefined();
    expect(mockGetVersionById).not.toHaveBeenCalled();
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

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

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

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

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

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleNavigateToBuilder();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Revision mismatch');
  });

  it('asks before canceling with unsaved changes', async () => {
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

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleUpdateConfig({
        ...config,
        general: {
          ...config.general,
          title: 'Edited title',
        },
      });
    });

    await act(async () => {
      result.current.handleCancel();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('reuses the loaded exam and version when saving config', async () => {
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

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleUpdateConfig({
        ...config,
        general: { ...config.general, title: 'Updated Exam Title' },
      });
      await result.current.handleSaveConfig();
    });

    // Initial load + post-save reload; no redundant pre-save refetch.
    expect(mockGetExamById).toHaveBeenCalledTimes(2);
    expect(mockGetVersionById).toHaveBeenCalledTimes(2);
  });

  it('ignores overlapping save clicks while a save is in flight', async () => {
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

    let resolveSave!: (value: { success: boolean }) => void;
    mockSaveDraft.mockImplementation(
      () => new Promise<{ success: boolean }>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      const first = result.current.handleSaveConfig();
      const second = result.current.handleSaveConfig();
      resolveSave({ success: true });
      await Promise.all([first, second]);
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('tracks isSaving while a draft save is in flight', async () => {
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

    let resolveSave!: (value: { success: boolean }) => void;
    mockSaveDraft.mockImplementation(
      () => new Promise<{ success: boolean }>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = renderHook(() => useConfigRouteController('exam-1'), { wrapper: queryWrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let savePromise: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveConfig();
    });

    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      resolveSave({ success: true });
      await savePromise;
    });

    expect(result.current.isSaving).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function examFixture(id: string) {
  const config = createDefaultConfig('Academic', 'Academic');
  config.general.title = `Title ${id}`;
  const content = createInitialExamState(`Title ${id}`, 'Academic');
  content.config = config;
  return {
    entity: { id, currentDraftVersionId: `ver-${id}` },
    version: { id: `ver-${id}`, configSnapshot: config, contentSnapshot: content },
  };
}

describe('useConfigRouteController entity identity (F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a slow load for A cannot install A after navigating to B', async () => {
    const a = examFixture('a');
    const b = examFixture('b');
    const slowA = deferred<typeof a.entity>();
    mockGetExamById.mockImplementation((id: string) => (id === 'a' ? slowA.promise : Promise.resolve(b.entity)));
    mockGetVersionById.mockImplementation((id: string) => Promise.resolve(id === 'ver-a' ? a.version : b.version));

    const { result, rerender } = renderHook(({ examId }) => useConfigRouteController(examId), {
      wrapper: queryWrapper,
      initialProps: { examId: 'a' },
    });
    rerender({ examId: 'b' });
    await waitFor(() => expect(result.current.config?.general.title).toBe('Title b'));

    await act(async () => {
      slowA.resolve(a.entity);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.exam?.id).toBe('b');
    expect(result.current.config?.general.title).toBe('Title b');
  });

  it('navigating to a missing exam never shows the previous exam as the new one', async () => {
    const a = examFixture('a');
    mockGetExamById.mockImplementation((id: string) => Promise.resolve(id === 'a' ? a.entity : null));
    mockGetVersionById.mockResolvedValue(a.version);

    const { result, rerender } = renderHook(({ examId }) => useConfigRouteController(examId), {
      wrapper: queryWrapper,
      initialProps: { examId: 'a' },
    });
    await waitFor(() => expect(result.current.config?.general.title).toBe('Title a'));

    rerender({ examId: 'missing' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.exam).toBeUndefined();
    expect(result.current.config).toBeUndefined();

    await act(async () => {
      expect(await result.current.handleSaveConfig()).toBe(false);
    });
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('a save acknowledgement keeps edits made while the save was in flight', async () => {
    const a = examFixture('a');
    mockGetExamById.mockResolvedValue(a.entity);
    mockGetVersionById.mockResolvedValue(a.version);
    const save = deferred<{ success: boolean }>();
    mockSaveDraft.mockReturnValueOnce(save.promise).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useConfigRouteController('a'), { wrapper: queryWrapper });
    await waitFor(() => expect(result.current.config).toBeDefined());
    const base = result.current.config!;

    await act(async () => {
      await result.current.handleUpdateConfig({ ...base, general: { ...base.general, title: 'Edit 1' } });
    });
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.handleSaveConfig();
    });
    await act(async () => {
      await result.current.handleUpdateConfig({ ...base, general: { ...base.general, title: 'Edit 2' } });
    });
    await act(async () => {
      save.resolve({ success: true });
      await saving;
    });

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.config?.general.title).toBe('Edit 2');

    await act(async () => {
      await result.current.handleSaveConfig();
    });
    expect(mockSaveDraft).toHaveBeenLastCalledWith(
      'a',
      expect.objectContaining({ config: expect.objectContaining({ general: expect.objectContaining({ title: 'Edit 2' }) }) }),
      'Builder User',
    );
  });

  it('marks exam lists and the exam detail stale after a config save', async () => {
    const a = examFixture('a');
    mockGetExamById.mockResolvedValue(a.entity);
    mockGetVersionById.mockResolvedValue(a.version);
    mockSaveDraft.mockResolvedValue({ success: true });
    const client = new QueryClient();
    client.setQueryData(['exam-authoring', 'list', 'ielts', 'content'], { entities: [], exams: [] });
    client.setQueryData(['exam-authoring', 'detail', 'a'], a.entity);
    client.setQueryData(['exam-authoring', 'detail', 'b'], { id: 'b' });
    const { result } = renderHook(() => useConfigRouteController('a'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.config).toBeDefined());

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(client.getQueryState(['exam-authoring', 'list', 'ielts', 'content'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['exam-authoring', 'detail', 'a'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['exam-authoring', 'detail', 'b'])?.isInvalidated).toBe(false);
  });
});
