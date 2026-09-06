import {
  QuestionBankItem,
  QuestionBankQuery,
  QuestionBlock,
  QuestionMetadata
} from '../types';
import {
  backendDelete,
  backendGet,
  backendPatch,
  backendPost,
} from './backendBridge';
import { logError } from '../app/error/errorLogger';
import { queryClient, queryKeys } from '../app/data/queryClient';
import { createTtlLruCache } from '../utils/ttlLruCache';
import { assertLibraryContentValid, dedupeRefresh, isConflictError } from './libraryConcurrency';
import type { QuestionType } from '../types';

function questionContentText(block: QuestionBlock): string {
  try {
    return JSON.stringify(block);
  } catch {
    return '';
  }
}

const KNOWN_QUESTION_TYPES: ReadonlySet<string> = new Set<string>([
  'TFNG',
  'CLOZE',
  'MATCHING',
  'MAP',
  'MULTI_MCQ',
  'SINGLE_MCQ',
  'SHORT_ANSWER',
  'SENTENCE_COMPLETION',
  'DIAGRAM_LABELING',
  'FLOW_CHART',
  'TABLE_COMPLETION',
  'NOTE_COMPLETION',
  'CLASSIFICATION',
  'MATCHING_FEATURES',
]);

function normalizeQuestionType(value: unknown, fallback: QuestionType): QuestionType {
  return typeof value === 'string' && KNOWN_QUESTION_TYPES.has(value) ? (value as QuestionType) : fallback;
}

type LegacyBackendQuestionBankItem = {
  id: string;
  block: QuestionBlock;
  metadata: {
    id: string;
    difficulty: string;
    topic: string;
    tags: string[];
    createdAt: string;
    usageCount: number;
    lastUsedAt?: string | undefined;
    estimatedTimeMinutes?: number | undefined;
    author?: string | undefined;
  };
  revision: number;
};

type BackendQuestionBankItemV2 = {
  id: string;
  organizationId?: string | null | undefined;
  questionType: string;
  blockSnapshot: unknown;
  difficulty: string;
  topic: string;
  tags: unknown;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

const questionRevisions = createTtlLruCache<string, number>({
  maxEntries: 500,
  ttlMs: 30 * 60 * 1000,
});

function invalidateQuestionQueries(): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.library.questions() });
}

class BackendQuestionBank {
  async getAllQuestions(): Promise<QuestionBankItem[]> {
    const raw = await backendGet<unknown>('/v1/library/questions');
    const items = this.coerceArray(raw, '/v1/library/questions');
    return items
      .map((item) => this.mapBackendItem(item))
      .filter((value): value is QuestionBankItem => value !== null);
  }

  async getQuestion(id: string): Promise<QuestionBankItem | null> {
    try {
      const raw = await backendGet<unknown>(`/v1/library/questions/${id}`);
      return this.mapBackendItem(raw);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async addQuestion(block: QuestionBlock, metadata: Omit<QuestionMetadata, 'id' | 'createdAt' | 'usageCount'>): Promise<QuestionBankItem> {
    assertLibraryContentValid('question', questionContentText(block));
    const raw = await backendPost<unknown>('/v1/library/questions', {
      questionType: block.type,
      blockSnapshot: block,
      difficulty: metadata.difficulty,
      topic: metadata.topic,
      tags: metadata.tags,
    });
    const mapped = this.mapBackendItem(raw);
    if (!mapped) {
      throw new Error('Backend returned an invalid question record');
    }
    invalidateQuestionQueries();
    return mapped;
  }

  async updateQuestion(id: string, updates: Partial<{ block: QuestionBlock; metadata: Partial<QuestionMetadata> }>): Promise<QuestionBankItem | null> {
    if (updates.block) {
      assertLibraryContentValid('question', questionContentText(updates.block));
    }
    const refreshRevision = async (): Promise<number | undefined> => {
      await this.getQuestion(id);
      return questionRevisions.get(id);
    };
    // Per-id in-flight dedupe: concurrent updates for the same question share
    // one revision-hydrating GET instead of stampeding the backend.
    let revision = questionRevisions.get(id);
    if (revision === undefined) {
      revision = await dedupeRefresh(`question:${id}`, refreshRevision);
      if (revision === undefined) return null;
    }

    const patchBody: Record<string, unknown> = {
      revision,
    };

    if (updates.block) {
      patchBody['questionType'] = updates.block.type;
      patchBody['blockSnapshot'] = updates.block;
    }

    if (updates.metadata?.difficulty !== undefined) {
      patchBody['difficulty'] = updates.metadata.difficulty;
    }

    if (updates.metadata?.topic !== undefined) {
      patchBody['topic'] = updates.metadata.topic;
    }

    if (updates.metadata?.tags !== undefined) {
      patchBody['tags'] = updates.metadata.tags;
    }

    try {
      const raw = await backendPatch<unknown>(`/v1/library/questions/${id}`, patchBody);
      const mapped = this.mapBackendItem(raw);
      invalidateQuestionQueries();
      return mapped;
    } catch (error) {
      // 409 = stale revision (another writer won the race). Refresh once via
      // the shared single-flight GET and retry with the fresh revision; a
      // second 409 (or a vanished record) surfaces to the caller.
      if (!isConflictError(error)) throw error;
      const freshRevision = await dedupeRefresh(`question:${id}`, refreshRevision);
      if (freshRevision === undefined) return null;
      const retryBody = { ...patchBody, revision: freshRevision };
      const raw = await backendPatch<unknown>(`/v1/library/questions/${id}`, retryBody);
      const mapped = this.mapBackendItem(raw);
      invalidateQuestionQueries();
      return mapped;
    }
  }

  async deleteQuestion(id: string): Promise<boolean> {
    try {
      await backendDelete(`/v1/library/questions/${id}`);
      questionRevisions.delete(id);
      invalidateQuestionQueries();
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  async queryQuestions(query: QuestionBankQuery): Promise<QuestionBankItem[]> {
    let results = await this.getAllQuestions();

    if (query.type) {
      results = results.filter(item => item.block.type === query.type);
    }

    if (query.difficulty) {
      results = results.filter(item => item.metadata.difficulty === query.difficulty);
    }

    if (query.topic) {
      results = results.filter(item => item.metadata.topic === query.topic);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(item =>
        query.tags!.some(tag => item.metadata.tags.includes(tag))
      );
    }

    if (query.searchTerm) {
      const term = query.searchTerm.toLowerCase();
      results = results.filter(item => {
        const blockJson = JSON.stringify(item.block).toLowerCase();
        const topicMatch = item.metadata.topic.toLowerCase().includes(term);
        const tagMatch = item.metadata.tags.some(t => t.toLowerCase().includes(term));
        return blockJson.includes(term) || topicMatch || tagMatch;
      });
    }

    return results;
  }

  async incrementUsageCount(id: string): Promise<void> {
    await backendPatch(`/v1/library/questions/${id}/increment-usage`, {});
    invalidateQuestionQueries();
  }

  async getTopics(): Promise<string[]> {
    const items = await this.getAllQuestions();
    const topics = new Set<string>();
    items.forEach(item => topics.add(item.metadata.topic));
    return Array.from(topics).sort();
  }

  async getTags(): Promise<string[]> {
    const items = await this.getAllQuestions();
    const tags = new Set<string>();
    items.forEach(item => {
      item.metadata.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }

  async getQuestionCount(): Promise<number> {
    const items = await this.getAllQuestions();
    return items.length;
  }

  async getQuestionCountByType(): Promise<Record<string, number>> {
    const items = await this.getAllQuestions();
    const counts: Record<string, number> = {};
    items.forEach(item => {
      counts[item.block.type] = (counts[item.block.type] || 0) + 1;
    });
    return counts;
  }

  async clear(): Promise<void> {
    throw new Error('Clear operation not supported for backend question bank');
  }

  private mapBackendItem(payload: unknown): QuestionBankItem | null {
    if (this.isLegacyItem(payload)) {
      questionRevisions.set(payload.id, payload.revision);
      return {
        id: payload.id,
        block: payload.block,
        metadata: {
          ...payload.metadata,
          difficulty: payload.metadata.difficulty as 'easy' | 'medium' | 'hard',
          author: payload.metadata.author ?? '',
        },
      };
    }

    if (this.isV2Item(payload)) {
      const block = this.coerceQuestionBlock(payload.blockSnapshot, payload.questionType);
      questionRevisions.set(payload.id, payload.revision);
      return {
        id: payload.id,
        block,
        metadata: {
          id: payload.id,
          difficulty: this.normalizeDifficulty(payload.difficulty),
          topic: payload.topic,
          tags: this.coerceStringArray(payload.tags),
          usageCount: payload.usageCount,
          createdAt: payload.createdAt,
          author: payload.createdBy ?? '',
        },
      };
    }

    logError(new Error('Unexpected backend question payload'), {
      service: 'questionBankService',
      kind: 'mapBackendItem',
    });
    return null;
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      (error as { statusCode?: unknown }).statusCode === 404
    );
  }

  private isLegacyItem(value: unknown): value is LegacyBackendQuestionBankItem {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'block' in value &&
      'metadata' in value &&
      'revision' in value
    );
  }

  private isV2Item(value: unknown): value is BackendQuestionBankItemV2 {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'questionType' in value &&
      'blockSnapshot' in value &&
      'difficulty' in value &&
      'topic' in value &&
      'tags' in value &&
      'usageCount' in value &&
      'createdBy' in value &&
      'createdAt' in value &&
      'revision' in value
    );
  }

  private coerceArray(value: unknown, endpoint: string): unknown[] {
    if (Array.isArray(value)) return value;

    if (
      typeof value === 'object' &&
      value !== null &&
      'items' in value &&
      Array.isArray((value as { items?: unknown }).items)
    ) {
      return (value as { items: unknown[] }).items;
    }

    logError(new Error('Expected array response from backend'), {
      endpoint,
      receivedType: value === null ? 'null' : typeof value,
    });
    return [];
  }

  private coerceStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string');
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((entry): entry is string => typeof entry === 'string');
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  private normalizeDifficulty(value: string): 'easy' | 'medium' | 'hard' {
    if (value === 'easy' || value === 'medium' || value === 'hard') {
      return value;
    }
    return 'medium';
  }

  private coerceQuestionBlock(snapshot: unknown, fallbackType: string): QuestionBlock {
    // Never trust the backend snapshot blindly: the row is unusable without a
    // known block type, and an unknown type falls back explicitly (callers can
    // see the substitution) instead of flowing through as `undefined`.
    const safeType = normalizeQuestionType(fallbackType, 'TFNG');
    if (typeof snapshot === 'object' && snapshot !== null) {
      const typed = snapshot as Record<string, unknown>;
      typed['type'] = normalizeQuestionType(typed['type'], safeType);
      return typed as unknown as QuestionBlock;
    }

    return { type: safeType, id: `b${Date.now()}` } as QuestionBlock;
  }
}

// Singleton instance (backend-only)
export const questionBankService = new BackendQuestionBank();
