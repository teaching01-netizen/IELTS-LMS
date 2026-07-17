import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { ExamAnswerKeyRoute } from '../ExamAnswerKeyRoute';

const mockNavigate = vi.fn();
const mockController = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ examId: 'exam-1' }),
  };
});

vi.mock('@components/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@components/ui', () => ({
  ErrorSurface: (props: { title: string; description: string }) => (
    <div data-testid="error-surface">
      {props.title} {props.description}
    </div>
  ),
  LoadingSurface: (props: { label: string }) => <div data-testid="loading-surface">{props.label}</div>,
}));

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: (...args: unknown[]) => mockController(...args),
}));

describe('ExamAnswerKeyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps hook order stable when loading state resolves', async () => {
    const state = createInitialExamState('Answer key exam', 'Academic');
    let isLoaded = false;

    const loadedController = {
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'Answer key exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
      state,
      handleUpdateExamContent: vi.fn().mockResolvedValue(undefined),
    };

    mockController.mockImplementation(() =>
      isLoaded
        ? loadedController
        : {
            ...loadedController,
            isLoading: true,
            state: null,
          },
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<ExamAnswerKeyRoute />);

    isLoaded = true;

    expect(() => rerender(<ExamAnswerKeyRoute />)).not.toThrow();
    await waitFor(() => {
      expect(screen.queryByTestId('loading-surface')).not.toBeInTheDocument();
    });

    consoleErrorSpy.mockRestore();
  });

  it('uses the latest controller save handler after loading completes', async () => {
    const state = createInitialExamState('Answer key exam', 'Academic');
    let isLoaded = false;

    const staleHandleUpdate = vi.fn().mockResolvedValue(undefined);
    const latestHandleUpdate = vi.fn().mockResolvedValue(undefined);

    const baseController = {
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'Answer key exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
    };

    mockController.mockImplementation(() =>
      isLoaded
        ? {
            ...baseController,
            isLoading: false,
            state,
            handleUpdateExamContent: latestHandleUpdate,
          }
        : {
            ...baseController,
            isLoading: true,
            state: null,
            handleUpdateExamContent: staleHandleUpdate,
          },
    );

    const { rerender } = render(<ExamAnswerKeyRoute />);
    isLoaded = true;
    rerender(<ExamAnswerKeyRoute />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-surface')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /back to builder/i }));

    await waitFor(() => {
      expect(latestHandleUpdate).toHaveBeenCalledTimes(1);
    });
    expect(staleHandleUpdate).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/builder/exam-1/builder');
    });
  });

  it('does not disguise an invalid matching-feature answer as the first option', () => {
    const state = createInitialExamState('Answer key exam', 'Academic');
    state.reading.passages[0]!.blocks = [{
      id: 'matching-features-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['A', 'B', 'C'],
      features: [{
        id: 'feature-18',
        text: 'toys',
        correctMatch: 'A. They are provided in all tents.',
      }],
    }];

    mockController.mockReturnValue({
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'Answer key exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
      state,
      handleUpdateExamContent: vi.fn().mockResolvedValue(undefined),
    });

    render(<ExamAnswerKeyRoute />);

    const invalidOption = screen.getByRole('option', {
      name: 'Invalid saved answer: A. They are provided in all tents.',
    });
    expect((invalidOption as HTMLOptionElement).selected).toBe(true);
  });
});
