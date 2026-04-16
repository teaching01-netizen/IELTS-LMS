import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ExamPublishState {
  publishNotes: string;
  scheduledTime: string;
  showSchedule: boolean;
}

interface ExamPublishActions {
  setPublishNotes: (notes: string) => void;
  setScheduledTime: (time: string) => void;
  setShowSchedule: (show: boolean) => void;
  handlePublish: (notes?: string) => void;
  handleSchedulePublish: (scheduledTime: string, notes?: string) => void;
  handleUnpublish: (reason?: string) => void;
  handleArchive: () => void;
}

interface ExamPublishContextValue {
  state: ExamPublishState;
  actions: ExamPublishActions;
}

const ExamPublishContext = createContext<ExamPublishContextValue | null>(null);

interface ExamPublishProviderProps {
  children: ReactNode;
  onPublish?: (notes?: string) => void;
  onSchedulePublish?: (scheduledTime: string, notes?: string) => void;
  onUnpublish?: (reason?: string) => void;
  onArchive?: () => void;
}

export function ExamPublishProvider({ 
  children, 
  onPublish, 
  onSchedulePublish, 
  onUnpublish, 
  onArchive 
}: ExamPublishProviderProps) {
  const [publishNotes, setPublishNotes] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);

  const handlePublish = useCallback((notes?: string) => {
    if (onPublish) {
      onPublish(notes || publishNotes);
      setPublishNotes('');
      setShowSchedule(false);
    }
  }, [onPublish, publishNotes]);

  const handleSchedulePublish = useCallback((time: string, notes?: string) => {
    if (onSchedulePublish) {
      onSchedulePublish(time, notes || publishNotes);
      setPublishNotes('');
      setScheduledTime('');
      setShowSchedule(false);
    }
  }, [onSchedulePublish, publishNotes]);

  const handleUnpublish = useCallback((reason?: string) => {
    if (onUnpublish) {
      onUnpublish(reason);
    }
  }, [onUnpublish]);

  const handleArchive = useCallback(() => {
    if (onArchive) {
      onArchive();
    }
  }, [onArchive]);

  const state: ExamPublishState = {
    publishNotes,
    scheduledTime,
    showSchedule,
  };

  const actions: ExamPublishActions = {
    setPublishNotes,
    setScheduledTime,
    setShowSchedule,
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
