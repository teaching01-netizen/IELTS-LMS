import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { authoringMotion } from "@/src/shared/motion";
import type { QuestionRevision } from "../../contracts/assessment";
import type { FieldClassification } from "../../realtime/threeWayCompare";
import { fieldSlice } from "../../realtime/threeWayCompare";
import { restoreAuthoringFocus } from "../authoringPrimitives";
import {
  CONFLICT_COPY,
  DELETION_COPY,
  FIELD_LABELS,
  fieldFateLine,
  theirsLabel,
} from "./collaborationCopy";

export interface ConflictResolverProps {
  open: boolean;
  /** The revision the editor last agreed with the server on. */
  base: QuestionRevision;
  /** The author's current, unsaved work. Never mutated by this component. */
  local: QuestionRevision;
  /**
   * The remote revision. Passed by the caller and expected to be REFRESHED
   * before `onUseLatest` runs, so a click installs what the server has now
   * rather than what it had when the sheet opened.
   */
  remote: QuestionRevision;
  classifications: FieldClassification[];
  /** Drives "Use {name}'s" labels; falls back to a neutral name. */
  remoteAuthorName?: string | null | undefined;
  /** A remote delete landed while the sheet was open: nothing to install. */
  deletedRemotely?: boolean | undefined;
  onUseLatest: (remote: QuestionRevision) => void;
  onKeepEditing: () => void;
  onCopyLocal: () => void;
  onClose: () => void;
  openerRef?: React.RefObject<HTMLElement | null> | undefined;
}

/**
 * Review sheet: NON-modal, non-blocking. The editor stays interactive and
 * focused where it was; there is no backdrop to swallow a click, and Esc closes
 * with focus restored to the opener.
 *
 * Presentation order is human semantics first (one plain-language row per
 * field), with the read-only preview behind a disclosure per row. Same-field
 * dual edits use neutral amber, never red: this is editable divergence, not a
 * destructive state.
 */
export function ConflictResolver({
  open,
  base,
  local,
  remote,
  classifications,
  remoteAuthorName,
  deletedRemotely = false,
  onUseLatest,
  onKeepEditing,
  onCopyLocal,
  onClose,
  openerRef,
}: ConflictResolverProps) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<string | null>(null);
  const remoteName = remoteAuthorName?.trim() || CONFLICT_COPY.fallbackRemoteName;

  useEffect(() => {
    if (!open) {
      setExpanded(null);
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      restoreAuthoringFocus(openerRef?.current ?? null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, openerRef]);

  if (!open) return null;

  const conflicts = classifications.filter((row) => row.fate === "conflict");
  const hasConflict = conflicts.length > 0;

  return (
    <motion.aside
      initial={reduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduceMotion ? { duration: 0 } : authoringMotion.panel}
      role="complementary"
      aria-label={CONFLICT_COPY.compareTitle}
      className="fixed right-0 top-0 z-40 flex h-full w-[380px] max-w-full flex-col border-l bg-background shadow-lg"
      data-testid="conflict-resolver"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{CONFLICT_COPY.compareTitle}</h2>
        <button
          type="button"
          onClick={() => {
            onClose();
            restoreAuthoringFocus(openerRef?.current ?? null);
          }}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {deletedRemotely ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {DELETION_COPY.body(remoteName)}
          </p>
        ) : null}

        {hasConflict ? (
          <p className="mb-2 text-xs font-semibold text-amber-900">
            {CONFLICT_COPY.conflictHeading}
          </p>
        ) : null}

        <ul className="space-y-1.5">
          {classifications.map((row) => {
            const isConflict = row.fate === "conflict";
            const isOpen = expanded === row.field;
            return (
              <li
                key={row.field}
                data-testid={`compare-row-${row.field}`}
                data-fate={row.fate}
                className={
                  "rounded-md border px-3 py-2 text-sm " +
                  (isConflict
                    ? // Neutral amber, deliberately NOT the destructive palette:
                      // these fields are editable divergence, not a failure.
                      "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-border bg-muted/30")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{FIELD_LABELS[row.field]}</p>
                    <p className="text-xs text-muted-foreground">{fieldFateLine(row.fate, remoteName)}</p>
                  </div>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : row.field)}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight
                      size={12}
                      aria-hidden="true"
                      className={isOpen ? "rotate-90 transition-transform" : "transition-transform"}
                    />
                    Details
                  </button>
                </div>
                {isConflict ? (
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      disabled={deletedRemotely}
                      onClick={() => onUseLatest(remote)}
                      className="rounded border border-amber-400 bg-background px-2 py-0.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                    >
                      {theirsLabel(remoteName)}
                    </button>
                    <button
                      type="button"
                      onClick={onKeepEditing}
                      className="rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Keep mine
                    </button>
                  </div>
                ) : null}
                {isOpen ? (
                  <dl className="mt-2 space-y-1 text-xs" data-testid={`compare-detail-${row.field}`}>
                    {(
                      [
                        ["Mine", local],
                        ["Theirs", remote],
                        ["Base", base],
                      ] as const
                    ).map(([label, revision]) => (
                      <div key={label}>
                        <dt className="font-semibold text-muted-foreground">{label}</dt>
                        <dd className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">
                          {JSON.stringify(fieldSlice(row.field, revision), null, 2)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="flex flex-wrap gap-2 border-t px-4 py-3">
        <button
          type="button"
          disabled={deletedRemotely}
          onClick={() => onUseLatest(remote)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CONFLICT_COPY.useLatest}
        </button>
        <button
          type="button"
          onClick={onKeepEditing}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CONFLICT_COPY.keepEditing}
        </button>
        <button
          type="button"
          onClick={onCopyLocal}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CONFLICT_COPY.copyMyWork}
        </button>
      </footer>
    </motion.aside>
  );
}
