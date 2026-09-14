import { describe, expect, it } from "vitest";
import {
  COEDIT_AWARENESS_ALLOWED_KEYS,
  collaboratorsFromAwareness,
  isAllowedAwarenessKey,
  sanitizeLocalAwarenessState,
} from "../presence";
import { colorForActor } from "../contracts";

describe("co-edit awareness", () => {
  it("projects only the server-resolved user identity", () => {
    const states = new Map<number, Record<string, unknown>>([
      [11, {
        user: { id: "actor-bob", name: "Bob Author", color: "hsl(210 65% 45%)" },
        cursor: { anchor: 1, head: 2 },
        name: "spoofed browser name",
      }],
      [12, { actorId: "spoofed-actor", name: "Spoofed" }],
    ]);

    expect(collaboratorsFromAwareness(states, 99)).toEqual([
      {
        clientId: 11,
        actorId: "actor-bob",
        name: "Bob Author",
        color: colorForActor("actor-bob"),
        isSelf: false,
      },
    ]);
  });

  it("preserves caret state and removes content or arbitrary fields", () => {
    expect(COEDIT_AWARENESS_ALLOWED_KEYS).toEqual(["cursor", "selection", "user", "target"]);
    expect(sanitizeLocalAwarenessState({
      user: { id: "local", name: "Local", color: "#2563eb" },
      cursor: { anchor: 2, head: 4 },
      selection: { from: 2, to: 4 },
      target: { surface: "builder", questionId: "question-1" },
      prompt: "must never be broadcast as awareness",
      actorId: "spoofed",
    })).toEqual({
      user: { id: "local", name: "Local", color: "#2563eb" },
      cursor: { anchor: 2, head: 4 },
      selection: { from: 2, to: 4 },
      target: { surface: "builder", questionId: "question-1" },
    });
  });

  it("allows only bounded field-scoped cursor keys for workspace editors", () => {
    expect(isAllowedAwarenessKey("cursor:rich:question/q1/prompt")).toBe(true);
    expect(isAllowedAwarenessKey("cursor:rich:question/q1/choice/c1")).toBe(true);
    expect(isAllowedAwarenessKey("cursor:rich:question/q1/choice/c1?inject=1")).toBe(false);
    expect(sanitizeLocalAwarenessState({
      "cursor:rich:question/q1/prompt": { anchor: 1 },
      "cursor:rich:question/q1/choice/c1": { anchor: 2 },
      "cursor:rich:question/q1/choice/c1?inject=1": { anchor: 3 },
    })).toEqual({
      "cursor:rich:question/q1/prompt": { anchor: 1 },
      "cursor:rich:question/q1/choice/c1": { anchor: 2 },
    });
  });
});
