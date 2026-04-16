import React from 'react';
import { Dialog } from './ui/Dialog';

interface ConfirmModalProps {
  confirmLabel: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  tone?: 'danger' | 'warning';
}

export function ConfirmModal({
  confirmLabel,
  description,
  isOpen,
  onClose,
  onConfirm,
  title,
  tone = 'danger',
}: ConfirmModalProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-3 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${
              tone === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
    </Dialog>
  );
}
