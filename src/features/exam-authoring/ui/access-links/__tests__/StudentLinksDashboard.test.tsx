import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamEntity } from '../../../../../types/domain';
import type { AccessDistributionOverview, AssessmentAccessLink } from '../../../contracts/accessLinks';
import { StudentLinksDashboard } from '../StudentLinksDashboard';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  lifecycle: vi.fn(),
  duplicate: vi.fn(),
}));

vi.mock('../../../api/assessmentAccessLinkQueries', () => ({
  useCreateAccessLink: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateAccessLink: () => ({ mutateAsync: mocks.update, isPending: false }),
  useSetAccessLinkLifecycle: () => ({ mutateAsync: mocks.lifecycle, isPending: false }),
  useDuplicateAccessLink: () => ({ mutateAsync: mocks.duplicate, isPending: false }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false }),
  useAccessLinkActivity: () => ({ data: [], isLoading: false }),
}));

vi.mock('../AccessLinkEditorSheet', () => ({
  AccessLinkEditorSheet: ({ open }: { open: boolean }) => open ? <div data-testid="link-editor">editor</div> : null,
}));
vi.mock('../AccessLinkShareSheet', () => ({
  AccessLinkShareSheet: () => null,
  AccessLinkPresentView: () => null,
}));

const exam: ExamEntity = {
  id: 'exam-1', slug: 'sat', title: 'Digital SAT', providerKey: 'sat', providerExamType: 'sat',
  type: 'Academic', status: 'published', visibility: 'organization', owner: 'builder-1',
  createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
  currentDraftVersionId: 'draft-5', currentPublishedVersionId: 'version-5',
  canEdit: true, canPublish: true, canDelete: true, revision: 7, schemaVersion: 4,
};

function link(id: string, name: string, versionId: string, versionNumber: number, status: AssessmentAccessLink['status']): AssessmentAccessLink {
  return {
    id, examId: exam.id, examTitle: exam.title, providerKey: 'sat', publishedVersionId: versionId,
    versionNumber, publishScope: 'full', scheduleId: `schedule-${id}`, name, audienceType: 'cohort', audienceLabel: name,
    accessMode: 'student_code', availabilityType: 'anytime', opensAt: null, closesAt: null,
    lifecycleState: status === 'paused' ? 'paused' : status === 'revoked' ? 'revoked' : 'active', status,
    selectedStudentCount: 0, metrics: { registered: 10, started: 8, submitted: 4 },
    isCurrentRelease: versionId === exam.currentPublishedVersionId, hasParticipation: true, revision: 3,
    createdAt: '2026-08-28T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
  };
}

const overview: AccessDistributionOverview = {
  currentPublishedVersion: {
    id: 'version-5', versionNumber: 5, revision: 1, publishNotes: null, publishScope: 'full', createdAt: '2026-08-28T00:00:00Z',
  },
  links: [
    link('link-current', 'Saturday Class', 'version-5', 5, 'live'),
    link('link-upcoming', 'Monday Class', 'version-5', 5, 'upcoming'),
    link('link-old', 'Old Scholarship', 'version-4', 4, 'live'),
  ],
};

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.lifecycle.mockReset();
  mocks.duplicate.mockReset();
  mocks.lifecycle.mockResolvedValue(overview.links[0]);
  mocks.duplicate.mockResolvedValue({ ...overview.links[0], id: 'link-copy', name: 'Saturday Class Copy' });
});

describe('StudentLinksDashboard', () => {
  it('keeps older-release links visible by default after a newer release is published', () => {
    render(<StudentLinksDashboard exam={exam} overview={overview} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} />);

    expect(screen.getAllByText('Saturday Class').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Monday Class').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Old Scholarship').length).toBeGreaterThan(0);
    expect(screen.queryByText('No matching links')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Old Scholarship')[0]!);
    expect(screen.getByText('Uses Version 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Version 5 Link' })).toBeInTheDocument();
  });

  it('reconciles detail selection with the visible search result', async () => {
    render(<StudentLinksDashboard exam={exam} overview={overview} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search Student Links'), { target: { value: 'Monday' } });

    // Search is debounced (150ms) to avoid re-sorting on every keystroke.
    await waitFor(() => expect(screen.queryByText('Old Scholarship')).not.toBeInTheDocument());
    expect(screen.getAllByText('Monday Class').length).toBeGreaterThan(0);
    expect(screen.queryByText('No matching links')).not.toBeInTheDocument();
  });

  it('runs lifecycle and duplicate actions without mutating a published release', async () => {
    render(<StudentLinksDashboard exam={exam} overview={overview} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Actions for Saturday Class'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause Link' }));
    await waitFor(() => expect(mocks.lifecycle).toHaveBeenCalledWith({
      linkId: 'link-current', request: { revision: 3, state: 'paused' },
    }));

    fireEvent.click(screen.getByLabelText('Actions for Saturday Class'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Link' }));
    await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith({
      linkId: 'link-current', request: { revision: 3, name: 'Saturday Class Copy', releaseTarget: 'source' },
    }));
  });

  it('creates a replacement link explicitly against the current release', async () => {
    render(<StudentLinksDashboard exam={exam} overview={overview} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} />);
    fireEvent.click(screen.getByText('Old Scholarship'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Version 5 Link' }));

    await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith({
      linkId: 'link-old', request: { revision: 3, name: 'Old Scholarship', releaseTarget: 'current' },
    }));
  });

  it('makes Student Access creation the primary empty-state action', () => {
    render(<StudentLinksDashboard exam={exam} overview={{ ...overview, links: [] }} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} />);
    // Header and empty state both offer the primary creation action.
    expect(screen.getAllByRole('button', { name: 'New Student Link' }).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'New Student Link' })[0]!);
    expect(screen.getByTestId('link-editor')).toBeInTheDocument();
  });
});
