import type { PassageLibraryItem, QuestionBankItem } from '../../../../types';

export type LibraryDifficulty = 'easy' | 'medium' | 'hard' | 'all';

export type LibraryFilterOptions = Readonly<{
  difficulty: LibraryDifficulty;
  topic: string;
  searchTerm: string;
}>;

export function filterPassages(
  items: readonly PassageLibraryItem[],
  filters: LibraryFilterOptions,
): PassageLibraryItem[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.difficulty !== 'all' && item.metadata.difficulty !== filters.difficulty) {
      return false;
    }
    if (filters.topic !== 'all' && item.metadata.topic !== filters.topic) {
      return false;
    }
    if (!term) {
      return true;
    }

    return (
      item.passage.title.toLowerCase().includes(term) ||
      item.passage.content.toLowerCase().includes(term) ||
      item.metadata.topic.toLowerCase().includes(term) ||
      item.metadata.source.toLowerCase().includes(term) ||
      item.metadata.tags.some((tag) => tag.toLowerCase().includes(term))
    );
  });
}

export function filterQuestions(
  items: readonly QuestionBankItem[],
  filters: LibraryFilterOptions,
): QuestionBankItem[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.difficulty !== 'all' && item.metadata.difficulty !== filters.difficulty) {
      return false;
    }
    if (filters.topic !== 'all' && item.metadata.topic !== filters.topic) {
      return false;
    }
    if (!term) {
      return true;
    }

    return (
      JSON.stringify(item.block).toLowerCase().includes(term) ||
      item.metadata.topic.toLowerCase().includes(term) ||
      item.metadata.tags.some((tag) => tag.toLowerCase().includes(term))
    );
  });
}
