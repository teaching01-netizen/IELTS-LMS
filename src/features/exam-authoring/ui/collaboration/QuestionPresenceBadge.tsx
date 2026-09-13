import type { AuthoringPresence } from "../../realtime/presenceTypes";
import { PRESENCE_BADGE_MAX, displayNameOf } from "../../realtime/presenceChannel";
import { PRESENCE_COPY } from "./collaborationCopy";

export interface QuestionPresenceBadgeProps {
  /** Already filtered to this question, this draft, unexpired, self excluded. */
  occupants: AuthoringPresence[];
  /** Visible initials before the "+N" overflow. */
  maxInitials?: number;
}

/**
 * Initials for a display name. Text identity, never colour-only: two authors
 * with the same initials are still distinguishable by their tooltip/title.
 */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return (parts[0] as string).slice(0, 2).toUpperCase();
  }
  return `${(parts[0] as string)[0] ?? ""}${(parts[1] as string)[0] ?? ""}`.toUpperCase();
}

const STATE_WORD: Record<AuthoringPresence["state"], string> = {
  editing: "editing",
  viewing: "viewing",
  idle: "idle",
};

/**
 * The rail is the collaboration radar: a tiny avatar beside a question row is
 * the whole surface. Nothing pops, nothing overlaps the canvas, and view
 * transitions do not animate. It is deliberately NOT a live region — badges
 * must never chatter at a screen reader as people move around.
 */
export function QuestionPresenceBadge({
  occupants,
  maxInitials = PRESENCE_BADGE_MAX,
}: QuestionPresenceBadgeProps) {
  if (occupants.length === 0) return null;

  const visible = occupants.slice(0, maxInitials);
  const overflow = occupants.length - visible.length;
  const names = occupants.map((entry) => displayNameOf(entry)).join(", ");
  const editing = occupants.some((entry) => entry.state === "editing");

  return (
    <span
      className="inline-flex items-center gap-0.5"
      data-testid="question-presence-badge"
      aria-label={PRESENCE_COPY.badgeLabel(names, editing)}
    >
      {visible.map((entry) => {
        const name = displayNameOf(entry);
        return (
          <span
            key={entry.connectionId}
            title={PRESENCE_COPY.stackTitle(name, STATE_WORD[entry.state], "this question")}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-semibold leading-none text-muted-foreground"
            data-presence-state={entry.state}
          >
            {initialsOf(name)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          className="text-[9px] font-semibold text-muted-foreground"
          data-testid="question-presence-overflow"
        >
          {PRESENCE_COPY.overflow(overflow)}
        </span>
      ) : null}
    </span>
  );
}
