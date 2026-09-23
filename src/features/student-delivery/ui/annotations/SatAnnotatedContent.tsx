import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { StructuredContentRenderer, type StaticStructuredImageEnlargeApi } from '../../../exam-rendering/api/structuredContent';
import type { StructuredTextRenderer } from '../../../exam-rendering/api/structuredContent';
import { applySatAnnotationsToText, resolveSatTextAnchor, type SatQuestionAnnotations, type SatTextAnnotation, type SatTextSegment } from '../../domain/satResponses';
import { createSatAnnotationNodeId, type SatAnnotationRegion } from '../../domain/satAnnotationIdentity';
import { SAT_COPY } from '../../domain/satCopy';
import { satHighlightInk, satHighlightMarkStyle } from './satAnnotationPalette';
import { measureSatNoteMarkers } from './satAnnotationDom';
import { satNoteMarkersEqual, type SatNoteMarker } from '../../domain/satNoteMarkers';
import { useSatAnnotationView } from './SatAnnotationViewContext';
import { useSatAnnotationSelection } from './useSatAnnotationSelection';
import { SelectionOverlay } from '@shared/ui/selection-v2/react/SelectionOverlay';
import { useSatExamZoom } from '../zoom/SatExamZoomContext';
import { isSatDragRelease } from './satSelectionDragGuard';

/**
 * Renders SAT text with saved annotations and note markers.
 * Selection capture lives in `useSatAnnotationSelection`; writes flow upward
 * through the shell's annotation view context.
 */
export function SatAnnotatedContent({ content, annotations, region, enabled, enlarge, onLimitReached }: {
  content: StructuredContent;
  annotations: SatQuestionAnnotations;
  region: SatAnnotationRegion;
  enabled: boolean;
  enlarge?: StaticStructuredImageEnlargeApi | undefined;
  /** Announced + inline notice when the 200-annotation cap drops a gesture. */
  onLimitReached?: (() => void) | undefined;
}) {
  const { scale: visualScale, viewportOverlayRoot } = useSatExamZoom();
  const root = useRef<HTMLDivElement>(null);
  const view = useSatAnnotationView();
  const { selection: touchSelection, limitNotice } = useSatAnnotationSelection({
    rootRef: root,
    region,
    enabled,
    annotationCount: annotations.annotations.length,
    onLimitReached,
  });

  const contentKey = JSON.stringify(content);

  /**
   * Margin dots: which marked phrases carry a note (`clusterSatNoteMarkers`).
   *
   * Measured after layout rather than derived from the model, because where a
   * phrase sits on screen is a fact only the browser has. They are re-measured
   * only when something can move a mark — marks changing, the Notes pane opening
   * or closing (which re-wraps the passage), text size, zoom, a resize — and never
   * on scroll, since the dots sit inside the prose and travel with it.
   */
  const [noteMarkers, setNoteMarkers] = useState<readonly SatNoteMarker[]>([]);
  const markersEnabled = view.openEditorActive;
  const measureNoteMarkers = useCallback(() => {
    const element = root.current;
    if (!element || !markersEnabled) {
      setNoteMarkers((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const next = measureSatNoteMarkers(element, annotations.annotations);
    // Same dots, same render: a drag-resize must not re-render a question under
    // the student's cursor.
    setNoteMarkers((previous) => (satNoteMarkersEqual(previous, next) ? previous : next));
  }, [annotations, markersEnabled]);

  // A layout effect for the same reason the toolbar's placement is one: the dots
  // belong to the same commit as the prose they point at, so a question the
  // student just turned to never shows its notes a frame late.
  useLayoutEffect(() => {
    measureNoteMarkers();
  }, [measureNoteMarkers]);

  useEffect(() => {
    const element = root.current;
    if (!element || !markersEnabled) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureNoteMarkers);
    observer?.observe(element);
    window.addEventListener('resize', measureNoteMarkers);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureNoteMarkers);
    };
  }, [markersEnabled, measureNoteMarkers]);

  const renderText = useMemo<StructuredTextRenderer>(() => {
    const blocks = new Map<string, SatTextSegment[]>();
    return ({ nodeId, blockText, text, startOffset }) => {
      const scopedId = createSatAnnotationNodeId(region, nodeId);
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
        // The mark this segment belongs to. Stored order decides which mark wins
        // an overlap, exactly as the ink does.
        let segmentMark: SatTextAnnotation | undefined;
        if (segment.highlight || segment.underline) {
          for (const item of annotations.annotations) {
            if (item.anchor.nodeId !== scopedId) continue;
            const range = resolveSatTextAnchor(blockText, item.anchor);
            if (range !== null && range.start < end && start < range.end) {
              segmentMark = item;
              break;
            }
          }
        }
        const match = segmentMark;
        // In-place affordance: clicking a mark opens its editor directly, where
        // color / note / removal live. Two conditions, two different meanings:
        // the capability (`openEditorActive`) and the armed mode. Marks without
        // both stay plain spans — still painted with their ink, never controls.
        const interactive = match !== undefined && view.openEditorActive && view.annotationModeEnabled;
        // A note is what the student wrote, not a kind of mark: the passage
        // reports it as an attribute and the label reads the same one answer —
        // nothing is drawn into the sentence for it.
        const hasNote = typeof match?.note === 'string' && match.note.length > 0;
        const label = match
          ? `${match.kind === 'highlight' ? SAT_COPY.annotations.highlight : SAT_COPY.annotations.underline}: ${match.anchor.exact}. ${hasNote ? SAT_COPY.annotations.editNote : SAT_COPY.annotations.addNote}`
          : undefined;
        return (
          <span
            key={start}
            // What the mark IS, present whenever it is painted: its identity and
            // whether it carries a note. These are facts about the student's
            // work, not about the tool — the margin dots measure against the id
            // and closing a note returns focus to it, and both have to keep
            // working with annotation unarmed. Without the id, turning the mode
            // off would make the student's own dots disappear.
            {...(match
              ? {
                  'data-sat-annotation-id': match.id,
                  // Truthful, not decorative: present only when there is a note.
                  ...(hasNote ? { 'data-sat-annotation-note': 'true' } : {}),
                }
              : {})}
            // What the mark OFFERS, present only while annotation is armed. The
            // same mark, in one place: never rebuilt as a second markup branch.
            {...(interactive && match
              ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  'data-sat-annotation-control': 'true',
                  'data-sat-annotation-active': view.activeAnnotationId === match.id ? 'true' : undefined,
                  'aria-label': label,
                  title: label,
                  className: 'rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]',
                  onClick: (event: React.MouseEvent) => {
                    // A drag that ends on a mark is the student selecting NEW text
                    // (the selection is already reported); only a real tap opens the
                    // editor, otherwise the toolbar would vanish under their finger
                    // and that mark's edit controls would open instead.
                    if (isSatDragRelease(event.clientX, event.clientY)) return;
                    view.openEditor(match);
                  },
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    view.openEditor(match);
                  },
                }
              : {})}
            data-sat-highlight={segment.highlight ? 'true' : undefined}
            data-sat-underline={segment.underline ? 'true' : undefined}
            data-sat-highlight-color={segment.highlight ?? undefined}
            // Keep the mark a real inline fragment so a multi-line selection
            // paints only its text instead of a full-width form control, and
            // clone the decoration per wrapped line for the same geometry in
            // Chromium and WebKit.
            style={{
              ...(segment.highlight ? satHighlightMarkStyle(segment.highlight) : {}),
              ...(segment.underline ? { textDecorationLine: 'underline', textDecorationColor: 'var(--sat-underline, currentColor)', textDecorationThickness: '2px', textUnderlineOffset: '3px' } : {}),
              // Cloned per wrapped line for the same geometry in Chromium and
              // WebKit. Keyed on the mark being PAINTED, never on it being
              // interactive: arming the mode must not restyle anyone's ink.
              ...(segment.highlight || segment.underline ? { boxDecorationBreak: 'clone' as const, WebkitBoxDecorationBreak: 'clone' as const } : {}),
              ...(segment.underline && !segment.highlight ? { color: 'inherit' } : {}),
            }}
          >
            {text.slice(start - startOffset, end - startOffset)}
          </span>
        );
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contentKey is the memo input; the raw content object is consumed by the renderer, not read here.
  }, [annotations, region, contentKey, view.activeAnnotationId, view.openEditorActive, view.annotationModeEnabled, view.openEditor]);

  return (
    <div>
      <div
        ref={root}
        data-sat-selection-protected="true"
        data-sat-annotation-region={enabled ? region : undefined}
        data-sat-highlight-preview={enabled ? 'true' : undefined}
        className="relative rounded-[8px]"
      >
        <StructuredContentRenderer content={content} renderText={enabled ? renderText : undefined} enlarge={enlarge} />
        {/* The margin dots: one per line that carries a note, level with the
            phrase's first line, in that highlight's own ink — the same dot the
            note's card shows in the pane, so the two ends read as one object.

            Decoration, and nothing else: hidden from assistive tech (the mark's
            own label already says "Edit note"), never a target (the marked words
            stay the way in), and skipped on phone widths, where there is no
            gutter to spare and the pane is how notes are reached. Nothing is
            drawn into the sentence — the passage stays prose. */}
        {noteMarkers.length > 0 ? (
          <div
            aria-hidden="true"
            data-sat-note-markers="true"
            className="pointer-events-none absolute inset-0 hidden md:block"
          >
            {noteMarkers.map((marker) => (
              <span
                key={marker.id}
                data-sat-note-marker={marker.id}
                data-sat-note-marker-color={marker.color ?? 'yellow'}
                // The gutter, not the text: one dot's width clear of the prose.
                className="absolute -left-3.5 h-[7px] w-[7px] -translate-y-1/2 rounded-full border border-[var(--sat-divider-strong)]"
                style={{ top: marker.top, backgroundColor: satHighlightInk(marker.color).swatch }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* The owned selection: lines, handles, magnifier. It stays painted after
          the finger lifts, so the span the student is deciding about remains
          visible under the shell's toolbar instead of vanishing at release. */}
      <SelectionOverlay
        selection={touchSelection}
        visualScale={visualScale}
        portalContainer={viewportOverlayRoot}
        loupe={{ sourceRef: root }}
      />

      {limitNotice ? (
        <p role="alert" data-testid={"sat-annotation-limit-" + region} className="mb-2 rounded-[8px] border border-[var(--sat-danger)] bg-[var(--sat-surface)] px-3 py-2 text-[13px] font-medium text-[var(--sat-danger)]">
          {SAT_COPY.annotations.limitReached}
        </p>
      ) : null}
    </div>
  );
}
