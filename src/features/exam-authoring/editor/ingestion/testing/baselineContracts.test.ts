/**
 * Phase 00 baseline contract pins — later phases must not break these.
 *
 * Freezes: composer capability constants, richContent conversion/identity
 * invariants, assetSource mapping, composer-context resolution, SAT validator
 * codes (incl. every SPR error code), and autosave status/lifecycle strings.
 * All assertions describe CURRENT behavior on the untouched codebase.
 */
import { describe, expect, it } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";
import {
  SAT_CHOICE_COMPOSER_CAPABILITIES,
  SAT_RICH_COMPOSER_CAPABILITIES,
} from "../../RichQuestionComposer";
import {
  assetSource,
  documentFromStructuredContent,
  hasStructuredContent,
  plainContentFromText,
  plainTextFromContent,
  structuredContentFromDocument,
  supportsFastPlainEditing,
} from "../../richContent";
import { withRichContentIdentities } from "../../richContentIdentity";
import { validateSatQuestion } from "../../../providers/sat/satProvider";
import {
  SAT_SPR_MAX_NEGATIVE_CHARACTERS,
  SAT_SPR_MAX_POSITIVE_CHARACTERS,
  validateSatStudentResponse,
} from "../../../providers/sat/studentResponse";

function revision(overrides: Partial<QuestionRevision> = {}): QuestionRevision {
  return {
    id: "revision",
    questionId: "question",
    semanticRevision: 1,
    revision: 0,
    state: "draft",
    questionType: "single_choice",
    stimulus: plainContentFromText(""),
    prompt: plainContentFromText("Which choice is correct?"),
    answer: {
      kind: "single_choice",
      options: ["A", "B", "C", "D"].map((id) => ({ id, content: plainContentFromText("Choice " + id) })),
      correctOptionId: "A",
    },
    rationale: plainContentFromText(""),
    metadata: {
      sectionKey: "reading-writing",
      domain: "expression-of-ideas",
      skill: "Transitions",
      difficulty: "medium",
      tags: [],
    },
    accessibility: { longDescription: null },
    ...overrides,
  };
}

describe("baseline capability constants (frozen)", () => {
  it("freezes the rich composer capabilities (all true)", () => {
    expect({ ...SAT_RICH_COMPOSER_CAPABILITIES }).toEqual({
      blockStyles: true,
      lists: true,
      underline: true,
      equation: true,
      image: true,
      table: true,
      code: true,
      history: true,
    });
  });

  it("freezes the choice composer capabilities (blockStyles/lists false, rest true)", () => {
    expect({ ...SAT_CHOICE_COMPOSER_CAPABILITIES }).toEqual({
      blockStyles: false,
      lists: false,
      underline: true,
      equation: true,
      image: true,
      table: true,
      code: true,
      history: true,
    });
  });

  it("keeps the capability objects frozen", () => {
    expect(Object.isFrozen(SAT_RICH_COMPOSER_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(SAT_CHOICE_COMPOSER_CAPABILITIES)).toBe(true);
  });
});

describe("baseline richContent contracts", () => {
  it("always produces version 2 with empty legacy nodes", () => {
    const content = structuredContentFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
    expect(content.version).toBe(2);
    expect(content.nodes).toEqual([]);
    expect(content.document?.type).toBe("doc");
  });

  it("round-trips v1 -> v2 -> JSON -> v2 with stable block ids", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "paragraph", id: "passage-intro", text: "The tree grows." },
        { type: "heading", id: "passage-title", text: "Trees", level: 2 },
      ],
    };
    const reloaded = JSON.parse(JSON.stringify(structuredContentFromDocument(documentFromStructuredContent(legacy)))) as StructuredContent;
    expect(documentFromStructuredContent(reloaded).content?.map((node) => node.attrs?.["id"])).toEqual([
      "passage-intro",
      "passage-title",
    ]);
  });

  it("clamps legacy heading levels into 2-3", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "heading", id: "h1", text: "Too high", level: 1 },
        { type: "heading", id: "h9", text: "Too low", level: 9 },
      ],
    };
    const levels = documentFromStructuredContent(legacy).content?.map((node) => node.attrs?.["level"]);
    expect(levels).toEqual([2, 3]);
  });

  it("migrates legacy equations/tables without flattening", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "equation", id: "e1", latex: "x^2=16", display: true },
        { type: "equation", id: "e2", latex: "y=mx", display: false },
        { type: "table", id: "t1", rows: [["x", "y"], ["1", "2"]] },
      ],
    };
    const content = documentFromStructuredContent(legacy).content ?? [];
    expect(content.map((node) => node.type)).toEqual(["blockMath", "inlineMath", "table"]);
    expect(content[0]?.attrs?.["latex"]).toBe("x^2=16");
  });

  it("assigns stable identities once and retains them through edits + reloads", () => {
    const original = structuredContentFromDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A tree grows." }] }],
    });
    const id = original.document?.content?.[0]?.attrs?.["id"];
    expect(typeof id).toBe("string");
    expect(id).toBeTruthy();
    const reloaded = JSON.parse(JSON.stringify(original)) as StructuredContent;
    const edited = structuredContentFromDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Introduction" }] },
        ...(documentFromStructuredContent(reloaded).content?.slice(0, 1) ?? []),
      ],
    });
    // The preserved block keeps its id; the new block gets a different one.
    expect(edited.document?.content?.[1]?.attrs?.["id"]).toBe(id);
    expect(edited.document?.content?.[0]?.attrs?.["id"]).not.toBe(id);
  });

  it("never reuses an id within one document (duplicate ids are re-minted)", () => {
    const doc = withRichContentIdentities({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "dup" }, content: [{ type: "text", text: "one" }] },
        { type: "paragraph", attrs: { id: "dup" }, content: [{ type: "text", text: "two" }] },
      ],
    });
    const ids = (doc.content ?? []).map((node) => node.attrs?.["id"]);
    expect(ids[0]).toBe("dup");
    expect(typeof ids[1]).toBe("string");
    expect(ids[1]).not.toBe("dup");
  });

  it("treats math latex and image alt as plain text; tables join cells", () => {
    const content: StructuredContent = {
      version: 2,
      nodes: [],
      document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "stem " }, { type: "inlineMath", attrs: { latex: "x+1" } }] },
          { type: "image", attrs: { alt: "Graph of y=x" } },
        ],
      },
    };
    expect(plainTextFromContent(content)).toContain("x+1");
    expect(plainTextFromContent(content)).toContain("Graph of y=x");
    expect(hasStructuredContent(content)).toBe(true);
    expect(hasStructuredContent(plainContentFromText(""))).toBe(false);
  });

  it("pins fast-plain-editing eligibility (single unmarked paragraph only)", () => {
    expect(supportsFastPlainEditing(plainContentFromText("A concise SAT prompt"))).toBe(true);
    const marked = structuredContentFromDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] }],
    });
    const multiple = structuredContentFromDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    });
    expect(supportsFastPlainEditing(marked)).toBe(false);
    expect(supportsFastPlainEditing(multiple)).toBe(false);
  });
});

describe("baseline assetSource mapping", () => {
  it("passes durable sources through and prefixes UUID asset ids", () => {
    expect(assetSource("https://cdn.example.test/a.png")).toBe("https://cdn.example.test/a.png");
    expect(assetSource("/files/a.png")).toBe("/files/a.png");
    expect(assetSource("data:image/png;base64,AAAA")).toBe("");
    expect(assetSource("asset-1")).toBe("");
    expect(assetSource("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/api/v1/media/550e8400-e29b-41d4-a716-446655440000"
    );
  });
});

describe("baseline SAT validator pins", () => {
  it("accepts a complete single-choice question with zero issues", () => {
    expect(validateSatQuestion("reading-writing", revision())).toEqual([]);
  });

  it("requires prompt content", () => {
    const codes = validateSatQuestion("reading-writing", revision({ prompt: plainContentFromText("") })).map((issue) => issue.code);
    expect(codes).toContain("question.prompt.required");
  });

  it("blocks images missing source or alt", () => {
    const noAlt: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { src: "https://example.test/a.png", alt: "" } }] },
    };
    const noSource: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { alt: "A graph" } }] },
    };
    expect(validateSatQuestion("reading-writing", revision({ stimulus: noAlt })).map((issue) => issue.code)).toContain(
      "sat.accessibility.alt.required",
    );
    expect(validateSatQuestion("reading-writing", revision({ stimulus: noSource })).map((issue) => issue.code)).toContain(
      "sat.media.source.required",
    );
  });

  it("requires four choices plus a valid key", () => {
    const codes = validateSatQuestion(
      "reading-writing",
      revision({
        answer: {
          kind: "single_choice",
          options: ["A", "B", "C"].map((id) => ({ id, content: plainContentFromText("Choice " + id) })),
          correctOptionId: "missing",
        },
      }),
    ).map((issue) => issue.code);
    expect(codes).toContain("sat.choice.count");
    expect(codes).toContain("sat.correct_answer.invalid");
  });

  it("enforces SPR math-only and RW single-choice gates", () => {
    const sprInRw = revision({
      questionType: "student_produced_response",
      answer: { kind: "student_produced_response", acceptedResponses: ["12"], normalizeFraction: true, normalizeDecimal: true, numericTolerance: null },
    });
    const codes = validateSatQuestion("reading-writing", sprInRw).map((issue) => issue.code);
    expect(codes).toContain("sat.spr.math_only");
    expect(codes).toContain("sat.rw.question_type");
  });

  it("requires a primary SPR response", () => {
    const codes = validateSatQuestion(
      "math",
      revision({
        questionType: "student_produced_response",
        metadata: { sectionKey: "math", domain: "algebra", skill: "Linear Functions", difficulty: "medium", tags: [] },
        answer: { kind: "student_produced_response", acceptedResponses: ["", "12"], normalizeFraction: true, normalizeDecimal: true, numericTolerance: null },
      }),
    ).map((issue) => issue.code);
    expect(codes).toContain("sat.spr.primary.required");
  });
});

describe("baseline SPR rules (every error code)", () => {
  it("pins the character budgets", () => {
    expect(SAT_SPR_MAX_POSITIVE_CHARACTERS).toBe(5);
    expect(SAT_SPR_MAX_NEGATIVE_CHARACTERS).toBe(6);
  });

  it("accepts integers, decimals, and fractions", () => {
    for (const value of ["12", ".5", "3/4", "-12", "0.25"]) {
      expect(validateSatStudentResponse(value)).toMatchObject({ valid: true, value });
    }
  });

  it("covers empty / characters / length / format / denominator_zero", () => {
    expect(validateSatStudentResponse("")).toMatchObject({ valid: false, code: "empty" });
    expect(validateSatStudentResponse("12%")).toMatchObject({ valid: false, code: "characters" });
    expect(validateSatStudentResponse("123456")).toMatchObject({ valid: false, code: "length" });
    expect(validateSatStudentResponse("1/2.5")).toMatchObject({ valid: false, code: "format" });
    expect(validateSatStudentResponse("1/0")).toMatchObject({ valid: false, code: "denominator_zero" });
    expect(validateSatStudentResponse("1--2")).toMatchObject({ valid: false, code: "format" });
  });
});

describe("baseline composer context resolution", () => {
  it("resolves node-kind-authoritative contexts (equation/image > table > text)", async () => {
    const { resolveComposerContext } = await import("../../composerContext");
    const { Editor } = await import("@tiptap/core");
    const StarterKit = (await import("@tiptap/starter-kit")).default;
    const { TableKit } = await import("@tiptap/extension-table");
    const { EditableBlockMath, EditableInlineMath } = await import("../../EditableMathExtension");
    const { SatImage } = await import("../../SatImageExtension");
    const editor = new Editor({
      extensions: [StarterKit, TableKit, EditableInlineMath, EditableBlockMath, SatImage],
      content: { type: "doc", content: [{ type: "blockMath", attrs: { latex: "x^2" } }] },
    });
    try {
      editor.commands.setNodeSelection(0);
      const context = resolveComposerContext(editor.state);
      expect(context).toMatchObject({ kind: "equation", display: true, latex: "x^2" });
    } finally {
      editor.destroy();
    }
  });
});
