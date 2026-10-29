import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../types';
import { StudentExamPhaseRenderer } from '../StudentExamPhaseRenderer';

const mocks = vi.hoisted(() => ({
  recordPreCheckResult: vi.fn(),
  setPhase: vi.fn(),
  live: { current: { runtimeBacked: true, runtimeStatus: 'not_started' as string } },
}));

vi.mock('../providers/StudentAttemptProvider', () => ({
  useStudentAttempt: () => ({ state: { attempt: null }, actions: { recordPreCheckResult: mocks.recordPreCheckResult } }),
}));
vi.mock('../providers/StudentRuntimeProvider', () => ({
  useStudentRuntimeSession: () => ({ state: mocks.live.current, actions: { setPhase: mocks.setPhase } }),
  useStudentRuntimeLiveRef: () => mocks.live,
}));
vi.mock('../PreCheck', () => ({
  PreCheck: ({ onComplete }: { onComplete: (result: unknown) => Promise<void> }) => (
    <button onClick={() => void onComplete({ completedAt: '2026-10-29T08:00:00Z' })}>Finish checks</button>
  ),
}));
vi.mock('../Lobby', () => ({ Lobby: () => <div>Waiting for start</div> }));
vi.mock('../StudentPostExamView', () => ({ StudentPostExamView: () => null }));

function renderPreCheck() {
  return render(
    <StudentExamPhaseRenderer
      phase="pre-check"
      shouldRenderPostExam={false}
      examState={{ config: {} } as ExamState}
      allowPreviewStart={false}
      shellStyle={{}}
      verifiedTerminalState="not_terminal"
      finalSubmitOverlay={null}
      onExit={vi.fn()}
    />,
  );
}

describe('StudentExamPhaseRenderer pre-check completion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.recordPreCheckResult.mockResolvedValue(undefined);
    mocks.live.current = { runtimeBacked: true, runtimeStatus: 'not_started' };
  });

  it.each(['live', 'paused'])('enters the exam after late pre-check completion when runtime is %s', async (status) => {
    mocks.live.current.runtimeStatus = status;
    renderPreCheck();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finish checks' })));
    expect(mocks.setPhase).toHaveBeenCalledWith('exam');
  });

  it('uses the latest runtime if the proctor starts while pre-check is saving', async () => {
    let finishSave!: () => void;
    mocks.recordPreCheckResult.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve; }));
    renderPreCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Finish checks' }));
    expect(mocks.setPhase).not.toHaveBeenCalled();
    mocks.live.current = { runtimeBacked: true, runtimeStatus: 'live' };
    await act(async () => finishSave());
    expect(mocks.setPhase).toHaveBeenCalledWith('exam');
  });

  it('keeps early arrivals in the lobby until the proctor starts', async () => {
    renderPreCheck();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finish checks' })));
    expect(mocks.setPhase).toHaveBeenCalledWith('lobby');
  });

  it('keeps preview delivery in the lobby', async () => {
    mocks.live.current = { runtimeBacked: false, runtimeStatus: 'live' };
    renderPreCheck();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finish checks' })));
    expect(mocks.setPhase).toHaveBeenCalledWith('lobby');
  });

  it('does not enter the exam if saving pre-check fails', async () => {
    mocks.live.current.runtimeStatus = 'live';
    mocks.recordPreCheckResult.mockRejectedValue(new Error('Could not save pre-check'));
    renderPreCheck();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finish checks' })));
    expect(mocks.setPhase).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save pre-check');
  });
});
