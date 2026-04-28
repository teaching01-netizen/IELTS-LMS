import React from 'react';
import { Download, Printer, type LucideIcon } from 'lucide-react';
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
    busyLabel: string;
    icon: LucideIcon;
    onClick: () => void;
  }> = [
    { key: 'reading', label: 'Reading CSV', busyLabel: 'Exporting...', icon: Download, onClick: onExportReading },
    { key: 'listening', label: 'Listening CSV', busyLabel: 'Exporting...', icon: Download, onClick: onExportListening },
    { key: 'writing', label: 'Print Writing', busyLabel: 'Preparing...', icon: Printer, onClick: onExportWriting },
  ];

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
        Export / Print
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((button) => {
          const Icon = button.icon;

          return (
            <button
              key={button.key}
              type="button"
              onClick={button.onClick}
              disabled={exportingSection !== null}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon size={14} />
              {exportingSection === button.key ? button.busyLabel : button.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
