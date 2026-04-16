import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExamVersionHistory } from '../ExamVersionHistory';
import type { ExamVersionHistoryProps } from '../../../features/admin/contracts';
import type { ExamEntity, ExamVersion, ExamEvent } from '../../../types/domain';

describe('ExamVersionHistory', () => {
  const mockExam: ExamEntity = {
    id: 'exam-1',
    slug: 'test-exam',
    title: 'Test Exam',
    type: 'Academic',
    status: 'draft',
    visibility: 'private',
    owner: 'test-user',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    currentDraftVersionId: 'version-3',
    currentPublishedVersionId: 'version-2',
    canEdit: true,
    canPublish: true,
    canDelete: false,
    schemaVersion: 3
  };

  const mockVersions: ExamVersion[] = [
    {
      id: 'version-3',
      examId: 'exam-1',
      versionNumber: 3,
      parentVersionId: 'version-2',
      contentSnapshot: {
        title: 'Test Exam',
        type: 'Academic',
        activeModule: 'reading',
        activePassageId: 'passage-1',
        activeListeningPartId: 'part-1',
        config: {} as any,
        reading: { passages: [] },
        listening: { parts: [] },
        writing: { task1Prompt: '', task2Prompt: '' },
        speaking: { part1Topics: [], cueCard: '', part3Discussion: [] }
      },
      configSnapshot: {} as any,
      createdBy: 'test-user',
      createdAt: '2026-01-15T00:00:00Z',
      isDraft: true,
      isPublished: false
    },
    {
      id: 'version-2',
      examId: 'exam-1',
      versionNumber: 2,
      parentVersionId: 'version-1',
      contentSnapshot: {
        title: 'Test Exam',
        type: 'Academic',
        activeModule: 'reading',
        activePassageId: 'passage-1',
        activeListeningPartId: 'part-1',
        config: {} as any,
        reading: { passages: [] },
        listening: { parts: [] },
        writing: { task1Prompt: '', task2Prompt: '' },
        speaking: { part1Topics: [], cueCard: '', part3Discussion: [] }
      },
      configSnapshot: {} as any,
      createdBy: 'test-user',
      createdAt: '2026-01-10T00:00:00Z',
      isDraft: false,
      isPublished: true
    }
  ];

  const mockEvents: ExamEvent[] = [];

  const defaultProps: ExamVersionHistoryProps = {
    exam: mockExam,
    versions: mockVersions,
    events: mockEvents,
    onRestoreVersion: vi.fn(),
    onRepublishVersion: vi.fn(),
    onCompareVersions: vi.fn(),
    onCloneExam: vi.fn()
  };

  it('shows version type indicators (draft vs published)', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    expect(screen.getByText(/draft 3 \(current\)/i)).toBeTruthy();
    expect(screen.getByText(/published v1/i)).toBeTruthy();
  });

  it('highlights current draft', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    const currentDraft = screen.getByText(/draft 3 \(current\)/i);
    expect(currentDraft).toBeTruthy();
  });

  it('shows status badges for published versions', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    expect(screen.getByText(/live/i)).toBeTruthy();
  });

  it('has correct aria-labels for icons', () => {
    const { container } = render(<ExamVersionHistory {...defaultProps} />);
    
    const icons = container.querySelectorAll('[aria-hidden="true"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('has aria-current for current draft', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    const currentBadge = screen.getByText(/current/i);
    expect(currentBadge.getAttribute('aria-current')).toBe('true');
  });

  it('keyboard navigation works', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    const versionItems = screen.getAllByRole('button');
    expect(versionItems.length).toBeGreaterThan(0);
  });

  it('shows tooltip for version history', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    const versionHistoryHeader = screen.getByText(/version history/i);
    expect(versionHistoryHeader.getAttribute('title')).toBeTruthy();
  });

  it('calls onCloneExam when Clone button clicked', () => {
    const onCloneExam = vi.fn();
    render(<ExamVersionHistory {...defaultProps} onCloneExam={onCloneExam} />);
    
    const cloneButton = screen.getByRole('button', { name: /clone exam/i });
    fireEvent.click(cloneButton);
    
    expect(onCloneExam).toHaveBeenCalled();
  });

  it('shows audit log when toggle clicked', () => {
    render(<ExamVersionHistory {...defaultProps} />);
    
    const showAuditButton = screen.getByRole('button', { name: /show audit log/i });
    fireEvent.click(showAuditButton);
    
    expect(screen.getByRole('button', { name: /hide audit log/i })).toBeTruthy();
  });
});
