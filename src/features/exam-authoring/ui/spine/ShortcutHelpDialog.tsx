import { AuthoringDialog } from "../authoringPrimitives";

export interface ShortcutHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const ROWS: Array<{ keys: string; action: string; scope: string }> = [
  {keys:'Ctrl/⌘ S',action:'Save now',scope:'Including editors; except dialogs and menus'},
  {keys:'Ctrl/⌘ Shift S',action:'Open question settings',scope:'Outside text inputs and overlays'},
  {keys:'Ctrl/⌘ Enter',action:'Save & move to next question',scope:'Outside controls'},
  {keys:'Ctrl/⌘ 1–4',action:'Set answer key A–D',scope:'Multiple-choice drafts, outside controls'},
  {keys:'Ctrl/⌘ D',action:'Duplicate question',scope:'Outside controls'},
  {keys:'Ctrl/⌘ K',action:'Open command palette',scope:'Outside controls'},
  {keys:'Alt ↑ / ↓',action:'Previous / next question',scope:'Outside controls; ↑ / ↓ or j / k also work'},
  {keys:'Space',action:'Toggle student preview',scope:'Outside controls'},
  {keys:'Esc',action:'Close overlay / leave editor',scope:'Inside editors too'},
  {keys:'Ctrl/⌘ / or ?',action:'Keyboard shortcuts',scope:'Outside text inputs and overlays'},
  {keys:'Ctrl/⌘ Z · Shift Z',action:'Undo · Redo',scope:'Inside rich-text editors'},
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
