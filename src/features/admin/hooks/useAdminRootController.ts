import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import {
  adminPreferencesKeys,
  useExamDefaultsQuery,
  type ExamDefaultsSnapshot,
} from '../api/adminPreferencesQueries';
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

  const queryClient = useQueryClient();
  const loadsDefaults = role === 'admin' || role === 'builder';
  const defaultsQuery = useExamDefaultsQuery(loadsDefaults);
  const [fallbackDefaults] = useState<ExamConfig>(() => examAuthoringFacade.preferences.getDefaults());
  // Unsaved or pending local edits. Null means the screen shows the confirmed
  // server defaults, so a refetch may replace them; a draft is never replaced.
  const [draft, setDraft] = useState<ExamConfig | null>(null);
  const [defaultsSaveIssue, setDefaultsSaveIssue] = useState<DefaultsSaveIssue | null>(null);
  // Saves are serialized and latest-wins: each one carries the revision the
  // previous acknowledgement returned, and only the newest queued draft is sent.
  const latestDraftRef = useRef<ExamConfig | null>(null);
  const queuedSaveRef = useRef<{ config: ExamConfig; overwrite: boolean } | null>(null);
  const saveLoopRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  // A reload abandons the current draft; acknowledgements started before it
  // still confirm server state but cannot change this screen's draft or banner.
  const draftGenerationRef = useRef(0);
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

  const confirmedBase = useCallback((): ExamDefaultsSnapshot => {
    const cached = queryClient.getQueryData<ExamDefaultsSnapshot>(adminPreferencesKeys.examDefaults());
    return cached ?? { config: fallbackDefaults, revision: 0, stored: false };
  }, [fallbackDefaults, queryClient]);

  const confirm = useCallback((snapshot: ExamDefaultsSnapshot) => {
    queryClient.setQueryData<ExamDefaultsSnapshot>(adminPreferencesKeys.examDefaults(), (current) =>
      current && current.stored && current.revision > snapshot.revision ? current : snapshot,
    );
  }, [queryClient]);

  const reload = useCallback(async () => {
    draftGenerationRef.current += 1;
    latestDraftRef.current = null;
    queuedSaveRef.current = null;
    conflictRef.current = false;
    setDraft(null);
    setDefaultsSaveIssue(null);
    if (loadsDefaults) {
      await queryClient.refetchQueries({ queryKey: adminPreferencesKeys.examDefaults(), exact: true });
    }
  }, [loadsDefaults, queryClient]);

  const persistDefaults = useCallback((config: ExamConfig, overwrite = false) => {
    queuedSaveRef.current = { config, overwrite };
    if (saveLoopRef.current) return;
    saveLoopRef.current = (async () => {
      try {
        while (queuedSaveRef.current) {
          const job = queuedSaveRef.current;
          queuedSaveRef.current = null;
          const generation = draftGenerationRef.current;
          try {
            const acknowledged = await examAuthoringFacade.preferences.saveDefaults(
              job.config,
              confirmedBase(),
              job.overwrite ? { overwrite: true } : {},
            );
            confirm(acknowledged);
            if (generation !== draftGenerationRef.current) continue;
            conflictRef.current = false;
            setDefaultsSaveIssue(null);
            // Adopt the acknowledged document only when no newer edit exists.
            if (latestDraftRef.current === job.config && !queuedSaveRef.current) {
              latestDraftRef.current = null;
              setDraft(null);
            }
          } catch (saveError) {
            if (generation !== draftGenerationRef.current) continue;
            // Stop here: never chain newer saves onto a failed or conflicting
            // base. The draft stays on screen; the admin retries explicitly.
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
  }, [confirm, confirmedBase]);

  const setDefaults = useCallback((config: ExamConfig) => {
    latestDraftRef.current = config;
    setDraft(config);
    // While a conflict is unresolved, edits stay local instead of re-sending
    // a document the server would reject (or, worse, accept over theirs).
    if (!conflictRef.current) persistDefaults(config);
  }, [persistDefaults]);

  const defaults = draft ?? (loadsDefaults ? defaultsQuery.data?.config : undefined) ?? fallbackDefaults;
  const isInitialized = !loadsDefaults || !defaultsQuery.isPending;
  const defaultsLoadError = defaultsQuery.error
    ? defaultsQuery.error instanceof Error ? defaultsQuery.error.message : 'Failed to load saved exam defaults.'
    : null;

  const retryDefaultsSave = useCallback(
    () => persistDefaults(latestDraftRef.current ?? defaults),
    [defaults, persistDefaults],
  );
  const overwriteDefaults = useCallback(
    () => persistDefaults(latestDraftRef.current ?? defaults, true),
    [defaults, persistDefaults],
  );

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
    reload,
    sidebarOpen,
    setSidebarOpen,
  };
}
