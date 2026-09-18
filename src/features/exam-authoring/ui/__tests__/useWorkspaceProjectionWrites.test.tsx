/**
 * The authority handoff between the HTTP question and the exam room.
 *
 * The room being CONNECTED is not the same as the room HOLDING the selected
 * question. The seed is a proposal the service arbitrates, so there is a real
 * window in which the room has synced and the question's roots do not exist
 * yet. During that window the HTTP question is authoritative, nothing may
 * project an empty room over it, and nothing may write into the room.
 *
 * These tests drive the real hook with a fake collaboration value, so the rules
 * are asserted where they live rather than through a mounted workspace.
 */
import { renderHook } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../contracts/assessment";
import { plainContentFromText } from "../../editor/richContent";
import type { SatAuthoringCollaborationValue } from "../../realtime/coedit";
import {
  emptyWorkspaceContent,
  questionWorkspaceScalar,
  type QuestionWorkspaceScalar,
} from "../authoringWorkspaceModel";
import {
  useWorkspaceProjectionWrites,
  type WorkspaceProjectionWrites,
} from "../useWorkspaceProjectionWrites";

const QUESTION_PATH = "question/eq-1";
const PROMPT_PATH = `${QUESTION_PATH}/prompt`;
const STIMULUS_PATH = `${QUESTION_PATH}/stimulus`;
const RATIONALE_PATH = `${QUESTION_PATH}/rationale`;
const SCALAR_PATH = `${QUESTION_PATH}/scalar`;

/** The HTTP question under the open placement. */
function question(overrides: Partial<QuestionRevision> = {}): QuestionRevision {
  return {
    id: "revision-1",
    questionId: "question-1",
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: plainContentFromText("PUBLISHED STIMULUS 98123"),
    prompt: plainContentFromText("PUBLISHED PROMPT 98123"),
    rationale: plainContentFromText("PUBLISHED RATIONALE 98123"),
    answer: {
      kind: "single_choice",
      options: [
        { id: "A", content: plainContentFromText("PUBLISHED CHOICE A") },
        { id: "B", content: plainContentFromText("PUBLISHED CHOICE B") },
      ],
      correctOptionId: "B",
    },
    metadata: {
      sectionKey: "reading-writing",
      domain: null,
      skill: null,
      difficulty: "medium",
      tags: [],
    },
    accessibility: { longDescription: null },
    ...overrides,
  };
}

interface FakeRoom {
  collaboration: SatAuthoringCollaborationValue;
  setValueCalls: Array<{ path: string; value: unknown }>;
  setRichFieldCalls: Array<{ path: string; content: StructuredContent }>;
  seedRichFieldCalls: string[];
}

/**
 * A room that has synced (and replayed its local cache) but whose content is
 * stated by the caller: `values` IS the published workspace projection, so an
 * absent key is a root the room does not hold.
 */
function makeRoom(values: Record<string, unknown>): FakeRoom {
  const room = {
    setValueCalls: [] as FakeRoom["setValueCalls"],
    setRichFieldCalls: [] as FakeRoom["setRichFieldCalls"],
    seedRichFieldCalls: [] as string[],
  };
  const collaboration = {
    status: "ready",
    workspaceSnapshot: {
      ready: true,
      localReady: true,
      readOnly: false,
      lifecyclePhase: "active",
      values,
    },
    setValue: (path: string, value: unknown) => {
      room.setValueCalls.push({ path, value });
    },
    setRichField: (path: string, content: StructuredContent) => {
      room.setRichFieldCalls.push({ path, content });
    },
    seedValue: () => true,
    seedRichField: (path: string) => {
      room.seedRichFieldCalls.push(path);
      return true;
    },
  } as unknown as SatAuthoringCollaborationValue;
  return { collaboration, ...room };
}

/** Every required root, with distinct room-owned content. */
function hydratedValues(
  input: { prompt?: StructuredContent } = {},
): Record<string, unknown> {
  const scalar: QuestionWorkspaceScalar = questionWorkspaceScalar(question(), false);
  return {
    [SCALAR_PATH]: scalar,
    [`rich:${PROMPT_PATH}`]: input.prompt ?? plainContentFromText("ROOM PROMPT"),
    [`rich:${STIMULUS_PATH}`]: plainContentFromText("ROOM STIMULUS"),
    [`rich:${RATIONALE_PATH}`]: plainContentFromText("ROOM RATIONALE"),
    [`rich:${QUESTION_PATH}/choice/A`]: plainContentFromText("ROOM CHOICE A"),
    [`rich:${QUESTION_PATH}/choice/B`]: plainContentFromText("ROOM CHOICE B"),
  };
}

interface HarnessProps {
  values: Record<string, unknown>;
  baseQuestion: QuestionRevision | null;
  initialDraft: QuestionRevision | null;
}

let writes: WorkspaceProjectionWrites | null = null;
let openDraft: QuestionRevision | null = null;
let room: FakeRoom | null = null;

function Harness(props: HarnessProps) {
  const [draft, setDraft] = useState<QuestionRevision | null>(props.initialDraft);
  const draftRef = useRef<QuestionRevision | null>(draft);
  draftRef.current = draft;
  // A new projection is a new collaboration value, exactly as the provider
  // publishes one per snapshot.
  const nextRoom = useMemo(() => makeRoom(props.values), [props.values]);
  room = nextRoom;
  writes = useWorkspaceProjectionWrites({
    workspaceCollaboration: nextRoom.collaboration,
    workspaceQuestionPath: QUESTION_PATH,
    selectedExamQuestionId: "eq-1",
    baseQuestionExamQuestionId: "eq-1",
    baseQuestion: props.baseQuestion,
    isPretest: false,
    draft,
    draftRef,
    setDraft,
  });
  openDraft = draft;
  return null;
}

function open(props: HarnessProps) {
  const view = renderHook((next: HarnessProps) => Harness(next), { initialProps: props });
  const value = () => {
    if (!writes) throw new Error("the projection hook has not rendered");
    return writes;
  };
  const draft = () => openDraft;
  const fakeRoom = () => {
    if (!room) throw new Error("the room has not been built");
    return room;
  };
  return { view, value, draft, fakeRoom };
}

/** The visible text of a rich field, wherever it sits in the document. */
function fieldText(content: StructuredContent | undefined): string {
  if (!content) return "";
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as { text?: unknown };
    if (typeof record.text === "string") text.push(record.text);
    for (const child of Object.values(record)) visit(child);
  };
  visit(content);
  return text.join(" ");
}

describe("SAT workspace authority handoff", () => {
  it("keeps the HTTP question until the room holds every required root", () => {
    const base = question();
    const { view, value, draft } = open({
      values: {},
      baseQuestion: base,
      initialDraft: base,
    });

    // The room synced, but it holds nothing for this question yet.
    expect(value().hydration.ready).toBe(false);
    expect(value().hydration.pendingPaths).toEqual([
      SCALAR_PATH,
      `rich:${PROMPT_PATH}`,
      `rich:${STIMULUS_PATH}`,
      `rich:${RATIONALE_PATH}`,
      `rich:${QUESTION_PATH}/choice/A`,
      `rich:${QUESTION_PATH}/choice/B`,
    ]);
    expect(fieldText(draft()?.prompt)).toContain("PUBLISHED PROMPT 98123");

    // A partial room (the scalar and the prompt have landed) is still not
    // authority: a half-seeded question must not replace the other fields.
    view.rerender({
      values: {
        [SCALAR_PATH]: questionWorkspaceScalar(base, false),
        [`rich:${PROMPT_PATH}`]: plainContentFromText("ROOM PROMPT"),
      },
      baseQuestion: base,
      initialDraft: base,
    });
    expect(value().hydration.ready).toBe(false);
    expect(fieldText(draft()?.prompt)).toContain("PUBLISHED PROMPT 98123");

    // Every required root present: the room is now the source of truth.
    view.rerender({
      values: hydratedValues(),
      baseQuestion: base,
      initialDraft: base,
    });
    expect(value().hydration.ready).toBe(true);
    expect(value().hydration.pendingPaths).toEqual([]);
    expect(fieldText(draft()?.prompt)).toContain("ROOM PROMPT");
    expect(fieldText(draft()?.stimulus)).toContain("ROOM STIMULUS");
  });

  it("proposes the seed for the question while it is still un-hydrated", () => {
    const base = question();
    const { value, fakeRoom } = open({ values: {}, baseQuestion: base, initialDraft: base });

    // Seeding and the authority handoff are two different things: the room is
    // ASKED for this question's content while it is still empty, and is simply
    // not treated as if it had answered yet.
    expect(value().hydration.ready).toBe(false);
    expect(fakeRoom().seedRichFieldCalls).toEqual([
      PROMPT_PATH,
      STIMULUS_PATH,
      RATIONALE_PATH,
      `${QUESTION_PATH}/choice/A`,
      `${QUESTION_PATH}/choice/B`,
    ]);
    // Nothing was written locally: the room arbitrates the seed.
    expect(fakeRoom().setRichFieldCalls).toEqual([]);
    expect(fakeRoom().setValueCalls).toEqual([]);
  });

  it("treats an intentionally blank room field as authoritative once hydrated", () => {
    const base = question();
    const { view, value, draft } = open({
      values: {},
      baseQuestion: base,
      initialDraft: base,
    });
    expect(value().hydration.ready).toBe(false);

    // The author (or a collaborator) cleared the prompt, and the room stored
    // that as an initialized blank document. It must win over the HTTP text.
    view.rerender({
      values: hydratedValues({ prompt: emptyWorkspaceContent() }),
      baseQuestion: base,
      initialDraft: base,
    });
    expect(value().hydration.ready).toBe(true);
    expect(draft()?.prompt).toEqual(emptyWorkspaceContent());
    expect(fieldText(draft()?.prompt)).toBe("");
  });

  it("refuses writes before hydration and routes them to the room after", () => {
    const base = question();
    const { view, value, draft, fakeRoom } = open({
      values: {},
      baseQuestion: base,
      initialDraft: base,
    });

    const edited: QuestionRevision = {
      ...base,
      metadata: { ...base.metadata, difficulty: "hard" },
    };
    // The room owns the question from the moment it is mounted, so the caller
    // must not fall back to the legacy HTTP autosave (`true`) — but it may not
    // take the write before it holds the question's canonical roots.
    expect(value().publishScalar(edited)).toBe(true);
    value().handleLocalRichChange(edited);
    expect(fakeRoom().setValueCalls).toEqual([]);
    expect(fakeRoom().setRichFieldCalls).toEqual([]);

    view.rerender({ values: hydratedValues(), baseQuestion: base, initialDraft: base });
    expect(value().hydration.ready).toBe(true);
    expect(fieldText(draft()?.prompt)).toContain("ROOM PROMPT");

    // Hydrated: the same two writes now reach the room, and only the field that
    // actually changed does.
    const changed: QuestionRevision = {
      ...(draft() as QuestionRevision),
      metadata: { ...base.metadata, difficulty: "hard" },
    };
    expect(value().publishScalar(changed)).toBe(true);
    expect(fakeRoom().setValueCalls.map((call) => call.path)).toEqual([SCALAR_PATH]);

    value().handleLocalRichChange({
      ...changed,
      rationale: plainContentFromText("ROOM RATIONALE EDITED"),
    });
    expect(fakeRoom().setRichFieldCalls.map((call) => call.path)).toEqual([RATIONALE_PATH]);
  });
});
