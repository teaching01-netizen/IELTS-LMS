import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ObjectiveOverridesPanel } from '../ObjectiveOverridesPanel';

vi.mock('../../../services/examRepository', () => ({
  examRepository: {
    getVersionById: vi.fn(),
  },
}));

vi.mock('../../../services/gradingService', () => ({
  gradingService: {
    getObjectiveOverrides: vi.fn(),
    upsertObjectiveOverride: vi.fn(),
    deleteObjectiveOverride: vi.fn(),
  },
}));

describe('ObjectiveOverridesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads overrides and requires a reason for PUT/DELETE', async () => {
    const { examRepository } = await import('../../../services/examRepository');
    const { gradingService } = await import('../../../services/gradingService');

    (examRepository.getVersionById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      contentSnapshot: {
        reading: {
          passages: [
            {
              id: 'p1',
              title: 'Passage 1',
              blocks: [
                {
                  id: 'b1',
                  type: 'SHORT_ANSWER',
                  instruction: 'Answer',
                  questions: [
                    { id: 'q-reading-1', prompt: 'Keyword?', correctAnswer: 'Top', answerRule: 'ONE_WORD' },
                  ],
                },
              ],
            },
          ],
        },
        listening: { parts: [] },
      },
    });

    (gradingService.getObjectiveOverrides as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [
        {
          scheduleId: 'sched-1',
          questionId: 'q-reading-1',
          overrideJson: { correctAnswer: 'Top', scoringRule: 'ONE_WORD', maxScore: 1 },
          updatedByActorId: 'grader-1',
          updatedByActorName: 'Taylor Grader',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    (gradingService.upsertObjectiveOverride as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { regradeReport: { sectionsUpdated: 1 } },
    });

    (gradingService.deleteObjectiveOverride as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { deleted: true, regradeReport: { sectionsUpdated: 1 } },
    });

    render(<ObjectiveOverridesPanel scheduleId="sched-1" publishedVersionId="ver-1" />);

    fireEvent.click(screen.getByText('Session Settings'));

    await waitFor(() => {
      expect(screen.getByText(/READING • Q1/i)).toBeTruthy();
    });

    expect(screen.queryByText(/q-reading-1/i)).toBeNull();

    fireEvent.click(screen.getByText(/READING • Q1/i));

    fireEvent.click(screen.getByText('Save override + regrade'));
    await waitFor(() => {
      expect(screen.getByText('Reason is required.')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('Why is this override needed?'), {
      target: { value: 'Fix key' },
    });

    fireEvent.click(screen.getByText('Save override + regrade'));
    await waitFor(() => {
      expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledWith(
        'sched-1',
        'q-reading-1',
        expect.objectContaining({ reason: 'Fix key' }),
      );
    });

    fireEvent.click(screen.getByText('Remove override'));
    await waitFor(() => {
      expect(gradingService.deleteObjectiveOverride).toHaveBeenCalledWith(
        'sched-1',
        'q-reading-1',
        expect.objectContaining({ reason: 'Fix key' }),
      );
    });
  });

  it('auto-upgrades scoringRule when answer key variants exceed the selected word limit', async () => {
    const { examRepository } = await import('../../../services/examRepository');
    const { gradingService } = await import('../../../services/gradingService');

    (examRepository.getVersionById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      contentSnapshot: {
        reading: {
          passages: [
            {
              id: 'p1',
              title: 'Passage 1',
              blocks: [
                {
                  id: 'b1',
                  type: 'SHORT_ANSWER',
                  instruction: 'Answer',
                  questions: [
                    { id: 'q-reading-1', prompt: 'Keyword?', correctAnswer: 'crowd | crowd noise', answerRule: 'ONE_WORD' },
                  ],
                },
              ],
            },
          ],
        },
        listening: { parts: [] },
      },
    });

    (gradingService.getObjectiveOverrides as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [],
    });

    (gradingService.upsertObjectiveOverride as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { regradeReport: { sectionsUpdated: 1 } },
    });

    render(<ObjectiveOverridesPanel scheduleId="sched-1" publishedVersionId="ver-1" />);

    fireEvent.click(screen.getByText('Session Settings'));
    await waitFor(() => {
      expect(screen.getByText(/READING • Q1/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/READING • Q1/i));

    fireEvent.change(screen.getByPlaceholderText('e.g. Top (case/whitespace sensitive)'), {
      target: { value: 'crowd | crowd noise' },
    });

    fireEvent.change(screen.getByPlaceholderText('Why is this override needed?'), {
      target: { value: 'Validate key' },
    });

    fireEvent.click(screen.getByText('Save override + regrade'));

    await waitFor(() => {
      expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledWith(
        'sched-1',
        'q-reading-1',
        expect.objectContaining({ scoringRule: 'TWO_WORDS' }),
      );
    });
  });
});
