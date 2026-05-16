import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
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
  proctorDisplayName: string;
  gradingDisplayName: string;
}

export function ScheduleSessionModal({
  isOpen,
  exams,
  examEntities,
  initialExamId,
  onClose,
  onCreateSchedule,
}: ScheduleSessionModalProps) {
  const defaultScheduleName = examEntities[0]?.title || exams[0]?.title || '';
  const defaultExamId = initialExamId || examEntities[0]?.id || exams[0]?.id || '';
  const [draft, setDraft] = useState<ScheduleDraft>({
    examId: defaultExamId,
    publishedVersionId: '',
    cohortName: 'Elite 2025-A',
    proctorDisplayName: defaultScheduleName,
    gradingDisplayName: defaultScheduleName,
  });
  const [selectedVersion, setSelectedVersion] = useState<ExamVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const exam = examEntities.find((item) => item.id === defaultExamId) ?? examEntities[0];
    const versionId = exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '';
    const displayName = exam?.title || '';

    setDraft({
      examId: exam?.id || defaultExamId,
      publishedVersionId: versionId,
      cohortName: 'Elite 2025-A',
      proctorDisplayName: displayName,
      gradingDisplayName: displayName,
    });
  }, [defaultExamId, examEntities, isOpen]);

  const selectedExamEntity = useMemo(
    () => examEntities.find((exam) => exam.id === draft.examId) || null,
    [draft.examId, examEntities],
  );

  const trimmedProctorDisplayName = draft.proctorDisplayName.trim();
  const trimmedGradingDisplayName = draft.gradingDisplayName.trim();
  const isProctorDisplayNameValid =
    trimmedProctorDisplayName.length > 0 && trimmedProctorDisplayName.length <= 255;
  const isGradingDisplayNameValid =
    trimmedGradingDisplayName.length > 0 && trimmedGradingDisplayName.length <= 255;
  const areDisplayNamesValid = isProctorDisplayNameValid && isGradingDisplayNameValid;

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
    if (!selectedVersion || !areDisplayNamesValid) {
      return;
    }

    const now = new Date().toISOString();
    const scheduleWindow = examDeliveryService.resolveProctorStartScheduleWindow({
      config: selectedVersion.configSnapshot,
      now,
    });

    const schedule: ExamSchedule = {
      id: `sched-${Date.now()}`,
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
              Choose the exam version and cohort. Section timing comes from the exam config.
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
                    proctorDisplayName: nextExam?.title || '',
                    gradingDisplayName: nextExam?.title || '',
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
                  ? (
                    <>
                      <span className="sr-only">Loading version…</span>
                      <div className="h-4 w-44 bg-gray-200 rounded animate-pulse" aria-hidden="true" />
                    </>
                  )
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
              <label htmlFor="schedule-proctor-display-name" className="block text-sm font-semibold text-gray-700 mb-1">
                Proctor Display Name
              </label>
              <input
                id="schedule-proctor-display-name"
                type="text"
                value={draft.proctorDisplayName}
                onChange={(e) => setDraft((prev) => ({ ...prev, proctorDisplayName: e.target.value }))}
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
                onChange={(e) => setDraft((prev) => ({ ...prev, gradingDisplayName: e.target.value }))}
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
                {selectedVersion
                  ? examDeliveryService.buildSectionPlan(selectedVersion.configSnapshot)
                      .plannedDurationMinutes
                  : 0}{' '}
                min
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Schedule Status</p>
              <p className="text-2xl font-bold text-gray-900 mt-2 capitalize">scheduled</p>
            </div>
          </div>

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
              disabled={!selectedVersion || !areDisplayNamesValid}
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
