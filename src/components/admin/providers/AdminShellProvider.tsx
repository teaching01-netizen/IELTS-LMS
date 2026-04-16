import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export type AdminView = 'dashboard' | 'exams' | 'people' | 'scheduling' | 'cohorts' | 'grading' | 'results' | 'settings';

export type GradingLevel = 'list' | 'session' | 'student';

interface AdminShellState {
  currentView: AdminView;
  sidebarOpen: boolean;
  notificationCount: number;
  gradingLevel: GradingLevel;
  selectedSessionId: string | null;
  selectedSubmissionId: string | null;
}

interface AdminShellActions {
  setCurrentView: (view: AdminView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setNotificationCount: (count: number) => void;
  setGradingLevel: (level: GradingLevel) => void;
  selectSession: (sessionId: string) => void;
  selectSubmission: (submissionId: string) => void;
  handleGradingBack: () => void;
  handleGradingExit: () => void;
}

interface AdminShellContextValue {
  state: AdminShellState;
  actions: AdminShellActions;
}

const AdminShellContext = createContext<AdminShellContextValue | null>(null);

interface AdminShellProviderProps {
  children: ReactNode;
  initialView?: AdminView;
}

export function AdminShellProvider({ children, initialView = 'dashboard' }: AdminShellProviderProps) {
  const [currentView, setCurrentView] = useState<AdminView>(initialView);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notificationCount, setNotificationCount] = useState(3);
  const [gradingLevel, setGradingLevel] = useState<GradingLevel>('list');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setGradingLevel('session');
  }, []);

  const selectSubmission = useCallback((submissionId: string) => {
    setSelectedSubmissionId(submissionId);
    setGradingLevel('student');
  }, []);

  const handleGradingBack = useCallback(() => {
    if (gradingLevel === 'student') {
      setGradingLevel('session');
      setSelectedSubmissionId(null);
    } else if (gradingLevel === 'session') {
      setGradingLevel('list');
      setSelectedSessionId(null);
    }
  }, [gradingLevel]);

  const handleGradingExit = useCallback(() => {
    setGradingLevel('list');
    setSelectedSessionId(null);
    setSelectedSubmissionId(null);
  }, []);

  // Reset grading level when switching away from grading view
  useEffect(() => {
    if (currentView !== 'grading') {
      handleGradingExit();
    }
  }, [currentView, handleGradingExit]);

  const state: AdminShellState = {
    currentView,
    sidebarOpen,
    notificationCount,
    gradingLevel,
    selectedSessionId,
    selectedSubmissionId,
  };

  const actions: AdminShellActions = {
    setCurrentView,
    toggleSidebar,
    setSidebarOpen,
    setNotificationCount,
    setGradingLevel,
    selectSession,
    selectSubmission,
    handleGradingBack,
    handleGradingExit,
  };

  return (
    <AdminShellContext.Provider value={{ state, actions }}>
      {children}
    </AdminShellContext.Provider>
  );
}

export function useAdminShell() {
  const context = useContext(AdminShellContext);
  if (!context) {
    throw new Error('useAdminShell must be used within AdminShellProvider');
  }
  return context;
}
