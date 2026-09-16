import { describe, expect, it } from "vitest";
import { resolveFieldWriter, type FieldWriterInput } from "../fieldWriter";

/**
 * The complete input space: both room facts, each true or false. Two writers
 * can only be resolved together, because the failing case here is one of them
 * being decided at a different call site than the other.
 */
const MATRIX: Array<{ input: FieldWriterInput; expected: string; why: string }> = [
  {
    input: { workspaceRoomActive: true, promptRoomActive: true },
    expected: "workspace",
    why: "the exam room contains the prompt, so its scalar record is the only writer",
  },
  {
    input: { workspaceRoomActive: true, promptRoomActive: false },
    expected: "workspace",
    why: "the exam room owns every field while it is mounted",
  },
  {
    input: { workspaceRoomActive: false, promptRoomActive: true },
    expected: "prompt-room",
    why: "only the prompt is collaborative; every other field still needs the partial endpoint",
  },
  {
    input: { workspaceRoomActive: false, promptRoomActive: false },
    expected: "legacy",
    why: "with no room the full-revision endpoint is the only writer",
  },
];

describe("resolveFieldWriter", () => {
  it("resolves the full two-room matrix", () => {
    for (const entry of MATRIX) {
      expect(
        resolveFieldWriter(entry.input),
        JSON.stringify(entry.input),
      ).toBe(entry.expected);
    }
  });

  it("names a writer for every state a call site can observe", () => {
    // A `null`/`undefined` writer would mean "no policy", which each call site
    // would then have to invent separately — exactly the failure this module
    // removes. Every combination must resolve to a real writer.
    const writers = new Set<string>();
    for (const workspaceRoomActive of [true, false]) {
      for (const promptRoomActive of [true, false]) {
        writers.add(resolveFieldWriter({ workspaceRoomActive, promptRoomActive }));
      }
    }
    expect([...writers].sort()).toEqual(["legacy", "prompt-room", "workspace"]);
  });

  it("never lets a question-scoped room own fields beside the exam room", () => {
    // The precedence rule, stated as the invariant a maintainer would check:
    // the workspace room wins any tie.
    expect(
      resolveFieldWriter({ workspaceRoomActive: true, promptRoomActive: true }),
    ).toBe("workspace");
  });
});
