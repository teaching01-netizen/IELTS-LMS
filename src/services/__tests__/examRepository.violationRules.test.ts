import { describe, expect, it, vi } from 'vitest';

const { get, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../backendBridge', async () => {
  const actual = await vi.importActual<typeof import('../backendBridge')>('../backendBridge');
  return { ...actual, backendGet: get, backendPatch: patch, backendDelete: del };
});
import { BackendExamRepository } from '../examRepository';

describe('BackendExamRepository violation-rule contract', () => {
  it('persists notes and violation rules through the backend API', async () => {
    const repository = new BackendExamRepository();

    get.mockResolvedValueOnce([
      {
        id: 'rule-1',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 1,
        action: 'warn',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'Admin',
      },
    ]);
    await expect(repository.getViolationRulesByScheduleId('sched-1')).resolves.toMatchObject([
      { id: 'rule-1', scheduleId: 'sched-1', action: 'warn' },
    ]);

    await repository.saveViolationRule({
      id: 'rule-1',
      scheduleId: 'sched-1',
      triggerType: 'violation_count',
      threshold: 1,
      action: 'warn',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'Admin',
    });
    expect(patch).toHaveBeenCalledWith('/v1/proctor/sessions/sched-1/violation-rules/rule-1', expect.any(Object));

    await repository.deleteViolationRule('rule-1');
    expect(del).toHaveBeenCalledWith('/v1/proctor/violation-rules/rule-1');

    await repository.saveSessionNote({
      id: 'note-1',
      scheduleId: 'sched-1',
      author: 'Admin',
      timestamp: '2026-01-01T00:00:00.000Z',
      content: 'handover',
      category: 'handover',
      isResolved: false,
    });
    expect(patch).toHaveBeenCalledWith('/v1/proctor/sessions/sched-1/notes/note-1', expect.any(Object));
    await repository.deleteSessionNote('note-1');
    expect(del).toHaveBeenCalledWith('/v1/proctor/notes/note-1');
  });
});
