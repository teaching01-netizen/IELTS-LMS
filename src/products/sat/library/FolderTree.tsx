import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Library, ListChecks } from "lucide-react";
import clsx from "clsx";
import type { LibraryFolder } from "./types";
import { childrenOf } from "./types";
import { LibraryDroppable } from "./LibraryDnD";

function folderHref(id: string | null | "all"): string {
  if (id === null) return "/sat/exams";
  if (id === "all") return "/sat/exams?folder=all";
  return `/sat/exams?folder=${encodeURIComponent(id)}`;
}

function FolderNode({
  folder,
  folders,
  activeId,
  depth,
  onOpen,
  expandedIds,
}: {
  folder: LibraryFolder;
  folders: LibraryFolder[];
  activeId: string | null | "all";
  depth: number;
  onOpen: (id: string | null | "all") => void;
  expandedIds?: ReadonlySet<string> | undefined;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  useEffect(() => {
    if (expandedIds?.has(folder.id)) setExpanded(true);
  }, [expandedIds, folder.id]);
  const kids = childrenOf(folders, folder.id);
  const active = activeId === folder.id;
  return (
    <li>
      <LibraryDroppable id={`tree-folder:${folder.id}`} label={`Drop into ${folder.name}`}>
        <div
          className={clsx(
            "flex min-h-11 items-center gap-1 rounded-[10px] px-2 text-[14px] leading-5",
            active
              ? "bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
              : "font-medium text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))]",
          )}
          style={{ paddingLeft: `${8 + Math.min(depth, 6) * 12}px` }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.06))]"
            >
              {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          ) : (
            <span className="w-11 shrink-0" aria-hidden="true" />
          )}
          <a
            href={folderHref(folder.id)}
            onClick={(event) => {
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen(folder.id);
            }}
            aria-current={active ? "true" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] py-2 text-left outline-none"
          >
            {active ? <FolderOpen size={15} aria-hidden="true" className="shrink-0" /> : <Folder size={15} aria-hidden="true" className="shrink-0 opacity-70" />}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          </a>
        </div>
      </LibraryDroppable>
      {expanded && kids.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {kids.map((kid) => (
            <FolderNode key={kid.id} folder={kid} folders={folders} activeId={activeId} depth={depth + 1} onOpen={onOpen} expandedIds={expandedIds} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({
  folders,
  activeId,
  onOpen,
  onNewFolder,
  expandedIds,
}: {
  folders: LibraryFolder[];
  /** null = Library root, "all" = All exams smart view, else folder id */
  activeId: string | null | "all";
  onOpen: (id: string | null | "all") => void;
  onNewFolder: () => void;
  expandedIds?: ReadonlySet<string> | undefined;
}) {
  const roots = childrenOf(folders, null);
  return (
    <nav
      aria-label="Folders"
      className="shrink-0 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-1.5 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))] @min-[1080px]/library:sticky @min-[1080px]/library:top-4 @min-[1080px]/library:w-60"
    >
      <p aria-hidden="true" className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--sat-staff-text-tertiary,#6e6e73)] @min-[1080px]/library:block">
        Folders
      </p>
      <ul className="m-0 list-none p-0">
        <li>
          <LibraryDroppable id="library-root" label="Library drop target">
            <a
              href={folderHref(null)}
              onClick={(event) => {
                if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onOpen(null);
              }}
              aria-current={activeId === null ? "true" : undefined}
              className={clsx(
                "flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] leading-5",
                activeId === null
                  ? "bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
                  : "font-medium text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))]",
              )}
            >
              <Library size={16} aria-hidden="true" className="shrink-0 opacity-70" />
              <span className="truncate">Library</span>
            </a>
          </LibraryDroppable>
        </li>
        <li>
          <a
            href={folderHref("all")}
            onClick={(event) => {
              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen("all");
            }}
            aria-current={activeId === "all" ? "true" : undefined}
            className={clsx(
              "flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] leading-5",
              activeId === "all"
                ? "bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]"
                : "font-medium text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))]",
            )}
          >
            <ListChecks size={16} aria-hidden="true" className="shrink-0 opacity-70" />
            <span className="truncate">All exams</span>
          </a>
        </li>
      </ul>
      {roots.length > 0 ? (
        <ul className="m-0 mt-1 list-none border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-0 pt-1">
          {roots.map((folder) => (
            <FolderNode key={folder.id} folder={folder} folders={folders} activeId={activeId} depth={0} onOpen={onOpen} expandedIds={expandedIds} />
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onNewFolder}
        className="mt-1 flex min-h-11 w-full items-center justify-center rounded-[10px] px-3 text-[14px] font-semibold leading-5 text-[var(--sat-staff-accent,#0071e3)] hover:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]"
      >
        New folder
      </button>
    </nav>
  );
}
