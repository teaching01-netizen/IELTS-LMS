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

  it('reflects unsaved, saving, and saved statuses across the autosave cycle', async () => {
    let resolveSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    mocks.save.mockImplementationOnce(() => pendingSave);

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    expect(screen.getByTestId('save-status')).toHaveTextContent(/unsaved changes/i);

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('save-status')).toHaveTextContent(/saving/i);

    await act(async () => {
      resolveSave();
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-status')).toHaveTextContent(/all changes saved/i);
    });
  });

  it('blocks review navigation and surfaces a save-failed state when the flush fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Draft has been modified'));

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /finish & review/i }));
    });

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('save-status')).toHaveTextContent(/save failed/i);
    });
    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Save failed');
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not open the student preview when saving fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline'));

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Save failed');
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('flushes the draft before returning to the admin portal', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /admin portal/i }));
    });

    await waitFor(() => {
      expect(mocks.returnToAdmin).toHaveBeenCalledTimes(1);
    });
    expect(mocks.save).toHaveBeenCalled();
    const lastSaved = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0];
    expect(lastSaved).toEqual(expect.objectContaining({ title: 'Edited Mock IELTS Exam' }));
  });

  it('stays in the builder when returning to admin fails to save', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline'));

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /admin portal/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Save failed');
    });
    expect(mocks.returnToAdmin).not.toHaveBeenCalled();
  });

  it('saves via the header save button and shows a saved toast', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
    });

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Saved');
    });
  });

  it('saves through the Save Exam palette command', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Exam' }));
    });

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Saved');
    });
  });

  it('toggles the scoring panel command label', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByRole('button', { name: 'Open Scoring Panel' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Scoring Panel' }));
    });
    expect(screen.queryByTestId('command-palette')).toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByRole('button', { name: 'Hide Scoring Panel' })).toBeInTheDocument();
  });

  it('dispatches the question-block picker event from the palette', async () => {
    const handler = vi.fn();
    window.addEventListener('builder:add-question-block', handler);
    try {
      render(<BuilderRoot />);

      await act(async () => {
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Add Question Block' }));
      });

      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('builder:add-question-block', handler);
    }
  });

  it('opens the command palette with the find shortcut', async () => {
    render(<BuilderRoot />);

    expect(screen.queryByTestId('command-palette')).toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    });

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('dispatches the block picker with the new-block shortcut', () => {
    const handler = vi.fn();
    window.addEventListener('builder:add-question-block', handler);
    try {
      render(<BuilderRoot />);

      fireEvent.keyDown(window, { key: 'n', ctrlKey: true });

      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('builder:add-question-block', handler);
    }
  });

  it('undoes and redoes builder changes from the palette', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-item')).toHaveTextContent('Undo');
    });
    expect(screen.getByTestId('workspace')).not.toHaveTextContent('Edited Mock IELTS Exam');

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('toast-item').map((toast) => toast.textContent)).toContain(
        'Redo',
      );
    });
    expect(screen.getByTestId('workspace')).toHaveTextContent('Edited Mock IELTS Exam');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
  });

  it('ignores undo and redo with an empty history', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    });

    expect(screen.queryAllByTestId('toast-item')).toHaveLength(0);
    expect(screen.getByTestId('workspace')).toHaveTextContent('Mock IELTS Exam');
  });

  it('duplicates the active listening part with the duplicate shortcut', async () => {
    const before = createInitialExamState('Mock IELTS Exam', 'Academic');

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('module-listening'));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    });

    await waitFor(() => {
      const calls = mocks.save.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const last = calls[calls.length - 1]?.[0] as ExamState;
      expect(last.listening.parts).toHaveLength(before.listening.parts.length + 1);
    });

    const last = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0] as ExamState;
    expect(last.listening.parts.at(-1)).toEqual(expect.objectContaining({ title: 'Part 1 Copy' }));
    expect(last.listening.parts.at(-1)?.id).not.toBe('l1');
  });

  it('duplicates the active reading passage with the duplicate shortcut', async () => {
    const before = createInitialExamState('Mock IELTS Exam', 'Academic');

    render(<BuilderRoot />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('module-reading'));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    });

    await waitFor(() => {
      const calls = mocks.save.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const last = calls[calls.length - 1]?.[0] as ExamState;
      expect(last.reading.passages).toHaveLength(before.reading.passages.length + 1);
    });

    const last = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0] as ExamState;
    expect(last.reading.passages.at(-1)).toEqual(
      expect.objectContaining({ title: 'Passage 1 Copy' }),
    );
  });

  it('jumps to a reading passage from the jumpField query param', async () => {
    mocks.location.search = '?jumpField=content.reading.passages[1].blocks[0]';
    render(<BuilderRoot />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: reading');
    });
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalled();
    });
    const last = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0] as ExamState;
    expect(last).toEqual(
      expect.objectContaining({ activeModule: 'reading', activePassageId: 'p2' }),
    );
  });

  it('jumps to a listening part from the short jumpField form', async () => {
    mocks.location.search = '?jumpField=listening.parts[2].blocks[1]';
    render(<BuilderRoot />);

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalled();
    });
    const last = mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[0] as ExamState;
    expect(last).toEqual(
      expect.objectContaining({ activeModule: 'listening', activeListeningPartId: 'l3' }),
    );
  });

  it('ignores an unparsable jumpField query param', async () => {
    mocks.location.search = '?jumpField=not-a-real-field';
    render(<BuilderRoot />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: listening');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('renders expanded when sidebar storage is unavailable', () => {
    const getItem = vi
      .spyOn(window.localStorage, 'getItem')
      .mockImplementationOnce(() => {
        throw new Error('denied');
      });
    try {
      render(<BuilderRoot />);

      expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it('switches the workspace module when other sidebar tabs are clicked', () => {
    render(<BuilderRoot />);

    fireEvent.click(screen.getByTestId('module-speaking'));

    expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: speaking');

    fireEvent.click(screen.getByTestId('module-listening'));

    expect(screen.getByTestId('workspace')).toHaveTextContent('Active module: listening');
  });
});
