import React, { useEffect, type ReactNode } from 'react';
import { useProctoring } from './StudentProctoringProvider';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import { useStudentUI } from './StudentUIProvider';

interface KeyboardProviderProps {
  children: ReactNode;
}

const blockedModifierKeys = new Set([
  'a',
  'c',
  'f',
  'p',
  's',
  'v',
  'x',
]);

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

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const { state: runtimeState, actions: runtimeActions, examState } = useStudentRuntime();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const { state: uiState, actions: uiActions } = useStudentUI();
  const { handleViolation } = useProctoring();

  const sessionId = attemptState.attempt?.scheduleId;
  const studentId = attemptState.attemptId ?? undefined;
  const shouldBlockClipboard = examState.config.security.blockClipboard !== false;

  useEffect(() => {
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

      if (shouldBlockClipboard && (event.metaKey || event.ctrlKey) && blockedModifierKeys.has(normalizedKey)) {
        if (editingTarget && normalizedKey === 'a' && !event.altKey && !event.shiftKey) {
          return;
        }

        handleRestrictedInteraction(
          event,
          'RESTRICTED_SHORTCUT',
          'Copy, paste, print, search, and save shortcuts are blocked during the exam.',
        );
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void (async () => {
          if (runtimeState.submitRequiresConfirmation) {
            uiActions.setShowSubmitConfirm(true);
            return;
          }

          if (runtimeState.runtimeBacked) {
            const flushed = await attemptActions.flushPending();
            if (!flushed) {
              runtimeActions.setBlockingReason(navigator.onLine ? 'syncing_reconnect' : 'offline');
              return;
            }

            runtimeActions.setBlockingReason(null);
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
            runtimeActions.toggleFlag(runtimeState.currentQuestionId);
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
      if (!shouldBlockClipboard) {
        return;
      }

      const target = event.target;
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
        'Clipboard operations are blocked during the exam.',
      );
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!shouldBlockClipboard) {
        return;
      }

      handleRestrictedInteraction(
        event,
        'CONTEXT_MENU_BLOCKED',
        'The context menu is blocked during the exam.',
      );
    };

    const handleDragDrop = (event: DragEvent) => {
      if (!shouldBlockClipboard) {
        return;
      }

      if (event.type === 'dragstart') {
        const target = event.target;
        const targetElement = target instanceof HTMLElement ? target : null;
        const highlightModeEnabled = uiState.accessibilitySettings.highlightMode;
        const moduleAllowsHighlightDrag =
          runtimeState.currentModule === 'reading' || runtimeState.currentModule === 'listening';
        const withinHighlightableContainer = Boolean(
          targetElement?.closest('[data-student-highlightable="true"]'),
        );

        if (highlightModeEnabled && moduleAllowsHighlightDrag && withinHighlightableContainer) {
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
    examState.config.security.blockClipboard,
    handleViolation,
    runtimeActions,
    runtimeState,
    uiState.accessibilitySettings.highlightMode,
    uiActions,
  ]);

  return <>{children}</>;
}

export function useKeyboard() {
  return undefined;
}
