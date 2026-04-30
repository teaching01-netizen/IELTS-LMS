export interface AcceptsAlternativeAnswers {
  correctAnswer: string;
  acceptedAnswers?: string[] | undefined;
}

export function normalizeAnswerForMatching(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—−-]+/g, ' ')
    .replace(/'/g, '')
    .replace(/[.,;:!?/\\()[\]{}"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeAcceptedAnswers(acceptedAnswers: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const value of acceptedAnswers ?? []) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = normalizeAnswerForMatching(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    sanitized.push(trimmed);
  }

  return sanitized;
}

export function resolveAcceptedAnswers(entry: AcceptsAlternativeAnswers): string[] {
  const fromAccepted = sanitizeAcceptedAnswers(entry.acceptedAnswers);
  if (fromAccepted.length > 0) {
    return fromAccepted;
  }

  const fallback = entry.correctAnswer.trim();
  return fallback ? [fallback] : [];
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
