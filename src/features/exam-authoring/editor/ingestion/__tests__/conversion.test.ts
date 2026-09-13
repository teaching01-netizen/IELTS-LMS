import { describe, expect, it } from "vitest";
import { SAT_CHOICE_COMPOSER_CAPABILITIES, SAT_RICH_COMPOSER_CAPABILITIES } from "../../RichQuestionComposer";
import { parseTextHtml } from "../adapters/textHtml";
import { upgradeMathInDocument } from "../mathIngest";
import { importAstToRichDocument } from "../conversion/importAstToRichDocument";

const rich = SAT_RICH_COMPOSER_CAPABILITIES;
const choice = SAT_CHOICE_COMPOSER_CAPABILITIES;

describe("importAstToRichDocument", () => {
  it("converts paragraphs, headings, lists, tables, code, divider", () => {
    const parsed = parseTextHtml(
      {
        kind: "html",
        html: "<h2>H</h2><p><strong>b</strong></p><ul><li>a</li></ul><table><tr><th>H</th></tr><tr><td>c</td></tr></table><pre>code</pre><hr>",
      },
      { target: "rich" },
    );
    const out = importAstToRichDocument(parsed.document, rich);
    const types = (out.doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "table", "codeBlock", "horizontalRule"]);
    const table = (out.doc.content ?? [])[3];
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
  });
  it("flattens lists+headings in choice editors (B10 closure)", () => {
    const parsed = parseTextHtml(
      { kind: "html", html: "<h2>H</h2><ul><li>a</li><li>b</li></ul><p>tail</p>" },
      { target: "choice" },
    );
    const out = importAstToRichDocument(parsed.document, choice);
    const json = JSON.stringify(out.doc);
    expect(json).not.toContain('"heading"');
    expect(json).not.toContain('"bulletList"');
    expect(json).toContain("a");
    expect(json).toContain("tail");
  });
  it("maps math to native nodes; equation-off renders latex text", () => {
    const parsed = parseTextHtml({ kind: "html", html: "<p>See \\(x^2\\) here</p>" }, { target: "rich" });
    const upgraded = upgradeMathInDocument(parsed.document);
    const out = importAstToRichDocument(upgraded.document, rich);
    expect(JSON.stringify(out.doc)).toContain('"inlineMath"');
    expect(out.mathCount).toBe(1);
    const off = importAstToRichDocument(upgraded.document, { ...rich, equation: false });
    expect(JSON.stringify(off.doc)).not.toContain('"inlineMath"');
  });
  it("image-off keeps alt text; table-off explodes rows", () => {
    const parsed = parseTextHtml(
      { kind: "html", html: "<table><tr><td>a</td><td>b</td></tr></table>" },
      { target: "rich" },
    );
    const noTable = importAstToRichDocument(parsed.document, { ...rich, table: false });
    expect(JSON.stringify(noTable.doc)).toContain("\u00b7");
  });
});
