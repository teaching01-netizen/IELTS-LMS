import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import type { ExamSchedule, ExamVersion } from '../../types/domain';
import type { AdminSchedulingProps } from '../../features/scheduling/contracts';
import { schedulingGateway } from '../../features/scheduling/infrastructure/schedulingGateway';

interface ScheduleDraft {
  examId: string;
  publishedVersionId: string;
  cohortName: string;
  proctorDisplayName: string;
  gradingDisplayName: string;
}

export function AdminScheduling({
  schedules,
  exams,
  examEntities,
  onCreateSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onStartScheduledSession: _onStartScheduledSession,
  getVersionById,
  resolveScheduleWindow,
  getPlannedDuration,
  initialExamId,
  autoOpenCreate = false,
}: AdminSchedulingProps) {
  const loadVersionById = getVersionById ?? schedulingGateway.repository.getVersionById;
  const deriveScheduleWindow =
    resolveScheduleWindow ?? schedulingGateway.delivery.resolveScheduleWindow;
  const getDuration = getPlannedDuration ?? schedulingGateway.delivery.getPlannedDuration;
  const defaultScheduleName = examEntities[0]?.title || exams[0]?.title || '';
  const defaultExamId = examEntities[0]?.id || exams[0]?.id || '';
  const [showModal, setShowModal] = useState(false);
  const [hasConsumedRouteIntent, setHasConsumedRouteIntent] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>({
    examId: defaultExamId,
    publishedVersionId: '',
    cohortName: 'Elite 2025-A',
    proctorDisplayName: defaultScheduleName,
    gradingDisplayName: defaultScheduleName,
  });
  const [selectedVersion, setSelectedVersion] = useState<ExamVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const selectedExamEntity = useMemo(
    () => examEntities.find(exam => exam.id === draft.examId) || null,
    [draft.examId, examEntities]
  );

  const trimmedProctorDisplayName = draft.proctorDisplayName.trim();
  const trimmedGradingDisplayName = draft.gradingDisplayName.trim();
  const isProctorDisplayNameValid =
    trimmedProctorDisplayName.length > 0 && trimmedProctorDisplayName.length <= 255;
  const isGradingDisplayNameValid =
    trimmedGradingDisplayName.length > 0 && trimmedGradingDisplayName.length <= 255;
  const areDisplayNamesValid = isProctorDisplayNameValid && isGradingDisplayNameValid;

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      const exam = examEntities.find(item => item.id === draft.examId);
      const versionId = draft.publishedVersionId || exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';
      if (!versionId) {
        setSelectedVersion(null);
        return;
      }

      setLoadingVersion(true);
      try {
        const version = await loadVersionById(versionId);
        if (!cancelled) {
          setSelectedVersion(version);
        }
      } finally {
        if (!cancelled) {
          setLoadingVersion(false);
        }
      }
    };

    loadVersion();
    return () => {
      cancelled = true;
    };
  }, [draft.examId, draft.publishedVersionId, examEntities, loadVersionById]);

  const openCreateModal = (targetExamId?: string) => {
    const exam = examEntities.find((item) => item.id === targetExamId) ?? examEntities[0];
    const versionId = exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';
    const displayName = exam?.title || '';
    setEditingScheduleId(null);
    setDraft({
      examId: exam?.id || defaultExamId,
      publishedVersionId: versionId,
      cohortName: 'Elite 2025-A',
      proctorDisplayName: displayName,
      gradingDisplayName: displayName,
    });
    setShowModal(true);
  };

  useEffect(() => {
    if (!autoOpenCreate || hasConsumedRouteIntent || showModal || examEntities.length === 0) {
      return;
    }

    openCreateModal(initialExamId);
    setHasConsumedRouteIntent(true);
  }, [autoOpenCreate, examEntities, hasConsumedRouteIntent, initialExamId, showModal]);

  const openEditModal = async (schedule: ExamSchedule) => {
    setEditingScheduleId(schedule.id);
    setDraft({
      examId: schedule.examId,
      publishedVersionId: schedule.publishedVersionId,
      cohortName: schedule.cohortName,
      proctorDisplayName: schedule.proctorDisplayName,
      gradingDisplayName: schedule.gradingDisplayName,
    });
    setShowModal(true);
    const version = await loadVersionById(schedule.publishedVersionId);
    setSelectedVersion(version);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingScheduleId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedVersion || !areDisplayNamesValid) return;

    const now = new Date().toISOString();
    const existing = schedules.find(schedule => schedule.id === editingScheduleId);
    const scheduleWindow = deriveScheduleWindow({
      config: selectedVersion.configSnapshot,
      now,
      existingSchedule: editingScheduleId ? existing ?? null : null,
    });

    const schedule: ExamSchedule = {
      id: editingScheduleId || `sched-${Date.now()}`,
      examId: draft.examId,
      examTitle: selectedExamEntity?.title || selectedVersion.contentSnapshot.title,
      proctorDisplayName: trimmedProctorDisplayName,
      gradingDisplayName: trimmedGradingDisplayName,
      publishedVersionId: draft.publishedVersionId || selectedVersion.id,
      cohortName: draft.cohortName,
      startTime: scheduleWindow.startTime,
      endTime: scheduleWindow.endTime,
      plannedDurationMinutes: scheduleWindow.plannedDurationMinutes,
      deliveryMode: 'proctor_start',
      autoStart: existing?.autoStart ?? false,
      autoStop: existing?.autoStop ?? false,
      status: existing?.status ?? 'scheduled',
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? 'Admin',
      updatedAt: now
    };

    if (editingScheduleId) {
      await onUpdateSchedule(schedule);
    } else {
      await onCreateSchedule(schedule);
    }

    closeModal();
  };

  const dayBuckets = useMemo(() => {
    const map = new Map<string, ExamSchedule[]>();
    schedules.forEach(schedule => {
      const key = new Date(schedule.createdAt).toDateString();
      map.set(key, [...(map.get(key) || []), schedule]);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [schedules]);

  const scheduleStats = useMemo(() => {
    const counts = {
      total: schedules.length,
      scheduled: schedules.filter(schedule => schedule.status === 'scheduled').length,
      live: schedules.filter(schedule => schedule.status === 'live').length,
      completed: schedules.filter(schedule => schedule.status === 'completed').length
    };

    return counts;
  }, [schedules]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exam Scheduler</h1>
          <p className="text-sm text-gray-500 mt-1">Create cohort schedules against published exam versions.</p>
        </div>

        <button
          onClick={() => openCreateModal()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          <Plus size={18} />
          New Session
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: scheduleStats.total, color: 'text-gray-900' },
          { label: 'Scheduled', value: scheduleStats.scheduled, color: 'text-blue-700' },
          { label: 'Live', value: scheduleStats.live, color: 'text-emerald-700' },
          { label: 'Completed', value: scheduleStats.completed, color: 'text-gray-700' }
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{stat.label}</p>
            <p className={`text-2xl font-bold mt-2 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Cohort Sessions</h2>
            </div>
            <span className="text-xs font-medium text-gray-500">Grouped by creation date</span>
          </div>

          <div className="divide-y divide-gray-100">
            {dayBuckets.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Calendar size={36} className="mx-auto mb-3 opacity-20" />
                <p className="font-medium">No schedules yet</p>
                <p className="text-sm">Create one to start a cohort session.</p>
              </div>
            ) : (
              dayBuckets.map(([day, groupedSchedules]) => (
                <div key={day} className="p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">{day}</h3>
                  </div>

                  <div className="space-y-3">
                    {groupedSchedules.map(schedule => {
                      const exam = examEntities.find(entity => entity.id === schedule.examId);
                      const versionLabel = schedule.publishedVersionId
                        ? `Version ${schedule.publishedVersionId.slice(0, 8)}`
                        : 'Version unknown';
                      const statusLabel = schedule.status;

                      return (
                        <div key={schedule.id} className="border border-gray-200 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all">
                          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <h4 className="text-lg font-bold text-gray-900">{schedule.examTitle}</h4>
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                                  statusLabel === 'live'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : statusLabel === 'completed'
                                      ? 'bg-gray-100 text-gray-600'
                                    : statusLabel === 'cancelled'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                                <span className="flex items-center gap-1"><Users size={14} /> {schedule.cohortName}</span>
                                <span>Created {new Date(schedule.createdAt).toLocaleString()}</span>
                                <span>{versionLabel}</span>
                                {exam && <span>{exam.type}</span>}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                                <span className="text-gray-400 uppercase text-[10px] font-bold block">Planned</span>
                                <span className="font-semibold text-gray-900">{schedule.plannedDurationMinutes} min</span>
                              </div>
                              <button
                                onClick={() => openEditModal(schedule)}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                              >
                                <Pencil size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('Delete this schedule?')) {
                                    void onDeleteSchedule(schedule.id);
                                  }
                                }}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Selected Exam</h2>
            {selectedExamEntity ? (
              <>
                <p className="text-sm text-gray-600">{selectedExamEntity.title}</p>
                <div className="text-xs text-gray-500 space-y-1">
                  <p>Published version: {selectedExamEntity.currentPublishedVersionId || 'None'}</p>
                  <p>Draft version: {selectedExamEntity.currentDraftVersionId || 'None'}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">No exam selected.</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Quick Notes</h2>
            <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
              <li>Schedules point at an immutable published version.</li>
              <li>Exam time comes from the selected version's section durations.</li>
              <li>Runtime starts only when a proctor starts the cohort.</li>
            </ul>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingScheduleId ? 'Edit Schedule' : 'Schedule New Session'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">Choose the exam version and cohort. Section timing comes from the exam config.</p>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="schedule-exam" className="block text-sm font-semibold text-gray-700 mb-1">Exam</label>
                  <select
                    id="schedule-exam"
                    value={draft.examId}
                    onChange={(e) => {
                      const nextExamId = e.target.value;
                      const nextExam = examEntities.find(item => item.id === nextExamId);
                      setDraft(prev => ({
                        ...prev,
                        examId: nextExamId,
                        publishedVersionId: nextExam?.currentPublishedVersionId || nextExam?.currentDraftVersionId || '',
                        proctorDisplayName: nextExam?.title || '',
                        gradingDisplayName: nextExam?.title || '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    aria-label="Select exam"
                    required
                  >
                    {examEntities.map(exam => (
                      <option key={exam.id} value={exam.id}>
                        {exam.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="block text-sm font-semibold text-gray-700 mb-1">Exam Version</p>
                  <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700">
                    {loadingVersion ? (
                      <>
                        <span className="sr-only">Loading version…</span>
                        <div className="h-4 w-44 bg-gray-200 rounded animate-pulse" aria-hidden="true" />
                      </>
                    ) : selectedVersion ? (
                      `v${selectedVersion.versionNumber} (${selectedVersion.id.slice(0, 8)})`
                    ) : (
                      'No version available'
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="schedule-cohort" className="block text-sm font-semibold text-gray-700 mb-1">Class / Cohort</label>
                <select
                  id="schedule-cohort"
                  value={draft.cohortName}
                  onChange={(e) => setDraft(prev => ({ ...prev, cohortName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  aria-label="Select cohort"
                >
                  <option>Elite 2025-A</option>
                  <option>Morning Batch B</option>
                  <option>Weekend Intensive</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="schedule-proctor-display-name" className="block text-sm font-semibold text-gray-700 mb-1">
                    Proctor Display Name
                  </label>
                  <input
                    id="schedule-proctor-display-name"
                    type="text"
                    value={draft.proctorDisplayName}
                    onChange={(e) => setDraft(prev => ({ ...prev, proctorDisplayName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    aria-label="Proctor display name"
                    maxLength={255}
                    required
                  />
                  {!isProctorDisplayNameValid && (
                    <p className="mt-1 text-xs text-red-600">Proctor display name is required (max 255 characters).</p>
                  )}
                </div>
                <div>
                  <label htmlFor="schedule-grading-display-name" className="block text-sm font-semibold text-gray-700 mb-1">
                    Grading Display Name
                  </label>
                  <input
                    id="schedule-grading-display-name"
                    type="text"
                    value={draft.gradingDisplayName}
                    onChange={(e) => setDraft(prev => ({ ...prev, gradingDisplayName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    aria-label="Grading display name"
                    maxLength={255}
                    required
                  />
                  {!isGradingDisplayNameValid && (
                    <p className="mt-1 text-xs text-red-600">Grading display name is required (max 255 characters).</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Planned Duration</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {selectedVersion ? getDuration(selectedVersion.configSnapshot) : 0} min
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Schedule Status</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2 capitalize">
                    {editingScheduleId ? schedules.find(schedule => schedule.id === editingScheduleId)?.status || 'scheduled' : 'scheduled'}
                  </p>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedVersion || !areDisplayNamesValid}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium shadow-sm transition-colors"
                >
                  {editingScheduleId ? 'Update Schedule' : 'Create Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
