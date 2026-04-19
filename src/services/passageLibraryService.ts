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

type BackendPassageItem = {
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

const passageRevisions = new Map<string, number>();

class BackendPassageLibrary {
  async getAllPassages(): Promise<PassageLibraryItem[]> {
    const items = await backendGet<BackendPassageItem[]>('/v1/library/passages');
    return items.map((item) => this.mapBackendItem(item));
  }

  async getPassage(id: string): Promise<PassageLibraryItem | null> {
    try {
      const item = await backendGet<BackendPassageItem>(`/v1/library/passages/${id}`);
      return this.mapBackendItem(item);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async addPassage(passage: Passage, metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>): Promise<PassageLibraryItem> {
    const item = await backendPost<BackendPassageItem>('/v1/library/passages', {
      passage,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      },
    });
    return this.mapBackendItem(item);
  }

  async updatePassage(id: string, updates: Partial<{ passage: Passage; metadata: Partial<PassageMetadata> }>): Promise<PassageLibraryItem | null> {
    const revision = passageRevisions.get(id);
    if (revision === undefined) return null;

    const item = await backendPatch<BackendPassageItem>(`/v1/library/passages/${id}`, {
      ...updates,
      revision,
    });
    return this.mapBackendItem(item);
  }

  async deletePassage(id: string): Promise<boolean> {
    try {
      await backendDelete(`/v1/library/passages/${id}`);
      passageRevisions.delete(id);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  async queryPassages(query: PassageLibraryQuery): Promise<PassageLibraryItem[]> {
    const items = await backendGet<BackendPassageItem[]>('/v1/library/passages');
    let results = items.map((item) => this.mapBackendItem(item));

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
    items.forEach(item => sources.add(item.metadata.source));
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

  private mapBackendItem(item: BackendPassageItem): PassageLibraryItem {
    passageRevisions.set(item.id, item.revision);
    return {
      id: item.id,
      passage: item.passage,
      metadata: {
        ...item.metadata,
        difficulty: item.metadata.difficulty as 'easy' | 'medium' | 'hard',
        estimatedTimeMinutes: item.metadata.estimatedTimeMinutes ?? 0,
        author: item.metadata.author ?? '',
      },
    };
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      (error as { statusCode?: unknown }).statusCode === 404
    );
  }
}

// Singleton instance (backend-only)
export const passageLibraryService = new BackendPassageLibrary();
