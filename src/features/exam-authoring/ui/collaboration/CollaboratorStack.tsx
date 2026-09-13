import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { authoringMotion } from "@/src/shared/motion";
import type { AuthoringPresence } from "../../realtime/presenceTypes";
import { PRESENCE_STACK_MAX, displayNameOf } from "../../realtime/presenceChannel";
import { CollaboratorPopover } from "./CollaboratorPopover";
import { PRESENCE_COPY } from "./collaborationCopy";
import { initialsOf } from "./QuestionPresenceBadge";

export interface CollaboratorStackProps {
  /** Whole exam, current draft, unexpired, self excluded. */
  occupants: AuthoringPresence[];
  onSelectQuestion?: ((examQuestionId: string) => void) | undefined;
  labelFor?: ((examQuestionId: string) => string | null) | undefined;
}

const STATE_WORD: Record<AuthoringPresence["state"], string> = {
  editing: "editing",
  viewing: "viewing",
  idle: "idle",
};

/**
 * WHO: overlapping initials in the header, capped, with the overflow opening a
 * grouped popover. Fades only (`authoringMotion.state`, 0.16s) and instant under
 * reduced motion — a join never springs the layout around.
 *
 * Not a live region: a collaborator arriving is ambient, not an announcement.
 */
export function CollaboratorStack({
  occupants,
  onSelectQuestion,
  labelFor,
}: CollaboratorStackProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  if (occupants.length === 0) return null;

  const visible = occupants.slice(0, PRESENCE_STACK_MAX);
  const overflow = occupants.length - visible.length;

  return (
    <span className="relative inline-flex items-center" data-testid="collaborator-stack">
      <span className="flex items-center -space-x-1.5">
        {visible.map((entry) => {
          const name = displayNameOf(entry);
          return (
            <motion.span
              key={entry.connectionId}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : authoringMotion.state}
              title={PRESENCE_COPY.stackTitle(
                name,
                STATE_WORD[entry.state],
                entry.selectedQuestionId ? (labelFor?.(entry.selectedQuestionId) ?? "") : "",
              )}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-semibold text-muted-foreground"
              data-presence-state={entry.state}
            >
              {initialsOf(name)}
            </motion.span>
          );
        })}
      </span>
      {overflow > 0 || occupants.length > 0 ? (
        <button
          ref={openerRef}
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {overflow > 0 ? PRESENCE_COPY.overflow(overflow) : "Who's here"}
        </button>
      ) : null}
      <CollaboratorPopover
        occupants={occupants}
        open={open}
        onClose={() => setOpen(false)}
        onSelectQuestion={onSelectQuestion}
        openerRef={openerRef}
        labelFor={labelFor}
      />
    </span>
  );
}
