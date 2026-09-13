/**
 * Phase 08 — whole-question contracts (pure types, zero runtime imports).
 *
 * Verbatim from plans/sat-ingestion/phase-08-whole-question.md section 4.
 * Analysis describes; only buildSplitQuestion (applyWholeQuestionSplit.ts)
 * writes. Lives in exam/ beside the orphan-ported detector so branch
 * content (ImportDocument slices) never crosses a directory boundary.
 */
import type { ImportDocument } from "../domain/importDocument";

export type WholeQuestionChoice = {
  label: "A" | "B" | "C" | "D";
  content: ImportDocument;
};

export type WholeQuestionConfidenceBand = "auto-cleanup-only" | "suggest" | "preserve";

export interface WholeQuestionAnalysis {
  questionNumber: string | null;
  stimulus: ImportDocument | null;
  prompt: ImportDocument | null;
  choices: WholeQuestionChoice[];
  correctChoice: "A" | "B" | "C" | "D" | null;
  rationale: ImportDocument | null;
  sprPrimary: string | null;
  confidence: number;
  band: WholeQuestionConfidenceBand;
  signals: Array<{
    kind:
      | "choice-run"
      | "answer-key"
      | "explanation-marker"
      | "question-number"
      | "stimulus-split"
      | "spr-numeric-answer"
      | "choice-count-mismatch"
      | "ambiguous-label-prose"
      | "rw-spr-conflict";
    detail: string;
    weight: number;
  }>;
  spans?:
    | { stimulus?: [number, number]; prompt?: [number, number]; choices?: [number, number]; rationale?: [number, number] }
    | undefined;
}

export interface AnalyzeWholeQuestionInput {
  pasted: ImportDocument;
  targetField: "prompt" | "stimulus" | "rationale" | "answer-choice";
  sectionKey: "reading-writing" | "math";
  pastedPlainText: string;
}

export interface SuggestionOutcome {
  accepted: boolean;
  confidence: number;
  band: WholeQuestionConfidenceBand;
  choiceCount: number;
  hadKey: boolean;
  hadRationale: boolean;
  sectionKey: string;
}

export function toOutcome(
  analysis: WholeQuestionAnalysis,
  sectionKey: AnalyzeWholeQuestionInput["sectionKey"],
  accepted: boolean,
): SuggestionOutcome {
  return {
    accepted,
    confidence: analysis.confidence,
    band: analysis.band,
    choiceCount: analysis.choices.length,
    hadKey: analysis.correctChoice !== null,
    hadRationale: analysis.rationale !== null,
    sectionKey,
  };
}
