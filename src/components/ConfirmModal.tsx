import React from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from './ui/Dialog';

interface ConfirmModalProps {
  confirmLabel: string;
  description: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<boolean | void> | boolean | void;
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
  const [isConfirming, setIsConfirming] = React.useState(false);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (isConfirming) return;
        onClose();
      }}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={isConfirming}
            className="px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              if (isConfirming) return;
              setIsConfirming(true);
              try {
                const result = await onConfirm();
                if (result !== false) {
                  onClose();
                }
              } finally {
                setIsConfirming(false);
              }
            }}
            disabled={isConfirming}
            className={`px-3 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${
              tone === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-amber-600 hover:bg-amber-700'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <span className="inline-flex items-center gap-2">
              {isConfirming ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
              {isConfirming ? 'Working…' : confirmLabel}
            </span>
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
    </Dialog>
  );
}
