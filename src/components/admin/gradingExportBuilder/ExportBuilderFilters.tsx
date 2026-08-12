import React, { useMemo } from 'react';
import { Search } from 'lucide-react';

import { Input, Select } from '@components/ui';
import type {
  ExportFilterState,
  ExportStudentRecord,
} from './exportPlan';
import { ExportBuilderMultiSelect } from './ExportBuilderMultiSelect';

export interface ExportBuilderFiltersProps {
  records: readonly ExportStudentRecord[];
  filters: ExportFilterState;
  disabled: boolean;
  onChange: (filters: ExportFilterState) => void;
}

const STATUS_OPTIONS = [
  { value: 'not_submitted', label: 'Not submitted' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'grading_complete', label: 'Grading complete' },
  { value: 'ready_to_release', label: 'Ready to release' },
  { value: 'released', label: 'Released' },
  { value: 'reopened', label: 'Reopened' },
];

const RELEASE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready_to_release', label: 'Ready to release' },
  { value: 'released', label: 'Released' },
];

function uniqueOptions(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort().map((value) => ({
    value,
    label: value,
  }));
}

function uniqueTeacherOptions(records: readonly ExportStudentRecord[]) {
  const teachers = new Map<string, string>();
  for (const record of records) {
    const id = record.submission.assignedTeacherId;
    if (id) teachers.set(id, record.submission.assignedTeacherName || id);
  }
  return [...teachers.entries()]
    .sort(([, first], [, second]) => first.localeCompare(second))
    .map(([value, label]) => ({ value, label }));
}

export function ExportBuilderFilters({
  records,
  filters,
  disabled,
  onChange,
}: ExportBuilderFiltersProps) {
  const options = useMemo(
    () => ({
      courses: uniqueOptions(records.map((record) => record.identity.courseName)),
      levels: uniqueOptions(records.map((record) => record.identity.level)),
      cohorts: uniqueOptions(records.map((record) => record.identity.cohortName)),
      teachers: uniqueTeacherOptions(records),
    }),
    [records],
  );

  return (
    <section aria-labelledby="export-filter-heading" className="min-w-0 space-y-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Filter students</p>
        <h3 id="export-filter-heading" className="mt-1 text-base font-semibold tracking-tight text-gray-900">
          Build the matching set
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          Filters update the plan immediately. Selection stays separate, so changing a filter will not reselect students.
        </p>
      </div>

      <Input
        label="Search"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        placeholder="Name, nickname, Wcode, email…"
        leftIcon={<Search size={16} />}
        fullWidth
        disabled={disabled}
      />

      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(13rem,100%),1fr))]">
        <ExportBuilderMultiSelect
          id="export-filter-course"
          label="Course"
          value={filters.courses}
          options={options.courses}
          disabled={disabled}
          onChange={(courses) => onChange({ ...filters, courses })}
        />
        <ExportBuilderMultiSelect
          id="export-filter-level"
          label="Level"
          value={filters.levels}
          options={options.levels}
          disabled={disabled}
          onChange={(levels) => onChange({ ...filters, levels })}
        />
        <ExportBuilderMultiSelect
          id="export-filter-cohort"
          label="Cohort"
          value={filters.cohorts}
          options={options.cohorts}
          disabled={disabled}
          onChange={(cohorts) => onChange({ ...filters, cohorts })}
        />
        <ExportBuilderMultiSelect
          id="export-filter-teacher"
          label="Assigned grader"
          value={filters.assignedTeacherIds}
          options={options.teachers}
          disabled={disabled}
          onChange={(assignedTeacherIds) => onChange({ ...filters, assignedTeacherIds })}
        />
      </div>

      <ExportBuilderMultiSelect
        id="export-filter-status"
        label="Grading status"
        value={filters.gradingStatuses}
        options={STATUS_OPTIONS}
        disabled={disabled}
        onChange={(gradingStatuses) => onChange({
          ...filters,
          gradingStatuses: gradingStatuses as ExportFilterState['gradingStatuses'],
        })}
      />

      <ExportBuilderMultiSelect
        id="export-filter-release-status"
        label="Release status"
        value={filters.releaseStatuses}
        options={RELEASE_STATUS_OPTIONS}
        disabled={disabled}
        onChange={(releaseStatuses) => onChange({
          ...filters,
          releaseStatuses: releaseStatuses as ExportFilterState['releaseStatuses'],
        })}
      />

      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(13rem,100%),1fr))]">
        <Select
          label="Flagged"
          value={filters.flagged === null ? '' : String(filters.flagged)}
          options={[
            { value: '', label: 'All students' },
            { value: 'true', label: 'Flagged only' },
            { value: 'false', label: 'Not flagged' },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ ...filters, flagged: value === '' ? null : value === 'true' });
          }}
          disabled={disabled}
          fullWidth
        />
        <Select
          label="Missing data"
          value={filters.missingData}
          options={[
            { value: 'any', label: 'Any data quality' },
            { value: 'complete_only', label: 'Complete only' },
            { value: 'missing_required', label: 'Missing Wcode/name' },
            { value: 'missing_optional', label: 'Missing optional data' },
          ]}
          onChange={(event) => onChange({
            ...filters,
            missingData: event.target.value as ExportFilterState['missingData'],
          })}
          disabled={disabled}
          fullWidth
        />
      </div>

      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(13rem,100%),1fr))]">
        <Input
          label="Submitted from"
          type="date"
          value={filters.submittedFrom}
          onChange={(event) => onChange({ ...filters, submittedFrom: event.target.value })}
          disabled={disabled}
          fullWidth
        />
        <Input
          label="Submitted to"
          type="date"
          value={filters.submittedTo}
          onChange={(event) => onChange({ ...filters, submittedTo: event.target.value })}
          disabled={disabled}
          fullWidth
        />
      </div>
    </section>
  );
}
