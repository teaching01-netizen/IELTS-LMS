export type SatTextAnnotationKind = 'highlight' | 'underline';

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
  return {
    id: typeof candidate['id'] === 'string' && candidate['id'] ? candidate['id'].slice(0, 80) : createAnnotationId(),
    kind,
    anchor,
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
  note?: string;
  id?: string;
  now?: string;
}): SatTextAnnotation {
  const now = args.now ?? new Date().toISOString();
  const startOffset = Math.max(0, Math.floor(args.startOffset));
  const endOffset = Math.max(startOffset + 1, Math.floor(args.endOffset));
  return {
    id: args.id ?? createAnnotationId(),
    kind: args.kind,
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

/**
 * Remove every highlight/underline whose anchor overlaps `[startOffset, endOffset)`
 * in `nodeId`. Range ends are exclusive so touching-but-adjacent marks survive.
 * Attached notes die with their decoration. Returns the same reference on no-op
 * so callers can skip `onChange` churn.
 */
export function removeSatAnnotationsInRange(
  annotations: SatQuestionAnnotations,
  nodeId: string,
  startOffset: number,
  endOffset: number,
): SatQuestionAnnotations {
  const start = Math.max(0, Math.floor(startOffset));
  const end = Math.max(start + 1, Math.floor(endOffset));
  const next = annotations.annotations.filter(
    (annotation) => !(annotation.anchor.nodeId === nodeId && annotation.anchor.startOffset < end && start < annotation.anchor.endOffset),
  );
  if (next.length === annotations.annotations.length) return annotations;
  return { ...annotations, annotations: next };
}

export interface SatTextSegment {
  start: number;
  end: number;
  highlight: boolean;
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
 */
export function applySatAnnotationsToText(
  text: string,
  annotations: readonly SatTextAnnotation[],
  nodeId: string,
): SatTextSegment[] {
  if (!text) return [];
  const length = text.length;
  const highlight = new Array<boolean>(length).fill(false);
  const underline = new Array<boolean>(length).fill(false);
  let touched = false;
  for (const annotation of annotations) {
    if (annotation.anchor.nodeId !== nodeId) continue;
    const range = resolveSatTextAnchor(text, annotation.anchor);
    if (!range) continue;
    const { start, end } = range;
    touched = true;
    const target = annotation.kind === 'highlight' ? highlight : underline;
    for (let i = start; i < end; i += 1) target[i] = true;
  }
  if (!touched) return [{ start: 0, end: length, highlight: false, underline: false }];
  const segments: SatTextSegment[] = [];
  let start = 0;
  for (let i = 1; i <= length; i += 1) {
    const prevH = highlight[i - 1] ?? false;
    const prevU = underline[i - 1] ?? false;
    const curH = i < length ? (highlight[i] ?? false) : null;
    const curU = i < length ? (underline[i] ?? false) : null;
    if (curH !== prevH || curU !== prevU) {
      segments.push({ start, end: i, highlight: prevH, underline: prevU });
      start = i;
    }
  }
  return segments.filter((segment) => segment.end > segment.start);
}

/** Number of text-anchored annotations, excluding the legacy freeform note. */
export function countSatTextAnnotations(annotations: SatQuestionAnnotations): number {
  return annotations.annotations.length;
}

/** Notes attached to annotated text across a question. */
export function satAnnotationNotes(annotations: SatQuestionAnnotations): { id: string; note: string }[] {
  return annotations.annotations
    .filter((annotation) => typeof annotation.note === 'string' && annotation.note.length > 0)
    .map((annotation) => ({ id: annotation.id, note: annotation.note as string }));
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
