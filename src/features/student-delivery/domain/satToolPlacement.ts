/**
 * SAT floating-tool placement brain (tool-window system, Phase 02).
 *
 * Pure domain module: plain numbers in, plain numbers out. No React, no DOM,
 * no storage, no window/document/localStorage — every input arrives as a
 * plain number so the module is unit-testable without jsdom and stays green
 * under the domain-purity and browser-boundary architecture gates.
 *
 * Candidate order (spec 4): right edge, left edge, bottom-right, bottom-left,
 * last user position, center LAST. Each candidate is scored (LOWER is better)
 * and ties break by candidate order, so an empty exam always lands the tool
 * on the right edge.
 */

import type { SatToolSize } from "./satToolSizePolicy";

export interface SatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SatViewport {
  w: number;
  h: number;
}

/** Absolute safe-area insets in viewport px (top already includes the exam header + gap). */
export interface SatSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SatPlacementInput {
  /** Desired tool size (already policy-resolved). */
  tool: SatToolSize;
  viewport: SatViewport;
  /** Absolute insets: top = header + gap, etc. */
  safeArea: SatSafeArea;
  /** Active question box in viewport coords, or null when not measurable. */
  question: SatRect | null;
  /** Other open tools, in viewport coords. */
  existing: readonly SatRect[];
  /** The topbar button that opened the tool, or null when not measurable. */
  trigger: SatRect | null;
  /** Remembered user position (top-left), or null when none. */
  lastPosition: { x: number; y: number } | null;
}

export interface SatPlacementResult {
  x: number;
  y: number;
}

/**
 * Cascade offset (px) applied when the second tool cannot fit beside the
 * first: the caller shrinks both tools toward their minimum useful width
 * first, and only then opens the second cascaded (+24,+24) from the first.
 */
export const CASCADE_OFFSET = 24;

/** SAT-prefixed alias of CASCADE_OFFSET ( codebase token convention). */
export const SAT_TOOL_CASCADE_OFFSET = CASCADE_OFFSET;

/** Placement gap kept between the two tools when both edges are occupied. */
export const SAT_TOOL_EDGE_GAP = 16;

/** Scoring weights (spec 4). Lower total wins. */
export const SAT_PLACEMENT_WEIGHTS = {
  /** Per px^2 of overlap with the active question box. */
  questionOverlap: 10,
  /** Per px^2 of overlap with each already-open tool. */
  existingOverlap: 8,
  /** Per px^2 of the candidate rect falling outside the safe area. */
  outsideSafeArea: 20,
  /** Per px of center distance from the opening trigger (0 when unmeasurable). */
  distanceFromTrigger: 1,
} as const;

type CandidateName = "right" | "left" | "bottomRight" | "bottomLeft" | "last" | "center";

const CANDIDATE_ORDER: readonly CandidateName[] = [
  "right",
  "left",
  "bottomRight",
  "bottomLeft",
  "last",
  "center",
];

/** 0 when disjoint; otherwise the intersection area in px^2. */
export function satOverlapArea(a: SatRect, b: SatRect): number {
  const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (overlapW <= 0) return 0;
  const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapH <= 0) return 0;
  return overlapW * overlapH;
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function safeBounds(viewport: SatViewport, safeArea: SatSafeArea, tool: SatToolSize): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: safeArea.left,
    maxX: viewport.w - safeArea.right - tool.w,
    minY: safeArea.top,
    maxY: viewport.h - safeArea.bottom - tool.h,
  };
}

/** Top-left for every candidate, each folded into the safe-area span. */
export function satPlacementCandidates(input: SatPlacementInput): Record<CandidateName, SatPlacementResult> {
  const bounds = safeBounds(input.viewport, input.safeArea, input.tool);
  const center: SatPlacementResult = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const last = input.lastPosition
    ? {
        x: clampNumber(input.lastPosition.x, bounds.minX, bounds.maxX),
        y: clampNumber(input.lastPosition.y, bounds.minY, bounds.maxY),
      }
    : { x: center.x, y: center.y };
  return {
    right: { x: bounds.maxX, y: bounds.minY },
    left: { x: bounds.minX, y: bounds.minY },
    bottomRight: { x: bounds.maxX, y: bounds.maxY },
    bottomLeft: { x: bounds.minX, y: bounds.maxY },
    last,
    center,
  };
}

function rectAt(point: SatPlacementResult, tool: SatToolSize): SatRect {
  return { x: point.x, y: point.y, w: tool.w, h: tool.h };
}

function outsideSafeArea(input: SatPlacementInput, rect: SatRect): number {
  const safe: SatRect = {
    x: input.safeArea.left,
    y: input.safeArea.top,
    w: Math.max(0, input.viewport.w - input.safeArea.left - input.safeArea.right),
    h: Math.max(0, input.viewport.h - input.safeArea.top - input.safeArea.bottom),
  };
  const rectArea = Math.max(0, rect.w) * Math.max(0, rect.h);
  return Math.max(0, rectArea - satOverlapArea(rect, safe));
}

function distanceBetweenCenters(a: SatRect, b: SatRect): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

/** Weighted score for one candidate rect (LOWER is better). */
export function scoreSatPlacementCandidate(input: SatPlacementInput, candidate: SatPlacementResult): number {
  const rect = rectAt(candidate, input.tool);
  let score = 0;
  if (input.question) {
    score += satOverlapArea(rect, input.question) * SAT_PLACEMENT_WEIGHTS.questionOverlap;
  }
  for (const other of input.existing) {
    score += satOverlapArea(rect, other) * SAT_PLACEMENT_WEIGHTS.existingOverlap;
  }
  score += outsideSafeArea(input, rect) * SAT_PLACEMENT_WEIGHTS.outsideSafeArea;
  if (input.trigger) {
    score += distanceBetweenCenters(rect, input.trigger) * SAT_PLACEMENT_WEIGHTS.distanceFromTrigger;
  }
  return score;
}

/**
 * Pick the lowest-obstruction top-left for the tool. Deterministic: the same
 * input always yields the same output, and ties keep candidate order (right
 * edge first, center last).
 */
export function placeSatTool(input: SatPlacementInput): SatPlacementResult {
  const candidates = satPlacementCandidates(input);
  let bestPoint: SatPlacementResult = candidates[CANDIDATE_ORDER[0] ?? "right"];
  let bestScore = scoreSatPlacementCandidate(input, bestPoint);
  for (const name of CANDIDATE_ORDER.slice(1)) {
    const point = candidates[name];
    const score = scoreSatPlacementCandidate(input, point);
    if (score < bestScore) {
      bestPoint = point;
      bestScore = score;
    }
  }
  return { x: bestPoint.x, y: bestPoint.y };
}

/**
 * True when both tools fit on opposite edges of the safe area with a gap
 * between them. When false, the caller (Phase 03/04 panels) shrinks both
 * tools toward their minimum useful width before allowing overlap; if that
 * still fails, the second tool opens cascaded by CASCADE_OFFSET.
 */
export function canFitBoth(
  viewport: SatViewport,
  safeArea: SatSafeArea,
  first: SatToolSize,
  second: SatToolSize,
): boolean {
  const safeW = viewport.w - safeArea.left - safeArea.right;
  if (safeW <= 0) return false;
  return first.w + SAT_TOOL_EDGE_GAP + second.w <= safeW;
}

/** SAT-prefixed alias of canFitBoth (codebase token convention). */
export const canFitBothTools = canFitBoth;
