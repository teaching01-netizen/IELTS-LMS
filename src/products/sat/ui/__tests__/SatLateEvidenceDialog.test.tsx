import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatLateEvidenceDialog } from '../SatLateEvidenceDialog';

const api = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }));
vi.mock('../../api/lateEvidence', () => ({
  listSatLateEvidence: api.list,
  reviewSatLateEvidence: api.review,
}));

const row = {
  id: 'e1',
  sequence: '1',
  moduleId: 'module-1',
  questionId: 'question-1',
  writeId: 'write-1',
  response: { answer: 'A', markedForReview: false, eliminatedOptions: [], annotations: [] },
  clientMetadata: null,
  serverReceivedAt: '2026-10-31T08:11:00.486Z',
  wouldChangeRoute: true,
  provenanceConflict: false,
  alreadyScored: true,
  reviewedAt: null,
  reviewedBy: null,
  reviewOutcome: null,
  reviewNote: null,
};

describe('SatLateEvidenceDialog', () => {
  beforeEach(() => {
    api.list.mockReset();
    api.review.mockReset();
  });

  it('shows the answer and the duplicate/route flags', async () => {
    api.list.mockResolvedValue({ rows: [row], nextCursor: '1', hasMore: false });
    render(
      <SatLateEvidenceDialog scheduleId="s1" attemptId="a1" studentName="Ada" open onClose={() => undefined} />,
    );

    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('Already scored')).toBeInTheDocument();
    expect(screen.getByText('Would change route')).toBeInTheDocument();
    expect(screen.getByText(/never change Module 2 routing/)).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith('s1', 'a1', '');
  });

  it('records an acknowledged disposition and reflects it in the row', async () => {
    api.list.mockResolvedValue({ rows: [row], nextCursor: '1', hasMore: false });
    api.review.mockResolvedValue(undefined);
    render(
      <SatLateEvidenceDialog scheduleId="s1" attemptId="a1" studentName="Ada" open onClose={() => undefined} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(api.review).toHaveBeenCalledWith(
      's1',
      'a1',
      expect.objectContaining({ evidenceIds: ['e1'], outcome: 'acknowledged' }),
    ));
    expect(await screen.findByText('acknowledged')).toBeInTheDocument();
  });

  it('surfaces an empty state without inventing evidence', async () => {
    api.list.mockResolvedValue({ rows: [], nextCursor: '', hasMore: false });
    render(
      <SatLateEvidenceDialog scheduleId="s1" attemptId="a1" studentName="Ada" open onClose={() => undefined} />,
    );
    expect(await screen.findByText('No late answers were recorded for this attempt.')).toBeInTheDocument();
  });
});
