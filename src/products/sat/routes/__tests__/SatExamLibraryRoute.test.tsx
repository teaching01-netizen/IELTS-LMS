import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatExamLibraryRoute } from '../SatExamLibraryRoute';

const useExamListQueryMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());
const invalidateExamListMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({
  useExamListQuery: useExamListQueryMock,
  invalidateExamList: invalidateExamListMock,
}));
vi.mock('../../../../features/exam-authoring/api/examAuthoringFacade', () => ({
  examAuthoringFacade: { lifecycle: { createProviderExam: createProviderExamMock } },
}));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { displayName: 'Admin', email: 'admin@example.com' } } }),
}));

const satExam = {
  id: 'sat-1', slug: 'sat-1', title: 'SAT Practice 06', providerKey: 'sat', type: 'Academic', status: 'draft',
  visibility: 'organization', owner: 'Admin', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-30T00:00:00Z',
  currentDraftVersionId: 'draft-1', currentPublishedVersionId: null, canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4,
};
const ieltsExam = { ...satExam, id: 'ielts-1', slug: 'ielts-1', title: 'IELTS Academic 01', providerKey: 'ielts' };

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SatExamLibraryRoute /></MemoryRouter></QueryClientProvider>);
}

describe('SatExamLibraryRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    invalidateExamListMock.mockResolvedValue(undefined);
  });

  it('requests the SAT provider boundary and never renders an IELTS exam', () => {
    renderRoute();
    expect(useExamListQueryMock).toHaveBeenCalledWith(true, 'sat');
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    expect(screen.queryByText('IELTS Academic 01')).not.toBeInTheDocument();
  });

  it('creates a SAT directly without exposing a provider selector', async () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    expect(screen.queryByText('Assessment provider')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledWith(
      { providerKey: 'sat', providerExamType: 'SAT', title: 'October Practice' }, 'Admin',
    ));
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useExamListQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('Exam Library')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading SAT exams' })).toBeInTheDocument();
    expect(screen.queryByText('SAT Practice 06')).not.toBeInTheDocument();
  });

  it('announces the filter result count once data is present', () => {
    renderRoute();
    expect(screen.getByRole('status')).toHaveTextContent('1 exam');
  });

  it('offers Clear Search from a filtered-zero state', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam title'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching SAT exams')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
  });

  it('toggles archived exams without losing search results', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam, { ...satExam, id: 'sat-arch', title: 'SAT Archived 01', status: 'archived' }], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.queryByText('SAT Archived 01')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show archived' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText('SAT Archived 01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide archived' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps Create disabled for the placeholder alone and enables it once a name is typed', () => {
    // "Practice Test 06" is a placeholder, not a value: an untouched field
    // must not submit. This pins the reported disabled-Create observation
    // to correct behavior instead of a form-state defect.
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    const name = screen.getByLabelText('SAT exam name');
    expect(name).toHaveAttribute('placeholder', 'Practice Test 06');
    expect(name).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Practice Test 06' } });
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('preserves search text when the archived toggle changes (04A composition guard)', () => {
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam, { ...satExam, id: 'sat-arch', title: 'SAT Archived 01', status: 'archived' }], exams: [] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam title'), { target: { value: 'SAT Practice' } });
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show archived' }));
    expect(screen.getByPlaceholderText('Search exam title')).toHaveValue('SAT Practice');
    expect(screen.getByText('SAT Practice 06')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 exam');
  });

  it('closes a pristine dialog on Cancel with no alertdialog', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create SAT' })).not.toBeInTheDocument();
  });

  it('opens the discard alert on dirty Cancel and keeps the typed name on alert Cancel', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const discardAlert = screen.getByRole('alertdialog', { name: 'Discard this SAT?' });
    expect(discardAlert).toHaveTextContent('The name you entered will be lost.');
    const alertDismissButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(alertDismissButtons[alertDismissButtons.length - 1]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('SAT exam name')).toHaveValue('October Practice');
  });

  it('reopens the discard alert from X and Escape, then discards both', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard this SAT?' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).pop() as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Discard this SAT?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create SAT' })).not.toBeInTheDocument();
  });

  it('keeps the dialog mounted on Cancel while creating and keeps the failed draft intact', async () => {
    createProviderExamMock.mockRejectedValue(new Error('boom'));
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByLabelText('SAT exam name')).toHaveValue('October Practice');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard this SAT?' })).toBeInTheDocument();
  });

  it('keeps the dialog mounted on Cancel while the create request is in flight', () => {
    createProviderExamMock.mockImplementation(() => new Promise(() => {}));
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Create SAT' })).toBeInTheDocument();
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
});
