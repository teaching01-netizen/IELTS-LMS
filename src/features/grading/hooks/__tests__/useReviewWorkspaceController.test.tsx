import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/gradingRepository', () => ({
  gradingRepository: {
    getSubmissionById: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
    getWritingSubmissionsBySubmissionId: vi.fn(),
    getReviewDraftBySubmission: vi.fn(),
    invalidateSubmissionBundle: vi.fn(),
  },
  getReviewDraftRevision: vi.fn(),
}));

vi.mock('../../../../services/examRepository', () => ({
  examRepository: { getVersionById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../../../services/gradingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/gradingService')>();
  return {
    gradingErrorMessage: actual.gradingErrorMessage,
    gradingService: {
      startReview: vi.fn(),
      saveReviewDraft: vi.fn(),
      markGradingComplete: vi.fn(),
      markReadyToRelease: vi.fn(),
      releaseResult: vi.fn(),
      scheduleRelease: vi.fn(),
      reopenReview: vi.fn(),
      overrideObjectiveQuestion: vi.fn(),
    },
  };
});

import { gradingRepository } from '../../../../services/gradingRepository';
import { gradingService } from '../../../../services/gradingService';
import { useReviewWorkspaceController } from '../useReviewWorkspaceController';

const repo = vi.mocked(gradingRepository);
const service = vi.mocked(gradingService);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function submission(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    submissionId: id,
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId: `stu-${id}`,
    studentName: `Student ${id}`,
    cohortName: 'Cohort',
    submittedAt: '2026-10-11T04:50:00.000Z',
    timeSpentSeconds: 0,
    gradingStatus: 'in_progress',
    isFlagged: false,
    isOverdue: false,
    sectionStatuses: {},
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function draft(submissionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `draft-${submissionId}`,
    submissionId,
    studentId: `stu-${submissionId}`,
    teacherId: 't-1',
    releaseStatus: 'draft',
    sectionDrafts: {},
    annotations: [],
    drawings: [],
    checklist: {},
    hasUnsavedChanges: false,
    revision: 3,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function seed() {
  repo.getSubmissionById.mockImplementation(async (id: string) => submission(id) as never);
  repo.getReviewDraftBySubmission.mockImplementation(async (id: string) => draft(id) as never);
  repo.getSectionSubmissionsBySubmissionId.mockResolvedValue([]);
  repo.getWritingSubmissionsBySubmissionId.mockResolvedValue([]);
}

function setup(initialSubmission = 'sub-a', strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => {
    const provided = <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{provided}</StrictMode> : provided;
  };
  return renderHook(
    ({ submissionId }) => useReviewWorkspaceController({ submissionId, teacherId: 't-1', teacherName: 'Teacher' }),
    { wrapper, initialProps: { submissionId: initialSubmission } },
  );
}

const feedback = (value: string) => (current: { overallFeedback?: string }) => ({ ...current, overallFeedback: value });

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('useReviewWorkspaceController', () => {
  it('starts every independent read at once', async () => {
    const hold = deferred<never>();
    repo.getSubmissionById.mockReturnValue(hold.promise);
    repo.getReviewDraftBySubmission.mockReturnValue(hold.promise);
    repo.getSectionSubmissionsBySubmissionId.mockReturnValue(hold.promise);
    repo.getWritingSubmissionsBySubmissionId.mockReturnValue(hold.promise);
    setup();
    await waitFor(() => {
      expect(repo.getSubmissionById).toHaveBeenCalledTimes(1);
      expect(repo.getReviewDraftBySubmission).toHaveBeenCalledTimes(1);
      expect(repo.getSectionSubmissionsBySubmissionId).toHaveBeenCalledTimes(1);
      expect(repo.getWritingSubmissionsBySubmissionId).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps a partial answer failure local to that resource', async () => {
    repo.getWritingSubmissionsBySubmissionId.mockRejectedValue(new Error('writing offline'));
    repo.getSectionSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'sec-1', submissionId: 'sub-a', section: 'reading', gradingStatus: 'auto_graded', answers: { type: 'reading', answers: [] } } as never,
    ]);
    const { result } = setup();
    await waitFor(() => expect(result.current.writingError).toBe('writing offline'));
    expect(result.current.sectionSubmissions).toHaveLength(1);
    expect(result.current.sectionsError).toBeNull();
    expect(result.current.reviewDraft?.submissionId).toBe('sub-a');
  });

  it('rejects an answer payload that belongs to another submission', async () => {
    repo.getSectionSubmissionsBySubmissionId.mockResolvedValue([
      { id: 'sec-9', submissionId: 'sub-z', section: 'reading', gradingStatus: 'auto_graded' } as never,
    ]);
    const { result } = setup();
    await waitFor(() => expect(result.current.sectionsError).toMatch(/different submission/));
    expect(result.current.sectionSubmissions).toEqual([]);
  });

  it('a slow draft for A never becomes B after switching', async () => {
    const slowA = deferred<unknown>();
    repo.getReviewDraftBySubmission.mockImplementation((id: string) =>
      (id === 'sub-a' ? slowA.promise : Promise.resolve(draft(id, { overallFeedback: 'b' }))) as never);
    const view = setup('sub-a');
    view.rerender({ submissionId: 'sub-b' });
    await waitFor(() => expect(view.result.current.reviewDraft?.overallFeedback).toBe('b'));
    await act(async () => {
      slowA.resolve(draft('sub-a', { overallFeedback: 'a' }));
    });
    expect(view.result.current.reviewDraft).toMatchObject({ submissionId: 'sub-b', overallFeedback: 'b' });
  });

  it('initializes a missing review once, even under Strict Mode', async () => {
    repo.getSubmissionById.mockResolvedValue(submission('sub-a', { gradingStatus: 'submitted' }) as never);
    repo.getReviewDraftBySubmission.mockResolvedValue(null);
    service.startReview.mockResolvedValue({ success: true, data: draft('sub-a') } as never);
    const { result } = setup('sub-a', true);
    await waitFor(() => expect(result.current.reviewDraft?.submissionId).toBe('sub-a'));
    expect(service.startReview).toHaveBeenCalledTimes(1);
    expect(service.startReview).toHaveBeenCalledWith('sub-a', 't-1', 'Teacher');
  });

  it('a two-grader conflict keeps local edits and their original base revision', async () => {
    service.saveReviewDraft.mockResolvedValue({ success: false, error: { code: 'CONFLICT', message: 'Draft changed by another grader' } } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.reviewDraft).not.toBeNull());
    act(() => result.current.editDraft(feedback('mine') as never));
    await act(async () => {
      expect(await result.current.saveDraft()).toBe(false);
    });
    expect(result.current.reviewDraft).toMatchObject({ overallFeedback: 'mine', hasUnsavedChanges: true, revision: 3 });

    await act(async () => {
      await result.current.saveDraft();
    });
    expect(service.saveReviewDraft).toHaveBeenLastCalledWith(expect.objectContaining({ overallFeedback: 'mine', revision: 3 }), 't-1', 'Teacher');
  });

  it('releases only after persisting the current draft', async () => {
    service.saveReviewDraft.mockImplementation(async (saved: unknown) => ({ success: true, data: { ...(saved as object), revision: 4 } }) as never);
    service.releaseResult.mockResolvedValue({ success: true, data: {} } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.reviewDraft).not.toBeNull());
    act(() => result.current.editDraft(feedback('final words') as never));

    await act(async () => {
      expect(await result.current.releaseNow()).toBe('released');
    });
    expect(service.saveReviewDraft.mock.invocationCallOrder[0]).toBeLessThan(service.releaseResult.mock.invocationCallOrder[0]!);
    expect(service.saveReviewDraft).toHaveBeenCalledWith(expect.objectContaining({ overallFeedback: 'final words' }), 't-1', 'Teacher');
  });

  it('does not release when the current draft cannot be saved, and keeps the edits', async () => {
    service.saveReviewDraft.mockResolvedValue({ success: false, error: 'offline' } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.reviewDraft).not.toBeNull());
    act(() => result.current.editDraft(feedback('unsaved') as never));

    await act(async () => {
      expect(await result.current.releaseNow()).toBe('failed');
    });
    expect(service.releaseResult).not.toHaveBeenCalled();
    expect(result.current.releaseError).toMatch(/could not be saved/);
    expect(result.current.reviewDraft).toMatchObject({ overallFeedback: 'unsaved', hasUnsavedChanges: true });
  });

  it('a release rejection is reported and never treated as released', async () => {
    service.releaseResult.mockResolvedValue({ success: false, error: 'Release window closed' } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.reviewDraft).not.toBeNull());
    await act(async () => {
      expect(await result.current.releaseNow()).toBe('failed');
    });
    expect(result.current.releaseError).toBe('Release window closed');
    expect(result.current.releaseAction).toBeNull();
  });

  it('asks for explicit confirmation when the server requires a release override', async () => {
    service.releaseResult
      .mockResolvedValueOnce({ success: false, error: 'Explicit grader override confirmation is required' } as never)
      .mockResolvedValueOnce({ success: true, data: {} } as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.reviewDraft).not.toBeNull());
    await act(async () => {
      expect(await result.current.releaseNow()).toBe('override_required');
    });
    expect(result.current.releaseError).toBeNull();
    await act(async () => {
      expect(await result.current.releaseNow(true)).toBe('released');
    });
    expect(service.releaseResult).toHaveBeenLastCalledWith('sub-a', 't-1', 'Teacher', true);
  });

  it('a workflow answer for A after switching never shows on B', async () => {
    const complete = deferred<unknown>();
    service.markGradingComplete.mockReturnValue(complete.promise as never);
    const view = setup('sub-a');
    await waitFor(() => expect(view.result.current.reviewDraft).not.toBeNull());
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.markGradingComplete();
    });
    view.rerender({ submissionId: 'sub-b' });
    await waitFor(() => expect(view.result.current.reviewDraft?.submissionId).toBe('sub-b'));
    await act(async () => {
      complete.resolve({ success: false, error: 'A failed' });
      await pending;
    });
    expect(view.result.current.releaseError).toBeNull();
    expect(view.result.current.reviewDraft?.releaseStatus).toBe('draft');
  });
});
