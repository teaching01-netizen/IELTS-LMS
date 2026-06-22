import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import type { ExamVersionMetadata } from '../../../../types/domain';
import { useLazyVersionLoad } from '../useLazyVersionLoad';

const mockGetVersionMetadata = vi.fn();
const mockGetVersionBuilderContent = vi.fn();

vi.mock('@services/examRepository', () => ({
  examRepository: {
    getVersionMetadata: (...args: unknown[]) => mockGetVersionMetadata(...args),
    getVersionBuilderContent: (...args: unknown[]) => mockGetVersionBuilderContent(...args),
  },
}));

function metadata(id: string): ExamVersionMetadata {
  return {
    id,
    examId: 'exam-1',
    versionNumber: 1,
    parentVersionId: null,
    createdBy: 'builder-1',
    createdAt: '2026-06-22T00:00:00.000Z',
    isDraft: true,
    isPublished: false,
    revision: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useLazyVersionLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates content with the persisted config snapshot', async () => {
    const content = createInitialExamState('Projected exam', 'Academic');
    const persistedConfig = {
      ...content.config,
      general: { ...content.config.general, title: 'Persisted config title' },
      sections: {
        ...content.config.sections,
        listening: { ...content.config.sections.listening, enabled: false },
      },
    };
    mockGetVersionMetadata.mockResolvedValue(metadata('version-1'));
    mockGetVersionBuilderContent.mockResolvedValue({
      contentSnapshot: { ...content, config: undefined },
      configSnapshot: persistedConfig,
    });

    const { result } = renderHook(() => useLazyVersionLoad('version-1'));

    await waitFor(() => expect(result.current.isContentLoaded).toBe(true));
    expect(result.current.state?.config).toEqual(persistedConfig);
  });

  it('clears version A and loads version B when versionId changes', async () => {
    const stateA = createInitialExamState('Version A', 'Academic');
    const stateB = createInitialExamState('Version B', 'General Training');
    mockGetVersionMetadata.mockImplementation(async (id: string) => metadata(id));
    mockGetVersionBuilderContent.mockImplementation(async (id: string) => {
      const state = id === 'version-a' ? stateA : stateB;
      return { contentSnapshot: state, configSnapshot: state.config };
    });

    const { result, rerender } = renderHook(
      ({ versionId }) => useLazyVersionLoad(versionId),
      { initialProps: { versionId: 'version-a' } },
    );
    await waitFor(() => expect(result.current.state?.title).toBe('Version A'));

    rerender({ versionId: 'version-b' });

    await waitFor(() => expect(result.current.state?.title).toBe('Version B'));
    expect(result.current.metadata?.id).toBe('version-b');
    expect(mockGetVersionBuilderContent).toHaveBeenCalledWith('version-b');
  });

  it('does not allow a delayed version A response to overwrite version B', async () => {
    const delayedA = deferred<{ contentSnapshot: ReturnType<typeof createInitialExamState>; configSnapshot: ReturnType<typeof createInitialExamState>['config'] }>();
    const stateA = createInitialExamState('Version A', 'Academic');
    const stateB = createInitialExamState('Version B', 'Academic');
    mockGetVersionMetadata.mockImplementation(async (id: string) => metadata(id));
    mockGetVersionBuilderContent.mockImplementation((id: string) =>
      id === 'version-a'
        ? delayedA.promise
        : Promise.resolve({ contentSnapshot: stateB, configSnapshot: stateB.config }),
    );

    const { result, rerender } = renderHook(
      ({ versionId }) => useLazyVersionLoad(versionId),
      { initialProps: { versionId: 'version-a' } },
    );
    await waitFor(() => expect(mockGetVersionBuilderContent).toHaveBeenCalledWith('version-a'));
    rerender({ versionId: 'version-b' });
    await waitFor(() => expect(result.current.state?.title).toBe('Version B'));

    await act(async () => delayedA.resolve({ contentSnapshot: stateA, configSnapshot: stateA.config }));

    expect(result.current.state?.title).toBe('Version B');
  });

  it('deduplicates concurrent manual content loads', async () => {
    const pending = deferred<{ contentSnapshot: ReturnType<typeof createInitialExamState>; configSnapshot: ReturnType<typeof createInitialExamState>['config'] }>();
    const state = createInitialExamState('Version', 'Academic');
    mockGetVersionMetadata.mockResolvedValue(metadata('version-1'));
    mockGetVersionBuilderContent.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useLazyVersionLoad('version-1', false));
    await waitFor(() => expect(result.current.metadata?.id).toBe('version-1'));

    await act(async () => {
      const first = result.current.loadContent();
      const second = result.current.loadContent();
      pending.resolve({ contentSnapshot: state, configSnapshot: state.config });
      await Promise.all([first, second]);
    });

    expect(mockGetVersionBuilderContent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['metadata', 'getVersionMetadata'],
    ['content', 'getVersionBuilderContent'],
  ] as const)('reports %s not found and settles loading state', async (phase) => {
    mockGetVersionMetadata.mockResolvedValue(phase === 'metadata' ? null : metadata('version-1'));
    mockGetVersionBuilderContent.mockResolvedValue(null);
    const { result } = renderHook(() => useLazyVersionLoad('version-1'));

    await waitFor(() => expect(result.current.error?.message).toMatch(/not found/i));
    expect(result.current.isMetadataLoading).toBe(false);
    expect(result.current.isContentLoading).toBe(false);
  });
});
