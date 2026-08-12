import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface StudentToolsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function StudentToolsSheet({ open, onClose, children }: StudentToolsSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const firstButton = sheetRef.current?.querySelector<HTMLButtonElement>('button');
    firstButton?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] bg-gray-900/50" data-testid="student-tools-overlay">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Close exam tools"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="student-tools-sheet absolute inset-x-0 bottom-0 max-h-[min(80vh,40rem)] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-tools-title"
        data-testid="student-tools-sheet"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="student-tools-title" className="text-base font-bold text-gray-900">
            Exam tools
          </h2>
          <button
            type="button"
            className="flex min-h-12 min-w-12 items-center justify-center rounded-sm text-gray-700 hover:bg-gray-100"
            aria-label="Close exam tools"
            onClick={onClose}
            data-student-primary-touch-target
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-2">{children}</div>
      </div>
    </div>
  );
}
