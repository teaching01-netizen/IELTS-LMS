import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatExamLibraryRoute } from '../../routes/SatExamLibraryRoute';

const useExamListQueryMock = vi.hoisted(() => vi.fn());
const bulkDeleteMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());

type FolderRow = {
  id: string;
  name: string;
  parentId?: string;
  revision: number;
  scopeKey: string;
  providerKey: string;
  organizationId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const libraryState = vi.hoisted(() => ({
  folders: [] as FolderRow[],
  entries: [] as Array<{ examId: string; folderId?: string; revision: number }>,
  isLoading: false,
  error: null as string | null,
  createCalls: [] as Array<{ name: string; parentId?: string | null }>,
  createError: null as string | null,
  deleteCalls: [] as Array<{ id: string; revision: number }>,
  deleteError: null as string | null,
  moveCalls: [] as Array<{ items: Array<{ examId: string; revision: number }>; folderId: string | null }>,
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
  useSatExamConfigDefaults: () => ({
    data: {
      preset: 'standard_sat',
      config: {
        sections: {
          'reading-writing': { module1Minutes: 32, module2LowerMinutes: 32, module2HigherMinutes: 32, breakAfterMinutes: 10, minimumCorrectForHigher: 13 },
          math: { module1Minutes: 35, module2LowerMinutes: 35, module2HigherMinutes: 35, breakAfterMinutes: 0, minimumCorrectForHigher: 11 },
        },
        showClassroomScoreReport: false,
      },
      limits: { minModuleMinutes: 1, maxModuleMinutes: 600, maxBreakMinutes: 240, operationalQuestions: { 'reading-writing': 27, math: 22 } },
      classroomCreationEnabled: true,
    },
    error: null,
  }),
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
      data: libraryState.isLoading || libraryState.error
        ? undefined
        : {
            folders: libraryState.folders,
            entries: libraryState.entries,
            byExam: Object.fromEntries(libraryState.entries.map((entry) => [entry.examId, entry])),
          },
      isLoading: libraryState.isLoading,
      isFetching: false,
      error: libraryState.error ? new Error(libraryState.error) : null,
      refetch: vi.fn().mockResolvedValue({}),
    }),
    useCreateFolderMutation: () => ({
      isPending: false,
      reset: vi.fn(),
      mutateAsync: async (input: { name: string; parentId?: string | null }) => {
        libraryState.createCalls.push(input);
        if (libraryState.createError) throw new Error(libraryState.createError);
        if (libraryState.folders.some((folder) => (folder.parentId ?? null) === (input.parentId ?? null) && folder.name.toLowerCase() === input.name.toLowerCase())) {
          throw new Error('A folder with this name already exists here.');
        }
        const created: FolderRow = {
          id: `f-${input.name}`,
          name: input.name,
          parentId: input.parentId ?? undefined,
          revision: 0,
          scopeKey: 'sat|org-1',
          providerKey: 'sat',
          organizationId: 'org-1',
          createdBy: 'admin',
          createdAt: '2026-11-11T00:00:00Z',
          updatedAt: '2026-11-11T00:00:00Z',
        };
        libraryState.folders.push(created);
        return created;
      },
    }),
    useRenameFolderMutation: () => ({
      isPending: false,
      mutateAsync: async (input: { id: string; name: string }) => {
        const folder = libraryState.folders.find((row) => row.id === input.id);
        if (folder) folder.name = input.name;
        return folder;
      },
    }),
    useMoveFolderMutation: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useDeleteFolderMutation: () => ({
      isPending: false,
      mutateAsync: async (input: { id: string; revision: number }) => {
        libraryState.deleteCalls.push(input);
        if (libraryState.deleteError) throw new Error(libraryState.deleteError);
        libraryState.folders = libraryState.folders.filter((folder) => folder.id !== input.id);
      },
    }),
    useMoveExamsMutation: () => ({
      isPending: false,
      mutateAsync: async (input: { items: Array<{ examId: string; revision: number }>; folderId: string | null }) => {
        libraryState.moveCalls.push(input);
        if (input.items.some((item) => item.revision === 99)) {
          throw new Error('An exam changed while you were moving it; refresh before retrying.');
        }
        return { entries: [] };
      },
    }),
  };
});

const satExam = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  title,
  providerKey: 'sat',
  type: 'Academic',
  status: 'draft',
  visibility: 'organization',
  owner: 'Admin',
  createdAt: '2026-08-29T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
  currentDraftVersionId: 'draft-1',
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
  satCustomModules: true,
  organizationId: 'org-1',
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.search}</p>;
}

function renderRoute(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <SatExamLibraryRoute />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function locationParams(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '');
}

const rootExams = () => [
  satExam('sat-root', 'Root Exam', { updatedAt: '2026-08-30T00:00:00Z' }),
  satExam('sat-full', 'Full SAT Mock', { satCustomModules: false, updatedAt: '2026-08-28T00:00:00Z' }),
  satExam('sat-pub', 'Published Practice', { status: 'published', currentPublishedVersionId: 'published-1', satCustomModules: false, updatedAt: '2026-08-26T00:00:00Z' }),
  satExam('sat-arch-root', 'Old Root Mock', { status: 'archived', satCustomModules: false }),
];

const allExams = () => [
  ...rootExams(),
  satExam('sat-filed', 'Filed Exam'),
  satExam('sat-mech', 'Mechanics Checkpoint', { status: 'published', currentPublishedVersionId: 'published-2' }),
  satExam('sat-autumn', 'Autumn Diagnostic', { satCustomModules: false }),
  satExam('sat-arch-phys', 'Archived Physics Exam', { status: 'archived' }),
];

describe('SAT exams browser (one place, global search)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryState.folders = [
      { id: 'f-autumn', name: 'Autumn 2026', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
      { id: 'f-physics', name: 'Physics', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
      { id: 'f-mech', name: 'Mechanics', parentId: 'f-physics', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
      { id: 'f-week9', name: 'Week 9', parentId: 'f-physics', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
      { id: 'f-week1a', name: 'Week 1', parentId: 'f-autumn', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
      { id: 'f-week1p', name: 'Week 1', parentId: 'f-physics', revision: 0, scopeKey: 'sat|org-1', providerKey: 'sat', organizationId: 'org-1', createdBy: 'admin', createdAt: '', updatedAt: '2026-08-30T00:00:00Z' },
    ];
    libraryState.entries = [
      { examId: 'sat-filed', folderId: 'f-physics', revision: 0 },
      { examId: 'sat-mech', folderId: 'f-mech', revision: 0 },
      { examId: 'sat-autumn', folderId: 'f-autumn', revision: 0 },
      { examId: 'sat-arch-phys', folderId: 'f-physics', revision: 0 },
    ];
    libraryState.isLoading = false;
    libraryState.error = null;
    libraryState.createCalls = [];
    libraryState.createError = null;
    libraryState.deleteCalls = [];
    libraryState.deleteError = null;
    libraryState.moveCalls = [];
    useExamListQueryMock.mockReturnValue({ data: { entities: allExams(), exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    bulkDeleteMock.mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] });
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam('sat-new', 'New') });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('shows one Exams title, folders and unfiled exams without the retired Library/All/Browse chrome', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Exams' })).toBeInTheDocument();
    expect(screen.queryByText('Library')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All exams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse folders' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();
    const folders = screen.getByRole('list', { name: 'Folders' });
    expect(within(folders).getByRole('link', { name: 'Autumn 2026' })).toBeInTheDocument();
    expect(within(folders).getByRole('link', { name: 'Physics' })).toBeInTheDocument();
    expect(within(folders).queryByRole('link', { name: 'Mechanics' })).not.toBeInTheDocument();
    const exams = screen.getByRole('list', { name: 'Exams' });
    expect(within(exams).getByText('Root Exam')).toBeInTheDocument();
    expect(within(exams).getByText('Full SAT Mock')).toBeInTheDocument();
    expect(within(exams).queryByText('Filed Exam')).not.toBeInTheDocument();
    // Both creation taxonomies are visible at once; no remembered filter hides one.
    expect(screen.getAllByText('Custom modules').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Full SAT').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Search all exams and folders')).toBeInTheDocument();
    // Root archived exams stay collapsed but counted.
    expect(screen.getByRole('button', { name: /^Archived/ })).toHaveTextContent('1');
    expect(screen.queryByText('Old Root Mock')).not.toBeInTheDocument();
  });

  it('opens a nested location with an ancestors-only path and visible current-folder actions', () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('link', { name: 'Physics' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Physics' })).toBeInTheDocument();
    const path = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(path).getByRole('link', { name: 'Exams' })).toBeInTheDocument();
    expect(path).not.toHaveTextContent('Physics');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More folder actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();
    const folders = screen.getByRole('list', { name: 'Folders' });
    expect(within(folders).getByRole('link', { name: 'Mechanics' })).toBeInTheDocument();
    expect(within(folders).getByRole('link', { name: 'Week 1' })).toBeInTheDocument();
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
    expect(screen.queryByText('Archived Physics Exam')).not.toBeInTheDocument();

    fireEvent.click(within(folders).getByRole('link', { name: 'Mechanics' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Mechanics' })).toBeInTheDocument();
    const nestedPath = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nestedPath).getByRole('link', { name: 'Exams' })).toBeInTheDocument();
    expect(within(nestedPath).getByRole('link', { name: 'Physics' })).toBeInTheDocument();
    expect(nestedPath).not.toHaveTextContent('Mechanics');
  });

  it('finds filed exams globally from root and from another folder, with a truthful location and Show in folder', () => {
    renderRoute('/');
    const search = screen.getByPlaceholderText('Search all exams and folders');
    fireEvent.change(search, { target: { value: 'Filed' } });
    expect(screen.getByText('Results from all folders for “Filed”.')).toBeInTheDocument();
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
    expect(screen.getByText('In Physics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Filed Exam in folder' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Mechanics Checkpoint' } });
    expect(screen.getByText('Mechanics Checkpoint')).toBeInTheDocument();
    expect(screen.getByText('In Physics / Mechanics')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show Mechanics Checkpoint in folder' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Mechanics' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search all exams and folders')).toHaveValue('');
    expect(screen.getByText('Mechanics Checkpoint')).toBeInTheDocument();
  });

  it('finds folders globally by name and opens the exact branch, clearing the query', () => {
    renderRoute('/');
    fireEvent.change(screen.getByPlaceholderText('Search all exams and folders'), { target: { value: 'Week 1' } });
    const folders = screen.getByRole('list', { name: 'Folders' });
    expect(within(folders).getByRole('link', { name: 'Week 1, in Autumn 2026' })).toBeInTheDocument();
    expect(within(folders).getByRole('link', { name: 'Week 1, in Physics' })).toBeInTheDocument();
    fireEvent.click(within(folders).getByRole('link', { name: 'Week 1, in Autumn 2026' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Week 1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Autumn 2026');
    expect(screen.getByPlaceholderText('Search all exams and folders')).toHaveValue('');
  });

  it('keeps archived exams collapsed until opened, and shows matching archived exams during search', () => {
    renderRoute('/');
    expect(screen.queryByText('Old Root Mock')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search all exams and folders'), { target: { value: 'Old Root' } });
    expect(screen.getByText('Old Root Mock')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search all exams and folders'), { target: { value: '' } });
    expect(screen.queryByText('Old Root Mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    expect(screen.getByText('Old Root Mock')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    expect(screen.queryByText('Old Root Mock')).not.toBeInTheDocument();
  });

  it('shows both exam types even when the retired type preference says otherwise', () => {
    window.localStorage.setItem('sat-exam-library-type:admin', 'practice');
    renderRoute('/');
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    expect(screen.getByText('Full SAT Mock')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Exam type' })).not.toBeInTheDocument();
  });

  it('normalizes legacy folder=all to root while preserving search and sort', async () => {
    renderRoute('/?folder=all&q=Mock&sort=title');
    expect(screen.getByRole('heading', { level: 1, name: 'Exams' })).toBeInTheDocument();
    expect(screen.queryByText('All exams')).not.toBeInTheDocument();
    expect(screen.getByText('Full SAT Mock')).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
    await waitFor(() => expect(locationParams().has('folder')).toBe(false));
    expect(locationParams().get('q')).toBe('Mock');
    expect(locationParams().get('sort')).toBe('title');
  });

  it('opens legacy archived links and removes legacy draft/published tabs without hiding exams', async () => {
    renderRoute('/?tab=archived');
    expect(screen.getByText('Old Root Mock')).toBeInTheDocument();
    await waitFor(() => expect(locationParams().has('tab')).toBe(false));
    cleanup();
    renderRoute('/?tab=drafts');
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    expect(screen.getByText('Published Practice')).toBeInTheDocument();
    await waitFor(() => expect(locationParams().has('tab')).toBe(false));
  });

  it('keeps an unknown folder recoverable and gates creation on authoritative data', async () => {
    renderRoute('/?folder=deleted-id');
    expect(screen.getByText('Folder unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create exam' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Return to Exams' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Exams' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create exam' })).toBeEnabled());
  });

  it('clears the search, reveals and focuses a newly created folder at the current level', async () => {
    renderRoute('/');
    fireEvent.change(screen.getByPlaceholderText('Search all exams and folders'), { target: { value: 'Autumn' } });
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    fireEvent.change(within(dialog).getByLabelText('Folder name'), { target: { value: 'Winter 2027' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Winter 2027' })).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Search all exams and folders')).toHaveValue('');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Winter 2027' })).toHaveFocus());
    expect(libraryState.createCalls[0]).toMatchObject({ name: 'Winter 2027', parentId: null });
  });

  it('navigates into the parent when a subfolder is created from a search result', async () => {
    renderRoute('/');
    fireEvent.change(screen.getByPlaceholderText('Search all exams and folders'), { target: { value: 'Physics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Physics' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New subfolder' }));
    const dialog = screen.getByRole('dialog', { name: 'New subfolder in Physics' });
    fireEvent.change(within(dialog).getByLabelText('Folder name'), { target: { value: 'Optics' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Physics' })).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Search all exams and folders')).toHaveValue('');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Optics' })).toHaveFocus());
    expect(libraryState.createCalls[0]).toMatchObject({ name: 'Optics', parentId: 'f-physics' });
  });

  it('does not clear the main search when a destination folder is created inside the move picker', async () => {
    renderRoute('/?q=Root');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New folder here' }));
    fireEvent.change(within(dialog).getByLabelText('New folder name'), { target: { value: 'Dest New' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(within(dialog).getByText('Dest New')).toBeInTheDocument());
    expect(locationParams().get('q')).toBe('Root');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByPlaceholderText('Search all exams and folders')).toHaveValue('Root');
  });

  it('replaces the toolbar with a sticky selection summary and clears it with Escape', () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    const selection = screen.getByRole('group', { name: 'Selection actions' });
    expect(within(selection).getByRole('status')).toHaveTextContent('1 selected');
    expect(within(selection).getByRole('button', { name: 'Move to' })).toBeInTheDocument();
    expect(within(selection).getByRole('button', { name: 'Delete 1 exam' })).toBeInTheDocument();
    expect(within(selection).getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search all exams and folders')).not.toBeInTheDocument();
    fireEvent.keyDown(selection, { key: 'Escape' });
    expect(screen.getByPlaceholderText('Search all exams and folders')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Root Exam' })).not.toBeChecked();
  });

  it('selects and deletes only rows that are visible at selection time', async () => {
    bulkDeleteMock.mockResolvedValue({
      success: true,
      total: 3,
      succeeded: 3,
      failed: 0,
      results: [
        { examId: 'sat-root', examTitle: 'Root Exam', success: true },
        { examId: 'sat-full', examTitle: 'Full SAT Mock', success: true },
        { examId: 'sat-pub', examTitle: 'Published Practice', success: true },
      ],
    });
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all 3 exams' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 selected');
    // Revealing the archived row must not silently expand the payload.
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    expect(screen.getByText('Old Root Mock')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 exams' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Delete 3 exams?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bulkDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ examIds: ['sat-root', 'sat-full', 'sat-pub'] })));
  });

  it('sorts exams through the toolbar sort select', () => {
    renderRoute('/');
    const exams = screen.getByRole('list', { name: 'Exams' });
    const titles = () => within(exams).getAllByRole('link').map((link) => link.getAttribute('aria-label'));
    expect(titles()[0]).toBe('Edit Root Exam');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'title' } });
    expect(titles()[0]).toBe('Edit Full SAT Mock');
    expect(titles()[1]).toBe('Open rooms for Published Practice');
    expect(titles()[2]).toBe('Edit Root Exam');
  });

  it('creates an exam inside the current folder atomically', async () => {
    renderRoute('/?folder=f-physics');
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Folder Child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    expect(createProviderExamMock.mock.calls[0]![0]).toMatchObject({ folderId: 'f-physics', title: 'Folder Child' });
  });

  it('creates an exam unfiled at the root', async () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Top Exam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    expect(createProviderExamMock.mock.calls[0]![0]).not.toHaveProperty('folderId');
  });

  it('moves visible selected exams through the destination browser', async () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    expect(within(dialog).getByRole('navigation', { name: 'Destination path' })).toHaveTextContent('Exams');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Physics' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Mechanics' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move', exact: true }));
    await waitFor(() => expect(libraryState.moveCalls.length).toBe(1));
    expect(libraryState.moveCalls[0]).toMatchObject({ folderId: 'f-mech', items: [{ examId: 'sat-root', revision: 0 }] });
  });

  it('keeps selection and shows the server error when a move fails', async () => {
    libraryState.entries = [{ examId: 'sat-root', folderId: undefined, revision: 99 }];
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Physics' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move', exact: true }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/changed while you were moving/);
    expect(screen.getByRole('dialog', { name: /Move exam to/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Root Exam' })).toBeChecked();
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

  it('fails closed while the library loads or errors', () => {
    libraryState.isLoading = true;
    const first = renderRoute('/');
    expect(screen.getByLabelText('Loading exams')).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
    expect(screen.queryByText('Root Exam')).not.toBeInTheDocument();
    first.unmount();
    libraryState.isLoading = false;
    libraryState.error = 'Folder service unavailable';
    renderRoute('/');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText('Filed Exam')).not.toBeInTheDocument();
  });
});
