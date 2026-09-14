import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { authoringMotion } from "@/src/shared/motion";
import type { AuthoringPresence } from "../../realtime/presenceTypes";
import { PRESENCE_STACK_MAX, displayNameOf } from "../../realtime/presenceChannel";
import { CollaboratorPopover } from "./CollaboratorPopover";
import { PRESENCE_COPY } from "./collaborationCopy";
import type { CollaborationParticipant } from "./collaborationParticipants";
import { participantInitials } from "./collaborationParticipants";

const COEDIT_STACK_MAX = 3;

export interface CollaboratorStackProps {
  /** Normalized active prompt-room participants, including self. */
  participants?: CollaborationParticipant[] | undefined;
  /** Legacy workspace roster, retained for the non-co-edit UI. */
  occupants?: AuthoringPresence[] | undefined;
  onSelectQuestion?: ((examQuestionId: string) => void) | undefined;
  labelFor?: ((examQuestionId: string) => string | null) | undefined;
}

const STATE_WORD: Record<AuthoringPresence["state"], string> = {
  editing: "editing",
  viewing: "viewing",
  idle: "idle",
};

function legacyVisibleParticipant(entry: AuthoringPresence): CollaborationParticipant {
  const name = displayNameOf(entry);
  return {
    id: entry.connectionId,
    displayName: name,
    initials: participantInitials(name),
    color: "#64748B",
    state: entry.state,
    isSelf: false,
    ...(entry.selectedQuestionId ? { selectedQuestionId: entry.selectedQuestionId } : {}),
  };
}

/** Calm overlapping initials with progressive disclosure for names. */
export function CollaboratorStack({
  participants,
  occupants = [],
  onSelectQuestion,
  labelFor,
}: CollaboratorStackProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const isCoedit = participants !== undefined;
  const entries = participants ?? occupants.map(legacyVisibleParticipant);

  if (entries.length === 0) return null;

  const visible = entries.slice(0, isCoedit ? COEDIT_STACK_MAX : PRESENCE_STACK_MAX);
  const overflow = entries.length - visible.length;
  const toggle = () => setOpen((previous) => !previous);

  return (
    <span className="relative inline-flex items-center" data-testid="collaborator-stack">
      {isCoedit && overflow === 0 ? (
        <button
          ref={openerRef}
          type="button"
          onClick={toggle}
          aria-label={PRESENCE_COPY.editingNow}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="collaborator-stack-opener"
        >
          <AvatarGroup visible={visible} reduceMotion={Boolean(reduceMotion)} isCoedit labelFor={labelFor} />
        </button>
      ) : (
        <AvatarGroup visible={visible} reduceMotion={Boolean(reduceMotion)} isCoedit={isCoedit} labelFor={labelFor} />
      )}
      {overflow > 0 ? (
        <button
          ref={openerRef}
          type="button"
          onClick={toggle}
          aria-label={PRESENCE_COPY.overflow(overflow)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="collaborator-overflow"
        >
          {PRESENCE_COPY.overflow(overflow)}
        </button>
      ) : null}
      {!isCoedit && overflow === 0 ? (
        <button
          ref={openerRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Who&apos;s here
        </button>
      ) : null}
      <CollaboratorPopover
        {...(isCoedit ? { participants } : { occupants })}
        open={open}
        onClose={() => setOpen(false)}
        onSelectQuestion={onSelectQuestion}
        openerRef={openerRef}
        labelFor={labelFor}
      />
    </span>
  );
}

function AvatarGroup({
  visible,
  reduceMotion,
  isCoedit,
  labelFor,
}: {
  visible: CollaborationParticipant[];
  reduceMotion: boolean;
  isCoedit: boolean;
  labelFor?: ((examQuestionId: string) => string | null) | undefined;
}) {
  return (
    <span className="flex items-center -space-x-1.5">
      {visible.map((entry) => {
        const name = entry.isSelf ? "You" : entry.displayName;
        const label = isCoedit
          ? `${name} — ${entry.state}`
          : PRESENCE_COPY.stackTitle(
              name,
              STATE_WORD[entry.state],
              entry.selectedQuestionId ? (labelFor?.(entry.selectedQuestionId) ?? "") : "",
            );
        return (
          <motion.span
            key={entry.id}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduceMotion ? { duration: 0 } : authoringMotion.state}
            title={label}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-semibold"
            style={{ backgroundColor: `${entry.color}18`, color: entry.color }}
            data-presence-state={entry.state}
            data-collaboration-self={entry.isSelf ? "true" : "false"}
          >
            {entry.initials}
          </motion.span>
        );
      })}
    </span>
  );
}
