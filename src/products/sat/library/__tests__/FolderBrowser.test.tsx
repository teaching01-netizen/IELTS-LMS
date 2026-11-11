import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FolderDestinationBrowser } from '../FolderDestinationBrowser';
import { ExamMoveDialog } from '../FolderDialogs';
import { SatExamLibraryRoute as TestRoute } from '../../routes/SatExamLibraryRoute';
import type { LibraryFolder } from '../types';

const folder = (id: string, name: string, parentId?: string): LibraryFolder => ({
  id,
  name,
  parentId,
  revision: 0,
  scopeKey: 'sat|platform:nil',
  providerKey: 'sat',
  createdBy: 'admin',
  createdAt: '',
  updatedAt: '',
});

describe('FolderDestinationBrowser (Drive Move picker)', () => {
  it('shows explicit destination path, Up, and direct child rows', () => {
    const folders = [folder('a', 'Alpha'), folder('b', 'Beta', 'a'), folder('c', 'Gamma', 'a')];
    const onChange = vi.fn();
    render(<FolderDestinationBrowser folders={folders} value="a" onChange={onChange} />);
    expect(screen.getByRole('navigation', { name: /Destination/ })).toHaveTextContent('Library');
    expect(screen.getByRole('navigation', { name: /Destination/ })).toHaveTextContent('Alpha');
    expect(screen.getByRole('button', { name: /Up one level/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Beta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Gamma/ })).toBeInTheDocument();
  });

  it('navigates same-named children in different branches by path, not global name', () => {
    const folders = [
      folder('a', 'Alpha'),
      folder('b', 'Beta'),
      folder('w1', 'Week 1', 'a'),
      folder('w2', 'Week 1', 'b'),
      folder('deep', 'Deep', 'w1'),
    ];
    const onChange = vi.fn();
    function Picker() {
      const [value, setValue] = useState<string | null>(null);
      return <FolderDestinationBrowser folders={folders} value={value} onChange={(id) => { onChange(id); setValue(id); }} />;
    }
    render(<Picker />);
    fireEvent.click(screen.getByRole('button', { name: /Open Alpha/ }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Open Week 1' }));
    expect(onChange).toHaveBeenLastCalledWith('w1');
    expect(screen.getByRole('button', { name: 'Open Deep' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destination path' })).getByRole('button', { name: 'Library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Week 1' }));
    expect(onChange).toHaveBeenLastCalledWith('w2');
    expect(screen.queryByRole('button', { name: 'Open Deep' })).not.toBeInTheDocument();
  });

  it('shows an empty-folder hint when the destination has no subfolders', () => {
    const folders = [folder('a', 'Alpha')];
    render(<FolderDestinationBrowser folders={folders} value="a" onChange={vi.fn()} />);
    expect(screen.getByText(/No subfolders here/)).toBeInTheDocument();
  });

  it('locks navigation while pending', () => {
    const folders = [folder('a', 'Alpha'), folder('b', 'Beta', 'a')];
    render(<FolderDestinationBrowser folders={folders} value="a" onChange={vi.fn()} pending />);
    expect(screen.getByRole('button', { name: /Up one level/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Open Beta/ })).toBeDisabled();
  });
});

describe('move destination recovery', () => {
  it('requires an explicit destination when the chosen folder disappears', () => {
    const onMove = vi.fn();
    const props = { open: true, count: 1, compatible: true, initialDestination: 'a', onClose: vi.fn(), onMove, onNewFolder: vi.fn(), pending: false, serverError: null };
    const { rerender } = render(<ExamMoveDialog {...props} folders={[folder('a', 'Alpha')]} />);
    rerender(<ExamMoveDialog {...props} folders={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Destination unavailable');
    expect(screen.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destination path' })).getByRole('button', { name: 'Library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it('keeps a chosen destination when source membership refreshes', () => {
    const props = { open: true, folders: [folder('a', 'Alpha'), folder('b', 'Beta')], count: 1, compatible: true, initialDestination: 'a', onClose: vi.fn(), onMove: vi.fn(), onNewFolder: vi.fn(), pending: false, serverError: null };
    const { rerender } = render(<ExamMoveDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Up one level' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }));
    rerender(<ExamMoveDialog {...props} initialDestination={null} />);
    expect(screen.getByRole('navigation', { name: 'Destination path' })).toHaveTextContent('Beta');
    fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
    expect(props.onMove).toHaveBeenCalledWith('b');
  });

  it('locks navigation, moving and dismissal while creating a destination', async () => {
    let finish!: (value: LibraryFolder | null) => void;
    const onNewFolder = vi.fn(() => new Promise<LibraryFolder | null>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    const onMove = vi.fn();
    const props = { open: true, count: 1, compatible: true, initialDestination: 'a', onClose, onMove, onNewFolder, pending: false, serverError: null };
    const { rerender } = render(<ExamMoveDialog {...props} folders={[folder('a', 'Alpha')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder here' }));
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Week 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder', exact: true }));
    expect(screen.getByRole('button', { name: 'Up one level' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move', exact: true })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(onClose).not.toHaveBeenCalled();
    finish(folder('new', 'Week 2', 'a'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Destination path' })).toHaveTextContent('Week 2'));
    // Once the server confirms creation, a later deletion must not be hidden
    // by the dialog's immediate-result cache.
    rerender(<ExamMoveDialog {...props} folders={[folder('a', 'Alpha'), folder('new', 'Week 2', 'a')]} />);
    rerender(<ExamMoveDialog {...props} folders={[folder('a', 'Alpha')]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Destination unavailable');
    expect(screen.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
  });
});

// Route-level Drive browser contracts.
const useExamListQueryMock = vi.hoisted(() => vi.fn());
const bulkDeleteMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());
const libraryState = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; name: string; parentId?: string; revision: number; scopeKey: string; providerKey: string; organizationId?: string; createdBy: string; createdAt: string; updatedAt: string }>,
  entries: [] as Array<{ examId: string; folderId?: string; revision: number }>,
  moveCalls: [] as unknown[],
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
  useSatExamConfigDefaults: () => ({ data: { preset: 'standard_sat', config: { sections: { 'reading-writing': { module1Minutes: 32 }, math: { module1Minutes: 35 } }, showClassroomScoreReport: false }, limits: {}, classroomCreationEnabled: true }, error: null }),
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
      data: { folders: libraryState.folders, entries: libraryState.entries, byExam: Object.fromEntries(libraryState.entries.map((e) => [e.examId, e])) },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    }),
    useCreateFolderMutation: () => ({
      isPending: false,
      reset: vi.fn(),
      mutateAsync: async (input: { name: string; parentId?: string | null }) => {
        if (libraryState.folders.some((f) => (f.parentId ?? null) === (input.parentId ?? null) && f.name.toLowerCase() === input.name.toLowerCase())) {
          throw new Error('A folder with this name already exists here.');
        }
        const created = { id: `f-${input.name}`, name: input.name, parentId: input.parentId ?? undefined, revision: 0, scopeKey: 'sat|platform:nil', providerKey: 'sat', createdBy: 'admin', createdAt: '', updatedAt: '' };
        libraryState.folders.push(created);
        return created;
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
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}><TestRoute /></MemoryRouter></QueryClientProvider>);
}

describe('library browser navigation (Drive list model)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryState.folders = [
      { id: 'f-phys', name: 'Physics', revision: 0, scopeKey: 'sat|platform:nil', providerKey: 'sat', createdBy: 'admin', createdAt: '', updatedAt: '' },
      { id: 'f-mech', name: 'Mechanics', parentId: 'f-phys', revision: 0, scopeKey: 'sat|platform:nil', providerKey: 'sat', createdBy: 'admin', createdAt: '', updatedAt: '' },
    ];
    libraryState.entries = [{ examId: 'sat-filed', folderId: 'f-phys', revision: 0 }];
    libraryState.moveCalls = [];
    useExamListQueryMock.mockReturnValue({
      data: { entities: [satExam('sat-root', 'Root Exam'), satExam('sat-filed', 'Filed Exam')], exams: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    bulkDeleteMock.mockResolvedValue({ success: true, total: 0, succeeded: 0, failed: 0, results: [] });
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam('sat-new', 'New') });
  });
  afterEach(() => { window.localStorage.clear(); });

  it('renders folders as rows in the same list surface as exams', () => {
    renderRoute('/');
    const subfolders = screen.getByRole('list', { name: 'Subfolders' });
    expect(within(subfolders).getByRole('link', { name: 'Physics' })).toBeInTheDocument();
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
  });

  it('offers Up one level and a current-folder menu inside the folder', () => {
    renderRoute('/?folder=f-phys');
    expect(screen.getByRole('button', { name: /Up one level/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Actions for current folder/ })).toBeInTheDocument();
  });

  it('clears only the search when navigating folders', () => {
    renderRoute('/?q=Root');
    expect(screen.getByText('Root Exam')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    // Tree and row links share the destination; rows hide under a search
    // filter, so click whichever Physics link is present.
    const physicsLinks = screen.getAllByRole('link', { name: 'Physics' });
    expect(physicsLinks.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(physicsLinks[physicsLinks.length - 1]!);
    expect(screen.getByPlaceholderText('Search exams')).toHaveValue('');
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
  });

  it('shows folder location and Show in folder in All exams', () => {
    renderRoute('/?folder=all');
    expect(screen.getByText('Filed Exam')).toBeInTheDocument();
    expect(screen.getByText(/In Physics/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Filed Exam in folder' })).toBeInTheDocument();
  });

  it('creates a folder from the exam move dialog without moving until Move is pressed', async () => {
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /New folder here/ }));
    fireEvent.change(within(dialog).getByLabelText(/New folder name/), { target: { value: 'Dest New' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(within(dialog).getByText('Dest New')).toBeInTheDocument());
    expect(libraryState.moveCalls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Move$/ }));
    await waitFor(() => expect(libraryState.moveCalls).toHaveLength(1));
  });

  it('keeps selection and error when a move fails so it can be retried', async () => {
    useExamListQueryMock.mockReturnValue({
      data: { entities: [satExam('sat-root', 'Root Exam'), { ...satExam('sat-bad', 'Bad Exam'), organizationId: 'org-1' }], exams: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    libraryState.entries = [{ examId: 'sat-bad', folderId: undefined, revision: 99 }];
    renderRoute('/');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bad Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = screen.getByRole('dialog', { name: /Move exam to/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Move$/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/changed while you were moving/);
    expect(screen.getByRole('dialog', { name: /Move exam to/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Bad Exam' })).toBeChecked();
  });
});
