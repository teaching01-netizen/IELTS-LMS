import { z } from "zod";
import type { BatchQuestionDraft, Difficulty } from "../contracts/assessment";
import { plainContentFromText } from "../editor/richContent";
import { isSatDomain, isSatSkill } from "../providers/sat/taxonomy";
import { validateSatStudentResponse } from "../providers/sat/studentResponse";

export interface QuestionImportIssue {
  row: number;
  field: string;
  message: string;
}

export interface QuestionImportResult {
  rowCount: number;
  drafts: BatchQuestionDraft[];
  issues: QuestionImportIssue[];
}

const MAX_IMPORT_ROWS = 64;
const MAX_CELL_CHARS = 50_000;

const rawRowSchema = z.object({
  prompt: z.string().max(MAX_CELL_CHARS),
  stimulus: z.string().max(MAX_CELL_CHARS).default(""),
  a: z.string().max(MAX_CELL_CHARS).default(""),
  b: z.string().max(MAX_CELL_CHARS).default(""),
  c: z.string().max(MAX_CELL_CHARS).default(""),
  d: z.string().max(MAX_CELL_CHARS).default(""),
  correct: z.string().max(500).default(""),
  responseType: z.string().max(100).default(""),
  acceptedResponses: z.string().max(10_000).default(""),
  domain: z.string().max(200).default(""),
  skill: z.string().max(500).default(""),
  difficulty: z.string().max(50).default(""),
  tags: z.string().max(2_000).default(""),
  rationale: z.string().max(MAX_CELL_CHARS).default(""),
  pretest: z.string().max(50).default(""),
});

type RawRow = z.infer<typeof rawRowSchema>;

type ColumnKey = keyof RawRow;

const aliases: Record<ColumnKey, readonly string[]> = {
  prompt: ["prompt", "question", "question prompt", "question text"],
  stimulus: ["stimulus", "supporting material", "passage", "context"],
  a: ["a", "choice a", "option a", "answer a"],
  b: ["b", "choice b", "option b", "answer b"],
  c: ["c", "choice c", "option c", "answer c"],
  d: ["d", "choice d", "option d", "answer d"],
  correct: ["correct", "correct answer", "answer key", "key"],
  responseType: ["response type", "type", "question type"],
  acceptedResponses: ["accepted responses", "accepted response", "responses"],
  domain: ["domain"],
  skill: ["skill"],
  difficulty: ["difficulty", "level"],
  tags: ["tags", "tag"],
  rationale: ["rationale", "explanation"],
  pretest: ["pretest", "is pretest"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function resolveColumns(headers: readonly string[]): Map<ColumnKey, number> {
  const normalized = headers.map(normalizeHeader);
  const result = new Map<ColumnKey, number>();
  for (const [key, values] of Object.entries(aliases) as [ColumnKey, readonly string[]][]) {
    const index = normalized.findIndex((header) => values.includes(header));
    if (index >= 0) result.set(key, index);
  }
  return result;
}

export function parseDelimitedRows(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = countUnquoted(firstLine, "\t") > countUnquoted(firstLine, ",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("Import data contains an unterminated quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function countUnquoted(value: string, token: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && value[index] === token) count += 1;
  }
  return count;
}

function parseDifficulty(value: string): Difficulty | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return "medium";
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") return normalized;
  return null;
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return false;
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

function isStudentResponse(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase().replace(/[_-]+/g, " ");
  return ["spr", "student response", "student produced response"].includes(normalized);
}

function cell(row: readonly string[], columns: Map<ColumnKey, number>, key: ColumnKey): string {
  const index = columns.get(key);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

export function parseQuestionImport(input: string, sectionKey: string): QuestionImportResult {
  let rows: string[][];
  try {
    rows = parseDelimitedRows(input);
  } catch (error) {
    return {
      rowCount: 0,
      drafts: [],
      issues: [
        {
          row: 0,
          field: "file",
          message: error instanceof Error ? error.message : "Import data is invalid.",
        },
      ],
    };
  }
  if (rows.length === 0)
    return {
      rowCount: 0,
      drafts: [],
      issues: [
        { row: 0, field: "file", message: "Include a header row and at least one question row." },
      ],
    };
  if (rows.length === 1) return { rowCount: 0, drafts: [], issues: [] };
  const columns = resolveColumns(rows[0]!);
  if (!columns.has("prompt"))
    return {
      rowCount: rows.length - 1,
      drafts: [],
      issues: [{ row: 1, field: "prompt", message: "A Prompt or Question column is required." }],
    };
  const dataRows = rows.slice(1, MAX_IMPORT_ROWS + 1);
  const issues: QuestionImportIssue[] = [];
  if (rows.length - 1 > MAX_IMPORT_ROWS)
    issues.push({
      row: MAX_IMPORT_ROWS + 2,
      field: "file",
      message: `At most ${MAX_IMPORT_ROWS} questions can be imported at once.`,
    });
  const drafts: BatchQuestionDraft[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const parsed = rawRowSchema.safeParse(
      Object.fromEntries(
        (Object.keys(aliases) as ColumnKey[]).map((key) => [key, cell(row, columns, key)])
      )
    );
    if (!parsed.success) {
      issues.push({
        row: rowNumber,
        field: "row",
        message: parsed.error.issues[0]?.message ?? "Row contains invalid values.",
      });
      return;
    }
    const value = parsed.data;
    const rowIssues: QuestionImportIssue[] = [];
    if (!value.prompt)
      rowIssues.push({ row: rowNumber, field: "prompt", message: "Prompt is required." });
    const difficulty = parseDifficulty(value.difficulty);
    if (!difficulty)
      rowIssues.push({
        row: rowNumber,
        field: "difficulty",
        message: "Difficulty must be Easy, Medium, or Hard.",
      });
    const pretest = parseBoolean(value.pretest);
    if (pretest === null)
      rowIssues.push({
        row: rowNumber,
        field: "pretest",
        message: "Pretest must be Yes/No, True/False, or 1/0.",
      });
    const domain = value.domain || null;
    if (domain && !isSatDomain(sectionKey, domain))
      rowIssues.push({
        row: rowNumber,
        field: "domain",
        message: `Domain “${domain}” is not valid for this SAT section.`,
      });
    const skill = value.skill || null;
    if (skill && !domain)
      rowIssues.push({ row: rowNumber, field: "skill", message: "Skill requires a Domain." });
    else if (skill && !isSatSkill(domain, skill))
      rowIssues.push({
        row: rowNumber,
        field: "skill",
        message: `Skill “${skill}” does not belong to the selected domain.`,
      });

    const spr = isStudentResponse(value.responseType);
    if (spr && sectionKey !== "math")
      rowIssues.push({
        row: rowNumber,
        field: "response type",
        message: "Student-produced response is only supported in Math.",
      });
    let answer: BatchQuestionDraft["answer"];
    if (spr) {
      const accepted = (value.acceptedResponses || value.correct)
        .split(/[|;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!accepted.length)
        rowIssues.push({
          row: rowNumber,
          field: "accepted responses",
          message: "At least one accepted response is required.",
        });
      accepted.forEach((response) => {
        const validation = validateSatStudentResponse(response);
        if (!validation.valid) {
          rowIssues.push({
            row: rowNumber,
            field: "accepted responses",
            message: `“${response}”: ${validation.message}`,
          });
        }
      });
      answer = {
        kind: "student_produced_response",
        acceptedResponses: accepted,
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      };
    } else {
      const choices = [value.a, value.b, value.c, value.d];
      choices.forEach((choice, choiceIndex) => {
        if (!choice)
          rowIssues.push({
            row: rowNumber,
            field: String.fromCharCode(65 + choiceIndex),
            message: `Choice ${String.fromCharCode(65 + choiceIndex)} is required.`,
          });
      });
      const correct = value.correct.toUpperCase();
      if (!["A", "B", "C", "D"].includes(correct))
        rowIssues.push({
          row: rowNumber,
          field: "correct",
          message: "Correct answer must be A, B, C, or D.",
        });
      answer = {
        kind: "single_choice",
        options: choices.map((choice, choiceIndex) => ({
          id: String.fromCharCode(65 + choiceIndex),
          content: plainContentFromText(choice),
        })),
        correctOptionId: ["A", "B", "C", "D"].includes(correct) ? correct : null,
      };
    }
    if (rowIssues.length || !difficulty || pretest === null) {
      issues.push(...rowIssues);
      return;
    }
    drafts.push({
      questionType: spr ? "student_produced_response" : "single_choice",
      stimulus: plainContentFromText(value.stimulus),
      prompt: plainContentFromText(value.prompt),
      answer,
      rationale: plainContentFromText(value.rationale),
      metadata: {
        sectionKey,
        domain,
        skill,
        difficulty,
        tags: value.tags
          .split(/[,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
      accessibility: { longDescription: null },
      isPretest: pretest,
    });
  });
  return { rowCount: dataRows.length, drafts, issues };
}
