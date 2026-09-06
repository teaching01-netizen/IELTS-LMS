import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import type { ExamState } from '../../../../types';
import { BuilderRoot } from '../BuilderRoot';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  save: vi.fn(),
  reload: vi.fn(),
  returnToAdmin: vi.fn(),
  location: {
    pathname: '/builder/exam-1',
    search: '',
    hash: '',
    state: null,
    key: 'test',
  },
  controller: {
    error: null as string | null,
    isLoading: false,
    state: null as ExamState | null,
    exam: undefined as unknown,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ examId: 'exam-1' }),
    useLocation: () => mocks.location,
  };
});

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: () => ({
    error: mocks.controller.error,
    exam: mocks.controller.exam,
    isLoading: mocks.controller.isLoading,
    state: mocks.controller.state,
    handleArchive: vi.fn(),
    handleOpenScheduling: vi.fn(),
    handlePublish: vi.fn(),
    handleReturnToAdmin: mocks.returnToAdmin,
    handleSaveDraft: vi.fn(),
    handleSchedulePublish: vi.fn(),
    handleUnpublish: vi.fn(),
    handleUpdateExamContent: mocks.save,
    reload: mocks.reload,
  }),
}));

vi.mock('../../../auth/api/authSession', () => ({
  useOptionalAuthSession: () => null,
}));

vi.mock('@components/Header', () => ({
  Header: ({
    state,
    onUpdateState,
    onReturnToAdmin,
    onNavigateToConfig,
    onNavigateToReview,
    onNavigateToAnswerKey,
    onOpenPreview,
    onSaveDraft,
    saveStatusLabel,
  }: any) => (
    <div>
      <div data-testid="header-title">{state.title}</div>
      <div data-testid="save-status">{saveStatusLabel}</div>
      <button
        type="button"
        onClick={() => {
          onUpdateState((current: any) => ({ ...current, title: 'Edited Mock IELTS Exam' }));
        }}
      >
        Edit Draft
      </button>
      <button
        type="button"
        onClick={() => {
          void onNavigateToConfig();
        }}
      >
        Back to Config
      </button>
      <button
        type="button"
        onClick={() => {
          void onNavigateToReview();
        }}
      >
        Finish & Review
      </button>
      <button
        type="button"
        onClick={() => {
          void onNavigateToAnswerKey();
        }}
      >
        Answer Key
      </button>
      <button
        type="button"
        onClick={() => {
          void onOpenPreview();
        }}
      >
        Preview
      </button>
      <button
        type="button"
        onClick={() => {
          void onSaveDraft();
        }}
      >
        Save draft
      </button>
      <button
        type="button"
        onClick={() => {
          void onReturnToAdmin();
        }}
      >
        Admin Portal
      </button>
    </div>
  ),
}));

vi.mock('@components/Sidebar', () => ({
  Sidebar: ({ state, setState }: any) => (
    <nav aria-label="Builder modules">
      {(['listening', 'reading', 'writing', 'speaking'] as const)
        .filter((moduleId) => state.config.sections[moduleId]?.enabled)
        .map((moduleId) => (
          <button
            key={moduleId}
            type="button"
            data-testid={`module-${moduleId}`}
            aria-current={state.activeModule === moduleId ? 'page' : undefined}
            onClick={() => {
              void setState({ ...state, activeModule: moduleId });
            }}
          >
            {state.config.sections[moduleId].label}
          </button>
        ))}
    </nav>
  ),
}));

vi.mock('@components/Workspace', () => ({
  Workspace: ({ state }: any) => (
    <div data-testid="workspace">
      Active module: {state.activeModule} | {state.title}
    </div>
  ),
}));

vi.mock('@components/CommandPalette', () => ({
  CommandPalette: ({ commands, isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="command-palette">
        {commands.map((command: any) => (
          <button
            key={command.id}
            type="button"
            onClick={() => {
              command.perform();
              onClose();
            }}
          >
            {command.title}
          </button>
        ))}
      </div>
    ) : null,
}));

vi.mock('@components/GlobalToast', () => ({
  GlobalToast: ({ toasts }: any) => (
    <div>
      {toasts.map((toast: any) => (
        <div key={toast.id} data-testid="toast-item">
          {toast.title}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@components/scoring/BandScoreMatrix', () => ({
  BandScoreMatrix: () => null,
}));

vi.mock('@components/scoring/GradingWorkspace', () => ({
  GradingWorkspace: () => null,
}));

describe('BuilderRoot', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue(undefined);
    mocks.controller.error = null;
    mocks.controller.isLoading = false;
    mocks.controller.state = createInitialExamState('Mock IELTS Exam', 'Academic');
    mocks.controller.exam = {
      id: 'exam-1',
      title: 'Mock IELTS Exam',
      status: 'draft',
    };
    mocks.location.search = '';
    window.localStorage.clear();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('renders the key builder sections when the exam loads', () => {
    render(<BuilderRoot />);

    expect(screen.getByTestId('header-title')).toHaveTextContent('Mock IELTS Exam');
    expect(screen.getByRole('navigation', { name: /builder modules/i })).toBeInTheDocument();
    expect(screen.getByTestId('workspace')).toHaveTextContent('Mock IELTS Exam');
    expect(screen.getByTestId('save-status')).toHaveTextContent(/all changes saved/i);
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish & review/i })).toBeInTheDocument();
  });

  it('renders a loading state while the exam loads', () => {
    mocks.controller.isLoading = true;
    mocks.controller.state = null;
    mocks.controller.exam = undefined;

    render(<BuilderRoot />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading Exam...')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('renders an error surface with retry when loading fails', async () => {
    mocks.controller.error = 'Failed to load exam';
    mocks.controller.isLoading = false;
    mocks.controller.state = null;
    mocks.controller.exam = undefined;

    render(<BuilderRoot />);

    expect(screen.getByRole('heading', { name: /loading error/i })).toBeInTheDocument();
    expect(screen.getByText('Failed to load exam')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    });

    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it('renders the not-found empty state when the exam is missing', async () => {
    mocks.controller.state = null;
    mocks.controller.exam = undefined;

    render(<BuilderRoot />);

    expect(screen.getByRole('heading', { name: /exam not found/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /return to admin/i }));
    });

    expect(mocks.returnToAdmin).toHaveBeenCalledTimes(1);
  });

  it('switches the workspace module when a sidebar tab is clicked', () => {
    render(<BuilderRoot />);

    fireEvent.click(screen.getByTestId('module-writing'));

    expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: writing');
    expect(screen.getByTestId('module-writing')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the command palette and runs a module navigation command', async () => {
    render(<BuilderRoot />);

    expect(screen.queryByTestId('command-palette')).toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Writing' }));
    });

    expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: writing');
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('flushes the latest draft before navigating to review', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /finish & review/i }));
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/builder/exam-1/review');
    });
    expect(mocks.save).toHaveBeenCalled();
    const lastSaved = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0];
    expect(lastSaved).toEqual(expect.objectContaining({ title: 'Edited Mock IELTS Exam' }));
  });

  it('flushes the latest draft before returning to config', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back to config/i }));
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/builder/exam-1');
    });
    expect(mocks.save).toHaveBeenCalled();
  });

  it('flushes the latest draft before opening the answer key', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Answer Key' }));
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/builder/exam-1/answer-key');
    });
    expect(mocks.save).toHaveBeenCalled();
  });

  it('opens the student preview in a new tab after saving', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    });

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/builder/exam-1/preview'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('saves the draft with a keyboard shortcut and shows a saved toast', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Saved');
    });
  });

  it('collapses and expands the sidebar, persisting the preference', () => {
    render(<BuilderRoot />);

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));

    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
    expect(window.localStorage.getItem('builder-sidebar-collapsed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /expand sidebar/i }));

    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument();
    expect(window.localStorage.getItem('builder-sidebar-collapsed')).toBe('false');
  });

  it('shows a recovery screen when no builder modules are enabled', () => {
    const state = createInitialExamState('Mock IELTS Exam', 'Academic');
    state.config.sections.listening.enabled = false;
    state.config.sections.reading.enabled = false;
    state.config.sections.writing.enabled = false;
    state.config.sections.speaking.enabled = false;
    mocks.controller.state = state;

    render(<BuilderRoot />);

    expect(
      screen.getByRole('heading', { name: /builder configuration unavailable/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no builder modules are enabled/i)).toBeInTheDocument();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });
});
