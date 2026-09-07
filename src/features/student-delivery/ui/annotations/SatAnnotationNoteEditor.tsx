import { useContext, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SatContrastContext } from '../reading/SatContrastContext';

export function SatAnnotationNoteEditor({ annotation, onChange, onClose, onDelete, onFlush }: {
  annotation: SatTextAnnotation;
  onChange: (note: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onFlush?: (() => void) | undefined;
}) {
  const contrast = useContext(SatContrastContext);
  const close = () => { onFlush?.(); onClose(); };
  const viewport = () => ({ height: window.visualViewport?.height ?? window.innerHeight,
    bottom: Math.max(0, window.innerHeight - (window.visualViewport?.height ?? window.innerHeight) - (window.visualViewport?.offsetTop ?? 0)) });
  const [bounds, setBounds] = useState(viewport);
  useEffect(() => {
    const update = () => setBounds(viewport());
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/20" />
      <Dialog.Content data-sat-contrast={contrast} className="sat-ui fixed inset-x-0 z-[100] overflow-y-auto rounded-t-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-5 text-[var(--sat-text)] shadow-xl sm:left-auto sm:right-4 sm:w-[400px] sm:rounded-xl"
        style={{ bottom: bounds.bottom + 16, maxHeight: Math.max(120, bounds.height - 32), paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('button[aria-label="Notes"]')?.focus(); }}>
        <Dialog.Title className="text-lg font-semibold">Note for selected text</Dialog.Title>
        <Dialog.Description className="my-3 max-h-24 overflow-y-auto text-sm">“{annotation.anchor.exact}”</Dialog.Description>
        <label className="block text-sm font-medium">Note
          <textarea aria-label="Note for selected text" value={annotation.note ?? ''} maxLength={2000} rows={6}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onFlush}
            className="mt-2 w-full rounded border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]" />
        </label>
        <p className="text-right text-sm">{(annotation.note ?? '').length}/2000</p>
        <div className="mt-4 flex justify-between gap-3">
          <button type="button" onClick={() => { onDelete(); onFlush?.(); }} className="sat-touch-target rounded border px-3">Delete note</button>
          <button type="button" onClick={close} className="sat-touch-target rounded bg-[var(--sat-accent)] px-5 text-[var(--sat-accent-text)]">Done</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
