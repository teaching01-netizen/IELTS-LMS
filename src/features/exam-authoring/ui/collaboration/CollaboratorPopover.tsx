import { useEffect, useRef } from "react";
import type { AuthoringPresence } from "../../realtime/presenceTypes";
import { displayNameOf } from "../../realtime/presenceChannel";
import { restoreAuthoringFocus } from "../authoringPrimitives";
import { PRESENCE_COPY, questionLabel } from "./collaborationCopy";

export interface CollaboratorPopoverProps {
  /** Whole exam, current draft, unexpired, self excluded. */
  occupants: AuthoringPresence[];
  open: boolean;
  onClose: () => void;
  /** Navigate to a question. The caller keeps its unsaved-work guard. */
  onSelectQuestion?: ((examQuestionId: string) => void) | undefined;
  /** Focus returns here on close. */
  openerRef?: React.RefObject<HTMLElement | null> | undefined;
  /** Display order lookup so rows can say "Q14" instead of raw ids. */
  labelFor?: ((examQuestionId: string) => string | null) | undefined;
}

const STATE_WORD: Record<AuthoringPresence["state"], string> = {
  editing: "editing",
  viewing: "viewing",
  idle: "idle",
};

/**
 * Progressive disclosure, third level: who is on which question. Keyboard
 * accessible, Esc closes with focus restored. Deliberately not a live region —
 * churn in here must never announce.
 */
export function CollaboratorPopover({
  occupants,
  open,
  onClose,
  onSelectQuestion,
  openerRef,
  labelFor,
}: CollaboratorPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      restoreAuthoringFocus(openerRef?.current ?? null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, openerRef]);

  if (!open) return null;

  const grouped = new Map<string, AuthoringPresence[]>();
  for (const entry of occupants) {
    const key = entry.selectedQuestionId ?? "__none__";
    const list = grouped.get(key);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Collaborators"
      className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border bg-popover p-2 text-sm shadow-md"
      data-testid="collaborator-popover"
    >
      {occupants.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{PRESENCE_COPY.empty}</p>
      ) : (
        <ul className="space-y-1">
          {[...grouped.entries()].map(([key, list]) => {
            const id = key === "__none__" ? null : key;
            const label = id ? (labelFor?.(id) ?? questionLabel(null)) : "No question open";
            return (
              <li key={key}>
                <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {id ? PRESENCE_COPY.peopleOn(label) : label}
                </p>
                <ul>
                  {list.map((entry) => {
                    const name = displayNameOf(entry);
                    const row = (
                      <>
                        <span className="font-medium">{name}</span>
                        <span className="text-muted-foreground"> ({STATE_WORD[entry.state]})</span>
                      </>
                    );
                    return (
                      <li key={entry.connectionId}>
                        {id && onSelectQuestion ? (
                          <button
                            type="button"
                            onClick={() => onSelectQuestion(id)}
                            className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row}
                          </button>
                        ) : (
                          <span className="block px-2 py-1 text-xs">{row}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
