import type {
  Exam,
  ExamState,
  ListeningPart,
  Passage,
  QuestionBlock,
  MCQOption,
  MatchingBlock,
  WritingTaskContent,
} from '../types';
import { resolveAcceptedAnswers } from './acceptedAnswers';
import { htmlToPlainText } from './htmlText';
import { getCanonicalTableCells } from './tableCompletion';

const EXAM_SEPARATOR = '='.repeat(92);
const SUBSECTION_SEPARATOR = '-'.repeat(68);

interface QuestionRenderContext {
  lines: string[];
  answerKey: Array<{ numberLabel: string; answer: string }>;
  nextQuestionNumber: number;
}

function toPlainText(value: string | undefined | null): string {
  if (!value) {
    return '';
  }
  return htmlToPlainText(value);
}

function isNonEmptyText(value: string | undefined | null): value is string {
  return Boolean(value && value.trim());
}

function pushMultiline(lines: string[], prefix: string, value: string): void {
  const normalized = toPlainText(value);
  if (!normalized) {
    return;
  }

  const chunks = normalized.split('\n');
  chunks.forEach((line) => {
    lines.push(`${prefix}${line}`);
  });
}

function formatQuestionNumberLabel(start: number, slots: number): string {
  if (slots <= 1) {
    return `${start}`;
  }
  return `${start}-${start + slots - 1}`;
}

function questionPrefix(numberLabel: string): string {
  return `Q${numberLabel}.`;
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatOptionWithLetter(option: MCQOption, index: number): string {
  return `${optionLetter(index)}. ${toPlainText(option.text)}`;
}

function mapMatchingHeadingDisplay(block: MatchingBlock, headingId: string): string {
  const matching = block.headings.find((heading) => heading.id === headingId);
  if (!matching) {
    return headingId;
  }

  const text = toPlainText(matching.text);
  return text ? `${matching.id}. ${text}` : matching.id;
}

function buildMcqAnswerDisplay(options: MCQOption[], answerIds: string[]): string {
  const indexed = options.map((option, index) => ({
    id: option.id,
    display: formatOptionWithLetter(option, index),
  }));

  return answerIds
    .map((id) => indexed.find((entry) => entry.id === id)?.display ?? id)
    .join(' | ');
}

function pushQuestion(
  context: QuestionRenderContext,
  questionBody: string,
  answer: string,
  slotCount = 1,
): void {
  const numberLabel = formatQuestionNumberLabel(context.nextQuestionNumber, slotCount);
  context.lines.push(`${questionPrefix(numberLabel)} ${questionBody}`.trimEnd());
  context.lines.push(`Answer: ${answer || '(none)'}`);
  context.lines.push('');
  context.answerKey.push({ numberLabel, answer: answer || '(none)' });
  context.nextQuestionNumber += Math.max(1, slotCount);
}

function renderBlock(
  block: QuestionBlock,
  context: QuestionRenderContext,
  blockTitle: string,
): void {
  context.lines.push(`${blockTitle} (${block.type})`);
  const instruction = toPlainText(block.instruction);
  if (instruction) {
    context.lines.push(`Instruction: ${instruction}`);
  }

  switch (block.type) {
    case 'TFNG': {
      block.questions.forEach((question) => {
        const body = toPlainText(question.statement) || '(empty statement)';
        pushQuestion(context, body, question.correctAnswer);
      });
      break;
    }
    case 'CLOZE': {
      block.questions.forEach((question) => {
        const body = toPlainText(question.prompt) || '(empty prompt)';
        const answer = resolveAcceptedAnswers(question).join(' | ');
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'MATCHING': {
      if (block.headings.length > 0) {
        context.lines.push('Choices:');
        block.headings.forEach((heading) => {
          const headingText = toPlainText(heading.text);
          context.lines.push(
            `  - ${heading.id}${headingText ? `. ${headingText}` : ''}`,
          );
        });
      }
      block.questions.forEach((question) => {
        const body = `Paragraph ${toPlainText(question.paragraphLabel) || question.id}`;
        const answer = mapMatchingHeadingDisplay(block, question.correctHeading);
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'MAP': {
      block.questions.forEach((question) => {
        const label = toPlainText(question.label) || question.id;
        const body = `${label} (x:${question.x}, y:${question.y})`;
        const answer = toPlainText(question.correctAnswer);
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'MULTI_MCQ': {
      context.lines.push(`Stem: ${toPlainText(block.stem)}`);
      context.lines.push(`Required selections: ${block.requiredSelections}`);
      block.options.forEach((option, index) => {
        context.lines.push(`  ${formatOptionWithLetter(option, index)}`);
      });
      const answerIds = block.options
        .filter((option) => option.isCorrect)
        .map((option) => option.id);
      const answer = buildMcqAnswerDisplay(block.options, answerIds);
      const slots = Number.isFinite(block.requiredSelections)
        ? Math.max(1, Math.floor(block.requiredSelections))
        : 1;
      pushQuestion(context, toPlainText(block.stem), answer, slots);
      break;
    }
    case 'SINGLE_MCQ': {
      context.lines.push(`Stem: ${toPlainText(block.stem)}`);
      block.options.forEach((option, index) => {
        context.lines.push(`  ${formatOptionWithLetter(option, index)}`);
      });
      const correctOption = block.options.find((option) => option.isCorrect);
      const answer = correctOption
        ? buildMcqAnswerDisplay(block.options, [correctOption.id])
        : '';
      pushQuestion(context, toPlainText(block.stem), answer);
      break;
    }
    case 'SHORT_ANSWER': {
      block.questions.forEach((question) => {
        const body = toPlainText(question.prompt) || '(empty prompt)';
        const answer = resolveAcceptedAnswers(question).join(' | ');
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'SENTENCE_COMPLETION': {
      block.questions.forEach((question) => {
        const sentence = toPlainText(question.sentence) || '(empty sentence)';
        question.blanks.forEach((blank, blankIndex) => {
          const body = `${sentence} [Blank ${blankIndex + 1}]`;
          const answer = resolveAcceptedAnswers(blank).join(' | ');
          pushQuestion(context, body, answer);
        });
      });
      break;
    }
    case 'DIAGRAM_LABELING': {
      const image = toPlainText(block.imageUrl);
      if (image) {
        context.lines.push(`Diagram image: ${image}`);
      }
      block.labels.forEach((label, labelIndex) => {
        const body = toPlainText(label.prompt) || `Label ${labelIndex + 1}`;
        const answer = toPlainText(label.correctAnswer);
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'FLOW_CHART': {
      block.steps.forEach((step, stepIndex) => {
        const label = toPlainText(step.label) || `Step ${stepIndex + 1}`;
        const answer = toPlainText(step.correctAnswer);
        pushQuestion(context, label, answer);
      });
      break;
    }
    case 'TABLE_COMPLETION': {
      if (block.headers.length > 0) {
        context.lines.push(`Headers: ${block.headers.map((header) => toPlainText(header)).join(' | ')}`);
      }
      block.rows.forEach((row, rowIndex) => {
        const normalizedRow = row.map((cell) => toPlainText(cell)).join(' | ');
        context.lines.push(`Row ${rowIndex + 1}: ${normalizedRow}`);
      });
      getCanonicalTableCells(block).forEach((cell) => {
        const body = `Cell row ${cell.row + 1}, col ${cell.col + 1}`;
        const answer = resolveAcceptedAnswers(cell).join(' | ');
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'NOTE_COMPLETION': {
      block.questions.forEach((question, questionIndex) => {
        const noteText = toPlainText(question.noteText);
        if (noteText) {
          context.lines.push(`Note ${questionIndex + 1}:`);
          pushMultiline(context.lines, '  ', noteText);
        }
        question.blanks.forEach((blank, blankIndex) => {
          const body = `Note ${questionIndex + 1} blank ${blankIndex + 1}`;
          const answer = resolveAcceptedAnswers(blank).join(' | ');
          pushQuestion(context, body, answer);
        });
      });
      break;
    }
    case 'CLASSIFICATION': {
      if (block.categories.length > 0) {
        context.lines.push(
          `Categories: ${block.categories.map((category) => toPlainText(category)).join(' | ')}`,
        );
      }
      block.items.forEach((item) => {
        const body = toPlainText(item.text) || item.id;
        const answer = toPlainText(item.correctCategory);
        pushQuestion(context, body, answer);
      });
      break;
    }
    case 'MATCHING_FEATURES': {
      if (block.options.length > 0) {
        context.lines.push(
          `Options: ${block.options.map((option) => toPlainText(option)).join(' | ')}`,
        );
      }
      block.features.forEach((feature) => {
        const body = toPlainText(feature.text) || feature.id;
        const answer = toPlainText(feature.correctMatch);
        pushQuestion(context, body, answer);
      });
      break;
    }
  }
}

function renderObjectiveModule(
  moduleLabel: 'Reading' | 'Listening',
  groups: Passage[] | ListeningPart[],
): string[] {
  const context: QuestionRenderContext = {
    lines: [],
    answerKey: [],
    nextQuestionNumber: 1,
  };

  context.lines.push(`[${moduleLabel.toUpperCase()}]`);
  context.lines.push('');

  groups.forEach((group, groupIndex) => {
    const labelPrefix = moduleLabel === 'Reading' ? 'Passage' : 'Part';
    const groupTitle = toPlainText(group.title) || `${labelPrefix} ${groupIndex + 1}`;
    context.lines.push(`${labelPrefix} ${groupIndex + 1}: ${groupTitle}`);

    if ('content' in group && isNonEmptyText(group.content)) {
      context.lines.push('Content:');
      pushMultiline(context.lines, '  ', group.content);
    }

    if ('audioUrl' in group && isNonEmptyText(group.audioUrl)) {
      context.lines.push(`Audio: ${toPlainText(group.audioUrl)}`);
    }

    context.lines.push(SUBSECTION_SEPARATOR);

    group.blocks.forEach((block, blockIndex) => {
      renderBlock(block, context, `Block ${blockIndex + 1}`);
    });
    context.lines.push('');
  });

  context.lines.push(`ANSWER KEY (${moduleLabel.toUpperCase()})`);
  if (context.answerKey.length === 0) {
    context.lines.push('(no objective questions)');
  } else {
    context.answerKey.forEach((entry) => {
      context.lines.push(`Q${entry.numberLabel} -> ${entry.answer}`);
    });
  }
  context.lines.push('');

  return context.lines;
}

function renderWritingModule(state: ExamState): string[] {
  const lines: string[] = ['[WRITING]', ''];
  const taskContent: WritingTaskContent[] = Array.isArray(state.writing.tasks)
    ? state.writing.tasks
    : [];

  if (taskContent.length > 0) {
    taskContent.forEach((task, index) => {
      lines.push(`Task ${index + 1}${task.taskId ? ` (${task.taskId})` : ''}`);
      if (task.prompt) {
        pushMultiline(lines, '  ', task.prompt);
      } else {
        lines.push('  (no prompt)');
      }
      lines.push('');
    });
  } else {
    lines.push('Task 1');
    if (state.writing.task1Prompt) {
      pushMultiline(lines, '  ', state.writing.task1Prompt);
    } else {
      lines.push('  (no prompt)');
    }
    lines.push('');
    lines.push('Task 2');
    if (state.writing.task2Prompt) {
      pushMultiline(lines, '  ', state.writing.task2Prompt);
    } else {
      lines.push('  (no prompt)');
    }
    lines.push('');
  }

  return lines;
}

function renderSpeakingModule(state: ExamState): string[] {
  const lines: string[] = ['[SPEAKING]', ''];

  lines.push('Part 1 Topics:');
  if (state.speaking.part1Topics.length === 0) {
    lines.push('  (none)');
  } else {
    state.speaking.part1Topics.forEach((topic, index) => {
      lines.push(`  ${index + 1}. ${toPlainText(topic)}`);
    });
  }
  lines.push('');

  lines.push('Cue Card:');
  if (state.speaking.cueCardDetails?.topic) {
    lines.push(`  Topic: ${toPlainText(state.speaking.cueCardDetails.topic)}`);
    state.speaking.cueCardDetails.bullets.forEach((bullet, index) => {
      lines.push(`  - ${index + 1}. ${toPlainText(bullet)}`);
    });
  } else if (state.speaking.cueCard) {
    pushMultiline(lines, '  ', state.speaking.cueCard);
  } else {
    lines.push('  (none)');
  }
  lines.push('');

  lines.push('Part 3 Discussion:');
  if (state.speaking.part3Discussion.length === 0) {
    lines.push('  (none)');
  } else {
    state.speaking.part3Discussion.forEach((prompt, index) => {
      lines.push(`  ${index + 1}. ${toPlainText(prompt)}`);
    });
  }
  lines.push('');

  return lines;
}

function buildExamHeader(exam: Exam, examIndex: number, total: number): string[] {
  return [
    EXAM_SEPARATOR,
    `EXAM ${examIndex + 1} OF ${total}`,
    `Title: ${toPlainText(exam.title)}`,
    `Exam ID: ${exam.id}`,
    `Type: ${exam.type}`,
    `Status: ${exam.status}`,
    `Owner: ${toPlainText(exam.author)}`,
    `Updated: ${exam.lastModified}`,
    EXAM_SEPARATOR,
    '',
  ];
}

export function buildExamTextExportFilename(exportedAt: Date = new Date()): string {
  const datePart = exportedAt.toISOString().split('T')[0];
  return `exam-export-${datePart}.txt`;
}

export function buildExamTextExport(
  exams: Exam[],
  exportedAt: Date = new Date(),
): string {
  const lines: string[] = [
    'IELTS EXAM TEXT EXPORT',
    `Generated At: ${exportedAt.toISOString()}`,
    `Total Exams: ${exams.length}`,
    '',
  ];

  exams.forEach((exam, index) => {
    lines.push(...buildExamHeader(exam, index, exams.length));
    const state = exam.content;
    const sections = state.config.sections;

    if (sections.reading.enabled) {
      lines.push(...renderObjectiveModule('Reading', state.reading.passages));
    }

    if (sections.listening.enabled) {
      lines.push(...renderObjectiveModule('Listening', state.listening.parts));
    }

    if (sections.writing.enabled) {
      lines.push(...renderWritingModule(state));
    }

    if (sections.speaking.enabled) {
      lines.push(...renderSpeakingModule(state));
    }
  });

  return lines.join('\n').trimEnd() + '\n';
}

export function downloadExamTextExport(
  content: string,
  exportedAt: Date = new Date(),
): string {
  const filename = buildExamTextExportFilename(exportedAt);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}
