import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useOptionalAuthSession } from '../../auth/api/authSession';
import { examAuthoringFacade } from '../../exam-authoring/api/examAuthoringFacade';
import { invalidateExamReads } from '../../exam-authoring/api/examQueries';
import type { ExamConfig } from '../../../types';
import type { ExamEntity, ExamVersion } from '../../../types/domain';
import { syncConfigWithStandards } from '../../../constants/examDefaults';
import { configSnapshotsEqual, preservesRemoteConfigChanges, rebaseConfigDraft } from '../domain/configDraftState';
import { configKeys, useConfigSnapshotQuery } from '../api/configQueries';

const CONFIG_CONFLICT = 'Configuration changed elsewhere and overlaps your edits. Your draft is preserved. Choose Retry to review it before saving.';

type ConfigSaveState = { examIds: Set<string>; listeners: Set<() => void> };
const configSaveStates = new WeakMap<QueryClient, ConfigSaveState>();

function configSaveState(client: QueryClient): ConfigSaveState {
  let state = configSaveStates.get(client);
  if (!state) {
    state = { examIds: new Set(), listeners: new Set() };
    configSaveStates.set(client, state);
  }
  return state;
}

function notifyConfigSaveState(state: ConfigSaveState) {
  state.listeners.forEach((listener) => listener());
}

function rebaseSafely(base: ExamConfig, local: ExamConfig, remote: ExamConfig): ExamConfig | null {
  const rebased = rebaseConfigDraft(base, local, remote);
  if (rebased.conflict) return null;
  const normalized = syncConfigWithStandards(rebased.config);
  return preservesRemoteConfigChanges(base, remote, normalized) ? normalized : null;
}

export interface ConfigRouteController {
  error: string | null;
  exam: ExamEntity | undefined;
  isLoading: boolean;
  isSaving: boolean;
  config: ExamConfig | undefined;
  handleUpdateConfig: (config: ExamConfig) => Promise<void>;
  handleSaveConfig: () => Promise<boolean>;
  handleNavigateToBuilder: () => Promise<void>;
  handleCancel: () => void;
  reload: () => Promise<void>;
}

function resolveStaffActor(session: { user: { id: string; displayName?: string | null | undefined; email?: string } } | null | undefined): string | null {
  const user = session?.user;
  if (!user) return null;
  const candidate = user.displayName?.trim() || user.id?.trim() || user.email?.trim() || '';
  return candidate === '' ? null : candidate;
}

export function useConfigRouteController(
  examId?: string,
): ConfigRouteController {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authSession = useOptionalAuthSession();
  const staffActor = resolveStaffActor(authSession?.session ?? null);
  const snapshotQuery = useConfigSnapshotQuery(examId);
  const { refetch: refetchSnapshot } = snapshotQuery;
  const saveState = configSaveState(queryClient);
  const subscribeToSaves = useCallback((listener: () => void) => {
    saveState.listeners.add(listener);
    return () => { saveState.listeners.delete(listener); };
  }, [saveState]);
  const getSavingSnapshot = useCallback(() => Boolean(examId && saveState.examIds.has(examId)), [examId, saveState]);
  const isSaving = useSyncExternalStore(subscribeToSaves, getSavingSnapshot, () => false);

  const [config, setConfig] = useState<ExamConfig | undefined>(undefined);
  const [adoptedExamId, setAdoptedExamId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const examRef = useRef<ExamEntity | undefined>(undefined);
  const versionRef = useRef<ExamVersion | null>(null);
  const configRef = useRef<ExamConfig | undefined>(undefined);
  const acknowledgedConfigRef = useRef<ExamConfig | undefined>(undefined);
  const configConflictRef = useRef(false);
  const pendingRemoteVersionRef = useRef<ExamVersion | null>(null);
  const identityRef = useRef({ examId, generation: 0 });
  const editSeqRef = useRef(0);
  /** Edit sequence the server has acknowledged (loaded or saved). */
  const ackEditSeqRef = useRef(0);
  useLayoutEffect(() => {
    if (identityRef.current.examId !== examId) {
      identityRef.current = { examId, generation: identityRef.current.generation + 1 };
      examRef.current = undefined;
      versionRef.current = null;
      configRef.current = undefined;
      acknowledgedConfigRef.current = undefined;
      configConflictRef.current = false;
      pendingRemoteVersionRef.current = null;
      editSeqRef.current = 0;
      ackEditSeqRef.current = 0;
      setConfig(undefined);
      setIsDirty(false);
      setError(null);
      setAdoptedExamId(undefined);
    }
  }, [examId]);

  // Query owns confirmed reads; each editor separately owns its local draft.
  useLayoutEffect(() => {
    const snapshot = snapshotQuery.data;
    if (!examId || !snapshot) return;
    const entity = snapshot.exam;
    examRef.current = entity ?? undefined;
    if (!entity) {
      versionRef.current = null;
      configRef.current = undefined;
      acknowledgedConfigRef.current = undefined;
      configConflictRef.current = false;
      pendingRemoteVersionRef.current = null;
      setConfig(undefined);
      setIsDirty(false);
    } else {
      const currentVersion = snapshot.version;
      if (currentVersion?.configSnapshot) {
        const previousVersion = versionRef.current;
        if (previousVersion?.id === currentVersion.id && previousVersion.revision !== undefined &&
          currentVersion.revision !== undefined && currentVersion.revision < previousVersion.revision) {
          setAdoptedExamId(examId);
          return;
        }
        if (editSeqRef.current === ackEditSeqRef.current) {
          versionRef.current = currentVersion;
          configRef.current = currentVersion.configSnapshot;
          acknowledgedConfigRef.current = structuredClone(currentVersion.configSnapshot);
          configConflictRef.current = false;
          pendingRemoteVersionRef.current = null;
          setConfig(currentVersion.configSnapshot);
          setIsDirty(false);
        } else {
          const base = acknowledgedConfigRef.current;
          const local = configRef.current;
          const normalized = base && local ? rebaseSafely(base, local, currentVersion.configSnapshot) : null;
          if (!normalized) {
            configConflictRef.current = true;
            pendingRemoteVersionRef.current = currentVersion;
            setError(CONFIG_CONFLICT);
            setAdoptedExamId(examId);
            return;
          }
          versionRef.current = currentVersion;
          acknowledgedConfigRef.current = structuredClone(currentVersion.configSnapshot);
          configRef.current = normalized;
          configConflictRef.current = false;
          pendingRemoteVersionRef.current = null;
          setConfig(normalized);
          if (configSnapshotsEqual(normalized, currentVersion.configSnapshot)) {
            ackEditSeqRef.current = editSeqRef.current;
            setIsDirty(false);
          }
        }
      } else {
        versionRef.current = null;
        configRef.current = undefined;
        setConfig(undefined);
      }
    }
    setAdoptedExamId(examId);
  }, [examId, snapshotQuery.data]);

  const loadExam = useCallback(async () => {
    if (!examId) return;
    const generation = identityRef.current.generation;
    setError(null);
    try {
      await refetchSnapshot({ throwOnError: true });
    } catch (loadError) {
      if (identityRef.current.examId === examId && identityRef.current.generation === generation) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load exam');
      }
    }
  }, [examId, refetchSnapshot]);

  const handleUpdateConfig = useCallback(
    async (nextConfig: ExamConfig) => {
      if (!examId) {
        return;
      }

      let syncedConfig = syncConfigWithStandards(nextConfig);
      editSeqRef.current += 1;
      let isDirty = true;
      const remote = pendingRemoteVersionRef.current;
      const base = acknowledgedConfigRef.current;
      if (configConflictRef.current && remote && base) {
        const rebased = rebaseSafely(base, syncedConfig, remote.configSnapshot);
        if (rebased) {
          syncedConfig = rebased;
          versionRef.current = remote;
          acknowledgedConfigRef.current = structuredClone(remote.configSnapshot);
          configConflictRef.current = false;
          pendingRemoteVersionRef.current = null;
          setError(null);
          if (configSnapshotsEqual(rebased, remote.configSnapshot)) {
            ackEditSeqRef.current = editSeqRef.current;
            isDirty = false;
          }
        }
      }
      configRef.current = syncedConfig;
      setConfig(syncedConfig);
      setIsDirty(isDirty);
    },
    [examId],
  );

  const handleSaveConfig = useCallback(async () => {
    const configToSave = configRef.current;
    if (!examId || !configToSave) {
      return false;
    }

    if (configConflictRef.current) {
      setError(CONFIG_CONFLICT);
      return false;
    }

    if (saveState.examIds.has(examId)) {
      return false;
    }

    const entity = examRef.current;
    const version = versionRef.current;
    if (!entity || entity.id !== examId || !version) {
      setError('Current draft version not found');
      return false;
    }
    const savedEditSeq = editSeqRef.current;
    const generation = identityRef.current.generation;
    const isCurrent = () => identityRef.current.generation === generation &&
      identityRef.current.examId === examId && examRef.current?.id === examId;

    saveState.examIds.add(examId);
    notifyConfigSaveState(saveState);
    try {
      const nextContent = examAuthoringFacade.hydrateExamState({
        ...version.contentSnapshot,
        config: configToSave,
      });

      if (!staffActor) {
        setError('Sign in required: saving config is blocked without an authenticated staff user.');
        return false;
      }
      const result = await examAuthoringFacade.lifecycle.saveDraft(examId, nextContent, staffActor, {
        versionId: version.id,
        revision: version.revision ?? null,
        isDraft: version.isDraft !== false && entity.currentDraftVersionId === version.id,
      });
      if (!result.success) {
        if (isCurrent()) setError(result.error ?? 'Failed to save draft');
        return false;
      }

      // A read started before this acknowledgement must not replace it.
      await queryClient.cancelQueries({ queryKey: configKeys.snapshot(examId), exact: true });
      // Lists and the exam detail carry the saved title/config.
      void invalidateExamReads(queryClient, examId);
      if (!isCurrent()) {
        void queryClient.invalidateQueries({ queryKey: configKeys.snapshot(examId), exact: true });
        return true;
      }
      void queryClient.invalidateQueries({ queryKey: configKeys.snapshot(examId), exact: true, refetchType: 'none' });
      // Edits typed while the save was in flight stay dirty for the next save;
      // the refresh below only adopts server config when none exist.
      ackEditSeqRef.current = savedEditSeq;
      if (result.version?.configSnapshot) {
        versionRef.current = result.version;
        acknowledgedConfigRef.current = structuredClone(result.version.configSnapshot);
      }
      if (editSeqRef.current === savedEditSeq) setIsDirty(false);
      await loadExam();
      return true;
    } finally {
      saveState.examIds.delete(examId);
      notifyConfigSaveState(saveState);
    }
  }, [examId, loadExam, queryClient, saveState, staffActor]);

  const handleNavigateToBuilder = useCallback(async () => {
    if (!examId) {
      return;
    }
    const editSeqAtNavigation = editSeqRef.current;
    const generation = identityRef.current.generation;
    const saved = await handleSaveConfig();
    if (!saved || identityRef.current.generation !== generation || examRef.current?.id !== examId) {
      return;
    }
    if (editSeqRef.current !== editSeqAtNavigation) {
      setError('Configuration changed while saving. Save again to continue.');
      return;
    }
    navigate(`/builder/${examId}/builder`);
  }, [examId, handleSaveConfig, navigate]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) {
      return;
    }
    navigate('/admin');
  }, [isDirty, navigate]);

  const reload = useCallback(async () => {
    if (configConflictRef.current && configRef.current) {
      setError(null);
      return;
    }
    await loadExam();
  }, [loadExam]);

  return {
    error: !examId ? 'Exam ID not found' : error ?? snapshotQuery.data?.issue ??
      (snapshotQuery.error instanceof Error ? snapshotQuery.error.message : snapshotQuery.error ? 'Failed to load exam' : null),
    exam: snapshotQuery.data?.exam ?? undefined,
    isLoading: Boolean(examId && (snapshotQuery.isFetching || (!snapshotQuery.error && adoptedExamId !== examId))),
    isSaving,
    config: adoptedExamId === examId ? config : undefined,
    handleUpdateConfig,
    handleSaveConfig,
    handleNavigateToBuilder,
    handleCancel,
    reload,
  };
}
