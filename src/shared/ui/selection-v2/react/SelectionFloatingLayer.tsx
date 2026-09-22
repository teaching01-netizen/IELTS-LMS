import React, { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/selection.css';

/**
 * The top layer, behind one name so no caller has to care how it is done.
 *
 * Contextual chrome has to sit above whatever the exam's own layout created —
 * split panes, sticky headers, elevated cards — and the way that used to be
 * solved was `z-index: 999999`, which is a number that means "whoever wrote it
 * last". The HTML Popover API is the platform's own answer: a `popover="manual"`
 * element is promoted to the top layer by the browser, above every stacking
 * context, with no z-index at all.
 *
 * It is not available everywhere yet, and a product must not depend on which one
 * it got, so this adapter prefers the popover and falls back to a portal at the
 * document body. Callers see `<SelectionFloatingLayer>` either way; the mode is
 * exposed as a data attribute so a test (and a released trace) can say which one
 * ran.
 */
export interface SelectionFloatingLayerProps {
  open: boolean;
  children: ReactNode;
  /** Accessible name for the layer's content region. */
  label?: string | undefined;
}

export function SelectionFloatingLayer({ open, children, label }: SelectionFloatingLayerProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const supportsPopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

  useEffect(() => {
    const element = host.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!element) return;
    if (!supportsPopover) return;
    try {
      if (open && !element.matches(':popover-open')) element.showPopover?.();
      if (!open && element.matches(':popover-open')) element.hidePopover?.();
    } catch {
      // A renderer that reports support and then refuses (a detached node, a
      // policy) leaves the element where the portal already put it: visible.
    }
  }, [open, supportsPopover]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={host}
      {...(supportsPopover ? { popover: 'manual' as const } : {})}
      data-selection-floating-layer={supportsPopover ? 'popover' : 'portal'}
      {...(label ? { 'aria-label': label, role: 'region' } : {})}
      className="selection-v2 selection-v2-layer"
      // The layer never intercepts: only the controls inside it opt back in, so
      // outside-dismissal and the prose underneath keep working.
      style={{ pointerEvents: 'none' }}
    >
      {children}
    </div>,
    document.body,
  );
}
