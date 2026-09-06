import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderRoot } from '../BuilderRoot';

const mockNavigate = vi.fn();
const mockHandleReturnToAdmin = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ examId: 'missing-exam' }),
  useLocation: () => ({
    pathname: '/builder/missing-exam',
    search: '',
    hash: '',
    state: null,
    key: 'test',
  }),
}));

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: () => ({
    error: null,
    exam: undefined,
    isLoading: false,
    state: null,
    handleArchive: vi.fn(),
    handleOpenScheduling: vi.fn(),
    handlePublish: vi.fn(),
    handleReturnToAdmin: mockHandleReturnToAdmin,
    handleSaveDraft: vi.fn(),
    handleSchedulePublish: vi.fn(),
    handleUnpublish: vi.fn(),
    handleUpdateExamContent: vi.fn(),
    reload: vi.fn(),
  }),
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

vi.mock('@components/Sidebar', () => ({
  Sidebar: () => null,
}));

vi.mock('@components/Header', () => ({
  Header: () => null,
}));

vi.mock('@components/Workspace', () => ({
  Workspace: () => null,
}));

vi.mock('@components/CommandPalette', () => ({
  CommandPalette: () => null,
}));

vi.mock('@components/GlobalToast', () => ({
  GlobalToast: () => null,
}));

vi.mock('@components/scoring/BandScoreMatrix', () => ({
  BandScoreMatrix: () => null,
}));

vi.mock('@components/scoring/GradingWorkspace', () => ({
  GradingWorkspace: () => null,
}));

describe('BuilderRoot missing exam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Exam Not Found surface instead of an endless retry', () => {
    render(<BuilderRoot />);

    expect(screen.getByText('Exam Not Found')).toBeTruthy();
    expect(screen.queryByText('Loading Error')).toBeNull();
  });

  it('returns to admin when the exam does not exist', () => {
    render(<BuilderRoot />);

    fireEvent.click(screen.getByRole('button', { name: /return to admin/i }));
    expect(mockHandleReturnToAdmin).toHaveBeenCalled();
  });
});