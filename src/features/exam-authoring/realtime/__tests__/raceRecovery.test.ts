import { describe, expect, it } from "vitest";
import {
  authorNameOf,
  decideDeletionRace,
  decideMoveRace,
  decidePublishRace,
  decideReconnect,
  sameQuestionEditors,
} from "../raceRecovery";
import type { AuthoringPresence } from "../presenceTypes";

describe("decideDeletionRace", () => {
  it("treats a background deletion as structural only, with no notice", () => {
    expect(
      decideDeletionRace({
        examQuestionId: "eq-2",
        selectedExamQuestionId: "eq-1",
        isDirty: true,
      }),
    ).toEqual({ kind: "background-structural", examQuestionId: "eq-2" });
  });

  it("advances selection when the open question is CLEAN", () => {
    expect(
      decideDeletionRace({
        examQuestionId: "eq-1",
        selectedExamQuestionId: "eq-1",
        isDirty: false,
      }),
    ).toEqual({ kind: "advance-selection", examQuestionId: "eq-1" });
  });

  it("preserves the draft and freezes the save path when the open question is DIRTY", () => {
    const action = decideDeletionRace({
      examQuestionId: "eq-1",
      selectedExamQuestionId: "eq-1",
      isDirty: true,
      author: { displayName: "Alice" },
    });
    expect(action).toEqual({
      kind: "preserve-deleted",
      examQuestionId: "eq-1",
      authorName: "Alice",
      freezeSavePath: true,
    });
  });

  it("degrades an unknown author to null so the UI can pick neutral wording", () => {
    const action = decideDeletionRace({
      examQuestionId: "eq-1",
      selectedExamQuestionId: "eq-1",
      isDirty: true,
      author: { displayName: "  " },
    });
    expect(action.kind === "preserve-deleted" && action.authorName).toBeNull();
  });
});

describe("decideMoveRace", () => {
  it("keeps the editor open for the open question and never clears the draft", () => {
    expect(
      decideMoveRace({
        examQuestionId: "eq-1",
        selectedExamQuestionId: "eq-1",
        bulk: false,
      }),
    ).toEqual({ kind: "keep-editor-open", examQuestionId: "eq-1", notice: "moved" });
  });

  it("distinguishes a bulk reorder from a single move", () => {
    const action = decideMoveRace({
      examQuestionId: "eq-1",
      selectedExamQuestionId: "eq-1",
      bulk: true,
    });
    expect(action.kind === "keep-editor-open" && action.notice).toBe("order-updated");
  });

  it("stays silent for a background move", () => {
    expect(
      decideMoveRace({ examQuestionId: "eq-2", selectedExamQuestionId: "eq-1", bulk: false }),
    ).toEqual({ kind: "background-structural", examQuestionId: "eq-2" });
  });
});

describe("decidePublishRace", () => {
  it("transitions a CLEAN editor in place and read-only", () => {
    expect(decidePublishRace({ selectedExamQuestionId: "eq-1", isDirty: false })).toEqual({
      kind: "preserve-published",
      examQuestionId: "eq-1",
      freezeMutations: true,
      readOnly: true,
    });
  });

  it("freezes a DIRTY editor and keeps its work, with a persistent recovery surface", () => {
    expect(decidePublishRace({ selectedExamQuestionId: "eq-1", isDirty: true })).toEqual({
      kind: "preserve-published",
      examQuestionId: "eq-1",
      freezeMutations: true,
      readOnly: false,
    });
  });

  it("freezes mutations even with no question selected", () => {
    const action = decidePublishRace({ selectedExamQuestionId: null, isDirty: false });
    expect(action.kind === "preserve-published" && action.freezeMutations).toBe(true);
  });
});

describe("decideReconnect (authoritative first)", () => {
  it("saves only when the base revision still matches the server", () => {
    expect(decideReconnect({ baseRevision: 7, remoteRevision: 7 })).toBe("save");
  });

  it("takes conflict recovery whenever the server moved, even by one", () => {
    expect(decideReconnect({ baseRevision: 7, remoteRevision: 8 })).toBe("conflict-recovery");
  });

  it("treats an unexpectedly older server revision as conflict recovery too", () => {
    // Cheap safety over clever equality: we cannot explain it, so we refuse to
    // blind-POST over whatever is there.
    expect(decideReconnect({ baseRevision: 7, remoteRevision: 6 })).toBe("conflict-recovery");
  });
});

describe("authorNameOf", () => {
  it("returns null for absent or blank names", () => {
    expect(authorNameOf(null)).toBeNull();
    expect(authorNameOf(undefined)).toBeNull();
    expect(authorNameOf({ displayName: "   " })).toBeNull();
    expect(authorNameOf({ displayName: "Alice" })).toBe("Alice");
  });
});

describe("sameQuestionEditors", () => {
  it("returns only editors of the open question", () => {
    const entries = [
      { selectedQuestionId: "eq-1", state: "editing" },
      { selectedQuestionId: "eq-1", state: "viewing" },
      { selectedQuestionId: "eq-2", state: "editing" },
    ] as AuthoringPresence[];
    expect(sameQuestionEditors(entries, "eq-1")).toHaveLength(1);
    expect(sameQuestionEditors(entries, null)).toEqual([]);
  });
});
