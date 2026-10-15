import type { QuestionRevision, StructuredContent } from "../contracts/assessment";
import { plainContentFromText } from "../editor/richContent";
import bikeGraph from "./assets/bike-value.png";

export interface SatWorkbookExample {
  id: string;
  label: string;
  guidance: string;
  question: QuestionRevision;
  cells: Array<{ column: string; editor: string; value: string }>;
  asset?: { key: string; alt: string };
}

const tableRows = [
  ["Area (square feet)", "Water (gallons)"],
  ["2,520", "4,536"], ["3,780", "6,804"], ["5,040", "9,072"],
];
const tableMarkdown = tableRows.map((row, index) => `${index === 1 ? "| --- | --- |\n" : ""}| ${row.join(" | ")} |`).join("\n");
const passage = "Native plants provide food for local insects. A garden with many native plants can support more kinds of insects.";
const graphAlt = "Estimated bike value decreases from $250 at purchase to about $75 after 24 months.";

function example(input: {
  id: string; label: string; prompt: string; guidance: string;
  stimulus?: StructuredContent; stimulusCell?: string;
  choices?: string[]; mathChoices?: string[]; correct?: string;
  accepted?: string; section?: "math" | "reading-writing";
  asset?: SatWorkbookExample["asset"];
}): SatWorkbookExample {
  const numeric = input.accepted !== undefined;
  const section = input.section ?? "math";
  const choices = input.choices ?? input.mathChoices?.map((latex) => `\\(${latex}\\)`) ?? [];
  const question: QuestionRevision = {
    id: `example-${input.id}`, questionId: `example-${input.id}`, semanticRevision: 1,
    revision: 0, state: "draft", questionType: numeric ? "student_produced_response" : "single_choice",
    stimulus: input.stimulus ?? plainContentFromText(""), prompt: plainContentFromText(input.prompt),
    answer: numeric
      ? { kind: "student_produced_response", acceptedResponses: [input.accepted!], normalizeFraction: true, normalizeDecimal: true, numericTolerance: null }
      : { kind: "single_choice", correctOptionId: input.correct ?? null, options: choices.map((text, index) => ({
          id: String.fromCharCode(65 + index),
          content: input.mathChoices ? {
            version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: input.mathChoices[index] } }] }] },
          } : plainContentFromText(text),
        })) },
    rationale: plainContentFromText(""),
    metadata: { sectionKey: section, domain: section === "math" ? "algebra" : "information-and-ideas", skill: section === "math" ? "Linear Functions" : "Central Ideas and Details", difficulty: "easy", tags: [] },
    accessibility: { longDescription: null },
  };
  return {
    id: input.id, label: input.label, guidance: input.guidance, question,
    cells: [
      { column: "Prompt", editor: "Question text · required", value: input.prompt },
      { column: "Stimulus", editor: "Passage or image · optional", value: input.stimulusCell ?? "" },
      { column: "Response Type", editor: "Response type", value: numeric ? "Student Response" : "Multiple Choice" },
      ...["A", "B", "C", "D"].map((column, index) => ({ column, editor: "Answer choices", value: choices[index] ?? "" })),
      { column: "Correct", editor: "Correct answer · grading only", value: input.correct ?? "" },
      { column: "Accepted Responses", editor: "Correct answer · grading only", value: input.accepted ?? "" },
    ],
    ...(input.asset ? { asset: input.asset } : {}),
  };
}

export const SAT_WORKBOOK_EXAMPLES: readonly SatWorkbookExample[] = [
  example({
    id: "text-only", label: "Text-only multiple choice", prompt: "What is 3 + 5?",
    choices: ["6", "7", "8", "9"], correct: "C",
    guidance: "Leave Stimulus blank: this question needs no separate passage, table, or image. The question and answers use one pane. Keep a standalone word problem’s context and question together in Prompt.",
  }),
  example({
    id: "passage", label: "Reading passage", section: "reading-writing",
    stimulus: plainContentFromText(passage), stimulusCell: passage,
    prompt: "Which choice best states the main idea of the text?",
    choices: ["Native plants can support local insects.", "All insects eat the same food.", "Gardens cannot support insects.", "Native plants grow only in gardens."], correct: "A",
    guidance: "Put the passage in Stimulus and the question request in Prompt. Students read the passage in its own pane, or above the question on a narrow screen. Do not repeat it in Prompt.",
  }),
  example({
    id: "table", label: "Data table", stimulusCell: tableMarkdown,
    stimulus: { version: 1, nodes: [{ type: "table", id: "roof-table", rows: tableRows }] },
    prompt: "The table shows the water drained from roofs of different areas. Which equation gives the amount of water f(x), in gallons, for a roof area of x square feet?",
    mathChoices: ["f(x)=0.6x", "f(x)=1.8x", "f(x)=2268x", "f(x)=0.5x+3276"], correct: "B",
    guidance: "Use a Markdown table in Stimulus to preserve rows and columns. Put the word problem and question in Prompt. Do not flatten table values into a line of question text. Math choices use inline LaTeX: \\( ... \\).",
  }),
  example({
    id: "image", label: "Graph or image", stimulusCell: "![bike_value]",
    stimulus: { version: 2, nodes: [], document: { type: "doc", content: [{ type: "image", attrs: { src: bikeGraph, alt: graphAlt } }] } },
    prompt: "The graph shows the estimated value of a mountain bike after purchase. What does the y-intercept represent?",
    choices: ["The bike was worth $250 when purchased.", "The bike was worth $250 after 24 months.", "The bike lost $250 each month.", "The bike gained $250 each month."], correct: "A",
    asset: { key: "bike_value", alt: graphAlt },
    guidance: "Put the graph image in Assets and reference its key in Stimulus. Keep graph labels inside the image; do not paste OCR fragments into Prompt. Use the figure itself, rather than a whole source page that repeats the question and choices.",
  }),
  example({
    id: "numeric", label: "Numeric response", prompt: "If 3x = 12, what is x?", accepted: "4",
    guidance: "Leave Stimulus blank when no supporting material is needed. Choose Student Response for Math, put the verified answer in Accepted Responses, and leave A–D and Correct blank. Students see a numeric input, not the accepted answer.",
  }),
];
