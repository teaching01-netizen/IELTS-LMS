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
import { adminPreferencesRepository } from '@services/adminPreferencesRepository';
import { seedDevelopmentFixtures } from '@services/developmentFixtures';
import {
  adaptExamEntitiesToLegacyExams,
  createInitialExamState,
} from '@services/examAdapterService';
import { examDeliveryService } from '@services/examDeliveryService';
import { examLifecycleService } from '@services/examLifecycleService';
import { examRepository } from '@services/examRepository';
import { useAuthSession } from '../../auth/authSession';
import type { Exam, ExamConfig } from '../../../types';
import type {
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamVersionSummary,
  VersionDiff,
} from '../../../types/domain';
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

  const [exams, setExams] = useState<Exam[]>([]);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [loadedExamEntities, setLoadedExamEntities] = useState<ExamEntity[]>([]);
  const [defaults, setDefaultsState] = useState<ExamConfig>(() =>
    adminPreferencesRepository.getDefaults(),
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const refreshExamData = useCallback(async () => {
    const entities = await examRepository.getAllExamsWithLegacyMigration();
    setLoadedExamEntities(entities);
    setExams(await adaptExamEntitiesToLegacyExams(entities, examRepository));
    return entities;
  }, []);

  const refreshScheduleData = useCallback(async () => {
    const loadedSchedules = await examRepository.getAllSchedules();
    setSchedules(loadedSchedules);
    return loadedSchedules;
  }, []);

  const initialize = useCallback(async () => {
    setIsInitialized(false);
    setInitError(null);

    try {
      const shouldLoadExamData = role === 'admin' || role === 'builder';
      const shouldLoadDefaults = role === 'admin' || role === 'builder';
      const shouldSeedFixtures = role === 'admin' || role === 'builder';

      const tasks = await Promise.all([
        shouldLoadExamData ? refreshExamData() : Promise.resolve<ExamEntity[]>([]),
        refreshScheduleData(),
        shouldSeedFixtures ? seedDevelopmentFixtures() : Promise.resolve(),
        shouldLoadDefaults
          ? adminPreferencesRepository.loadDefaults()
          : Promise.resolve(adminPreferencesRepository.getDefaults()),
      ]);

      if (!shouldLoadExamData) {
        setLoadedExamEntities([]);
        setExams([]);
      }

      setDefaultsState(tasks[3]);
    } catch (loadError) {
      setInitError(loadError instanceof Error ? loadError.message : 'Failed to load admin data');
    } finally {
      setIsInitialized(true);
    }
  }, [refreshExamData, refreshScheduleData, role]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const setDefaults = useCallback((config: ExamConfig) => {
    setDefaultsState(config);
    void adminPreferencesRepository.saveDefaults(config);
  }, []);

  const handleNavigate = useCallback((mode: 'builder' | 'student' | 'admin' | 'proctor') => {
    navigate(`/${mode}`);
  }, [navigate]);

  const handleEditExam = useCallback(
    (id: string) => {
      navigate(`/builder/${id}`);
    },
    [navigate],
  );

  const handleGetVersions = useCallback(async (examId: string): Promise<ExamVersionSummary[]> => {
    return examRepository.getVersionSummaries(examId);
  }, []);

  const handleGetEvents = useCallback(async (examId: string): Promise<ExamEvent[]> => {
    return examRepository.getEvents(examId);
  }, []);

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      const version = await examRepository.getVersionById(versionId);
      if (!version) {
        return;
      }

      await examLifecycleService.restoreVersionAsDraft(version.examId, versionId, 'Admin');
      await refreshExamData();
    },
    [refreshExamData],
  );

  const handleRepublishVersion = useCallback(
    async (versionId: string) => {
      const version = await examRepository.getVersionById(versionId);
      if (!version) {
        return;
      }

      await examLifecycleService.republishVersion(version.examId, versionId, 'Admin');
      await refreshExamData();
    },
    [refreshExamData],
  );

  const handleCompareVersions = useCallback(
    async (versionIdA: string, versionIdB: string): Promise<VersionDiff | null> => {
      const versionA = await examRepository.getVersionById(versionIdA);
      const versionB = await examRepository.getVersionById(versionIdB);
      if (!versionA || !versionB) {
        return null;
      }

      return examLifecycleService.compareVersions(versionA.examId, versionIdA, versionIdB);
    },
    [],
  );

  const handleCloneExam = useCallback(
    async (examId: string, newTitle: string) => {
      await examLifecycleService.cloneExam(examId, newTitle, 'Admin');
      await refreshExamData();
    },
    [refreshExamData],
  );

  const handleCreateFromTemplate = useCallback(
    async (templateId: string, newTitle: string) => {
      await examLifecycleService.createFromTemplate(templateId, newTitle, 'Admin');
      await refreshExamData();
    },
    [refreshExamData],
  );

  const handleCreateExam = useCallback(
    async (
      title: string,
      type: 'Academic' | 'General Training',
      preset: ExamConfig['general']['preset'] = 'Academic',
    ) => {
      const initialState = createInitialExamState(title, type, preset, defaults);
      const result = await examLifecycleService.createExam(title, type, initialState, 'Sarah Chen');

      if (result.success && result.exam) {
        await refreshExamData();
        navigate(`/builder/${result.exam.id}`);
      }
    },
    [defaults, navigate, refreshExamData],
  );

  const handleCreateSchedule = useCallback(
    async (schedule: ExamSchedule) => {
      await examRepository.saveSchedule(schedule);
      await refreshScheduleData();
    },
    [refreshScheduleData],
  );

  const handleUpdateSchedule = useCallback(
    async (schedule: ExamSchedule) => {
      await examRepository.saveSchedule(schedule);
      await refreshScheduleData();
    },
    [refreshScheduleData],
  );

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      await examRepository.deleteRuntime(scheduleId);
      await examRepository.deleteSchedule(scheduleId);
      await refreshScheduleData();
    },
    [refreshScheduleData],
  );

  const handleStartScheduledSession = useCallback(
    async (scheduleId: string) => {
      await examDeliveryService.startRuntime(scheduleId, 'Proctor');
      await refreshScheduleData();
    },
    [refreshScheduleData],
  );

  const contextValue = useMemo<AdminContextValue>(
    () => ({
      onNavigate: handleNavigate,
      exams,
      schedules,
      examEntities: loadedExamEntities,
      defaults,
      setDefaults,
      onEditExam: handleEditExam,
      onCreateExam: handleCreateExam,
      onCreateSchedule: handleCreateSchedule,
      onUpdateSchedule: handleUpdateSchedule,
      onDeleteSchedule: handleDeleteSchedule,
      onStartScheduledSession: handleStartScheduledSession,
      onGetVersions: handleGetVersions,
      onGetEvents: handleGetEvents,
      onRestoreVersion: handleRestoreVersion,
      onRepublishVersion: handleRepublishVersion,
      onCompareVersions: handleCompareVersions,
      onCloneExam: handleCloneExam,
      onCreateFromTemplate: handleCreateFromTemplate,
      isInitialized,
      initError,
    }),
    [
      defaults,
      exams,
      handleCloneExam,
      handleCompareVersions,
      handleCreateExam,
      handleCreateFromTemplate,
      handleCreateSchedule,
      handleDeleteSchedule,
      handleEditExam,
      handleGetEvents,
      handleGetVersions,
      handleNavigate,
      handleRepublishVersion,
      handleRestoreVersion,
      handleStartScheduledSession,
      handleUpdateSchedule,
      initError,
      isInitialized,
      loadedExamEntities,
      schedules,
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
