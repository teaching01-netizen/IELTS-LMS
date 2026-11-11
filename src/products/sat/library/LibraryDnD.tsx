import { createContext, useContext, type ReactNode } from "react";
import { DragDropProvider, useDraggable, useDroppable, useDragOperation } from "@dnd-kit/react";
import { Folder, GripVertical } from "lucide-react";
import clsx from "clsx";

/**
 * Library drag-and-drop on the installed @dnd-kit/react 0.5.0 APIs.
 * IDs are prefixed (`exam:`, `folder:`) so exam and folder drops never
 * collide; the same server mutations back the dialogs, and invalid targets
 * stay disabled in the UI while the server remains the final authority.
 * Drag handles never hijack row links/checkboxes or touch scrolling: only
 * the icon button starts a drag.
 */

type DropPolicy = (sourceId: string, targetId: string) => boolean;
const DropPolicyContext = createContext<DropPolicy>(() => true);

export function folderFromDropTarget(id: string): string | null | undefined {
  if (id === "library-root") return null;
  for (const prefix of ["folder:", "tree-folder:"]) {
    if (id.startsWith(prefix)) return id.slice(prefix.length) || undefined;
  }
  return undefined;
}

export function LibraryDragProvider({
  children,
  onDrop,
  canDrop,
}: {
  children: ReactNode;
  onDrop: (sourceId: string, targetId: string) => void;
  canDrop: DropPolicy;
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const source = event.operation.source?.id;
        const target = event.operation.target?.id;
        if (typeof source === "string" && typeof target === "string" && canDrop(source, target)) onDrop(source, target);
      }}
    >
      <DropPolicyContext.Provider value={canDrop}>{children}</DropPolicyContext.Provider>
    </DragDropProvider>
  );
}

export function ExamDragHandle({ examId, title, children }: { examId: string; title: string; children?: ReactNode }) {
  // Both refs are required: `ref` registers the draggable source element and
  // `handleRef` marks the grip that starts the drag. Binding only the handle
  // leaves the sensor without a valid source so pointer drags never start.
  const { ref, handleRef } = useDraggable({ id: `exam:${examId}` });
  return (
    <button
      ref={(node) => {
        ref(node);
        handleRef(node);
      }}
      type="button"
      aria-label={`Drag ${title}`}
      title={`Drag ${title}`}
      data-drag-handle={`exam:${examId}`}
      className="pointer-events-auto relative z-10 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-[6px] text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.06))] active:cursor-grabbing"
    >
      {children ?? <GripVertical size={14} aria-hidden="true" />}
    </button>
  );
}

export function FolderDragHandle({ folderId, name }: { folderId: string; name: string }) {
  const { ref, handleRef } = useDraggable({ id: `folder:${folderId}` });
  return (
    <button
      ref={(node) => {
        ref(node);
        handleRef(node);
      }}
      type="button"
      aria-label={`Drag folder ${name}`}
      title={`Drag folder ${name}`}
      data-drag-handle={`folder:${folderId}`}
      className="pointer-events-auto relative z-10 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-[6px] text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.06))] active:cursor-grabbing"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))]">
        <Folder size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

export function LibraryDroppable({
  id,
  label,
  disabled,
  children,
  className,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { source } = useDragOperation();
  const canDrop = useContext(DropPolicyContext);
  const invalid = typeof source?.id === "string" && !canDrop(source.id, id);
  const { ref, isDropTarget } = useDroppable({ id, disabled: Boolean(disabled) || invalid });
  return (
    <div
      ref={ref}
      aria-label={label}
      data-droppable={id}
      data-drop-target={isDropTarget ? "true" : undefined}
      className={clsx(className, isDropTarget && "rounded-[10px] outline outline-2 outline-[var(--sat-staff-accent,#0071e3)]")}
    >
      {children}
    </div>
  );
}
