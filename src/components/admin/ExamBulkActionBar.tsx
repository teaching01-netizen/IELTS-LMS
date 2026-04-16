/**
 * Exam Bulk Action Bar Component
 * Extracted from AdminExams to reduce component complexity
 */

import { CheckCircle, XCircle, Archive, Copy, Download } from 'lucide-react';

interface ExamBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkPublish?: (() => Promise<void>) | undefined;
  onBulkUnpublish?: (() => Promise<void>) | undefined;
  onBulkArchive?: (() => Promise<void>) | undefined;
  onBulkDuplicate?: (() => Promise<void>) | undefined;
  onBulkExport?: (() => Promise<void>) | undefined;
}

export function ExamBulkActionBar({
  selectedCount,
  onClearSelection,
  onBulkPublish,
  onBulkUnpublish,
  onBulkArchive,
  onBulkDuplicate,
  onBulkExport
}: ExamBulkActionBarProps) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-blue-900">
          {selectedCount} exam{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <button
          onClick={onClearSelection}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Clear selection
        </button>
      </div>
      <div className="flex items-center gap-2">
        {onBulkPublish && (
          <button
            onClick={onBulkPublish}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
          >
            <CheckCircle size={14} />
            Publish
          </button>
        )}
        {onBulkUnpublish && (
          <button
            onClick={onBulkUnpublish}
            className="flex items-center gap-1 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm font-medium transition-colors"
          >
            <XCircle size={14} />
            Unpublish
          </button>
        )}
        {onBulkArchive && (
          <button
            onClick={onBulkArchive}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm font-medium transition-colors"
          >
            <Archive size={14} />
            Archive
          </button>
        )}
        {onBulkDuplicate && (
          <button
            onClick={onBulkDuplicate}
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors"
          >
            <Copy size={14} />
            Duplicate
          </button>
        )}
        {onBulkExport && (
          <button
            onClick={onBulkExport}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-sm font-medium transition-colors"
          >
            <Download size={14} />
            Export
          </button>
        )}
      </div>
    </div>
  );
}
