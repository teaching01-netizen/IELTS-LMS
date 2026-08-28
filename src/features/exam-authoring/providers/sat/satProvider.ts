import type {
  AssessmentValidationIssue,
  ContentNode,
  QuestionRevision,
  StructuredContent,
} from '../../contracts/assessment';
import { isSatDomain } from './taxonomy';

export interface SatBlueprintModule {
  key: string;
  title: string;
  durationSeconds: number;
  questionCount: number;
  pretestCount: number;
  adaptiveRole: 'base' | 'lower_branch' | 'higher_branch';
  tools: Array<'calculator' | 'reference_sheet'>;
}

export interface SatBlueprintSection {
  key: 'reading-writing' | 'math';
  title: string;
  breakAfterSeconds: number;
  modules: SatBlueprintModule[];
}

export const SAT_BLUEPRINT: SatBlueprintSection[] = [
  {
    key: 'reading-writing',
    title: 'Reading & Writing',
    breakAfterSeconds: 600,
    modules: [
      { key: 'rw-m1', title: 'Module 1', durationSeconds: 1920, questionCount: 27, pretestCount: 2, adaptiveRole: 'base', tools: [] },
      { key: 'rw-m2-lower', title: 'Module 2 — Lower', durationSeconds: 1920, questionCount: 27, pretestCount: 2, adaptiveRole: 'lower_branch', tools: [] },
      { key: 'rw-m2-higher', title: 'Module 2 — Higher', durationSeconds: 1920, questionCount: 27, pretestCount: 2, adaptiveRole: 'higher_branch', tools: [] },
    ],
  },
  {
    key: 'math',
    title: 'Math',
    breakAfterSeconds: 0,
    modules: [
      { key: 'math-m1', title: 'Module 1', durationSeconds: 2100, questionCount: 22, pretestCount: 2, adaptiveRole: 'base', tools: ['calculator', 'reference_sheet'] },
      { key: 'math-m2-lower', title: 'Module 2 — Lower', durationSeconds: 2100, questionCount: 22, pretestCount: 2, adaptiveRole: 'lower_branch', tools: ['calculator', 'reference_sheet'] },
      { key: 'math-m2-higher', title: 'Module 2 — Higher', durationSeconds: 2100, questionCount: 22, pretestCount: 2, adaptiveRole: 'higher_branch', tools: ['calculator', 'reference_sheet'] },
    ],
  },
];

function hasContent(content: StructuredContent): boolean {
  return content.nodes.some((node) => {
    if (node.type === 'image') return node.alt.trim().length > 0;
    if (node.type === 'table') return node.rows.some((row) => row.some((cell) => cell.trim().length > 0));
    return 'text' in node ? node.text.trim().length > 0 : node.latex.trim().length > 0;
  });
}

function validateContent(content: StructuredContent, path: string): AssessmentValidationIssue[] {
  return content.nodes.flatMap((node: ContentNode, index) => {
    if (node.type === 'image' && node.alt.trim().length === 0) {
      return [{ code: 'sat.accessibility.alt.required', path: `${path}.nodes.${index}.alt`, message: 'Images require alternative text.', blocking: true }];
    }
    return [];
  });
}

export function validateSatQuestion(
  sectionKey: string,
  question: QuestionRevision,
): AssessmentValidationIssue[] {
  const issues: AssessmentValidationIssue[] = [];
  if (!hasContent(question.prompt)) {
    issues.push({ code: 'question.prompt.required', path: 'prompt', message: 'Question text is required.', blocking: true });
  }
  issues.push(...validateContent(question.stimulus, 'stimulus'), ...validateContent(question.prompt, 'prompt'), ...validateContent(question.rationale, 'rationale'));
  if (question.metadata.sectionKey !== sectionKey) {
    issues.push({ code: 'sat.metadata.section.required', path: 'metadata.sectionKey', message: 'Question metadata must match its assessment section.', blocking: true });
  }
  if (question.metadata.domain && !isSatDomain(sectionKey, question.metadata.domain)) {
    issues.push({ code: 'sat.metadata.domain.invalid', path: 'metadata.domain', message: 'Choose a valid SAT domain for this section.', blocking: true });
  }
  if (sectionKey === 'reading-writing' && question.questionType !== 'single_choice') {
    issues.push({ code: 'sat.rw.question_type', path: 'questionType', message: 'Reading & Writing questions must be multiple choice.', blocking: true });
  }
  const answer = question.answer;
  if (answer.kind === 'single_choice') {
    if (answer.options.length !== 4) {
      issues.push({ code: 'sat.choice.count', path: 'answer.options', message: 'SAT multiple-choice questions require four answer choices.', blocking: true });
    }
    if (!answer.correctOptionId || !answer.options.some((option) => option.id === answer.correctOptionId)) {
      issues.push({ code: 'sat.correct_answer.required', path: 'answer.correctOptionId', message: 'Select a correct answer choice.', blocking: true });
    }
  } else {
    if (sectionKey !== 'math') {
      issues.push({ code: 'sat.spr.math_only', path: 'questionType', message: 'Student-produced response is only supported in Math.', blocking: true });
    }
    if (answer.acceptedResponses.every((response) => response.trim().length === 0)) {
      issues.push({ code: 'sat.spr.answer.required', path: 'answer.acceptedResponses', message: 'At least one accepted response is required.', blocking: true });
    }
  }
  return issues;
}
