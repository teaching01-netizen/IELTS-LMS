import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_SEED_VALUE_BYTES,
  createWorkspaceSeedFrame,
  parseWorkspaceSeedFrame,
  workspaceSeedId,
  workspaceSeedPathRoot,
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
});
