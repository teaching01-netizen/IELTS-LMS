import type { AuthoringPresence, PresenceIntent } from "./presenceTypes";

/**
 * Pure presence channel helpers. No sockets, no timers, no React: the hook owns
 * cadence and the registry, and everything decision-shaped lives here so it can
 * be tested with plain numbers.
 *
 * Presence is high-frequency and worthless once stale, which is why it is
 * throttled on the way out, TTL-expired on the way in, and carries no content
 * in either direction.
 */

/** At most one presence send per window; selection + state coalesce into it. */
export const PRESENCE_THROTTLE_MS = 2_000;
/**
 * Receivers expire an entry this long after its last refresh. Deliberately
 * LONGER than the server's 30s TTL: a suspended tab (Safari/iPad throttles
 * timers aggressively) must not make a colleague flicker in and out, and the
 * server remains the authority that actually retires a peer. Erring long only
 * risks showing someone a few seconds after they left, which is far calmer
 * than a roster that blinks.
 */
export const PRESENCE_TTL_MS = 45_000;
/** Sweep cadence for the receive side. */
export const PRESENCE_SWEEP_MS = 5_000;
/** No selection or save activity for this long reads as `idle`. */
export const PRESENCE_IDLE_MS = 60_000;
/** Header stack: visible avatars before "+N". */
export const PRESENCE_STACK_MAX = 4;
/** Rail badge: visible initials before "+N". */
export const PRESENCE_BADGE_MAX = 2;

/** True when enough time has passed since the last accepted send. */
export function shouldSend(now: number, lastSent: number | null): boolean {
  return lastSent === null || now - lastSent >= PRESENCE_THROTTLE_MS;
}

/**
 * Coalesce a burst into the LATEST intent. A coalesced frame always carries
 * full current state, so a shed intermediate frame can never leave a receiver
 * reconstructing a delta it never saw.
 */
export function coalescePresence(
  pending: PresenceIntent | null,
  next: PresenceIntent,
): PresenceIntent {
  return pending === null ? next : next;
}

/** Drop entries whose last refresh is older than the TTL. */
export function expirePresence<T extends { lastSeenAt: string }>(
  entries: readonly T[],
  now: number,
): T[] {
  return entries.filter((entry) => now - Date.parse(entry.lastSeenAt) <= PRESENCE_TTL_MS);
}

/**
 * Drop frames published under a different working draft. A draft is
 * replaceable state, so presence from a retired draft describes a document
 * nobody is looking at any more.
 */
export function filterDraft<T extends { draftVersionId: string }>(
  entries: readonly T[],
  draftVersionId: string | null,
): T[] {
  if (!draftVersionId) return [];
  return entries.filter((entry) => entry.draftVersionId === draftVersionId);
}

/**
 * Self-exclusion happens at RENDER, not in the map, and is by connectionId so
 * two tabs of the same user still see each other. When the socket's own
 * connection id is not known yet, nothing is excluded rather than guessing.
 */
export function excludeSelf<T extends { connectionId: string }>(
  entries: readonly T[],
  selfConnectionId: string | null,
): T[] {
  if (!selfConnectionId) return [...entries];
  return entries.filter((entry) => entry.connectionId !== selfConnectionId);
}

/** Upsert one presence entry by connectionId (last write wins per peer). */
export function mergePresence(
  entries: readonly AuthoringPresence[],
  incoming: AuthoringPresence,
): AuthoringPresence[] {
  const next = entries.filter((entry) => entry.connectionId !== incoming.connectionId);
  next.push(incoming);
  return next;
}

/** Occupants of one question, for a rail badge. */
export function occupantsOf(
  entries: readonly AuthoringPresence[],
  examQuestionId: string,
): AuthoringPresence[] {
  return entries.filter((entry) => entry.selectedQuestionId === examQuestionId);
}

/** Occupants currently editing a specific question, for the header label. */
export function editorsOf(
  entries: readonly AuthoringPresence[],
  examQuestionId: string | null,
): AuthoringPresence[] {
  if (!examQuestionId) return [];
  return entries.filter(
    (entry) => entry.selectedQuestionId === examQuestionId && entry.state === "editing",
  );
}

/** Entries with a real selection, i.e. the ones worth showing in a stack. */
export function withSelection(entries: readonly AuthoringPresence[]): AuthoringPresence[] {
  return entries.filter((entry) => entry.selectedQuestionId !== null);
}

/**
 * Display name with the sanctioned fallback. A blank or missing name must
 * never surface as a raw user id.
 */
export function displayNameOf(entry: { displayName: string }): string {
  const name = entry.displayName.trim();
  return name.length > 0 ? name : "Another author";
}

/**
 * Turn an authoring event's server-stamped `actor.id` into a display-only
 * author, using the presence roster as the ONLY sanctioned source of names.
 *
 * The event envelope deliberately cannot carry a display name (or an email, or
 * a phone number), so "Alice saved Q14" is only sayable while Alice is still in
 * the room. When she is not, this returns null and every caller falls back to
 * neutral wording — never to a raw user id, and never to a guess.
 */
export function authorForActor(
  entries: readonly AuthoringPresence[],
  actorId: string | null | undefined,
): { displayName: string } | null {
  if (!actorId) return null;
  const match = entries.find((entry) => entry.userId === actorId);
  const name = match?.displayName.trim() ?? "";
  return name.length > 0 ? { displayName: name } : null;
}
