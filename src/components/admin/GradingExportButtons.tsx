import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  ChevronDown,
  FileSpreadsheet,
  Printer,
  FolderArchive,
} from 'lucide-react';
import type { GradingExportSection } from './gradingReviewUtils';

interface GradingExportButtonsProps {
  exportingSection: GradingExportSection | null;
  onExportReading: () => void;
  onExportReadingManual: () => void;
  onExportListening: () => void;
  onExportListeningManual: () => void;
  onExportScience?: (() => void) | undefined;
  scienceOnly?: boolean | undefined;
  onPrintWriting: () => void;
  onOpenExportBuilder?: () => void;
}

interface ExportMenuGroup {
  key: string;
  label: string;
  items: Array<{
    key: GradingExportSection | 'export_builder';
    label: string;
    description: string;
    icon: React.ReactNode;
    onClick: () => void;
  }>;
}

export function GradingExportButtons({
  exportingSection,
  onExportReading,
  onExportReadingManual,
  onExportListening,
  onExportListeningManual,
  onExportScience,
  scienceOnly = false,
  onPrintWriting,
  onOpenExportBuilder,
}: GradingExportButtonsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  const busy = exportingSection !== null;

  const scienceItem = onExportScience ? {
    key: 'science' as const,
    label: 'ACT Science answers & scores',
    description: 'Auto-graded results for every student',
    icon: <FileSpreadsheet size={16} />,
    onClick: onExportScience,
  } : null;

  const groups: ExportMenuGroup[] = scienceOnly
    ? scienceItem
      ? [{ key: 'csv', label: 'Download CSV', items: [scienceItem] }]
      : []
    : [
      {
        key: 'csv',
        label: 'Download CSV',
        items: [
        {
          key: 'reading',
          label: 'Reading answers & scores',
          description: 'Auto-graded results for every student',
          icon: <FileSpreadsheet size={16} />,
          onClick: onExportReading,
        },
        {
          key: 'reading_manual',
          label: 'Reading manual check sheet',
          description: 'Blank score columns for graders',
          icon: <FileSpreadsheet size={16} />,
          onClick: onExportReadingManual,
        },
        {
          key: 'listening',
          label: 'Listening answers & scores',
          description: 'Auto-graded results for every student',
          icon: <FileSpreadsheet size={16} />,
          onClick: onExportListening,
        },
        {
          key: 'listening_manual',
          label: 'Listening manual check sheet',
          description: 'Blank score columns for graders',
          icon: <FileSpreadsheet size={16} />,
          onClick: onExportListeningManual,
        },
        ...(scienceItem ? [scienceItem] : []),
        ],
      },
      {
        key: 'print',
        label: 'Print',
        items: [
          {
            key: 'writing',
            label: 'Print all writing',
            description: 'Task pages with prompts, responses and assessment forms',
            icon: <Printer size={16} />,
            onClick: onPrintWriting,
          },
        ],
      },
    ];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        <Download size={16} />
        Export
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-900/5 p-1.5"
        >
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.key}>
              {groupIndex > 0 && <div className="my-1.5 border-t border-gray-100" role="separator" />}
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    item.onClick();
                    close();
                  }}
                  className="w-full flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600">
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">
                      {exportingSection === item.key ? 'Exporting…' : item.label}
                    </span>
                    <span className="block text-xs text-gray-500 leading-snug">{item.description}</span>
                  </span>
                </button>
              ))}
            </React.Fragment>
          ))}

          {!scienceOnly && onOpenExportBuilder ? (
            <>
              <div className="my-1.5 border-t border-gray-100" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  onOpenExportBuilder();
                  close();
                }}
                className="w-full flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                  <FolderArchive size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-blue-700">Export Builder · PDF ZIP</span>
                  <span className="block text-xs text-blue-600/80 leading-snug">
                    Choose students, sections and PDF layout, then download a ZIP of per-student PDFs
                  </span>
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
