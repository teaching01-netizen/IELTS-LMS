import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface UIState {
  showNavigator: boolean;
  showHelp: boolean;
  showSubmitConfirm: boolean;
  showAccessibility: boolean;
  showTimeExtensionRequest: boolean;
  timeExtensionReason: string;
  timeExtensionGranted: boolean;
  timeExtensionMinutes: number;
  accessibilitySettings: {
    fontSize: 'small' | 'normal' | 'large';
    highContrast: boolean;
  };
}

interface UIActions {
  setShowNavigator: (show: boolean) => void;
  setShowHelp: (show: boolean) => void;
  setShowSubmitConfirm: (show: boolean) => void;
  setShowAccessibility: (show: boolean) => void;
  setShowTimeExtensionRequest: (show: boolean) => void;
  setTimeExtensionReason: (reason: string) => void;
  grantTimeExtension: (minutes: number) => void;
  setFontSize: (size: 'small' | 'normal' | 'large') => void;
  toggleHighContrast: () => void;
}

interface UIContextValue {
  state: UIState;
  actions: UIActions;
}

const UIContext = createContext<UIContextValue | null>(null);

interface UIProviderProps {
  children: ReactNode;
}

export function StudentUIProvider({ children }: UIProviderProps) {
  const [showNavigator, setShowNavigator] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showTimeExtensionRequest, setShowTimeExtensionRequest] = useState(false);
  const [timeExtensionReason, setTimeExtensionReason] = useState('');
  const [timeExtensionGranted, setTimeExtensionGranted] = useState(false);
  const [timeExtensionMinutes, setTimeExtensionMinutes] = useState(0);
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    fontSize: 'normal' as 'small' | 'normal' | 'large',
    highContrast: false,
  });

  const grantTimeExtension = useCallback((minutes: number) => {
    setTimeExtensionGranted(true);
    setTimeExtensionMinutes(minutes);
    setShowTimeExtensionRequest(false);
    setTimeExtensionReason('');
  }, []);

  const setFontSize = useCallback((size: 'small' | 'normal' | 'large') => {
    setAccessibilitySettings(prev => ({ ...prev, fontSize: size }));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setAccessibilitySettings(prev => ({ ...prev, highContrast: !prev.highContrast }));
  }, []);

  const state: UIState = {
    showNavigator,
    showHelp,
    showSubmitConfirm,
    showAccessibility,
    showTimeExtensionRequest,
    timeExtensionReason,
    timeExtensionGranted,
    timeExtensionMinutes,
    accessibilitySettings,
  };

  const actions: UIActions = {
    setShowNavigator,
    setShowHelp,
    setShowSubmitConfirm,
    setShowAccessibility,
    setShowTimeExtensionRequest,
    setTimeExtensionReason,
    grantTimeExtension,
    setFontSize,
    toggleHighContrast,
  };

  return (
    <UIContext.Provider value={{ state, actions }}>
      {children}
    </UIContext.Provider>
  );
}

export function useStudentUI() {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useStudentUI must be used within StudentUIProvider');
  }
  return context;
}
