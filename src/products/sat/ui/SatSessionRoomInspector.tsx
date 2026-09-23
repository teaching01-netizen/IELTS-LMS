import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';

const TABLET_INSPECTOR_QUERY = '(min-width: 1024px) and (max-width: 1439px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', update);
    if (!mediaQuery.addEventListener) mediaQuery.addListener?.(update);
    return () => {
      mediaQuery.removeEventListener?.('change', update);
      if (!mediaQuery.removeEventListener) mediaQuery.removeListener?.(update);
    };
  }, [query]);

  return matches;
}

export function SatSessionRoomInspector({
  open,
  onOpenChange,
  restoreFocusTarget,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusTarget: () => HTMLElement | null;
  children: ReactNode;
}) {
  const tablet = useMediaQuery(TABLET_INSPECTOR_QUERY);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      <button
        ref={closeButtonRef}
        type="button"
        className="sat-room__inspector-close"
        aria-label="Close student inspector"
        onClick={() => onOpenChange(false)}
      >
        <X size={17} aria-hidden="true" />
      </button>
      {children}
    </>
  );

  if (tablet) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="sat-room__inspector-dialog-overlay" />
          <Dialog.Content
            className="sat-room__inspector-dialog sat-product"
            aria-label="Selected student inspector"
            aria-modal="true"
            data-inspector-open="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = restoreFocusTarget();
              if (trigger?.isConnected) trigger.focus();
              else document.querySelector<HTMLElement>('.sat-room__roster [role="listbox"]')?.focus();
            }}
          >
            <Dialog.Title className="sr-only">Selected student inspector</Dialog.Title>
            <Dialog.Description className="sr-only">Inspect the selected student's session, timing, and attention details.</Dialog.Description>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <aside className="sat-room__inspector" aria-label="Selected student inspector" data-inspector-open={open}>
      <div className="sat-room__inspector-panel">{content}</div>
    </aside>
  );
}
