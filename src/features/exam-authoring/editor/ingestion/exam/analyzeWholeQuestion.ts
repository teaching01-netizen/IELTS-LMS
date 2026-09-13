/**
 * Phase 08 — whole-question analysis v2 (plan-shaped, replaces the orphan).
 *
 * Pure, no React/TipTap. Input is the plan's AnalyzeWholeQuestionInput
 * ({ pasted, targetField, sectionKey, pastedPlainText }). Confidence starts
 * at 0.30; calibrated detector weights (proven in probeCalibration 10/10):
 * A-D run +0.45, A-C +0.25, key +0.12, explanation +0.08, qnum +0.03,
 * stimulus +0.08, SPR +0.15. Caps: conflicting keys 0.70, RW+SPR 0.70,
 * unordered/noncontiguous without key preserve. Branches slice REAL
 * ImportNodes (choice labels stripped from content, markers consumed).
 * NEVER auto-relocates: returns a verdict; relocation needs an author click
 * via buildSplitQuestion. Replaces the v1 orphan (isWholeQuestion /
 * promptBlocks / ChoiceSlice removed — superseded by plan contracts).
 */
import type { ImportDocument, ImportNode, InlineNode } from "../domain/importDocument";
import { classifyLine } from "./choiceBoundaries";
import type {
  AnalyzeWholeQuestionInput,
  WholeQuestionAnalysis,
  WholeQuestionChoice,
  WholeQuestionConfidenceBand,
} from "./wholeQuestionTypes";

export function bandForConfidence(confidence: number): WholeQuestionConfidenceBand {
  if (confidence >= 0.98) return "auto-cleanup-only";
  if (confidence >= 0.75) return "suggest";
  return "preserve";
}

export type { WholeQuestionAnalysis, AnalyzeWholeQuestionInput, WholeQuestionChoice, WholeQuestionConfidenceBand };

const CHOICE_LABEL_RE = /^(?:\(\s*([A-Da-d])\s*\)|\[\s*([A-Da-d])\s*\]|([A-Da-d])\s*[.)\-:])(?:\s+|$)/;
const KEY_LETTER_RE = /^(?:answer(?:\s+key)?|correct\s+answer|key)\s*:\s*\(?([A-Da-d])\)?\s*$/i;
const NUMERIC_KEY_RE = /^answer\s*:\s*(-?[\d.,/\s]+?)\s*$/i;
const EXPLAIN_RE = /^(?:explanation|solution|rationale|why)\s*:/i;
const QNUM_RE = /^(?:question\s+|Q\s*)?(\d{1,3})\s*[.):]/i;
const STEM_VERB_RE = /^(?:which|what|how|solve|find|select|choose|based on|identify|determine|calculate)\b/i;

function inlineText(inline: InlineNode): string {
  return inline.kind === "text" ? inline.text : inline.latex;
}

function blockText(block: ImportNode): string {
  const parts: string[] = [];
  const walk = (nodes: ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "paragraph" || node.kind === "heading") node.children.forEach((c) => parts.push(inlineText(c)));
      else if (node.kind === "bulletList" || node.kind === "orderedList") node.items.forEach(walk);
      else if (node.kind === "table") node.rows.forEach((r) => r.forEach((cell) => cell.children.forEach((c) => parts.push(inlineText(c)))));
      else if (node.kind === "codeBlock") parts.push(node.text);
    }
  };
  walk([block]);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function firstLine(block: ImportNode): string {
  return (blockText(block).split("\n")[0] ?? "").trim();
}

/**
 * A pasted block may hold several newline-joined lines (plain-text adapter
 * collapses single newlines into one paragraph). Expand to logical lines so
 * choice/key/explanation detectors see block starts. Content slicing still
 * uses block indices; multi-line blocks are attributed whole.
 */
function logicalLines(blocks: ImportNode[]): Array<{ blockIndex: number; line: string }> {
  const out: Array<{ blockIndex: number; line: string }> = [];
  blocks.forEach((block, blockIndex) => {
    if (block.kind === "bulletList" || block.kind === "orderedList") {
      block.items.forEach((item) =>
        item.forEach((sub) => {
          const text = blockText(sub);
          text.split("\n").forEach((line) => {
            const trimmed = line.trim();
            if (trimmed) out.push({ blockIndex, line: trimmed });
          });
        }),
      );
      return;
    }
    const text = blockText(block);
    const rawLines = text.includes("\n") ? text.split("\n") : splitInlineChoices(text);
    rawLines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed) out.push({ blockIndex, line: trimmed });
    });
  });
  return out;
}

/**
 * Single-newline plain-text pastes collapse A-D runs into one paragraph.
 * Re-split on choice-label starts so the run detector still fires. Only
 * splits when 2+ labels are found (prose with one "A." stays whole).
 */
function splitInlineChoices(text: string): string[] {
  const marker = "(?:\\(\\s*[A-Da-d]\\s*\\)|\\[\\s*[A-Da-d]\\s*\\]|[A-Da-d]\\s*[.)\\-:])(?:\\s+|$)";
  const key = "(?:answer(?:\\s+key)?|correct\\s+answer|key)\\s*:";
  const explain = "(?:explanation|solution|rationale|why)\\s*:";
  const tailKey = "\\s+(?=(?:answer(?:\\s+key)?|correct\\s+answer|key)\\s*:)";
  const pattern = new RegExp("\\s+(?=" + marker + "\\s*\\S|" + key + "|" + explain + ")" + "|" + tailKey, "gi");
  let parts: string[];
  try {
    parts = text.split(pattern);
  } catch {
    return [text];
  }
  if (parts.length < 2) return [text];
  let hits = 0;
  let hasKeyOrExplain = false;
  for (const part of parts) {
    const t = part.trim();
    if (/^(?:\(\s*[A-Da-d]\s*\)|\[\s*[A-Da-d]\s*\]|[A-Da-d]\s*[.)\-:])/.test(t)) hits += 1;
    else if (/^(?:answer(?:\s+key)?|correct\s+answer|key)\s*:/i.test(t)) { hits += 1; hasKeyOrExplain = true; }
    else if (/^(?:explanation|solution|rationale|why)\s*:/i.test(t)) { hits += 1; hasKeyOrExplain = true; }
  }
  if (hits >= 2) return parts;
  if (hits === 1 && hasKeyOrExplain && parts.length === 2) return parts;
  return [text];
}

type BlockKind = "choice" | "key-letter" | "key-numeric" | "explanation" | "question" | "list" | "text";

interface Classified {
  index: number;
  kind: BlockKind;
  label: string | null;
}

function classifyBlock(block: ImportNode): Omit<Classified, "index"> {
  const line = firstLine(block).replace(/\s+(Answer\s*:.*|Explanation\s*:.*|Solution\s*:.*)$/i, "").trim() || firstLine(block);
  const keyLetter = line.match(KEY_LETTER_RE);
  if (keyLetter) return { kind: "key-letter", label: (keyLetter[1] ?? "").toUpperCase() };
  if (NUMERIC_KEY_RE.test(line)) return { kind: "key-numeric", label: null };
  if (EXPLAIN_RE.test(line)) return { kind: "explanation", label: null };
  const cls = classifyLine(line);
  if (cls === "choice") {
    const m = line.match(CHOICE_LABEL_RE);
    const label = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").toUpperCase();
    return { kind: "choice", label };
  }
  if (cls === "question") return { kind: "question", label: null };
  if (cls === "list") return { kind: "list", label: null };
  return { kind: "text", label: null };
}

function branchOf(doc: ImportDocument, indices: number[]): ImportDocument | null {
  if (indices.length === 0) return null;
  return { version: 1, nodes: indices.map((i) => doc.nodes[i]).filter((n): n is ImportNode => n !== undefined), sourceMeta: { ...doc.sourceMeta } };
}

function stripChoiceLine(line: string, meta: ImportDocument["sourceMeta"]): ImportNode {
  const stripped = line.replace(/^\s*(?:\(\s*[A-Da-d]\s*\)|\[\s*[A-Da-d]\s*\]|\d{1,3}\s*[.):]|[A-Da-d]\s*[.)\-:])(?:\s+|$)/, "");
  const text = stripped || line;
  return { kind: "paragraph", children: [{ kind: "text", text, marks: [], meta }], meta };
}

function stripLeadingMarker(block: ImportNode): ImportNode {
  if (block.kind !== "paragraph" && block.kind !== "heading") return block;
  const children = [...block.children];
  const first = children[0];
  if (first && first.kind === "text") {
    const stripped = first.text.replace(/^(?:explanation|solution|rationale|why)\s*:\s*/i, "");
    if (stripped !== first.text) {
      const next = stripped ? [{ ...first, text: stripped }] : [];
      return { ...block, children: [...next, ...children.slice(1)] };
    }
  }
  return block;
}

export function analyzeWholeQuestion(input: AnalyzeWholeQuestionInput): WholeQuestionAnalysis {
  const { pasted, sectionKey } = input;
  const blocks = pasted.nodes;
  const lines = logicalLines(blocks);
  const none = (signals: WholeQuestionAnalysis["signals"]): WholeQuestionAnalysis => ({
    questionNumber: null,
    stimulus: null,
    prompt: null,
    choices: [],
    correctChoice: null,
    rationale: null,
    sprPrimary: null,
    confidence: 0.3,
    band: "preserve",
    signals,
  });
  if (blocks.length === 0) return none([]);
  const lineClasses: Array<Classified & { blockIndex: number }> = lines.map((entry, index) => ({
    index,
    blockIndex: entry.blockIndex,
    ...classifyBlock({ kind: "paragraph", children: [{ kind: "text", text: entry.line, marks: [], meta: pasted.sourceMeta }], meta: pasted.sourceMeta }),
  }));
  const blockOfLine = (lineIndex: number): number => lineClasses[lineIndex]?.blockIndex ?? 0;
  const classes: Classified[] = lineClasses.map((c) => ({ index: c.index, kind: c.kind, label: c.label }));
  const choiceIdx = classes.filter((c) => c.kind === "choice");
  const keyLetters = classes.filter((c) => c.kind === "key-letter");
  const keyNumerics = classes.filter((c) => c.kind === "key-numeric");
  const lastChoice = choiceIdx.length > 0 ? (choiceIdx[choiceIdx.length - 1]?.index ?? -1) : -1;

  const signals: WholeQuestionAnalysis["signals"] = [];
  let confidence = 0.3;

  if (keyLetters.length >= 2) {
    signals.push({ kind: "answer-key", detail: "conflicting", weight: 0 });
    return { ...none(signals), confidence: Math.min(confidence, 0.7), band: "preserve" };
  }

  if (choiceIdx.length < 3 && keyNumerics.length > 0 && sectionKey === "reading-writing") {
    signals.push({ kind: "rw-spr-conflict", detail: "numeric key in RW", weight: 0 });
    return { ...none(signals), confidence: 0.3, band: "preserve" };
  }
  if (choiceIdx.length === 0 && keyNumerics.length > 0 && sectionKey === "math") {
    const keyLine = lineClasses[keyNumerics[0]?.index ?? 0]?.blockIndex ?? 0;
    const raw = lines[keyNumerics[0]?.index ?? 0]?.line.replace(/^answer\s*:\s*/i, "").trim() ?? "";
    signals.push({ kind: "spr-numeric-answer", detail: raw, weight: 0.15 });
    confidence += 0.15 + 0.3;
    const conf = Math.min(1, Math.max(0, confidence));
    const promptBlocks = [...new Set(lineClasses.filter((c) => c.index < (keyNumerics[0]?.index ?? 0)).map((c) => c.blockIndex))];
    void keyLine;
    return {
      questionNumber: null,
      stimulus: null,
      prompt: branchOf(pasted, promptBlocks),
      choices: [],
      correctChoice: null,
      rationale: null,
      sprPrimary: raw,
      confidence: conf,
      band: bandForConfidence(conf),
      signals,
    };
  }
  if (choiceIdx.length < 3) {
    if (choiceIdx.length > 0) signals.push({ kind: "choice-count-mismatch", detail: String(choiceIdx.length), weight: 0 });
    else {
      const proseHits = lineClasses.filter((c) => /\b(plan|vitamin|part|option)\s+[A-Da-d]\s*\./i.test(lines[c.index]?.line ?? ""));
      if (proseHits.length > 0) signals.push({ kind: "ambiguous-label-prose", detail: proseHits.map((c) => String(c.index)).join(","), weight: 0 });
    }
    return none(signals);
  }

  const labels = choiceIdx.map((c) => c.label ?? "");
  const firstChoice = choiceIdx[0]?.index ?? -1;
  const ordered = labels.every((l, i) => (i === 0 ? true : l.charCodeAt(0) === (labels[i - 1]?.charCodeAt(0) ?? 0) + 1));
  const contiguous = lastChoice - firstChoice + 1 === choiceIdx.length;
  const postRunKey = keyLetters.find((k) => k.index > lastChoice) ?? null;
  if ((!ordered || !contiguous) && !postRunKey) {
    return none([]);
  }

  const runWeight = choiceIdx.length === 4 ? 0.45 : choiceIdx.length === 3 ? 0.25 : 0.45;
  confidence += runWeight;
  signals.push({ kind: "choice-run", detail: labels.join(""), weight: runWeight });
  if (choiceIdx.length !== 4) signals.push({ kind: "choice-count-mismatch", detail: String(choiceIdx.length), weight: 0 });

  let correctChoice: "A" | "B" | "C" | "D" | null = null;
  if (postRunKey?.label && (labels as string[]).includes(postRunKey.label)) {
    correctChoice = postRunKey.label as "A" | "B" | "C" | "D";
    confidence += 0.12;
    signals.push({ kind: "answer-key", detail: correctChoice, weight: 0.12 });
  }

  const explainAt = classes.find((c) => c.index > lastChoice && c.kind === "explanation");
  const preExplain = classes.find((c) => c.index < firstChoice && c.kind === "explanation");
  if (preExplain && !explainAt) signals.push({ kind: "ambiguous-label-prose", detail: "marker before choices", weight: 0 });
  const rationaleLineIdx = explainAt
    ? classes.filter((c) => c.index >= explainAt.index && c.kind !== "key-letter").map((c) => c.index)
    : [];
  const rationaleIndices = [...new Set(rationaleLineIdx.map((i) => blockOfLine(i)))];
  if (explainAt) {
    confidence += 0.08;
    signals.push({ kind: "explanation-marker", detail: "post-run", weight: 0.08 });
  }

  const preBlocks = classes.filter((c) => c.index < firstChoice);
  let questionNumber: string | null = null;
  const qnum = preBlocks.find((c) => c.kind === "question");
  if (qnum && preBlocks[0]?.index === qnum.index) {
    const m = (lines[qnum.index]?.line ?? "").match(QNUM_RE);
    questionNumber = m?.[1] ?? null;
    if (questionNumber) {
      confidence += 0.03;
      signals.push({ kind: "question-number", detail: questionNumber, weight: 0.03 });
    }
  }

  const preBlockSet = [...new Set(preBlocks.map((c) => blockOfLine(c.index)))];
  let stimulusIndices: number[] = [];
  let promptIndices: number[] = [...preBlockSet];
  if (blocks.length + choiceIdx.length >= 4 && preBlocks.length >= 2) {
    const stemIdx = [...preBlocks].reverse().find((c) => {
      const line = lines[c.index]?.line ?? "";
      return line.endsWith("?") || STEM_VERB_RE.test(line);
    });
    if (stemIdx) {
      const passage = [...new Set(preBlocks.filter((c) => c.index < stemIdx.index).map((c) => blockOfLine(c.index)))];
      if (passage.length > 0) {
        stimulusIndices = passage;
        promptIndices = [...new Set(preBlocks.filter((c) => c.index >= stemIdx.index).map((c) => blockOfLine(c.index)))];
        confidence += 0.08;
        signals.push({ kind: "stimulus-split", detail: String(passage.length), weight: 0.08 });
      }
    }
  }

  if (sectionKey === "reading-writing" && keyNumerics.length > 0) {
    confidence = Math.min(confidence, 0.7);
    signals.push({ kind: "rw-spr-conflict", detail: "numeric key in RW", weight: 0 });
  }

  const conf = Math.min(1, Math.max(0, confidence));
  const band = bandForConfidence(conf);
  const lineTextOf = (lineIndex: number): string => lines[lineIndex]?.line ?? "";
  const choiceBlocks = [...new Set(choiceIdx.map((c) => blockOfLine(c.index)))];
  void firstChoice;
  const choices: WholeQuestionChoice[] = choiceIdx
    .filter((c): c is Classified & { label: "A" | "B" | "C" | "D" } => c.label === "A" || c.label === "B" || c.label === "C" || c.label === "D")
    .map((c) => ({
      label: c.label,
      content: {
        version: 1 as const,
        nodes: [stripChoiceLine(lineTextOf(c.index), pasted.sourceMeta)],
        sourceMeta: { ...pasted.sourceMeta },
      },
    }));
  const rationaleNodes = rationaleIndices.map((i) => blocks[i]).filter((n): n is ImportNode => n !== undefined);
  if (rationaleNodes.length > 0 && rationaleNodes[0]) {
    rationaleNodes[0] = stripLeadingMarker(rationaleNodes[0]);
  }
  const spans: WholeQuestionAnalysis["spans"] = {};
  if (stimulusIndices.length > 0) spans.stimulus = [stimulusIndices[0] as number, stimulusIndices[stimulusIndices.length - 1] as number];
  if (promptIndices.length > 0) spans.prompt = [promptIndices[0] as number, promptIndices[promptIndices.length - 1] as number];
  if (choiceBlocks.length > 0) spans.choices = [choiceBlocks[0] as number, choiceBlocks[choiceBlocks.length - 1] as number];
  if (rationaleIndices.length > 0) spans.rationale = [rationaleIndices[0] as number, rationaleIndices[rationaleIndices.length - 1] as number];
  return {
    questionNumber,
    stimulus: branchOf(pasted, stimulusIndices),
    prompt: branchOf(pasted, promptIndices),
    choices,
    correctChoice,
    rationale: rationaleNodes.length > 0 ? { version: 1, nodes: rationaleNodes, sourceMeta: { ...pasted.sourceMeta } } : null,
    sprPrimary: null,
    confidence: conf,
    band,
    signals,
    spans,
  };
}
