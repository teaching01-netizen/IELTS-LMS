import { afterEach, describe, expect, it, vi } from 'vitest';
import { gradingService } from '../gradingService';
import { backendGet, isBackendGradingEnabled } from '../backendBridge';

vi.mock('../backendBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backendBridge')>();
  return { ...actual, backendGet: vi.fn(), isBackendGradingEnabled: vi.fn() };
});

afterEach(() => {
  vi.mocked(backendGet).mockReset();
  vi.mocked(isBackendGradingEnabled).mockReset();
});

describe('Phase 03 ACT reconciliation: gradingService', () => {
  it('loads ACT Science reports from the Go results endpoint', async () => {
    vi.mocked(isBackendGradingEnabled).mockReturnValue(true);
    vi.mocked(backendGet).mockResolvedValue([
      {
        attemptId: 'attempt-1',
        scheduleId: 'sched-1',
        studentId: 'stu-1',
        studentName: 'Alice',
        totalScore: 30,
        maxScore: 40,
        percentage: 75,
        releaseStatus: 'ready_to_release',
      },
    ]);
    const result = await gradingService.getActScienceReports();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    // Phase 05 residual (a): the payload must decode as the Go-canonical
    // ScienceReport row (attemptId/totalScore/maxScore/percentage), never
    // the legacy submissionId/score.correctCount shape.
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({ attemptId: 'attempt-1', totalScore: 30, maxScore: 40 }),
    );
    expect(backendGet).toHaveBeenCalledWith('/v1/results/act-science');
  });

  it('requires backend grading for ACT Science reports', async () => {
    vi.mocked(isBackendGradingEnabled).mockReturnValue(false);
    const result = await gradingService.getActScienceReports();
    expect(result.success).toBe(false);
    expect(backendGet).not.toHaveBeenCalled();
  });
});
