import {
  PassageLibraryItem,
  PassageLibraryQuery,
  Passage,
  PassageMetadata
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

type LegacyBackendPassageItem = {
  id: string;
  passage: Passage;
  metadata: {
    id: string;
    topic: string;
    difficulty: string;
    wordCount: number;
    source: string;
    tags: string[];
    createdAt: string;
    usageCount: number;
    lastUsedAt?: string | undefined;
    estimatedTimeMinutes?: number | undefined;
    author?: string | undefined;
  };
  revision: number;
};

type BackendPassageItemV2 = {
  id: string;
  organizationId?: string | null | undefined;
  title: string;
  passageSnapshot: unknown;
  difficulty: string;
  topic: string;
  tags: unknown;
  wordCount: number;
  estimatedTimeMinutes: number;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

const passageRevisions = createTtlLruCache<string, number>({
  maxEntries: 500,
  ttlMs: 30 * 60 * 1000,
});

function invalidatePassageQueries(): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.library.passages() });
}

class BackendPassageLibrary {
  async getAllPassages(): Promise<PassageLibraryItem[]> {
    const raw = await backendGet<unknown>('/v1/library/passages');
    const items = this.coerceArray(raw, '/v1/library/passages');
    return items
      .map((item) => this.mapBackendItem(item))
      .filter((value): value is PassageLibraryItem => value !== null);
  }

  async getPassage(id: string): Promise<PassageLibraryItem | null> {
    try {
      const raw = await backendGet<unknown>(`/v1/library/passages/${id}`);
      return this.mapBackendItem(raw);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async addPassage(passage: Passage, metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>): Promise<PassageLibraryItem> {
    assertLibraryContentValid('passage', passage.content);
    const raw = await backendPost<unknown>('/v1/library/passages', {
      title: passage.title,
      passageSnapshot: passage,
      difficulty: metadata.difficulty,
      topic: metadata.topic,
      tags: metadata.tags,
      wordCount: metadata.wordCount ?? passage.wordCount ?? this.estimateWordCount(passage.content),
      estimatedTimeMinutes: metadata.estimatedTimeMinutes ?? 0,
    });
    const mapped = this.mapBackendItem(raw);
    if (!mapped) {
      throw new Error('Backend returned an invalid passage record');
    }
    invalidatePassageQueries();
    return mapped;
  }

  async updatePassage(id: string, updates: Partial<{ passage: Passage; metadata: Partial<PassageMetadata> }>): Promise<PassageLibraryItem | null> {
    if (updates.passage) {
      assertLibraryContentValid('passage', updates.passage.content);
    }
    const refreshRevision = async (): Promise<number | undefined> => {
      await this.getPassage(id);
      return passageRevisions.get(id);
    };
    // Per-id in-flight dedupe: concurrent updates for the same passage share
    // one revision-hydrating GET instead of stampeding the backend.
    let revision = passageRevisions.get(id);
    if (revision === undefined) {
      revision = await dedupeRefresh(`passage:${id}`, refreshRevision);
      if (revision === undefined) return null;
    }

    const buildPatchBody = (currentRevision: number): Record<string, unknown> => {
      const patchBody: Record<string, unknown> = {
        revision: currentRevision,
      };

      if (updates.passage) {
        patchBody['title'] = updates.passage.title;
        patchBody['passageSnapshot'] = updates.passage;
      }
      return patchBody;
    };

    const patchBody: Record<string, unknown> = buildPatchBody(revision);

    if (updates.metadata?.difficulty !== undefined) {
      patchBody['difficulty'] = updates.metadata.difficulty;
    }

    if (updates.metadata?.topic !== undefined) {
      patchBody['topic'] = updates.metadata.topic;
    }

    if (updates.metadata?.tags !== undefined) {
      patchBody['tags'] = updates.metadata.tags;
    }

    if (updates.metadata?.wordCount !== undefined) {
      patchBody['wordCount'] = updates.metadata.wordCount;
    }

    if (updates.metadata?.estimatedTimeMinutes !== undefined) {
      patchBody['estimatedTimeMinutes'] = updates.metadata.estimatedTimeMinutes;
    }

    try {
      const raw = await backendPatch<unknown>(`/v1/library/passages/${id}`, patchBody);
      const mapped = this.mapBackendItem(raw);
      invalidatePassageQueries();
      return mapped;
    } catch (error) {
      // 409 = stale revision (another writer won the race). Refresh once via
      // the shared single-flight GET and retry with the fresh revision; a
      // second 409 (or a vanished record) surfaces to the caller.
      if (!isConflictError(error)) throw error;
      const freshRevision = await dedupeRefresh(`passage:${id}`, refreshRevision);
      if (freshRevision === undefined) return null;
      const retryBody = { ...patchBody, revision: freshRevision };
      const raw = await backendPatch<unknown>(`/v1/library/passages/${id}`, retryBody);
      const mapped = this.mapBackendItem(raw);
      invalidatePassageQueries();
      return mapped;
    }
  }

  async deletePassage(id: string): Promise<boolean> {
    try {
      await backendDelete(`/v1/library/passages/${id}`);
      passageRevisions.delete(id);
      invalidatePassageQueries();
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  async queryPassages(query: PassageLibraryQuery): Promise<PassageLibraryItem[]> {
    let results = await this.getAllPassages();

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

    if (query.minWordCount !== undefined) {
      results = results.filter(item => item.metadata.wordCount >= query.minWordCount!);
    }

    if (query.maxWordCount !== undefined) {
      results = results.filter(item => item.metadata.wordCount <= query.maxWordCount!);
    }

    if (query.searchTerm) {
      const term = query.searchTerm.toLowerCase();
      results = results.filter(item => {
        const titleMatch = item.passage.title.toLowerCase().includes(term);
        const contentMatch = item.passage.content.toLowerCase().includes(term);
        const topicMatch = item.metadata.topic.toLowerCase().includes(term);
        const sourceMatch = item.metadata.source.toLowerCase().includes(term);
        const tagMatch = item.metadata.tags.some(t => t.toLowerCase().includes(term));
        return titleMatch || contentMatch || topicMatch || sourceMatch || tagMatch;
      });
    }

    return results;
  }

  async incrementUsageCount(id: string): Promise<void> {
    await backendPatch(`/v1/library/passages/${id}/increment-usage`, {});
    invalidatePassageQueries();
  }

  async getTopics(): Promise<string[]> {
    const items = await this.getAllPassages();
    const topics = new Set<string>();
    items.forEach(item => topics.add(item.metadata.topic));
    return Array.from(topics).sort();
  }

  async getSources(): Promise<string[]> {
    const items = await this.getAllPassages();
    const sources = new Set<string>();
    items.forEach(item => {
      if (item.metadata.source.trim().length > 0) {
        sources.add(item.metadata.source);
      }
    });
    return Array.from(sources).sort();
  }

  async getTags(): Promise<string[]> {
    const items = await this.getAllPassages();
    const tags = new Set<string>();
    items.forEach(item => {
      item.metadata.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }

  async getPassageCount(): Promise<number> {
    const items = await this.getAllPassages();
    return items.length;
  }

  async clear(): Promise<void> {
    throw new Error('Clear operation not supported for backend passage library');
  }

  private mapBackendItem(payload: unknown): PassageLibraryItem | null {
    if (this.isLegacyItem(payload)) {
      passageRevisions.set(payload.id, payload.revision);
      return {
        id: payload.id,
        passage: payload.passage,
        metadata: {
          ...payload.metadata,
          difficulty: payload.metadata.difficulty as 'easy' | 'medium' | 'hard',
          estimatedTimeMinutes: payload.metadata.estimatedTimeMinutes ?? 0,
          author: payload.metadata.author ?? '',
        },
      };
    }

    if (this.isV2Item(payload)) {
      const passage = this.coercePassage(payload.passageSnapshot, payload.id, payload.title);
      passageRevisions.set(payload.id, payload.revision);
      return {
        id: payload.id,
        passage,
        metadata: {
          id: payload.id,
          difficulty: this.normalizeDifficulty(payload.difficulty),
          source: '',
          topic: payload.topic,
          tags: this.coerceStringArray(payload.tags),
          wordCount: payload.wordCount,
          estimatedTimeMinutes: payload.estimatedTimeMinutes,
          usageCount: payload.usageCount,
          createdAt: payload.createdAt,
          author: payload.createdBy ?? '',
        },
      };
    }

    logError(new Error('Unexpected backend passage payload'), {
      service: 'passageLibraryService',
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

  private isLegacyItem(value: unknown): value is LegacyBackendPassageItem {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'passage' in value &&
      'metadata' in value &&
      'revision' in value
    );
  }

  private isV2Item(value: unknown): value is BackendPassageItemV2 {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'title' in value &&
      'passageSnapshot' in value &&
      'difficulty' in value &&
      'topic' in value &&
      'tags' in value &&
      'wordCount' in value &&
      'estimatedTimeMinutes' in value &&
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

  private coercePassage(snapshot: unknown, id: string, title: string): Passage {
    if (typeof snapshot === 'object' && snapshot !== null) {
      const typed = snapshot as Record<string, unknown>;
      const content = typeof typed['content'] === 'string' ? (typed['content'] as string) : '';
      const blocks = Array.isArray(typed['blocks']) ? (typed['blocks'] as Passage['blocks']) : [];
      const images = Array.isArray(typed['images']) ? (typed['images'] as Passage['images']) : undefined;
      const wordCount = typeof typed['wordCount'] === 'number' ? (typed['wordCount'] as number) : undefined;
      const resolvedTitle = typeof typed['title'] === 'string' && typed['title'].trim().length > 0 ? (typed['title'] as string) : title;

      return {
        id,
        title: resolvedTitle,
        content,
        blocks,
        images,
        wordCount,
      };
    }

    return {
      id,
      title,
      content: '',
      blocks: [],
    };
  }

  private estimateWordCount(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }
}

// Singleton instance (backend-only)
export const passageLibraryService = new BackendPassageLibrary();
