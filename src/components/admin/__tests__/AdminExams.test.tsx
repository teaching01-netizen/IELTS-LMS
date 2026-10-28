import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Exam } from '../../../types';
import type { ExamListProps } from '../../../features/exam-authoring/contracts/examList';
import type { BulkOperationResult } from '../../../types/domain';

// The component is props-driven (ExamListProps) — there is no service or
// repository seam to mock. react-virtuoso is the only mock needed: it relies
// on layout measurement and renders no rows in jsdom, so replace it with a
// synchronous renderer. Real ExamBulkActionBar / ExamFiltersPanel are kept.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => (
    <div data-testid="virtuoso-list">
      {(data ?? []).map((item: any, index: number) => (
        <div key={item?.id ?? index}>{itemContent?.(index, item)}</div>
      ))}
    </div>
  ),
}));

import { AdminExams } from '../AdminExams';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

function renderInRouter(ui: ReactElement, initialEntry = '/admin/exams') {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>);
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  const base = {
    id: 'exam-1',
    title: 'Alpha Academic Mock',
    type: 'Academic',
    status: 'Draft',
    author: 'Ada Author',
    lastModified: '2026-01-10T09:00:00.000Z',
    createdAt: '2026-01-01T09:00:00.000Z',
    content: {
      reading: { passages: [] },
      listening: { parts: [] },
      config: {
        sections: {
          writing: { enabled: false },
          speaking: { enabled: false },
        },
      },
    },
  };
  return { ...base, ...overrides } as unknown as Exam;
}

function buildProps(overrides: Partial<ExamListProps> = {}): ExamListProps {
  return {
    onNavigate: vi.fn(),
    exams: [
      makeExam({ id: 'exam-1', title: 'Alpha Academic Mock', status: 'Draft' }),
      makeExam({
        id: 'exam-2',
        title: 'Beta General Mock',
        type: 'General Training',
        status: 'Published',
        author: 'Ben Author',
      }),
    ],
    onEditExam: vi.fn(),
    onCreateExam: vi.fn(),
    ...overrides,
  };
}

function bulkResult(ids: string[]): BulkOperationResult {
  return {
    success: true,
    total: ids.length,
    succeeded: ids.length,
    failed: 0,
    results: ids.map((examId) => ({ examId, examTitle: examId, success: true })),
  };
}

describe('AdminExams', () => {
  it('renders the exam list with titles and statuses', () => {
    renderInRouter(<AdminExams {...buildProps()} />);

    expect(screen.getByText('Alpha Academic Mock')).toBeInTheDocument();
    expect(screen.getByText('Beta General Mock')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('filters the list via the search box and shows the filtered empty state', () => {
    renderInRouter(<AdminExams {...buildProps()} />);
    const search = screen.getByPlaceholderText('Search exams...');

    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.queryByText('Alpha Academic Mock')).not.toBeInTheDocument();
    expect(screen.getByText('Beta General Mock')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'no-such-exam' } });
    expect(
      screen.getByRole('heading', { name: 'No exams match your filters' }),
    ).toBeInTheDocument();
  });

  it('selecting an exam reveals the bulk action bar', () => {
    renderInRouter(<AdminExams {...buildProps()} />);

    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument();
    // Checkbox order in list view: header select-all first, then one per row.
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1] as HTMLElement);

    expect(screen.getByText('1 exam selected')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument();
  });

  it('bulk delete fires onBulkDelete after inline confirmation', async () => {
    const onBulkDelete = vi.fn().mockResolvedValue(bulkResult(['exam-1', 'exam-2']));
    renderInRouter(<AdminExams {...buildProps({ onBulkDelete })} />);

    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement); // select all
    expect(screen.getByText('2 exams selected')).toBeInTheDocument();

    // Destructive bulk actions need the two-step inline confirmation.
    fireEvent.click(screen.getByRole('button', { name: /delete 2 selected exams/i }));
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete selected exams/i }));

    await vi.waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
    expect(onBulkDelete).toHaveBeenCalledWith(expect.arrayContaining(['exam-1', 'exam-2']));
    expect(await screen.findByText('Bulk Operation Result')).toBeInTheDocument();
  });

  it('keeps search and sort in the URL so Back and refresh return to the same view', () => {
    const first = renderInRouter(<AdminExams {...buildProps()} />, '/admin/exams?q=Beta&sort=title&dir=asc');
    expect(screen.getByPlaceholderText('Search exams...')).toHaveValue('Beta');
    expect(screen.queryByText('Alpha Academic Mock')).not.toBeInTheDocument();
    expect(screen.getByText('Beta General Mock')).toBeInTheDocument();
    first.unmount();

    // Invalid values fall back to defaults instead of breaking the list.
    renderInRouter(<AdminExams {...buildProps()} />, '/admin/exams?sort=nonsense&dir=sideways&status=Bogus');
    expect(screen.getByText('Alpha Academic Mock')).toBeInTheDocument();
    expect(screen.getByText('Beta General Mock')).toBeInTheDocument();
  });

  it('never applies a bulk action to a selected exam the current filter hides', async () => {
    const onBulkDelete = vi.fn().mockResolvedValue(bulkResult(['exam-2']));
    renderInRouter(<AdminExams {...buildProps({ onBulkDelete })} />);

    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement); // select both
    fireEvent.change(screen.getByPlaceholderText('Search exams...'), { target: { value: 'Beta' } });

    expect(screen.getByText('1 exam selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete 1 selected exam/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm delete selected exams/i }));
    await vi.waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
    expect(onBulkDelete).toHaveBeenCalledWith(['exam-2']);
  });

  it('create flow fires onCreateExam with the entered title', () => {
    const onCreateExam = vi.fn();
    renderInRouter(<AdminExams {...buildProps({ onCreateExam })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Exam' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Academic Practice Test 5'), {
      target: { value: 'Brand New Exam' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Open Builder' }));

    expect(onCreateExam).toHaveBeenCalledTimes(1);
    expect(onCreateExam).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Brand New Exam', providerKey: 'ielts' }),
    );
  });

  it('renders the empty state when no exams exist', () => {
    renderInRouter(<AdminExams {...buildProps({ exams: [] })} />);

    expect(screen.getByRole('heading', { name: 'No exams yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first exam' }));
    expect(screen.getByRole('heading', { name: 'Create New Exam' })).toBeInTheDocument();
  });
});
