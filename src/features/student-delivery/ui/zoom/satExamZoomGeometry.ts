export interface SatExamPoint {
  x: number;
  y: number;
}
export interface SatExamSize {
  width: number;
  height: number;
}

export interface SatExamZoomGeometry {
  scale: number;
  logicalSize(physical: SatExamSize): SatExamSize;
  viewportToLogicalPoint(point: SatExamPoint): SatExamPoint;
  logicalToViewportPoint(point: SatExamPoint): SatExamPoint;
  viewportToLogicalLength(value: number): number;
  logicalToViewportLength(value: number): number;
}

/** Coordinate conversions for the one transformed SAT exam plane. */
export function createSatExamZoomGeometry(scale: number): SatExamZoomGeometry {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    scale: safeScale,
    logicalSize: ({ width, height }) => ({ width: width / safeScale, height: height / safeScale }),
    viewportToLogicalPoint: ({ x, y }) => ({ x: x / safeScale, y: y / safeScale }),
    logicalToViewportPoint: ({ x, y }) => ({ x: x * safeScale, y: y * safeScale }),
    viewportToLogicalLength: (value) => value / safeScale,
    logicalToViewportLength: (value) => value * safeScale,
  };
}
