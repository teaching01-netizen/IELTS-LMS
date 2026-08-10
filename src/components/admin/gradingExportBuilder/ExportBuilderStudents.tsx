import React from 'react';
import { Check, Flag } from 'lucide-react';

import { Badge, Button } from '@components/ui';
import type { ExportStudentRecord } from './exportPlan';

export interface ExportBuilderStudentsProps {
  matchingRecords: readonly ExportStudentRecord[];
  selectedSubmissionIds: readonly string[];
  disabled: boolean;
  onToggle: (submissionId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

const STATUS_LABELS: Record<ExportStudentRecord['submission']['gradingStatus'], string> = {
  not_submitted: 'Not submitted',
  submitted: 'Submitted',
  in_progress: 'In progress',
  grading_complete: 'Complete',
  ready_to_release: 'Ready',
  released: 'Released',
  reopened: 'Reopened',
};

export function ExportBuilderStudents({
  matchingRecords,
  selectedSubmissionIds,
  disabled,
  onToggle,
  onSelectAll,
  onClear,
}: ExportBuilderStudentsProps) {
  const selected = new Set(selectedSubmissionIds);
  const matchingSelectedCount = matchingRecords.filter((record) => selected.has(record.identity.submissionId)).length;
  const hiddenSelectedCount = Math.max(0, selectedSubmissionIds.length - matchingSelectedCount);
  const allMatchingSelected = matchingRecords.length > 0 && matchingRecords.every((record) => selected.has(record.identity.submissionId));

  return (
    <section aria-labelledby="export-students-heading" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Students</p>
          <h3 id="export-students-heading" className="mt-1 text-base font-semibold tracking-tight text-gray-900">
            {matchingSelectedCount} selected <span className="font-normal text-gray-500">of {matchingRecords.length} matching</span>
            {hiddenSelectedCount > 0 ? (
              <span className="ml-2 text-xs font-normal text-gray-400">({hiddenSelectedCount} outside filter retained)</span>
            ) : null}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={disabled || selectedSubmissionIds.length === 0}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            disabled={disabled || matchingRecords.length === 0 || allMatchingSelected}
          >
            <Check size={14} />
            Select all matching
          </Button>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-gray-200 bg-white">
        {matchingRecords.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-gray-700">No students match these filters</p>
            <p className="mt-1 text-xs text-gray-500">Adjust the filter set to create an export plan.</p>
          </div>
        ) : (
          <ul className="max-h-[30rem] divide-y divide-gray-100 overflow-y-auto">
            {matchingRecords.map((record) => {
              const { identity, submission } = record;
              const checked = selected.has(identity.submissionId);
              const checkboxId = `export-student-${identity.submissionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              return (
                <li key={identity.submissionId} className={`transition-colors ${checked ? 'bg-blue-50/50' : 'bg-white'}`}>
                  <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(identity.submissionId)}
                      disabled={disabled}
                      aria-label={`Select ${identity.fullName} for export`}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-gray-900">{identity.fullName}</span>
                        {submission.isFlagged ? <Flag size={13} className="text-amber-700" aria-label="Flagged" /> : null}
                        <Badge variant={submission.gradingStatus === 'released' ? 'success' : 'neutral'}>
                          {STATUS_LABELS[submission.gradingStatus]}
                        </Badge>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span className="font-mono text-gray-700">{identity.wcode ?? 'Missing Wcode'}</span>
                        <span>{identity.nickname ?? 'No nickname'}</span>
                        <span>{identity.level ?? 'No level'}</span>
                        {identity.courseName ? <span>{identity.courseName}</span> : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
