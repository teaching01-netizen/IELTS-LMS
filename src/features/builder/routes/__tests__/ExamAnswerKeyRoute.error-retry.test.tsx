import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamAnswerKeyRoute } from '../ExamAnswerKeyRoute';

const mockNavigate = vi.fn();
const mockReload = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ examId: 'exam-1' }),
}));

const errorController = {
  error: 'Backend exploded',
  isLoading: false,
  state: null,
  reload: mockReload,
};

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: () => errorController,
}));

vi.mock('@components/Header', () => ({
  Header: () => <div data-testid="header" />,
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

describe('ExamAnswerKeyRoute error retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReload.mockClear().mockResolvedValue(undefined);
  });

  it('offers a retry action when loading the answer key fails', () => {
    render(<ExamAnswerKeyRoute />);

    expect(screen.getByText('Backend exploded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockReload).toHaveBeenCalled();
  });
});