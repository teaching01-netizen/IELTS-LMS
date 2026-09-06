import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ExamPublishState {
  publishNotes: string;
  scheduledTime: string;
  showSchedule: boolean;
  /** Last gating rejection (permission or missing confirmation). Null when the last action passed gating. */
  gatingError: string | null;
}

interface DestructiveConfirmOptions {
  /** Must be true: destructive actions never fire bare. */
  confirmed?: boolean;
}

interface ExamPublishActions {
  setPublishNotes: (notes: string) => void;
  setScheduledTime: (time: string) => void;
  setShowSchedule: (show: boolean) => void;
  gatingError: string | null;
  clearGatingError: () => void;
  handlePublish: (notes?: string) => void;
  handleSchedulePublish: (scheduledTime: string, notes?: string) => void;
  handleUnpublish: (reason?: string, opts?: DestructiveConfirmOptions) => void;
  handleArchive: (opts?: DestructiveConfirmOptions) => void;
}

interface ExamPublishContextValue {
  state: ExamPublishState;
  actions: ExamPublishActions;
}

const ExamPublishContext = createContext<ExamPublishContextValue | null>(null);

interface ExamPublishProviderProps {
  children: ReactNode;
  /** Permission/role gate: when false every publish action is blocked. Defaults to false (deny-by-default). */
  canPublish?: boolean;
  onPublish?: (notes?: string) => void;
  onSchedulePublish?: (scheduledTime: string, notes?: string) => void;
  onUnpublish?: (reason?: string) => void;
  onArchive?: () => void;
  /** Optional observer for gating rejections (e.g. toast). Throwing remains the primary signal. */
  onGatingError?: (message: string) => void;
}

export function ExamPublishProvider({
  children,
  canPublish = false,
  onPublish,
  onSchedulePublish,
  onUnpublish,
  onArchive,
  onGatingError,
}: ExamPublishProviderProps) {
  const [publishNotes, setPublishNotes] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [gatingError, setGatingError] = useState<string | null>(null);

  const reject = useCallback((message: string): never => {
    setGatingError(message);
    onGatingError?.(message);
    throw new Error(message);
  }, [onGatingError]);

  const clearGatingError = useCallback(() => {
    setGatingError(null);
  }, []);

  const requirePermission = useCallback((action: string) => {
    if (!canPublish) {
      reject(`Publish permission required: ${action} is blocked.`);
    }
  }, [canPublish, reject]);

  const handlePublish = useCallback((notes?: string) => {
    requirePermission('publish');
    if (onPublish) {
      onPublish(notes || publishNotes);
      setPublishNotes('');
      setShowSchedule(false);
      setGatingError(null);
    }
  }, [onPublish, publishNotes, requirePermission]);

  const handleSchedulePublish = useCallback((time: string, notes?: string) => {
    requirePermission('schedule publish');
    if (!time || time.trim() === '') {
      reject('A scheduled time is required before scheduling publish.');
    }
    if (onSchedulePublish) {
      onSchedulePublish(time, notes || publishNotes);
      setPublishNotes('');
      setScheduledTime('');
      setShowSchedule(false);
      setGatingError(null);
    }
  }, [onSchedulePublish, publishNotes, reject, requirePermission]);

  const handleUnpublish = useCallback((reason?: string, opts?: DestructiveConfirmOptions) => {
    requirePermission('unpublish');
    // Destructive: never fire bare — caller must pass an explicit confirmation payload.
    if (opts?.confirmed !== true) {
      reject('Unpublish requires explicit confirmation (pass { confirmed: true }).');
    }
    if (onUnpublish) {
      onUnpublish(reason);
      setGatingError(null);
    }
  }, [onUnpublish, reject, requirePermission]);

  const handleArchive = useCallback((opts?: DestructiveConfirmOptions) => {
    requirePermission('archive');
    // Destructive: never fire bare — caller must pass an explicit confirmation payload.
    if (opts?.confirmed !== true) {
      reject('Archive requires explicit confirmation (pass { confirmed: true }).');
    }
    if (onArchive) {
      onArchive();
      setGatingError(null);
    }
  }, [onArchive, reject, requirePermission]);

  const state: ExamPublishState = {
    publishNotes,
    scheduledTime,
    showSchedule,
    gatingError,
  };

  const actions: ExamPublishActions = {
    setPublishNotes,
    setScheduledTime,
    setShowSchedule,
    gatingError,
    clearGatingError,
    handlePublish,
    handleSchedulePublish,
    handleUnpublish,
    handleArchive,
  };

  return (
    <ExamPublishContext.Provider value={{ state, actions }}>
      {children}
    </ExamPublishContext.Provider>
  );
}

export function useExamPublish() {
  const context = useContext(ExamPublishContext);
  if (!context) {
    throw new Error('useExamPublish must be used within ExamPublishProvider');
  }
  return context;
}
