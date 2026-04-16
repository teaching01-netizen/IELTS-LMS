import {
  QuestionBankItem,
  QuestionBankQuery,
  QuestionBlock,
  QuestionMetadata
} from '../types';

class QuestionBankService {
  private questions: Map<string, QuestionBankItem> = new Map();
  private readonly STORAGE_KEY = 'question-bank';

  constructor() {
    this.loadFromStorage();
  }

  private saveToStorage(): void {
    try {
      const data = Array.from(this.questions.entries());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save question bank to localStorage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.questions = new Map(data);
      }
    } catch (error) {
      console.error('Failed to load question bank from localStorage:', error);
    }
  }

  addQuestion(block: QuestionBlock, metadata: Omit<QuestionMetadata, 'id' | 'createdAt' | 'usageCount'>): QuestionBankItem {
    const id = `qb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullMetadata: QuestionMetadata = {
      ...metadata,
      id,
      createdAt: new Date().toISOString(),
      usageCount: 0
    };

    const item: QuestionBankItem = {
      id,
      block,
      metadata: fullMetadata
    };

    this.questions.set(id, item);
    this.saveToStorage();
    return item;
  }

  updateQuestion(id: string, updates: Partial<{ block: QuestionBlock; metadata: Partial<QuestionMetadata> }>): QuestionBankItem | null {
    const existing = this.questions.get(id);
    if (!existing) return null;

    const updated: QuestionBankItem = {
      ...existing,
      ...(updates.block && { block: updates.block }),
      ...(updates.metadata && { metadata: { ...existing.metadata, ...updates.metadata } })
    };

    this.questions.set(id, updated);
    this.saveToStorage();
    return updated;
  }

  deleteQuestion(id: string): boolean {
    const result = this.questions.delete(id);
    if (result) {
      this.saveToStorage();
    }
    return result;
  }

  getQuestion(id: string): QuestionBankItem | null {
    return this.questions.get(id) || null;
  }

  getAllQuestions(): QuestionBankItem[] {
    return Array.from(this.questions.values());
  }

  queryQuestions(query: QuestionBankQuery): QuestionBankItem[] {
    let results = Array.from(this.questions.values());

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

  incrementUsageCount(id: string): void {
    const item = this.questions.get(id);
    if (item) {
      item.metadata.usageCount += 1;
      item.metadata.lastUsedAt = new Date().toISOString();
      this.saveToStorage();
    }
  }

  getTopics(): string[] {
    const topics = new Set<string>();
    this.questions.forEach(item => topics.add(item.metadata.topic));
    return Array.from(topics).sort();
  }

  getTags(): string[] {
    const tags = new Set<string>();
    this.questions.forEach(item => {
      item.metadata.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }

  getQuestionCount(): number {
    return this.questions.size;
  }

  getQuestionCountByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    this.questions.forEach(item => {
      counts[item.block.type] = (counts[item.block.type] || 0) + 1;
    });
    return counts;
  }

  clear(): void {
    this.questions.clear();
    this.saveToStorage();
  }
}

// Singleton instance
export const questionBankService = new QuestionBankService();
