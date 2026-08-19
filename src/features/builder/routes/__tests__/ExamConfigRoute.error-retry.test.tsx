import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamConfigRoute } from '../ExamConfigRoute';

const mockNavigate = vi.fn();
const mockReload = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ examId: 'exam-1' }),
}));

const errorController = {
  error: 'Config exploded',
  isLoading: false,
  config: undefined,
  exam: undefined,
  isSaving: false,
  handleUpdateConfig: vi.fn(),
  handleSaveConfig: vi.fn(),
  handleNavigateToBuilder: vi.fn(),
  handleCancel: vi.fn(),
  reload: mockReload,
};

vi.mock('@builder/hooks/useConfigRouteController', () => ({
  useConfigRouteController: () => errorController,
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

vi.mock('../components/ExamConfigTabs', () => ({
  ExamConfigTabs: () => null,
}));

describe('ExamConfigRoute error retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReload.mockClear().mockResolvedValue(undefined);
  });

  it('offers a retry action when loading the config fails', () => {
    render(<ExamConfigRoute />);

    expect(screen.getByText('Config exploded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockReload).toHaveBeenCalled();
  });
});