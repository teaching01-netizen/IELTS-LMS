import { getStudentQuestionsForModule } from '../services/examAdapterService';
import type { ExamState, QuestionBlock, TableCompletionBlock } from '../types';

export type ExamIntegrityIssue = {
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

function formatExamples(values: string[], limit = 5): string {
  return values.slice(0, limit).join(', ');
}

function findDuplicateValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  const duplicates = new Map<string, number>();
  counts.forEach((count, value) => {
    if (count > 1) {
      duplicates.set(value, count);
    }
  });

  return duplicates;
}

function collectEnabledDescriptors(state: ExamState) {
  const descriptors = [];

  if (state.config.sections.reading.enabled) {
    descriptors.push(...getStudentQuestionsForModule(state, 'reading'));
  }

  if (state.config.sections.listening.enabled) {
    descriptors.push(...getStudentQuestionsForModule(state, 'listening'));
  }

  return descriptors;
}

function collectEnabledBlocks(state: ExamState): QuestionBlock[] {
  const blocks: QuestionBlock[] = [];

  if (state.config.sections.reading.enabled) {
    state.reading.passages.forEach((passage) => {
      passage.blocks.forEach((block) => blocks.push(block));
    });
  }

  if (state.config.sections.listening.enabled) {
    state.listening.parts.forEach((part) => {
      part.blocks.forEach((block) => blocks.push(block));
    });
  }

  return blocks;
}

export function getExamIdCollisionIssues(state: ExamState): ExamIntegrityIssue[] {
  const issues: ExamIntegrityIssue[] = [];

  const passageIds = state.config.sections.reading.enabled
    ? state.reading.passages.map((passage) => passage.id)
    : [];
  const passageDuplicates = findDuplicateValues(passageIds);
  if (passageDuplicates.size > 0) {
    issues.push({
      field: 'integrity.duplicate_passage_ids',
      severity: 'error',
      message: `Duplicate reading passage IDs detected: ${formatExamples(Array.from(passageDuplicates.keys()))}.`,
    });
  }

  const listeningPartIds = state.config.sections.listening.enabled
    ? state.listening.parts.map((part) => part.id)
    : [];
  const partDuplicates = findDuplicateValues(listeningPartIds);
  if (partDuplicates.size > 0) {
    issues.push({
      field: 'integrity.duplicate_listening_part_ids',
      severity: 'error',
      message: `Duplicate listening part IDs detected: ${formatExamples(Array.from(partDuplicates.keys()))}.`,
    });
  }

  const blockIds: string[] = [];
  if (state.config.sections.reading.enabled) {
    state.reading.passages.forEach((passage) => {
      passage.blocks.forEach((block) => blockIds.push(block.id));
    });
  }

  if (state.config.sections.listening.enabled) {
    state.listening.parts.forEach((part) => {
      part.blocks.forEach((block) => blockIds.push(block.id));
    });
  }

  const blockDuplicates = findDuplicateValues(blockIds);
  if (blockDuplicates.size > 0) {
    issues.push({
      field: 'integrity.duplicate_block_ids',
      severity: 'error',
      message:
        `Duplicate question-block IDs detected (will break navigation/answers): ` +
        `${formatExamples(Array.from(blockDuplicates.keys()))}.`,
    });
  }

  const descriptors = collectEnabledDescriptors(state);

  const descriptorIds = descriptors.map((descriptor) => descriptor.id);
  const descriptorDuplicates = findDuplicateValues(descriptorIds);
  if (descriptorDuplicates.size > 0) {
    issues.push({
      field: 'integrity.duplicate_question_slot_ids',
      severity: 'error',
      message:
        `Duplicate student question-slot IDs detected: ${formatExamples(Array.from(descriptorDuplicates.keys()))}.`,
    });
  }

  const scalarAnswerKeyCounts = new Map<string, number>();
  const indexedKeyCounts = new Map<string, number>();
  const hasScalar = new Set<string>();
  const hasIndexed = new Set<string>();

  descriptors.forEach((descriptor) => {
    const answerKey = descriptor.answerKey;
    if (descriptor.answerIndex === undefined) {
      hasScalar.add(answerKey);
      scalarAnswerKeyCounts.set(answerKey, (scalarAnswerKeyCounts.get(answerKey) ?? 0) + 1);
      return;
    }

    hasIndexed.add(answerKey);
    const tupleKey = `${answerKey}::${descriptor.answerIndex}`;
    indexedKeyCounts.set(tupleKey, (indexedKeyCounts.get(tupleKey) ?? 0) + 1);
  });

  const scalarCollisions = Array.from(scalarAnswerKeyCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  if (scalarCollisions.length > 0) {
    issues.push({
      field: 'integrity.answer_key_scalar_collision',
      severity: 'error',
      message:
        `Duplicate answer keys detected (will overwrite student answers): ` +
        `${formatExamples(scalarCollisions)}.`,
    });
  }

  const indexedCollisions = Array.from(indexedKeyCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  if (indexedCollisions.length > 0) {
    issues.push({
      field: 'integrity.answer_key_index_collision',
      severity: 'error',
      message:
        `Duplicate answer slots detected (same answerKey + index used twice): ` +
        `${formatExamples(indexedCollisions)}.`,
    });
  }

  const mixedAnswerKeys = Array.from(hasScalar).filter((key) => hasIndexed.has(key));
  if (mixedAnswerKeys.length > 0) {
    issues.push({
      field: 'integrity.answer_key_mixed_shape',
      severity: 'error',
      message:
        `Answer keys used by both single-slot and multi-slot questions detected: ` +
        `${formatExamples(mixedAnswerKeys)}.`,
    });
  }

  const tableCellIdCollisions: string[] = [];
  const tableCellIdMissing: string[] = [];

  collectEnabledBlocks(state).forEach((block) => {
    if (block.type !== 'TABLE_COMPLETION') return;

    const tableBlock = block as TableCompletionBlock;
    const idCounts = new Map<string, number>();
    let missingCount = 0;

    tableBlock.cells.forEach((cell) => {
      const id = typeof cell.id === 'string' ? cell.id.trim() : '';
      if (!id) {
        missingCount += 1;
        return;
      }

      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    });

    const duplicateIds = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id);

    if (duplicateIds.length > 0) {
      tableCellIdCollisions.push(`${tableBlock.id} (${formatExamples(duplicateIds, 3)})`);
    }

    if (missingCount > 0) {
      tableCellIdMissing.push(`${tableBlock.id} (${missingCount} missing)`);
    }
  });

  if (tableCellIdCollisions.length > 0) {
    issues.push({
      field: 'integrity.table_cell_id_collision',
      severity: 'warning',
      message:
        'Duplicate table cell IDs detected (can link answer editing across blanks): ' +
        `${formatExamples(tableCellIdCollisions)}.`,
    });
  }

  if (tableCellIdMissing.length > 0) {
    issues.push({
      field: 'integrity.table_cell_id_missing',
      severity: 'warning',
      message:
        'Missing table cell IDs detected (auto-heal recommended): ' +
        `${formatExamples(tableCellIdMissing)}.`,
    });
  }

  return issues;
}
