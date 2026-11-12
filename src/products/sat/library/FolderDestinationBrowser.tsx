import { ArrowUp, ChevronRight, Folder, Library } from "lucide-react";
import clsx from "clsx";
import { ancestorsOf, childrenOf, type LibraryFolder } from "./types";

export function isAvailableDestination(folders: readonly LibraryFolder[], id: string | null): boolean {
  return id === null || folders.some((folder) => folder.id === id);
}

/**
 * Drive-style destination browser for the two library move dialogs.
 * Shows an explicit destination path (Library / … / current), an Up control,
 * and direct child-folder rows to open with pointer, Tab + Enter. The
 * displayed folder IS the destination the dialog confirms; nothing is
 * created or moved by browsing alone.
 */
export function FolderDestinationBrowser({
  folders,
  value,
  onChange,
  pending = false,
}: {
  folders: LibraryFolder[];
  /** Selected destination: null = Library root. */
  value: string | null;
  onChange: (id: string | null) => void;
  pending?: boolean;
}) {
  const available = isAvailableDestination(folders, value);
  const current = value === null ? null : (folders.find((folder) => folder.id === value) ?? null);
  const chain = value === null || !available ? [] : ancestorsOf(folders, value);
  const kids = available ? childrenOf(folders, value) : [];
  const parentId = current?.parentId ?? null;

  const browse = (id: string | null) => {
    if (pending) return;
    onChange(id);
  };

  return (
    <div>
      <p className="block text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
        Destination
      </p>
      <nav aria-label="Destination path" className="mt-1.5">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-2 py-1 text-[14px] leading-5">
          <li className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              disabled={pending || value === null}
              onClick={() => browse(null)}
              aria-current={value === null ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-1.5 rounded-[8px] px-2 font-medium",
                value === null
                  ? "font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
                  : "text-[var(--sat-staff-accent-text-on-tint,#0067c9)] hover:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]",
              )}
            >
              <Library size={14} aria-hidden="true" className="shrink-0" />
              Exams
            </button>
          </li>
          {chain.map((folder) => {
            const last = folder.id === value;
            return (
              <li key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
                {last ? (
                  <span aria-current="page" className="truncate px-1 font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                    {folder.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => browse(folder.id)}
                    className="min-h-11 max-w-36 truncate rounded-[8px] px-2 font-medium text-[var(--sat-staff-accent-text-on-tint,#0067c9)] hover:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]"
                  >
                    {folder.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || value === null}
          onClick={() => browse(parentId)}
          aria-label="Up one level"
          className="flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp size={15} aria-hidden="true" />
          Up
        </button>
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {value === null ? "Exams (top level)" : available ? `Inside ${current?.name}` : "Unavailable folder"}
        </p>
      </div>
      {!available ? (
        <p role="alert" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">
          Destination unavailable. Choose Exams or another folder before moving.
        </p>
      ) : kids.length > 0 ? (
        <ul aria-label="Subfolders of destination" className="m-0 mt-2 max-h-56 list-none overflow-y-auto rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-1">
          {kids.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => browse(folder.id)}
                aria-label={`Open ${folder.name}`}
                className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[14px] font-medium leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Folder size={15} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-[10px] border border-dashed border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-3 py-2.5 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          No subfolders here.
        </p>
      )}
    </div>
  );
}
