import { colorForActor, type CoeditCollaborator } from "./contracts";

/**
 * Awareness is sanitized on BOTH sides.
 *
 * The service replaces the `user` object with server-derived identity and
 * strips question content and arbitrary browser-defined properties before
 * broadcasting. The client applies the same allow-list again before rendering:
 * a compromised or buggy peer must not be able to make the editor display
 * arbitrary attributes, and the UI must never trust a browser-supplied
 * identity string.
 *
 * The only browser-influenced value that survives is the caret/selection,
 * which the collaboration-caret extension renders.
 */
export const COEDIT_AWARENESS_ALLOWED_KEYS = ["cursor", "selection", "user", "target"] as const;

/** Workspace rich-text bindings use a bounded cursor:<field> awareness key. */
export function isAllowedAwarenessKey(key: string): boolean {
  return (
    (COEDIT_AWARENESS_ALLOWED_KEYS as readonly string[]).includes(key) ||
    /^cursor:[A-Za-z0-9:_/.-]{1,192}$/.test(key)
  );
}

const FALLBACK_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#0891B2",
  "#4F46E5",
  "#C026D3",
  "#0369A1",
  "#9333EA",
] as const;

function fallbackColor(clientId: number): string {
  return FALLBACK_COLORS[Math.abs(clientId) % FALLBACK_COLORS.length] as string;
}

export interface AwarenessStateLike {
  clientId?: number;
  [key: string]: unknown;
}

interface ServerAwarenessUser {
  id?: unknown;
  name?: unknown;
  color?: unknown;
}

function serverUser(raw: AwarenessStateLike): ServerAwarenessUser | null {
  const value = raw["user"];
  return value !== null && typeof value === "object"
    ? (value as ServerAwarenessUser)
    : null;
}

function safeColor(value: unknown, clientId: number, actorId: string | null): string {
  // The service and browser both use the same deterministic hex palette, so
  // arbitrary CSS cannot enter the UI.
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }
  return actorId ? colorForActor(actorId) : fallbackColor(clientId);
}

/**
 * Projects raw awareness states onto the domain collaborator shape.
 *
 * `selfClientId` marks the local client so the UI can label it "You" without
 * comparing identities it does not control.
 */
export function collaboratorsFromAwareness(
  states: Map<number, AwarenessStateLike>,
  selfClientId: number | null,
): CoeditCollaborator[] {
  const out: CoeditCollaborator[] = [];
  for (const [clientId, raw] of states) {
    if (clientId === selfClientId) continue;
    const user = serverUser(raw);
    // A state without the service's resolved identity is not renderable as a
    // collaborator. In particular, never fall back to top-level browser
    // fields: those are precisely the values the service is required to
    // replace.
    if (!user) continue;
    const name = typeof user.name === "string" && user.name.trim() ? user.name.trim() : null;
    const actorId = typeof user.id === "string" && user.id.trim() ? user.id.trim() : null;
    const color = safeColor(user.color, clientId, actorId);
    const target = raw["target"];
    const selectedQuestionId =
      target !== null && typeof target === "object" &&
      typeof (target as Record<string, unknown>)["questionId"] === "string"
        ? String((target as Record<string, unknown>)["questionId"]).trim()
        : "";
    out.push({
      clientId,
      actorId,
      // A server-resolved collaborator without a display name is shown as a
      // neutral label, never as a raw user id.
      name: name ?? "Collaborator",
      color,
      isSelf: false,
      ...(selectedQuestionId ? { selectedQuestionId } : {}),
    });
  }
  out.sort((a, b) => a.clientId - b.clientId);
  return out;
}

/** Strips everything outside the allow-list. Used before publishing local state. */
export function sanitizeLocalAwarenessState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (!isAllowedAwarenessKey(key)) continue;
    if (key in state) out[key] = state[key];
  }
  return out;
}
