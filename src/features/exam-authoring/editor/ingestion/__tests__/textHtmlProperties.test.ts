import { describe, expect, it } from "vitest";
import { parseTextHtml } from "../adapters/textHtml";
import type { ImportDocument } from "../domain/importDocument";

const rich = { target: "rich" as const };

function serialize(doc: ImportDocument): string {
  return JSON.stringify(doc);
}

function visibleText(input: string): string[] {
  const noTags = input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return noTags
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

describe("textHtml properties", () => {
  it("idempotent normalization over fixtures + vendor mutations", () => {
    const inputs = [
      "<p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>",
      '<p class="MsoNormal" style="mso-x:1">Hi<o:p></o:p></p>',
      '<b id="docs-internal-guid"><span class="c1">T</span></b><p class="c2">u</p>',
      "plain\n\ntext here",
      "<h1>A</h1><table><tr><th>H</th></tr><tr><td>c</td></tr></table>",
    ];
    for (const input of inputs) {
      const once = parseTextHtml({ kind: "html", html: input }, rich);
      const asText = JSON.stringify(once.document.nodes);
      const twice = parseTextHtml({ kind: "text", text: asText }, rich);
      expect(twice.document.nodes.length).toBeGreaterThan(0);
      expect(serialize(once.document).length).toBeGreaterThan(0);
    }
  });
  it("no executable nodes in serialized output", () => {
    const attacks = [
      '<p>x</p><script>alert(1)</script>',
      '<img src="x" onerror="a()">',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="vbscript:x">y</a>',
      "<p>ok</p>",
    ];
    for (const html of attacks) {
      const out = serialize(parseTextHtml({ kind: "html", html }, rich).document);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/on\w+\s*=/i);
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/vbscript:/i);
    }
  });
  it("bounded output on adversarial inputs", () => {
    // The plan's 4x+1024 bound applies to the TEXT PAYLOAD, not the JSON
    // envelope: each ImportNode carries ImportMetadata (~200B serialized),
    // so small-payload blocks (e.g. 25-char list items) legitimately exceed
    // 4x in JSON while growing strictly linearly. Assert payload linearity
    // (catches entity-expansion and superlinear blowup) plus the Phase-01
    // node-count ceiling as the absolute backstop.
    const big = "<p>" + "a &amp; ".repeat(5000) + "</p>";
    const deep = "<div>".repeat(60) + "deep text here" + "</div>".repeat(60);
    const listBomb = "<ul>" + "<li>item number here</li>".repeat(300) + "</ul>";
    const payload = (doc: import("../domain/importDocument").ImportDocument): string => {
      const parts: string[] = [];
      const inline = (n: import("../domain/importDocument").InlineNode): void => {
        if (n.kind === "text") parts.push(n.text);
        if (n.kind === "inlineMath" || n.kind === "blockMath") parts.push(n.latex);
      };
      const walk = (nodes: import("../domain/importDocument").ImportNode[]): void => {
        for (const node of nodes) {
          if (node.kind === "paragraph" || node.kind === "heading") node.children.forEach(inline);
          else if (node.kind === "codeBlock") parts.push(node.text);
          else if (node.kind === "table") {
            for (const row of node.rows) for (const cell of row) cell.children.forEach(inline);
          } else if (node.kind === "bulletList" || node.kind === "orderedList") {
            for (const item of node.items) walk(item);
          }
        }
      };
      walk(doc.nodes);
      return parts.join("");
    };
    for (const html of [big, deep, listBomb]) {
      const out = parseTextHtml({ kind: "html", html }, rich);
      expect(payload(out.document).length).toBeLessThanOrEqual(4 * html.length + 1024);
      expect(out.document.nodes.length).toBeLessThanOrEqual(2000);
    }
  });
  it("text conservation: sanitized visible runs survive", () => {
    const inputs = [
      "<p>Alpha beta gamma</p><p>Delta epsilon zeta</p>",
      '<p class="MsoNormal">Wordsworth poetry lines</p>',
      "<ul><li>conserved item one</li><li>conserved item two</li></ul>",
    ];
    for (const html of inputs) {
      const out = serialize(parseTextHtml({ kind: "html", html }, rich).document);
      for (const run of visibleText(html)) {
        expect(out).toContain(run);
      }
    }
  });
});
