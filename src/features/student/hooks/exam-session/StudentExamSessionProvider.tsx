import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import {
  createStudentExamStore,
  getStudentExamScopeKey,
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

  // Invariant: store scope is fixed at creation; remount on scope change is enforced by the
  // wrapper via key={sessionScopeKey} (StudentAppWrapper.tsx:132). This effect only syncs
  // live slices (phase/runtime/persistence/blocking) without remount — do NOT duplicate wrapper key.
  // The effect intentionally does not sync identity/navigation/attempt (seed-of-truth at mount).
  const blockingActive = seed.blocking?.active ?? false;
  const blockingReason = seed.blocking?.reason ?? null;
  const blockingTimeRemaining = seed.blocking?.timeRemaining ?? 0;
  const seedSync = useMemo(
    () => ({
      phase: seed.phase,
      runtimeSnapshot: seed.runtimeSnapshot,
      displayTimeRemaining: seed.displayTimeRemaining,
      syncState: seed.syncState,
      pendingMutationCount: seed.pendingMutationCount,
      acceptedThroughSeq: seed.acceptedThroughSeq,
      blockingActive,
      blockingReason,
      blockingTimeRemaining,
    }),
    [
      blockingActive,
      blockingReason,
      blockingTimeRemaining,
      seed.displayTimeRemaining,
      seed.phase,
      seed.runtimeSnapshot,
      seed.syncState,
      seed.pendingMutationCount,
      seed.acceptedThroughSeq,
    ],
  );
  useEffect(() => {
    if (import.meta.env.DEV) {
      const expected = getStudentExamScopeKey(seed);
      const actual = store.getState().identity.scopeKey;
      if (actual !== expected) {
        console.warn(
          `[StudentExamSessionProvider] scopeKey mismatch: store=${actual} seed=${expected}. ` +
            `Ensure wrapper key={sessionScopeKey} remounts provider on scope change.`,
        );
      }
    }
    const actions = store.getState().actions;
    actions.setPhase(seedSync.phase);
    actions.setRuntimeSnapshot(seedSync.runtimeSnapshot, seedSync.displayTimeRemaining);
    actions.setPersistence({
      syncState: seedSync.syncState,
      pendingMutationCount: seedSync.pendingMutationCount,
      acceptedThroughSeq: seedSync.acceptedThroughSeq,
    });
    actions.setBlocking({
      active: seedSync.blockingActive,
      reason: seedSync.blockingReason,
      timeRemaining: seedSync.blockingTimeRemaining,
    });
  }, [seedSync, store]);

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
