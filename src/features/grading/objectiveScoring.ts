import { getQuestionAnswer } from '../exam-authoring/api/examAuthoringGateway';
import type { StudentQuestionDescriptor } from '../exam-authoring/api/examAuthoringGateway';
import type { StudentAnswerValue } from '../../types/answers';
import type { SentenceCompletionQuestion } from '../../types';
import { answersMatchCaseExact, answersMatchForEntry, sanitizeAcceptedAnswers } from '../../utils/acceptedAnswers';
import { createSharedSentencePoolMatcher } from '../../utils/sentenceCompletionAnswerPool';
import { isSubAnswerLeafCorrect } from '../../utils/subAnswerTree';
import { getGroupedScoringSlotKey, resolveGroupedScoringRequiredCorrect } from '../../utils/gradingGroups';
import {
  formatAnswerValue,
  getEffectiveAcceptedAnswersForGrading,
  getMultiSelectAnswerScore,
  isCaseSensitiveDescriptor,
  isStudentAnswerCorrect,
} from '../../components/admin/gradingAnswerUtils';

export type ObjectiveScoreStatus =
  | 'verified_correct'
  | 'verified_incorrect'
  | 'verified_unanswered'
  | 'invalid';

export interface ObjectiveDescriptorScore {
  descriptorId: string;
  correctness: boolean | null;
  awardedScore: number | null;
  maxScore: number | null;
  status: ObjectiveScoreStatus;
  representative: boolean;
  groupKey: string | null;
}

export interface ObjectiveScoringResult {
  byId: Map<string, ObjectiveDescriptorScore>;
  totalScore: number;
  maxScore: number;
  percentage: number;
}

export interface ObjectiveScoringOverride {
  correctAnswer?: string | undefined;
  acceptedAnswers?: string[] | undefined;
  excludedAnswers?: string[] | undefined;
  correctOptionIds?: string[] | undefined;
  scoringRule?: string | undefined;
  maxScore?: number | undefined;
}

function overrideScore(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
  override: ObjectiveScoringOverride,
): { correctness: boolean | null; awardedScore: number | null; maxScore: number | null } {
  const optionIds = (override.correctOptionIds ?? []).filter(Boolean);
  const answer = getQuestionAnswer(descriptor, answerMap);
  const selected = Array.isArray(answer)
    ? answer.filter((entry): entry is string => typeof entry === 'string')
    : typeof answer === 'string' && answer !== ''
      ? [answer]
      : [];
  if (optionIds.length > 0) {
    const maxScore = override.maxScore && override.maxScore > 0 ? override.maxScore : optionIds.length;
    if (selected.length > optionIds.length) {
      return { correctness: false, awardedScore: 0, maxScore };
    }
    const correct = new Set(optionIds);
    const awarded = selected.filter((id) => correct.has(id)).length;
    return { correctness: awarded >= maxScore, awardedScore: awarded, maxScore };
  }

  const accepted = sanitizeAcceptedAnswers(
    override.acceptedAnswers && override.acceptedAnswers.length > 0
      ? override.acceptedAnswers
      : override.correctAnswer
        ? [override.correctAnswer]
        : [],
  );
  if (accepted.length === 0) {
    return { correctness: null, awardedScore: 0, maxScore: 1 };
  }
  const student = answerText(answer);
  const excluded = (override.excludedAnswers ?? []).some((value) => answersMatchCaseExact(student, value));
  const caseSensitive = isCaseSensitiveDescriptor(descriptor);
  const correctness = !excluded && accepted.some((value) => answersMatchForEntry(student, value, caseSensitive));
  const maxScore = override.maxScore && override.maxScore > 0 ? override.maxScore : 1;
  return { correctness, awardedScore: correctness ? maxScore : 0, maxScore };
}

function answerText(value: StudentAnswerValue | undefined): string {
  return formatAnswerValue(value);
}

function isAnswered(value: StudentAnswerValue | undefined): boolean {
  return answerText(value).trim() !== '';
}

/** Grouped scoring key: one question number and one mark per group. */
export function getScoringGroupKey(descriptor: StudentQuestionDescriptor): string | null {
  if (descriptor.isSubAnswerTreeLeaf) {
    return descriptor.rootId ?? null;
  }
  return getGroupedScoringSlotKey(descriptor);
}

function poolGroupKey(descriptor: StudentQuestionDescriptor): string | null {
  const { block } = descriptor;
  if (block.type !== 'SENTENCE_COMPLETION' && block.type !== 'NOTE_COMPLETION') return null;
  const question = descriptor.question;
  if (!question || !('blanks' in question)) return null;
  // Both completion types are pooled by the same Go grader branch; the
  // website must group them identically.
  return (question as SentenceCompletionQuestion).acceptAnyAnswerKey === true
    ? `pool:${question.id}`
    : null;
}

function treeGroupKey(descriptor: StudentQuestionDescriptor): string | null {
  return descriptor.isSubAnswerTreeLeaf ? descriptor.rootId ?? null : null;
}

function groupOverrideMax(
  descriptors: StudentQuestionDescriptor[],
  overrides: Record<string, ObjectiveScoringOverride> | undefined,
): number {
  let groupMax = 1;
  for (const descriptor of descriptors) {
    const maxScore = overrides?.[descriptor.id]?.maxScore;
    if (typeof maxScore === 'number' && maxScore > groupMax) {
      groupMax = maxScore;
    }
  }
  return groupMax;
}

function acceptedAnswersForGroupSlot(
  descriptor: StudentQuestionDescriptor,
  overrides: Record<string, ObjectiveScoringOverride> | undefined,
): string[] {
  const override = overrides?.[descriptor.id];
  if (override) {
    const accepted = sanitizeAcceptedAnswers(
      override.acceptedAnswers && override.acceptedAnswers.length > 0
        ? override.acceptedAnswers
        : override.correctAnswer
          ? [override.correctAnswer]
          : [],
    );
    if (accepted.length > 0) return accepted;
    if (override.correctOptionIds && override.correctOptionIds.length > 0) {
      return override.correctOptionIds;
    }
  }
  return getEffectiveAcceptedAnswersForGrading(descriptor);
}

function applyGroupRepresentative(
  descriptors: StudentQuestionDescriptor[],
  scores: Map<string, ObjectiveDescriptorScore>,
  individualCorrect: (descriptorId: string) => boolean,
  groupCorrect: boolean,
  anyAnswered: boolean,
  groupMax: number,
): void {
  descriptors.forEach((descriptor, position) => {
    const score = scores.get(descriptor.id);
    if (!score) return;
    score.correctness = individualCorrect(descriptor.id);
    score.awardedScore = 0;
    score.maxScore = 0;
    if (position === 0) {
      score.representative = true;
      score.correctness = groupCorrect;
      score.awardedScore = groupCorrect ? groupMax : 0;
      score.maxScore = groupMax;
      if (!anyAnswered) {
        score.status = 'verified_unanswered';
        return;
      }
    }
    score.status = score.correctness ? 'verified_correct' : 'verified_incorrect';
  });
}

function applyTreeMatching(
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  scores: Map<string, ObjectiveDescriptorScore>,
  overrides: Record<string, ObjectiveScoringOverride> | undefined,
): void {
  const required = descriptors.filter((descriptor) => descriptor.treeRequired !== false);
  const studentLeaves = descriptors.filter((descriptor) => isAnswered(getQuestionAnswer(descriptor, answerMap)));
  const candidates = new Map<string, string[]>();
  required.forEach((requiredLeaf) => {
    const accepted = acceptedAnswersForGroupSlot(requiredLeaf, overrides);
    const strict = isCaseSensitiveDescriptor(requiredLeaf);
    const allowed = studentLeaves
      .filter((studentLeaf) => isSubAnswerLeafCorrect(accepted, getQuestionAnswer(studentLeaf, answerMap), strict))
      .map((studentLeaf) => studentLeaf.id);
    candidates.set(requiredLeaf.id, allowed);
  });

  const studentToRequired = new Map<string, string>();
  const tryAssign = (requiredLeafId: string, seen: Set<string>): boolean => {
    for (const studentLeafId of candidates.get(requiredLeafId) ?? []) {
      if (seen.has(studentLeafId)) continue;
      seen.add(studentLeafId);
      const occupied = studentToRequired.get(studentLeafId);
      if (!occupied || tryAssign(occupied, seen)) {
        studentToRequired.set(studentLeafId, requiredLeafId);
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  required.forEach((requiredLeaf) => {
    if (tryAssign(requiredLeaf.id, new Set<string>())) matched += 1;
  });
  const assignedStudents = new Set(studentToRequired.keys());
  const groupCorrect = required.length === 0 || matched === required.length;
  applyGroupRepresentative(
    descriptors,
    scores,
    (descriptorId) => assignedStudents.has(descriptorId),
    groupCorrect,
    studentLeaves.length > 0,
    groupOverrideMax(descriptors, overrides),
  );
}

function applyRequiredGroup(
  descriptors: StudentQuestionDescriptor[],
  scores: Map<string, ObjectiveDescriptorScore>,
  overrides: Record<string, ObjectiveScoringOverride> | undefined,
): void {
  const requiredCorrect = resolveGroupedScoringRequiredCorrect(descriptors);
  const correctCount = descriptors.filter((descriptor) => scores.get(descriptor.id)?.correctness === true).length;
  const groupCorrect = correctCount >= requiredCorrect;
  const anyAnswered = descriptors.some((descriptor) => {
    const score = scores.get(descriptor.id);
    return score?.status !== 'verified_unanswered';
  });
  applyGroupRepresentative(
    descriptors,
    scores,
    (descriptorId) => scores.get(descriptorId)?.correctness === true,
    groupCorrect,
    anyAnswered,
    groupOverrideMax(descriptors, overrides),
  );
}

function applyPoolGroup(
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  scores: Map<string, ObjectiveDescriptorScore>,
): void {
  const sorted = [...descriptors].sort(
    (left, right) => (left.answerIndex ?? 0) - (right.answerIndex ?? 0),
  );
  // Per-blank strictness: each blank consumes one pool key under its own rule.
  const matcher = createSharedSentencePoolMatcher(
    getEffectiveAcceptedAnswersForGrading(sorted[0]!),
  );
  for (const descriptor of sorted) {
    const score = scores.get(descriptor.id);
    if (!score) continue;
    const answer = getQuestionAnswer(descriptor, answerMap);
    const matched = matcher.match(answer, isCaseSensitiveDescriptor(descriptor));
    score.correctness = matched;
    score.awardedScore = matched ? 1 : 0;
    score.maxScore = 1;
    score.status = matched ? 'verified_correct' : 'verified_incorrect';
    if (!isAnswered(answer)) score.status = 'verified_unanswered';
  }
}

/**
 * One scoring pass over the website descriptors. This is the single source for
 * per-question marks in the review page, export, and parity harness so those
 * three surfaces cannot disagree about groups, pools, trees or choose-N.
 */
export function scoreObjectiveDescriptors(
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  overrides?: Record<string, ObjectiveScoringOverride>,
): ObjectiveScoringResult {
  const scores = new Map<string, ObjectiveDescriptorScore>();
  const treeGroups = new Map<string, StudentQuestionDescriptor[]>();
  const poolGroups = new Map<string, StudentQuestionDescriptor[]>();
  const requiredGroups = new Map<string, StudentQuestionDescriptor[]>();

  for (const descriptor of descriptors) {
    const treeKey = treeGroupKey(descriptor);
    const poolKey = poolGroupKey(descriptor);
    const groupKey = getScoringGroupKey(descriptor);
    if (treeKey) {
      treeGroups.set(treeKey, [...(treeGroups.get(treeKey) ?? []), descriptor]);
    } else if (poolKey) {
      poolGroups.set(poolKey, [...(poolGroups.get(poolKey) ?? []), descriptor]);
    } else if (groupKey) {
      requiredGroups.set(groupKey, [...(requiredGroups.get(groupKey) ?? []), descriptor]);
    }
    scores.set(descriptor.id, {
      descriptorId: descriptor.id,
      correctness: null,
      awardedScore: null,
      maxScore: null,
      status: 'invalid',
      representative: false,
      groupKey: treeKey ?? poolKey ?? groupKey,
    });
  }

  for (const descriptor of descriptors) {
    const score = scores.get(descriptor.id);
    if (!score) continue;
    const override = overrides?.[descriptor.id];
    const grouped = Boolean(treeGroupKey(descriptor) || poolGroupKey(descriptor) || getScoringGroupKey(descriptor));
    if (override) {
      const scored = overrideScore(descriptor, answerMap, override);
      score.correctness = scored.correctness;
      score.awardedScore = scored.awardedScore;
      score.maxScore = scored.maxScore;
      score.status = scored.correctness === null
        ? 'invalid'
        : !isAnswered(getQuestionAnswer(descriptor, answerMap))
          ? 'verified_unanswered'
          : scored.correctness ? 'verified_correct' : 'verified_incorrect';
      continue;
    }
    if (grouped) {
      // Group passes below own the final values; seed individual correctness
      // so required-group thresholds see each slot's own verdict.
      if (!treeGroupKey(descriptor)) {
        const correctness = isStudentAnswerCorrect(descriptor, answerMap);
        score.correctness = correctness;
        score.status = !isAnswered(getQuestionAnswer(descriptor, answerMap))
          ? 'verified_unanswered'
          : correctness ? 'verified_correct' : 'verified_incorrect';
      }
      continue;
    }

    if (descriptor.block.type === 'MULTI_MCQ') {
      const multi = getMultiSelectAnswerScore(descriptor, answerMap);
      score.awardedScore = multi.awardedScore ?? 0;
      score.maxScore = multi.maxScore ?? 1;
      score.correctness = multi.awardedScore !== null && multi.maxScore !== null
        ? multi.awardedScore >= multi.maxScore
        : null;
      score.status = score.correctness === null
        ? 'invalid'
        : isAnswered(getQuestionAnswer(descriptor, answerMap))
          ? score.correctness ? 'verified_correct' : 'verified_incorrect'
          : 'verified_unanswered';
      continue;
    }

    const correctness = isStudentAnswerCorrect(descriptor, answerMap);
    score.correctness = correctness;
    score.awardedScore = correctness === null ? 0 : correctness ? 1 : 0;
    score.maxScore = 1;
    score.status = correctness === null
      ? 'invalid'
      : !isAnswered(getQuestionAnswer(descriptor, answerMap))
        ? 'verified_unanswered'
        : correctness ? 'verified_correct' : 'verified_incorrect';
  }

  for (const group of treeGroups.values()) {
    applyTreeMatching(group, answerMap, scores, overrides);
  }
  for (const group of poolGroups.values()) {
    applyPoolGroup(group, answerMap, scores);
  }
  for (const group of requiredGroups.values()) {
    applyRequiredGroup(group, scores, overrides);
  }

  let totalScore = 0;
  let maxScore = 0;
  for (const score of scores.values()) {
    if (score.awardedScore !== null) totalScore += score.awardedScore;
    if (score.maxScore !== null) maxScore += score.maxScore;
  }

  return {
    byId: scores,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? (totalScore / maxScore) * 100 : 0,
  };
}
