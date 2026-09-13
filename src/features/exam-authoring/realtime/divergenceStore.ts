import { documentContentEquals } from "./threeWayCompare";
import {
  deriveDivergenceStatus,
  type DivergenceEvent,
  type DivergenceStatus,
  type QuestionDivergence,
} from "./divergenceTypes";

/**
 * Per-question divergence state machine. Framework-free and PURE: it performs
 * no I/O, reads no clock, and touches no React. The caller stamps `at`, so the
 * same input sequence always yields the same output and the suite needs no
 * fake timers.
 *
 * Bounded by design: the map keeps the open question plus a small window of
 * background divergences (rail dots). Nothing about a *clean* question is worth
 * remembering, so those are evicted first.
 */

export const MAX_TRACKED_DIVERGENCES = 20;

export interface DivergenceState {
  readonly entries: ReadonlyMap<string, QuestionDivergence>;
}

export function createDivergenceState(): DivergenceState {
  return { entries: new Map() };
}

/** True when the local document differs in CONTENT from the base revision. */
export function locallyEdited(entry: QuestionDivergence): boolean {
  return (
    entry.localDocument !== null &&
    entry.baseDocument !== null &&
    !documentContentEquals(entry.localDocument, entry.baseDocument)
  );
}

function isDirtyEntry(entry: QuestionDivergence, hasPendingChanges: boolean): boolean {
  return hasPendingChanges || locallyEdited(entry);
}

function withStatus(
  entry: QuestionDivergence,
  hasPendingChanges: boolean,
): QuestionDivergence {
  return {
    ...entry,
    status: deriveDivergenceStatus({
      hasPendingChanges,
      contentDiffers: locallyEdited(entry),
      remoteRevision: entry.remoteRevision,
      baseRevision: entry.baseRevision,
    }),
  };
}

function emptyEntry(examQuestionId: string, at: string): QuestionDivergence {
  return {
    examQuestionId,
    baseRevision: 0,
    baseDocument: null,
    localDocument: null,
    remoteRevision: null,
    remoteDocument: null,
    status: "clean",
    updatedAt: at,
  };
}

/**
 * Eviction order: a clean question carries no signal, so it goes first, then
 * the least recently updated. The open question is refreshed on every edit and
 * is closed explicitly on switch, so it is never the victim in practice.
 */
function prune(entries: Map<string, QuestionDivergence>): Map<string, QuestionDivergence> {
  if (entries.size <= MAX_TRACKED_DIVERGENCES) {
    return entries;
  }
  const ranked = [...entries.values()].sort((a, b) => {
    const aSignal = a.status === "clean" ? 0 : 1;
    const bSignal = b.status === "clean" ? 0 : 1;
    if (aSignal !== bSignal) return aSignal - bSignal;
    return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
  });
  const keep = new Set(
    ranked.slice(ranked.length - MAX_TRACKED_DIVERGENCES).map((entry) => entry.examQuestionId),
  );
  const next = new Map<string, QuestionDivergence>();
  for (const [id, entry] of entries) {
    if (keep.has(id)) next.set(id, entry);
  }
  return next;
}

/**
 * Apply one divergence event. Returns a NEW state; the input is never mutated.
 *
 * Remote events never write `base*` or `local*`: only a server ack or an
 * explicit resolution may move those, which is what makes "preserve the dirty
 * draft byte-identical" a structural property rather than a convention.
 */
export function applyDivergenceEvent(
  state: DivergenceState,
  event: DivergenceEvent,
  at: string,
): DivergenceState {
  const entries = new Map(state.entries);
  const existing = entries.get(event.examQuestionId);

  switch (event.type) {
    case "INIT_BASELINE": {
      const local = event.local ?? event.base;
      // A remote structural fact (delete / move / bulk) is not resolved by a
      // refetch either: the row may be gone from the shell while the author's
      // draft is still open here.
      const structuralFlagPending =
        existing !== undefined &&
        (existing.deletedRemotely === true ||
          existing.movedRemotely === true ||
          existing.bulkChangedRemotely === true);
      const keepExistingBase =
        existing !== undefined &&
        event.base.revision > existing.baseRevision &&
        (isDirtyEntry(existing, false) || structuralFlagPending);
      // A re-seed is NOT a resolution.
      //
      // The server has moved ahead of the revision this editor was working
      // against, so the entry keeps ITS base and records the newer revision as
      // REMOTE. Two reasons, both load-bearing:
      //
      //   1. Divergence must not evaporate because a refetch happened; the
      //      author has to actually decide. (Otherwise the pause on network
      //      autosave would lift silently.)
      //   2. `base` is the document the author STARTED FROM, which is the only
      //      thing that makes a three-way compare truthful. Adopting the newer
      //      revision as the base would collapse it into a two-way diff, in
      //      which a genuine same-field conflict can never be reported as one.
      if (keepExistingBase && existing) {
        entries.set(
          event.examQuestionId,
          withStatus(
            {
              ...existing,
              remoteRevision: Math.max(
                existing.remoteRevision ?? -1,
                event.base.revision,
              ),
              localDocument: local,
              updatedAt: at,
            },
            false,
          ),
        );
        return { entries: prune(entries) };
      }
      const entry: QuestionDivergence = {
        ...emptyEntry(event.examQuestionId, at),
        baseRevision: event.base.revision,
        baseDocument: event.base,
        localDocument: local,
      };
      // A recovered durable draft starts DIRTY (content differs from the
      // freshly fetched server revision), which is exactly the
      // "restore without auto-overwriting" rule.
      entries.set(event.examQuestionId, withStatus(entry, false));
      return { entries: prune(entries) };
    }

    case "LOCAL_EDIT": {
      const entry: QuestionDivergence = {
        ...(existing ?? emptyEntry(event.examQuestionId, at)),
        localDocument: event.local,
        updatedAt: at,
        // Typing then deleting makes the document equal the base again, and
        // that must read as clean: content is the authority, not keystrokes.
        deletedRemotely: existing?.deletedRemotely,
      };
      entries.set(event.examQuestionId, withStatus(entry, false));
      return { entries: prune(entries) };
    }

    case "SERVER_ACK": {
      // The server agreed: base moves forward, remote bookkeeping clears, and
      // any structural flag is retired because the draft is now a real revision.
      const entry: QuestionDivergence = {
        ...(existing ?? emptyEntry(event.examQuestionId, at)),
        baseRevision: event.saved.revision,
        baseDocument: event.saved,
        localDocument: event.saved,
        remoteRevision: null,
        remoteDocument: null,
        remoteAuthor: undefined,
        deletedRemotely: undefined,
        movedRemotely: undefined,
        bulkChangedRemotely: undefined,
        updatedAt: at,
      };
      entries.set(event.examQuestionId, { ...entry, status: "clean" });
      return { entries: prune(entries) };
    }

    case "REMOTE_REVISION": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      const entry: QuestionDivergence = {
        ...current,
        // Monotonic: a duplicate or out-of-order event must never regress the
        // remote revision and thereby un-diverge a live conflict.
        remoteRevision: Math.max(current.remoteRevision ?? -1, event.remoteRevision),
        remoteAuthor: event.author ?? current.remoteAuthor,
        updatedAt: at,
      };
      entries.set(
        event.examQuestionId,
        withStatus(entry, event.hasPendingChanges === true),
      );
      return { entries: prune(entries) };
    }

    case "REMOTE_DOCUMENT": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      entries.set(event.examQuestionId, {
        ...current,
        remoteDocument: event.remote,
        remoteRevision: Math.max(current.remoteRevision ?? -1, event.remote.revision),
        updatedAt: at,
      });
      return { entries: prune(entries) };
    }

    case "REMOTE_DELETED": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      entries.set(event.examQuestionId, {
        ...current,
        deletedRemotely: true,
        remoteAuthor: event.author ?? current.remoteAuthor,
        updatedAt: at,
      });
      return { entries: prune(entries) };
    }

    case "REMOTE_MOVED": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      entries.set(event.examQuestionId, {
        ...current,
        movedRemotely: true,
        updatedAt: at,
      });
      return { entries: prune(entries) };
    }

    case "REMOTE_BULK_CHANGED": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      entries.set(event.examQuestionId, {
        ...current,
        bulkChangedRemotely: true,
        updatedAt: at,
      });
      return { entries: prune(entries) };
    }

    case "RESOLVE_USE_LATEST": {
      const current = existing ?? emptyEntry(event.examQuestionId, at);
      entries.set(event.examQuestionId, {
        ...current,
        baseRevision: event.remote.revision,
        baseDocument: event.remote,
        localDocument: event.remote,
        remoteRevision: null,
        remoteDocument: null,
        remoteAuthor: undefined,
        deletedRemotely: undefined,
        movedRemotely: undefined,
        bulkChangedRemotely: undefined,
        status: "clean",
        updatedAt: at,
      });
      return { entries: prune(entries) };
    }

    case "RESOLVE_KEEP_EDITING": {
      // Dismissing the notice does NOT resolve anything: the question stays
      // diverged and the local draft stays exactly as it was. Only the
      // notice's visibility is a UI concern.
      if (!existing) return state;
      entries.set(event.examQuestionId, { ...existing, updatedAt: at });
      return { entries: prune(entries) };
    }

    case "CLOSE_QUESTION": {
      entries.delete(event.examQuestionId);
      return { entries: prune(entries) };
    }

    default: {
      return state;
    }
  }
}

/** Read one entry (undefined when the question is not tracked). */
export function divergenceFor(
  state: DivergenceState,
  examQuestionId: string | null,
): QuestionDivergence | undefined {
  if (!examQuestionId) return undefined;
  return state.entries.get(examQuestionId);
}

/**
 * UI-facing dirty flag: content divergence OR an unsaved pending write. The
 * caller supplies the autosave truth so the store stays clock/DOM-free.
 */
export function isQuestionDirty(
  entry: QuestionDivergence | undefined,
  hasPendingChanges: boolean,
): boolean {
  if (!entry) return hasPendingChanges;
  return isDirtyEntry(entry, hasPendingChanges);
}

export function isDiverged(entry: QuestionDivergence | undefined): boolean {
  if (!entry) return false;
  return entry.status === "diverged" || entry.status === "remote-newer-clean";
}

export function statusOf(entry: QuestionDivergence | undefined): DivergenceStatus {
  return entry?.status ?? "clean";
}
