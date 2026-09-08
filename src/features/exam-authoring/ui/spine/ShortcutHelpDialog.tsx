import { AuthoringDialog } from "../authoringPrimitives";

export interface ShortcutHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const ROWS: Array<{ keys: string; action: string; scope: string }> = [
  { keys: "Ctrl/⌘ S", action: "Save now", scope: "Everywhere except dialogs and menus" },
  { keys: "Ctrl/⌘ Enter", action: "Save & move to next question", scope: "Not inside inputs — click the button instead" },
  { keys: "Ctrl/⌘ 1–4", action: "Set answer key A–D", scope: "Multiple-choice drafts, outside inputs" },
  { keys: "Ctrl/⌘ D", action: "Duplicate question", scope: "Outside inputs" },
  { keys: "Ctrl/⌘ K", action: "Jump to question", scope: "Spine: opens the palette; legacy: focuses list search" },
  { keys: "↑ / ↓ or j / k", action: "Previous / next question", scope: "Outside inputs" },
  { keys: "Space", action: "Toggle student preview", scope: "Outside inputs" },
  { keys: "Esc", action: "Leave editor / clear search", scope: "Inside inputs too" },
  { keys: "?", action: "Open this help", scope: "Outside inputs" },
];

/**
 * Shortcut cheat sheet (plan Phase 8): discoverability for the existing
 * bindings. Bindings themselves are byte-identical — this dialog only
 * documents them with honest scope notes.
 */
export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  return (
    <AuthoringDialog
      open={open}
      title="Keyboard shortcuts"
      ariaLabel="Keyboard shortcuts"
      description="Batch authoring shortcuts. Most are inactive inside text inputs, except Escape and Save."
      onClose={onClose}
      contentClassName="max-w-md"
    >
      <div className="px-5 pb-5">
        <dl className="divide-y divide-border">
          {ROWS.map((row) => (
            <div key={row.keys} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                {row.keys}
              </dt>
              <dd className="min-w-0 flex-1 text-right">
                <span className="block text-xs font-medium text-foreground">{row.action}</span>
                <span className="block text-[11px] text-muted-foreground">{row.scope}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </AuthoringDialog>
  );
}
