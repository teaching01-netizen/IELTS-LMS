import type { AssessmentDeliverySection, DeliveredQuestion } from "../../../contracts/assessmentDelivery";
import type { AnsweredExamAnswerKey, AnsweredExamKeyAnswer, AnsweredExamKeyEntry } from "../SatScoreReport";

const CHOICE_LETTERS = "ABCDEFGHIJ";

const RESULT_LABEL: Record<AnsweredExamKeyEntry["result"], string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  unanswered: "Unanswered",
};

/** The server's verdict as student-facing text; never derived from the response. */
export function keyResultLabel(result: AnsweredExamKeyEntry["result"]): string {
  return RESULT_LABEL[result];
}

/** The student's recorded answer as printed: letter for a listed choice, text otherwise. */
export function printedAnswerCell(question: DeliveredQuestion, answer: string | null): string {
  if (answer === null) return "Unanswered";
  if (question.answer.kind !== "single_choice") return answer;
  const choice = question.answer.options.findIndex((option) => option.id === answer);
  if (choice >= 0) return CHOICE_LETTERS[choice] ?? String(choice + 1);
  return `${answer} (not a listed choice)`;
}

/**
 * Every accepted representation the server sent, joined for one cell. Empty
 * answers are omitted rather than printed as a blank key.
 */
export function printedCorrectAnswers(answers: readonly AnsweredExamKeyAnswer[]): string {
  const printed = answers
    .map((answer) =>
      [answer.label, answer.text]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(". ")
    )
    .filter(Boolean);
  return printed.length ? printed.join(" or ") : "Not available";
}

/** Only well-formed server rows are trusted; anything else leaves the row answer-only. */
export function usableKeyEntry(entry: AnsweredExamKeyEntry): boolean {
  return (
    typeof entry?.moduleId === "string" &&
    entry.moduleId !== "" &&
    typeof entry?.examQuestionId === "string" &&
    entry.examQuestionId !== "" &&
    Array.isArray(entry.correctAnswers) &&
    (entry.result === "correct" || entry.result === "incorrect" || entry.result === "unanswered")
  );
}

/** Index the key by module and question; a reused question keeps each module's own key. */
export function answerKeyIndex(
  answerKey: AnsweredExamAnswerKey | null | undefined
): Map<string, AnsweredExamKeyEntry> {
  const index = new Map<string, AnsweredExamKeyEntry>();
  if (answerKey?.available !== true || !Array.isArray(answerKey.entries)) return index;
  for (const entry of answerKey.entries) {
    if (!usableKeyEntry(entry)) continue;
    index.set(`${entry.moduleId}:${entry.examQuestionId}`, entry);
  }
  return index;
}

export interface PrintedModule {
  sectionNo: number;
  sectionLabel: string;
  module: AssessmentDeliverySection["modules"][number];
}

/**
 * The separately authorized answer-key table. Values come only from the
 * server's projection: a missing row says so instead of guessing a verdict.
 */
export function SatAnswerKeyTable({
  modules,
  answers,
  entries,
}: {
  modules: readonly PrintedModule[];
  answers: ReadonlyMap<string, string>;
  entries: ReadonlyMap<string, AnsweredExamKeyEntry>;
}) {
  return (
    <section className="sat-paper-answer-key" data-answer-key="true">
      <div className="sat-paper-summary-heading">
        <h2>Answer key</h2>
        <p>Correct answers for the questions you sat, as released by your teacher</p>
      </div>
      {modules.map(({ sectionNo, sectionLabel, module }) => (
        <div key={`key-${module.id}`} className="sat-paper-key-module" data-key-module={module.id}>
          <h3>
            Section {sectionNo}: {sectionLabel} · {module.title}
          </h3>
          <table className="sat-pre-answer-key-table" data-answer-key-table={module.id}>
            <caption>
              Answer key · {module.title}
            </caption>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Your answer</th>
                <th scope="col">Correct answer(s)</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...module.questions]
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((question, index) => {
                  const entry = entries.get(`${module.id}:${question.examQuestionId}`);
                  const answer = answers.get(`${module.id}:${question.examQuestionId}`) ?? null;
                  return (
                    <tr
                      key={question.examQuestionId}
                      data-key-question={question.examQuestionId}
                      data-key-result={entry?.result ?? "missing"}
                    >
                      <th scope="row">Q{index + 1}</th>
                      <td>{printedAnswerCell(question, answer)}</td>
                      <td>{entry ? printedCorrectAnswers(entry.correctAnswers) : "Not available"}</td>
                      <td>{entry ? keyResultLabel(entry.result) : "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
