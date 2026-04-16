import {
  PassageLibraryItem,
  PassageLibraryQuery,
  Passage,
  PassageMetadata
} from '../types';

class PassageLibraryService {
  private passages: Map<string, PassageLibraryItem> = new Map();
  private readonly STORAGE_KEY = 'passage-library';

  constructor() {
    this.loadFromStorage();
  }

  private saveToStorage(): void {
    try {
      const data = Array.from(this.passages.entries());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save passage library to localStorage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.passages = new Map(data);
      }
    } catch (error) {
      console.error('Failed to load passage library from localStorage:', error);
    }
  }

  addPassage(passage: Passage, metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>): PassageLibraryItem {
    const id = `pl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullMetadata: PassageMetadata = {
      ...metadata,
      id,
      createdAt: new Date().toISOString(),
      usageCount: 0
    };

    const item: PassageLibraryItem = {
      id,
      passage,
      metadata: fullMetadata
    };

    this.passages.set(id, item);
    this.saveToStorage();
    return item;
  }

  updatePassage(id: string, updates: Partial<{ passage: Passage; metadata: Partial<PassageMetadata> }>): PassageLibraryItem | null {
    const existing = this.passages.get(id);
    if (!existing) return null;

    const updated: PassageLibraryItem = {
      ...existing,
      ...(updates.passage && { passage: updates.passage }),
      ...(updates.metadata && { metadata: { ...existing.metadata, ...updates.metadata } })
    };

    this.passages.set(id, updated);
    this.saveToStorage();
    return updated;
  }

  deletePassage(id: string): boolean {
    const result = this.passages.delete(id);
    if (result) {
      this.saveToStorage();
    }
    return result;
  }

  getPassage(id: string): PassageLibraryItem | null {
    return this.passages.get(id) || null;
  }

  getAllPassages(): PassageLibraryItem[] {
    return Array.from(this.passages.values());
  }

  queryPassages(query: PassageLibraryQuery): PassageLibraryItem[] {
    let results = Array.from(this.passages.values());

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

  incrementUsageCount(id: string): void {
    const item = this.passages.get(id);
    if (item) {
      item.metadata.usageCount += 1;
      item.metadata.lastUsedAt = new Date().toISOString();
      this.saveToStorage();
    }
  }

  getTopics(): string[] {
    const topics = new Set<string>();
    this.passages.forEach(item => topics.add(item.metadata.topic));
    return Array.from(topics).sort();
  }

  getSources(): string[] {
    const sources = new Set<string>();
    this.passages.forEach(item => sources.add(item.metadata.source));
    return Array.from(sources).sort();
  }

  getTags(): string[] {
    const tags = new Set<string>();
    this.passages.forEach(item => {
      item.metadata.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }

  getPassageCount(): number {
    return this.passages.size;
  }

  clear(): void {
    this.passages.clear();
    this.saveToStorage();
  }
}

// Singleton instance
export const passageLibraryService = new PassageLibraryService();
