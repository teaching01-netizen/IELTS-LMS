import { passageLibraryService } from '../../../services/passageLibraryService';
import { questionBankService } from '../../../services/questionBankService';
import type {
  Passage,
  PassageLibraryItem,
  PassageMetadata,
  QuestionBankItem,
  QuestionBlock,
  QuestionMetadata,
} from '../../../types';

export { passageLibraryService } from '../../../services/passageLibraryService';
export { questionBankService } from '../../../services/questionBankService';

export const libraryGateway = {
  passages: {
    getAll: (): Promise<PassageLibraryItem[]> => passageLibraryService.getAllPassages(),
    delete: (id: string): Promise<boolean> => passageLibraryService.deletePassage(id),
    clear: (): Promise<void> => passageLibraryService.clear(),
    add: (
      passage: Passage,
      metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'>,
    ): Promise<PassageLibraryItem> => passageLibraryService.addPassage(passage, metadata),
  },
  questions: {
    getAll: (): Promise<QuestionBankItem[]> => questionBankService.getAllQuestions(),
    delete: (id: string): Promise<boolean> => questionBankService.deleteQuestion(id),
    clear: (): Promise<void> => questionBankService.clear(),
    add: (
      block: QuestionBlock,
      metadata: Omit<QuestionMetadata, 'id' | 'createdAt' | 'usageCount'>,
    ): Promise<QuestionBankItem> => questionBankService.addQuestion(block, metadata),
  },
} as const;
