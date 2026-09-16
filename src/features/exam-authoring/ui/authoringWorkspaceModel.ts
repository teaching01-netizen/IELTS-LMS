import type { QuestionRevision, StructuredContent } from "../contracts/assessment";

// The question-projection model for the SAT authoring workspace: how a question
// becomes the workspace's scalar record and rich roots, and how those project
// back onto a revision.
//
// Deliberately free of React, Yjs, and transport: every rule here is a pure
// function of its arguments, so it can be reasoned about without a mounted
// workspace or an open room.

export type QuestionWorkspaceScalar = {
  questionType: QuestionRevision["questionType"];
  answer: QuestionRevision["answer"] | { kind: "single_choice"; options: Array<{ id: string }>; correctOptionId: string | null };
  metadata: QuestionRevision["metadata"];
  accessibility: QuestionRevision["accessibility"];
  isPretest?: boolean;
};

export function questionWorkspaceScalar(question: QuestionRevision, isPretest?: boolean): QuestionWorkspaceScalar {
  const answer = question.answer.kind === "single_choice"
    ? {
        kind: "single_choice" as const,
        options: question.answer.options.map(({ id }) => ({ id })),
        correctOptionId: question.answer.correctOptionId,
      }
    : question.answer;
  return {
    questionType: question.questionType,
    answer,
    metadata: question.metadata,
    accessibility: question.accessibility,
    ...(isPretest === undefined ? {} : { isPretest }),
  };
}

export function emptyWorkspaceContent(): QuestionRevision["prompt"] {
  return {
    version: 2,
    nodes: [],
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStructuredContent(value: unknown): StructuredContent {
  if (!isRecord(value)) return emptyWorkspaceContent();
  if (value["version"] === 2 && isRecord(value["document"]) && value["document"]["type"] === "doc") {
    return {
      version: 2,
      nodes: Array.isArray(value["nodes"]) ? value["nodes"] as StructuredContent["nodes"] : [],
      document: value["document"] as unknown as StructuredContent["document"],
    };
  }
  if (value["version"] === 1 && Array.isArray(value["nodes"])) {
    return value as unknown as StructuredContent;
  }
  return emptyWorkspaceContent();
}

/** API/database rows can contain pre-v2 or partially shaped rich fields. */
export function normalizeQuestionRevision(question: QuestionRevision): QuestionRevision {
  const raw = question as unknown as Record<string, unknown>;
  const rawMetadata = isRecord(raw["metadata"]) ? raw["metadata"] : {};
  const rawAccessibility = isRecord(raw["accessibility"]) ? raw["accessibility"] : {};
  const rawAnswer = isRecord(raw["answer"]) ? raw["answer"] : {};
  const answer = rawAnswer["kind"] === "student_produced_response"
    ? {
        kind: "student_produced_response" as const,
        acceptedResponses: Array.isArray(rawAnswer["acceptedResponses"])
          ? rawAnswer["acceptedResponses"].filter((value): value is string => typeof value === "string")
          : [],
        normalizeFraction: rawAnswer["normalizeFraction"] !== false,
        normalizeDecimal: rawAnswer["normalizeDecimal"] !== false,
        numericTolerance: typeof rawAnswer["numericTolerance"] === "string" ? rawAnswer["numericTolerance"] : null,
      }
    : {
        kind: "single_choice" as const,
        options: (Array.isArray(rawAnswer["options"]) ? rawAnswer["options"] : []).map((option, index) => {
          const rawOption = isRecord(option) ? option : {};
          return {
            id: typeof rawOption["id"] === "string" && rawOption["id"].trim()
              ? rawOption["id"]
              : String.fromCharCode(65 + index),
            content: normalizeStructuredContent(rawOption["content"]),
          };
        }),
        correctOptionId: typeof rawAnswer["correctOptionId"] === "string" ? rawAnswer["correctOptionId"] : null,
      };
  return {
    ...question,
    questionType: question.questionType === "student_produced_response" || question.questionType === "single_choice"
      ? question.questionType
      : answer.kind,
    stimulus: normalizeStructuredContent(raw["stimulus"]),
    prompt: normalizeStructuredContent(raw["prompt"]),
    rationale: normalizeStructuredContent(raw["rationale"]),
    answer,
    metadata: {
      sectionKey: typeof rawMetadata["sectionKey"] === "string" ? rawMetadata["sectionKey"] : "reading-writing",
      domain: typeof rawMetadata["domain"] === "string" ? rawMetadata["domain"] : null,
      skill: typeof rawMetadata["skill"] === "string" ? rawMetadata["skill"] : null,
      difficulty: rawMetadata["difficulty"] === "easy" || rawMetadata["difficulty"] === "hard" ? rawMetadata["difficulty"] : "medium",
      tags: Array.isArray(rawMetadata["tags"])
        ? rawMetadata["tags"].filter((value): value is string => typeof value === "string")
        : [],
    },
    accessibility: {
      longDescription: typeof rawAccessibility["longDescription"] === "string" ? rawAccessibility["longDescription"] : null,
    },
  };
}

export function isQuestionWorkspaceScalar(value: unknown): value is QuestionWorkspaceScalar {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate["questionType"] === "single_choice" || candidate["questionType"] === "student_produced_response") &&
    candidate["answer"] !== null &&
    typeof candidate["answer"] === "object" &&
    candidate["metadata"] !== null &&
    typeof candidate["metadata"] === "object" &&
    candidate["accessibility"] !== null &&
    typeof candidate["accessibility"] === "object" &&
    (candidate["isPretest"] === undefined || typeof candidate["isPretest"] === "boolean")
  );
}

type QuestionWorkspaceRich = {
  prompt?: StructuredContent;
  stimulus?: StructuredContent;
  rationale?: StructuredContent;
  choices: Record<string, StructuredContent>;
};

function isWorkspaceRichContent(value: unknown): value is StructuredContent {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["version"] === 2 &&
    candidate["nodes"] !== null &&
    Array.isArray(candidate["nodes"]) &&
    candidate["document"] !== null &&
    typeof candidate["document"] === "object"
  );
}

export function questionWorkspaceRich(
  values: Record<string, unknown>,
  questionPath: string,
): QuestionWorkspaceRich | null {
  const prefix = `rich:${questionPath}/`;
  const result: QuestionWorkspaceRich = { choices: {} };
  let found = false;
  const prompt = values[`${prefix}prompt`];
  if (isWorkspaceRichContent(prompt)) {
    result.prompt = prompt;
    found = true;
  }
  const stimulus = values[`${prefix}stimulus`];
  if (isWorkspaceRichContent(stimulus)) {
    result.stimulus = stimulus;
    found = true;
  }
  const rationale = values[`${prefix}rationale`];
  if (isWorkspaceRichContent(rationale)) {
    result.rationale = rationale;
    found = true;
  }
  for (const [path, value] of Object.entries(values)) {
    if (!path.startsWith(`${prefix}choice/`)) continue;
    const optionId = path.slice(`${prefix}choice/`.length);
    if (!optionId || !isWorkspaceRichContent(value)) continue;
    result.choices[optionId] = value;
    found = true;
  }
  return found ? result : null;
}

export function applyQuestionWorkspaceRich(
  question: QuestionRevision,
  rich: QuestionWorkspaceRich,
): QuestionRevision {
  const next: QuestionRevision = {
    ...question,
    ...(rich.prompt ? { prompt: rich.prompt } : {}),
    ...(rich.stimulus ? { stimulus: rich.stimulus } : {}),
    ...(rich.rationale ? { rationale: rich.rationale } : {}),
  };
  if (next.answer.kind !== "single_choice") return next;
  return {
    ...next,
    answer: {
      ...next.answer,
      options: next.answer.options.map((option) =>
        (() => {
          const content = rich.choices[option.id];
          return content ? { ...option, content } : option;
        })(),
      ),
    },
  };
}

export function applyQuestionWorkspaceScalar(
  question: QuestionRevision,
  scalar: QuestionWorkspaceScalar,
): QuestionRevision {
  if (scalar.answer.kind === "single_choice") {
    const currentOptions = question.answer.kind === "single_choice" ? question.answer.options : [];
    return {
      ...question,
      questionType: scalar.questionType,
      answer: {
        kind: "single_choice",
        options: scalar.answer.options.map(({ id }) => ({
          id,
          content: currentOptions.find((option) => option.id === id)?.content ?? {
            version: 2,
            nodes: [],
            document: { type: "doc", content: [{ type: "paragraph" }] },
          },
        })),
        correctOptionId: scalar.answer.correctOptionId,
      },
      metadata: scalar.metadata,
      accessibility: scalar.accessibility,
    };
  }
  return {
    ...question,
    questionType: scalar.questionType,
    answer: scalar.answer,
    metadata: scalar.metadata,
    accessibility: scalar.accessibility,
  };
}
