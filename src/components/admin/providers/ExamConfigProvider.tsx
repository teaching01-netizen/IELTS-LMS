import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { ExamConfig, ModuleType, QuestionType, DeepPartial, ModuleConfig } from '../../../types';

type SettingsTab = 'general' | 'sections' | 'timing' | 'scoring' | 'security' | 'publish';

interface ExamConfigState {
  activeTab: SettingsTab;
  config: ExamConfig;
}

interface ExamConfigActions {
  setActiveTab: (tab: SettingsTab) => void;
  updateConfig: <K extends keyof ExamConfig>(section: K, value: DeepPartial<ExamConfig[K]>) => void;
  updateSection: (module: ModuleType, value: DeepPartial<ModuleConfig>) => void;
  toggleQuestionType: (module: ModuleType, type: QuestionType) => void;
}

interface ExamConfigContextValue {
  state: ExamConfigState;
  actions: ExamConfigActions;
}

const ExamConfigContext = createContext<ExamConfigContextValue | null>(null);

interface ExamConfigProviderProps {
  children: ReactNode;
  initialConfig: ExamConfig;
  onChange: (config: ExamConfig) => void;
}

export function ExamConfigProvider({ children, initialConfig, onChange }: ExamConfigProviderProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [config, setConfig] = useState<ExamConfig>(initialConfig);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Tracks whether the user has unsaved local edits; external syncs must not clobber them.
  const dirtyRef = useRef(false);
  const initialRef = useRef(initialConfig);

  const updateConfig = useCallback(<K extends keyof ExamConfig>(section: K, value: DeepPartial<ExamConfig[K]>) => {
    dirtyRef.current = true;
    let nextConfig: ExamConfig | null = null;
    setConfig((previous) => {
      nextConfig = {
        ...previous,
        [section]: {
          ...previous[section],
          ...value
        }
      };
      return nextConfig;
    });
    // setState updater runs synchronously in React for this read-back; fall back to a
    // functional recompute if it did not (e.g. future concurrent behavior).
    if (nextConfig) {
      onChangeRef.current(nextConfig);
    }
  }, []);

  const updateSection = useCallback((module: ModuleType, value: DeepPartial<ModuleConfig>) => {
    dirtyRef.current = true;
    let nextConfig: ExamConfig | null = null;
    setConfig((previous) => {
      nextConfig = {
        ...previous,
        sections: {
          ...previous.sections,
          [module]: {
            ...previous.sections[module],
            ...value
          }
        }
      };
      return nextConfig;
    });
    if (nextConfig) {
      onChangeRef.current(nextConfig);
    }
  }, []);

  const toggleQuestionType = useCallback((module: ModuleType, type: QuestionType) => {
    dirtyRef.current = true;
    let nextConfig: ExamConfig | null = null;
    setConfig((previous) => {
      const currentTypes = previous.sections[module].allowedQuestionTypes;
      const newTypes = currentTypes.includes(type)
        ? currentTypes.filter(t => t !== type)
        : [...currentTypes, type];
      nextConfig = {
        ...previous,
        sections: {
          ...previous.sections,
          [module]: {
            ...previous.sections[module],
            allowedQuestionTypes: newTypes
          }
        }
      };
      return nextConfig;
    });
    if (nextConfig) {
      onChangeRef.current(nextConfig);
    }
  }, []);

  // Sync with external config changes, but never clobber unsaved local edits.
  React.useEffect(() => {
    if (initialRef.current === initialConfig) {
      return;
    }
    initialRef.current = initialConfig;
    if (dirtyRef.current) {
      return;
    }
    setConfig(initialConfig);
  }, [initialConfig]);

  const state: ExamConfigState = {
    activeTab,
    config,
  };

  const actions: ExamConfigActions = {
    setActiveTab,
    updateConfig,
    updateSection,
    toggleQuestionType,
  };

  return (
    <ExamConfigContext.Provider value={{ state, actions }}>
      {children}
    </ExamConfigContext.Provider>
  );
}

export function useExamConfig() {
  const context = useContext(ExamConfigContext);
  if (!context) {
    throw new Error('useExamConfig must be used within ExamConfigProvider');
  }
  return context;
}
