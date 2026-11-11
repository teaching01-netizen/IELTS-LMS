import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SatExamLibraryRoute } from '../../routes/SatExamLibraryRoute';

const useExamListQueryMock = vi.hoisted(() => vi.fn());
const bulkDeleteMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());
const libraryState = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; name: string; parentId?: string; revision: number; scopeKey: string; providerKey: string; organizationId?: string; createdBy: string; createdAt: string; updatedAt: string }>,
  entries: [] as Array<{ examId: string; folderId?: string; revision: number }>,
  moveCalls: [] as unknown[],
  createCalls: [] as unknown[],
  isLoading: false,
  error: null as string | null,
}));
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({
  examKeys: { all: ['exam-authoring'] as const },
  useExamListQuery: useExamListQueryMock,
  useBulkDeleteExamsMutation: () => ({ mutateAsync: bulkDeleteMock, isPending: false }),
  invalidateExamList: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../features/exam-authoring/api/examAuthoringFacade', () => ({
  examAuthoringFacade: { lifecycle: { createProviderExam: createProviderExamMock } },
}));
vi.mock('../../../../features/exam-authoring/api/satExamConfigApi', () => ({
  useSatExamConfigDefaults: () => ({ data: { preset: 'standard_sat', config: { sections: { 'reading-writing': { module1Minutes: 32, module2LowerMinutes: 32, module2HigherMinutes: 32, breakAfterMinutes: 10, minimumCorrectForHigher: 13 }, math: { module1Minutes: 35, module2LowerMinutes: 35, module2HigherMinutes: 35, breakAfterMinutes: 0, minimumCorrectForHigher: 11 } }, showClassroomScoreReport: false }, limits: { minModuleMinutes: 1, maxModuleMinutes: 600, maxBreakMinutes: 240, operationalQuestions: { 'reading-writing': 27, math: 22 } }, classroomCreationEnabled: true }, error: null }),
}));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { id: 'admin', displayName: 'Admin', email: 'admin@example.com' } } }),
}));
vi.mock('../../library/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../library/queries')>();
  return {
    ...actual,
    libraryKeys: { all: ['exam-authoring', 'library', 'sat'] as const },
    useSatLibraryQuery: () => ({
      data: libraryState.isLoading || libraryState.error ? undefined : {
        folders: libraryState.folders,
        entries: libraryState.entries,
        byExam: Object.fromEntries(libraryState.entries.map((e) => [e.examId, e])),
      },
      isLoading: libraryState.isLoading,
      isFetching: false,
      error: libraryState.error ? new Error(libraryState.error) : null,
      refetch: vi.fn().mockResolvedValue({}),
    }),
    useCreateFolderMutation: () => ({
      isPending: false,
      mutateAsync: async (input: { name: string; parentId?: string | null }) => {
        libraryState.createCalls.push(input);
        if (libraryState.folders.some((f) => (f.parentId ?? null) === (input.parentId ?? null) && f.name.toLowerCase() === input.name.toLowerCase())) {
          throw new Error('A folder with this name already exists here.');
        }
        const folder = { id: `f-${input.name}`, name: input.name, parentId: input.parentId ?? undefined, revision: 0, scopeKey: 'sat|platform', providerKey: 'sat', createdBy: 'admin', createdAt: '', updatedAt: '' };
        libraryState.folders.push(folder);
        return folder;
      },
    }),
    useRenameFolderMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useMoveFolderMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useDeleteFolderMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useMoveExamsMutation: () => ({
      isPending: false,
      mutateAsync: async (input: { items: Array<{ examId: string; revision: number }>; folderId: string | null }) => {
        libraryState.moveCalls.push(input);
        if (input.items.some((item) => item.revision === 99)) throw new Error('An exam changed while you were moving it; refresh before retrying.');
        return { entries: [] };
      },
    }),
  };
});

const satExam = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, slug: id, title, providerKey: 'sat', type: 'Academic', status: 'draft',
  visibility: 'organization', owner: 'Admin', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-30T00:00:00Z',
  currentDraftVersionId: 'draft-1', currentPublishedVersionId: null, canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4,
  satCustomModules: true, organizationId: 'org-1', ...extra,
});

function renderRoute(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}><SatExamLibraryRoute /></MemoryRouter></QueryClientProvider>);
}

describe('SAT library folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryState.folders = [
      { id: 'f-phys', name: 'Physics', revision: 0, scopeKey: 'sat|platform', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '' },
      { id: 'f-mech', name: 'Mechanics', parentId: 'f-phys', revision: 0, scopeKey: 'sat|platform', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '' },
    ];
    libraryState.entries = [{ examId: 'sat-filed', folderId: 'f-phys', revision: 0 }];
    libraryState.moveCalls = [];
    libraryState.createCalls = [];
    libraryState.isLoading = false;
    libraryState.error = null;
    useExamListQueryMock.mockReturnValue({
      data: { entities: [satExam('sat-root', 'Root Exam'), satExam('sat-filed', 'Filed Exam'), satExam('sat-pub', 'Room Exam', { status: 'published', currentPublishedVersionId: 'v1' })], exams: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    bulkDeleteMock.mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] });
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam('sat-new', 'New') });
  });
  afterEach(() => { window.localStorage.clear(); });

  it('shows Library root with unfiled exams and child folders, breadcrumb stays on Library', () => {
    renderRoute('/');
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Folders' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Folders' })).getByRole('link', { name: 'Physics' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Library');
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
  });

  it('opens a folder from the tree, filters to its exams, and exposes the ancestor breadcrumb', () => {
    renderRoute('/');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Folders' })).getByRole('link', { name: 'Physics' }));
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
    expect(screen.queryByText('Root Exam')).not.toBeInTheDocument();
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByText('Library')).toBeInTheDocument();
    expect(within(crumb).getByText('Physics')).toBeInTheDocument();
  });

  it('finds exams across folders from All exams while root stays scoped', () => {
    renderRoute('/?folder=all');
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
    expect(screen.getByText('Room Exam')).toBeInTheDocument();
  });

  it('keeps search composition inside the current folder', () => {
    renderRoute('/');
    fireEvent.change(screen.getByPlaceholderText('Search exams'), { target: { value: 'Root' } });
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search exams'), { target: { value: 'Filed' } });
    expect(screen.queryByText('Root Exam')).not.toBeInTheDocument();
  });

  it('creates an exam inside the current folder atomically', async () => {
    renderRoute('/?folder=f-phys');
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Folder Child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    expect(createProviderExamMock.mock.calls[0]![0]).toMatchObject({ folderId: 'f-phys', title: 'Folder Child' });
  });

  it('creates an exam unfiled from All exams', async () => {
    renderRoute('/?folder=all');
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Top Exam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    expect(createProviderExamMock.mock.calls[0]![0]).not.toHaveProperty('folderId');
  });

  it('moves visible selected exams and preserves selection on failure', async () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    fireEvent.change(within(dialog).getByLabelText('Destination'), { target: { value: 'f-mech' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(libraryState.moveCalls.length).toBe(1));
    expect(libraryState.moveCalls[0]).toMatchObject({ folderId: 'f-mech', items: [{ examId: 'sat-root', revision: 0 }] });
  });

  it('rejects conflicting folder names with a recoverable error', async () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    fireEvent.change(within(dialog).getByLabelText('Folder name'), { target: { value: 'physics' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    expect(await within(dialog).findByText('A folder with this name already exists here.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
  });

  it('fail-closed while library loads: filed exams never flash as unfiled', () => {
    libraryState.isLoading = true;
    renderRoute('/');
    expect(screen.getByLabelText('Loading exams')).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
    expect(screen.queryByText('Root Exam')).not.toBeInTheDocument();
  });

  it('fail-closed on library error: shows library error with Retry and no create/move', () => {
    libraryState.error = 'Folder service unavailable';
    renderRoute('/');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
  });

  it('unknown folder URL shows Folder unavailable instead of silent root', () => {
    renderRoute('/?folder=deleted-id');
    expect(screen.getByText('Folder unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return to Library/ })).toBeInTheDocument();
    expect(screen.queryByText('Root Exam')).not.toBeInTheDocument();
  });
});
