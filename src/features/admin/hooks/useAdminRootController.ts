import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface AdminRootController {
  contextValue: AdminContextValue;
  currentView: AdminNavItem['id'];
  initError: string | null;
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
  const [initError, setInitError] = useState<string | null>(null);
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
    setInitError(null);

    try {
      const shouldLoadDefaults = role === 'admin' || role === 'builder';
      const shouldSeedFixtures = role === 'admin' || role === 'builder';

      const tasks = await Promise.all([
        shouldSeedFixtures ? examAuthoringFacade.seedDevelopmentFixtures() : Promise.resolve(),
        shouldLoadDefaults
          ? examAuthoringFacade.preferences.loadDefaults()
          : Promise.resolve(examAuthoringFacade.preferences.getDefaults()),
      ]);

      setDefaultsState(tasks[1]);
    } catch (loadError) {
      setInitError(loadError instanceof Error ? loadError.message : 'Failed to load admin data');
    } finally {
      setIsInitialized(true);
    }
  }, [role]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const setDefaults = useCallback((config: ExamConfig) => {
    setDefaultsState(config);
    void examAuthoringFacade.preferences.saveDefaults(config);
  }, []);

  const handleNavigate = useCallback((mode: 'builder' | 'student' | 'admin' | 'proctor') => {
    navigate(`/${mode}`);
  }, [navigate]);

  const contextValue = useMemo<AdminContextValue>(
    () => ({
      onNavigate: handleNavigate,
      defaults,
      setDefaults,
      isInitialized,
      initError,
    }),
    [
      defaults,
      handleNavigate,
      initError,
      isInitialized,
      setDefaults,
    ],
  );

  return {
    contextValue,
    currentView,
    initError,
    isInitialized,
    navItems,
    notificationCount: 0,
    reload: initialize,
    sidebarOpen,
    setSidebarOpen,
  };
}
