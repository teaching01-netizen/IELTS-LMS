import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import { useQuestionAutosave } from "../useQuestionAutosave";

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
      { id: "C", content: { version: 1, nodes: [] } },
      { id: "D", content: { version: 1, nodes: [] } },
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

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useQuestionAutosave offline behavior", () => {
  afterEach(() => setOnline(true));

  it("keeps edits local while offline and retries the newest draft after reconnecting", async () => {
    setOnline(false);
    const save = vi.fn().mockResolvedValue(revision);
    const hook = renderHook(() =>
      useQuestionAutosave({ save, durableKey: null, debounceMs: 0 }),
    );

    act(() => hook.result.current.scheduleAutosave(revision));

    expect(hook.result.current.status).toBe("offline");
    expect(save).not.toHaveBeenCalled();

    setOnline(true);
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(save).toHaveBeenCalledWith(revision));
    expect(hook.result.current.status).toBe("saved");
  });
});
