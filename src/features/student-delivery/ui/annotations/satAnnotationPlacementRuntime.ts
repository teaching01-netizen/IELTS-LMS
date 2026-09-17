import type { SatTextAnchor } from '../../domain/satResponses';
import {
  satAnnotationAnchorGeometryFor,
  type SatAnchorGeometry,
  type SatRectLike,
} from './satSelectionAnchor';

/**
 * Everything the placement engine needs, measured once.
 *
 * This is the browser-facing half of placement: the engine decides from plain
 * numbers, and this module is the only place that asks the DOM for them. Keeping
 * it separate means the hook above owns timing (coalescing, settling, holds) and
 * nothing else, and it means "what does a measurement consist of" has one
 * answer instead of being spread through effect bodies.
 */
export interface SatAnnotationMeasurement {
  /** Positioning container for the surface. */
  bounds: SatRectLike;
  /** The region the surface must stay inside — what the student can SEE. */
  viewport: SatRectLike;
  /** Measured surface size, or null when the element has not laid out yet. */
  size: { width: number; height: number } | null;
  /** Where the anchored span sits, or null when it cannot be measured. */
  anchor: SatAnchorGeometry | null;
  /** Fingerprint of the measurement; a different value means geometry moved. */
  key: string;
}

/** Used before the surface has been measured (and wherever the DOM cannot). */
export const SAT_ANNOTATION_DOCK_FALLBACK_SIZE = { width: 320, height: 168 };

/**
 * The visual viewport, not the layout viewport. Pinch zoom, a software keyboard,
 * and Safari's own chrome all shrink what the student can actually see, and a
 * surface placed against the layout viewport can end up under the keyboard or
 * off the zoomed-in view entirely.
 */
export function satAnnotationViewportRect(): SatRectLike {
  if (typeof window === 'undefined') return { left: 0, top: 0, width: 1024, height: 768 };
  const viewport = window.visualViewport;
  if (!viewport) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height };
}

/**
 * The surface's positioning container. Falls back to the visible region when the
 * body has not laid out, so a budget is still evaluated against something real
 * rather than against zero.
 */
export function satAnnotationBoundsRect(container: HTMLElement | null): SatRectLike {
  const element = container?.closest<HTMLElement>('[data-sat-annotation-bounds]') ?? null;
  const rect = element?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return satAnnotationViewportRect();
}

function keyPart(value: number): number {
  // Sub-pixel noise is not movement: a measurement that differs by less than a
  // pixel would otherwise read as the student still dragging.
  return Math.round(value);
}

function measurementKey(
  anchor: SatAnchorGeometry | null,
  bounds: SatRectLike,
  viewport: SatRectLike,
): string {
  const parts = [
    bounds.left, bounds.top, bounds.width, bounds.height,
    viewport.left, viewport.top, viewport.width, viewport.height,
    anchor?.left ?? 0, anchor?.top ?? 0, anchor?.right ?? 0, anchor?.bottom ?? 0,
    anchor?.firstLine.left ?? 0, anchor?.firstLine.right ?? 0,
  ];
  return parts.map(keyPart).join(':');
}

export function measureSatAnnotation(
  container: HTMLElement | null,
  anchor: SatTextAnchor | null,
): SatAnnotationMeasurement {
  const bounds = satAnnotationBoundsRect(container);
  const viewport = satAnnotationViewportRect();
  const size =
    container && container.offsetWidth > 0 && container.offsetHeight > 0
      ? { width: container.offsetWidth, height: container.offsetHeight }
      : null;
  const geometry = anchor ? satAnnotationAnchorGeometryFor(anchor) : null;
  return { bounds, viewport, size, anchor: geometry, key: measurementKey(geometry, bounds, viewport) };
}
