import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { countAnsweredQuestions, countQuestionSlots } from '@student/application/studentExamContentFacade';
import { useProctoring } from './StudentProctoringProvider';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';
import { saveStudentAuditEvent } from '@student/application/studentAttemptFacade';
import { useStudentUI } from './StudentUIProvider';

interface KeyboardProviderProps {
  children: ReactNode;
}

type StudentSubmitHandler = () => Promise<void> | void;

interface KeyboardContextValue {
  registerSubmitHandler: (handler: StudentSubmitHandler | null) => () => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

const blockedGlobalModifierKeys = new Set(['f', 'p', 's']);

const blockedInspectorShortcuts = new Set(['i', 'c', 'j']);
const allowedEditingKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
  'Escape',
]);

type UndoRedoKind = 'undo' | 'redo';

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function isWithinHighlightableContainer(target: EventTarget | null) {
  if (target instanceof HTMLElement) {
    return Boolean(target.closest('[data-student-highlightable="true"]'));
  }

  if (target instanceof Node) {
    return Boolean(target.parentElement?.closest('[data-student-highlightable="true"]'));
  }

  return false;
}

function isWithinQuestionCalloutProtectedText(target: EventTarget | null) {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;

  return Boolean(
    element?.closest('[data-student-question-callout-protected="true"]'),
  );
}

function hasActiveSelectionWithinHighlightableContainer() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }

  return (
    isWithinHighlightableContainer(selection.anchorNode) &&
    isWithinHighlightableContainer(selection.focusNode)
  );
}

function historyKindFromUndoRedoShortcut(event: KeyboardEvent): UndoRedoKind | null {
  const key = event.key.toLowerCase();
  const usesUndoModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (!usesUndoModifier) {
    return null;
  }

  if (!event.shiftKey && key === 'z') {
    return 'undo';
  }

  const isRedo =
    (event.metaKey && event.shiftKey && key === 'z') ||
    (event.ctrlKey && (key === 'y' || (event.shiftKey && key === 'z')));
  return isRedo ? 'redo' : null;
}

function isIpadSafari(userAgent: string): boolean {
  const normalized = userAgent.toLowerCase();
  const isIpad = normalized.includes('ipad');
  const isSafari = normalized.includes('safari');
  const hasAlternateEngine = normalized.includes('crios') || normalized.includes('fxios') || normalized.includes('edgios');
  return isIpad && isSafari && !hasAlternateEngine;
}

function isScreenshotShortcut(event: KeyboardEvent): boolean {
  if (event.key === 'PrintScreen') {
    return true;
  }

  const normalizedKey = event.key.toLowerCase();
  return Boolean(event.metaKey && event.shiftKey && ['3', '4', '5'].includes(normalizedKey));
}

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const { state: runtimeState, actions: runtimeActions, examState } = useStudentRuntime();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const { actions: uiActions } = useStudentUI();
  const { handleViolation } = useProctoring();

  const sessionId = attemptState.attempt?.scheduleId;
  const studentId = attemptState.attemptId ?? undefined;
  const shouldBlockClipboard = examState.config.security.blockClipboard !== false;
  const shouldEnableAntiScreenshotGuard = examState.config.security.antiScreenshotGuardEnabled !== false;
  const attemptAnswers = attemptState.attempt?.answers ?? {};
  const totalQuestions = countQuestionSlots(runtimeState.allQuestions);
  const answeredCount = countAnsweredQuestions(runtimeState.allQuestions, attemptAnswers);
  const unansweredSubmissionPolicy = examState.config.progression.unansweredSubmissionPolicy ?? 'confirm';
  const submitRequiresConfirmation =
    runtimeState.phase === 'exam' &&
    (runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening') &&
    totalQuestions > 0 &&
    answeredCount < totalQuestions &&
    unansweredSubmissionPolicy !== 'allow';
  const screenshotUnsupportedLoggedRef = useRef(false);
  const runtimeStateRef = useRef(runtimeState);
  const runtimeActionsRef = useRef(runtimeActions);
  const attemptStateRef = useRef(attemptState);
  const attemptActionsRef = useRef(attemptActions);
  const uiActionsRef = useRef(uiActions);
  const handleViolationRef = useRef(handleViolation);
  const sessionIdRef = useRef(sessionId);
  const studentIdRef = useRef(studentId);
  const shouldBlockClipboardRef = useRef(shouldBlockClipboard);
  const shouldEnableAntiScreenshotGuardRef = useRef(shouldEnableAntiScreenshotGuard);
  const submitRequiresConfirmationRef = useRef(submitRequiresConfirmation);
  const submitHandlerRef = useRef<StudentSubmitHandler | null>(null);

  useLayoutEffect(() => {
    runtimeStateRef.current = runtimeState;
    runtimeActionsRef.current = runtimeActions;
    attemptStateRef.current = attemptState;
    attemptActionsRef.current = attemptActions;
    uiActionsRef.current = uiActions;
    handleViolationRef.current = handleViolation;
    sessionIdRef.current = sessionId;
    studentIdRef.current = studentId;
    shouldBlockClipboardRef.current = shouldBlockClipboard;
    shouldEnableAntiScreenshotGuardRef.current = shouldEnableAntiScreenshotGuard;
    submitRequiresConfirmationRef.current = submitRequiresConfirmation;
  }, [
    attemptActions,
    attemptState,
    handleViolation,
    runtimeActions,
    runtimeState,
    sessionId,
    shouldBlockClipboard,
    shouldEnableAntiScreenshotGuard,
    studentId,
    submitRequiresConfirmation,
    uiActions,
  ]);

  const registerSubmitHandler = useCallback((handler: StudentSubmitHandler | null) => {
    submitHandlerRef.current = handler;
    return () => {
      if (submitHandlerRef.current === handler) {
        submitHandlerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const screenshotShortcutCooldownMs = 2_000;
    let lastScreenshotShortcutAt = 0;

    if (
      shouldEnableAntiScreenshotGuardRef.current &&
      runtimeStateRef.current.phase === 'exam' &&
      isIpadSafari(navigator.userAgent) &&
      !screenshotUnsupportedLoggedRef.current
    ) {
      screenshotUnsupportedLoggedRef.current = true;
      void saveStudentAuditEvent(
        sessionIdRef.current,
        'SCREENSHOT_DETECTION_UNSUPPORTED',
        {
          platform: 'iPad Safari',
          userAgent: navigator.userAgent,
          reason: 'Hardware button screenshots are not detectable by browser JavaScript.',
        },
        studentIdRef.current,
      );
    }

    const handleRestrictedInteraction = (
      event: Event,
      type: string,
      message: string,
      severity: 'medium' | 'high' = 'medium',
    ) => {
      if (runtimeStateRef.current.phase !== 'exam') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleViolationRef.current(type, message, severity);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (runtimeStateRef.current.phase !== 'exam') {
        return;
      }

      const target = event.target;
      const editingTarget = isEditingTarget(target);
      const normalizedKey = event.key.toLowerCase();

      if (shouldEnableAntiScreenshotGuardRef.current && isScreenshotShortcut(event)) {
        const now = Date.now();
        event.preventDefault();
        event.stopPropagation();

        if (now - lastScreenshotShortcutAt < screenshotShortcutCooldownMs) {
          return;
        }
        lastScreenshotShortcutAt = now;

        handleViolationRef.current(
          'SCREENSHOT_ATTEMPT',
          'Screenshot attempt detected. The exam screen has been hidden. Acknowledge to continue.',
          'high',
        );
        return;
      }

      if (event.key === 'F12') {
        handleRestrictedInteraction(
          event,
          'RESTRICTED_SHORTCUT',
          'Developer tools shortcuts are blocked during the exam.',
          'high',
        );
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && blockedInspectorShortcuts.has(normalizedKey)) {
        handleRestrictedInteraction(
          event,
          'RESTRICTED_SHORTCUT',
          'Inspector shortcuts are blocked during the exam.',
          'high',
        );
        return;
      }

      if (editingTarget) {
        const undoRedoKind = historyKindFromUndoRedoShortcut(event);
        if (undoRedoKind) {
          event.preventDefault();
          event.stopPropagation();
          void saveStudentAuditEvent(
            sessionIdRef.current,
            undoRedoKind === 'undo' ? 'UNDO_BLOCKED' : 'REDO_BLOCKED',
            {
              surface: 'student-global',
              targetName: target instanceof HTMLElement ? target.tagName : 'unknown',
              via: 'keydown',
              cancelable: event.cancelable,
            },
            studentIdRef.current,
          );
          return;
        }
      }

      if (
        shouldBlockClipboardRef.current &&
        editingTarget &&
        (event.metaKey || event.ctrlKey) &&
        normalizedKey === 'v'
      ) {
        handleRestrictedInteraction(
          event,
          'CLIPBOARD_BLOCKED',
          'Pasting answers is blocked during the exam.',
        );
        return;
      }

      if (shouldBlockClipboardRef.current && (event.metaKey || event.ctrlKey) && blockedGlobalModifierKeys.has(normalizedKey)) {
        handleRestrictedInteraction(
          event,
          'RESTRICTED_SHORTCUT',
          'Print, search, and save shortcuts are blocked during the exam.',
        );
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void (async () => {
          if (submitRequiresConfirmationRef.current) {
            uiActionsRef.current.setShowSubmitConfirm(true);
            return;
          }

          const submitHandler = submitHandlerRef.current;
          if (submitHandler) {
            await submitHandler();
            return;
          }

          if (runtimeStateRef.current.runtimeBacked) {
            const flushed = await attemptActionsRef.current.flushPending();
            if (!flushed) {
              if (!navigator.onLine) {
                runtimeActionsRef.current.transitionBlocking('offline', true);
              } else {
                runtimeActionsRef.current.transitionBlocking('syncing_reconnect', true);
              }
              return;
            }

            runtimeActionsRef.current.transitionBlocking('syncing_reconnect', false);
            runtimeActionsRef.current.transitionBlocking('offline', false);
          }

          runtimeActionsRef.current.submitModule();
        })();
        return;
      }

      if (editingTarget) {
        if (
          allowedEditingKeys.has(event.key) ||
          (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
        ) {
          return;
        }

        return;
      }

      if (hasActiveSelectionWithinHighlightableContainer()) {
        return;
      }

      switch (normalizedKey) {
        case 'f':
          if (runtimeStateRef.current.currentQuestionId) {
            const nextFlagged = !(
              attemptStateRef.current.attempt?.flags?.[runtimeStateRef.current.currentQuestionId] ?? false
            );
            attemptActionsRef.current.persistFlag(runtimeStateRef.current.currentQuestionId, nextFlagged);
          }
          return;
        case 'n': {
          if (!runtimeStateRef.current.currentQuestionId) {
            return;
          }

          const currentIndex = runtimeStateRef.current.allQuestions.findIndex(
            (question) => question.id === runtimeStateRef.current.currentQuestionId,
          );
          if (currentIndex >= 0 && currentIndex < runtimeStateRef.current.allQuestions.length - 1) {
            const nextQuestion = runtimeStateRef.current.allQuestions[currentIndex + 1];
            if (nextQuestion) {
              runtimeActionsRef.current.setCurrentQuestionId(nextQuestion.id);
            }
          }
          return;
        }
        case 'p': {
          if (!runtimeStateRef.current.currentQuestionId) {
            return;
          }

          const currentIndex = runtimeStateRef.current.allQuestions.findIndex(
            (question) => question.id === runtimeStateRef.current.currentQuestionId,
          );
          if (currentIndex > 0) {
            const previousQuestion = runtimeStateRef.current.allQuestions[currentIndex - 1];
            if (previousQuestion) {
              runtimeActionsRef.current.setCurrentQuestionId(previousQuestion.id);
            }
          }
          return;
        }
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          const questionIndex = Number.parseInt(normalizedKey, 10) - 1;
          if (questionIndex >= 0 && questionIndex < runtimeStateRef.current.allQuestions.length) {
            const targetQuestion = runtimeStateRef.current.allQuestions[questionIndex];
            if (targetQuestion) {
              runtimeActionsRef.current.setCurrentQuestionId(targetQuestion.id);
            }
          }
          return;
        }
        default:
          return;
      }
    };

    const handleClipboardEvent = (event: ClipboardEvent) => {
      if ((event.type === 'copy' || event.type === 'cut') && isWithinHighlightableContainer(event.target)) {
        // Reading/listening passage text surfaces are intentionally copy/cut-allowed.
        return;
      }

      if (!shouldBlockClipboardRef.current || event.type !== 'paste') {
        return;
      }

      const target = event.target;
      if (!isEditingTarget(target)) {
        return;
      }
      const targetElement = target instanceof HTMLElement ? target : null;
      
      // Log paste attempts with metadata
      if (event.type === 'paste') {
        saveStudentAuditEvent(
          sessionIdRef.current,
          'PASTE_BLOCKED',
          {
            targetName: targetElement?.tagName ?? 'unknown',
            targetType: targetElement?.getAttribute('type') ?? targetElement?.tagName ?? 'unknown',
            isContentEditable: targetElement?.isContentEditable ?? false,
          },
          studentIdRef.current,
        );
      }
      
      handleRestrictedInteraction(
        event,
        'CLIPBOARD_BLOCKED',
        'Pasting answers is blocked during the exam.',
      );
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (isWithinQuestionCalloutProtectedText(event.target)) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleClipboardEvent);
    document.addEventListener('cut', handleClipboardEvent);
    document.addEventListener('paste', handleClipboardEvent);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleClipboardEvent);
      document.removeEventListener('cut', handleClipboardEvent);
      document.removeEventListener('paste', handleClipboardEvent);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const contextValue = useMemo<KeyboardContextValue>(() => ({ registerSubmitHandler }), [registerSubmitHandler]);

  return <KeyboardContext.Provider value={contextValue}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard() {
  return useKeyboardSubmitHandler();
}

export function useKeyboardSubmitHandler() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardSubmitHandler must be used within KeyboardProvider');
  }
  return context;
}
