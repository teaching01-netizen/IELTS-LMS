import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FolderDestinationBrowser } from '../FolderDestinationBrowser';
import { ExamMoveDialog } from '../FolderDialogs';
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
    expect(screen.getByRole('navigation', { name: /Destination/ })).toHaveTextContent('Exams');
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
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destination path' })).getByRole('button', { name: 'Exams' }));
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
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Destination path' })).getByRole('button', { name: 'Exams' }));
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
