import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Calendar,
  CheckSquare,
  Settings,
} from 'lucide-react';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
import { useAuthSession } from '../../auth/api/authSession';
import type { ExamConfig } from '../../../types';
import type { AdminContextValue } from '../routes/AdminContext';

interface AdminNavItem {
  id: 'exams' | 'library' | 'scheduling' | 'grading' | 'results' | 'settings';
  label: string;
  icon: typeof BookOpen;
  path: string;
}

/** A defaults save that did not land; the draft stays on screen either way. */
export type DefaultsSaveIssue =
  | { kind: 'failed'; message: string }
  | { kind: 'conflict'; message: string };

interface AdminRootController {
  contextValue: AdminContextValue;
  currentView: AdminNavItem['id'];
  defaultsLoadError: string | null;
  defaultsSaveIssue: DefaultsSaveIssue | null;
  /** Retry a failed save, or keep this draft over a conflicting remote edit. */
  retryDefaultsSave: () => void;
  overwriteDefaults: () => void;
  isInitialized: boolean;
  navItems: AdminNavItem[];
  notificationCount: number;
  reload: () => Promise<void>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
}

export function useAdminRootController(): AdminRootController {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuthSession();
  const role = session?.user.role;

  const [defaults, setDefaultsState] = useState<ExamConfig>(() =>
    examAuthoringFacade.preferences.getDefaults(),
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const [defaultsLoadError, setDefaultsLoadError] = useState<string | null>(null);
  const [defaultsSaveIssue, setDefaultsSaveIssue] = useState<DefaultsSaveIssue | null>(null);
  // Saves are serialized and latest-wins: each one carries the revision the
  // previous acknowledgement returned, and only the newest queued draft is sent.
  const latestDraftRef = useRef<ExamConfig>(defaults);
  const queuedSaveRef = useRef<{ config: ExamConfig; overwrite: boolean } | null>(null);
  const saveLoopRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768,
  );

  const navItems = useMemo<AdminNavItem[]>(
    () => {
      if (role === 'grader') {
        return [
          { id: 'grading', label: 'Grading', icon: CheckSquare, path: '/admin/grading' },
          { id: 'results', label: 'Results', icon: BarChart3, path: '/admin/results' },
          { id: 'scheduling', label: 'Scheduling', icon: Calendar, path: '/admin/scheduling' },
        ];
      }

      if (role === 'builder') {
        return [
          { id: 'exams', label: 'Exams', icon: BookOpen, path: '/admin/exams' },
          { id: 'library', label: 'Library', icon: BookOpen, path: '/admin/library' },
          { id: 'scheduling', label: 'Scheduling', icon: Calendar, path: '/admin/scheduling' },
          { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
        ];
      }

      return [
        { id: 'exams', label: 'Exams', icon: BookOpen, path: '/admin/exams' },
        { id: 'library', label: 'Library', icon: BookOpen, path: '/admin/library' },
        { id: 'scheduling', label: 'Scheduling', icon: Calendar, path: '/admin/scheduling' },
        { id: 'grading', label: 'Grading', icon: CheckSquare, path: '/admin/grading' },
        { id: 'results', label: 'Results', icon: BarChart3, path: '/admin/results' },
        { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
      ];
    },
    [role],
  );

  const currentView = useMemo<AdminNavItem['id']>(() => {
    const path = location.pathname;

    if (path === '/admin' || path.startsWith('/admin/exams')) return 'exams';
    if (path.startsWith('/admin/library')) return 'library';
    if (path.startsWith('/admin/scheduling')) return 'scheduling';
    if (path.startsWith('/admin/grading')) return 'grading';
    if (path.startsWith('/admin/results')) return 'results';
    if (path.startsWith('/admin/settings')) return 'settings';

    return 'exams';
  }, [location.pathname]);

  const initialize = useCallback(async () => {
    setIsInitialized(false);
    setDefaultsLoadError(null);
    setDefaultsSaveIssue(null);
    conflictRef.current = false;
    queuedSaveRef.current = null;

    try {
      const shouldLoadDefaults = role === 'admin' || role === 'builder';
      const loadedDefaults = shouldLoadDefaults
        ? await examAuthoringFacade.preferences.loadDefaults()
        : examAuthoringFacade.preferences.getDefaults();

      latestDraftRef.current = loadedDefaults;
      setDefaultsState(loadedDefaults);
    } catch (loadError) {
      setDefaultsLoadError(
        loadError instanceof Error ? loadError.message : 'Failed to load saved exam defaults.',
      );
    } finally {
      setIsInitialized(true);
    }
  }, [role]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const persistDefaults = useCallback((config: ExamConfig, overwrite = false) => {
    queuedSaveRef.current = { config, overwrite };
    if (saveLoopRef.current) return;
    saveLoopRef.current = (async () => {
      try {
        while (queuedSaveRef.current) {
          const job = queuedSaveRef.current;
          queuedSaveRef.current = null;
          try {
            await examAuthoringFacade.preferences.saveDefaults(job.config, job.overwrite ? { overwrite: true } : {});
            conflictRef.current = false;
            setDefaultsSaveIssue(null);
          } catch (saveError) {
            // Stop here: never chain newer saves onto a failed or conflicting
            // base. The draft stays on screen; the grader retries explicitly.
            queuedSaveRef.current = null;
            const conflict = (saveError as { code?: unknown } | null)?.code === 'EXAM_DEFAULTS_CONFLICT';
            conflictRef.current = conflict;
            setDefaultsSaveIssue(
              conflict
                ? { kind: 'conflict', message: 'Another admin changed the exam defaults since you opened them.' }
                : { kind: 'failed', message: saveError instanceof Error ? saveError.message : 'Failed to save exam defaults.' },
            );
          }
        }
      } finally {
        saveLoopRef.current = null;
      }
    })();
  }, []);

  const setDefaults = useCallback((config: ExamConfig) => {
    latestDraftRef.current = config;
    setDefaultsState(config);
    // While a conflict is unresolved, edits stay local instead of re-sending
    // a document the server would reject (or, worse, accept over theirs).
    if (!conflictRef.current) persistDefaults(config);
  }, [persistDefaults]);

  const retryDefaultsSave = useCallback(() => persistDefaults(latestDraftRef.current), [persistDefaults]);
  const overwriteDefaults = useCallback(() => persistDefaults(latestDraftRef.current, true), [persistDefaults]);

  const handleNavigate = useCallback((mode: 'builder' | 'student' | 'admin' | 'proctor') => {
    navigate(`/${mode}`);
  }, [navigate]);

  const contextValue = useMemo<AdminContextValue>(
    () => ({
      onNavigate: handleNavigate,
      defaults,
      setDefaults,
      isInitialized,
      initError: null,
    }),
    [
      defaults,
      handleNavigate,
      isInitialized,
      setDefaults,
    ],
  );

  return {
    contextValue,
    currentView,
    defaultsLoadError,
    defaultsSaveIssue,
    retryDefaultsSave,
    overwriteDefaults,
    isInitialized,
    navItems,
    notificationCount: 0,
    reload: initialize,
    sidebarOpen,
    setSidebarOpen,
  };
}
