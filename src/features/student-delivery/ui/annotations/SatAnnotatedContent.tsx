import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { StructuredContentRenderer, type StaticStructuredImageEnlargeApi } from '../../../exam-rendering/api/structuredContent';
import type { StructuredTextRenderer } from '../../../exam-rendering/api/structuredContent';
import { applySatAnnotationsToText, createSatTextAnnotation, removeSatAnnotationsInRange, resolveSatTextAnchor, type SatQuestionAnnotations, type SatTextAnnotation, type SatTextSegment } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SatAnnotationModeContext, type SatAnnotationMode } from './SatAnnotationModeContext';
import { captureSatTextSelection } from './satTextSelection';

export const SAT_ANNOTATION_LIMIT = 200;

export function SatAnnotatedContent({ content, annotations, region, enabled, enlarge, onChange, onEditNote, onLimitReached }: {
  content: StructuredContent;
  annotations: SatQuestionAnnotations;
  region: 'stimulus' | 'prompt';
  enabled: boolean;
  enlarge?: StaticStructuredImageEnlargeApi | undefined;
  onChange?: ((annotations: SatQuestionAnnotations) => void) | undefined;
  onEditNote?: ((annotation: SatTextAnnotation) => void) | undefined;
  /** Announced + inline notice when the 200-annotation cap drops a gesture. */
  onLimitReached?: (() => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const mode = useContext(SatAnnotationModeContext);
  const [limitNotice, setLimitNotice] = useState(false);
  const limitTimer = useRef<number | null>(null);
  useEffect(() => () => { if (limitTimer.current !== null) window.clearTimeout(limitTimer.current); }, []);
  const flashLimitNotice = useCallback(() => {
    setLimitNotice(true);
    onLimitReached?.();
    if (limitTimer.current !== null) window.clearTimeout(limitTimer.current);
    limitTimer.current = window.setTimeout(() => setLimitNotice(false), 6000);
  }, [onLimitReached]);
  const armedLabel =
    mode === 'highlight' ? SAT_COPY.annotations.highlightArmed
    : mode === 'underline' ? SAT_COPY.annotations.underlineArmed
    : mode === 'note' ? SAT_COPY.annotations.noteArmed
    : mode === 'erase' ? SAT_COPY.annotations.eraserArmed
    : null;
  useEffect(() => {
    if (!enabled || !onChange || mode === 'none') return;
    const complete = (event: Event) => {
      if (!root.current) return;
      // The mode bar / limit notice render as siblings around the content
      // root, so pointerup may target them: only ignore targets strictly
      // OUTSIDE the whole component (the outer wrapper), not outside the
      // content root itself.
      const scope = root.current.parentElement ?? root.current;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !scope.contains(event.target))) return;
      const anchor = captureSatTextSelection(root.current, region, window.getSelection());
      if (!anchor) return;
      if (mode === 'erase') {
        const next = removeSatAnnotationsInRange(annotations, anchor.nodeId, anchor.startOffset, anchor.endOffset);
        if (next !== annotations) {
          onChange(next);
          window.getSelection()?.removeAllRanges();
        }
        return;
      }
      if (annotations.annotations.length >= SAT_ANNOTATION_LIMIT) {
        flashLimitNotice();
        return;
      }
      const kind = mode === 'note' ? 'highlight' : mode;
      const existing = annotations.annotations.find((item) => item.kind === kind && item.anchor.nodeId === anchor.nodeId &&
        item.anchor.startOffset === anchor.startOffset && item.anchor.endOffset === anchor.endOffset && item.anchor.exact === anchor.exact);
      const annotation = existing ?? createSatTextAnnotation({ kind, ...anchor });
      if (!existing) onChange({ ...annotations, annotations: [...annotations.annotations, annotation] });
      if (mode === 'note') onEditNote?.(annotation);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) complete(event);
    };
    document.addEventListener('pointerup', complete);
    document.addEventListener('keyup', keyboard);
    return () => {
      document.removeEventListener('pointerup', complete);
      document.removeEventListener('keyup', keyboard);
    };
  }, [annotations, enabled, flashLimitNotice, mode, onChange, onEditNote, region]);
  const contentKey = JSON.stringify(content);
  const renderText = useMemo<StructuredTextRenderer>(() => {
    const blocks = new Map<string, SatTextSegment[]>();
    return ({ nodeId, blockText, text, startOffset }) => {
      const scopedId = region + ":" + nodeId;
      // Key the segment cache on the source text: recovered ranges recompute
      // when content changes (new stimulus text) without a response edit.
      const cacheKey = scopedId + "\u0000" + blockText;
      let segments = blocks.get(cacheKey);
      if (!segments) {
        segments = applySatAnnotationsToText(blockText, annotations.annotations, scopedId);
        blocks.set(cacheKey, segments);
      }
      return segments.flatMap((segment) => {
        const start = Math.max(segment.start, startOffset);
        const end = Math.min(segment.end, startOffset + text.length);
        if (end <= start) return [];
        // In-place note affordance: clicking a highlight opens its note
        // editor directly — no separate bottom list of quoted text. Marks
        // without an editor callback stay plain spans (read-only contexts).
        if (segment.highlight && onEditNote) {
          const match = annotations.annotations.find((item) => {
            if (item.anchor.nodeId !== scopedId) return false;
            const range = resolveSatTextAnchor(blockText, item.anchor);
            return range !== null && range.start < end && start < range.end;
          });
          if (match) {
            const label = `${match.note ? "Edit note" : "Add note"}: ${match.anchor.exact}`;
            return <button key={start} type="button" data-sat-highlight data-sat-annotation-note={match.id}
              onClick={() => onEditNote(match)}
              aria-label={label} title={label}
              className="rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
              // Paper highlight (Phase 7, Lane 3): canonical token with
              // Bluebook paper fallback #FFF2B3 (was #fff1a8).
              style={{ backgroundColor: 'var(--sat-highlight-background, #FFF2B3)', color: 'var(--sat-highlight-text, #1d1d1f)', padding: 0 }}
            >{text.slice(start - startOffset, end - startOffset)}</button>;
          }
        }
        return <span key={start} data-sat-highlight={segment.highlight || undefined} data-sat-underline={segment.underline || undefined}
          style={{
            // Paper highlight (Phase 7, Lane 3): canonical token with
            // Bluebook paper fallback #FFF2B3 (was #fff1a8).
            ...(segment.highlight ? { backgroundColor: 'var(--sat-highlight-background, #FFF2B3)', color: 'var(--sat-highlight-text, #1d1d1f)' } : {}),
            ...(segment.underline ? { textDecorationLine: 'underline', textDecorationColor: 'var(--sat-underline, currentColor)', textDecorationThickness: '2px', textUnderlineOffset: '3px' } : {}),
          }}
        >{text.slice(start - startOffset, end - startOffset)}</span>;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contentKey is the memo input; the raw content object is consumed by the renderer, not read here.
  }, [annotations, region, contentKey]);

  const eraseArmed = mode === 'erase';
  // Selection preview (Phase 7): while a paint tool is armed, native text
  // selection previews the paper token via the ::selection utility rule.
  // Erase mode opts out (no preview — removal, not paint). Eraser gesture
  // logic above is untouched.
  const highlightPreview = mode === 'highlight' || mode === 'underline' || mode === 'note';
  // No visible mode bar: highlight mode is silent (the top-bar Highlight
  // button's aria-pressed state is the only indicator). The region keeps
  // data-sat-annotation-mode + aria-describedby for tests and AT; erase
  // keeps its dashed outline + cell cursor as the non-color cue.
  return (
    <div>
      {armedLabel && enabled ? (
        <span id={"sat-annotation-mode-bar-" + region} className="sr-only" role="status" data-testid={"sat-annotation-mode-bar-" + region}>
          {armedLabel}
        </span>
      ) : null}
      <div
        ref={root}
        data-sat-annotation-region={enabled ? region : undefined}
        data-sat-erase-armed={eraseArmed || undefined}
        data-sat-annotation-mode={mode}
        data-sat-highlight-preview={highlightPreview || undefined}
        aria-describedby={armedLabel && enabled ? "sat-annotation-mode-bar-" + region : undefined}
        className={eraseArmed ? "rounded-[8px] outline-2 outline-dashed outline-[var(--sat-danger)] outline-offset-4" : undefined}
        style={eraseArmed ? { cursor: 'cell' } : undefined}
      >
        <StructuredContentRenderer content={content} renderText={enabled ? renderText : undefined} enlarge={enlarge} />
      </div>

      {limitNotice ? (
        // limit notice deliberately AFTER the content root (see NOTE above).
        <p role="alert" data-testid={"sat-annotation-limit-" + region} className="mb-2 rounded-[8px] border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-3 py-2 text-[13px] font-medium text-[var(--sat-danger)]">
          {SAT_COPY.annotations.limitReached}
        </p>
      ) : null}
    </div>
  );
}

export type { SatAnnotationMode };
