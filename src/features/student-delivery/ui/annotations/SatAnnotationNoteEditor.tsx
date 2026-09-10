import { useContext, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY, satSelectedTextLabel } from '../../domain/satCopy';
import { SatContrastContext } from '../reading/SatContrastContext';

export function SatAnnotationNoteEditor({ annotation, onChange, onClose, onDelete, onFlush, returnFocusSelector }: {
  annotation: SatTextAnnotation;
  onChange: (note: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onFlush?: (() => void) | undefined;
  /** Focus target on close (replaces the brittle Notes-button querySelector). */
  returnFocusSelector?: string | undefined;
}) {
  const contrast = useContext(SatContrastContext);
  const close = () => { onFlush?.(); onClose(); };
  const focusBack = () => {
    if (returnFocusSelector) document.querySelector<HTMLButtonElement>(returnFocusSelector)?.focus();
  };
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
      {/* Bluebook note card (Phase 7, Lane 3): document-like 260px card,
          8px radius, answer-grade border, pale-yellow 38px header + 12px
          body padding, small shadow only (never shadow-xl/2xl). */}
      <Dialog.Content data-sat-contrast={contrast} className="sat-ui fixed inset-x-0 z-[100] w-[260px] overflow-hidden rounded-[8px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm sm:left-auto sm:right-4"
        style={{ bottom: bounds.bottom + 16, maxHeight: Math.max(120, bounds.height - 32), paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onCloseAutoFocus={(event) => { event.preventDefault(); focusBack(); }}>
        <div data-sat-note-header className="flex min-h-[38px] items-center bg-[var(--sat-note-header)] px-3">
          <Dialog.Title className="text-lg font-semibold">{SAT_COPY.noteOnSelection.title}</Dialog.Title>
        </div>
        <div className="p-3">
        <Dialog.Description className="mb-3 max-h-24 overflow-y-auto text-sm">{satSelectedTextLabel(annotation.anchor.exact)}</Dialog.Description>
        <label htmlFor="sat-note-on-selection" className="block text-sm font-medium">{SAT_COPY.noteOnSelection.yourNote}
          {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- label text comes from the SAT_COPY table (non-literal); association is real via wrapping label + htmlFor. */}
          <textarea id="sat-note-on-selection" value={annotation.note ?? ''} maxLength={2000} rows={6}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onFlush}
            aria-describedby="sat-note-on-selection-count"
            className="mt-2 w-full rounded border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]" />
        </label>
        <p id="sat-note-on-selection-count" className="text-right text-sm" aria-live="polite">{(annotation.note ?? '').length}/2000</p>
        <div className="mt-4 flex justify-between gap-3">
          <button type="button" onClick={() => { onDelete(); onFlush?.(); }} className="sat-touch-target rounded border px-3">{SAT_COPY.noteOnSelection.delete}</button>
          <button type="button" onClick={close} className="sat-touch-target rounded bg-[var(--sat-accent)] px-5 text-[var(--sat-accent-text)]">{SAT_COPY.noteOnSelection.done}</button>
        </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
