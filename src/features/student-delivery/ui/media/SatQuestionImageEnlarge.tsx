import { useCallback, useRef, useState } from "react";
import type { StaticStructuredImageEnlargeApi } from "../../../exam-rendering/api/structuredContent";
import type { SatImageEnlargeProps } from "../../../exam-rendering/api/structuredContentEnlarge";
import { satImageGestureTransform } from "../../domain/satImageZoom";
import { useSatImageZoom } from "../../hooks/useSatImageZoom";
import { SatImageStrip } from "./SatImageStrip";
import { SatImageViewer } from "./SatImageViewer";

/**
 * Question-image inspection wiring (student-delivery side of the
 * exam-rendering enlarge slot).
 *
 * exam-rendering owns the image block: the frame, its crop, the measured
 * geometry, and the DOM mechanics of a gesture. This adapter owns the Bluebook
 * presentation that the frame hosts — the quiet strip above the figure and the
 * full-screen escalation of the same view. The feature boundary stays
 * one-directional: student-delivery imports exam-rendering, never the reverse.
 *
 * One view, two windows: the strip commands the embedded frame and the
 * full-screen layer commands its own pane, but both read and write the single
 * view the frame holds, so escalating never spends the student's place in the
 * figure.
 */
export function SatQuestionImageEnlarge(props: SatImageEnlargeProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | undefined>(undefined);
  const controller = useSatImageZoom({
    view: props.view,
    geometry: props.geometry,
    onViewChange: props.onViewChange,
  });

  /**
   * Where the figure sits on screen at the moment it is expanded.
   *
   * Measured here, next to the control that owns the action, rather than passed
   * down from the frame: a rect is only true for the scroll position it was read
   * at, and this is the one instant that matters. If the lookup ever fails the
   * viewer simply appears without growing, which is the honest degradation.
   */
  const openFullScreen = useCallback(() => {
    const figure = document.getElementById(props.enlargeId)?.closest("figure");
    const rect = figure?.querySelector("img")?.getBoundingClientRect();
    setOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
    props.onOpen();
  }, [props]);

  return (
    <>
      <SatImageStrip
        label={props.label}
        toolbarRef={stripRef}
        zoom={controller.zoom}
        canZoomIn={controller.canZoomIn}
        canZoomOut={controller.canZoomOut}
        dirty={controller.dirty}
        fullScreen={props.open}
        onZoomIn={controller.zoomIn}
        onZoomOut={controller.zoomOut}
        onReset={controller.reset}
        onToggleFullScreen={props.open ? props.onClose : openFullScreen}
        fullScreenButtonId={props.enlargeId}
      />
      <SatImageViewer
        src={props.src}
        alt={props.label}
        open={props.open}
        onClose={props.onClose}
        view={props.view}
        geometry={props.geometry}
        onViewChange={props.onViewChange}
        returnFocusSelector={props.returnFocusSelector}
        origin={origin}
      />
    </>
  );
}

export function renderSatQuestionImageEnlarge(props: SatImageEnlargeProps) {
  return <SatQuestionImageEnlarge {...props} />;
}

/**
 * The whole seam in one object: what to draw, and what a gesture on the frame
 * means. Both are presentation-free, so the renderer keeps holding no zoom maths
 * and this module keeps holding no DOM mechanics.
 */
export const SAT_QUESTION_IMAGE_ENLARGE: StaticStructuredImageEnlargeApi = {
  renderEnlarge: renderSatQuestionImageEnlarge,
  resolveGesture: satImageGestureTransform,
};
