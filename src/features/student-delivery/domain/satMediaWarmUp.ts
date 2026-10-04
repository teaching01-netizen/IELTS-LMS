import type { DeliveredQuestion } from "../../exam-rendering/api/assessmentContracts";
import { collectStructuredImageAssetIds } from "../../exam-rendering/api/structuredContent";

/** The parts of a delivered question that can carry a figure. */
export type SatMediaQuestion = Pick<DeliveredQuestion, "examQuestionId" | "stimulus" | "prompt" | "answer">;

export interface SatMediaWarmUp {
  /** The question on screen: fetched first, and alone. */
  onScreen: string[];
  /** Every other figure in the module, in the order the student will reach it. */
  rest: string[];
}

function questionAssetIds(question: SatMediaQuestion): string[] {
  return [
    question.stimulus,
    question.prompt,
    ...(question.answer.kind === "single_choice" ? question.answer.options.map((option) => option.content) : []),
  ].flatMap((content) => collectStructuredImageAssetIds(content));
}

/**
 * The order a module's protected figures are downloaded in.
 *
 * On a slow exam-room link the figure the student is looking at must not share
 * the bandwidth with the warm-up, so it comes first and on its own. The rest
 * run from the next question to the end of the module, then wrap round to the
 * questions before it: a student who reloads mid-module has already seen
 * those, so they are the least urgent. Each figure appears once.
 */
export function satMediaWarmUp(
  questions: readonly SatMediaQuestion[],
  onScreenQuestionId: string | null | undefined,
): SatMediaWarmUp {
  const at = questions.findIndex((question) => question.examQuestionId === onScreenQuestionId);
  const current = questions[at];
  const onScreen = current ? [...new Set(questionAssetIds(current))] : [];
  const ahead = [...questions.slice(at + 1), ...questions.slice(0, Math.max(at, 0))];
  const rest = [...new Set(ahead.flatMap(questionAssetIds))].filter((assetId) => !onScreen.includes(assetId));
  return { onScreen, rest };
}
