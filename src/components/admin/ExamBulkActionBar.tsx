/**
 * Exam Bulk Action Bar Component
 * Extracted from AdminExams to reduce component complexity
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Archive, Copy, Download, Trash2 } from 'lucide-react';

interface ExamBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkPublish?: (() => Promise<void>) | undefined;
  onBulkUnpublish?: (() => Promise<void>) | undefined;
  onBulkArchive?: (() => Promise<void>) | undefined;
  onBulkDelete?: (() => Promise<void>) | undefined;
  onBulkDuplicate?: (() => void | Promise<void>) | undefined;
  onBulkExport?: (() => Promise<void>) | undefined;
}

type PendingAction = 'publish' | 'unpublish' | 'archive' | 'delete' | 'duplicate' | 'export';

const PENDING_LABEL: Record<PendingAction, string> = {
  publish: 'Publishing…',
  unpublish: 'Unpublishing…',
  archive: 'Archiving…',
  delete: 'Deleting…',
  duplicate: 'Duplicating…',
  export: 'Exporting…',
};

export function ExamBulkActionBar({
  selectedCount,
  onClearSelection,
  onBulkPublish,
  onBulkUnpublish,
  onBulkArchive,
  onBulkDelete,
  onBulkDuplicate,
  onBulkExport
}: ExamBulkActionBarProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  // S2-C18: every irreversible bulk action (publish/unpublish/archive/delete)
  // requires the same two-step inline confirmation delete already had — the
  // old one-click publish/unpublish/archive fired immediately.
  const [confirmingAction, setConfirmingAction] = useState<PendingAction | null>(null);
  const confirmingDelete = confirmingAction === 'delete';
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmingAction) {
      deleteConfirmRef.current?.focus();
    }
  }, [confirmingAction]);

  // Reset any inline confirmation whenever the selection changes.
  useEffect(() => {
    setConfirmingAction(null);
  }, [selectedCount]);

  const runAction = async (action: PendingAction, handler: (() => void | Promise<void>) | undefined) => {
    if (!handler || pendingAction) return;
    setPendingAction(action);
    try {
      await handler();
    } finally {
      setPendingAction(null);
      setConfirmingAction(null);
    }
  };

  // Two-step inline confirm shared by publish/unpublish/archive/delete.
  const renderConfirmableIrreversible = (
    action: PendingAction,
    handler: (() => void | Promise<void>) | undefined,
    label: string,
    icon: React.ReactNode,
    buttonClass: string,
  ) => {
    if (!handler) return null;
    if (confirmingAction === action) {
      return (
        <span className="flex items-center gap-2" role="alertdialog" aria-label={`Confirm bulk ${label.toLowerCase()}`}>
          <span className="text-sm font-medium text-blue-900">
            {label} {selectedCount} exam{selectedCount !== 1 ? 's' : ''}?
          </span>
          <button
            ref={deleteConfirmRef}
            onClick={() => void runAction(action, handler)}
            disabled={busy}
            aria-label={`Confirm ${label.toLowerCase()} selected exams`}
            className={`${actionButtonClass} ${buttonClass}`}
          >
            {icon}
            {pendingAction === action ? `${label.slice(0, -1)}ing…` : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirmingAction(null)}
            disabled={busy}
            aria-label={`Cancel bulk ${label.toLowerCase()}`}
            className={`${actionButtonClass} bg-white border border-gray-300 text-gray-700 hover:bg-gray-50`}
          >
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        onClick={() => setConfirmingAction(action)}
        disabled={busy}
        aria-label={`${label} ${selectedCount} selected exams`}
        className={`${actionButtonClass} ${buttonClass}`}
      >
        {icon}
        {label}
      </button>
    );
  };

  const busy = pendingAction !== null;
  const actionButtonClass = 'flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between" role="toolbar" aria-label={`Bulk actions for ${selectedCount} selected exams`} aria-busy={busy}>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-blue-900" role="status">
          {selectedCount} exam{selectedCount !== 1 ? 's' : ''} selected
          {pendingAction ? ` · ${PENDING_LABEL[pendingAction]}` : ''}
        </span>
        <button
          onClick={onClearSelection}
          disabled={busy}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Clear selection
        </button>
      </div>
      <div className="flex items-center gap-2">
        {renderConfirmableIrreversible('publish', onBulkPublish, 'Publish', <CheckCircle size={14} />, 'bg-green-600 hover:bg-green-700 text-white')}
        {renderConfirmableIrreversible('unpublish', onBulkUnpublish, 'Unpublish', <XCircle size={14} />, 'bg-yellow-600 hover:bg-yellow-700 text-white')}
        {renderConfirmableIrreversible('archive', onBulkArchive, 'Archive', <Archive size={14} />, 'bg-orange-600 hover:bg-orange-700 text-white')}
        {onBulkDelete && (confirmingAction === 'delete' ? (
          <span className="flex items-center gap-2" role="alertdialog" aria-label="Confirm bulk delete">
            <span className="text-sm font-medium text-red-800">
              Delete {selectedCount} exam{selectedCount !== 1 ? 's' : ''}?
            </span>
            <button
              ref={deleteConfirmRef}
              onClick={() => void runAction('delete', onBulkDelete)}
              disabled={busy}
              aria-label="Confirm delete selected exams"
              className={`${actionButtonClass} bg-red-600 hover:bg-red-700 text-white`}
            >
              <Trash2 size={14} />
              {pendingAction === 'delete' ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmingAction(null)}
              disabled={busy}
              aria-label="Cancel delete"
              className={`${actionButtonClass} bg-white border border-gray-300 text-gray-700 hover:bg-gray-50`}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmingAction('delete')}
            disabled={busy}
            aria-label={`Delete ${selectedCount} selected exams`}
            className={`${actionButtonClass} bg-red-600 hover:bg-red-700 text-white`}
          >
            <Trash2 size={14} />
            Delete
          </button>
        ))}
        {onBulkDuplicate && (
          <button
            onClick={() => void runAction('duplicate', onBulkDuplicate)}
            disabled={busy}
            aria-label={`Duplicate ${selectedCount} selected exams`}
            className={`${actionButtonClass} bg-purple-600 hover:bg-purple-700 text-white`}
          >
            <Copy size={14} />
            {pendingAction === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
          </button>
        )}
        {onBulkExport && (
          <button
            onClick={() => void runAction('export', onBulkExport)}
            disabled={busy}
            aria-label={`Export ${selectedCount} selected exams`}
            className={`${actionButtonClass} bg-gray-600 hover:bg-gray-700 text-white`}
          >
            <Download size={14} />
            {pendingAction === 'export' ? 'Exporting…' : 'Export'}
          </button>
        )}
      </div>
    </div>
  );
}
