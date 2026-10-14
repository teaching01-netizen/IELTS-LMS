import type { SatExamConfig } from './satExamConfig';

export type ExamProviderKey = 'ielts' | 'sat' | 'act';

export type CreateExamInput =
  | {
      providerKey: 'ielts';
      title: string;
      providerExamType: 'Academic' | 'General Training';
      preset: 'Academic' | 'General Training' | 'Listening' | 'Reading' | 'Writing' | 'Speaking' | 'Custom';
    }
  | {
      providerKey: 'sat';
      title: string;
      providerExamType: 'SAT';
      /** Exam-level configuration saved in the creation transaction; omitted = server defaults. */
      configuration?: SatExamConfig;
    }
  | {
      providerKey: 'act';
      title: string;
      providerExamType: 'ACT';
      preset: 'ACT Science';
    };

export function isSatProvider(providerKey: ExamProviderKey | undefined): providerKey is 'sat' {
  return providerKey === 'sat';
}

export function isActProvider(providerKey: ExamProviderKey | undefined): providerKey is 'act' {
  return providerKey === 'act';
}
