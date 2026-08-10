import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, FileArchive, Folder, Files } from 'lucide-react';

import { Badge } from '@components/ui';
import type { ExportPlan } from './exportPlan';

export interface ExportBuilderPreviewProps {
  plan: ExportPlan;
}

interface PreviewFolder {
  readonly path: string;
  readonly files: readonly string[];
}

function groupOutputs(plan: ExportPlan): readonly PreviewFolder[] {
  const folders = new Map<string, string[]>();
  for (const student of plan.students) {
    for (const output of student.outputs) {
      const key = output.folderPath.join('/');
      const files = folders.get(key) ?? [];
      files.push(output.filename);
      folders.set(key, files);
    }
  }
  return [...folders.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([path, files]) => ({ path, files }));
}

export function ExportBuilderPreview({ plan }: ExportBuilderPreviewProps) {
  const folders = useMemo(() => groupOutputs(plan), [plan]);
  const missingRequired = plan.warnings.find((warning) => warning.code === 'missing_required_field');
  const hasBlockingDataWarning = Boolean(missingRequired);

  return (
    <section aria-labelledby="export-preview-heading" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Preview</p>
          <h3 id="export-preview-heading" className="mt-1 text-base font-semibold tracking-tight text-gray-900">
            The ZIP will contain
          </h3>
        </div>
        <FileArchive size={20} className="text-blue-700" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard label="Students" value={plan.selectedCount} />
        <SummaryCard label="PDF files" value={plan.pdfCount} />
        <SummaryCard label="Folders" value={plan.folderCount} />
        <SummaryCard label="Conflicts" value={plan.conflicts.length} tone={plan.conflicts.length > 0 ? 'warning' : 'success'} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs" aria-live="polite">
        {hasBlockingDataWarning ? (
          <Badge variant="warning"><AlertTriangle size={12} /> Required identity data missing</Badge>
        ) : (
          <Badge variant="success"><CheckCircle2 size={12} /> Plan is ready</Badge>
        )}
        {plan.warnings.filter((warning) => warning.code === 'missing_optional_field').length > 0 ? (
          <Badge variant="warning"><AlertTriangle size={12} /> Optional data missing</Badge>
        ) : null}
        {plan.conflicts.length === 0 ? (
          <Badge variant="success">No filename conflicts</Badge>
        ) : (
          <Badge variant="warning"><AlertTriangle size={12} /> {plan.conflicts.length} filename conflict(s) resolved</Badge>
        )}
      </div>

      {plan.warnings.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3" role="status">
          {plan.warnings.map((warning) => (
            <div key={warning.code} className="flex gap-2 text-xs leading-5 text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {warning.message}
                {warning.submissionIds.length > 0 ? (
                  <span className="block text-[11px] text-amber-800/80">
                    {warning.submissionIds.slice(0, 5).join(', ')}
                    {warning.submissionIds.length > 5 ? ` +${warning.submissionIds.length - 5} more` : ''}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.conflicts.length > 0 ? (
        <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-950">
          <p className="font-semibold">Resolved output paths</p>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            {plan.conflicts.slice(0, 5).map((conflict) => (
              <li key={`${conflict.originalPath}-${conflict.resolvedPath}`} className="truncate">
                {conflict.originalPath} → {conflict.resolvedPath}
              </li>
            ))}
          </ul>
          {plan.conflicts.length > 5 ? <p className="mt-1 text-[11px] text-blue-800">+{plan.conflicts.length - 5} more resolved paths</p> : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
          <span className="text-xs font-semibold text-gray-700">Folder tree</span>
          <span className="font-mono text-[11px] text-gray-500">manifest.json</span>
        </div>
        <div className="max-h-[23rem] overflow-y-auto p-2">
          {folders.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-gray-600">
              <Folder size={14} className="text-gray-400" /> ZIP root
            </div>
          ) : null}
          {folders.map((folder) => (
            <details key={folder.path} open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-2 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
                <Folder size={15} className="text-blue-700" />
                <span className="truncate">{folder.path}</span>
                <span className="ml-auto font-mono text-[11px] font-normal text-gray-400">{folder.files.length}</span>
              </summary>
              <ul className="mb-2 ml-7 space-y-1 border-l border-gray-100 pl-3">
                {folder.files.slice(0, 12).map((filename) => (
                  <li key={`${folder.path}/${filename}`} className="flex items-center gap-2 py-1 text-xs text-gray-600">
                    <Files size={13} className="shrink-0 text-gray-400" />
                    <span className="truncate font-mono">{filename}</span>
                  </li>
                ))}
                {folder.files.length > 12 ? (
                  <li className="py-1 text-xs italic text-gray-400">+ {folder.files.length - 12} more files</li>
                ) : null}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const valueClass = tone === 'success' ? 'text-green-700' : tone === 'warning' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}
