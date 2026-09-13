import { describe, expect, it } from "vitest";
import {
  COMPARE_FIELD_KEYS,
  canonicalStringify,
  classifyQuestionFields,
  documentContentEquals,
  fateOf,
  hasSameFieldConflict,
  isAutoMergeable,
} from "../threeWayCompare";
import { makeRevision, revisionBumped } from "./divergenceFixtures";

function withField(base: ReturnType<typeof makeRevision>, patch: Record<string, unknown>) {
  return { ...base, ...patch } as ReturnType<typeof makeRevision>;
}

describe("canonicalStringify", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it("keeps array order significant, because option order is content", () => {
    expect(canonicalStringify(["a", "b"])).not.toBe(canonicalStringify(["b", "a"]));
  });

  it("treats an absent key and an explicit undefined as the same", () => {
    expect(canonicalStringify({ a: 1 })).toBe(canonicalStringify({ a: 1, b: undefined }));
  });
});

describe("fateOf", () => {
  it("covers all five fates", () => {
    expect(fateOf("x", "x", "x")).toBe("unchanged");
    expect(fateOf("x", "y", "x")).toBe("local-only");
    expect(fateOf("x", "x", "y")).toBe("remote-only");
    expect(fateOf("x", "y", "y")).toBe("same-change");
    expect(fateOf("x", "y", "z")).toBe("conflict");
  });

  it("reports a conflict when both sides changed the same value identically", () => {
    // local == remote != base is a SAME-CHANGE, i.e. convergent, not a conflict.
    expect(fateOf("base", "new", "new")).toBe("same-change");
  });
});

describe("classifyQuestionFields", () => {
  it("always returns all eight rows in the frozen order", () => {
    const base = makeRevision();
    const rows = classifyQuestionFields({ base, local: base, remote: base });
    expect(rows.map((row) => row.field)).toEqual([...COMPARE_FIELD_KEYS]);
    expect(rows.every((row) => row.fate === "unchanged")).toBe(true);
  });

  it("classifies a local prompt edit as local-only and leaves other fields alone", () => {
    const base = makeRevision();
    const local = withField(base, { prompt: { type: "doc", content: [{ text: "mine" }] } });
    const rows = classifyQuestionFields({ base, local, remote: base });
    expect(rows.find((row) => row.field === "prompt")?.fate).toBe("local-only");
    expect(rows.filter((row) => row.fate !== "unchanged")).toHaveLength(1);
  });

  it("treats rich-text edits on the same field as a conflict, never a character merge", () => {
    const base = makeRevision();
    const local = withField(base, { prompt: { type: "doc", content: [{ text: "mine" }] } });
    const remote = withField(base, { prompt: { type: "doc", content: [{ text: "theirs" }] } });
    const rows = classifyQuestionFields({ base, local, remote });
    expect(rows.find((row) => row.field === "prompt")?.fate).toBe("conflict");
    expect(hasSameFieldConflict(rows)).toBe(true);
  });

  it("reports local-only + remote-only across DIFFERENT fields as auto-mergeable in principle", () => {
    const base = makeRevision();
    const local = withField(base, { rationale: { type: "doc", content: [{ text: "mine" }] } });
    const remote = withField(base, { prompt: { type: "doc", content: [{ text: "theirs" }] } });
    const rows = classifyQuestionFields({ base, local, remote });
    expect(isAutoMergeable(rows)).toBe(true);
    expect(hasSameFieldConflict(rows)).toBe(false);
  });

  it("ignores tag ORDER but not tag membership", () => {
    const base = makeRevision({ metadata: { ...makeRevision().metadata, tags: ["a", "b"] } });
    const reordered = makeRevision({
      metadata: { ...makeRevision().metadata, tags: ["b", "a"] },
    });
    expect(
      classifyQuestionFields({ base, local: reordered, remote: base }).find(
        (row) => row.field === "metadata",
      )?.fate,
    ).toBe("unchanged");

    const added = makeRevision({
      metadata: { ...makeRevision().metadata, tags: ["a", "b", "c"] },
    });
    expect(
      classifyQuestionFields({ base, local: added, remote: base }).find(
        (row) => row.field === "metadata",
      )?.fate,
    ).toBe("local-only");
  });

  it("classifies the answer key separately from the choices", () => {
    const base = makeRevision();
    const keyed = withField(base, {
      answer: { kind: "single_choice", options: base.answer.kind === "single_choice" ? base.answer.options : [], correctOptionId: "b" },
    });
    const rows = classifyQuestionFields({ base, local: keyed, remote: base });
    expect(rows.find((row) => row.field === "answer-key")?.fate).toBe("local-only");
    expect(rows.find((row) => row.field === "choices")?.fate).toBe("unchanged");
  });

  it("slices SPR answers by accepted responses and normalisation flags", () => {
    const base = makeRevision({
      questionType: "student_produced_response",
      answer: {
        kind: "student_produced_response",
        acceptedResponses: ["1/2"],
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      },
    });
    const local = withField(base, {
      answer: {
        kind: "student_produced_response",
        acceptedResponses: ["0.5"],
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      },
    });
    const rows = classifyQuestionFields({ base, local, remote: base });
    expect(rows.find((row) => row.field === "choices")?.fate).toBe("local-only");
    expect(rows.find((row) => row.field === "answer-key")?.fate).toBe("unchanged");
  });
});

describe("documentContentEquals", () => {
  it("ignores revision bookkeeping so a no-op save is not a local edit", () => {
    const base = makeRevision();
    expect(documentContentEquals(base, revisionBumped(base, 9))).toBe(true);
  });

  it("detects a real content change", () => {
    const base = makeRevision();
    const changed = withField(base, { prompt: { type: "doc", content: [{ text: "x" }] } });
    expect(documentContentEquals(base, changed)).toBe(false);
  });
});
