import { SAT_COPY } from "../../domain/satCopy";
import { detectSatShortcutPlatform, formatSatShortcut, SAT_SHORTCUTS } from "../../domain/satShortcuts";
import { SatCenterModal } from "../primitives/SatCenterModal";

export interface SatShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  returnFocusSelector?: string | undefined;
}

/**
 * Bluebook Keyboard Shortcuts modal (Phase 3): read-only reference grouped
 * by Navigation / Test Tools / Display. Display and behavior share the
 * SAT_SHORTCUTS table so they can never drift. Shortcuts perform the same
 * action as clicking the tool (see satToolActions).
 */
export function SatShortcutsModal(props: SatShortcutsModalProps) {
  const platform = detectSatShortcutPlatform(
    typeof navigator !== "undefined"
      ? String((navigator as unknown as { userAgentData?: { platform?: unknown } }).userAgentData?.platform ?? (navigator as unknown as { platform?: unknown }).platform ?? "")
      : "",
  );
  const groups = [
    { id: "navigation", title: SAT_COPY.shortcuts.navigationHeading },
    { id: "tools", title: SAT_COPY.shortcuts.toolsHeading },
    { id: "display", title: SAT_COPY.shortcuts.displayHeading },
  ] as const;

  return (
    <SatCenterModal
      open={props.open}
      title={SAT_COPY.shortcuts.title}
      closeLabel={SAT_COPY.shortcuts.close}
      onClose={props.onClose}
      returnFocusSelector={props.returnFocusSelector}
      layer="shortcutsModal"
      description="Keyboard shortcuts reference"
    >
      <div className="px-5 py-4 sm:px-7">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={"sat-shortcuts-" + group.id} className="mb-5">
            <h3 id={"sat-shortcuts-" + group.id} className="text-[13px] font-semibold uppercase tracking-wide text-[var(--sat-text-secondary)]">
              {group.title}
            </h3>
            <dl className="mt-2 divide-y divide-[var(--sat-divider-soft)]">
              {SAT_SHORTCUTS.filter((s) => s.group === group.id).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-[14px] text-[var(--sat-text)]">{s.label}</dt>
                  <dd className="shrink-0 rounded-[6px] border border-[var(--sat-divider)] bg-[var(--sat-surface-subtle)] px-2 py-1 font-mono text-[12px] text-[var(--sat-text)]">
                    {formatSatShortcut(s, platform)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="border-t border-[var(--sat-divider-soft)] pt-3 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
          {SAT_COPY.shortcuts.footnote} {SAT_COPY.shortcuts.keyboardOptionalNote}
        </p>
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={props.onClose}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-8 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.help.closeButton}
          </button>
        </div>
      </div>
    </SatCenterModal>
  );
}
