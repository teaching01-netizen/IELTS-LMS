import type { SatSectionKey } from '../application/satRunnerReducer';
import {
  emptySatToolCapabilities,
  resolveSatToolCapabilities,
  type SatToolCapabilities,
} from './satTools';

export type { SatToolCapabilities } from './satTools';

export interface SatExamToolPolicy {
  /** Per-question annotation tools: highlight, underline, anchored notes. */
  highlight: boolean;
  underline: boolean;
  notes: boolean;
  /** Focus-band reading aid. R&W only. */
  lineReader: boolean;
  /** Per-image/graph interactive zoom + pan (Fall 2026). Universal. */
  imageZoom: boolean;
  /** One-click passage/question focus panes. R&W only. */
  passageExpand: boolean;
  /** Exam content zoom (layout-scale magnification). Universal. */
  contentZoom: boolean;
  /** High-contrast / color-filter themes. Universal. */
  contrast: boolean;
  /** Presentation-only reading aids (text size, line spacing). Universal. */
  displaySettings: boolean;
  /** Desmos embedded calculator. Math only, requires module policy. */
  calculator: boolean;
  /** Math reference sheet. Math only, requires module policy. */
  referenceSheet: boolean;
  markForReview: boolean;
  optionEliminator: boolean;
}

export function emptySatExamToolPolicy(): SatExamToolPolicy {
  return {
    highlight: false,
    underline: false,
    notes: false,
    lineReader: false,
    imageZoom: false,
    passageExpand: false,
    contentZoom: false,
    contrast: false,
    displaySettings: false,
    calculator: false,
    referenceSheet: false,
    markForReview: false,
    optionEliminator: false,
  };
}

/**
 * Resolve the full student-facing tool policy for a section.
 *
 * Annotation tools (highlight, underline, notes) are available in both
 * sections; line reader and passage expansion stay Reading and Writing only.
 * Desmos and reference are Math only and additionally require the module
 * tool policy to advertise them, so authored or legacy modules that omit
 * the policy never gain a calculator. Display and accessibility tools
 * (display settings, content zoom, contrast, image zoom) are universal.
 * Mark for review and option eliminator are universal navigation tools.
 *
 * Components must gate on these flags instead of scattering section-key
 * checks through the tree.
 */
export function resolveSatExamToolPolicy(
  sectionKey: SatSectionKey,
  toolPolicy: Record<string, unknown> | string[],
): SatExamToolPolicy {
  const module = resolveSatToolCapabilities(toolPolicy);
  const readingWriting = sectionKey === 'reading-writing';
  return {
    highlight: true,
    underline: true,
    notes: true,
    lineReader: readingWriting,
    imageZoom: true,
    passageExpand: readingWriting,
    contentZoom: true,
    contrast: true,
    displaySettings: true,
    calculator: readingWriting ? false : module.calculator,
    referenceSheet: readingWriting ? false : module.referenceSheet,
    markForReview: true,
    optionEliminator: true,
  };
}

/** Adapter for call sites that only need the legacy calculator/reference pair. */
export function toSatToolCapabilities(policy: SatExamToolPolicy): SatToolCapabilities {
  return { calculator: policy.calculator, referenceSheet: policy.referenceSheet };
}

/** Backfill helper: modules without an explicit policy get section defaults. */
export function emptyModuleToolCapabilities(): SatToolCapabilities {
  return emptySatToolCapabilities();
}
