import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExamBulkActionBar } from '../ExamBulkActionBar';

describe('ExamBulkActionBar', () => {
  it('renders Delete when handler is provided and calls it after inline confirmation', async () => {
    const onBulkDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <ExamBulkActionBar
        selectedCount={2}
        onClearSelection={() => {}}
        onBulkDelete={onBulkDelete}
      />,
    );

    // Destructive deletes require the two-step inline confirmation (no window.confirm).
    fireEvent.click(screen.getByRole('button', { name: /delete 2 selected exams/i }));
    expect(onBulkDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm delete selected exams/i }));
    await vi.waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(1));
  });

  it('does not render Delete when handler is not provided', () => {
    render(<ExamBulkActionBar selectedCount={1} onClearSelection={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it.each([
    ['Publish', /publish 3 selected exams/i, /confirm publish selected exams/i],
    ['Unpublish', /unpublish 3 selected exams/i, /confirm unpublish selected exams/i],
    ['Archive', /archive 3 selected exams/i, /confirm archive selected exams/i],
  ] as const)('requires inline confirmation before bulk %s (S2-C18)', async (_label, armName, confirmName) => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const props =
      _label === 'Publish'
        ? { onBulkPublish: handler }
        : _label === 'Unpublish'
          ? { onBulkUnpublish: handler }
          : { onBulkArchive: handler };

    render(<ExamBulkActionBar selectedCount={3} onClearSelection={() => {}} {...props} />);

    // One click arms the confirm; the handler must not fire yet.
    fireEvent.click(screen.getByRole('button', { name: armName }));
    expect(handler).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: confirmName }));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });
});

