import React, { useEffect, useRef, type ReactNode } from 'react';
import { countAnsweredQuestions, countQuestionSlots } from '@services/examAdapterService';
import { useProctoring } from './StudentProctoringProvider';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import { useStudentUI } from './StudentUIProvider';

interface KeyboardProviderProps {
  children: ReactNode;
}

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
  const { state: uiState, actions: uiActions } = useStudentUI();
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

  useEffect(() => {
    const screenshotShortcutCooldownMs = 2_000;
    let lastScreenshotShortcutAt = 0;

    if (
      shouldEnableAntiScreenshotGuard &&
      runtimeState.phase === 'exam' &&
      isIpadSafari(navigator.userAgent) &&
      !screenshotUnsupportedLoggedRef.current
    ) {
      screenshotUnsupportedLoggedRef.current = true;
      void saveStudentAuditEvent(
        sessionId,
        'SCREENSHOT_DETECTION_UNSUPPORTED',
        {
          platform: 'iPad Safari',
          userAgent: navigator.userAgent,
          reason: 'Hardware button screenshots are not detectable by browser JavaScript.',
        },
        studentId,
      );
    }

    const handleRestrictedInteraction = (
      event: Event,
      type: string,
      message: string,
      severity: 'medium' | 'high' = 'medium',
    ) => {
      if (runtimeState.phase !== 'exam') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleViolation(type, message, severity);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (runtimeState.phase !== 'exam') {
        return;
      }

      const target = event.target;
      const editingTarget = isEditingTarget(target);
      const normalizedKey = event.key.toLowerCase();

      if (shouldEnableAntiScreenshotGuard && isScreenshotShortcut(event)) {
        const now = Date.now();
        event.preventDefault();
        event.stopPropagation();

        if (now - lastScreenshotShortcutAt < screenshotShortcutCooldownMs) {
          return;
        }
        lastScreenshotShortcutAt = now;

        handleViolation(
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
            sessionId,
            undoRedoKind === 'undo' ? 'UNDO_BLOCKED' : 'REDO_BLOCKED',
            {
              surface: 'student-global',
              targetName: target instanceof HTMLElement ? target.tagName : 'unknown',
              via: 'keydown',
              cancelable: event.cancelable,
            },
            studentId,
          );
          return;
        }
      }

      if (
        shouldBlockClipboard &&
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

      if (shouldBlockClipboard && (event.metaKey || event.ctrlKey) && blockedGlobalModifierKeys.has(normalizedKey)) {
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
          if (submitRequiresConfirmation) {
            uiActions.setShowSubmitConfirm(true);
            return;
          }

          if (runtimeState.runtimeBacked) {
            const flushed = await attemptActions.flushPending();
            if (!flushed) {
              if (!navigator.onLine) {
                runtimeActions.transitionBlocking('offline', true);
              } else {
                runtimeActions.transitionBlocking('syncing_reconnect', true);
              }
              return;
            }

            runtimeActions.transitionBlocking('syncing_reconnect', false);
            runtimeActions.transitionBlocking('offline', false);
          }

          runtimeActions.submitModule();
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

      switch (normalizedKey) {
        case 'f':
          if (runtimeState.currentQuestionId) {
            const nextFlagged = !(attemptState.attempt?.flags?.[runtimeState.currentQuestionId] ?? false);
            attemptActions.persistFlag(runtimeState.currentQuestionId, nextFlagged);
          }
          return;
        case 'n': {
          if (!runtimeState.currentQuestionId) {
            return;
          }

          const currentIndex = runtimeState.allQuestions.findIndex(
            (question) => question.id === runtimeState.currentQuestionId,
          );
          if (currentIndex >= 0 && currentIndex < runtimeState.allQuestions.length - 1) {
            const nextQuestion = runtimeState.allQuestions[currentIndex + 1];
            if (nextQuestion) {
              runtimeActions.setCurrentQuestionId(nextQuestion.id);
            }
          }
          return;
        }
        case 'p': {
          if (!runtimeState.currentQuestionId) {
            return;
          }

          const currentIndex = runtimeState.allQuestions.findIndex(
            (question) => question.id === runtimeState.currentQuestionId,
          );
          if (currentIndex > 0) {
            const previousQuestion = runtimeState.allQuestions[currentIndex - 1];
            if (previousQuestion) {
              runtimeActions.setCurrentQuestionId(previousQuestion.id);
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
          if (questionIndex >= 0 && questionIndex < runtimeState.allQuestions.length) {
            const targetQuestion = runtimeState.allQuestions[questionIndex];
            if (targetQuestion) {
              runtimeActions.setCurrentQuestionId(targetQuestion.id);
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

      if (!shouldBlockClipboard || event.type !== 'paste') {
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
          sessionId,
          'PASTE_BLOCKED',
          {
            targetName: targetElement?.tagName ?? 'unknown',
            targetType: targetElement?.getAttribute('type') ?? targetElement?.tagName ?? 'unknown',
            isContentEditable: targetElement?.isContentEditable ?? false,
          },
          studentId,
        );
      }
      
      handleRestrictedInteraction(
        event,
        'CLIPBOARD_BLOCKED',
        'Pasting answers is blocked during the exam.',
      );
    };

    const handleContextMenu = (_event: MouseEvent) => {
      // Native callout/context menu is intentionally allowed across exam text surfaces.
    };

    const handleDragDrop = (event: DragEvent) => {
      if (!shouldBlockClipboard) {
        return;
      }

      if (event.type === 'dragstart') {
        const target = event.target;
        const withinHighlightableContainer = isWithinHighlightableContainer(target);

        // Allow drag-selection gestures for all student highlightable text
        // surfaces; blocking dragstart here can clear active selection on some
        // browsers/touch devices.
        if (withinHighlightableContainer) {
          return;
        }
      }

      handleRestrictedInteraction(
        event,
        'DRAG_DROP_BLOCKED',
        'Drag and drop is blocked during the exam.',
      );
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleClipboardEvent);
    document.addEventListener('cut', handleClipboardEvent);
    document.addEventListener('paste', handleClipboardEvent);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragDrop);
    document.addEventListener('drop', handleDragDrop);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleClipboardEvent);
      document.removeEventListener('cut', handleClipboardEvent);
      document.removeEventListener('paste', handleClipboardEvent);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('dragstart', handleDragDrop);
      document.removeEventListener('drop', handleDragDrop);
    };
  }, [
    attemptActions,
    attemptState.attempt?.scheduleId,
    attemptState.attemptId,
    examState.config.security.antiScreenshotGuardEnabled,
    examState.config.security.blockClipboard,
    examState.config.progression.unansweredSubmissionPolicy,
    handleViolation,
    runtimeActions,
    runtimeState,
    submitRequiresConfirmation,
    uiActions,
  ]);

  return <>{children}</>;
}

export function useKeyboard() {
  return undefined;
}
