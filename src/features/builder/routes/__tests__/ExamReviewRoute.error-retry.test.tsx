import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamReviewRoute } from '../ExamReviewRoute';

const mockNavigate = vi.fn();
const mockReload = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ examId: 'exam-1' }),
  useLocation: () => ({ pathname: '/builder/exam-1/review', search: '', hash: '', state: null, key: 'test' }),
}));

const errorController = {
  error: 'Review exploded',
  isLoading: false,
  exam: undefined,
  state: null,
  versions: [],
  schedules: [],
  publishReadiness: undefined,
  handlePublish: vi.fn(),
  handleRepublishLatestDraft: vi.fn(),
  handleSchedulePublish: vi.fn(),
  handleUnpublish: vi.fn(),
  handleRestoreVersion: vi.fn(),
  handleNavigateToBuilder: vi.fn(),
  handleOpenScheduling: vi.fn(),
  loadScheduleContent: vi.fn(),
  handleCreateSchedule: vi.fn(),
  handleBackToAdmin: vi.fn(),
  reload: mockReload,
};

vi.mock('@builder/hooks/useReviewRouteController', () => ({
  useReviewRouteController: () => errorController,
}));

vi.mock('@components/ui', () => ({
  ErrorSurface: (props: {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <div data-testid="error-surface">
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.actionLabel && props.onAction ? (
        <button type="button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  ),
  LoadingSurface: (props: { label: string }) => <div>{props.label}</div>,
}));

vi.mock('@components/admin/ScheduleSessionModal', () => ({
  ScheduleSessionModal: () => null,
}));

vi.mock('@components/admin/ExamVersionHistory', () => ({
  ExamVersionHistory: () => null,
}));

describe('ExamReviewRoute error retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReload.mockClear().mockResolvedValue(undefined);
  });

  it('offers a retry action when loading the review fails', () => {
    render(<ExamReviewRoute />);

    expect(screen.getByText('Review exploded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockReload).toHaveBeenCalled();
  });
});