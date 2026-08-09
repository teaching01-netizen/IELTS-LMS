export interface AcceptsAlternativeAnswers {
  correctAnswer: string;
  acceptedAnswers?: string[] | undefined;
}

function splitAnswerVariants(value: string): string[] {
  return value.includes('|') ? value.split('|') : [value];
}

function normalizeAnswer(value: string, foldCase: boolean): string {
  let normalized = value.normalize('NFKC');
  if (foldCase) {
    normalized = normalized.toLowerCase();
  }
  return normalized
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—−-]+/g, ' ')
    .replace(/'/g, '')
    .replace(/[.,;:!?/\\()[\]{}"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAnswerForMatching(value: string): string {
  return normalizeAnswer(value, false);
}

export function normalizeAnswerForAcceptedAnswerKey(value: string): string {
  return normalizeAnswer(value, false);
}

export function sanitizeAcceptedAnswers(acceptedAnswers: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const value of acceptedAnswers ?? []) {
    const variants = splitAnswerVariants(value);
    for (const variant of variants) {
      const trimmed = variant.trim();
      if (!trimmed) {
        continue;
      }

      const key = normalizeAnswerForAcceptedAnswerKey(trimmed);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      sanitized.push(trimmed);
    }
  }

  return sanitized;
}

export function resolveAcceptedAnswers(entry: AcceptsAlternativeAnswers): string[] {
  const fromAccepted = sanitizeAcceptedAnswers(entry.acceptedAnswers);
  if (fromAccepted.length > 0) {
    return fromAccepted;
  }

  return sanitizeAcceptedAnswers(splitAnswerVariants(entry.correctAnswer));
}

export function buildAcceptedAnswerFields(acceptedAnswers: readonly string[]): {
  correctAnswer: string;
  acceptedAnswers: string[];
} {
  const sanitized = sanitizeAcceptedAnswers(acceptedAnswers);
  return {
    correctAnswer: sanitized[0] ?? '',
    acceptedAnswers: sanitized,
  };
}

export function syncAcceptedAnswers<T extends AcceptsAlternativeAnswers>(entry: T): T {
  return {
    ...entry,
    ...buildAcceptedAnswerFields(resolveAcceptedAnswers(entry)),
  };
}
