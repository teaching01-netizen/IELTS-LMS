import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { BuilderRoot } from '../BuilderRoot';

const mockNavigate = vi.fn();
const mockHandleUpdateExamContent = vi.fn().mockResolvedValue(undefined);
const createControllerState = () => createInitialExamState('Mock IELTS Exam', 'Academic');
let controllerState = createControllerState();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ examId: 'exam-1' }),
  };
});

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: () => ({
    error: null,
    exam: {
      id: 'exam-1',
      title: controllerState.title,
      owner: 'owner-1',
      type: controllerState.type,
      status: 'draft',
      visibility: 'organization',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: 'ver-1',
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: 1,
    },
    isLoading: false,
    publishReadiness: { canPublish: true, errors: [], warnings: [], missingFields: [], questionCounts: { reading: 0, listening: 0, total: 0 } },
    state: controllerState,
    versions: [],
    handleArchive: vi.fn(),
    handleOpenScheduling: vi.fn(),
    handlePublish: vi.fn(),
    handleReturnToAdmin: vi.fn(),
    handleSaveDraft: vi.fn(),
    handleSchedulePublish: vi.fn(),
    handleUnpublish: vi.fn(),
    handleUpdateExamContent: mockHandleUpdateExamContent,
    reload: vi.fn(),
  }),
}));

vi.mock('@components/Sidebar', () => ({
  Sidebar: () => null,
}));

vi.mock('@components/Header', () => ({
  Header: ({ onNavigateToConfig, onNavigateToReview, onReturnToAdmin, onUpdateState, state }: any) => (
    <div>
      <div data-testid="header-title">{state.title}</div>
      <button
        type="button"
        onClick={() => {
          onUpdateState((current: typeof state) => ({
            ...current,
            title: 'Edited Mock IELTS Exam',
            config: {
              ...current.config,
              general: {
                ...current.config.general,
                title: 'Edited Mock IELTS Exam',
              },
            },
          }));
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
          void onReturnToAdmin();
        }}
      >
        Admin Portal
      </button>
      <button
        type="button"
        onClick={() => {
          void onNavigateToReview();
        }}
      >
        Finish & Review
      </button>
    </div>
  ),
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

describe('BuilderRoot review navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerState = createControllerState();
  });

  it('flushes the latest draft before navigating to review', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /finish & review/i }));
    });

    await waitFor(() => {
      expect(mockHandleUpdateExamContent).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/builder/exam-1/review');
    });

    expect(mockHandleUpdateExamContent.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        title: 'Edited Mock IELTS Exam',
        config: expect.objectContaining({
          general: expect.objectContaining({
            title: 'Edited Mock IELTS Exam',
          }),
        }),
      }),
    );

    expect(mockHandleUpdateExamContent.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0],
    );

    expect(mockHandleUpdateExamContent).toHaveBeenCalledTimes(1);
  });

  it('flushes the latest draft before returning to config', async () => {
    render(<BuilderRoot />);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit draft/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back to config/i }));
    });

    await waitFor(() => {
      expect(mockHandleUpdateExamContent).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/builder/exam-1');
    });

    expect(mockHandleUpdateExamContent.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        title: 'Edited Mock IELTS Exam',
      }),
    );
  });

  it('shows a recovery screen when no builder modules are enabled', async () => {
    controllerState.config.sections.reading.enabled = false;
    controllerState.config.sections.listening.enabled = false;
    controllerState.config.sections.writing.enabled = false;
    controllerState.config.sections.speaking.enabled = false;
    controllerState.activeModule = 'speaking';

    render(<BuilderRoot />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('heading', { name: /builder configuration unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no builder modules are enabled in the current configuration/i),
    ).toBeInTheDocument();
  });
});
