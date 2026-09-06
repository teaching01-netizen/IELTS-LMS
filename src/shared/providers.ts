/**
 * Exam provider union (plan 91, 1.4). Provider rules live behind cohesive
 * modules — no scattered if-SAT/else branches in components.
 */

export type ExamProviderKey = 'ielts' | 'sat' | 'act';

export interface ExamProviderDefinition {
  key: ExamProviderKey;
  createDefaultConfig(): Record<string, unknown>;
  validateDraft(draft: unknown): Array<{ field: string; message: string }>;
  getAuthoringCapabilities(): { standards: boolean; scienceSection: boolean };
}

const ielts: ExamProviderDefinition = {
  key: 'ielts',
  createDefaultConfig: () => ({ type: 'IELTS', sections: ['listening', 'reading', 'writing', 'speaking'] }),
  validateDraft: () => [],
  getAuthoringCapabilities: () => ({ standards: true, scienceSection: false }),
};

const sat: ExamProviderDefinition = {
  key: 'sat',
  createDefaultConfig: () => ({ type: 'SAT', adaptive: true }),
  validateDraft: () => [],
  getAuthoringCapabilities: () => ({ standards: false, scienceSection: false }),
};

const act: ExamProviderDefinition = {
  key: 'act',
  createDefaultConfig: () => ({
    type: 'ACT',
    summary: 'Standard ACT Exam',
    sections: [{ key: 'science', questions: 40, durationMinutes: 40 }],
  }),
  validateDraft: (d) => {
    const issues: Array<{ field: string; message: string }> = [];
    const draft = d as { sections?: Array<{ key?: string; questions?: number; durationMinutes?: number }> };
    const science = draft?.sections?.find((s) => s.key === 'science');
    if (science && (science.questions ?? 40) !== 40) issues.push({ field: 'sections.science.questions', message: 'ACT Science defaults to 40 questions.' });
    return issues;
  },
  getAuthoringCapabilities: () => ({ standards: false, scienceSection: true }),
};

export const EXAM_PROVIDERS: Record<ExamProviderKey, ExamProviderDefinition> = { ielts, sat, act };
