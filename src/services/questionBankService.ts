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

type BackendQuestionBankItem = {
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

const questionRevisions = new Map<string, number>();

class BackendQuestionBank {
  async getAllQuestions(): Promise<QuestionBankItem[]> {
    const items = await backendGet<BackendQuestionBankItem[]>('/v1/library/questions');
    return items.map((item) => this.mapBackendItem(item));
  }

  async getQuestion(id: string): Promise<QuestionBankItem | null> {
    try {
      const item = await backendGet<BackendQuestionBankItem>(`/v1/library/questions/${id}`);
      return this.mapBackendItem(item);
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async addQuestion(block: QuestionBlock, metadata: Omit<QuestionMetadata, 'id' | 'createdAt' | 'usageCount'>): Promise<QuestionBankItem> {
    const item = await backendPost<BackendQuestionBankItem>('/v1/library/questions', {
      block,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      },
    });
    return this.mapBackendItem(item);
  }

  async updateQuestion(id: string, updates: Partial<{ block: QuestionBlock; metadata: Partial<QuestionMetadata> }>): Promise<QuestionBankItem | null> {
    const revision = questionRevisions.get(id);
    if (revision === undefined) return null;

    const item = await backendPatch<BackendQuestionBankItem>(`/v1/library/questions/${id}`, {
      ...updates,
      revision,
    });
    return this.mapBackendItem(item);
  }

  async deleteQuestion(id: string): Promise<boolean> {
    try {
      await backendDelete(`/v1/library/questions/${id}`);
      questionRevisions.delete(id);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  async queryQuestions(query: QuestionBankQuery): Promise<QuestionBankItem[]> {
    const items = await backendGet<BackendQuestionBankItem[]>('/v1/library/questions');
    let results = items.map((item) => this.mapBackendItem(item));

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

  private mapBackendItem(item: BackendQuestionBankItem): QuestionBankItem {
    questionRevisions.set(item.id, item.revision);
    return {
      id: item.id,
      block: item.block,
      metadata: {
        ...item.metadata,
        difficulty: item.metadata.difficulty as 'easy' | 'medium' | 'hard',
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
export const questionBankService = new BackendQuestionBank();
