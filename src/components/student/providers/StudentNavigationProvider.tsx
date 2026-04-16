/**
 * Legacy student provider kept for reference only.
 *
 * The active student runtime lives in `StudentRuntimeProvider`.
 */
import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { ModuleType, QuestionAnswer } from '../../../types';
import { ExamState } from '../../../types';

interface NavigationState {
  currentModule: ModuleType;
  currentQuestionId: string | null;
  answers: Record<string, QuestionAnswer>;
  writingAnswers: Record<string, string>;
  flags: Record<string, boolean>;
}

interface NavigationActions {
  setCurrentModule: (module: ModuleType) => void;
  setCurrentQuestionId: (id: string | null) => void;
  setAnswer: (questionId: string, answer: QuestionAnswer) => void;
  setWritingAnswer: (taskId: string, text: string) => void;
  toggleFlag: (questionId: string) => void;
  resetModule: (module: ModuleType) => void;
}

interface NavigationContextValue {
  state: NavigationState;
  actions: NavigationActions;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

interface NavigationProviderProps {
  children: ReactNode;
  state: ExamState;
  runtimeBacked?: boolean;
  runtimeSnapshot?: {
    currentSectionKey?: string;
  } | null;
}

export function NavigationProvider({ 
  children, 
  state, 
  runtimeBacked = false,
  runtimeSnapshot = null 
}: NavigationProviderProps) {
  const enabledModules = React.useMemo(() => {
    return (['listening', 'reading', 'writing', 'speaking'] as ModuleType[])
      .filter(m => state.config.sections[m].enabled)
      .sort((a, b) => state.config.sections[a].order - state.config.sections[b].order);
  }, [state.config.sections]);

  const [currentModule, setCurrentModule] = useState<ModuleType>(
    (runtimeSnapshot?.currentSectionKey as ModuleType ?? enabledModules[0]) || 'listening'
  );
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [writingAnswers, setWritingAnswers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  // Sync current module with runtime state
  useEffect(() => {
    if (!runtimeBacked) {
      return;
    }

    if (runtimeSnapshot?.currentSectionKey) {
      setCurrentModule(runtimeSnapshot.currentSectionKey as ModuleType);
      setCurrentQuestionId(null);
    }
  }, [runtimeBacked, runtimeSnapshot?.currentSectionKey]);

  const setAnswer = useCallback((questionId: string, answer: QuestionAnswer) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  }, []);

  const setWritingAnswer = useCallback((taskId: string, text: string) => {
    setWritingAnswers(prev => ({ ...prev, [taskId]: text }));
  }, []);

  const toggleFlag = useCallback((questionId: string) => {
    setFlags(prev => ({ ...prev, [questionId]: !prev[questionId] }));
  }, []);

  const resetModule = useCallback(() => {
    setCurrentQuestionId(null);
  }, []);

  const navigationState: NavigationState = {
    currentModule,
    currentQuestionId,
    answers,
    writingAnswers,
    flags,
  };

  const navigationActions: NavigationActions = {
    setCurrentModule,
    setCurrentQuestionId,
    setAnswer,
    setWritingAnswer,
    toggleFlag,
    resetModule,
  };

  return (
    <NavigationContext.Provider value={{ state: navigationState, actions: navigationActions }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}
