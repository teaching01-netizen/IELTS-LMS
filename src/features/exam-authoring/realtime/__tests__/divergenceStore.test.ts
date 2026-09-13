import { describe, expect, it } from "vitest";
import {
  MAX_TRACKED_DIVERGENCES,
  applyDivergenceEvent,
  createDivergenceState,
  divergenceFor,
  isQuestionDirty,
  locallyEdited,
  type DivergenceState,
} from "../divergenceStore";
import type { DivergenceEvent } from "../divergenceTypes";
import { makeRevision } from "./divergenceFixtures";

const AT = "2026-09-13T12:00:00.000Z";
const LATER = "2026-09-13T12:00:05.000Z";
const ID = "eq-1";

function apply(state: DivergenceState, ...events: DivergenceEvent[]): DivergenceState {
  return events.reduce(
    (acc, event, index) => applyDivergenceEvent(acc, event, index === 0 ? AT : LATER),
    state,
  );
}

function seeded(local?: ReturnType<typeof makeRevision>) {
  const base = makeRevision();
  const state = apply(createDivergenceState(), {
    type: "INIT_BASELINE",
    examQuestionId: ID,
    base,
    ...(local ? { local } : {}),
  });
  return { base, state };
}

describe("divergenceStore: a refetch is not a resolution", () => {
  it("stays DIVERGED when a refetch advances the base past the editor's revision", () => {
    const { base, state } = seeded();
    const mine = {
      ...base,
      prompt: { type: "doc", content: [{ text: "mine" }] },
    } as ReturnType<typeof makeRevision>;
    const dirty = apply(state, { type: "LOCAL_EDIT", examQuestionId: ID, local: mine });
    expect(divergenceFor(dirty, ID)?.status).toBe("dirty");

    // Alice saved revision 4 while we held local work. Opening Review (or any
    // other refetch) re-seeds the baseline with the newer revision — that must
    // NOT read as "resolved", or the author would be told their conflict
    // evaporated and the pause on network autosave would lift silently.
    const reseeded = apply(dirty, {
      type: "INIT_BASELINE",
      examQuestionId: ID,
      base: makeRevision({ revision: 4 }),
      local: mine,
    });
    const entry = divergenceFor(reseeded, ID);
    expect(entry?.status).toBe("diverged");
    expect(entry?.remoteRevision).toBe(4);
    expect(entry?.localDocument).toEqual(mine);
  });

  it("stays clean when a refetch lands on content that matches the new base", () => {
    const { state } = seeded();
    const newer = makeRevision({ revision: 4 });
    const reseeded = apply(state, {
      type: "INIT_BASELINE",
      examQuestionId: ID,
      base: newer,
      local: newer,
    });
    expect(divergenceFor(reseeded, ID)?.status).toBe("clean");
  });

  it("keeps a remote structural flag across a refetch re-seed", () => {
    const { base, state } = seeded();
    const deleted = apply(state, { type: "REMOTE_DELETED", examQuestionId: ID });
    const reseeded = apply(deleted, {
      type: "INIT_BASELINE",
      examQuestionId: ID,
      base: makeRevision({ revision: 4 }),
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    expect(divergenceFor(reseeded, ID)?.deletedRemotely).toBe(true);
  });
});

describe("divergenceStore: my OWN save is not a remote revision", () => {
  /**
   * `saveDraft` lands `setDraft(saved)` and the query-cache write in ONE batch,
   * so the divergence hook re-seeds with `base = saved` while the entry still
   * holds the edited draft. The base advances ONLY because of the server ack;
   * without it the re-seed is indistinguishable from a collaborator's newer
   * revision — the save area would claim "a newer version is available" for the
   * author's own save, and the network autosave pause would swallow their next
   * edit. Both halves of this pair are asserted so the ordering can never be
   * "fixed" by weakening the refetch-is-not-a-resolution rule above.
   */
  it("stays clean when a successful save is acked before the baseline re-seeds", () => {
    const { base, state } = seeded();
    const mine = {
      ...base,
      prompt: { type: "doc", content: [{ text: "mine" }] },
    } as ReturnType<typeof makeRevision>;
    const dirty = apply(state, { type: "LOCAL_EDIT", examQuestionId: ID, local: mine });
    // What the server returns for that save: the author's content, next revision.
    const saved = { ...mine, revision: 4 } as ReturnType<typeof makeRevision>;
    const acked = apply(dirty, { type: "SERVER_ACK", examQuestionId: ID, saved });
    const reseeded = apply(acked, {
      type: "INIT_BASELINE",
      examQuestionId: ID,
      base: saved,
      local: saved,
    });
    const entry = divergenceFor(reseeded, ID);
    expect(entry?.status).toBe("clean");
    expect(entry?.remoteRevision).toBeNull();
  });

  it("would read as DIVERGED with no ack — the regression this guards", () => {
    const { base, state } = seeded();
    const mine = {
      ...base,
      prompt: { type: "doc", content: [{ text: "mine" }] },
    } as ReturnType<typeof makeRevision>;
    const dirty = apply(state, { type: "LOCAL_EDIT", examQuestionId: ID, local: mine });
    const saved = { ...mine, revision: 4 } as ReturnType<typeof makeRevision>;
    const reseeded = apply(dirty, {
      type: "INIT_BASELINE",
      examQuestionId: ID,
      base: saved,
      local: saved,
    });
    expect(divergenceFor(reseeded, ID)?.status).toBe("diverged");
  });
});

describe("divergenceStore dirty transitions", () => {
  it("starts clean when the local document is the freshly fetched revision", () => {
    const { state } = seeded();
    expect(divergenceFor(state, ID)?.status).toBe("clean");
    expect(isQuestionDirty(divergenceFor(state, ID), false)).toBe(false);
  });

  it("starts DIRTY when a recovered durable draft differs from the fetch", () => {
    const base = makeRevision();
    const recovered = { ...base, prompt: { type: "doc", content: [{ text: "recovered" }] } };
    const { state } = seeded(recovered as ReturnType<typeof makeRevision>);
    expect(divergenceFor(state, ID)?.status).toBe("dirty");
  });

  it("goes clean -> dirty on a content edit", () => {
    const { base, state } = seeded();
    const next = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    expect(divergenceFor(next, ID)?.status).toBe("dirty");
  });

  it("returns to CLEAN when an edit is undone back to the base content", () => {
    const { base, state } = seeded();
    const edited = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    expect(divergenceFor(edited, ID)?.status).toBe("dirty");
    // Typing then deleting must not leave a phantom dirty flag: CONTENT is the
    // authority, not the keystrokes that produced it.
    const reverted = apply(edited, { type: "LOCAL_EDIT", examQuestionId: ID, local: base });
    expect(divergenceFor(reverted, ID)?.status).toBe("clean");
    expect(locallyEdited(divergenceFor(reverted, ID)!)).toBe(false);
  });

  it("dirty -> clean with a base bump on a server ack", () => {
    const { base, state } = seeded();
    const saved = { ...base, revision: 4 };
    const next = apply(state, {
      type: "SERVER_ACK",
      examQuestionId: ID,
      saved: saved as ReturnType<typeof makeRevision>,
    });
    const entry = divergenceFor(next, ID);
    expect(entry?.status).toBe("clean");
    expect(entry?.baseRevision).toBe(4);
    expect(entry?.remoteRevision).toBeNull();
  });
});

describe("divergenceStore remote revisions", () => {
  it("dirty + newer remote becomes DIVERGED and preserves local byte-identically", () => {
    const { base, state } = seeded();
    const local = { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } };
    const edited = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: local as ReturnType<typeof makeRevision>,
    });
    const before = divergenceFor(edited, ID)?.localDocument;
    const diverged = apply(edited, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
      author: { displayName: "Alice" },
    });
    const entry = divergenceFor(diverged, ID);
    expect(entry?.status).toBe("diverged");
    expect(entry?.remoteRevision).toBe(9);
    expect(entry?.remoteAuthor?.displayName).toBe("Alice");
    // The remote event must not have written the local slot at all.
    expect(entry?.localDocument).toBe(before);
    expect(JSON.stringify(entry?.localDocument)).toBe(JSON.stringify(local));
  });

  it("clean + newer remote becomes remote-newer-clean (the refetch path)", () => {
    const { state } = seeded();
    const next = apply(state, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
    });
    expect(divergenceFor(next, ID)?.status).toBe("remote-newer-clean");
  });

  it("honours the autosave hint even when content matches base", () => {
    const { state } = seeded();
    const next = apply(state, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
      hasPendingChanges: true,
    });
    expect(divergenceFor(next, ID)?.status).toBe("diverged");
  });

  it("never lets a duplicate or out-of-order remote revision un-diverge", () => {
    const { state } = seeded();
    const first = apply(state, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
    });
    const older = apply(first, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 4,
    });
    const duplicate = apply(older, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
    });
    expect(divergenceFor(older, ID)?.remoteRevision).toBe(9);
    expect(divergenceFor(duplicate, ID)?.status).toBe("remote-newer-clean");
  });

  it("stores a lazily fetched remote document without touching base or local", () => {
    const { base, state } = seeded();
    const edited = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    const remote = makeRevision({ revision: 9 });
    const withDoc = apply(edited, { type: "REMOTE_DOCUMENT", examQuestionId: ID, remote });
    const entry = divergenceFor(withDoc, ID);
    expect(entry?.remoteDocument).toBe(remote);
    expect(entry?.baseRevision).toBe(3);
    expect(entry?.status).toBe("dirty");
  });
});

describe("divergenceStore structural flags", () => {
  it("records a remote deletion as a flag on the existing status, not a new status", () => {
    const { base, state } = seeded();
    const edited = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    const deleted = apply(edited, {
      type: "REMOTE_DELETED",
      examQuestionId: ID,
      author: { displayName: "Alice" },
    });
    const entry = divergenceFor(deleted, ID);
    expect(entry?.deletedRemotely).toBe(true);
    expect(entry?.status).toBe("dirty");
    expect(entry?.localDocument).toBe(divergenceFor(edited, ID)?.localDocument);
  });

  it("records move and bulk-change flags independently", () => {
    const { state } = seeded();
    const moved = apply(state, { type: "REMOTE_MOVED", examQuestionId: ID });
    expect(divergenceFor(moved, ID)?.movedRemotely).toBe(true);
    const bulk = apply(moved, { type: "REMOTE_BULK_CHANGED", examQuestionId: ID });
    expect(divergenceFor(bulk, ID)?.bulkChangedRemotely).toBe(true);
    expect(divergenceFor(bulk, ID)?.movedRemotely).toBe(true);
  });

  it("retires structural flags on a server ack, because the draft is real again", () => {
    const { base, state } = seeded();
    const flagged = apply(
      state,
      { type: "REMOTE_DELETED", examQuestionId: ID },
      { type: "REMOTE_MOVED", examQuestionId: ID },
    );
    const saved = apply(flagged, {
      type: "SERVER_ACK",
      examQuestionId: ID,
      saved: { ...base, revision: 5 } as ReturnType<typeof makeRevision>,
    });
    const entry = divergenceFor(saved, ID);
    expect(entry?.deletedRemotely).toBeUndefined();
    expect(entry?.movedRemotely).toBeUndefined();
  });
});

describe("divergenceStore resolution", () => {
  it("RESOLVE_USE_LATEST adopts the remote as both base and local and goes clean", () => {
    const { base, state } = seeded();
    const edited = apply(state, {
      type: "LOCAL_EDIT",
      examQuestionId: ID,
      local: { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    const diverged = apply(edited, {
      type: "REMOTE_REVISION",
      examQuestionId: ID,
      remoteRevision: 9,
    });
    const remote = makeRevision({ revision: 9 });
    const resolved = apply(diverged, { type: "RESOLVE_USE_LATEST", examQuestionId: ID, remote });
    const entry = divergenceFor(resolved, ID);
    expect(entry?.status).toBe("clean");
    expect(entry?.baseRevision).toBe(9);
    expect(entry?.localDocument).toBe(remote);
    expect(entry?.remoteRevision).toBeNull();
  });

  it("RESOLVE_KEEP_EDITING resolves nothing: still diverged, draft untouched", () => {
    const { base, state } = seeded();
    const local = { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } };
    const diverged = apply(
      apply(state, {
        type: "LOCAL_EDIT",
        examQuestionId: ID,
        local: local as ReturnType<typeof makeRevision>,
      }),
      { type: "REMOTE_REVISION", examQuestionId: ID, remoteRevision: 9 },
    );
    const kept = apply(diverged, { type: "RESOLVE_KEEP_EDITING", examQuestionId: ID });
    const entry = divergenceFor(kept, ID);
    expect(entry?.status).toBe("diverged");
    expect(entry?.remoteRevision).toBe(9);
    expect(JSON.stringify(entry?.localDocument)).toBe(JSON.stringify(local));
  });

  it("CLOSE_QUESTION drops the entry so a later open re-initializes from fetch", () => {
    const { state } = seeded();
    const closed = apply(state, { type: "CLOSE_QUESTION", examQuestionId: ID });
    expect(divergenceFor(closed, ID)).toBeUndefined();
  });
});

describe("divergenceStore purity and bounds", () => {
  it("never mutates the input state", () => {
    const base = makeRevision();
    const state = seeded().state;
    const frozen = state;
    const next = applyDivergenceEvent(
      frozen,
      { type: "REMOTE_REVISION", examQuestionId: ID, remoteRevision: 9 },
      AT,
    );
    expect(next).not.toBe(frozen);
    expect(frozen.entries.get(ID)?.remoteRevision).toBeNull();
    expect(base).toBeDefined();
  });

  it("bounds the tracked map, keeping signal over clean entries", () => {
    let state = createDivergenceState();
    for (let index = 0; index < MAX_TRACKED_DIVERGENCES + 5; index += 1) {
      state = applyDivergenceEvent(
        state,
        {
          type: "INIT_BASELINE",
          examQuestionId: `eq-${index}`,
          base: makeRevision({ revision: index + 1 }),
        },
        new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString(),
      );
    }
    expect(state.entries.size).toBeLessThanOrEqual(MAX_TRACKED_DIVERGENCES);
    // The most recent question must still be tracked.
    expect(divergenceFor(state, `eq-${MAX_TRACKED_DIVERGENCES + 4}`)).toBeDefined();
  });
});
