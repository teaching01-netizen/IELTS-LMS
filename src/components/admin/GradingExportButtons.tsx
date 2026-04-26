import React from 'react';
import { Download } from 'lucide-react';
import type { GradingExportSection } from './gradingReviewUtils';

interface GradingExportButtonsProps {
  exportingSection: GradingExportSection | null;
  onExportReading: () => void;
  onExportListening: () => void;
  onExportWriting: () => void;
}

export function GradingExportButtons({
  exportingSection,
  onExportReading,
  onExportListening,
  onExportWriting,
}: GradingExportButtonsProps) {
  const buttons: Array<{
    key: GradingExportSection;
    label: string;
    onClick: () => void;
  }> = [
    { key: 'reading', label: 'Reading CSV', onClick: onExportReading },
    { key: 'listening', label: 'Listening CSV', onClick: onExportListening },
    { key: 'writing', label: 'Writing CSV', onClick: onExportWriting },
  ];

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
        Export CSV
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            onClick={button.onClick}
            disabled={exportingSection !== null}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} />
            {exportingSection === button.key ? 'Exporting...' : button.label}
          </button>
        ))}
      </div>
    </div>
  );
}
