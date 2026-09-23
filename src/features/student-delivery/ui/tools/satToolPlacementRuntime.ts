/**
 * SAT tool placement runtime (tool-window system, Phase 02).
 *
 * Browser-allowed measurement helper (lives under ui/, NOT domain/): it
 * gathers one SatPlacementInput for the pure placeSatTool brain - viewport,
 * safe area from the Phase-01 CSS tokens, the active question box, already-
 * open tools, the topbar trigger, and the remembered user position from the
 * geometry store. Panels (Phase 03/04) call this, then placeSatTool, then
 * clamp the result; the DOM-measurement logic lives in exactly one place.
 */

import { loadSatToolGeometry, satToolGeometryKey } from '../../infrastructure/satToolGeometryStore';
import type { SatPlacementInput, SatRect, SatSafeArea, SatViewport } from '../../domain/satToolPlacement';
import { resolveSatToolSize, type SatToolKind, type SatToolMode } from '../../domain/satToolSizePolicy';

export const SAT_TOOL_SAFE_INSET_FALLBACK = 16;
export const SAT_TOOL_HEADER_HEIGHT_FALLBACK = 96;
export const SAT_TOOL_FOOTER_HEIGHT_FALLBACK = 70;

export const SAT_TOOL_TRIGGER_ATTRIBUTE = 'data-sat-tool-trigger';
export const SAT_TOOL_QUESTION_SELECTOR = '[data-sat-question-scroll], [aria-label=Question]';
export const SAT_TOOL_EXISTING_SELECTOR = '[data-sat-floating-tool]';

function readCssPixel(variable: string, fallback: number): number {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(variable);
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export function readSatToolSafeArea(): SatSafeArea {
  const inset = readCssPixel('--sat-tool-safe-inset', SAT_TOOL_SAFE_INSET_FALLBACK);
  const header = readCssPixel('--sat-exam-header-height', SAT_TOOL_HEADER_HEIGHT_FALLBACK);
  const footer = readCssPixel('--sat-exam-footer-height', SAT_TOOL_FOOTER_HEIGHT_FALLBACK);
  return { top: header + inset, right: inset, bottom: footer + inset, left: inset };
}

export function readSatToolViewport(
  viewportToLogicalLength: (physicalLength: number) => number = (length) => length,
): SatViewport {
  try {
    if (typeof window === 'undefined') return { w: 1280, h: 800 };
    return {
      w: viewportToLogicalLength(window.innerWidth),
      h: viewportToLogicalLength(window.innerHeight),
    };
  } catch {
    return { w: 1280, h: 800 };
  }
}

function rectOf(element: Element | null): SatRect | null {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  try {
    const box = element.getBoundingClientRect();
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  } catch {
    return null;
  }
}

const TOOL_TITLE_BY_KIND: Record<SatToolKind, string> = { calculator: 'Calculator', reference: 'Reference Sheet' };

function readExistingTools(exclude: SatToolKind): SatRect[] {
  try {
    if (typeof document === 'undefined') return [];
    const found: SatRect[] = [];
    const nodes = document.querySelectorAll(SAT_TOOL_EXISTING_SELECTOR);
    nodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.getAttribute('data-sat-floating-tool') === TOOL_TITLE_BY_KIND[exclude]) return;
      const rect = rectOf(node);
      if (rect) found.push(rect);
    });
    return found;
  } catch {
    return [];
  }
}

export interface SatToolPlacementContextOptions {
  scheduleId: string;
  attemptId: string;
  moduleAttemptId: string;
  mode?: SatToolMode;
}

/**
 * Measure one SatPlacementInput for the given tool. Never throws: every
 * unmeasurable surface (question, trigger, storage) degrades to null so
 * the pure brain scores that term as 0 and the tool takes the top free
 * edge. Uses resolveSatToolSize for the desired size (first-open size for
 * the active mode; mode switch preserves geometry per Phase 03).
 */
export function measureSatToolPlacementContext(tool: SatToolKind, options: SatToolPlacementContextOptions): SatPlacementInput {
  const viewport = readSatToolViewport();
  const safeArea = readSatToolSafeArea();
  const desired = resolveSatToolSize(tool, options.mode);
  let question: SatRect | null = null;
  let trigger: SatRect | null = null;
  let existing: SatRect[] = [];
  try {
    if (typeof document !== 'undefined') {
      question = rectOf(document.querySelector(SAT_TOOL_QUESTION_SELECTOR));
      trigger = rectOf(document.querySelector('[' + SAT_TOOL_TRIGGER_ATTRIBUTE + '="' + tool + '"]'));
    }
  } catch {
    question = null;
    trigger = null;
  }
  existing = readExistingTools(tool);
  let lastPosition: SatPlacementInput['lastPosition'] = null;
  try {
    const saved = loadSatToolGeometry(satToolGeometryKey(options.scheduleId, options.attemptId, options.moduleAttemptId, tool));
    if (saved) lastPosition = { x: saved.x, y: saved.y };
  } catch {
    lastPosition = null;
  }
  return { tool: { w: desired.w, h: desired.h }, viewport, safeArea, question, existing, trigger, lastPosition };
}
