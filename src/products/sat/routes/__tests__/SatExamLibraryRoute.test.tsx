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
vi.mock('../../../../features/exam-authoring/application/examAuthoringFacade', () => ({
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
    fireEvent.click(screen.getByRole('button', { name: 'New SAT' }));
    expect(screen.queryByText('Assessment provider')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SAT exam name'), { target: { value: 'October Practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createProviderExamMock).toHaveBeenCalledWith(
      { providerKey: 'sat', providerExamType: 'SAT', title: 'October Practice' }, 'Admin',
    ));
  });
});
