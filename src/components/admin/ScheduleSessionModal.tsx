import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Exam } from '../../types';
import { ExamEntity, ExamSchedule, ExamVersion } from '../../types/domain';
import { examRepository } from '../../services/examRepository';
import { examDeliveryService } from '../../services/examDeliveryService';

interface ScheduleSessionModalProps {
  isOpen: boolean;
  exams: Exam[];
  examEntities: ExamEntity[];
  initialExamId?: string;
  onClose: () => void;
  onCreateSchedule: (schedule: ExamSchedule) => Promise<void> | void;
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
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIso = (inputValue: string) => new Date(inputValue).toISOString();

export function ScheduleSessionModal({
  isOpen,
  exams,
  examEntities,
  initialExamId,
  onClose,
  onCreateSchedule,
}: ScheduleSessionModalProps) {
  const defaultExamId = initialExamId || examEntities[0]?.id || exams[0]?.id || '';
  const [draft, setDraft] = useState<ScheduleDraft>({
    examId: defaultExamId,
    publishedVersionId: '',
    cohortName: 'Elite 2025-A',
    startTime: toInputValue(new Date().toISOString()),
    endTime: toInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()),
  });
  const [selectedVersion, setSelectedVersion] = useState<ExamVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const exam = examEntities.find((item) => item.id === defaultExamId) ?? examEntities[0];
    const versionId = exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';

    setDraft({
      examId: exam?.id || defaultExamId,
      publishedVersionId: versionId,
      cohortName: 'Elite 2025-A',
      startTime: toInputValue(new Date().toISOString()),
      endTime: toInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()),
    });
  }, [defaultExamId, examEntities, isOpen]);

  const selectedExamEntity = useMemo(
    () => examEntities.find((exam) => exam.id === draft.examId) || null,
    [draft.examId, examEntities],
  );

  const validation = useMemo(() => {
    if (!selectedVersion) {
      return null;
    }

    return examDeliveryService.validateScheduleWindow(
      selectedVersion.configSnapshot,
      toIso(draft.startTime),
      toIso(draft.endTime),
    );
  }, [draft.endTime, draft.startTime, selectedVersion]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const loadVersion = async () => {
      const exam = examEntities.find((item) => item.id === draft.examId);
      const versionId =
        draft.publishedVersionId || exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';
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

    void loadVersion();
    return () => {
      cancelled = true;
    };
  }, [draft.examId, draft.publishedVersionId, examEntities, isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedVersion) {
      return;
    }

    const plan = examDeliveryService.buildSectionPlan(selectedVersion.configSnapshot);
    const now = new Date().toISOString();

    const schedule: ExamSchedule = {
      id: `sched-${Date.now()}`,
      examId: draft.examId,
      examTitle: selectedExamEntity?.title || selectedVersion.contentSnapshot.title,
      publishedVersionId: draft.publishedVersionId || selectedVersion.id,
      cohortName: draft.cohortName,
      startTime: toIso(draft.startTime),
      endTime: toIso(draft.endTime),
      plannedDurationMinutes: plan.plannedDurationMinutes,
      deliveryMode: 'proctor_start',
      autoStart: false,
      autoStop: false,
      status: 'scheduled',
      createdAt: now,
      createdBy: 'System',
      updatedAt: now,
    };

    await onCreateSchedule(schedule);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Schedule New Session</h2>
            <p className="text-xs text-gray-500 mt-1">
              Choose the exam version, cohort, and the planned session window.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="schedule-exam" className="block text-sm font-semibold text-gray-700 mb-1">
                Exam
              </label>
              <select
                id="schedule-exam"
                value={draft.examId}
                onChange={(e) => {
                  const nextExamId = e.target.value;
                  const nextExam = examEntities.find((item) => item.id === nextExamId);
                  setDraft((prev) => ({
                    ...prev,
                    examId: nextExamId,
                    publishedVersionId:
                      nextExam?.currentPublishedVersionId || nextExam?.currentDraftVersionId || '',
                  }));
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                aria-label="Exam"
                required
              >
                {examEntities.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="block text-sm font-semibold text-gray-700 mb-1">Exam Version</p>
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700">
                {loadingVersion
                  ? 'Loading version...'
                  : selectedVersion
                    ? `v${selectedVersion.versionNumber} (${selectedVersion.id.slice(0, 8)})`
                    : 'No version available'}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="schedule-cohort" className="block text-sm font-semibold text-gray-700 mb-1">
              Class / Cohort
            </label>
            <select
              id="schedule-cohort"
              value={draft.cohortName}
              onChange={(e) => setDraft((prev) => ({ ...prev, cohortName: e.target.value }))}
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
              <label htmlFor="schedule-start" className="block text-sm font-semibold text-gray-700 mb-1">
                Start Time
              </label>
              <input
                id="schedule-start"
                type="datetime-local"
                value={draft.startTime}
                onChange={(e) => setDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                aria-label="Select start time"
                required
              />
            </div>
            <div>
              <label htmlFor="schedule-end" className="block text-sm font-semibold text-gray-700 mb-1">
                End Time
              </label>
              <input
                id="schedule-end"
                type="datetime-local"
                value={draft.endTime}
                onChange={(e) => setDraft((prev) => ({ ...prev, endTime: e.target.value }))}
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
                {selectedVersion
                  ? examDeliveryService.buildSectionPlan(selectedVersion.configSnapshot)
                      .plannedDurationMinutes
                  : 0}{' '}
                min
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Window Length</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {Math.max(
                  0,
                  (new Date(draft.endTime).getTime() - new Date(draft.startTime).getTime()) / 60_000,
                ).toFixed(0)}{' '}
                min
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Schedule Status</p>
              <p className="text-2xl font-bold text-gray-900 mt-2 capitalize">scheduled</p>
            </div>
          </div>

          {validation && !validation.isValid && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                <AlertCircle size={16} /> Window validation failed
              </p>
              <ul className="space-y-1 text-sm text-red-800">
                {validation.errors.map((error) => (
                  <li key={`${error.field}-${error.message}`}>{error.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedVersion || (validation ? !validation.isValid : true)}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium shadow-sm transition-colors"
            >
              Create Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
