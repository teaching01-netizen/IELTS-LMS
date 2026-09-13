import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import {
  clearDurableDraft,
  loadDurableDraft,
  saveDurableDraft,
} from "../../../../utils/durableDraftStore";
import { useQuestionAutosave } from "../useQuestionAutosave";

/**
 * The divergence invariant: when another author holds a newer revision, the
 * NETWORK write pauses while the DURABLE local write continues. Revision
 * fencing remains the backend safety net — this is about not spamming
 * known-stale requests and not letting a refetched fence silently overwrite a
 * colleague's revision without the author choosing to.
 */

const revision: QuestionRevision = {
  id: "revision-1",
  questionId: "question-1",
  semanticRevision: 1,
  revision: 1,
  state: "draft",
  questionType: "single_choice",
  stimulus: { version: 1, nodes: [] },
  prompt: { version: 1, nodes: [{ type: "paragraph", id: "prompt", text: "Prompt" }] },
  answer: {
    kind: "single_choice",
    options: [
      { id: "A", content: { version: 1, nodes: [] } },
      { id: "B", content: { version: 1, nodes: [] } },
    ],
    correctOptionId: "A",
  },
  rationale: { version: 1, nodes: [] },
  metadata: {
    sectionKey: "reading-writing",
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

describe("useQuestionAutosave network pause (divergence)", () => {
  it("holds the write while paused and sends it once the pause lifts", async () => {
    const paused = { current: true };
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0, networkPausedRef: paused }),
    );

    act(() => hook.result.current.scheduleAutosave(revision));

    expect(save).not.toHaveBeenCalled();
    // The author is still dirty: the work exists, it just has not been sent.
    expect(hook.result.current.hasPendingChanges).toBe(true);
    expect(hook.result.current.isNetworkPaused).toBe(true);

    paused.current = false;
    act(() => hook.result.current.scheduleAutosave(revision));

    await waitFor(() => expect(save).toHaveBeenCalledWith(revision));
  });

  it("refuses a manual flush while paused instead of reporting a silent success", async () => {
    const paused = { current: true };
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0, networkPausedRef: paused }),
    );

    let result: Awaited<ReturnType<typeof hook.result.current.flushNow>> | undefined;
    await act(async () => {
      result = await hook.result.current.flushNow(revision);
    });

    expect(save).not.toHaveBeenCalled();
    // Not ok: the caller must know the server does not have this content yet.
    expect(result?.ok).toBe(false);
    expect(result?.isLatest).toBe(true);
    expect(hook.result.current.hasPendingChanges).toBe(true);
  });

  it("does not leak a stale write through a retry", async () => {
    const paused = { current: true };
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0, networkPausedRef: paused }),
    );

    act(() => hook.result.current.retry(revision));
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the pause honest across an offline -> online round trip", async () => {
    const paused = { current: true };
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0, networkPausedRef: paused }),
    );

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    act(() => hook.result.current.scheduleAutosave(revision));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    // Reconnecting must not become a backdoor for a write we deliberately held.
    expect(save).not.toHaveBeenCalled();
  });

  it("is not paused when the ref is absent, so existing callers are unchanged", async () => {
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0 }),
    );

    act(() => hook.result.current.scheduleAutosave(revision));

    await waitFor(() => expect(save).toHaveBeenCalledWith(revision));
    expect(hook.result.current.isNetworkPaused).toBe(false);
  });
});

const KEY = "staff-draft-test:question:staff-a:exam-a:conflict";

describe("useQuestionAutosave: resolving a fenced write", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearDurableDraft(KEY).catch(() => undefined);
  });
  afterEach(async () => {
    await clearDurableDraft(KEY).catch(() => undefined);
    window.localStorage.clear();
  });

  it("clears the fenced status and the device copy when the author takes the server's revision", async () => {
    await saveDurableDraft(KEY, revision);
    const conflict = Object.assign(new Error("revision conflict"), { status: 409 });
    const save = vi.fn().mockRejectedValue(conflict);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: KEY, debounceMs: 0 }),
    );

    await act(async () => {
      await hook.result.current.flushNow(revision);
    });
    expect(hook.result.current.status).toBe("conflict");
    expect(hook.result.current.hasPendingChanges).toBe(true);

    act(() => hook.result.current.acknowledgeServerRevision());

    // Nothing is left to send, so the save area must stop offering a Retry for
    // a payload the client already knows is stale…
    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.hasPendingChanges).toBe(false);
    // …and the device copy must go with it: a surviving draft would re-surface
    // as "recovered unsaved changes" for work the author just resolved against.
    await waitFor(async () => {
      expect(await loadDurableDraft(KEY)).toBeNull();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
