import { describe, expect, it } from "vitest";
import {
  deriveDraftLifecycle,
  resolveDraftSeams,
  type DraftLifecycleInput,
} from "../authoringDraftLifecycle";
import type { QuestionRevision } from "../../contracts/assessment";

// The model never reads the document's content — it only answers whether one
// exists — so the fixture only has to be a `QuestionRevision` identity.
const draft = { id: "rev-1", revision: 3 } as unknown as QuestionRevision;

function input(overrides: Partial<DraftLifecycleInput> = {}): DraftLifecycleInput {
  return {
    draft,
    saveStatus: "saved",
    hasPendingChanges: false,
    divergedFromBase: false,
    publishedReadOnly: false,
    deletedRemotely: false,
    ...overrides,
  };
}

describe("deriveDraftLifecycle", () => {
  it("is loading while there is no local document", () => {
    expect(deriveDraftLifecycle(input({ draft: null })).state).toBe("loading");
  });

  it("is editing for a clean, acknowledged draft", () => {
    const lifecycle = deriveDraftLifecycle(input());
    expect(lifecycle.state).toBe("editing");
    expect(lifecycle.dirty).toBe(false);
    expect(lifecycle.conflicted).toBe(false);
  });

  it("is saving only while a write is actually in flight", () => {
    expect(deriveDraftLifecycle(input({ saveStatus: "saving" })).state).toBe("saving");
    expect(deriveDraftLifecycle(input({ saveStatus: "unsaved" })).state).toBe("editing");
  });

  it("treats a pending write and diverged content as the same dirty condition", () => {
    expect(deriveDraftLifecycle(input({ hasPendingChanges: true })).dirty).toBe(true);
    expect(deriveDraftLifecycle(input({ divergedFromBase: true })).dirty).toBe(true);
  });

  it("folds the HTTP 409 fence into conflicted beside the socket-delivered divergence", () => {
    expect(deriveDraftLifecycle(input({ saveStatus: "conflict" })).state).toBe("conflicted");
    expect(deriveDraftLifecycle(input({ divergedFromBase: true })).state).toBe("conflicted");
  });
});

describe("draft lifecycle precedence", () => {
  // The order the save router already used, extended to the remaining
  // conditions. A published draft answers a write with "open the new draft"; a
  // deleted question answers 404, so the published target is the more useful
  // answer when both are true.
  it("resolves published over deleted over conflicted over saving over editing", () => {
    expect(
      deriveDraftLifecycle(
        input({
          publishedReadOnly: true,
          deletedRemotely: true,
          divergedFromBase: true,
          saveStatus: "saving",
        })
      ).state
    ).toBe("published-readonly");
    expect(
      deriveDraftLifecycle(
        input({ deletedRemotely: true, divergedFromBase: true, saveStatus: "saving" })
      ).state
    ).toBe("deleted-remotely");
    expect(
      deriveDraftLifecycle(input({ divergedFromBase: true, saveStatus: "saving" })).state
    ).toBe("conflicted");
    expect(deriveDraftLifecycle(input({ saveStatus: "saving" })).state).toBe("saving");
  });

  it("keeps a condition readable even when a higher-precedence state wins", () => {
    // A published draft that was also deleted: the STATE is the published one,
    // but "is this question gone?" must still answer yes, because the deletion
    // notice is driven by the condition, not the state.
    const lifecycle = deriveDraftLifecycle(
      input({ publishedReadOnly: true, deletedRemotely: true })
    );
    expect(lifecycle.state).toBe("published-readonly");
    expect(lifecycle.deletedRemotely).toBe(true);
    expect(lifecycle.publishedReadOnly).toBe(true);
  });

  it("never represents a conflicted draft as also saving", () => {
    // The impossible combination the plan names: `conflicted` and `saving` were
    // independent booleans, so a fenced payload could keep being re-sent.
    const lifecycle = deriveDraftLifecycle(input({ saveStatus: "conflict" }));
    expect(lifecycle.state).not.toBe("saving");
  });

  it("never represents a draft whose question is gone as editable", () => {
    const lifecycle = deriveDraftLifecycle(input({ deletedRemotely: true }));
    expect(lifecycle.state).toBe("deleted-remotely");
  });
});

describe("resolveDraftSeams", () => {
  it("freezes the write target while published, and holds the network while conflicted", () => {
    const seams = resolveDraftSeams(
      deriveDraftLifecycle(input({ publishedReadOnly: true, divergedFromBase: true }))
    );
    expect(seams.mutationFrozen).toBe(true);
    expect(seams.deletedRemotely).toBe(false);
    expect(seams.networkSavePaused).toBe(true);
    // The local work is still held: freezing the write never drops the content.
    expect(seams.protectLocalCopy).toBe(true);
  });

  it("protects the local copy only once a document exists", () => {
    // A recovered device draft can raise the pending flag BEFORE the editor had
    // anything in it. Protecting that would block the seed and the question
    // would never open at all.
    expect(
      resolveDraftSeams(
        deriveDraftLifecycle(input({ draft: null, hasPendingChanges: true }))
      ).protectLocalCopy
    ).toBe(false);
    expect(
      resolveDraftSeams(
        deriveDraftLifecycle(input({ hasPendingChanges: true }))
      ).protectLocalCopy
    ).toBe(true);
  });

  it("leaves a clean draft unfrozen, unprotected and unpaused", () => {
    const seams = resolveDraftSeams(deriveDraftLifecycle(input()));
    expect(seams).toEqual({
      mutationFrozen: false,
      deletedRemotely: false,
      protectLocalCopy: false,
      networkSavePaused: false,
    });
  });

  it("pauses the network for a fenced draft even without a divergence record", () => {
    // HTTP, not the event stream, is authoritative on the 409 fence: delivery
    // may be off, degraded, or the write may have raced a save that committed.
    expect(
      resolveDraftSeams(deriveDraftLifecycle(input({ saveStatus: "conflict" })))
        .networkSavePaused
    ).toBe(true);
  });
});
