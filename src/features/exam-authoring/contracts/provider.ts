export type ExamProviderKey = 'ielts' | 'sat';

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
    };

export function isSatProvider(providerKey: ExamProviderKey | undefined): providerKey is 'sat' {
  return providerKey === 'sat';
}
