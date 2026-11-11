import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FolderRenameDialog } from '../FolderDialogs';
import type { LibraryFolder } from '../types';

it('preserves a typed rename when refreshed folder data accompanies a conflict', () => {
  const folder: LibraryFolder = { id: 'folder-1', name: 'Math', revision: 0, providerKey: 'sat', scopeKey: 'library', createdBy: 'staff', createdAt: '', updatedAt: '' };
  const onRename = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(<FolderRenameDialog key={folder.id} folder={folder} onRename={onRename} onClose={onClose} pending={false} serverError={null} />);
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'November' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }));
  expect(onRename).toHaveBeenCalledWith('November');
  rerender(<FolderRenameDialog key={folder.id} folder={{ ...folder, revision: 1 }} onRename={onRename} onClose={onClose} pending={false} serverError="A folder with this name already exists here." />);
  expect(screen.getByLabelText('Folder name')).toHaveValue('November');
  expect(screen.getByRole('alert')).toHaveTextContent('A folder with this name already exists here.');
});
