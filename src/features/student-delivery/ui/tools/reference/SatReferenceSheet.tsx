import { memo, useMemo, type ReactNode } from "react";
import { clampSatReferenceZoom } from "../SatReferenceSheetPanel";

/* ------------------------------------------------------------------ */
/* R-02 frozen constants (phase plan section 5, Step 1)                */
/* ------------------------------------------------------------------ */

export const SAT_REF_CANVAS_W = 1000;
export const SAT_REF_CANVAS_H = 560;
export const SAT_REF_PAD_X = 32;
export const SAT_REF_PAD_TOP = 24;
export const SAT_REF_DIVIDER_Y1 = 236;
export const SAT_REF_DIVIDER_Y2 = 428;
export const SAT_REF_MATH_FONT =
  '"STIX Two Math", "Cambria Math", Georgia, "Times New Roman", serif';
export const SAT_REF_SVG_LABEL_FONT = "Georgia, 'Times New Roman', serif";
export const SAT_REF_INK = "#202124";
export const SAT_REF_STROKE = 1.25;

/**
 * Pure scale math — unit-tested, no DOM (phase plan section 6.1; R-07
 * contain-fit revision).
 *
 * fitScale(viewportWidth, zoom, stageHeight?) =
 *   min(fit, 1) * max(clampZoom(zoom), 1)
 * where fit = min(vw / 1000, vh / 560) when vh is a finite positive
 * number, else vw / 1000 (backward-compat: existing 2-arg calls behave
 * exactly as today). The cap keeps huge windows quiet (the sheet centers
 * at 1x on white); the effective floor keeps legacy persisted zooms < 1
 * rendering as fit with no migration.
 *
 * Non-finite / non-positive widths return 1 (first frame before R-01
 * measures). Zoom clamps through the existing clampSatReferenceZoom import.
 */
export function satRefFitScale(
  viewportWidth: unknown,
  zoom: unknown,
  stageHeight?: unknown,
): number {
  const vw =
    typeof viewportWidth === "number" && Number.isFinite(viewportWidth)
      ? viewportWidth
      : Number.NaN;
  const z = clampSatReferenceZoom(zoom);
  if (!Number.isFinite(vw) || vw <= 0) return 1;
  // Backward-compat: 2-arg calls (stageHeight absent/degenerate) behave
  // exactly as today — fit-width scale with no cap and no zoom floor.
  if (
    typeof stageHeight !== "number" ||
    !Number.isFinite(stageHeight) ||
    stageHeight <= 0
  ) {
    return (vw / SAT_REF_CANVAS_W) * z;
  }
  const fit = Math.min(vw / SAT_REF_CANVAS_W, stageHeight / SAT_REF_CANVAS_H);
  return Math.min(fit, 1) * Math.max(z, 1);
}

/** R-07: epsilon for the panel's overflow-hidden-at-fit switch. */
export const SAT_REF_FIT_EPSILON = 1e-9;

/**
 * R-07: true when the rendered sheet is at fit (nothing to scroll), so the
 * panel can switch the stage to overflow hidden without a scrollbar flash.
 * Pure (no DOM): compares renderScale against fitScale with an epsilon.
 */
export function isSatRefAtFit(
  viewportWidth: unknown,
  zoom: unknown,
  stageHeight?: unknown,
): boolean {
  return (
    satRefFitScale(viewportWidth, zoom, stageHeight) <=
    satRefFitScale(viewportWidth, 1, stageHeight) + SAT_REF_FIT_EPSILON
  );
}

/**
 * Fit-sheet scale hook (R-07; was fit-width). A useMemo computation only —
 * no observer, no effect, no state. ResizeObserver + rAF batching lives in
 * R-01's useSatReferenceStageSize; the panel passes the measured numbers in.
 */
export function useFitScale(
  viewportWidth: number,
  zoom: number,
  stageHeight?: number,
): number {
  return useMemo(
    () => satRefFitScale(viewportWidth, zoom, stageHeight),
    [viewportWidth, zoom, stageHeight],
  );
}

/* ------------------------------------------------------------------ */
/* MathML intrinsic-element declarations (local to this owned file).   */
/* React 19 types ship no MathML JSX intrinsics; the document owns the  */
/* only MathML usage, so the augmentation lives here and nowhere else. */
/* ------------------------------------------------------------------ */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- MathML JSX intrinsics (no other file uses MathML)
  namespace JSX {
    interface IntrinsicElements {
      math: Record<string, unknown> & { children?: ReactNode };
      mi: Record<string, unknown> & { children?: ReactNode };
      mo: Record<string, unknown> & { children?: ReactNode };
      mn: Record<string, unknown> & { children?: ReactNode };
      msup: Record<string, unknown> & { children?: ReactNode };
      mfrac: Record<string, unknown> & { children?: ReactNode };
      msqrt: Record<string, unknown> & { children?: ReactNode };
    }
  }
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- React 19 JSX namespace augmentation for MathML
  namespace JSX {
    interface IntrinsicElements {
      math: Record<string, unknown> & { children?: ReactNode };
      mi: Record<string, unknown> & { children?: ReactNode };
      mo: Record<string, unknown> & { children?: ReactNode };
      mn: Record<string, unknown> & { children?: ReactNode };
      msup: Record<string, unknown> & { children?: ReactNode };
      mfrac: Record<string, unknown> & { children?: ReactNode };
      msqrt: Record<string, unknown> & { children?: ReactNode };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fixed-geometry canvas cell                                          */
/* ------------------------------------------------------------------ */

function Figure({
  label,
  art,
  formula,
}: {
  label: string;
  art: ReactNode;
  formula: ReactNode;
}) {
  return (
    <figure style={{ margin: 0, minWidth: 0, textAlign: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 120,
        }}
      >
        {art}
      </div>
      <figcaption
        className="sat-type-reference"
        style={{
          marginTop: 8,
          color: "var(--sat-text)",
          fontFamily: SAT_REF_MATH_FONT,
        }}
      >
        <span className="sr-only">{label}. </span>
        {formula}
      </figcaption>
    </figure>
  );
}
const MemoFigure = memo(Figure);

/* ------------------------------------------------------------------ */
/* SVG label helper: Georgia italic 14 in user units, ink fill.        */
/* ------------------------------------------------------------------ */

function SvgLabel({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={14}
      fontStyle="italic"
      fontFamily={SAT_REF_SVG_LABEL_FONT}
      fill={SAT_REF_INK}
    >
      {children}
    </text>
  );
}

function SvgFrame({
  viewBox,
  width,
  height,
  label,
  children,
}: {
  viewBox: string;
  width: number;
  height: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 9 diagrams + 2 special triangles (fixed coords, 1.25px ink strokes,  */
/* Georgia italic labels; topology + aria-labels verbatim from shipped) */
/* ------------------------------------------------------------------ */

const CircleArt = memo(function CircleArt() {
  return (
    <SvgFrame
      viewBox="0 0 174 120"
      width={174}
      height={120}
      label="Circle with radius r"
    >
      <circle
        cx={87}
        cy={60}
        r={44}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <circle cx={87} cy={60} r={2.5} fill={SAT_REF_INK} stroke="none" />
      <line
        x1={87}
        y1={60}
        x2={131}
        y2={60}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={106} y={50}>
        r
      </SvgLabel>
    </SvgFrame>
  );
});

const RectangleArt = memo(function RectangleArt() {
  return (
    <SvgFrame
      viewBox="0 0 174 120"
      width={174}
      height={120}
      label="Rectangle with length l and width w"
    >
      <rect
        x={37}
        y={30}
        width={100}
        height={56}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={82} y={100}>
        ℓ
      </SvgLabel>
      <SvgLabel x={143} y={62}>
        w
      </SvgLabel>
    </SvgFrame>
  );
});

const TriangleArt = memo(function TriangleArt() {
  return (
    <SvgFrame
      viewBox="0 0 174 120"
      width={174}
      height={120}
      label="Triangle with base b and height h"
    >
      <path
        d="M27 96 L147 96 L100 18 Z"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <line
        x1={100}
        y1={18}
        x2={100}
        y2={96}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
        strokeDasharray="3 2"
      />
      <SvgLabel x={88} y={110}>
        b
      </SvgLabel>
      <SvgLabel x={106} y={60}>
        h
      </SvgLabel>
    </SvgFrame>
  );
});

const RightTriangleArt = memo(function RightTriangleArt() {
  return (
    <SvgFrame
      viewBox="0 0 174 120"
      width={174}
      height={120}
      label="Right triangle with sides a b and c"
    >
      <path
        d="M37 96 L37 26 L143 96 Z"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <path
        d="M37 84 L49 84 L49 96"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={1}
      />
      <SvgLabel x={22} y={62}>
        b
      </SvgLabel>
      <SvgLabel x={84} y={110}>
        a
      </SvgLabel>
      <SvgLabel x={94} y={54}>
        c
      </SvgLabel>
    </SvgFrame>
  );
});

const PrismArt = memo(function PrismArt() {
  return (
    <SvgFrame
      viewBox="0 0 174 120"
      width={174}
      height={120}
      label="Rectangular prism with length width and height"
    >
      <rect
        x={28}
        y={46}
        width={82}
        height={50}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <path
        d="M28 46 L50 24 L132 24 L110 46 M110 46 L132 24 L132 74 L110 96"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={64} y={110}>
        ℓ
      </SvgLabel>
      <SvgLabel x={118} y={92}>
        w
      </SvgLabel>
      <SvgLabel x={12} y={72}>
        h
      </SvgLabel>
    </SvgFrame>
  );
});

const CylinderArt = memo(function CylinderArt() {
  return (
    <SvgFrame
      viewBox="0 0 216 120"
      width={216}
      height={120}
      label="Cylinder with radius r and height h"
    >
      <ellipse
        cx={108}
        cy={30}
        rx={44}
        ry={14}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <path
        d="M64 30 V90 M152 30 V90"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <ellipse
        cx={108}
        cy={90}
        rx={44}
        ry={14}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <line
        x1={108}
        y1={30}
        x2={152}
        y2={30}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={127} y={24}>
        r
      </SvgLabel>
      <SvgLabel x={158} y={64}>
        h
      </SvgLabel>
    </SvgFrame>
  );
});

const SphereArt = memo(function SphereArt() {
  return (
    <SvgFrame
      viewBox="0 0 216 120"
      width={216}
      height={120}
      label="Sphere with radius r"
    >
      <circle
        cx={108}
        cy={60}
        r={44}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <ellipse
        cx={108}
        cy={60}
        rx={44}
        ry={14}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={1}
      />
      <line
        x1={108}
        y1={60}
        x2={152}
        y2={60}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={127} y={54}>
        r
      </SvgLabel>
    </SvgFrame>
  );
});

const ConeArt = memo(function ConeArt() {
  return (
    <SvgFrame
      viewBox="0 0 216 120"
      width={216}
      height={120}
      label="Cone with radius r and height h"
    >
      <ellipse
        cx={108}
        cy={92}
        rx={44}
        ry={12}
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <path
        d="M64 92 L108 18 L152 92"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <line
        x1={108}
        y1={18}
        x2={108}
        y2={92}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
        strokeDasharray="3 2"
      />
      <SvgLabel x={114} y={58}>
        h
      </SvgLabel>
      <SvgLabel x={127} y={88}>
        r
      </SvgLabel>
    </SvgFrame>
  );
});

const PyramidArt = memo(function PyramidArt() {
  return (
    <SvgFrame
      viewBox="0 0 216 120"
      width={216}
      height={120}
      label="Rectangular pyramid with length width and height"
    >
      <path
        d="M40 96 L150 96 L182 74 L72 74 Z M111 16 L40 96 M111 16 L150 96 M111 16 L182 74 M111 16 L72 74"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <line
        x1={111}
        y1={16}
        x2={111}
        y2={85}
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
        strokeDasharray="3 2"
      />
      <SvgLabel x={117} y={52}>
        h
      </SvgLabel>
    </SvgFrame>
  );
});

const ThirtySixtyNinetyArt = memo(function ThirtySixtyNinetyArt() {
  return (
    <SvgFrame
      viewBox="0 0 180 110"
      width={124}
      height={76}
      label="30 60 90 triangle with sides x, x square root 3, and 2x"
    >
      <path
        d="M15 85 L157 85 L113 14 Z"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={36} y={76}>
        30°
      </SvgLabel>
      <SvgLabel x={115} y={30}>
        60°
      </SvgLabel>
      <SvgLabel x={80} y={100}>
        x√3
      </SvgLabel>
      <SvgLabel x={137} y={54}>
        x
      </SvgLabel>
      <SvgLabel x={52} y={44}>
        2x
      </SvgLabel>
    </SvgFrame>
  );
});

const FortyFiveArt = memo(function FortyFiveArt() {
  return (
    <SvgFrame
      viewBox="0 0 150 110"
      width={104}
      height={76}
      label="45 45 90 triangle with sides x, x, and x square root 2"
    >
      <path
        d="M30 85 L30 17 L120 85 Z"
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
      />
      <SvgLabel x={34} y={32}>
        45°
      </SvgLabel>
      <SvgLabel x={85} y={78}>
        45°
      </SvgLabel>
      <SvgLabel x={12} y={56}>
        x
      </SvgLabel>
      <SvgLabel x={72} y={100}>
        x
      </SvgLabel>
      <SvgLabel x={79} y={50}>
        x√2
      </SvgLabel>
    </SvgFrame>
  );
});

/* ------------------------------------------------------------------ */
/* MathML formulas (D8): minimal mi/mo/mn/msup/mfrac. 2pi keeps the    */
/* exact current characters (2 + pi glyph); script-ell is U+2113.      */
/* ------------------------------------------------------------------ */

/* Serif stack inherits from the wrapping figcaption (HTML) — MathML elements
   carry no style prop: react-dom 19 cannot set style on unknown host tags. */

const CircleFormula = memo(function CircleFormula() {
  return (
    <>
      <math>
        <mi>A</mi>
        <mo>=</mo>
        <mi>π</mi>
        <msup>
          <mi>r</mi>
          <mn>2</mn>
        </msup>
      </math>
      <br />
      <math>
        <mi>C</mi>
        <mo>=</mo>
        <mn>2</mn>
        <mi>π</mi>
        <mi>r</mi>
      </math>
    </>
  );
});

const RectangleFormula = memo(function RectangleFormula() {
  return (
    <math>
      <mi>A</mi>
      <mo>=</mo>
      <mi>ℓ</mi>
      <mi>w</mi>
    </math>
  );
});

const TriangleFormula = memo(function TriangleFormula() {
  return (
    <math>
      <mi>A</mi>
      <mo>=</mo>
      <mfrac>
        <mn>1</mn>
        <mn>2</mn>
      </mfrac>
      <mi>b</mi>
      <mi>h</mi>
    </math>
  );
});

const RightTriangleFormula = memo(function RightTriangleFormula() {
  return (
    <math>
      <msup>
        <mi>a</mi>
        <mn>2</mn>
      </msup>
      <mo>+</mo>
      <msup>
        <mi>b</mi>
        <mn>2</mn>
      </msup>
      <mo>=</mo>
      <msup>
        <mi>c</mi>
        <mn>2</mn>
      </msup>
    </math>
  );
});

const PrismFormula = memo(function PrismFormula() {
  return (
    <math>
      <mi>V</mi>
      <mo>=</mo>
      <mi>ℓ</mi>
      <mi>w</mi>
      <mi>h</mi>
    </math>
  );
});

const CylinderFormula = memo(function CylinderFormula() {
  return (
    <math>
      <mi>V</mi>
      <mo>=</mo>
      <mi>π</mi>
      <msup>
        <mi>r</mi>
        <mn>2</mn>
      </msup>
      <mi>h</mi>
    </math>
  );
});

const SphereFormula = memo(function SphereFormula() {
  return (
    <math>
      <mi>V</mi>
      <mo>=</mo>
      <mfrac>
        <mn>4</mn>
        <mn>3</mn>
      </mfrac>
      <mi>π</mi>
      <msup>
        <mi>r</mi>
        <mn>3</mn>
      </msup>
    </math>
  );
});

const ConeFormula = memo(function ConeFormula() {
  return (
    <math>
      <mi>V</mi>
      <mo>=</mo>
      <mfrac>
        <mn>1</mn>
        <mn>3</mn>
      </mfrac>
      <mi>π</mi>
      <msup>
        <mi>r</mi>
        <mn>2</mn>
      </msup>
      <mi>h</mi>
    </math>
  );
});

const PyramidFormula = memo(function PyramidFormula() {
  return (
    <math>
      <mi>V</mi>
      <mo>=</mo>
      <mfrac>
        <mn>1</mn>
        <mn>3</mn>
      </mfrac>
      <mi>ℓ</mi>
      <mi>w</mi>
      <mi>h</mi>
    </math>
  );
});

/* ------------------------------------------------------------------ */
/* Fixed 1000x560 canvas, absolute layout (phase plan Step 1/Step 5)   */
/*                                                                     */
/* Planar row   y 24-228: 5 cells, col w 174, x 32/222/412/602/792     */
/* Divider 1    y = 236                                               */
/* Solids row   y 244-420: 4 cells, col w 216, x 32/272/512/752       */
/* Divider 2    y = 428                                               */
/* Special row  y 436-544: triangles x 32-500, statements x 524-968    */
/* ------------------------------------------------------------------ */

function SatReferenceSheetInner({
  viewportWidth = 1000,
  zoom = 1,
  stageWidth,
  stageHeight,
}: {
  viewportWidth?: number;
  zoom?: number;
  stageWidth?: number | undefined;
  stageHeight?: number | undefined;
}) {
  const scale = useFitScale(viewportWidth, zoom, stageHeight);
  const hasStage =
    typeof stageWidth === "number" &&
    Number.isFinite(stageWidth) &&
    stageWidth > 0 &&
    typeof stageHeight === "number" &&
    Number.isFinite(stageHeight) &&
    stageHeight > 0;
  // R-07 Step 2 — centering stage. At fit the wrapper IS the stage
  // (letterboxed on --sat-surface, no scroll); when zoomed past fit it grows
  // to the scaled size so the panel scroll node can pan the whole sheet (a
  // fixed stage-sized wrapper with overflow hidden would clip zoomed content
  // before the scroller could reach it). Centering uses computed absolute
  // offsets (not flex): the canvas keeps transform origin top-left, so its
  // 1000x560 layout box would mis-center under flex when scale < 1, and flex
  // centering would strand the top/left edge outside scroll reach when
  // zoomed. Offsets keep every scaled pixel at non-negative coordinates.
  const scaledW = SAT_REF_CANVAS_W * scale;
  const scaledH = SAT_REF_CANVAS_H * scale;
  const wrapperStyle = useMemo(
    () =>
      hasStage
        ? {
            width: Math.max(stageWidth as number, scaledW),
            height: Math.max(stageHeight as number, scaledH),
            position: "relative" as const,
            overflow: "hidden" as const,
          }
        : {
            width: scaledW,
            height: scaledH,
            margin: "0 auto" as const,
          },
    [hasStage, scaledW, scaledH, stageWidth, stageHeight],
  );
  const canvasStyle = useMemo(
    () =>
      hasStage
        ? {
            width: SAT_REF_CANVAS_W,
            height: SAT_REF_CANVAS_H,
            position: "absolute" as const,
            left: (Math.max(stageWidth as number, scaledW) - scaledW) / 2,
            top: (Math.max(stageHeight as number, scaledH) - scaledH) / 2,
            transform: "scale(" + scale + ")",
            transformOrigin: "top left",
            background: "var(--sat-surface)",
            color: "var(--sat-text)",
          }
        : {
            width: SAT_REF_CANVAS_W,
            height: SAT_REF_CANVAS_H,
            position: "relative" as const,
            transform: "scale(" + scale + ")",
            transformOrigin: "top left",
            background: "var(--sat-surface)",
            color: "var(--sat-text)",
          },
    [hasStage, scale, scaledW, scaledH, stageWidth, stageHeight],
  );

  return (
    <article
      aria-label="SAT Math reference sheet"
      className="sat-reference-sheet"
      style={{ background: "var(--sat-surface)" }}
    >
      <div style={wrapperStyle}>
        <div style={canvasStyle} data-sat-ref-canvas>
          {/* Planar row: 5 figures in Bluebook order */}
          <div
            style={{
              position: "absolute",
              left: 32,
              top: 24,
              width: 174,
              height: 204,
            }}
          >
            <MemoFigure label="Circle" art={<CircleArt />} formula={<CircleFormula />} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 222,
              top: 24,
              width: 174,
              height: 204,
            }}
          >
            <MemoFigure
              label="Rectangle"
              art={<RectangleArt />}
              formula={<RectangleFormula />}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 412,
              top: 24,
              width: 174,
              height: 204,
            }}
          >
            <MemoFigure
              label="Triangle"
              art={<TriangleArt />}
              formula={<TriangleFormula />}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 602,
              top: 24,
              width: 174,
              height: 204,
            }}
          >
            <MemoFigure
              label="Right triangle"
              art={<RightTriangleArt />}
              formula={<RightTriangleFormula />}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 792,
              top: 24,
              width: 174,
              height: 204,
            }}
          >
            <MemoFigure label="Rectangular prism" art={<PrismArt />} formula={<PrismFormula />} />
          </div>

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 32,
              top: SAT_REF_DIVIDER_Y1,
              width: 936,
              height: 1,
              background: "var(--sat-divider-soft)",
            }}
          />

          {/* Solids row: 4 figures */}
          <div
            style={{
              position: "absolute",
              left: 32,
              top: 244,
              width: 216,
              height: 176,
            }}
          >
            <MemoFigure
              label="Cylinder"
              art={<CylinderArt />}
              formula={<CylinderFormula />}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: 272,
              top: 244,
              width: 216,
              height: 176,
            }}
          >
            <MemoFigure label="Sphere" art={<SphereArt />} formula={<SphereFormula />} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 512,
              top: 244,
              width: 216,
              height: 176,
            }}
          >
            <MemoFigure label="Cone" art={<ConeArt />} formula={<ConeFormula />} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 752,
              top: 244,
              width: 216,
              height: 176,
            }}
          >
            <MemoFigure
              label="Rectangular pyramid"
              art={<PyramidArt />}
              formula={<PyramidFormula />}
            />
          </div>

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 32,
              top: SAT_REF_DIVIDER_Y2,
              width: 936,
              height: 1,
              background: "var(--sat-divider-soft)",
            }}
          />

          {/* Special row */}
          <section
            aria-labelledby="sat-special-triangles"
            style={{
              position: "absolute",
              left: 32,
              top: 436,
              width: 468,
              height: 108,
            }}
          >
            <h2
              id="sat-special-triangles"
              style={{
                margin: 0,
                textAlign: "center",
                fontWeight: 600,
                fontFamily: SAT_REF_MATH_FONT,
                color: "var(--sat-text)",
              }}
              className="sat-type-control-primary"
            >
              Special Right Triangles
            </h2>
            <div
              style={{
                marginTop: 4,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                gap: 24,
              }}
            >
              <ThirtySixtyNinetyArt />
              <FortyFiveArt />
            </div>
          </section>
          <section
            aria-label="Angle and circle facts"
            style={{
              position: "absolute",
              left: 524,
              top: 436,
              width: 444,
              height: 108,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div
              className="sat-type-reference"
              style={{
                color: "var(--sat-text)",
                fontFamily: SAT_REF_MATH_FONT,
              }}
            >
              <p style={{ margin: "0 0 12px" }}>
                The number of degrees of arc in a circle is 360.
              </p>
              <p style={{ margin: "0 0 12px" }}>
                The number of radians of arc in a circle is 2π.
              </p>
              <p style={{ margin: 0 }}>
                The sum of the measures in degrees of the angles of a triangle
                is 180.
              </p>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

export const SatReferenceSheet = memo(SatReferenceSheetInner);
export default SatReferenceSheet;
