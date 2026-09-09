import { useContext, useEffect, useMemo, useRef } from 'react';
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { StructuredContentRenderer } from '../../../exam-rendering/api/structuredContent';
import type { StructuredTextRenderer } from '../../../exam-rendering/RichStructuredContentRenderer';
import { applySatAnnotationsToText, createSatTextAnnotation, removeSatAnnotationsInRange, type SatQuestionAnnotations, type SatTextAnnotation, type SatTextSegment } from '../../domain/satResponses';
import { SatAnnotationModeContext } from './SatAnnotationModeContext';
import { captureSatTextSelection } from './satTextSelection';

export function SatAnnotatedContent({ content, annotations, region, enabled, onChange, onEditNote }: {
  content: StructuredContent;
  annotations: SatQuestionAnnotations;
  region: 'stimulus' | 'prompt';
  enabled: boolean;
  onChange?: ((annotations: SatQuestionAnnotations) => void) | undefined;
  onEditNote?: ((annotation: SatTextAnnotation) => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const mode = useContext(SatAnnotationModeContext);
  useEffect(() => {
    if (!enabled || !onChange || mode === 'none') return;
    const complete = (event: Event) => {
      if (!root.current) return;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !root.current.contains(event.target))) return;
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
      if (annotations.annotations.length >= 200) return;
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
  }, [annotations, enabled, mode, onChange, onEditNote, region]);
  const renderText = useMemo<StructuredTextRenderer>(() => {
    const blocks = new Map<string, SatTextSegment[]>();
    return ({ nodeId, blockText, text, startOffset }) => {
      const scopedId = `${region}:${nodeId}`;
      let segments = blocks.get(scopedId);
      if (!segments) {
        segments = applySatAnnotationsToText(blockText, annotations.annotations, scopedId);
        blocks.set(scopedId, segments);
      }
      return segments.flatMap((segment) => {
        const start = Math.max(segment.start, startOffset);
        const end = Math.min(segment.end, startOffset + text.length);
        if (end <= start) return [];
        return <span key={start} data-sat-highlight={segment.highlight || undefined} data-sat-underline={segment.underline || undefined}
          style={{
            ...(segment.highlight ? { backgroundColor: 'var(--sat-highlight-background, #fff1a8)', color: 'var(--sat-highlight-text, #1d1d1f)' } : {}),
            ...(segment.underline ? { textDecorationLine: 'underline', textDecorationColor: 'var(--sat-underline, currentColor)', textDecorationThickness: '2px', textUnderlineOffset: '3px' } : {}),
          }}
        >{text.slice(start - startOffset, end - startOffset)}</span>;
      });
    };
  }, [annotations, region, content]);

  return <div ref={root} data-sat-annotation-region={enabled ? region : undefined} data-sat-erase-armed={mode === 'erase' || undefined}
    style={mode === 'erase' ? { cursor: 'cell' } : undefined}>
    <StructuredContentRenderer content={content} renderText={enabled ? renderText : undefined} />
  </div>;
}
