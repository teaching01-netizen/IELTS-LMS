import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FolderDeleteDialog, FolderRenameDialog } from '../FolderDialogs';
import type { LibraryFolder } from '../types';

const folder: LibraryFolder = { id: 'folder-1', name: 'Math', revision: 0, providerKey: 'sat', scopeKey: 'library', createdBy: 'staff', createdAt: '', updatedAt: '' };

it('preserves a typed rename when refreshed folder data accompanies a conflict', () => {
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

it('tells the truth about exams and subfolders and disables deletion of a nonempty folder', () => {
  const onConfirm = vi.fn();
  render(
    <FolderDeleteDialog
      folder={folder}
      examCount={2}
      childFolderCount={1}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      pending={false}
      serverError={null}
    />,
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Delete Math?' });
  expect(dialog).toHaveTextContent('This folder still holds 2 exams and 1 subfolder.');
  expect(dialog).toHaveTextContent('deleting a folder never deletes exams');
  const confirm = screen.getByRole('button', { name: 'Delete', exact: true });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('describes an empty folder honestly and keeps a server error visible for retry', () => {
  const onConfirm = vi.fn();
  const { rerender } = render(
    <FolderDeleteDialog
      folder={folder}
      examCount={0}
      childFolderCount={0}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      pending={false}
      serverError={null}
    />,
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Delete Math?' });
  expect(dialog).toHaveTextContent('This folder is empty.');
  const confirm = screen.getByRole('button', { name: 'Delete', exact: true });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);

  rerender(
    <FolderDeleteDialog
      folder={folder}
      examCount={0}
      childFolderCount={0}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      pending={false}
      serverError="Folder service unavailable"
    />,
  );
  expect(screen.getByRole('alertdialog', { name: 'Delete Math?' })).toHaveTextContent('Folder service unavailable');
  expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
});

it('locks the confirmation while the delete is pending', () => {
  const onClose = vi.fn();
  render(
    <FolderDeleteDialog
      folder={folder}
      examCount={0}
      childFolderCount={0}
      onClose={onClose}
      onConfirm={vi.fn()}
      pending
      serverError={null}
    />,
  );
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).not.toHaveBeenCalled();
});
