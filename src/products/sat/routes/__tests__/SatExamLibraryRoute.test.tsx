import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatExamLibraryRoute } from '../SatExamLibraryRoute';
import {
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
} from '../../../../features/exam-authoring/application/authoringEntryIntent';

const useExamListQueryMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());
const invalidateExamListMock = vi.hoisted(() => vi.fn());
const bulkDeleteMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({
  useExamListQuery: useExamListQueryMock,
  useBulkDeleteExamsMutation: () => ({ mutateAsync: bulkDeleteMock, isPending: false }),
  invalidateExamList: invalidateExamListMock,
}));
vi.mock('../../../../features/exam-authoring/api/examAuthoringFacade', () => ({
  examAuthoringFacade: { lifecycle: { createProviderExam: createProviderExamMock } },
}));
const defaultsMock = vi.hoisted(() => ({
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
}));
vi.mock('../../../../features/exam-authoring/api/satExamConfigApi', () => ({
  useSatExamConfigDefaults: () => ({ data: defaultsMock.data, error: null }),
}));
const sessionUser = vi.hoisted(() => ({ id: undefined as string | undefined }));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { id: sessionUser.id, displayName: 'Admin', email: 'admin@example.com' } } }),
}));

const satExam = {
  id: 'sat-1', slug: 'sat-1', title: 'SAT Practice 06', providerKey: 'sat', type: 'Academic', status: 'draft',
  visibility: 'organization', owner: 'Admin', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-30T00:00:00Z',
  currentDraftVersionId: 'draft-1', currentPublishedVersionId: null, canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4,
  satCustomModules: true,
};
const ieltsExam = { ...satExam, id: 'ielts-1', slug: 'ielts-1', title: 'IELTS Academic 01', providerKey: 'ielts' };

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SatExamLibraryRoute /></MemoryRouter></QueryClientProvider>);
}

function createFromReview() {
  const dialog = screen.getByRole('dialog', { name: 'New exam' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create exam' }));
}

describe('SatExamLibraryRoute', () => {
  it('creates with one section using standard settings and keeps at least one on', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Reading only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Math' }));
    expect(screen.getByRole('button', { name: 'Math' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Reading & Writing' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reading & Writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: { ...defaultsMock.data.config, sectionScope: 'reading-writing' } }),
      'Admin',
    ));
  });

  it('hides excluded timing fields and shows the section choice in review', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Reading only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Math' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(document.getElementById('sat-create-math-module1Minutes')).toBeNull();
    expect(document.getElementById('sat-create-reading-writing-module1Minutes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Students take Reading & Writing only/)).toBeInTheDocument();
    expect(screen.queryByText(/Math:/)).not.toBeInTheDocument();
  });

  it('labels the section scope before the first room exists', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [{ ...satExam, satSectionScope: 'math' }], exams: [] }, isLoading: false, error: null });
    renderRoute();
    expect(screen.getByText(/Math only/)).toBeInTheDocument();
  });

  it('drops an excluded section plan and resets its hidden invalid timings', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Math only' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom modules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Reading & Writing: Easy Module 2 only' }));
    fireEvent.change(document.getElementById('sat-create-reading-writing-module2LowerMinutes')!, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reading & Writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    createFromReview();
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    const input = createProviderExamMock.mock.calls[0]![0];
    expect(input.configuration.sectionScope).toBe('math');
    expect(input.configuration.classroomPlan ?? {}).toEqual({});
    expect(input.configuration.sections['reading-writing']).toEqual(defaultsMock.data.config.sections['reading-writing']);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    invalidateExamListMock.mockResolvedValue(undefined);
    defaultsMock.data.classroomCreationEnabled = true;
  });

  afterEach(() => {
    consumeAuthoringDraftOnEntry('sat-1');
    window.localStorage.clear();
    sessionUser.id = undefined;
  });

  it('bulk-deletes any selected exam, warning that rooms and results go with it', async () => {
    const second = { ...satExam, id: 'sat-2', slug: 'sat-2', title: 'SAT Practice 07' };
    const roomed = { ...satExam, id: 'sat-3', slug: 'sat-3', title: 'SAT Live 01', status: 'published', currentPublishedVersionId: 'v1' };
    useExamListQueryMock.mockReturnValue({ data: { entities: [satExam, second, roomed], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    bulkDeleteMock.mockResolvedValue({
      success: true, total: 3, succeeded: 2, failed: 1,
      results: [
        { examId: 'sat-1', examTitle: 'SAT Practice 06', success: true },
        { examId: 'sat-2', examTitle: 'SAT Practice 07', success: false, error: 'Locked' },
        { examId: 'sat-3', examTitle: 'SAT Live 01', success: true },
      ],
    });
    renderRoute();

    expect(screen.getByRole('checkbox', { name: 'Select SAT Live 01' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all 3 exams' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 selected');

    fireEvent.click(screen.getByRole('button', { name: /Delete 3 exams/ }));
    const alert = await screen.findByRole('alertdialog', { name: 'Delete 3 exams?' });
    expect(alert).toHaveTextContent('These 3 exams will be permanently deleted. 1 of them has rooms. Those rooms, student attempts and results will be deleted too.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(bulkDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ examIds: ['sat-1', 'sat-2', 'sat-3'] })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deleted 2 of 3 exams. Couldn\'t delete “SAT Practice 07” (Locked).');
    // The failure stays selected so it can be retried.
    expect(screen.getByRole('checkbox', { name: 'Select SAT Practice 07' })).toBeChecked();
  });

  it('arms the edit gesture when a row is opened, and only then', () => {
    // A published exam has no editable draft, so the row click is the gesture
    // that lets its workspace continue from the published version. Rendering
    // the library must never arm it: a render is not a click.
    renderRoute();
    expect(peekAuthoringDraftOnEntry('sat-1')).toBe(false);

    // The row's own destination is a real link stretched over it; the visible
    // title sits in a pointer-events-none span above it.
    fireEvent.click(screen.getByRole('link', { name: 'Edit SAT Practice 06' }));

    expect(peekAuthoringDraftOnEntry('sat-1')).toBe(true);
  });

  it('sends a published exam to its rooms, and only its Edit control arms a draft', () => {
    const published = {
      ...satExam,
      status: 'published',
      currentDraftVersionId: null,
      currentPublishedVersionId: 'published-v2',
      currentPublishedVersionNumber: 2,
    };
    useExamListQueryMock.mockReturnValue({ data: { entities: [published], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();

    // The row's own destination is the operational room list, and reaching it
    // never arms a draft-open intent.
    const row = screen.getByRole('link', { name: 'Open rooms for SAT Practice 06' });
    expect(row).toHaveAttribute('href', '/sat/exams/sat-1/access');
    fireEvent.click(row);
    expect(peekAuthoringDraftOnEntry('sat-1')).toBe(false);

    // Edit is a real control beside the row link, not a control inside it.
    const edit = screen.getByRole('link', { name: 'Edit SAT Practice 06' });
    expect(row.contains(edit)).toBe(false);
    fireEvent.click(edit);
    expect(peekAuthoringDraftOnEntry('sat-1')).toBe(true);
  });

  it('requests the SAT provider boundary and never renders an IELTS exam', () => {
    renderRoute();
    expect(useExamListQueryMock).toHaveBeenCalledWith(true, 'sat', false);
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    expect(screen.queryByText('IELTS Academic 01')).not.toBeInTheDocument();
  });

  it('shows rooms-available status and scope, never a publish state, in the library row', () => {
    const published = {
      ...satExam,
      status: 'published',
      currentDraftVersionId: null,
      currentPublishedVersionId: 'published-v2',
      currentPublishedVersionNumber: 2,
      currentPublishedScope: 'math',
    };
    useExamListQueryMock.mockReturnValue({ data: { entities: [published], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    // The filter tab and the row's status pill both say it.
    expect(screen.getAllByText('Rooms available')).toHaveLength(2);
    expect(screen.queryByText(/Published/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Math only/)).toBeInTheDocument();
  });

  it('creates a SAT directly without exposing a provider selector', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    expect(screen.queryByText('Assessment provider')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    const [input, actor] = createProviderExamMock.mock.calls[0]!;
    expect(input).toMatchObject({ providerKey: 'sat', providerExamType: 'SAT', title: 'October Practice' });
    expect(input.operationKey).toEqual(expect.any(String));
    expect(actor).toBe('Admin');
  });

  it('reuses the create operation key after an ambiguous failure with the same payload', async () => {
    createProviderExamMock
      .mockResolvedValueOnce({ success: false, error: 'Network response was lost.' })
      .mockResolvedValueOnce({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Retry Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    expect(await screen.findByText('Network response was lost.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledTimes(2));
    const first = createProviderExamMock.mock.calls[0]![0];
    const second = createProviderExamMock.mock.calls[1]![0];
    expect(first.operationKey).toEqual(expect.any(String));
    expect(second.operationKey).toBe(first.operationKey);
  });

  it('uses a new create operation key when the payload changes after a failure', async () => {
    createProviderExamMock
      .mockResolvedValueOnce({ success: false, error: 'Network response was lost.' })
      .mockResolvedValueOnce({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'First title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    expect(await screen.findByText('Network response was lost.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Corrected title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledTimes(2));
    expect(createProviderExamMock.mock.calls[1]![0].operationKey)
      .not.toBe(createProviderExamMock.mock.calls[0]![0].operationKey);
  });

  it('keeps standard settings out of the payload and sends a changed configuration once', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Custom timing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Module 1', { selector: '#sat-create-math-module1Minutes' })).toHaveValue(35);
    fireEvent.change(document.getElementById('sat-create-math-module1Minutes')!, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    createFromReview();
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    const input = createProviderExamMock.mock.calls[0]![0];
    expect(input.configuration.sections.math.module1Minutes).toBe(40);
    expect(input.configuration.sections['reading-writing'].module1Minutes).toBe(32);
    expect(input.configuration.showClassroomScoreReport).toBe(false);
  });

  it('resets hidden timing values when a custom module set skips them', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Easy reading section' } });
    fireEvent.click(screen.getByRole('radio', { name: /Custom modules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(document.getElementById('sat-create-reading-writing-module1Minutes')!, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Reading & Writing: Easy Module 2 only' }));
    expect(screen.queryByLabelText('Module 1', { selector: '#sat-create-reading-writing-module1Minutes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Harder Module 2 at', { selector: '#sat-create-reading-writing-minimumCorrectForHigher' })).not.toBeInTheDocument();
    expect(screen.getByText(/Easy Module 2 · 32 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    createFromReview();
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledOnce());
    const input = createProviderExamMock.mock.calls[0]![0];
    expect(input.configuration.classroomPlan).toEqual({ 'reading-writing': 'm2_easy' });
    expect(input.configuration.sections['reading-writing'].module1Minutes).toBe(32);
    expect(input.configuration.sections['reading-writing'].minimumCorrectForHigher).toBe(13);
  });

  it('disables custom modules with an explanation when Classroom creation is off', () => {
    defaultsMock.data.classroomCreationEnabled = false;
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    const customModules = screen.getByRole('radio', { name: /Custom modules/ });
    expect(customModules).toBeDisabled();
    expect(screen.getByText("Classroom rooms aren't turned on for your organization yet, so custom modules aren't available.")).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Full SAT/ })).toBeChecked();
  });

  it('blocks malformed converter JSON on the Results step', async () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Converter draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const file = new File(['ignored'], 'broken.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{not json' });
    fireEvent.change(screen.getByLabelText('Upload score converter JSON'), { target: { files: [file] } });
    expect(await screen.findByText('The converter file must contain valid JSON.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(createProviderExamMock).not.toHaveBeenCalled();
  });

  it('returns server-invalid converters to Results with the server sentence', async () => {
    createProviderExamMock.mockResolvedValue({ success: false, error: 'scoreType must be "estimated_sat".' });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Bad converter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const file = new File(['{}'], 'converter.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{}' });
    fireEvent.change(screen.getByLabelText('Upload score converter JSON'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('converter.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    createFromReview();
    expect(await screen.findByText('scoreType must be "estimated_sat".')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByText('converter.json')).toBeInTheDocument();
  });

  it('keeps the dialog open and names every invalid field instead of creating', async () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'Bad timing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(document.getElementById('sat-create-math-module1Minutes')!, { target: { value: '0' } });
    fireEvent.change(document.getElementById('sat-create-reading-writing-minimumCorrectForHigher')!, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Module 1 duration must be at least 1 minute.')).toBeInTheDocument();
    expect(screen.getByText('Threshold cannot exceed 27 correct answers.')).toBeInTheDocument();
    expect(createProviderExamMock).not.toHaveBeenCalled();
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useExamListQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('Exams')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading exams' })).toBeInTheDocument();
    expect(screen.queryByText('SAT Practice 06')).not.toBeInTheDocument();
  });

  it('announces the filter result count once data is present', () => {
    renderRoute();
    expect(screen.getByRole('status')).toHaveTextContent('1 exam');
  });

  it('offers Clear search from a filtered-zero state', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exams'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching exams')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
  });

  it('separates active and archived exams into counted status tabs', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam, { ...satExam, id: 'sat-arch', title: 'SAT Archived 01', status: 'archived' }], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.queryByText('SAT Archived 01')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All active 1' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Archived 1' }));
    expect(screen.getByText('SAT Archived 01')).toBeInTheDocument();
    expect(screen.queryByText('SAT Practice 06')).not.toBeInTheDocument();
  });

  it('reaches archived exams when every exam in the library is archived', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [{ ...satExam, id: 'sat-arch', title: 'SAT Archived 01', status: 'archived' }], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('No active exams')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show archived' }));
    expect(screen.getByText('SAT Archived 01')).toBeInTheDocument();
  });

  it('keeps creation disabled for the placeholder alone and enables it once a name is typed', () => {
    // "Practice Test 06" is a placeholder, not a value: an untouched field
    // must not submit. This pins the reported disabled-Create observation
    // to correct behavior instead of a form-state defect.
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    const name = screen.getByLabelText('Exam name');
    expect(name).toHaveAttribute('placeholder', 'Practice Test 06');
    expect(name).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create with standard settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Practice Test 06' } });
    expect(screen.getByRole('button', { name: 'Create with standard settings' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('preserves search text when the status tab changes (04A composition guard)', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam, { ...satExam, id: 'sat-arch', title: 'SAT Archived 01', status: 'archived' }], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exams'), { target: { value: 'SAT' } });
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Archived 1' }));
    expect(screen.getByPlaceholderText('Search exams')).toHaveValue('SAT');
    expect(screen.getByText('SAT Archived 01')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 exam');
  });

  it('closes a pristine dialog with no alertdialog', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New exam' })).not.toBeInTheDocument();
  });

  it('opens the discard alert on dirty close and keeps the typed name on alert Cancel', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const discardAlert = screen.getByRole('alertdialog', { name: 'Discard this exam?' });
    expect(discardAlert).toHaveTextContent('The exam name and settings you entered will be lost.');
    const alertDismissButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(alertDismissButtons[alertDismissButtons.length - 1]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Exam name')).toHaveValue('October Practice');
  });

  it('reopens the discard alert from X and Escape, then discards both', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard this exam?' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).pop() as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Discard this exam?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New exam' })).not.toBeInTheDocument();
  });

  it('keeps the dialog mounted on Cancel while creating and keeps the failed draft intact', async () => {
    createProviderExamMock.mockRejectedValue(new Error('boom'));
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByLabelText('Exam name')).toHaveValue('October Practice');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard this exam?' })).toBeInTheDocument();
  });

  it('keeps the dialog mounted on Cancel while the create request is in flight', () => {
    createProviderExamMock.mockImplementation(() => new Promise(() => {}));
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create exam' }));
    fireEvent.change(screen.getByLabelText('Exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create with standard settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New exam' })).toBeInTheDocument();
  });

  it('renders 04A row chrome without lift, gradient, or glass', () => {
    const { container } = renderRoute();
    const rows = container.querySelectorAll('.sat-list-row');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.className).not.toMatch(/translate/);
    });
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });

  it('opens on Classroom, filters by exam type, and remembers the last type per user in this browser', () => {
    const practice = { ...satExam, id: 'sat-full', slug: 'sat-full', title: 'SAT Full 01', satCustomModules: false };
    useExamListQueryMock.mockReturnValue({ data: { entities: [satExam, practice], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    sessionUser.id = 'user-a';
    const first = renderRoute();
    const typeTabs = screen.getByRole('radiogroup', { name: 'Exam type' });
    expect(within(typeTabs).getByRole('radio', { name: 'Classroom 1' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    expect(screen.queryByText('SAT Full 01')).not.toBeInTheDocument();

    fireEvent.click(within(typeTabs).getByRole('radio', { name: 'Practice 1' }));
    expect(screen.getByText('SAT Full 01')).toBeInTheDocument();
    expect(screen.queryByText('SAT Practice 06')).not.toBeInTheDocument();
    first.unmount();

    expect(window.localStorage.getItem('sat-exam-library-type:user-a')).toBe('practice');
    renderRoute();
    expect(screen.getByRole('radio', { name: 'Practice 1' })).toHaveAttribute('aria-checked', 'true');
    cleanup();

    sessionUser.id = 'user-b';
    renderRoute();
    expect(screen.getByRole('radio', { name: 'Classroom 1' })).toHaveAttribute('aria-checked', 'true');
  });

  it('points to the other type when the selected type has no exams', () => {
    const practice = { ...satExam, satCustomModules: false };
    useExamListQueryMock.mockReturnValue({ data: { entities: [practice], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('No Classroom exams')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Practice exams' }));
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
  });
});
