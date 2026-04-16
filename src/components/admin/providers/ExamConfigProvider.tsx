import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
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

  const updateConfig = useCallback(<K extends keyof ExamConfig>(section: K, value: DeepPartial<ExamConfig[K]>) => {
    const newConfig = {
      ...config,
      [section]: {
        ...config[section],
        ...value
      }
    };
    setConfig(newConfig);
    onChange(newConfig);
  }, [config, onChange]);

  const updateSection = useCallback((module: ModuleType, value: DeepPartial<ModuleConfig>) => {
    const newConfig = {
      ...config,
      sections: {
        ...config.sections,
        [module]: {
          ...config.sections[module],
          ...value
        }
      }
    };
    setConfig(newConfig);
    onChange(newConfig);
  }, [config, onChange]);

  const toggleQuestionType = useCallback((module: ModuleType, type: QuestionType) => {
    const currentTypes = config.sections[module].allowedQuestionTypes;
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];
    updateSection(module, { allowedQuestionTypes: newTypes });
  }, [config.sections, updateSection]);

  // Sync with external config changes
  React.useEffect(() => {
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
