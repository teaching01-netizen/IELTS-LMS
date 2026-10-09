import { useLayoutEffect, useState } from 'react';

/**
 * Live-room pane layout, chosen from the width the room actually has (the
 * product sidebar and browser zoom already subtracted), not the viewport:
 *
 * - `wide`  roster | run sheet | docked student inspector
 * - `split` roster | run sheet; the inspector opens as a side sheet
 * - `stack` roster then run sheet; the inspector opens as a sheet
 *
 * Thresholds keep every pane readable: roster 300–320px, run sheet ≥ 460px
 * (≥ 580px beside a docked inspector), inspector 340–380px.
 */
export type SatRoomLayout = 'wide' | 'split' | 'stack';

const WIDE_MIN_PX = 1280;
const SPLIT_MIN_PX = 760;

export function useSatRoomLayout(): { layout: SatRoomLayout; ref: (node: HTMLElement | null) => void } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  // Unmeasured (no layout engine, e.g. a DOM without geometry): keep every pane
  // mounted in place rather than hiding the inspector behind a dialog.
  const layout: SatRoomLayout = width === 0 || width >= WIDE_MIN_PX ? 'wide' : width >= SPLIT_MIN_PX ? 'split' : 'stack';
  return { layout, ref: setNode };
}
