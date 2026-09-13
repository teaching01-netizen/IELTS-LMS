/**
 * Phase 08 — atomic split builder (pure, no React/TipTap/editor imports).
 *
 * buildSplitQuestion(current, analysis) returns a NEW QuestionRevision.
 * Single-writer rule: the spine calls it once and passes the result to the
 * existing onChange once (one autosave revision). Stable option ids are
 * reused by position; fresh ids via crypto.randomUUID with a deterministic
 * fallback (tests may inject makeId). SPR only in math; RW never converts.
 * Branches convert via Phase-07 importAstToRichDocument (choice profile)
 * then structuredContentFromDocument — NO editor instance is constructed.
 */
import type {
  AnswerDefinition,
  ChoiceOption,
  QuestionRevision,
  StructuredContent,
} from "../../../contracts/assessment";
import { structuredContentFromDocument } from "../../richContent";
import { importAstToRichDocument } from "../conversion/importAstToRichDocument";
import type { RichComposerCapabilities } from "../../RichQuestionComposer";

/**
 * Local copies of the composer capability profiles (mirrors
 * SAT_RICH_COMPOSER_CAPABILITIES / SAT_CHOICE_COMPOSER_CAPABILITIES).
 * Inlined — not imported — so this pure builder never pulls the React /
 * TipTap composer module into the ingestion graph (no import cycle via
 * RichQuestionComposer -> plugins -> ingestion).
 */
const RICH_CAPS: Readonly<RichComposerCapabilities> = Object.freeze({
  blockStyles: true, lists: true, underline: true, equation: true,
  image: true, table: true, code: true, history: true,
});
const CHOICE_CAPS: Readonly<RichComposerCapabilities> = Object.freeze({
  blockStyles: false, lists: false, underline: true, equation: true,
  image: true, table: true, code: true, history: true,
});
import type { ImportDocument } from "../domain/importDocument";
import type { WholeQuestionAnalysis } from "./wholeQuestionTypes";

export interface SplitBuilderOptions {
  makeId?: (() => string) | undefined;
}

function emptyContent(): StructuredContent {
  return structuredContentFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
}

function branchToContent(branch: ImportDocument | null, choiceProfile: boolean): StructuredContent | null {
  if (!branch || branch.nodes.length === 0) return null;
  const caps = choiceProfile ? CHOICE_CAPS : RICH_CAPS;
  const converted = importAstToRichDocument(branch, caps);
  return structuredContentFromDocument(converted.doc);
}

function freshId(makeId: () => string): string {
  try {
    return makeId();
  } catch {
    return "split-" + Math.random().toString(36).slice(2, 10);
  }
}

export function buildSplitQuestion(
  current: QuestionRevision,
  analysis: WholeQuestionAnalysis,
  opts?: SplitBuilderOptions,
): QuestionRevision {
  const makeId =
    opts?.makeId ??
    (() => {
      const g = globalThis as { crypto?: { randomUUID?: () => string } };
      if (typeof g.crypto?.randomUUID === "function") return (g.crypto.randomUUID as () => string)();
      return "split-" + Math.random().toString(36).slice(2, 10);
    });
  const next: QuestionRevision = {
    ...current,
    metadata: { ...current.metadata, tags: [...current.metadata.tags] },
    accessibility: { ...current.accessibility },
  };

  const promptContent = branchToContent(analysis.prompt, false);
  if (promptContent) next.prompt = promptContent;
  const stimulusContent = branchToContent(analysis.stimulus, false);
  if (stimulusContent) next.stimulus = stimulusContent;
  const rationaleContent = branchToContent(analysis.rationale, false);
  if (rationaleContent) next.rationale = rationaleContent;

  const sectionKey = current.metadata.sectionKey;
  if (analysis.choices.length >= 3) {
    const existing =
      current.answer.kind === "single_choice" && current.answer.options.length === 4
        ? current.answer.options.map((o) => o.id)
        : null;
    const ids = existing ?? [freshId(makeId), freshId(makeId), freshId(makeId), freshId(makeId)];
    const byLabel = new Map(analysis.choices.map((c) => [c.label, c] as const));
    const options: ChoiceOption[] = (["A", "B", "C", "D"] as const).map((label, i) => {
      const branch = byLabel.get(label);
      const content = (branch && branchToContent(branch.content, true)) || emptyContent();
      return { id: ids[i] as string, content };
    });
    const keyIndex = analysis.correctChoice ? ["A", "B", "C", "D"].indexOf(analysis.correctChoice) : -1;
    const answer: AnswerDefinition = {
      kind: "single_choice",
      options,
      correctOptionId: keyIndex >= 0 ? (ids[keyIndex] as string) : null,
    };
    next.questionType = "single_choice";
    next.answer = answer;
  } else if (analysis.sprPrimary !== null && sectionKey === "math") {
    next.questionType = "student_produced_response";
    next.answer = {
      kind: "student_produced_response",
      acceptedResponses: [analysis.sprPrimary],
      normalizeFraction: true,
      normalizeDecimal: true,
      numericTolerance: null,
    };
  }
  return next;
}
