import { describe, expect, it } from 'vitest';
import { SAT_EXAM_ZOOM_MAX, SAT_EXAM_ZOOM_MIN, SAT_EXAM_ZOOM_STEP } from '../../../domain/satReadingPreferences';
import { createSatExamZoomGeometry } from '../satExamZoomGeometry';

const ZOOMS = Array.from(
  { length: Math.round((SAT_EXAM_ZOOM_MAX - SAT_EXAM_ZOOM_MIN) / SAT_EXAM_ZOOM_STEP) + 1 },
  (_, index) => SAT_EXAM_ZOOM_MIN + index * SAT_EXAM_ZOOM_STEP,
);

describe('SAT exam zoom geometry', () => {
  it.each([
    [0.5, 2048, 1536],
    [0.75, 1365.3333333333333, 1024],
    [1, 1024, 768],
    [1.25, 819.2, 614.4],
    [1.5, 2048 / 3, 512],
    [2, 512, 384],
  ])('maps a %s physical scale to its logical viewport', (scale, width, height) => {
    const geometry = createSatExamZoomGeometry(scale);
    expect(geometry.logicalSize({ width: 1024, height: 768 }).width).toBeCloseTo(width, 8);
    expect(geometry.logicalSize({ width: 1024, height: 768 }).height).toBeCloseTo(height, 8);
  });

  it.each(ZOOMS)('round-trips viewport and logical points/lengths at %s', (scale) => {
    const geometry = createSatExamZoomGeometry(scale);
    const viewportPoint = { x: 237.5, y: 611.25 };
    const logicalPoint = geometry.viewportToLogicalPoint(viewportPoint);
    expect(geometry.logicalToViewportPoint(logicalPoint)).toEqual(viewportPoint);
    expect(geometry.logicalToViewportLength(geometry.viewportToLogicalLength(44))).toBeCloseTo(44);
  });
});
