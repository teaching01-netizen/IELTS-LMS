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
import { getInsertedImages, supportsInsertedImages } from './insertedImages';
import {
  enumerateBlockQuestionUnits,
  sentenceBlankGroupKey,
  tableCellGroupKey,
  type QuestionUnit,
} from './examUtils';

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
  if (supportsInsertedImages(block)) {
    const insertedImages = getInsertedImages(block);
    insertedImages.forEach((image, index) => {
      const url = toPlainText(image.url);
      const caption = toPlainText(image.caption);
      if (url) {
        context.lines.push(`Inserted image ${index + 1}: ${url}`);
      }
      if (caption) {
        context.lines.push(`Inserted image ${index + 1} caption: ${caption}`);
      }
    });
  }

  // Per-block context lines that are not tied to a single question unit.
  switch (block.type) {
    case 'MATCHING':
      if (block.headings.length > 0) {
        context.lines.push('Choices:');
        block.headings.forEach((heading) => {
          const headingText = toPlainText(heading.text);
          context.lines.push(
            `  - ${heading.id}${headingText ? `. ${headingText}` : ''}`,
          );
        });
      }
      break;
    case 'TABLE_COMPLETION':
      if (block.headers.length > 0) {
        context.lines.push(`Headers: ${block.headers.map((header) => toPlainText(header)).join(' | ')}`);
      }
      block.rows.forEach((row, rowIndex) => {
        const normalizedRow = row.map((cell) => toPlainText(cell)).join(' | ');
        context.lines.push(`Row ${rowIndex + 1}: ${normalizedRow}`);
      });
      break;
    case 'CLASSIFICATION':
      if (block.categories.length > 0) {
        context.lines.push(
          `Categories: ${block.categories.map((category) => toPlainText(category)).join(' | ')}`,
        );
      }
      break;
    case 'MATCHING_FEATURES':
      if (block.options.length > 0) {
        context.lines.push(
          `Options: ${block.options.map((option) => toPlainText(option)).join(' | ')}`,
        );
      }
      break;
    case 'NOTE_COMPLETION':
      block.questions.forEach((question, questionIndex) => {
        const noteText = toPlainText(question.noteText);
        if (noteText) {
          context.lines.push(`Note ${questionIndex + 1}:`);
          pushMultiline(context.lines, '  ', noteText);
        }
      });
      break;
    case 'DIAGRAM_LABELING': {
      const image = toPlainText(block.imageUrl);
      if (image) {
        context.lines.push(`Diagram image: ${image}`);
      }
      break;
    }
    default:
      break;
  }

  // The export is driven entirely by the same enumeration the canonical
  // question count uses, so a block can never render a different set of
  // questions than it reports.
  enumerateBlockQuestionUnits(block).forEach((unit) => {
    renderUnit(context, block, unit);
  });
}

function renderUnit(
  context: QuestionRenderContext,
  block: QuestionBlock,
  unit: QuestionUnit,
): void {
  switch (block.type) {
    case 'TFNG': {
      const question = block.questions.find((candidate) => candidate.id === unit.questionId);
      if (question) {
        pushQuestion(context, toPlainText(question.statement) || '(empty statement)', question.correctAnswer);
      }
      break;
    }
    case 'CLOZE': {
      const question = block.questions.find((candidate) => candidate.id === unit.questionId);
      if (question) {
        pushQuestion(context, toPlainText(question.prompt) || '(empty prompt)', resolveAcceptedAnswers(question).join(' | '));
      }
      break;
    }
    case 'MATCHING': {
      const question = block.questions.find((candidate) => candidate.id === unit.questionId);
      if (question) {
        pushQuestion(context, `Paragraph ${toPlainText(question.paragraphLabel) || question.id}`, mapMatchingHeadingDisplay(block, question.correctHeading));
      }
      break;
    }
    case 'MAP': {
      const question = block.questions.find((candidate) => candidate.id === unit.questionId);
      if (question) {
        pushQuestion(context, `${toPlainText(question.label) || question.id} (x:${question.x}, y:${question.y})`, toPlainText(question.correctAnswer));
      }
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
      const subQuestion = Array.isArray(block.questions)
        ? block.questions.find((candidate) => candidate.id === unit.questionId)
        : undefined;
      const stem = subQuestion?.stem || block.stem;
      const options = subQuestion && subQuestion.options.length > 0 ? subQuestion.options : block.options;
      context.lines.push(`Stem: ${toPlainText(stem)}`);
      options.forEach((option, index) => {
        context.lines.push(`  ${formatOptionWithLetter(option, index)}`);
      });
      const correctOption = options.find((option) => option.isCorrect);
      const answer = correctOption
        ? buildMcqAnswerDisplay(options, [correctOption.id])
        : '';
      pushQuestion(context, toPlainText(stem), answer);
      break;
    }
    case 'SHORT_ANSWER': {
      const question = block.questions.find((candidate) => candidate.id === unit.questionId);
      if (question) {
        pushQuestion(context, toPlainText(question.prompt) || '(empty prompt)', resolveAcceptedAnswers(question).join(' | '));
      }
      break;
    }
    case 'SENTENCE_COMPLETION': {
      for (const question of block.questions) {
        const blanks = question.blanks.filter(
          (blank) => sentenceBlankGroupKey(question.id, blank) === unit.questionId,
        );
        if (blanks.length > 0) {
          const sentence = toPlainText(question.sentence) || '(empty sentence)';
          const labels = blanks.map((blank) => `Blank ${(blank.position ?? 0) + 1}`).join(', ');
          const answer = blanks.map((blank) => resolveAcceptedAnswers(blank).join(' | ')).join(' | ');
          pushQuestion(context, `${sentence} [${labels}]`, answer);
          break;
        }
      }
      break;
    }
    case 'DIAGRAM_LABELING': {
      const label = block.labels.find((candidate) => candidate.id === unit.questionId);
      if (label) {
        pushQuestion(context, toPlainText(label.prompt) || 'Label', toPlainText(label.correctAnswer));
      }
      break;
    }
    case 'FLOW_CHART': {
      const step = block.steps.find((candidate) => candidate.id === unit.questionId);
      if (step) {
        pushQuestion(context, toPlainText(step.label) || 'Step', toPlainText(step.correctAnswer));
      }
      break;
    }
    case 'TABLE_COMPLETION': {
      const cell = block.cells.find(
        (candidate) => tableCellGroupKey(block.id, candidate) === unit.questionId,
      );
      if (cell) {
        pushQuestion(context, `Cell row ${cell.row + 1}, col ${cell.col + 1}`, resolveAcceptedAnswers(cell).join(' | '));
      }
      break;
    }
    case 'NOTE_COMPLETION': {
      for (let questionIndex = 0; questionIndex < block.questions.length; questionIndex += 1) {
        const question = block.questions[questionIndex];
        if (!question) continue;
        const blankIndex = question.blanks.findIndex((candidate) => candidate.id === unit.questionId);
        if (blankIndex >= 0) {
          const blank = question.blanks[blankIndex];
          if (blank) {
            pushQuestion(
              context,
              `Note ${questionIndex + 1} blank ${blankIndex + 1}`,
              resolveAcceptedAnswers(blank).join(' | '),
            );
          }
          break;
        }
      }
      break;
    }
    case 'CLASSIFICATION': {
      const item = block.items.find((candidate) => candidate.id === unit.questionId);
      if (item) {
        pushQuestion(context, toPlainText(item.text) || item.id, toPlainText(item.correctCategory));
      }
      break;
    }
    case 'MATCHING_FEATURES': {
      const feature = block.features.find((candidate) => candidate.id === unit.questionId);
      if (feature) {
        pushQuestion(context, toPlainText(feature.text) || feature.id, toPlainText(feature.correctMatch));
      }
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
