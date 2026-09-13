import { z } from "zod";

/**
 * Phase 05 presence vocabulary. Ephemeral, TTL-bounded, content-free.
 *
 * The payload ban is enforced twice: this type has no content field to put
 * anything in, and the schema below is non-strict on INPUT yet only ever reads
 * ids + state, so a server that ever added a content field would still not get
 * one into the presence map.
 */

export type PresenceState = "viewing" | "editing" | "idle";

export const PRESENCE_STATES: readonly PresenceState[] = ["viewing", "editing", "idle"];

export interface AuthoringPresence {
  /** Server-minted, unique per tab/socket. */
  connectionId: string;
  /** Server-resolved staff user id. Never accepted from a client frame. */
  userId: string;
  /** Display-only. Empty means the client shows a neutral label. */
  displayName: string;
  examId: string;
  /** The subscription binding this presence was published under. */
  draftVersionId: string;
  selectedQuestionId: string | null;
  state: PresenceState;
  /** ISO timestamp stamped by the server; receivers expire against it. */
  lastSeenAt: string;
}

/**
 * Client -> server frame. `connectionId` and `lastSeenAt` are omitted because
 * the server stamps them; every other identity field is ignored on arrival, so
 * the only fields with any effect are the selection and the state.
 */
export interface PresenceFrame {
  type: "authoring.presence";
  v: 1;
  presence: {
    selectedQuestionId: string | null;
    state: PresenceState;
  };
}

/** What a client may actually influence. */
export interface PresenceIntent {
  selectedQuestionId: string | null;
  state: PresenceState;
}

const presenceBroadcastSchema = z.object({
  connectionId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  displayName: z.string().max(255),
  examId: z.string().min(1).max(128),
  draftVersionId: z.string().min(1).max(128),
  selectedQuestionId: z.string().max(128).nullable(),
  state: z.enum(["viewing", "editing", "idle"]),
  lastSeenAt: z.string().min(1).max(64),
});

const presenceBroadcastFrameSchema = z.object({
  type: z.literal("authoring.presence"),
  v: z.literal(1),
  presence: presenceBroadcastSchema,
});

/**
 * Parse one inbound presence frame without throwing. Returns null for anything
 * unusable — presence is advisory, so a malformed frame is counted and dropped
 * rather than closing an otherwise healthy connection.
 */
export function parsePresenceBroadcast(raw: unknown): AuthoringPresence | null {
  try {
    const parsed = presenceBroadcastFrameSchema.safeParse(raw);
    if (!parsed.success) return null;
    const p = parsed.data.presence;
    return {
      connectionId: p.connectionId,
      userId: p.userId,
      displayName: p.displayName,
      examId: p.examId,
      draftVersionId: p.draftVersionId,
      selectedQuestionId: p.selectedQuestionId,
      state: p.state,
      lastSeenAt: p.lastSeenAt,
    };
  } catch {
    return null;
  }
}

/** Build the client -> server frame. Never includes identity or content. */
export function buildPresenceFrame(intent: PresenceIntent): PresenceFrame {
  return {
    type: "authoring.presence",
    v: 1,
    presence: {
      selectedQuestionId: intent.selectedQuestionId,
      state: intent.state,
    },
  };
}

/**
 * Derive the state to publish. Editing is derived from the AUTOSAVE dirty flag
 * (never keystrokes or DOM), and idle requires a genuinely quiet window.
 */
export function derivePresenceState(args: {
  selectedQuestionId: string | null;
  isDirty: boolean;
  lastActivityAt: number;
  now: number;
  idleAfterMs: number;
}): PresenceState {
  if (args.isDirty && args.selectedQuestionId) {
    return "editing";
  }
  if (args.now - args.lastActivityAt >= args.idleAfterMs) {
    return "idle";
  }
  return "viewing";
}
