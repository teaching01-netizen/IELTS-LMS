import type {
  ClassificationBlock,
  ExamState,
  ListeningPart,
  MatchingBlock,
  MatchingFeaturesBlock,
  ModuleType,
  MultiMCQBlock,
  Passage,
  QuestionBlock,
  SingleMCQBlock,
} from '../../../types';
import { buildAcceptedAnswerFields } from '../../../utils/acceptedAnswers';
import { setMultiSelectCorrectOptionIds } from '../../../utils/multiSelectMcq';
import { getQuestionNumberLabel, getStudentQuestionsForModule, type StudentQuestionDescriptor } from '../../exam-authoring/api/examAuthoringGateway';

type SubAnswerTreeNode = {
  id: string;
  acceptedAnswers?: string[] | undefined;
  children?: SubAnswerTreeNode[] | undefined;
};

export type AnswerKeyRow =
  | {
      rowId: string;
      moduleType: Extract<ModuleType, 'reading' | 'listening'>;
      groupId: string;
      groupLabel: string;
      blockId: string;
      blockType: QuestionBlock['type'];
      descriptorId: string;
      answerKey: string;
      answerIndex?: number | undefined;
      numberLabel: string;
      prompt: string;
      sortKey: string;
      jumpField: string;
    };

type BlockLocation = {
  moduleType: Extract<ModuleType, 'reading' | 'listening'>;
  sectionIndex: number;
  blockIndex: number;
};

function buildBlockLocationIndex(state: ExamState): Map<string, BlockLocation> {
  const map = new Map<string, BlockLocation>();

  state.reading.passages.forEach((passage, passageIndex) => {
    passage.blocks.forEach((block, blockIndex) => {
      map.set(block.id, { moduleType: 'reading', sectionIndex: passageIndex, blockIndex });
    });
  });

  state.listening.parts.forEach((part, partIndex) => {
    part.blocks.forEach((block, blockIndex) => {
      map.set(block.id, { moduleType: 'listening', sectionIndex: partIndex, blockIndex });
    });
  });

  return map;
}

function buildJumpField(location: BlockLocation): string {
  if (location.moduleType === 'reading') {
    return `content.reading.passages[${location.sectionIndex}].blocks[${location.blockIndex}]`;
  }
  return `content.listening.parts[${location.sectionIndex}].blocks[${location.blockIndex}]`;
}

function resolveGroupLabel(
  moduleType: Extract<ModuleType, 'reading' | 'listening'>,
  groupId: string,
  state: ExamState,
): string {
  if (moduleType === 'reading') {
    const passage = state.reading.passages.find((p) => p.id === groupId);
    return passage?.title ?? groupId;
  }
  const part = state.listening.parts.find((p) => p.id === groupId);
  return part?.title ?? groupId;
}

export function getDescriptorPrompt(descriptor: StudentQuestionDescriptor): string {
  const { block, question, answerIndex } = descriptor;
  switch (block.type) {
    case 'TFNG':
      return (question && 'statement' in question ? (question.statement ?? '') : '') || block.instruction || '';
    case 'CLOZE':
      return (question && 'prompt' in question ? (question.prompt ?? '') : '') || block.instruction || '';
    case 'MATCHING':
      return (question && 'paragraphLabel' in question ? (question.paragraphLabel ?? '') : '') || block.instruction || '';
    case 'MAP':
      return (question && 'label' in question ? (question.label ?? '') : '') || block.instruction || '';
    case 'SHORT_ANSWER':
      return (question && 'prompt' in question ? (question.prompt ?? '') : '') || block.instruction || '';
    case 'SENTENCE_COMPLETION': {
      if (question && 'sentence' in question) {
        const base = question.sentence ?? '';
        return typeof answerIndex === 'number' ? `${base} (blank ${answerIndex + 1})` : base;
      }
      return block.instruction || '';
    }
    case 'NOTE_COMPLETION': {
      if (question && 'noteText' in question) {
        const base = question.noteText ?? '';
        return typeof answerIndex === 'number' ? `Note (blank ${answerIndex + 1})` : base;
      }
      return block.instruction || '';
    }
    case 'MULTI_MCQ':
      return (block as MultiMCQBlock).stem || block.instruction || '';
    case 'SINGLE_MCQ': {
      if (question && 'stem' in question) {
        return question.stem || (block as SingleMCQBlock).stem || block.instruction || '';
      }
      const blockWithQuestions = block as SingleMCQBlock;
      if (Array.isArray(blockWithQuestions.questions) && blockWithQuestions.questions.length > 0) {
        const matched = blockWithQuestions.questions.find((candidate) => candidate.id === descriptor.answerKey);
        const fallback = matched ?? blockWithQuestions.questions[0];
        return fallback?.stem || blockWithQuestions.stem || block.instruction || '';
      }
      return (block as SingleMCQBlock).stem || block.instruction || '';
    }
    case 'DIAGRAM_LABELING':
      return typeof answerIndex === 'number' ? `Diagram label ${answerIndex + 1}` : block.instruction || '';
    case 'FLOW_CHART':
      return typeof answerIndex === 'number' ? `Flow step ${answerIndex + 1}` : block.instruction || '';
    case 'TABLE_COMPLETION':
      return typeof answerIndex === 'number' ? `Table cell ${answerIndex + 1}` : block.instruction || '';
    case 'CLASSIFICATION':
      return typeof answerIndex === 'number' ? `Classification item ${answerIndex + 1}` : block.instruction || '';
    case 'MATCHING_FEATURES':
      return typeof answerIndex === 'number' ? `Feature ${answerIndex + 1}` : block.instruction || '';
  }
}

export function buildAnswerKeyRows(state: ExamState): AnswerKeyRow[] {
  const locationIndex = buildBlockLocationIndex(state);
  const rows: AnswerKeyRow[] = [];

  (['reading', 'listening'] as const).forEach((moduleType) => {
    const descriptors = getStudentQuestionsForModule(state, moduleType);
    descriptors.forEach((descriptor) => {
      const location = locationIndex.get(descriptor.blockId);
      if (!location) {
        return;
      }

      const numberLabelRaw = getQuestionNumberLabel(descriptors, descriptor.id);
      const numberLabel = numberLabelRaw ? `Q${numberLabelRaw}` : descriptor.id;
      const prompt = getDescriptorPrompt(descriptor);
      const groupLabel = resolveGroupLabel(moduleType, descriptor.groupId, state);
      const jumpField = buildJumpField(location);
      const sortKey = `${moduleType}:${descriptor.rootNumber ?? 9999}:${numberLabelRaw || descriptor.id}:${descriptor.answerIndex ?? 0}`;

      rows.push({
        rowId: `${moduleType}:${descriptor.id}`,
        moduleType,
        groupId: descriptor.groupId,
        groupLabel,
        blockId: descriptor.blockId,
        blockType: descriptor.block.type,
        descriptorId: descriptor.id,
        answerKey: descriptor.answerKey,
        answerIndex: descriptor.answerIndex,
        numberLabel,
        prompt,
        sortKey,
        jumpField,
      });
    });
  });

  return rows;
}

export type AnswerKeyEdit =
  | { kind: 'set_tfng'; questionId: string; value: 'T' | 'F' | 'NG' | 'Y' | 'N' | 'NG' }
  | { kind: 'set_text_answer'; questionId: string; value: string }
  | { kind: 'set_accepted_answer_fields'; questionId: string; acceptedAnswers: string[] }
  | { kind: 'set_matching_heading'; questionId: string; headingId: string }
  | { kind: 'set_single_mcq_correct'; questionId: string; optionId: string }
  | { kind: 'set_multi_mcq_correct'; optionIds: string[] }
  | { kind: 'set_diagram_label_answer'; labelIndex: number; value: string }
  | { kind: 'set_flow_step_answer'; stepIndex: number; value: string }
  | { kind: 'set_table_cell_accepted_answer_fields'; cellIndex: number; acceptedAnswers: string[] }
  | { kind: 'set_note_blank_accepted_answer_fields'; questionId: string; blankIndex: number; acceptedAnswers: string[] }
  | { kind: 'set_sentence_blank_accepted_answer_fields'; questionId: string; blankIndex: number; acceptedAnswers: string[] }
  | { kind: 'set_classification_category'; itemIndex: number; category: string }
  | { kind: 'set_matching_feature_match'; featureIndex: number; match: string }
  | { kind: 'set_sub_answer_leaf_accepted_answers'; leafId: string; acceptedAnswers: string[] };

function updateReadingPassages(
  state: ExamState,
  updater: (passage: Passage, passageIndex: number) => Passage,
): ExamState {
  return {
    ...state,
    reading: {
      ...state.reading,
      passages: state.reading.passages.map(updater),
    },
  };
}

function updateListeningParts(
  state: ExamState,
  updater: (part: ListeningPart, partIndex: number) => ListeningPart,
): ExamState {
  return {
    ...state,
    listening: {
      ...state.listening,
      parts: state.listening.parts.map(updater),
    },
  };
}

function updateBlockInState(
  state: ExamState,
  location: BlockLocation,
  updateBlock: (block: QuestionBlock) => QuestionBlock,
): ExamState {
  if (location.moduleType === 'reading') {
    return updateReadingPassages(state, (passage, passageIndex) => {
      if (passageIndex !== location.sectionIndex) {
        return passage;
      }
      return {
        ...passage,
        blocks: passage.blocks.map((block, blockIndex) => (blockIndex === location.blockIndex ? updateBlock(block) : block)),
      };
    });
  }

  return updateListeningParts(state, (part, partIndex) => {
    if (partIndex !== location.sectionIndex) {
      return part;
    }
    return {
      ...part,
      blocks: part.blocks.map((block, blockIndex) => (blockIndex === location.blockIndex ? updateBlock(block) : block)),
    };
  });
}

function getSingleMcqQuestions(block: SingleMCQBlock): Array<{ id: string; stem: string; options: Array<{ id: string; text: string; isCorrect: boolean }> }> {
  if (Array.isArray(block.questions) && block.questions.length > 0) {
    return block.questions.map((q) => ({ id: q.id, stem: q.stem, options: q.options }));
  }
  return [{ id: block.id, stem: block.stem, options: block.options }];
}

function syncSingleMcqBlockFromQuestions(block: SingleMCQBlock, questions: Array<{ id: string; stem: string; options: Array<{ id: string; text: string; isCorrect: boolean }> }>): SingleMCQBlock {
  const first = questions[0];
  if (!first) {
    return block;
  }
  return {
    ...block,
    stem: first.stem,
    options: first.options,
    questions,
  };
}

function parseSubAnswerLeafId(leafId: string): { rootNodeId: string; nodeId: string } | null {
  // Pattern: `${blockId}::tree::${rootNodeId}::${nodeId}`
  const marker = '::tree::';
  const index = leafId.indexOf(marker);
  if (index < 0) {
    return null;
  }
  const tail = leafId.slice(index + marker.length);
  const [rootNodeId, nodeId] = tail.split('::');
  if (!rootNodeId || !nodeId) {
    return null;
  }
  return { rootNodeId, nodeId };
}

function updateSubAnswerTreeLeafAcceptedAnswers(
  roots: readonly SubAnswerTreeNode[] | undefined,
  leafId: string,
  acceptedAnswers: string[],
): SubAnswerTreeNode[] | undefined {
  if (!Array.isArray(roots) || roots.length === 0) {
    return roots as SubAnswerTreeNode[] | undefined;
  }

  const parsed = parseSubAnswerLeafId(leafId);
  if (!parsed) {
    return roots as SubAnswerTreeNode[] | undefined;
  }

  const visit = (node: SubAnswerTreeNode): SubAnswerTreeNode => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (node.id === parsed.nodeId) {
      return { ...node, acceptedAnswers };
    }
    if (children.length === 0) {
      return node;
    }
    return { ...node, children: children.map(visit) };
  };

  return roots.map((root) => {
    if (root.id !== parsed.rootNodeId) {
      return root;
    }
    return visit(root);
  });
}

export function applyAnswerKeyEdit(
  state: ExamState,
  row: AnswerKeyRow,
  edit: AnswerKeyEdit,
): ExamState {
  const locationIndex = buildBlockLocationIndex(state);
  const location = locationIndex.get(row.blockId);
  if (!location) {
    return state;
  }

  return updateBlockInState(state, location, (block) => {
    if (edit.kind === 'set_multi_mcq_correct') {
      if (block.type !== 'MULTI_MCQ') return block;
      return setMultiSelectCorrectOptionIds(block as MultiMCQBlock, edit.optionIds);
    }

    if (edit.kind === 'set_single_mcq_correct') {
      if (block.type !== 'SINGLE_MCQ') return block;
      const single = block as SingleMCQBlock;
      const questions = getSingleMcqQuestions(single).map((q) => {
        if (q.id !== edit.questionId) return q;
        return {
          ...q,
          options: q.options.map((opt) => ({ ...opt, isCorrect: opt.id === edit.optionId })),
        };
      });
      return syncSingleMcqBlockFromQuestions(single, questions);
    }

    if (edit.kind === 'set_matching_heading') {
      if (block.type !== 'MATCHING') return block;
      const match = block as MatchingBlock;
      return {
        ...match,
        questions: match.questions.map((q) => (q.id === edit.questionId ? { ...q, correctHeading: edit.headingId } : q)),
      };
    }

    if (edit.kind === 'set_tfng') {
      if (block.type !== 'TFNG') return block;
      return {
        ...block,
        questions: (block as any).questions.map((q: any) => (q.id === edit.questionId ? { ...q, correctAnswer: edit.value } : q)),
      };
    }

    if (edit.kind === 'set_text_answer') {
      if (block.type === 'CLOZE' || block.type === 'SHORT_ANSWER' || block.type === 'MAP') {
        const withQuestions = block as any;
        return {
          ...withQuestions,
          questions: withQuestions.questions.map((q: any) => (q.id === edit.questionId ? { ...q, correctAnswer: edit.value } : q)),
        };
      }
      return block;
    }

    if (edit.kind === 'set_accepted_answer_fields') {
      const fields = buildAcceptedAnswerFields(edit.acceptedAnswers);
      if (block.type === 'CLOZE' || block.type === 'SHORT_ANSWER') {
        const withQuestions = block as any;
        return {
          ...withQuestions,
          questions: withQuestions.questions.map((q: any) =>
            q.id === edit.questionId ? { ...q, ...fields } : q,
          ),
        };
      }
      return block;
    }

    if (edit.kind === 'set_diagram_label_answer') {
      if (block.type !== 'DIAGRAM_LABELING') return block;
      const next = { ...(block as any) };
      next.labels = Array.isArray(next.labels)
        ? next.labels.map((label: any, index: number) => (index === edit.labelIndex ? { ...label, correctAnswer: edit.value } : label))
        : [];
      return next;
    }

    if (edit.kind === 'set_flow_step_answer') {
      if (block.type !== 'FLOW_CHART') return block;
      const next = { ...(block as any) };
      next.steps = Array.isArray(next.steps)
        ? next.steps.map((step: any, index: number) => (index === edit.stepIndex ? { ...step, correctAnswer: edit.value } : step))
        : [];
      return next;
    }

    if (edit.kind === 'set_table_cell_accepted_answer_fields') {
      if (block.type !== 'TABLE_COMPLETION') return block;
      const fields = buildAcceptedAnswerFields(edit.acceptedAnswers);
      const next = { ...(block as any) };
      next.cells = Array.isArray(next.cells)
        ? next.cells.map((cell: any, index: number) => (index === edit.cellIndex ? { ...cell, ...fields } : cell))
        : [];
      return next;
    }

    if (edit.kind === 'set_sentence_blank_accepted_answer_fields') {
      if (block.type !== 'SENTENCE_COMPLETION') return block;
      const fields = buildAcceptedAnswerFields(edit.acceptedAnswers);
      const next = { ...(block as any) };
      next.questions = Array.isArray(next.questions)
        ? next.questions.map((q: any) => {
            if (q.id !== edit.questionId) return q;
            const blanks = Array.isArray(q.blanks) ? q.blanks : [];
            return {
              ...q,
              blanks: blanks.map((blank: any, index: number) => (index === edit.blankIndex ? { ...blank, ...fields } : blank)),
            };
          })
        : [];
      return next;
    }

    if (edit.kind === 'set_note_blank_accepted_answer_fields') {
      if (block.type !== 'NOTE_COMPLETION') return block;
      const fields = buildAcceptedAnswerFields(edit.acceptedAnswers);
      const next = { ...(block as any) };
      next.questions = Array.isArray(next.questions)
        ? next.questions.map((q: any) => {
            if (q.id !== edit.questionId) return q;
            const blanks = Array.isArray(q.blanks) ? q.blanks : [];
            return {
              ...q,
              blanks: blanks.map((blank: any, index: number) => (index === edit.blankIndex ? { ...blank, ...fields } : blank)),
            };
          })
        : [];
      return next;
    }

    if (edit.kind === 'set_classification_category') {
      if (block.type !== 'CLASSIFICATION') return block;
      const typed = block as ClassificationBlock;
      return {
        ...typed,
        items: typed.items.map((item, index) => (index === edit.itemIndex ? { ...item, correctCategory: edit.category } : item)),
      };
    }

    if (edit.kind === 'set_matching_feature_match') {
      if (block.type !== 'MATCHING_FEATURES') return block;
      const typed = block as MatchingFeaturesBlock;
      return {
        ...typed,
        features: typed.features.map((feature, index) => (index === edit.featureIndex ? { ...feature, correctMatch: edit.match } : feature)),
      };
    }

    if (edit.kind === 'set_sub_answer_leaf_accepted_answers') {
      if (!('answerTree' in block)) {
        return block;
      }
      const currentTree = (block as any).answerTree as SubAnswerTreeNode[] | undefined;
      const nextTree = updateSubAnswerTreeLeafAcceptedAnswers(currentTree, edit.leafId, edit.acceptedAnswers);
      return { ...(block as any), answerTree: nextTree };
    }

    return block;
  });
}
