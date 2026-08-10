import React, { useMemo } from 'react';

import { Button, Input, Select } from '@components/ui';
import {
  PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS,
} from '../gradingPerStudentPdfFilenameTemplate';
import type {
  ExportCustomGroup,
  ExportProfile,
  ExportStudentRecord,
} from './exportPlan';

export interface ExportBuilderStructureProps {
  profile: ExportProfile;
  records: readonly ExportStudentRecord[];
  disabled: boolean;
  onChange: (profile: ExportProfile) => void;
}

const GROUPING_OPTIONS = [
  { value: 'none', label: 'No folders' },
  { value: 'course', label: 'Course' },
  { value: 'level', label: 'Level' },
  { value: 'cohort', label: 'Cohort' },
  { value: 'customGroup', label: 'Custom group' },
];

const SECTION_OPTIONS = [
  { value: 'reading', label: 'Reading' },
  { value: 'listening', label: 'Listening' },
  { value: 'writing', label: 'Writing' },
] as const;

function ensureCustomGroup(profile: ExportProfile): ExportProfile {
  if (profile.customGroups.length > 0) return profile;
  const customGroup: ExportCustomGroup = {
    id: 'custom-group-1',
    name: 'Custom group',
    conditions: [{ field: 'course', operator: 'in', values: [] }],
  };
  return { ...profile, customGroups: [customGroup] };
}

function updateGrouping(profile: ExportProfile, index: number, value: string): ExportProfile {
  if (value === 'none' && index === 0) return { ...profile, grouping: [] };
  const next = [...profile.grouping];
  next[index] = { field: value as ExportProfile['grouping'][number]['field'] };
  return value === 'customGroup' ? ensureCustomGroup({ ...profile, grouping: next }) : { ...profile, grouping: next };
}

export function ExportBuilderStructure({
  profile,
  records,
  disabled,
  onChange,
}: ExportBuilderStructureProps) {
  const courseOptions = useMemo(
    () => [...new Set(records.map((record) => record.identity.courseName).filter((value): value is string => Boolean(value)))].sort(),
    [records],
  );
  const customGroup = profile.customGroups[0];
  const selectedCourses = customGroup?.conditions[0]?.values ?? [];

  const insertField = (field: string) => {
    const suffix = `{{${field}}}`;
    onChange({
      ...profile,
      filenameTemplate: profile.filenameTemplate.trim()
        ? `${profile.filenameTemplate} ${suffix}`
        : suffix,
    });
  };

  const updateCustomGroup = (next: ExportCustomGroup) => {
    onChange({
      ...profile,
      customGroups: [next, ...profile.customGroups.slice(1)],
    });
  };

  return (
    <section aria-labelledby="export-structure-heading" className="space-y-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Export structure</p>
        <h3 id="export-structure-heading" className="mt-1 text-base font-semibold tracking-tight text-gray-900">
          Shape the ZIP before it is generated
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          The structure changes folders and filenames only. PDF content continues to use the approved renderer.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">PDF sections</p>
            <p className="mt-1 text-xs text-gray-500">Choose the sections to include in each export.</p>
          </div>
          <Select
            aria-label="PDF mode"
            value={profile.pdfMode}
            options={[
              { value: 'combined', label: 'Combined PDF' },
              { value: 'separate', label: 'Separate by section' },
            ]}
            onChange={(event) => onChange({ ...profile, pdfMode: event.target.value as ExportProfile['pdfMode'] })}
            disabled={disabled}
            className="w-44"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SECTION_OPTIONS.map((section) => {
            const checked = profile.sections.includes(section.value);
            return (
              <label
                key={section.value}
                htmlFor={`export-section-${section.value}`}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-sm transition-colors ${
                  checked ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                <input
                  id={`export-section-${section.value}`}
                  type="checkbox"
                  aria-label={`Include ${section.label}`}
                  checked={checked}
                  onChange={() => onChange({
                    ...profile,
                    sections: checked
                      ? profile.sections.filter((value) => value !== section.value)
                      : [...profile.sections, section.value],
                  })}
                  disabled={disabled}
                />
                {section.label}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Folder structure</p>
            <p className="mt-1 text-xs text-gray-500">Group by one or more fields. Leave empty for a flat ZIP.</p>
          </div>
          {profile.grouping.length < 3 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...profile, grouping: [...profile.grouping, { field: 'level' }] })}
              disabled={disabled}
            >
              + Add folder level
            </Button>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {profile.grouping.length === 0 ? (
            <Select
              aria-label="Folder grouping"
              value="none"
              options={GROUPING_OPTIONS}
              onChange={(event) => onChange(updateGrouping(profile, 0, event.target.value))}
              disabled={disabled}
            />
          ) : (
            profile.grouping.map((grouping, index) => (
              <div key={`${grouping.field}-${index}`} className="flex items-center gap-2">
                <span className="w-16 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {index === 0 ? 'Group by' : 'Then by'}
                </span>
                <Select
                  aria-label={`${index === 0 ? 'Group by' : 'Then by'} folder field`}
                  value={grouping.field}
                  options={GROUPING_OPTIONS.filter((option) => option.value !== 'none')}
                  onChange={(event) => onChange(updateGrouping(profile, index, event.target.value))}
                  disabled={disabled}
                  className="flex-1"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {profile.grouping.some((grouping) => grouping.field === 'customGroup') && customGroup ? (
        <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
          <p className="text-sm font-semibold text-gray-900">Custom group rule</p>
          <p className="mt-1 text-xs leading-5 text-gray-600">Courses selected below will share one folder. Other courses go to Other.</p>
          <Input
            label="Group name"
            value={customGroup.name}
            onChange={(event) => updateCustomGroup({ ...customGroup, name: event.target.value })}
            disabled={disabled}
            fullWidth
            className="mt-3"
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {courseOptions.map((course) => (
              <label
                key={course}
                htmlFor={`export-custom-course-${course.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                className="inline-flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  id={`export-custom-course-${course.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  type="checkbox"
                  aria-label={`Include ${course} in ${customGroup.name}`}
                  checked={selectedCourses.includes(course)}
                  onChange={() => updateCustomGroup({
                    ...customGroup,
                    conditions: [{
                      ...customGroup.conditions[0],
                      field: 'course',
                      operator: 'in',
                      values: selectedCourses.includes(course)
                        ? selectedCourses.filter((value) => value !== course)
                        : [...selectedCourses, course],
                    }],
                  })}
                  disabled={disabled}
                />
                {course}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-semibold text-gray-900">File name</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">Use the canonical default or build a safe pattern from fields.</p>
        <Input
          aria-label="PDF filename template"
          value={profile.filenameTemplate}
          onChange={(event) => onChange({ ...profile, filenameTemplate: event.target.value })}
          disabled={disabled}
          fullWidth
          className="mt-3 font-mono text-xs"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS.slice(0, 10).map((field) => (
            <Button
              key={field.key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertField(field.key)}
              disabled={disabled}
              className="h-7 px-2 text-[11px]"
            >
              {field.label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
