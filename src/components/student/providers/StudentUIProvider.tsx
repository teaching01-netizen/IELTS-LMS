import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { defaultStudentHighlightColor, type StudentHighlightColor } from '../highlightPalette';
import {
  DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
  clampStudentPassageReadabilityLevel,
  type StudentFontSize,
  type StudentPassageReadabilityLevel,
} from '../accessibilityScale';
import {
  DEFAULT_STUDENT_PLAYBACK_RATE,
  STUDENT_PLAYBACK_RATES,
  loadStudentAccessibilityPreferences,
  saveStudentAccessibilityPreferences,
  clearStudentAccessibilityPreferences,
  type StudentPlaybackRate,
} from '../accessibilityPreferences';

export type StudentHighlightToolMode = 'off' | 'highlight' | 'erase';

interface UIState {
  showNavigator: boolean;
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
    passageReadabilityLevel: StudentPassageReadabilityLevel;
    playbackRate: StudentPlaybackRate;
    highlightToolMode: StudentHighlightToolMode;
    highlightColor: StudentHighlightColor;
  };
}

interface UIActions {
  setShowNavigator: (show: boolean) => void;
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
  increasePassageReadability: () => void;
  decreasePassageReadability: () => void;
  resetPassageReadability: () => void;
  setPassageReadabilityLevel: (level: StudentPassageReadabilityLevel) => void;
  setPlaybackRate: (rate: StudentPlaybackRate) => void;
  resetAccessibilitySettings: () => void;
  toggleHighlightMode: () => void;
  toggleEraseMode: () => void;
  setHighlightToolMode: (mode: StudentHighlightToolMode) => void;
  resetHighlightTool: () => void;
  setHighlightColor: (color: StudentHighlightColor) => void;
}

interface UIContextValue {
  state: UIState;
  actions: UIActions;
}

const UIContext = createContext<UIContextValue | null>(null);

interface UIProviderProps {
  children: ReactNode;
  /** Storage key for persisted accessibility preferences; omitted = session-only. */
  storageKey?: string | undefined;
}

export function StudentUIProvider({ children, storageKey }: UIProviderProps) {
  const [showNavigator, setShowNavigator] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showTimeExtensionRequest, setShowTimeExtensionRequest] = useState(false);
  const [timeExtensionReason, setTimeExtensionReasonState] = useState('');
  const [timeExtensionGranted, setTimeExtensionGranted] = useState(false);
  const [timeExtensionMinutes, setTimeExtensionMinutes] = useState(0);
  const [accessibilitySettings, setAccessibilitySettings] = useState(() => {
    const stored = storageKey
      ? loadStudentAccessibilityPreferences(storageKey)
      : undefined;
    return {
      fontSize: stored?.fontSize ?? ('normal' as StudentFontSize),
      highContrast: stored?.highContrast ?? false,
      zoom: stored?.zoom ?? 1,
      passageReadabilityLevel:
        stored?.passageReadabilityLevel ?? DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
      playbackRate: stored?.playbackRate ?? DEFAULT_STUDENT_PLAYBACK_RATE,
      highlightToolMode: 'off' as StudentHighlightToolMode,
      highlightColor: defaultStudentHighlightColor,
    };
  });

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    saveStudentAccessibilityPreferences(storageKey, {
      fontSize: accessibilitySettings.fontSize,
      highContrast: accessibilitySettings.highContrast,
      zoom: accessibilitySettings.zoom,
      passageReadabilityLevel: accessibilitySettings.passageReadabilityLevel,
      playbackRate: accessibilitySettings.playbackRate,
    });
  }, [
    accessibilitySettings.fontSize,
    accessibilitySettings.highContrast,
    accessibilitySettings.passageReadabilityLevel,
    accessibilitySettings.playbackRate,
    accessibilitySettings.zoom,
    storageKey,
  ]);

  const grantTimeExtension = useCallback((minutes: number) => {
    setTimeExtensionGranted(true);
    setTimeExtensionMinutes(minutes);
    setShowTimeExtensionRequest(false);
    setTimeExtensionReasonState('');
  }, []);

  const setTimeExtensionReason = useCallback((reason: string) => {
    setTimeExtensionReasonState(typeof reason === 'string' ? reason : '');
  }, []);

  const setFontSize = useCallback((size: StudentFontSize) => {
    setAccessibilitySettings(prev => ({ ...prev, fontSize: size }));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setAccessibilitySettings(prev => ({ ...prev, highContrast: !prev.highContrast }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    const clamped = Math.min(1.5, Math.max(0.85, zoom));
    const rounded = Math.round(clamped * 100) / 100;
    setAccessibilitySettings(prev => ({ ...prev, zoom: rounded }));
  }, []);

  const zoomIn = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      zoom: Math.min(1.5, Math.max(0.85, Math.round((prev.zoom + 0.1) * 100) / 100)),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      zoom: Math.min(1.5, Math.max(0.85, Math.round((prev.zoom - 0.1) * 100) / 100)),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, [setZoom]);

  const increasePassageReadability = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      passageReadabilityLevel: clampStudentPassageReadabilityLevel(prev.passageReadabilityLevel + 1),
    }));
  }, []);

  const decreasePassageReadability = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      passageReadabilityLevel: clampStudentPassageReadabilityLevel(prev.passageReadabilityLevel - 1),
    }));
  }, []);

  const resetPassageReadability = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      passageReadabilityLevel: DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
    }));
  }, []);

  const setPassageReadabilityLevel = useCallback((level: StudentPassageReadabilityLevel) => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      passageReadabilityLevel: clampStudentPassageReadabilityLevel(level),
    }));
  }, []);

  const setPlaybackRate = useCallback((rate: StudentPlaybackRate) => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      playbackRate: STUDENT_PLAYBACK_RATES.includes(rate)
        ? rate
        : DEFAULT_STUDENT_PLAYBACK_RATE,
    }));
  }, []);

  const resetAccessibilitySettings = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      fontSize: 'normal' as StudentFontSize,
      highContrast: false,
      zoom: 1,
      passageReadabilityLevel: DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
      playbackRate: DEFAULT_STUDENT_PLAYBACK_RATE,
    }));
    if (storageKey) {
      clearStudentAccessibilityPreferences(storageKey);
    }
  }, [storageKey]);

  const toggleHighlightMode = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      highlightToolMode: prev.highlightToolMode === 'highlight' ? 'off' : 'highlight',
    }));
  }, []);

  const toggleEraseMode = useCallback(() => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      highlightToolMode: prev.highlightToolMode === 'erase' ? 'off' : 'erase',
    }));
  }, []);

  const setHighlightColor = useCallback((color: StudentHighlightColor) => {
    setAccessibilitySettings((prev) => ({
      ...prev,
      highlightColor: color,
      highlightToolMode: 'highlight',
    }));
  }, []);

  const setHighlightToolMode = useCallback((mode: StudentHighlightToolMode) => {
    setAccessibilitySettings((prev) => ({ ...prev, highlightToolMode: mode }));
  }, []);

  const resetHighlightTool = useCallback(() => {
    setAccessibilitySettings((prev) => ({ ...prev, highlightToolMode: 'off' }));
  }, []);

  const state = useMemo<UIState>(() => ({
    showNavigator,
    showSubmitConfirm,
    showAccessibility,
    showTimeExtensionRequest,
    timeExtensionReason,
    timeExtensionGranted,
    timeExtensionMinutes,
    accessibilitySettings,
  }), [
    accessibilitySettings,
    showAccessibility,
    showNavigator,
    showSubmitConfirm,
    showTimeExtensionRequest,
    timeExtensionGranted,
    timeExtensionMinutes,
    timeExtensionReason,
  ]);

  const actions = useMemo<UIActions>(() => ({
    setShowNavigator,
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
    increasePassageReadability,
    decreasePassageReadability,
    resetPassageReadability,
    setPassageReadabilityLevel,
    setPlaybackRate,
    resetAccessibilitySettings,
    toggleHighlightMode,
    toggleEraseMode,
    setHighlightToolMode,
    resetHighlightTool,
    setHighlightColor,
  }), [
    decreasePassageReadability,
    grantTimeExtension,
    increasePassageReadability,
    resetAccessibilitySettings,
    resetHighlightTool,
    resetPassageReadability,
    resetZoom,
    setFontSize,
    setHighlightColor,
    setHighlightToolMode,
    setPassageReadabilityLevel,
    setPlaybackRate,
    setShowAccessibility,
    setShowNavigator,
    setShowSubmitConfirm,
    setShowTimeExtensionRequest,
    setTimeExtensionReason,
    setZoom,
    toggleEraseMode,
    toggleHighContrast,
    toggleHighlightMode,
    zoomIn,
    zoomOut,
  ]);

  const contextValue = useMemo<UIContextValue>(() => ({ state, actions }), [actions, state]);

  return (
    <UIContext.Provider value={contextValue}>
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

export function useOptionalStudentUI() {
  return useContext(UIContext);
}
