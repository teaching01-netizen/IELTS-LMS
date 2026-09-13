import { z } from "zod";
import {
  AUTHORING_EVENT_KINDS,
  AUTHORING_EVENT_VERSION,
  type AuthoringEntityRef,
  type AuthoringEventKind,
  type AuthoringEventScope,
  type AuthoringEventV1,
  type AuthoringInboundFrame,
  type AuthoringSnapshotReason,
  type ClassifiedAuthoringEvent,
} from "./contracts";

const idString = z.string().min(1).max(128);
const isoDateString = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "occurredAt must be an ISO-8601 date string",
  });

// organizationId is explicitly nullable: null = platform scope
// (exam_entities.organization_id IS NULL). Empty string is never used to
// mean platform scope — that would be indistinguishable from a missing
// field or a failed query. Tenant decisions come from server-side DB rows
// at subscribe time, never from the envelope. examId and draftVersionId
// are always required.
const scopeSchema = z.object({
  organizationId: z.string().max(128).nullable(),
  examId: idString,
  draftVersionId: idString,
});

const actorSchema = z.object({ id: idString, kind: z.literal("staff") });

const questionEntitySchema = z.object({
  kind: z.literal("question"),
  examQuestionId: idString,
  // Nullable tombstone fields: present as JSON null (never absent) per the
  // TS/Go parity rule; Go uses pointer fields without omitempty to match.
  questionId: z.string().max(128).nullable(),
  moduleId: z.string().max(128).nullable(),
});
const moduleEntitySchema = z.object({ kind: z.literal("module"), moduleId: idString });
const examEntitySchema = z.object({ kind: z.literal("exam"), examId: idString });
const draftEntitySchema = z.object({
  kind: z.literal("draft"),
  examId: idString,
  draftVersionId: idString,
});
const entitySchema = z.discriminatedUnion("kind", [
  questionEntitySchema,
  moduleEntitySchema,
  examEntitySchema,
  draftEntitySchema,
]);

/**
 * Domain envelope schema (NO transport cursor: the cursor travels in
 * AuthoringEventFrame.cursor). kind is deliberately z.string(), NOT
 * z.enum(): unknown future kinds must parse (then classify to
 * unknown-kind), never fail.
 */
export const authoringEventEnvelopeSchema = z.object({
  version: z.number().int(),
  kind: z.string().min(1).max(64),
  eventId: idString,
  occurredAt: isoDateString,
  actor: actorSchema,
  scope: scopeSchema,
  entity: entitySchema,
  // revision fences the affected entity; draftRevision describes the
  // working copy's generation. Neither orders events (the frame cursor
  // does), and draftRevision is NOT monotonic across Undo.
  revision: z.number().int().nonnegative(),
  draftRevision: z.number().int().nonnegative(),
  changedFields: z.array(z.string().min(1).max(128)).max(64),
  affectedExamQuestionIds: z.array(idString).max(200).optional(),
  causationId: z.string().min(1).max(128).optional(),
});

export type AuthoringEventEnvelopeInput = z.infer<typeof authoringEventEnvelopeSchema>;

const KNOWN_KINDS: ReadonlySet<string> = new Set(AUTHORING_EVENT_KINDS);

export function isKnownKind(kind: string): kind is AuthoringEventKind {
  return KNOWN_KINDS.has(kind);
}

/** Strict structural parse (unknown kinds OK; malformed envelopes throw). */
export function parseAuthoringEventEnvelope(input: unknown): AuthoringEventEnvelopeInput {
  return authoringEventEnvelopeSchema.parse(input);
}

/**
 * Safe parse with explicit version negotiation: any version !== 1 returns
 * unsupported-version (authoritative refetch) WITHOUT interpreting the
 * event — even when the kind name is familiar. Unknown v1 kinds classify
 * to unknown-kind. Only malformed shape throws.
 */
export function classifyAuthoringEvent(input: unknown): ClassifiedAuthoringEvent {
  // Version probe first: non-integer versions can never satisfy the strict
  // envelope schema, but they are still a clean unsupported-version signal
  // (authoritative refetch), not a malformed-envelope crash.
  const probe = (input ?? {}) as { version?: unknown; eventId?: unknown; scope?: unknown };
  if (!Number.isInteger(probe.version) || (probe.version as number) !== AUTHORING_EVENT_VERSION) {
    return {
      status: 'unsupported-version',
      version: typeof probe.version === 'number' ? probe.version : NaN,
      eventId: typeof probe.eventId === 'string' ? probe.eventId : null,
      scope: (probe.scope as AuthoringEventScope) ?? null,
    };
  }
  const parsed = authoringEventEnvelopeSchema.parse(input);
  if (!isKnownKind(parsed.kind)) {
    console.warn("[authoring-realtime] unknown event kind; scheduling safe refetch", {
      kind: parsed.kind,
      eventId: parsed.eventId,
    });
    return {
      status: "unknown-kind",
      rawKind: parsed.kind,
      eventId: parsed.eventId,
      scope: parsed.scope as AuthoringEventScope,
    };
  }
  return { status: "known", event: parsed as AuthoringEventV1 };
}

/**
 * Opaque-cursor ordering (transport cursor, NOT a contiguous stream
 * counter). Ties break on eventId (stable).
 */
export function compareByCursor(
  a: { cursor: number; eventId: string },
  b: { cursor: number; eventId: string },
): number {
  if (a.cursor !== b.cursor) return a.cursor - b.cursor;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * Opaque-cursor admission: process any cursor strictly newer than the last
 * processed one. 381 -> 384 is valid (skipped values belong to other
 * exams, kinds, or origins); loss is signaled explicitly by the protocol
 * (snapshot_required / expiry / overflow / replay failure), never inferred
 * from arithmetic.
 */
export function shouldProcessCursor(
  lastProcessedCursor: number,
  nextCursor: number,
): boolean {
  return nextCursor > lastProcessedCursor;
}

/** Dedupe: first-wins on eventId, drop cursor <= lastProcessed. */
export function dedupeByEventId<T extends { eventId: string; cursor: number }>(
  events: readonly T[],
  lastProcessedCursor: number,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of [...events].sort(compareByCursor)) {
    if (e.cursor <= lastProcessedCursor) continue;
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    out.push(e);
  }
  return out;
}

/** Sort by transport cursor (ascending). */
export function sortByCursor<T extends { cursor: number; eventId: string }>(events: readonly T[]): T[] {
  return [...events].sort(compareByCursor);
}

// ---------------------------------------------------------------------------
// Transport frame validation (frozen Phase 03 wire shapes).
//
// Validators take `unknown` and NEVER throw: malformed input returns
// `{ ok: false, reason }` so the caller can count + log it and keep the
// connection alive. A content-bearing frame is impossible by contract; the
// client also rejects oversized raw frames before parsing.
// ---------------------------------------------------------------------------

/** Content must never be in a frame; this bound rejects a runaway payload. */
export const MAX_AUTHORING_FRAME_BYTES = 8 * 1024;

export type AuthoringFrameParseResult =
  | { ok: true; value: AuthoringInboundFrame }
  /**
   * Valid transport frame, unknown domain kind. NOT a malformed frame: the
   * caller must ADVANCE THE CURSOR (so a later known event never registers as
   * a loss on resume) and may run a conservative refetch. It must not execute
   * any business behavior for the kind it cannot interpret.
   */
  | { ok: false; outcome: "unknown-kind"; rawKind: string; cursor: number }
  | { ok: false; outcome: "rejected"; reason: string };

export type AuthoringEventParseResult =
  | { ok: true; value: AuthoringEventV1 }
  | { ok: false; reason: string };

const frameVersionSchema = z.literal(AUTHORING_EVENT_VERSION);

const authoringSubscribedFrameSchema = z.object({
  type: z.literal("authoring.subscribed"),
  v: frameVersionSchema,
  examId: idString,
  draftVersionId: idString,
  barrierCursor: z.number().int().nonnegative(),
  // Additive + optional: present only when presence was negotiated, so a
  // socket without presence still parses and simply has no identity.
  connectionId: z.string().min(1).max(128).optional(),
});

const authoringCapabilitiesFrameSchema = z.object({
  type: z.literal("authoring.capabilities"),
  v: frameVersionSchema,
  delivery: z.boolean(),
  presence: z.boolean(),
  conflictCompare: z.boolean(),
});

const authoringEventFrameSchema = z.object({
  type: z.literal("authoring.event"),
  v: frameVersionSchema,
  cursor: z.number().int().nonnegative(),
  event: authoringEventEnvelopeSchema,
});

const SNAPSHOT_REASONS: readonly AuthoringSnapshotReason[] = [
  "cursor_too_old",
  "replay_too_large",
  "delivery_gap",
  "unsupported_event",
];

const authoringSnapshotRequiredFrameSchema = z.object({
  type: z.literal("authoring.snapshot_required"),
  v: frameVersionSchema,
  examId: idString,
  draftVersionId: idString,
  reason: z.enum(SNAPSHOT_REASONS as unknown as [string, ...string[]]),
});

const authoringErrorFrameSchema = z.object({
  type: z.literal("authoring.error"),
  v: frameVersionSchema,
  code: z.string().min(1).max(64),
  message: z.string().max(2048),
});

const authoringInboundFrameSchema = z.discriminatedUnion("type", [
  authoringEventFrameSchema,
  authoringSubscribedFrameSchema,
  authoringCapabilitiesFrameSchema,
  authoringSnapshotRequiredFrameSchema,
  authoringErrorFrameSchema,
]);

const KNOWN_FRAME_TYPES = new Set([
  "authoring.subscribed",
  "authoring.capabilities",
  "authoring.event",
  "authoring.snapshot_required",
  "authoring.error",
]);

/**
 * Parse one inbound authoring frame without throwing.
 *
 * Rejection taxonomy (`outcome: "rejected"`): `malformed` (shape),
 * `unsupported-version` (v !== 1), `unknown-type` (a frame this client does
 * not know). A known event frame carrying a FUTURE event kind is instead
 * `outcome: "unknown-kind"` with the cursor it must consume — see the type
 * doc above. Only genuinely unusable frames are rejected; the connection
 * stays live for all of them.
 */
export function parseAuthoringFrame(raw: unknown): AuthoringFrameParseResult {
  const reject = (reason: string): AuthoringFrameParseResult => ({
    ok: false,
    outcome: "rejected",
    reason,
  });
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return reject("malformed");
    }
    const record = raw as Record<string, unknown>;
    if (record["v"] !== AUTHORING_EVENT_VERSION) {
      return reject("unsupported-version");
    }
    const type = record["type"];
    if (typeof type !== "string" || !KNOWN_FRAME_TYPES.has(type)) {
      return reject("unknown-type");
    }
    if (type === "authoring.event") {
      const cursor = record["cursor"];
      // The cursor is validated BEFORE kind classification: an unknown kind
      // still has to consume a trustworthy transport position, so a frame
      // without one is malformed rather than tolerated.
      if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) {
        return reject("malformed");
      }
      const classified = classifyAuthoringEvent(record["event"]);
      if (classified.status === "unsupported-version") {
        return reject("unsupported-version");
      }
      if (classified.status === "unknown-kind") {
        return { ok: false, outcome: "unknown-kind", rawKind: classified.rawKind, cursor };
      }
      const frame = authoringEventFrameSchema.safeParse(record);
      if (!frame.success) {
        return reject("malformed");
      }
      return { ok: true, value: frame.data as AuthoringInboundFrame };
    }
    const parsed = authoringInboundFrameSchema.safeParse(record);
    if (!parsed.success) {
      return reject("malformed");
    }
    return { ok: true, value: parsed.data as AuthoringInboundFrame };
  } catch {
    return reject("malformed");
  }
}

/** Parse one domain event without throwing (used by the reconciler + tests). */
export function parseAuthoringEvent(raw: unknown): AuthoringEventParseResult {
  try {
    const classified = classifyAuthoringEvent(raw);
    if (classified.status === "unsupported-version") {
      return { ok: false, reason: "unsupported-version" };
    }
    if (classified.status === "unknown-kind") {
      return { ok: false, reason: "unknown-kind" };
    }
    return { ok: true, value: classified.event };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export type { AuthoringEntityRef, AuthoringEventV1 };
