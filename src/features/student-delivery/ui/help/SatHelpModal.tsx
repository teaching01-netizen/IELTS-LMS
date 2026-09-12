import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { SAT_HELP_ENTRIES } from "../../domain/satHelpContent";
import { SatCenterModal } from "../primitives/SatCenterModal";

export interface SatHelpModalProps {
  open: boolean;
  onClose: () => void;
  returnFocusSelector?: string | undefined;
}

/**
 * Bluebook Help modal (Phase 2): contextual documentation embedded inside
 * the exam. Large centered modal, exam dimmed non-interactive behind, timer
 * continues, answers untouched. Accordion per tool plus Expand/Collapse All.
 * Only modal content scrolls.
 */
export function SatHelpModal(props: SatHelpModalProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const allExpanded = expanded.size === SAT_HELP_ENTRIES.length;

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setExpanded(new Set(SAT_HELP_ENTRIES.map((e) => e.id)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <SatCenterModal
      open={props.open}
      title={SAT_COPY.help.title}
      closeLabel={SAT_COPY.help.close}
      onClose={props.onClose}
      returnFocusSelector={props.returnFocusSelector}
      wide
      layer="helpModal"
      titleSize="help"
      description="Help about Bluebook testing tools"
    >
      <div className="px-7 py-7">
        <div className="flex items-center justify-end gap-2 border-b border-[var(--sat-divider-soft)] pb-3 text-[13px] font-semibold">
          <button
            type="button"
            onClick={expandAll}
            disabled={allExpanded}
            className="rounded px-2 py-1 text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.help.expandAll}
          </button>
          <span aria-hidden="true" className="text-[var(--sat-divider)]">|</span>
          <button
            type="button"
            onClick={collapseAll}
            disabled={expanded.size === 0}
            className="rounded px-2 py-1 text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.help.collapseAll}
          </button>
        </div>
        <div className="divide-y divide-[var(--sat-divider-soft)]">
          {SAT_HELP_ENTRIES.map((entry) => {
            const open = expanded.has(entry.id);
            return (
              <section key={entry.id}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={"sat-help-panel-" + entry.id}
                    onClick={() => toggle(entry.id)}
                    className="sat-touch-target flex min-h-[78px] w-full items-center justify-between gap-3 py-3 text-left text-[18px] font-medium text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
                  >
                    {entry.title}
                    {open ? (
                      <Minus className="h-5 w-5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Plus className="h-5 w-5 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                </h3>
                {open ? (
                  <div id={"sat-help-panel-" + entry.id} className="pb-4 text-[14px] leading-6 text-[var(--sat-text)]">
                    <p>{entry.body}</p>
                    <p className="mt-2 text-[13px] text-[var(--sat-text-secondary)]">{entry.whereToFind}</p>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        <div className="flex justify-center border-t border-[var(--sat-divider-soft)] py-7">
          <button
            type="button"
            onClick={props.onClose}
            className="sat-touch-target sat-pressable h-12 rounded-full border border-[var(--sat-attention-border)] bg-[var(--sat-attention)] px-7 text-[14px] font-semibold text-[var(--sat-attention-fg)] hover:bg-[var(--sat-attention-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.help.closeButton}
          </button>
        </div>
      </div>
    </SatCenterModal>
  );
}
