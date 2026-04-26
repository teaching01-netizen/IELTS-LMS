import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { defaultStudentHighlightColor, type StudentHighlightColor } from '../highlightPalette';
import type { StudentFontSize } from '../accessibilityScale';

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
    fontSize: StudentFontSize;
    highContrast: boolean;
    zoom: number;
    highlightMode: boolean;
    highlightColor: StudentHighlightColor;
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
  setFontSize: (size: StudentFontSize) => void;
  toggleHighContrast: () => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleHighlightMode: () => void;
  setHighlightColor: (color: StudentHighlightColor) => void;
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
    fontSize: 'normal' as StudentFontSize,
    highContrast: false,
    zoom: 1,
    highlightMode: false,
    highlightColor: defaultStudentHighlightColor,
  });

  const grantTimeExtension = useCallback((minutes: number) => {
    setTimeExtensionGranted(true);
    setTimeExtensionMinutes(minutes);
    setShowTimeExtensionRequest(false);
    setTimeExtensionReason('');
  }, []);

  const setFontSize = useCallback((size: StudentFontSize) => {
    setAccessibilitySettings(prev => ({ ...prev, fontSize: size }));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setAccessibilitySettings(prev => ({ ...prev, highContrast: !prev.highContrast }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    const clamped = Math.min(1.5, Math.max(0.85, zoom));
    setAccessibilitySettings(prev => ({ ...prev, zoom: clamped }));
  }, []);

  const zoomIn = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      zoom: Math.min(1.5, Math.max(0.85, prev.zoom + 0.1)),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      zoom: Math.min(1.5, Math.max(0.85, prev.zoom - 0.1)),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, [setZoom]);

  const toggleHighlightMode = useCallback(() => {
    setAccessibilitySettings(prev => ({ ...prev, highlightMode: !prev.highlightMode }));
  }, []);

  const setHighlightColor = useCallback((color: StudentHighlightColor) => {
    setAccessibilitySettings((prev) => ({ ...prev, highlightColor: color }));
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
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    toggleHighlightMode,
    setHighlightColor,
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
