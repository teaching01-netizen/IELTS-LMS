import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SatButton, SatField } from "../ui/SatPage";
import { SatConfirmDialog, SatFormDialog } from "../ui/ConfirmDialog";
import type { LibraryFolder } from "./types";
import { ancestorsOf, childrenOf, descendantIds } from "./types";

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Folder name is required.";
  if ([...trimmed].length > 255) return "Folder name must contain between 1 and 255 characters.";
  if (trimmed === "." || trimmed === "..") return 'Folder name cannot be "." or "..".';
  if (trimmed.includes("/") || trimmed.includes("\\")) return 'Folder name cannot contain "/" or "\\".';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return "Folder name cannot contain control characters.";
  return null;
}

export function FolderCreateDialog({
  open,
  parentName,
  onClose,
  onCreate,
  pending,
  serverError,
}: {
  open: boolean;
  parentName: string | null;
  onClose: () => void;
  onCreate: (name: string) => void;
  pending: boolean;
  serverError: string | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open ]);
  if (!open) return null;
  const submit = () => {
    const invalid = validateName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    onCreate(name.trim());
  };
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Library"
      title={parentName ? `New subfolder in ${parentName}` : "New folder"}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={pending}>Cancel</SatButton>
          <SatButton variant="primary" onClick={submit} pending={pending} disabled={!name.trim()}>Create folder</SatButton>
        </div>
      }
    >
      <div className="px-5 py-5">
        <SatField id="sat-folder-name" label="Folder name" error={error ?? serverError ?? null}>
          {(control) => (
            <input
              {...control}
              value={name}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="For example, Autumn mocks"
              autoComplete="off"
              className="sat-input"
            />
          )}
        </SatField>
      </div>
    </SatFormDialog>
  );
}

export function FolderRenameDialog({
  folder,
  onClose,
  onRename,
  pending,
  serverError,
}: {
  folder: LibraryFolder | null;
  onClose: () => void;
  onRename: (name: string) => void;
  pending: boolean;
  serverError: string | null;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!folder) return null;
  const submit = () => {
    const invalid = validateName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    onRename(name.trim());
  };
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Library"
      title={`Rename ${folder.name}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={pending}>Cancel</SatButton>
          <SatButton variant="primary" onClick={submit} pending={pending} disabled={!name.trim()}>Rename</SatButton>
        </div>
      }
    >
      <div className="px-5 py-5">
        <SatField id="sat-folder-rename" label="Folder name" error={error ?? serverError ?? null}>
          {(control) => (
            <input
              {...control}
              value={name}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              autoComplete="off"
              className="sat-input"
            />
          )}
        </SatField>
      </div>
    </SatFormDialog>
  );
}

export function FolderDeleteDialog({
  folder,
  examCount,
  onClose,
  onConfirm,
  pending,
}: {
  folder: LibraryFolder | null;
  examCount: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (!folder) return null;
  // Delete-pending guard: prevent repeated submits while the delete is in
  // flight. The shared confirm dialog has no pending prop, so guard here by
  // disabling dismissal and ignoring repeat confirms.
  const guardedConfirm = () => {
    if (pending) return;
    onConfirm();
  };
  const guardedClose = () => {
    if (pending) return;
    onClose();
  };
  return (
    <SatConfirmDialog
      open
      title={`Delete ${folder.name}?`}
      description={
        examCount > 0
          ? `This folder still holds ${examCount} ${examCount === 1 ? "exam" : "exams"}. Move its contents to the Library first — deleting a folder never deletes exams.`
          : "Empty folders delete immediately. Exams are never deleted with a folder."
      }
      confirmLabel={pending ? "Deleting…" : "Delete"}
      destructive
      onCancel={guardedClose}
      onConfirm={guardedConfirm}
    />
  );
}

export function FolderMoveDialog({
  open,
  folders,
  movingId,
  currentParentId,
  onClose,
  onMove,
  pending,
  serverError,
  title,
}: {
  open: boolean;
  folders: LibraryFolder[];
  movingId: string;
  currentParentId: string | null;
  onClose: () => void;
  onMove: (parentId: string | null) => void;
  pending: boolean;
  serverError: string | null;
  title: string;
}) {
  const [target, setTarget] = useState<string | null>(currentParentId);
  useEffect(() => {
    if (open) setTarget(currentParentId);
  }, [open, currentParentId]);
  const excluded = useMemo(() => {
    const desc = descendantIds(folders, movingId);
    desc.add(movingId);
    return desc;
  }, [folders, movingId]);
  if (!open) return null;
  const roots = childrenOf(folders, null);
  const renderOptions = (parentId: string | null, depth: number): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    for (const folder of childrenOf(folders, parentId)) {
      if (excluded.has(folder.id)) continue;
      nodes.push(
        <option key={folder.id} value={folder.id}>
          {"\u00A0\u00A0".repeat(depth)}{folder.name}
        </option>,
      );
      nodes.push(...renderOptions(folder.id, depth + 1));
    }
    return nodes;
  };
  const ancestors = ancestorsOf(folders, movingId).map((f) => f.name).join(" / ");
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Library"
      title={title}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={pending}>Cancel</SatButton>
          <SatButton variant="primary" onClick={() => onMove(target)} pending={pending}>Move here</SatButton>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-5">
        {ancestors ? <p className="text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Now in {ancestors}</p> : null}
        <label htmlFor="sat-folder-move-target" className="block text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
          Destination
        </label>
        <select
          id="sat-folder-move-target"
          value={target ?? ""}
          disabled={pending}
          onChange={(event) => setTarget(event.target.value === "" ? null : event.target.value)}
          className="sat-input min-h-11 w-full"
        >
          <option value="">Library (top level)</option>
          {renderOptions(null, 0)}
        </select>
        {roots.length === 0 && target === null ? (
          <p className="text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Already at the top level.</p>
        ) : null}
        {serverError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{serverError}</p> : null}
      </div>
    </SatFormDialog>
  );
}

export function ExamMoveDialog({
  open,
  folders,
  count,
  compatible,
  onClose,
  onMove,
  onNewFolder,
  pending,
  serverError,
}: {
  open: boolean;
  folders: LibraryFolder[];
  count: number;
  compatible: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
  onNewFolder: (name: string, parentId: string | null) => Promise<string | null>;
  pending: boolean;
  serverError: string | null;
}) {
  const selectId = useId();
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setTarget("");
      setNewName("");
      setNewError(null);
      setCreating(false);
    }
  }, [open ]);
  if (!open) return null;
  const renderOptions = (parentId: string | null, depth: number): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    for (const folder of childrenOf(folders, parentId)) {
      nodes.push(
        <option key={folder.id} value={folder.id}>
          {"\u00A0\u00A0".repeat(depth)}{folder.name}
        </option>,
      );
      nodes.push(...renderOptions(folder.id, depth + 1));
    }
    return nodes;
  };
  const submitNewFolder = async () => {
    const invalid = validateName(newName);
    if (invalid) {
      setNewError(invalid);
      return;
    }
    setNewError(null);
    // Create inside the currently selected destination; empty target means Library root.
    const created = await onNewFolder(newName.trim(), target === "" ? null : target);
    if (created) {
      setTarget(created);
      setCreating(false);
      setNewName("");
    }
  };
  const destName = target === "" ? "Library" : (folders.find((f) => f.id === target)?.name ?? "Library");
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Library"
      title={`Move ${count === 1 ? "exam" : `${count} exams`} to`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={pending}>Cancel</SatButton>
          <SatButton variant="primary" onClick={() => onMove(target === "" ? null : target)} pending={pending} disabled={!compatible}>
            Move
          </SatButton>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-5">
        {!compatible ? (
          <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">
            Selected exams belong to different libraries. Move one library at a time.
          </p>
        ) : null}
        <label htmlFor={selectId} className="block text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
          Destination
        </label>
        <select
          id={selectId}
          value={target}
          disabled={pending || !compatible}
          onChange={(event) => setTarget(event.target.value)}
          className="sat-input min-h-11 w-full"
        >
          <option value="">Library (top level)</option>
          {renderOptions(null, 0)}
        </select>
        <div className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3">
          {creating ? (
            <div className="space-y-2">
              <p className="text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                New folder in {destName} — exams move there immediately.
              </p>
              <div className="flex gap-2">
                <input
                  ref={newInputRef}
                  value={newName}
                  disabled={pending}
                  onChange={(event) => { setNewName(event.target.value); setNewError(null); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitNewFolder();
                    }
                  }}
                  placeholder="New folder name"
                      aria-label="New folder name"
                  className="sat-input min-h-11 min-w-0 flex-1"
                />
                <SatButton
                  variant="secondary"
                  disabled={pending || !compatible || !newName.trim()}
                  onClick={() => void submitNewFolder()}
                >
                  Create and move
                </SatButton>
              </div>
              {newError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{newError}</p> : null}
            </div>
          ) : (
            <SatButton variant="quiet" onClick={() => { setCreating(true); requestAnimationFrame(() => newInputRef.current?.focus()); }} disabled={pending || !compatible}>
              New folder here
            </SatButton>
          )}
        </div>
        {serverError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{serverError}</p> : null}
      </div>
    </SatFormDialog>
  );
}
