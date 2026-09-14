import { useEffect, useRef } from "react";
import type { AuthoringPresence } from "../../realtime/presenceTypes";
import { displayNameOf } from "../../realtime/presenceChannel";
import { restoreAuthoringFocus } from "../authoringPrimitives";
import { PRESENCE_COPY, questionLabel } from "./collaborationCopy";
import type { CollaborationParticipant } from "./collaborationParticipants";
import { participantInitials } from "./collaborationParticipants";

export interface CollaboratorPopoverProps {
  /** Normalized co-edit participants, including the current user. */
  participants?: CollaborationParticipant[] | undefined;
  /** Legacy workspace roster, retained for the non-co-edit header. */
  occupants?: AuthoringPresence[] | undefined;
  open: boolean;
  onClose: () => void;
  onSelectQuestion?: ((examQuestionId: string) => void) | undefined;
  openerRef?: React.RefObject<HTMLElement | null> | undefined;
  labelFor?: ((examQuestionId: string) => string | null) | undefined;
}

type PopoverParticipant = CollaborationParticipant;

const STATE_WORD: Record<PopoverParticipant["state"], string> = {
  editing: "editing",
  viewing: "viewing",
  idle: "idle",
};

function legacyParticipant(entry: AuthoringPresence): CollaborationParticipant {
  const displayName = displayNameOf(entry);
  return {
    id: entry.connectionId,
    displayName,
    initials: participantInitials(displayName),
    color: "#64748B",
    state: entry.state,
    isSelf: false,
    ...(entry.selectedQuestionId ? { selectedQuestionId: entry.selectedQuestionId } : {}),
  };
}

/** Progressive disclosure for collaborator identity and question context. */
export function CollaboratorPopover({
  participants,
  occupants,
  open,
  onClose,
  onSelectQuestion,
  openerRef,
  labelFor,
}: CollaboratorPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const normalized = participants ?? (occupants ?? []).map(legacyParticipant);
  const isCoedit = participants !== undefined;

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

  const grouped = new Map<string, PopoverParticipant[]>();
  for (const entry of normalized) {
    const key = entry.selectedQuestionId ?? "__none__";
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={isCoedit ? PRESENCE_COPY.editingNow : "Collaborators"}
      className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border bg-popover p-2 text-sm shadow-md"
      data-testid="collaborator-popover"
    >
      {isCoedit ? (
        <h2 className="px-2 pb-1 pt-0.5 text-sm font-semibold">{PRESENCE_COPY.editingNow}</h2>
      ) : null}
      {normalized.length === 0 ? (
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
                    const name = entry.isSelf ? "You" : entry.displayName;
                    const row = (
                      <>
                        <span
                          className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold"
                          style={{ backgroundColor: `${entry.color}18`, color: entry.color }}
                          aria-hidden="true"
                        >
                          {entry.initials}
                        </span>
                        <span className="font-medium">{name}</span>
                        <span className="text-muted-foreground"> ({STATE_WORD[entry.state]})</span>
                      </>
                    );
                    return (
                      <li key={entry.id}>
                        {id && onSelectQuestion && !entry.isSelf ? (
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
