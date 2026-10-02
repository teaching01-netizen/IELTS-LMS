import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsPresent } from 'motion/react';
import { SAT_OVERLAY_Z } from '../primitives/satOverlayZ';
import { createSatExamZoomGeometry, type SatExamZoomGeometry } from './satExamZoomGeometry';

export interface SatExamVisualSpace extends SatExamZoomGeometry {
  examOverlayRoot: HTMLElement | null;
  viewportOverlayRoot: HTMLElement | null;
}

const DEFAULT_VISUAL_SPACE: SatExamVisualSpace = {
  ...createSatExamZoomGeometry(1),
  examOverlayRoot: null,
  viewportOverlayRoot: null,
};

const SatExamZoomContext = createContext<SatExamVisualSpace>(DEFAULT_VISUAL_SPACE);

export function useSatExamZoom(): SatExamVisualSpace {
  return useContext(SatExamZoomContext);
}

export interface SatExamZoomPlaneProps {
  scale: number;
  viewportClassName: string;
  viewportStyle?: CSSProperties | undefined;
  planeClassName?: string | undefined;
  height?: number | null | undefined;
  contrastMode?: string | undefined;
  children: ReactNode;
  /** Lift overlays above a persistent tool hosted outside the stage. */
  portalOverlays?: boolean;
}

/** Physical viewport with one expanded, transformed logical exam plane. */
export function SatExamZoomPlane({
  scale,
  viewportClassName,
  viewportStyle,
  planeClassName = '',
  height,
  contrastMode = 'default',
  children,
  portalOverlays = false,
}: SatExamZoomPlaneProps) {
  const isPresent = useIsPresent();
  const geometry = useMemo(() => createSatExamZoomGeometry(scale), [scale]);
  const [examOverlayRoot, setExamOverlayRoot] = useState<HTMLDivElement | null>(null);
  const [viewportOverlayRoot, setViewportOverlayRoot] = useState<HTMLDivElement | null>(null);
  const visualSpace = useMemo<SatExamVisualSpace>(() => ({
    ...geometry,
    examOverlayRoot,
    viewportOverlayRoot,
  }), [geometry, examOverlayRoot, viewportOverlayRoot]);
  const logicalHeight = height != null && Number.isFinite(height)
    ? `${height / geometry.scale}px`
    : `${100 / geometry.scale}dvh`;
  const zoomPlaneStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: `${100 / geometry.scale}%`,
    height: `${100 / geometry.scale}%`,
    maxHeight: `${100 / geometry.scale}%`,
    transform: `scale(${geometry.scale})`,
    transformOrigin: '0 0',
    '--sat-screen-zoom': String(geometry.scale),
    '--sat-exam-logical-width': `${100 / geometry.scale}vw`,
    '--sat-exam-logical-height': logicalHeight,
    '--sat-exam-logical-height-70': height != null && Number.isFinite(height)
      ? `${height * 0.7 / geometry.scale}px`
      : `${70 / geometry.scale}dvh`,
    '--sat-exam-logical-height-56': height != null && Number.isFinite(height)
      ? `${height * 0.56 / geometry.scale}px`
      : `${56 / geometry.scale}dvh`,
    '--sat-exam-logical-height-54': height != null && Number.isFinite(height)
      ? `${height * 0.54 / geometry.scale}px`
      : `${54 / geometry.scale}dvh`,
  } as CSSProperties;

  const examOverlays = <div
    ref={setExamOverlayRoot} data-sat-exam-overlay-root="true"
    className="sat-ui sat-exam-overlay-root" data-sat-contrast={contrastMode}
    inert={!isPresent} aria-hidden={!isPresent || undefined}
    style={portalOverlays ? { ...zoomPlaneStyle, position: 'fixed', zIndex: SAT_OVERLAY_Z.notesBackdrop, visibility: isPresent ? undefined : 'hidden' } : undefined}
  />;
  const viewportOverlays = <div
    ref={setViewportOverlayRoot} data-sat-viewport-overlay-root="true"
    className="sat-ui sat-viewport-overlay-root" data-sat-contrast={contrastMode}
    inert={!isPresent} aria-hidden={!isPresent || undefined}
    style={portalOverlays ? { zIndex: SAT_OVERLAY_Z.blockingVeil, visibility: isPresent ? undefined : 'hidden' } : undefined}
  />;

  return (
    <SatExamZoomContext.Provider value={visualSpace}>
      <div
        data-sat-exam-viewport="true"
        className={viewportClassName}
        style={viewportStyle}
      >
        <div
          data-sat-zoom-plane="true"
          data-sat-screen-zoom={geometry.scale}
          className={planeClassName}
          style={zoomPlaneStyle}
        >
          {children}
          {portalOverlays ? createPortal(examOverlays, document.body) : examOverlays}
        </div>
        {portalOverlays ? createPortal(viewportOverlays, document.body) : viewportOverlays}
      </div>
    </SatExamZoomContext.Provider>
  );
}

/** Portal presentation that intentionally stays in physical viewport space. */
export function SatExamViewportOverlay({ children }: { children: ReactNode }) {
  const { viewportOverlayRoot } = useSatExamZoom();
  return viewportOverlayRoot ? createPortal(children, viewportOverlayRoot) : null;
}

/** Portal ordinary exam-owned overlays to the shared, zoomed exam layer. */
export function SatExamOverlayPortal({ children }: { children: ReactNode }) {
  const { examOverlayRoot } = useSatExamZoom();
  return examOverlayRoot ? createPortal(children, examOverlayRoot) : children;
}
