import {
  createStudentAnswerCommands,
  type StudentAnswerCommandContext,
  type StudentAnswerCommands,
} from './answerCommands';
import {
  createStudentExamStore,
  type StudentExamStore,
  type StudentExamStoreSeed,
} from './studentExamStore';
import {
  createStudentNavigationCommands,
  type StudentNavigationCommands,
} from './navigationCommands';

export interface StudentExamSession {
  readonly store: StudentExamStore;
  readonly answers: StudentAnswerCommands;
  readonly navigation: StudentNavigationCommands;
}

export interface CreateStudentExamSessionInput extends Omit<StudentAnswerCommandContext, 'store'> {
  readonly seed: StudentExamStoreSeed;
}

export function createStudentExamSession(
  input: CreateStudentExamSessionInput,
): StudentExamSession {
  const store = createStudentExamStore(input.seed);
  const answers = createStudentAnswerCommands({ ...input, store });
  const navigation = createStudentNavigationCommands(store);
  return { store, answers, navigation };
}
