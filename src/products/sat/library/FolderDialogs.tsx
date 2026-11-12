import { useEffect, useMemo, useRef, useState } from "react";
import { SatButton, SatField } from "../ui/SatPage";
import { SatConfirmDialog, SatFormDialog } from "../ui/ConfirmDialog";
import type { LibraryFolder } from "./types";
import { FolderDestinationBrowser, isAvailableDestination } from "./FolderDestinationBrowser";

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
      eyebrow="Digital SAT · Exams"
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
      eyebrow="Digital SAT · Exams"
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
  childFolderCount = 0,
  onClose,
  onConfirm,
  pending,
  serverError,
}: {
  folder: LibraryFolder | null;
  examCount: number;
  childFolderCount?: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  serverError: string | null;
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
  const contents = [
    examCount > 0 ? `${examCount} ${examCount === 1 ? "exam" : "exams"}` : "",
    childFolderCount > 0 ? `${childFolderCount} ${childFolderCount === 1 ? "subfolder" : "subfolders"}` : "",
  ].filter(Boolean).join(" and ");
  const description = contents
    ? `This folder still holds ${contents}. Move its contents out first — deleting a folder never deletes exams.`
    : "This folder is empty. Exams are never deleted with a folder, and deleting it cannot be undone.";
  return (
    <SatConfirmDialog
      open
      title={`Delete ${folder.name}?`}
      description={serverError ? `${description} The folder could not be deleted: ${serverError}` : description}
      confirmLabel={pending ? "Deleting…" : "Delete"}
      destructive
      confirmDisabled={pending || Boolean(contents)}
      onCancel={guardedClose}
      onConfirm={guardedConfirm}
    />
  );
}

export function FolderMoveDialog({
  open,
  folders,
  currentParentId,
  onClose,
  onMove,
  pending,
  serverError,
  title,
}: {
  open: boolean;
  folders: LibraryFolder[];
  currentParentId: string | null;
  onClose: () => void;
  onMove: (parentId: string | null) => void;
  pending: boolean;
  serverError: string | null;
  title: string;
}) {
  const [target, setTarget] = useState<string | null>(currentParentId);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setTarget(currentParentId);
    wasOpen.current = open;
  }, [open, currentParentId]);
  if (!open) return null;
  const sameParent = target === currentParentId;
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Exams"
      title={title}
      onClose={() => { if (!pending) onClose(); }}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={pending}>Cancel</SatButton>
          <SatButton variant="primary" onClick={() => onMove(target)} pending={pending} disabled={sameParent || !isAvailableDestination(folders, target)}>
            {sameParent ? "Already here" : "Move here"}
          </SatButton>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-5">
        <FolderDestinationBrowser folders={folders} value={target} onChange={setTarget} pending={pending} />
        {sameParent ? <p className="text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">This folder is already here. Choose a different destination to move it.</p> : null}
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
  initialDestination = null,
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
  /** Common current folder of the moved exams, or root when they differ. */
  initialDestination?: string | null;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
  onNewFolder: (name: string, parentId: string | null) => Promise<LibraryFolder | null>;
  pending: boolean;
  serverError: string | null;
}) {
  const [target, setTarget] = useState<string | null>(initialDestination ?? null);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Folders created inside this dialog, kept locally so the browser can show
  // and select them immediately even before the library refetch lands.
  const [localFolders, setLocalFolders] = useState<LibraryFolder[]>([]);
  const newInputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTarget(initialDestination ?? null);
      setNewName("");
      setNewError(null);
      setCreating(false);
      setCreatingFolder(false);
      setLocalFolders([]);
    }
    wasOpen.current = open;
  }, [open, initialDestination ]);
  useEffect(() => {
    // Keep immediate creation results only until the server includes them.
    // Later refreshes must be able to report a deleted destination.
    setLocalFolders((previous) => {
      const remaining = previous.filter((local) => !folders.some((folder) => folder.id === local.id));
      return remaining.length === previous.length ? previous : remaining;
    });
  }, [folders, localFolders]);
  const displayFolders = useMemo(() => {
    if (localFolders.length === 0) return folders;
    const known = new Set(folders.map((folder) => folder.id));
    return [...folders, ...localFolders.filter((folder) => !known.has(folder.id))];
  }, [folders, localFolders]);
  if (!open) return null;
  const busy = pending || creatingFolder;
  const available = isAvailableDestination(displayFolders, target);
  const submitNewFolder = async () => {
    // Create-only: the new folder becomes the displayed destination and the
    // user presses Move afterwards. Never moves implicitly, so a failed move
    // cannot strand exams. The in-flight guard plus the parent pending lock
    // prevent double creation.
    if (busy || !compatible || !available) return;
    const invalid = validateName(newName);
    if (invalid) {
      setNewError(invalid);
      return;
    }
    setNewError(null);
    setCreatingFolder(true);
    // Capture the destination now: navigation is locked while creating, and
    // the value must not drift under the await.
    const parentNow = target;
    const trimmed = newName.trim();
    try {
      const created = await onNewFolder(trimmed, parentNow);
      if (created) {
        setLocalFolders((prev) => (prev.some((folder) => folder.id === created.id) || displayFolders.some((folder) => folder.id === created.id)
          ? prev
          : [...prev, created]));
        setTarget(created.id);
        setCreating(false);
        setNewName("");
      }
    } finally {
      setCreatingFolder(false);
    }
  };
  const destName = target === null ? "Exams" : (displayFolders.find((f) => f.id === target)?.name ?? "Exams");
  return (
    <SatFormDialog
      open
      eyebrow="Digital SAT · Exams"
      title={`Move ${count === 1 ? "exam" : `${count} exams`} to`}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <SatButton variant="quiet" onClick={onClose} disabled={busy}>Cancel</SatButton>
          <SatButton variant="primary" onClick={() => onMove(target)} pending={busy} disabled={!compatible || !available}>
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
        <FolderDestinationBrowser folders={displayFolders} value={target} onChange={setTarget} pending={busy || !compatible} />
        <div className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3">
          {creating ? (
            <div className="space-y-2">
              <p className="text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                New folder in {destName} — create it, then press Move.
              </p>
              <div className="flex gap-2">
                <input
                  ref={newInputRef}
                  value={newName}
                  disabled={pending || creatingFolder}
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
                  disabled={busy || !compatible || !available || !newName.trim()}
                  pending={creatingFolder}
                  onClick={() => void submitNewFolder()}
                >
                  Create folder
                </SatButton>
              </div>
              {newError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{newError}</p> : null}
            </div>
          ) : (
            <SatButton variant="quiet" onClick={() => { setCreating(true); requestAnimationFrame(() => newInputRef.current?.focus()); }} disabled={busy || !compatible || !available}>
              New folder here
            </SatButton>
          )}
        </div>
        {serverError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{serverError}</p> : null}
      </div>
    </SatFormDialog>
  );
}
