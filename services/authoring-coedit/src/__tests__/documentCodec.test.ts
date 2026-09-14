import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CodecError,
  applyBinaryState,
  assertStateWithinLimit,
  currentStateHash,
  encodeStateAsUpdate,
  fromBase64,
  hashStateVector,
  projectPrompt,
  projectPromptJson,
  promptSchema,
  seedYDocFromPrompt,
  toBase64,
} from "../documentCodec.js";
import type {
  RichTextDocument,
  RichTextNode,
  StructuredContent,
} from "../../../../src/features/exam-authoring/contracts/assessment.js";

const text = (value: string, marks?: RichTextNode["marks"]): RichTextNode => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

function documentWith(content: RichTextNode[]): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content } as RichTextDocument };
}

/** Every node the browser can produce, in one document. */
const FULL_VOCABULARY = documentWith([
  { type: "heading", attrs: { level: 2 }, content: [text("Section heading")] },
  { type: "paragraph", content: [text("Plain "), text("bold", [{ type: "bold" }]), text(" and "), text("italic", [{ type: "italic" }])] },
  { type: "paragraph", content: [text("code", [{ type: "code" }]), text(" strike", [{ type: "strike" }])] },
  { type: "paragraph", content: [text("x", [{ type: "subscript" }]), text("y", [{ type: "superscript" }])] },
  { type: "bulletList", content: [
    { type: "listItem", content: [{ type: "paragraph", content: [text("first bullet")] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [text("second bullet")] }] },
  ] },
  { type: "orderedList", attrs: { start: 2 }, content: [
    { type: "listItem", content: [{ type: "paragraph", content: [text("second item")] }] },
  ] },
  { type: "codeBlock", attrs: { language: "ts" }, content: [text("const answer = 42;")] },
  { type: "paragraph", content: [text("Inline math: "), { type: "inlineMath", attrs: { latex: "x^2 + y^2" } }] },
  { type: "blockMath", attrs: { latex: "\\frac{a}{b}" } },
  { type: "paragraph", content: [text("Diagram:")] },
  { type: "image", attrs: { src: "https://cdn.example/diagram.png", alt: "A diagram", assetId: "asset-9", caption: "Figure 1" } },
  { type: "table", content: [
    { type: "tableRow", content: [
      { type: "tableHeader", content: [{ type: "paragraph", content: [text("x")] }] },
      { type: "tableHeader", content: [{ type: "paragraph", content: [text("f(x)")] }] },
    ] },
    { type: "tableRow", content: [
      { type: "tableCell", content: [{ type: "paragraph", content: [text("1")] }] },
      { type: "tableCell", content: [{ type: "paragraph", content: [text("2")] }] },
    ] },
  ] },
  { type: "horizontalRule" },
]);

interface NodeFacts {
  types: string[];
  text: string;
  marks: string[];
  latex: string[];
  tables: string[][][];
  images: Array<Record<string, unknown>>;
}

function facts(node: RichTextNode, acc: NodeFacts): NodeFacts {
  acc.types.push(node.type);
  if (node.type === "text") acc.text += node.text ?? "";
  for (const mark of node.marks ?? []) acc.marks.push(mark.type);
  if (node.type === "inlineMath" || node.type === "blockMath") {
    acc.latex.push(String(node.attrs?.["latex"] ?? ""));
  }
  if (node.type === "image") acc.images.push({ ...node.attrs });
  if (node.type === "tableRow") {
    const cells = (node.content ?? []).map((cell: RichTextNode) =>
      (cell.content ?? []).map((block: RichTextNode) =>
        (block.content ?? []).map((inline: RichTextNode) => inline.text ?? "").join(""),
      ),
    );
    acc.tables.push(cells);
  }
  if (node.type === "heading") acc.text += `#${String(node.attrs?.["level"] ?? "")}`;
  for (const child of node.content ?? []) facts(child, acc);
  return acc;
}

function collect(document: RichTextDocument): NodeFacts {
  const acc: NodeFacts = { types: [], text: "", marks: [], latex: [], tables: [], images: [] };
  for (const node of document.content ?? []) facts(node, acc);
  return acc;
}

describe("prompt schema", () => {
  it("is built once and reused", () => {
    expect(promptSchema()).toBe(promptSchema());
  });
});

describe("prompt JSON -> Y.Doc -> prompt JSON", () => {
  it("preserves the canonical projection for the whole node vocabulary", () => {
    const once: StructuredContent = projectPrompt(seedYDocFromPrompt(FULL_VOCABULARY));
    const twice = projectPrompt(seedYDocFromPrompt(once));
    // Canonical stability: seeding a projection reproduces it exactly. If the
    // service and the browser disagreed on a node or attribute, the second
    // projection would differ from the first.
    expect(twice).toEqual(once);
  });

  it("keeps every node, mark, and attribute value through the round trip", () => {
    const seeded: StructuredContent = projectPrompt(seedYDocFromPrompt(FULL_VOCABULARY));
    const document = seeded.document as RichTextDocument;
    const facts = collect(document);
    expect(facts.types).toEqual([
      "heading", "text",
      "paragraph", "text", "text", "text", "text",
      "paragraph", "text", "text",
      "paragraph", "text", "text",
      "bulletList", "listItem", "paragraph", "text", "listItem", "paragraph", "text",
      "orderedList", "listItem", "paragraph", "text",
      "codeBlock", "text",
      "paragraph", "text", "inlineMath",
      "blockMath",
      "paragraph", "text",
      "image",
      "table", "tableRow", "tableHeader", "paragraph", "text", "tableHeader", "paragraph", "text",
      "tableRow", "tableCell", "paragraph", "text", "tableCell", "paragraph", "text",
      "horizontalRule",
    ]);
    expect(facts.marks.sort()).toEqual(["bold", "code", "italic", "strike", "subscript", "superscript"]);
    expect(facts.latex).toEqual(["x^2 + y^2", "\\frac{a}{b}"]);
    expect(facts.text).toContain("const answer = 42;");
    expect(facts.tables).toEqual([[['x'], ['f(x)']], [['1'], ['2']]]);
    expect(facts.images[0]).toMatchObject({
      src: "https://cdn.example/diagram.png",
      alt: "A diagram",
      assetId: "asset-9",
      caption: "Figure 1",
    });
    // Block ids assigned at the content boundary survive the round trip, which
    // is what lets the editor address the same block after collaboration.
    const idBearing: boolean[] = [];
    const visitIds = (node: RichTextNode) => {
      if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
        idBearing.push(typeof node.attrs?.["id"] === "string");
      } else {
        idBearing.push(!("id" in (node.attrs ?? {})));
      }
      for (const child of node.content ?? []) visitIds(child);
    };
    for (const node of document.content ?? []) visitIds(node);
    expect(idBearing).not.toHaveLength(0);
    expect(idBearing.every(Boolean)).toBe(true);
  });

  it("upgrades a legacy version 1 prompt without losing text", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "paragraph", id: "p1", text: "Legacy paragraph" },
        { type: "equation", id: "e1", latex: "a+b", display: true },
        { type: "table", id: "t1", rows: [["r1c1", "r1c2"]] },
      ],
    };
    const projected: StructuredContent = projectPrompt(seedYDocFromPrompt(legacy));
    const facts = collect(projected.document as RichTextDocument);
    expect(facts.text).toContain("Legacy paragraph");
    expect(facts.latex).toEqual(["a+b"]);
    expect(facts.tables).toEqual([[['r1c1'], ['r1c2']]]);
  });

  it("treats an empty prompt as an empty document", () => {
    const empty: StructuredContent = { version: 2, nodes: [], document: { type: "doc", content: [] } };
    const projected: StructuredContent = projectPrompt(seedYDocFromPrompt(empty));
    expect(projected.document?.content ?? []).toEqual([]);
  });

  it("projects to JSON of the same shape it persists", () => {
    const doc = seedYDocFromPrompt(FULL_VOCABULARY);
    expect(JSON.parse(projectPromptJson(doc))).toEqual(projectPrompt(doc));
  });
});

describe("state hashing and binary reload", () => {
  it("hashes the state vector, not the update", () => {
    const first = seedYDocFromPrompt(FULL_VOCABULARY);
    const second = new Y.Doc();
    const state = encodeStateAsUpdate(first);
    applyBinaryState(second, state);
    expect(currentStateHash(second)).toBe(currentStateHash(first));
    expect(hashStateVector(Y.encodeStateVector(second))).toBe(currentStateHash(second));
  });

  it("survives a base64 encode/decode cycle", () => {
    const doc = seedYDocFromPrompt(FULL_VOCABULARY);
    const encoded = toBase64(encodeStateAsUpdate(doc));
    const decoded = fromBase64(encoded);
    expect(decoded).not.toBeNull();
    const reloaded = new Y.Doc();
    applyBinaryState(reloaded, decoded as Uint8Array);
    expect(projectPrompt(reloaded)).toEqual(projectPrompt(doc));
    expect(fromBase64(null)).toBeNull();
  });

  it("applies a later update on top of committed binary state", () => {
    const doc = seedYDocFromPrompt(FULL_VOCABULARY);
    const committed = encodeStateAsUpdate(doc);
    const reloaded = new Y.Doc();
    applyBinaryState(reloaded, committed);
    const fragment = reloaded.getXmlFragment("prompt");
    reloaded.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "appended after reload");
      paragraph.insert(0, [textNode]);
      fragment.insert(fragment.length, [paragraph]);
    });
    expect(encodeStateAsUpdate(reloaded).byteLength).toBeGreaterThan(committed.byteLength);
    expect(collect((projectPrompt(reloaded).document as RichTextDocument))).toBeTruthy();
  });
});

describe("size limits", () => {
  it("rejects binary state above the persistence cap", () => {
    expect(() => assertStateWithinLimit(new Uint8Array(4 << 20))).not.toThrow();
    expect(() => assertStateWithinLimit(new Uint8Array((4 << 20) + 1))).toThrow(CodecError);
  });

  it("rejects a materialized prompt above the JSON cap", () => {
    const doc = seedYDocFromPrompt({
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(1_100_000) }] }] },
    });
    expect(() => projectPromptJson(doc)).toThrow(/size limit/);
  });

  it("rebuilds the same projection from persisted JSON on every boot", () => {
    const seeded = seedYDocFromPrompt(FULL_VOCABULARY);
    const fromBinary = new Y.Doc();
    applyBinaryState(fromBinary, encodeStateAsUpdate(seeded));
    const reloadedProjection: StructuredContent = projectPrompt(fromBinary);
    // The service is stateless between restarts: binary state reloaded from
    // MySQL must project to exactly the JSON the editor was shown.
    expect(reloadedProjection).toEqual(projectPrompt(seeded));
  });
});
