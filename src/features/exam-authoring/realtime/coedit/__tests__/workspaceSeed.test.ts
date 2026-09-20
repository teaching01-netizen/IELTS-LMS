import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_SEED_VALUE_BYTES,
  createWorkspaceSeedFrame,
  parseRefusedWorkspaceSeedIdentity,
  parseWorkspaceSeedFrame,
  workspaceSeedId,
  workspaceSeedPathRoot,
  workspaceSeedRefusalReason,
} from "../workspaceSeed";

const ROOM = "coedit:v2:exam-1";

describe("workspace seed frames", () => {
  it("binds one scalar root to an allowed workspace path", () => {
    const frame = createWorkspaceSeedFrame({
      documentName: ROOM,
      root: "scalar",
      path: "question/q-1/scalar",
      value: { isPretest: false, questionType: "single_choice" },
      sourceQuestionRevision: 7,
    });
    expect(frame.type).toBe("coedit.seed");
    expect(frame.seedId).toBe(workspaceSeedId(frame));
    expect(parseWorkspaceSeedFrame(JSON.stringify(frame), { documentName: ROOM })).toEqual(frame);
    expect(workspaceSeedPathRoot(frame.path)).toBe("scalar");
  });

  it("makes the id independent of object-key order but sensitive to source revision", () => {
    const first = createWorkspaceSeedFrame({
      documentName: ROOM,
      root: "rich",
      path: "question/q-1/prompt",
      value: { content: [{ type: "paragraph" }], attrs: { id: "p-1" } },
      sourceQuestionRevision: 3,
    });
    const reordered = createWorkspaceSeedFrame({
      documentName: ROOM,
      root: "rich",
      path: "question/q-1/prompt",
      value: { attrs: { id: "p-1" }, content: [{ type: "paragraph" }] },
      sourceQuestionRevision: 3,
    });
    const newerRevision = createWorkspaceSeedFrame({
      ...reordered,
      sourceQuestionRevision: 4,
    });
    expect(reordered.seedId).toBe(first.seedId);
    expect(newerRevision.seedId).not.toBe(first.seedId);
    expect(workspaceSeedPathRoot(first.path)).toBe("rich");
  });

  it("rejects foreign rooms, root/path mismatches, tampered ids, and oversized values", () => {
    const scalar = createWorkspaceSeedFrame({
      documentName: ROOM,
      root: "scalar",
      path: "access/link-1",
      value: { status: "live" },
    });
    expect(parseWorkspaceSeedFrame({ ...scalar, documentName: "coedit:v1:prompt-1" })).toBeNull();
    expect(parseWorkspaceSeedFrame({ ...scalar, root: "rich" })).toBeNull();
    expect(parseWorkspaceSeedFrame({ ...scalar, seedId: "seed-00000000000000000000000000000000" })).toBeNull();
    expect(parseWorkspaceSeedFrame({ ...scalar, path: "ui/selectedQuestionId" })).toBeNull();
    expect(
      parseWorkspaceSeedFrame({
        ...scalar,
        value: "x".repeat(MAX_WORKSPACE_SEED_VALUE_BYTES + 1),
      }),
    ).toBeNull();
  });

  it("names the rule a proposal broke instead of one generic sentence", () => {
    // The refusal is the only trace a proposal has when it never leaves the
    // browser, so "invalid" is not enough: the field waiting on that root
    // reports this string.
    expect(
      workspaceSeedRefusalReason({
        documentName: ROOM,
        root: "rich",
        path: "question/q-1/unknown",
        value: { version: 2 },
      }),
    ).toContain("question/q-1/unknown");
    expect(
      workspaceSeedRefusalReason({
        documentName: ROOM,
        root: "scalar",
        path: "question/q-1/scalar",
        value: { deep: "x".repeat(MAX_WORKSPACE_SEED_VALUE_BYTES + 1) },
      }),
    ).toContain("limit");
    expect(
      workspaceSeedRefusalReason({
        documentName: "coedit:v1:prompt-1",
        root: "scalar",
        path: "question/q-1/scalar",
        value: { isPretest: false },
      }),
    ).toContain("workspace room");
    // And a valid proposal has nothing to refuse.
    expect(
      workspaceSeedRefusalReason({
        documentName: ROOM,
        root: "rich",
        path: "question/q-1/prompt",
        value: { version: 2, nodes: [], document: { type: "doc" } },
      }),
    ).toBeNull();
  });

  it("throws the named rule, so the builder's caller can report it", () => {
    expect(() =>
      createWorkspaceSeedFrame({
        documentName: ROOM,
        root: "rich",
        path: "question/q-1/unknown",
        value: { version: 2 },
      }),
    ).toThrow(/question\/q-1\/unknown/);
  });
});

/**
 * The identity of a seed the validator REFUSED.
 *
 * Without this, a proposal whose VALUE was bad vanished on both sides: the
 * browser believed it was in flight and the service read it as "not a command".
 * The identity is what makes the refusal answerable.
 */
describe("refused workspace seed identity", () => {
  const identity = () => ({
    type: "coedit.seed",
    documentName: ROOM,
    seedId: `seed-${"a".repeat(32)}`,
    root: "rich",
    path: "question/q-1/prompt",
  });

  it("reads back the identity of a frame whose value cannot be applied", () => {
    expect(
      parseRefusedWorkspaceSeedIdentity({ ...identity(), value: "not an object" }, { documentName: ROOM }),
    ).toEqual({
      seedId: `seed-${"a".repeat(32)}`,
      root: "rich",
      path: "question/q-1/prompt",
    });
  });

  it("ignores anything that is not a workspace seed for this room", () => {
    expect(parseRefusedWorkspaceSeedIdentity({ ...identity(), type: "coedit.command" })).toBeNull();
    expect(parseRefusedWorkspaceSeedIdentity("not json")).toBeNull();
    expect(
      parseRefusedWorkspaceSeedIdentity({ ...identity(), documentName: "coedit:v1:prompt-1" }),
    ).toBeNull();
    expect(parseRefusedWorkspaceSeedIdentity(identity(), { documentName: "coedit:v2:other" })).toBeNull();
    expect(parseRefusedWorkspaceSeedIdentity({ ...identity(), seedId: "seed-nope" })).toBeNull();
    expect(parseRefusedWorkspaceSeedIdentity({ ...identity(), path: "ui/selectedQuestionId" })).toBeNull();
    expect(parseRefusedWorkspaceSeedIdentity({ ...identity(), root: "scalar" })).toBeNull();
  });
});
