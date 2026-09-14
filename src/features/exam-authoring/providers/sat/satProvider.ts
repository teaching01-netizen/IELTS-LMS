import type {
  AssessmentValidationIssue,
  ContentNode,
  QuestionRevision,
  StructuredContent,
} from "../../contracts/assessment";
import { isSatDomain, isSatSkill } from "./taxonomy";
import { validateSatStudentResponse } from "./studentResponse";

export interface SatBlueprintModule {
  key: string;
  title: string;
  durationSeconds: number;
  questionCount: number;
  pretestCount: number;
  adaptiveRole: "base" | "lower_branch" | "higher_branch";
  tools: Array<"calculator" | "reference_sheet">;
}

export interface SatBlueprintSection {
  key: "reading-writing" | "math";
  title: string;
  breakAfterSeconds: number;
  modules: SatBlueprintModule[];
}

export const SAT_BLUEPRINT: SatBlueprintSection[] = [
  {
    key: "reading-writing",
    title: "Reading & Writing",
    breakAfterSeconds: 600,
    modules: [
      {
        key: "rw-m1",
        title: "Module 1",
        durationSeconds: 1920,
        questionCount: 27,
        pretestCount: 2,
        adaptiveRole: "base",
        tools: [],
      },
      {
        key: "rw-m2-lower",
        title: "Module 2 — Lower",
        durationSeconds: 1920,
        questionCount: 27,
        pretestCount: 2,
        adaptiveRole: "lower_branch",
        tools: [],
      },
      {
        key: "rw-m2-higher",
        title: "Module 2 — Higher",
        durationSeconds: 1920,
        questionCount: 27,
        pretestCount: 2,
        adaptiveRole: "higher_branch",
        tools: [],
      },
    ],
  },
  {
    key: "math",
    title: "Math",
    breakAfterSeconds: 0,
    modules: [
      {
        key: "math-m1",
        title: "Module 1",
        durationSeconds: 2100,
        questionCount: 22,
        pretestCount: 2,
        adaptiveRole: "base",
        tools: ["calculator", "reference_sheet"],
      },
      {
        key: "math-m2-lower",
        title: "Module 2 — Lower",
        durationSeconds: 2100,
        questionCount: 22,
        pretestCount: 2,
        adaptiveRole: "lower_branch",
        tools: ["calculator", "reference_sheet"],
      },
      {
        key: "math-m2-higher",
        title: "Module 2 — Higher",
        durationSeconds: 2100,
        questionCount: 22,
        pretestCount: 2,
        adaptiveRole: "higher_branch",
        tools: ["calculator", "reference_sheet"],
      },
    ],
  },
];

function richNodeHasContent(node: import("../../contracts/assessment").RichTextNode): boolean {
  if (node.type === "image") return true;
  if (node.type === "inlineMath" || node.type === "blockMath") {
    return typeof node.attrs?.["latex"] === "string" && node.attrs["latex"].trim().length > 0;
  }
  if (node.type === "text") return Boolean(node.text?.trim());
  return (node.content ?? []).some(richNodeHasContent);
}

function hasContent(content: StructuredContent | null | undefined): boolean {
  if (!content) return false;
  if (content.document?.type === "doc") {
    return (content.document.content ?? []).some(richNodeHasContent);
  }
  return content.nodes.some((node) => {
    if (node.type === "image") return true;
    if (node.type === "table")
      return node.rows.some((row) => row.some((cell) => cell.trim().length > 0));
    return "text" in node ? node.text.trim().length > 0 : node.latex.trim().length > 0;
  });
}

function validateRichDocument(
  node: import("../../contracts/assessment").RichTextNode,
  path: string,
  issues: AssessmentValidationIssue[]
): void {
  if (node.type === "image") {
    const alt = typeof node.attrs?.["alt"] === "string" ? node.attrs["alt"] : "";
    const assetId = typeof node.attrs?.["assetId"] === "string" ? node.attrs["assetId"] : "";
    const src = typeof node.attrs?.["src"] === "string" ? node.attrs["src"] : "";
    if (!assetId.trim() && !src.trim()) {
      issues.push({
        code: "sat.media.source.required",
        path: `${path}.attrs.assetId`,
        message: "Images require an uploaded asset or source URL.",
        blocking: true,
      });
    }
    if (!alt.trim()) {
      issues.push({
        code: "sat.accessibility.alt.required",
        path: `${path}.attrs.alt`,
        message: "Images require alternative text.",
        blocking: true,
      });
    }
  }
  (node.content ?? []).forEach((child, index) =>
    validateRichDocument(child, `${path}.content.${index}`, issues)
  );
}

function validateContent(
  content: StructuredContent | null | undefined,
  path: string,
): AssessmentValidationIssue[] {
  const issues = (content?.nodes ?? []).flatMap((node: ContentNode, index) => {
    if (node.type !== "image") return [];
    const nodeIssues: AssessmentValidationIssue[] = [];
    if (!node.assetId.trim()) {
      nodeIssues.push({
        code: "sat.media.source.required",
        path: `${path}.nodes.${index}.assetId`,
        message: "Images require an uploaded asset or source URL.",
        blocking: true,
      });
    }
    if (!node.alt.trim()) {
      nodeIssues.push({
        code: "sat.accessibility.alt.required",
        path: `${path}.nodes.${index}.alt`,
        message: "Images require alternative text.",
        blocking: true,
      });
    }
    return nodeIssues;
  });
  (content?.document?.content ?? []).forEach((node, index) =>
    validateRichDocument(node, `${path}.document.content.${index}`, issues)
  );
  return issues;
}

export function validateSatQuestion(
  sectionKey: string,
  question: QuestionRevision
): AssessmentValidationIssue[] {
  const issues: AssessmentValidationIssue[] = [];
  if (!hasContent(question.prompt)) {
    issues.push({
      code: "question.prompt.required",
      path: "prompt",
      message: "Question text is required.",
      blocking: true,
    });
  }
  issues.push(
    ...validateContent(question.stimulus, "stimulus"),
    ...validateContent(question.prompt, "prompt"),
    ...validateContent(question.rationale, "rationale")
  );
  if (question.metadata.sectionKey !== sectionKey) {
    issues.push({
      code: "sat.metadata.section.required",
      path: "metadata.sectionKey",
      message: "Question metadata must match its assessment section.",
      blocking: true,
    });
  }
  if (!question.metadata.domain?.trim()) {
    issues.push({
      code: "sat.metadata.domain.required",
      path: "metadata.domain",
      message: "Choose the SAT domain for this question.",
      blocking: true,
    });
  } else if (!isSatDomain(sectionKey, question.metadata.domain)) {
    issues.push({
      code: "sat.metadata.domain.invalid",
      path: "metadata.domain",
      message: "Choose a valid SAT domain for this section.",
      blocking: true,
    });
  }
  if (!question.metadata.skill?.trim()) {
    issues.push({
      code: "sat.metadata.skill.required",
      path: "metadata.skill",
      message: "Choose the SAT skill for this question.",
      blocking: true,
    });
  } else if (!isSatSkill(question.metadata.domain, question.metadata.skill)) {
    issues.push({
      code: "sat.metadata.skill.invalid",
      path: "metadata.skill",
      message: "Choose a skill that belongs to the selected SAT domain.",
      blocking: true,
    });
  }

  const answer = question.answer;
  if (question.questionType !== answer.kind) {
    issues.push({
      code: "sat.answer.kind_mismatch",
      path: "answer.kind",
      message: "The answer definition must match the question type.",
      blocking: true,
    });
  }
  if (answer.kind === "single_choice") {
    if (answer.options.length !== 4) {
      issues.push({
        code: "sat.choice.count",
        path: "answer.options",
        message: "SAT multiple-choice questions require four answer choices.",
        blocking: true,
      });
    }
    if (!answer.correctOptionId) {
      issues.push({
        code: "sat.correct_answer.required",
        path: "answer.correctOptionId",
        message: "Select the correct answer.",
        blocking: true,
      });
    } else if (!answer.options.some((option) => option.id === answer.correctOptionId)) {
      issues.push({
        code: "sat.correct_answer.invalid",
        path: "answer.correctOptionId",
        message: "The correct answer must reference one of the answer choices.",
        blocking: true,
      });
    }
    answer.options.forEach((option, index) => {
      issues.push(...validateContent(option.content, `answer.options.${index}.content`));
      if (!hasContent(option.content)) {
        issues.push({
          code: "sat.choice.content.required",
          path: `answer.options.${index}.content`,
          message: "Answer choice content is required.",
          blocking: true,
        });
      }
    });
  } else {
    if (sectionKey !== "math") {
      issues.push({
        code: "sat.spr.math_only",
        path: "questionType",
        message: "Student-produced response is only supported in Math.",
        blocking: true,
      });
    }
    const nonEmptyResponses = answer.acceptedResponses
      .map((response, index) => ({ response, index }))
      .filter(({ response }) => response.trim().length > 0);
    if (nonEmptyResponses.length === 0) {
      issues.push({
        code: "sat.spr.answer.required",
        path: "answer.acceptedResponses",
        message: "At least one accepted response is required.",
        blocking: true,
      });
    } else if (!answer.acceptedResponses[0]?.trim()) {
      issues.push({
        code: "sat.spr.primary.required",
        path: "answer.acceptedResponses.0",
        message: "Enter a primary SAT response before adding equivalents.",
        blocking: true,
      });
    }
    nonEmptyResponses.forEach(({ response, index }) => {
      const validation = validateSatStudentResponse(response);
      if (!validation.valid) {
        issues.push({
          code: `sat.spr.${validation.code}`,
          path: `answer.acceptedResponses.${index}`,
          message: validation.message,
          blocking: true,
        });
      }
    });
  }
  if (sectionKey === "reading-writing" && question.questionType !== "single_choice") {
    issues.push({
      code: "sat.rw.question_type",
      path: "questionType",
      message: "Reading & Writing questions must be multiple choice.",
      blocking: true,
    });
  }
  return issues;
}
