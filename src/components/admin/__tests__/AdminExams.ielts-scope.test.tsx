import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Exam } from '../../../types';
import type { ExamListProps } from '../../../features/exam-authoring/contracts/examList';
import type { ExamEntity } from '../../../types/domain';

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

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
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
    } as unknown as Exam['content'],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<ExamEntity> = {}): ExamEntity {
  return {
    id: 'exam-1',
    slug: 'alpha',
    title: 'Alpha Academic Mock',
    providerKey: 'ielts',
    type: 'Academic',
    status: 'draft',
    visibility: 'organization',
    owner: 'Ada Author',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-10T09:00:00.000Z',
    currentDraftVersionId: null,
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 4,
    ...overrides,
  };
}

function buildProps(overrides: Partial<ExamListProps> = {}): ExamListProps {
  return {
    providerScope: 'ielts',
    onNavigate: vi.fn(),
    exams: [
      makeExam({ id: 'ielts-1', title: 'IELTS Academic' }),
      makeExam({ id: 'act-1', title: 'ACT Science Drill', type: 'ACT' }),
      makeExam({ id: 'sat-1', title: 'SAT Practice', type: 'Academic' }),
    ],
    examEntities: [
      makeEntity({ id: 'ielts-1', title: 'IELTS Academic', providerKey: 'ielts' }),
      makeEntity({ id: 'act-1', title: 'ACT Science Drill', providerKey: 'act', type: 'ACT' }),
      makeEntity({ id: 'sat-1', title: 'SAT Practice', providerKey: 'sat' }),
    ],
    onEditExam: vi.fn(),
    onCreateExam: vi.fn(),
    ...overrides,
  };
}

describe('AdminExams IELTS scope (AT-06/AT-09)', () => {
  it('hides SAT rows from the IELTS library but keeps IELTS and ACT', () => {
    render(<AdminExams {...buildProps()} />);
    expect(screen.getByText('IELTS Academic')).toBeInTheDocument();
    expect(screen.getByText('ACT Science Drill')).toBeInTheDocument();
    expect(screen.queryByText('SAT Practice')).not.toBeInTheDocument();
  });

  it('offers IELTS and ACT providers only at creation (no SAT)', () => {
    render(<AdminExams {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Exam' }));
    expect(screen.getByText('IELTS', { selector: 'span.block' })).toBeInTheDocument();
    expect(screen.getByText('ACT Science', { selector: 'span.block' })).toBeInTheDocument();
    expect(screen.queryByText('Digital SAT')).not.toBeInTheDocument();
  });

  it('maps ACT creation to the ACT provider input', () => {
    const onCreateExam = vi.fn();
    render(<AdminExams {...buildProps({ onCreateExam })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Exam' }));
    fireEvent.click(screen.getByText('ACT Science', { selector: 'span.block' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Academic Practice Test 5'), {
      target: { value: 'ACT Drill' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Open Builder' }));
    expect(onCreateExam).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: 'act', providerExamType: 'ACT', title: 'ACT Drill' }),
    );
  });
});
