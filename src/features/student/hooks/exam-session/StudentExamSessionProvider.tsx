import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import {
  createStudentExamStore,
  type StudentExamSessionState,
  type StudentExamStore,
  type StudentExamStoreSeed,
} from '@student/application/exam-session/studentExamStore';

const StudentExamSessionStoreContext = createContext<StudentExamStore | null>(null);

export interface StudentExamSessionProviderProps {
  readonly seed: StudentExamStoreSeed;
  readonly children: ReactNode;
}

export function StudentExamSessionProvider({
  seed,
  children,
}: StudentExamSessionProviderProps) {
  const [store] = useState(() => createStudentExamStore(seed));

  useEffect(() => {
    const actions = store.getState().actions;
    actions.setPhase(seed.phase);
    actions.setRuntimeSnapshot(seed.runtimeSnapshot, seed.displayTimeRemaining);
    actions.setPersistence({
      syncState: seed.syncState,
      pendingMutationCount: seed.pendingMutationCount,
      acceptedThroughSeq: seed.acceptedThroughSeq,
    });
    actions.setBlocking({
      active: seed.blocking?.active ?? false,
      reason: seed.blocking?.reason ?? null,
      timeRemaining: seed.blocking?.timeRemaining ?? 0,
    });
  }, [
    seed.blocking?.active,
    seed.blocking?.reason,
    seed.blocking?.timeRemaining,
    seed.displayTimeRemaining,
    seed.phase,
    seed.runtimeSnapshot,
    seed.syncState,
    seed.pendingMutationCount,
    seed.acceptedThroughSeq,
    store,
  ]);

  return (
    <StudentExamSessionStoreContext.Provider value={store}>
      {children}
    </StudentExamSessionStoreContext.Provider>
  );
}

export function useStudentExamSessionStore(): StudentExamStore {
  const store = useContext(StudentExamSessionStoreContext);
  if (!store) {
    throw new Error('useStudentExamSessionStore must be used within StudentExamSessionProvider');
  }
  return store;
}

export function useStudentExamSession<Selected>(
  selector: (state: StudentExamSessionState) => Selected,
): Selected {
  return useStore(useStudentExamSessionStore(), selector);
}
