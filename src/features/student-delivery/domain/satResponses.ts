export type SatTextAnnotationKind = 'highlight' | 'underline';

/**
 * Highlight ink. `yellow` is the canonical default: an annotation that omits
 * `color` — every payload written before colors existed — renders as yellow,
 * so the wire format stays backwards and forwards compatible.
 */
export type SatHighlightColor = 'yellow' | 'blue' | 'pink';

export const SAT_HIGHLIGHT_COLORS: readonly SatHighlightColor[] = ['yellow', 'blue', 'pink'];
export const defaultSatHighlightColor: SatHighlightColor = 'yellow';

export function isSatHighlightColor(value: unknown): value is SatHighlightColor {
  return value === 'yellow' || value === 'blue' || value === 'pink';
}

export interface SatTextAnchor {
  /** Stable structured-content node id (primary locator with offsets). */
  nodeId: string;
  startOffset: number;
  endOffset: number;
  /** Exact selected text plus surrounding context (recovery locator). */
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface SatTextAnnotation {
  id: string;
  kind: SatTextAnnotationKind;
  anchor: SatTextAnchor;
  /**
   * Highlight ink. Only meaningful for `kind: 'highlight'`; absent means
   * `defaultSatHighlightColor` (yellow), never "no color".
   */
  color?: SatHighlightColor;
  /** Optional note attached to the annotated text. Max 2000 chars. */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SatQuestionAnnotationsV2 {
  version: 2;
  annotations: SatTextAnnotation[];
  /** Migrated v1 freeform per-question note. Displayed as a general note. */
  legacyQuestionNote: string;
}

/** Legacy v1 shape retained for migration input only. */
export interface SatQuestionAnnotationsV1 extends Record<string, unknown> {
  version: 1;
  note: string;
}

export type SatQuestionAnnotations = SatQuestionAnnotationsV2;

export interface SatQuestionResponseDraft {
  questionId: string;
  answer: string;
  markedForReview: boolean;
  eliminatedOptionIds: string[];
  annotations: SatQuestionAnnotations;
}

export const SAT_ANNOTATION_NOTE_LIMIT = 2_000;
export const SAT_ANNOTATION_TEXT_LIMIT = 2_000;
const SAT_ANNOTATION_CONTEXT_LIMIT = 64;
const SAT_MAX_ANNOTATIONS = 200;

let annotationSequence = 0;
function createAnnotationId(): string {
  annotationSequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `sat-ann-${Date.now().toString(36)}-${annotationSequence.toString(36)}-${random}`;
}

function clampOffset(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function clampText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function normalizeAnchor(value: unknown): SatTextAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const nodeId = typeof candidate['nodeId'] === 'string' ? candidate['nodeId'].trim() : '';
  if (!nodeId) return null;
  const startOffset = clampOffset(candidate['startOffset']);
  const endOffset = clampOffset(candidate['endOffset']);
  if (!(endOffset > startOffset)) return null;
  return {
    nodeId,
    startOffset,
    endOffset,
    exact: clampText(candidate['exact'], SAT_ANNOTATION_TEXT_LIMIT),
    ...(typeof candidate['prefix'] === 'string' && candidate['prefix']
      ? { prefix: candidate['prefix'].slice(0, SAT_ANNOTATION_CONTEXT_LIMIT) }
      : {}),
    ...(typeof candidate['suffix'] === 'string' && candidate['suffix']
      ? { suffix: candidate['suffix'].slice(0, SAT_ANNOTATION_CONTEXT_LIMIT) }
      : {}),
  };
}

function normalizeAnnotation(value: unknown): SatTextAnnotation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const kind = candidate['kind'];
  if (kind !== 'highlight' && kind !== 'underline') return null;
  const anchor = normalizeAnchor(candidate['anchor']);
  if (!anchor) return null;
  const createdAt = typeof candidate['createdAt'] === 'string' ? candidate['createdAt'] : null;
  const updatedAt = typeof candidate['updatedAt'] === 'string' ? candidate['updatedAt'] : null;
  const now = new Date().toISOString();
  // Unknown colors degrade to the default instead of dropping the mark: a
  // future palette must never cost a student their highlight on reload.
  const color = kind === 'highlight' && isSatHighlightColor(candidate['color'])
    ? candidate['color']
    : undefined;
  return {
    id: typeof candidate['id'] === 'string' && candidate['id'] ? candidate['id'].slice(0, 80) : createAnnotationId(),
    kind,
    anchor,
    ...(color ? { color } : {}),
    ...(typeof candidate['note'] === 'string' && candidate['note']
      ? { note: candidate['note'].slice(0, SAT_ANNOTATION_NOTE_LIMIT) }
      : {}),
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? createdAt ?? now,
  };
}

function normalizeAnnotationsList(value: unknown): SatTextAnnotation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SatTextAnnotation[] = [];
  for (const entry of value) {
    if (out.length >= SAT_MAX_ANNOTATIONS) break;
    const normalized = normalizeAnnotation(entry);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  out.sort((a, b) =>
    a.anchor.nodeId < b.anchor.nodeId ? -1 : a.anchor.nodeId > b.anchor.nodeId ? 1 : a.anchor.startOffset - b.anchor.startOffset,
  );
  return out;
}

export function emptySatAnnotations(): SatQuestionAnnotations {
  return { version: 2, annotations: [], legacyQuestionNote: '' };
}

export function emptySatAnnotationsV2(): SatQuestionAnnotations {
  return emptySatAnnotations();
}

/**
 * Strict version-aware normalizer. v1 `{version:1, note}` migrates into
 * `{version:2, annotations:[], legacyQuestionNote}` without data loss.
 * Unknown shapes repair to empty v2. Never returns a loose record.
 */
export function normalizeSatAnnotations(value: Record<string, unknown>): SatQuestionAnnotations {
  // Null-like input reaches here from recovery paths that read a missing
  // column, so it repairs to empty v2 instead of throwing (the documented
  // contract: never a loose record, never a crash).
  if (value === null || value === undefined) {
    return { version: 2, annotations: [], legacyQuestionNote: '' };
  }
  const version = (value as { version?: unknown })['version'];
  if (version === 2 || Array.isArray((value as { annotations?: unknown })['annotations'])) {
    const record = value as Record<string, unknown>;
    return {
      version: 2,
      annotations: normalizeAnnotationsList(record['annotations']),
      legacyQuestionNote: clampText(record['legacyQuestionNote'], SAT_ANNOTATION_NOTE_LIMIT),
    };
  }
  return {
    version: 2,
    annotations: [],
    legacyQuestionNote: clampText((value as { note?: unknown })['note'], SAT_ANNOTATION_NOTE_LIMIT),
  };
}

export function createSatTextAnnotation(args: {
  kind: SatTextAnnotationKind;
  nodeId: string;
  startOffset: number;
  endOffset: number;
  exact: string;
  prefix?: string;
  suffix?: string;
  color?: SatHighlightColor | undefined;
  note?: string;
  id?: string;
  now?: string;
}): SatTextAnnotation {
  const now = args.now ?? new Date().toISOString();
  const startOffset = Math.max(0, Math.floor(args.startOffset));
  const endOffset = Math.max(startOffset + 1, Math.floor(args.endOffset));
  // Ink is written explicitly (including yellow) so the payload is
  // self-describing; readers still default an absent color to yellow.
  const color = args.kind === 'highlight' ? (args.color ?? defaultSatHighlightColor) : undefined;
  return {
    id: args.id ?? createAnnotationId(),
    kind: args.kind,
    ...(color ? { color } : {}),
    anchor: {
      nodeId: args.nodeId,
      startOffset,
      endOffset,
      exact: args.exact.slice(0, SAT_ANNOTATION_TEXT_LIMIT),
      ...(args.prefix ? { prefix: args.prefix.slice(0, SAT_ANNOTATION_CONTEXT_LIMIT) } : {}),
      ...(args.suffix ? { suffix: args.suffix.slice(0, SAT_ANNOTATION_CONTEXT_LIMIT) } : {}),
    },
    ...(args.note ? { note: args.note.slice(0, SAT_ANNOTATION_NOTE_LIMIT) } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Remove one annotation by id. Returns the same reference when nothing matches. */
export function removeSatAnnotationById(
  annotations: SatQuestionAnnotations,
  annotationId: string,
): SatQuestionAnnotations {
  if (!annotations.annotations.some((annotation) => annotation.id === annotationId)) return annotations;
  return { ...annotations, annotations: annotations.annotations.filter((annotation) => annotation.id !== annotationId) };
}

export interface SatTextSegment {
  start: number;
  end: number;
  /** Highlight ink for this span, or null when the span is not highlighted. */
  highlight: SatHighlightColor | null;
  underline: boolean;
}

/** Resolve inside the owning node only. Ambiguous or missing text stays undecorated. */
export function resolveSatTextAnchor(text: string, anchor: SatTextAnchor): { start: number; end: number } | null {
  const { exact, startOffset, endOffset } = anchor;
  if (!exact) return null;
  if (Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset) && startOffset >= 0 &&
      endOffset <= text.length && endOffset > startOffset && text.slice(startOffset, endOffset) === exact) {
    return { start: startOffset, end: endOffset };
  }
  let match: { start: number; end: number } | null = null;
  for (let start = text.indexOf(exact); start !== -1; start = text.indexOf(exact, start + 1)) {
    const end = start + exact.length;
    if (anchor.prefix && !text.slice(0, start).endsWith(anchor.prefix)) continue;
    if (anchor.suffix && !text.slice(end).startsWith(anchor.suffix)) continue;
    if (match) return null;
    match = { start, end };
  }
  return match;
}

/**
 * Split plain text into segments from overlapping annotation ranges.
 * Verify/recover anchors before decorating; adjacent segments with identical
 * treatment merge. Renderer maps segments to React spans deterministically.
 *
 * Overlap policy: array order wins — when two highlights of different colors
 * cover the same character, the LATER annotation in the list supplies the
 * ink. `normalizeAnnotationsList` sorts by node then offset, so the same
 * stored payload always paints the same way.
 */
export function applySatAnnotationsToText(
  text: string,
  annotations: readonly SatTextAnnotation[],
  nodeId: string,
): SatTextSegment[] {
  if (!text) return [];
  const length = text.length;
  const highlight = new Array<SatHighlightColor | null>(length).fill(null);
  const underline = new Array<boolean>(length).fill(false);
  let touched = false;
  for (const annotation of annotations) {
    if (annotation.anchor.nodeId !== nodeId) continue;
    const range = resolveSatTextAnchor(text, annotation.anchor);
    if (!range) continue;
    const { start, end } = range;
    touched = true;
    if (annotation.kind === 'highlight') {
      const ink = annotation.color ?? defaultSatHighlightColor;
      for (let i = start; i < end; i += 1) highlight[i] = ink;
    } else {
      for (let i = start; i < end; i += 1) underline[i] = true;
    }
  }
  if (!touched) return [{ start: 0, end: length, highlight: null, underline: false }];
  const segments: SatTextSegment[] = [];
  let start = 0;
  for (let i = 1; i <= length; i += 1) {
    const prevH = highlight[i - 1] ?? null;
    const prevU = underline[i - 1] ?? false;
    const curH = i < length ? (highlight[i] ?? null) : undefined;
    const curU = i < length ? (underline[i] ?? false) : undefined;
    if (curH !== prevH || curU !== prevU) {
      segments.push({ start, end: i, highlight: prevH, underline: prevU });
      start = i;
    }
  }
  return segments.filter((segment) => segment.end > segment.start);
}

/** Resolved ink color of a mark (highlights only; underlines have none). */
export function satAnnotationColor(annotation: SatTextAnnotation): SatHighlightColor {
  return annotation.color ?? defaultSatHighlightColor;
}

/** True when the student has attached a note or any mark to this question. */
export function hasSatAnnotations(annotations: SatQuestionAnnotations): boolean {
  return annotations.annotations.length > 0 || annotations.legacyQuestionNote.trim().length > 0;
}

/** Annotations that carry a note, in stored order (the Notes panel list). */
export function satAnnotatedNotes(annotations: SatQuestionAnnotations): SatTextAnnotation[] {
  return annotations.annotations.filter(
    (annotation) => typeof annotation.note === 'string' && annotation.note.length > 0,
  );
}

function sameAnchor(a: SatTextAnchor, b: SatTextAnchor): boolean {
  return a.nodeId === b.nodeId && a.startOffset === b.startOffset && a.endOffset === b.endOffset && a.exact === b.exact;
}

/**
 * Apply a mark to a resolved selection anchor.
 *
 * Repeating the same action on the same span is idempotent instead of
 * stacking duplicates: an existing highlight is re-inked, an existing
 * underline is left alone. Returns the annotation so callers can open its
 * editor or stage an undo entry without re-deriving it.
 */
export function applySatMarkRange(
  annotations: SatQuestionAnnotations,
  anchor: SatTextAnchor,
  kind: SatTextAnnotationKind,
  options: { color?: SatHighlightColor | undefined; now?: string | undefined } = {},
): { annotations: SatQuestionAnnotations; annotation: SatTextAnnotation } {
  const existing = annotations.annotations.find(
    (annotation) => annotation.kind === kind && sameAnchor(annotation.anchor, anchor),
  );
  if (existing) {
    if (kind !== 'highlight' || existing.color === options.color || options.color === undefined) {
      return { annotations, annotation: existing };
    }
    const annotation: SatTextAnnotation = {
      ...existing,
      color: options.color,
      updatedAt: options.now ?? new Date().toISOString(),
    };
    return {
      annotations: {
        ...annotations,
        annotations: annotations.annotations.map((item) => (item.id === annotation.id ? annotation : item)),
      },
      annotation,
    };
  }
  const annotation = createSatTextAnnotation({
    kind,
    ...anchor,
    ...(options.color ? { color: options.color } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    annotations: { ...annotations, annotations: [...annotations.annotations, annotation] },
    annotation,
  };
}

/** Highlight a selection in the given ink (the toolbar's primary action). */
export function applySatHighlightRange(
  annotations: SatQuestionAnnotations,
  anchor: SatTextAnchor,
  color: SatHighlightColor = defaultSatHighlightColor,
): { annotations: SatQuestionAnnotations; annotation: SatTextAnnotation } {
  return applySatMarkRange(annotations, anchor, 'highlight', { color });
}

/** Underline a selection (the toolbar's secondary action). */
export function applySatUnderlineRange(
  annotations: SatQuestionAnnotations,
  anchor: SatTextAnchor,
): { annotations: SatQuestionAnnotations; annotation: SatTextAnnotation } {
  return applySatMarkRange(annotations, anchor, 'underline');
}

/**
 * Resolve the annotation a note should attach to, creating a highlight with
 * the default ink when the selection is not marked yet. "Add note" always
 * leaves a visible mark behind — a note with no source would be unfindable.
 */
export function attachSatNoteToAnchor(
  annotations: SatQuestionAnnotations,
  anchor: SatTextAnchor,
): { annotations: SatQuestionAnnotations; annotation: SatTextAnnotation } {
  return applySatMarkRange(annotations, anchor, 'highlight', { color: defaultSatHighlightColor });
}

/** Re-ink a highlight (one tap on an existing mark, never delete-and-redo). */
export function setSatAnnotationColor(
  annotations: SatQuestionAnnotations,
  annotationId: string,
  color: SatHighlightColor,
  now: string = new Date().toISOString(),
): SatQuestionAnnotations {
  const target = annotations.annotations.find((annotation) => annotation.id === annotationId);
  if (!target || target.kind !== 'highlight' || target.color === color) return annotations;
  return {
    ...annotations,
    annotations: annotations.annotations.map((annotation) =>
      annotation.id === annotationId ? { ...annotation, color, updatedAt: now } : annotation,
    ),
  };
}

/**
 * Undo support: put a removed annotation back at the index it occupied so the
 * restored payload matches the pre-delete order (the stored order is what
 * decides overlap ink).
 */
export function reinsertSatAnnotation(
  annotations: SatQuestionAnnotations,
  annotation: SatTextAnnotation,
  index: number,
): SatQuestionAnnotations {
  if (annotations.annotations.some((item) => item.id === annotation.id)) return annotations;
  const next = [...annotations.annotations];
  const at = Math.max(0, Math.min(Math.floor(index), next.length));
  next.splice(at, 0, annotation);
  return { ...annotations, annotations: next };
}

export function emptySatQuestionResponse(questionId: string): SatQuestionResponseDraft {
  return {
    questionId,
    answer: '',
    markedForReview: false,
    eliminatedOptionIds: [],
    annotations: emptySatAnnotations(),
  };
}
export function responseForQuestion(
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
  questionId: string,
): SatQuestionResponseDraft {
  return responses[questionId] ?? emptySatQuestionResponse(questionId);
}

export function isSatResponseAnswered(response: SatQuestionResponseDraft | undefined): boolean {
  return Boolean(response?.answer.trim());
}
