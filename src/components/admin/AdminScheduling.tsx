import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, Clock, Pencil, Play, Plus, Trash2, Users, X } from 'lucide-react';
import { Exam } from '../../types';
import { ExamEntity, ExamSchedule, ExamVersion } from '../../types/domain';
import { examRepository } from '../../services/examRepository';
import { examDeliveryService } from '../../services/examDeliveryService';
import { isScheduleReadyToStart } from '../../utils/scheduleUtils';

interface AdminSchedulingProps {
  schedules: ExamSchedule[];
  exams: Exam[];
  examEntities: ExamEntity[];
  onCreateSchedule: (schedule: ExamSchedule) => Promise<void> | void;
  onUpdateSchedule: (schedule: ExamSchedule) => Promise<void> | void;
  onDeleteSchedule: (scheduleId: string) => Promise<void> | void;
  onStartScheduledSession: (scheduleId: string) => Promise<void> | void;
  initialExamId?: string;
  autoOpenCreate?: boolean;
}

interface ScheduleDraft {
  examId: string;
  publishedVersionId: string;
  cohortName: string;
  startTime: string;
  endTime: string;
}

const toInputValue = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toIso = (inputValue: string) => new Date(inputValue).toISOString();

export function AdminScheduling({
  schedules,
  exams,
  examEntities,
  onCreateSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onStartScheduledSession,
  initialExamId,
  autoOpenCreate = false,
}: AdminSchedulingProps) {
  const defaultExamId = examEntities[0]?.id || exams[0]?.id || '';
  const [showModal, setShowModal] = useState(false);
  const [hasConsumedRouteIntent, setHasConsumedRouteIntent] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>({
    examId: defaultExamId,
    publishedVersionId: '',
    cohortName: 'Elite 2025-A',
    startTime: toInputValue(new Date().toISOString()),
    endTime: toInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString())
  });
  const [selectedVersion, setSelectedVersion] = useState<ExamVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const selectedExamEntity = useMemo(
    () => examEntities.find(exam => exam.id === draft.examId) || null,
    [draft.examId, examEntities]
  );

  const validation = useMemo(() => {
    if (!selectedVersion) {
      return null;
    }

    return examDeliveryService.validateScheduleWindow(
      selectedVersion.configSnapshot,
      toIso(draft.startTime),
      toIso(draft.endTime)
    );
  }, [draft.endTime, draft.startTime, selectedVersion]);

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
        const version = await examRepository.getVersionById(versionId);
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
  }, [draft.examId, draft.publishedVersionId, examEntities]);

  const openCreateModal = (targetExamId?: string) => {
    const exam = examEntities.find((item) => item.id === targetExamId) ?? examEntities[0];
    const versionId = exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';
    setEditingScheduleId(null);
    setDraft({
      examId: exam?.id || defaultExamId,
      publishedVersionId: versionId,
      cohortName: 'Elite 2025-A',
      startTime: toInputValue(new Date().toISOString()),
      endTime: toInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString())
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
      startTime: toInputValue(schedule.startTime),
      endTime: toInputValue(schedule.endTime)
    });
    setShowModal(true);
    const version = await examRepository.getVersionById(schedule.publishedVersionId);
    setSelectedVersion(version);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingScheduleId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedVersion) return;

    const plan = examDeliveryService.buildSectionPlan(selectedVersion.configSnapshot);
    const now = new Date().toISOString();
    const existing = schedules.find(schedule => schedule.id === editingScheduleId);

    const schedule: ExamSchedule = {
      id: editingScheduleId || `sched-${Date.now()}`,
      examId: draft.examId,
      examTitle: selectedExamEntity?.title || selectedVersion.contentSnapshot.title,
      publishedVersionId: draft.publishedVersionId || selectedVersion.id,
      cohortName: draft.cohortName,
      startTime: toIso(draft.startTime),
      endTime: toIso(draft.endTime),
      plannedDurationMinutes: plan.plannedDurationMinutes,
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
      const key = new Date(schedule.startTime).toDateString();
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
            <span className="text-xs font-medium text-gray-500">Grouped by scheduled start date</span>
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
                    <Clock size={16} className="text-gray-400" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">{day}</h3>
                  </div>

                  <div className="space-y-3">
                    {groupedSchedules.map(schedule => {
                      const exam = examEntities.find(entity => entity.id === schedule.examId);
                      const versionLabel = schedule.publishedVersionId
                        ? `Version ${schedule.publishedVersionId.slice(0, 8)}`
                        : 'Version unknown';
                      const isReadyToStart = isScheduleReadyToStart(schedule);
                      const statusLabel = schedule.status === 'scheduled' && isReadyToStart
                        ? 'ready'
                        : schedule.status;

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
                                        : statusLabel === 'ready'
                                          ? 'bg-blue-100 text-blue-700'
                                          : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                                <span className="flex items-center gap-1"><Users size={14} /> {schedule.cohortName}</span>
                                <span className="flex items-center gap-1"><Clock size={14} /> {new Date(schedule.startTime).toLocaleString()}</span>
                                <span className="flex items-center gap-1">Ends {new Date(schedule.endTime).toLocaleString()}</span>
                                <span>{versionLabel}</span>
                                {exam && <span>{exam.type}</span>}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                                <span className="text-gray-400 uppercase text-[10px] font-bold block">Planned</span>
                                <span className="font-semibold text-gray-900">{schedule.plannedDurationMinutes} min</span>
                              </div>
                              {schedule.status === 'scheduled' && (
                                <button
                                  onClick={() => onStartScheduledSession(schedule.id)}
                                  disabled={!isReadyToStart}
                                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
                                >
                                  <Play size={14} />
                                  Start
                                </button>
                              )}
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
              <li>The window is a planning boundary, not a hard stop.</li>
              <li>Proctor control starts runtime from the live session card.</li>
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
                <p className="text-xs text-gray-500 mt-1">Choose the exam version, cohort, and the planned session window.</p>
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
                        publishedVersionId: nextExam?.currentPublishedVersionId || nextExam?.currentDraftVersionId || ''
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
                    {loadingVersion ? 'Loading version...' : selectedVersion ? `v${selectedVersion.versionNumber} (${selectedVersion.id.slice(0, 8)})` : 'No version available'}
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
                  <label htmlFor="schedule-start" className="block text-sm font-semibold text-gray-700 mb-1">Start Time</label>
                  <input
                    id="schedule-start"
                    type="datetime-local"
                    value={draft.startTime}
                    onChange={(e) => setDraft(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    aria-label="Select start time"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="schedule-end" className="block text-sm font-semibold text-gray-700 mb-1">End Time</label>
                  <input
                    id="schedule-end"
                    type="datetime-local"
                    value={draft.endTime}
                    onChange={(e) => setDraft(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    aria-label="Select end time"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Planned Duration</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {selectedVersion ? examDeliveryService.buildSectionPlan(selectedVersion.configSnapshot).plannedDurationMinutes : 0} min
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Window Length</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {Math.max(0, (new Date(draft.endTime).getTime() - new Date(draft.startTime).getTime()) / 60_000).toFixed(0)} min
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Schedule Status</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2 capitalize">
                    {editingScheduleId ? schedules.find(schedule => schedule.id === editingScheduleId)?.status || 'scheduled' : 'scheduled'}
                  </p>
                </div>
              </div>

              {validation && !validation.isValid && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                    <AlertCircle size={16} /> Window validation failed
                  </p>
                  <ul className="space-y-1 text-sm text-red-800">
                    {validation.errors.map(error => (
                      <li key={`${error.field}-${error.message}`}>{error.message}</li>
                    ))}
                  </ul>
                </div>
              )}

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
                  disabled={!selectedVersion || (validation ? !validation.isValid : true)}
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
