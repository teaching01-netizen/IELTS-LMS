import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamEntity } from '../../../../types/domain';
import {
  examKeys,
  useDeleteExamMutation,
  useExamListQuery,
} from '../examQueries';

const mockGetAllExams = vi.fn();
const mockAdaptExams = vi.fn();
const mockDeleteExam = vi.fn();

vi.mock('../../application/examAuthoringFacade', () => ({
  examAuthoringFacade: {
    repository: {
      getAllExamsWithLegacyMigration: (...args: unknown[]) => mockGetAllExams(...args),
    },
    adaptExamEntitiesToLegacyExams: (...args: unknown[]) => mockAdaptExams(...args),
    lifecycle: {
      deleteExam: (...args: unknown[]) => mockDeleteExam(...args),
    },
  },
}));

const examEntity: ExamEntity = {
  id: 'exam-1',
  slug: 'exam-1',
  title: 'Reading practice',
  type: 'Academic',
  status: 'draft',
  visibility: 'private',
  owner: 'Admin',
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  currentDraftVersionId: null,
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
};

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('exam-authoring query boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllExams.mockResolvedValue([examEntity]);
    mockAdaptExams.mockResolvedValue([]);
  });

  it('loads entities and legacy display models from one feature-owned query', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useExamListQuery(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ entities: [examEntity], exams: [] });
    expect(mockGetAllExams).toHaveBeenCalledTimes(1);
    expect(mockAdaptExams).toHaveBeenCalledWith([examEntity], expect.any(Object));
    expect(queryClient.getQueryData(examKeys.list())).toEqual({
      entities: [examEntity],
      exams: [],
    });
  });

  it('invalidates the active list after a successful deletion', async () => {
    const queryClient = createQueryClient();
    mockDeleteExam.mockResolvedValue({ success: true });

    const list = renderHook(() => useExamListQuery(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const deletion = renderHook(() => useDeleteExamMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await deletion.result.current.mutateAsync({ examId: 'exam-1', actor: 'Admin' });
    });

    await waitFor(() => expect(mockGetAllExams).toHaveBeenCalledTimes(2));
    expect(mockDeleteExam).toHaveBeenCalledWith('exam-1', 'Admin');
    expect(queryClient.getQueryState(examKeys.detail('exam-1'))).toBeUndefined();
  });

  it('does not invalidate the list when deletion is rejected', async () => {
    const queryClient = createQueryClient();
    mockDeleteExam.mockResolvedValue({ success: false, error: 'Published exam' });

    const list = renderHook(() => useExamListQuery(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const deletion = renderHook(() => useDeleteExamMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await deletion.result.current.mutateAsync({ examId: 'exam-1', actor: 'Admin' });
    });

    expect(mockGetAllExams).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(examKeys.list())).toEqual({
      entities: [examEntity],
      exams: [],
    });
  });
});
