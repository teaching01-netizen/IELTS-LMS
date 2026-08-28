import type { ExamProviderKey } from '../contracts/provider';
import { SAT_BLUEPRINT, validateSatQuestion } from './sat/satProvider';

export interface ExamProviderDefinition {
  key: ExamProviderKey;
  label: string;
  blueprint?: typeof SAT_BLUEPRINT;
  validateQuestion?: typeof validateSatQuestion;
}

const providers: Record<ExamProviderKey, ExamProviderDefinition> = {
  ielts: { key: 'ielts', label: 'IELTS' },
  sat: { key: 'sat', label: 'Digital SAT', blueprint: SAT_BLUEPRINT, validateQuestion: validateSatQuestion },
};

export function getExamProvider(providerKey: ExamProviderKey): ExamProviderDefinition {
  return providers[providerKey];
}

export function listExamProviders(): ExamProviderDefinition[] {
  return Object.values(providers);
}
