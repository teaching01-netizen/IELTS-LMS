import { memo, useMemo, type ReactNode } from "react";
import { clampSatReferenceZoom, SAT_REFERENCE_ZOOM_MAX } from "../SatReferenceSheetPanel";

/* ------------------------------------------------------------------ */
/* Reference canvas dimensions and fit behavior                       */
/* ------------------------------------------------------------------ */

export const SAT_REF_CANVAS_W = 1000;
export const SAT_REF_CANVAS_H = 560;
/** 16px body text stays at least 11.2px; smaller stages scroll. */
export const SAT_REF_READABLE_SCALE_MIN = 0.7;
export const SAT_REF_MATH_FONT = '"Times New Roman", "Cambria Math", serif';
export const SAT_REF_SVG_LABEL_FONT = SAT_REF_MATH_FONT;
export const SAT_REF_INK = "currentColor";
export const SAT_REF_STROKE = 1.25;

/**
 * Contain the canvas in the measured stage, rounded down to avoid subpixel
 * overflow. Stop shrinking at the readable floor and scroll instead. Stored
 * zoom is a multiplier over fit; rendering stops at 200% actual size.
 * Invalid heights use width only; invalid widths fall back to actual size.
 */
export function satRefFitScale(
  viewportWidth: unknown,
  zoom: unknown,
  stageHeight?: unknown,
  examScale = 1,
): number {
  const vw =
    typeof viewportWidth === "number" && Number.isFinite(viewportWidth)
      ? viewportWidth
      : Number.NaN;
  const z = clampSatReferenceZoom(zoom);
  const screenScale = Number.isFinite(examScale) && examScale > 0 ? examScale : 1;
  if (!Number.isFinite(vw) || vw <= 0) return 1 / screenScale;
  const heightScale =
    typeof stageHeight === "number" && Number.isFinite(stageHeight) && stageHeight > 0
      ? stageHeight / SAT_REF_CANVAS_H
      : 1 / screenScale;
  const fit = Math.min(vw / SAT_REF_CANVAS_W, heightScale, 1 / screenScale);
  const roundedFit = Math.floor(fit * 1000) / 1000;
  return Math.min(SAT_REFERENCE_ZOOM_MAX / screenScale, Math.max(SAT_REF_READABLE_SCALE_MIN / screenScale, roundedFit) * z);
}

/** Tolerance for the fit-mode label; never used to hide overflow. */
export const SAT_REF_FIT_EPSILON = 1e-9;

/**
 * True in fit mode, including a readable sheet that needs scrolling.
 */
export function isSatRefAtFit(
  viewportWidth: unknown,
  zoom: unknown,
  stageHeight?: unknown,
  examScale = 1,
): boolean {
  return (
    satRefFitScale(viewportWidth, zoom, stageHeight, examScale) <=
    satRefFitScale(viewportWidth, 1, stageHeight, examScale) + SAT_REF_FIT_EPSILON
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
  examScale = 1,
): number {
  return useMemo(
    () => satRefFitScale(viewportWidth, zoom, stageHeight, examScale),
    [viewportWidth, zoom, stageHeight, examScale],
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
  x,
  y,
}: {
  label: string;
  art: ReactNode;
  formula: ReactNode;
  x: number;
  y: number;
}) {
  return (
    <figure
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 160,
        margin: 0,
        textAlign: "center",
      }}
    >
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
          marginTop: 4,
          fontSize: 16,
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
/* Diagram labels use the same serif face as the formulas.             */
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
      stroke="none"
    >
      {children}
    </text>
  );
}

function SvgFrame({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <svg viewBox="0 0 160 120" width={160} height={120} role="img" aria-label={label}>
      <g
        fill="none"
        stroke={SAT_REF_INK}
        strokeWidth={SAT_REF_STROKE}
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  );
}

const CircleArt = memo(function CircleArt() {
  return (
    <SvgFrame label="Circle with radius r">
      <circle cx={80} cy={52} r={38} />
      <circle cx={80} cy={52} r={3} fill={SAT_REF_INK} stroke="none" />
      <path d="M80 52 H118" />
      <SvgLabel x={95} y={47}>r</SvgLabel>
    </SvgFrame>
  );
});

const RectangleArt = memo(function RectangleArt() {
  return (
    <SvgFrame label="Rectangle with length l and width w">
      <rect x={46} y={50} width={68} height={35} />
      <SvgLabel x={78} y={45}>ℓ</SvgLabel>
      <SvgLabel x={118} y={70}>w</SvgLabel>
    </SvgFrame>
  );
});

const TriangleArt = memo(function TriangleArt() {
  return (
    <SvgFrame label="Triangle with base b and height h">
      <path d="M42 72 L67 19 L118 72 Z" />
      <path d="M67 19 V72" strokeDasharray="3 2" />
      <path d="M67 62 H77 V72" strokeWidth={0.8} />
      <SvgLabel x={73} y={50}>h</SvgLabel>
      <SvgLabel x={74} y={87}>b</SvgLabel>
    </SvgFrame>
  );
});

const RightTriangleArt = memo(function RightTriangleArt() {
  return (
    <SvgFrame label="Right triangle with sides a b and c">
      <path d="M50 80 V26 L118 80 Z" />
      <path d="M50 71 H59 V80" strokeWidth={0.8} />
      <SvgLabel x={37} y={59}>b</SvgLabel>
      <SvgLabel x={77} y={94}>a</SvgLabel>
      <SvgLabel x={88} y={53}>c</SvgLabel>
    </SvgFrame>
  );
});

const PrismArt = memo(function PrismArt() {
  return (
    <SvgFrame label="Rectangular prism with length width and height">
      <path d="M36 55 H91 V83 H36 Z M36 55 L58 41 H113 L91 55 M113 41 V69 L91 83" />
      <SvgLabel x={60} y={98}>ℓ</SvgLabel>
      <SvgLabel x={104} y={81}>w</SvgLabel>
      <SvgLabel x={116} y={58}>h</SvgLabel>
    </SvgFrame>
  );
});

const CylinderArt = memo(function CylinderArt() {
  return (
    <SvgFrame label="Cylinder with radius r and height h">
      <ellipse cx={80} cy={53} rx={34} ry={11} />
      <path d="M46 53 V88 A34 11 0 0 0 114 88 V53" />
      <circle cx={80} cy={53} r={3} fill={SAT_REF_INK} stroke="none" />
      <path d="M80 53 L102 47" />
      <SvgLabel x={94} y={54}>r</SvgLabel>
      <SvgLabel x={118} y={77}>h</SvgLabel>
    </SvgFrame>
  );
});

const SphereArt = memo(function SphereArt() {
  return (
    <SvgFrame label="Sphere with radius r">
      <circle cx={80} cy={60} r={38} />
      <path d="M42 60 A38 15 0 0 1 118 60" strokeDasharray="3 2" strokeWidth={0.8} />
      <path d="M42 60 A38 15 0 0 0 118 60 M80 60 H118" strokeWidth={0.8} />
      <circle cx={80} cy={60} r={3} fill={SAT_REF_INK} stroke="none" />
      <SvgLabel x={89} y={55}>r</SvgLabel>
    </SvgFrame>
  );
});

const ConeArt = memo(function ConeArt() {
  return (
    <SvgFrame label="Cone with radius r and height h">
      <path d="M46 91 L80 19 L114 91 A34 11 0 0 1 46 91 Z M80 19 V91" />
      <path d="M46 91 A34 11 0 0 1 114 91 M80 91 H114" strokeDasharray="3 2" strokeWidth={0.8} />
      <path d="M80 81 H89 V91" strokeWidth={0.8} />
      <SvgLabel x={84} y={65}>h</SvgLabel>
      <SvgLabel x={96} y={86}>r</SvgLabel>
    </SvgFrame>
  );
});

const PyramidArt = memo(function PyramidArt() {
  return (
    <SvgFrame label="Rectangular pyramid with length width and height">
      <path d="M42 83 H94 L118 64 L80 29 Z M80 29 L94 83" />
      <path d="M42 83 L66 64 H118 M66 64 L80 29 V74" strokeDasharray="3 2" strokeWidth={0.8} />
      <path d="M80 74 H88 V66" strokeWidth={0.8} />
      <SvgLabel x={72} y={62}>h</SvgLabel>
      <SvgLabel x={65} y={98}>ℓ</SvgLabel>
      <SvgLabel x={108} y={80}>w</SvgLabel>
    </SvgFrame>
  );
});

const ThirtySixtyNinetyArt = memo(function ThirtySixtyNinetyArt() {
  return (
    <SvgFrame label="30 60 90 triangle with sides x, x square root 3, and 2x">
      <path d="M38 88 H116 V43 Z" />
      <path d="M108 88 V80 H116" strokeWidth={0.8} />
      <SvgLabel x={60} y={84}>30°</SvgLabel>
      <SvgLabel x={94} y={67}>60°</SvgLabel>
      <SvgLabel x={69} y={106}>x√3</SvgLabel>
      <SvgLabel x={121} y={72}>x</SvgLabel>
      <SvgLabel x={61} y={62}>2x</SvgLabel>
    </SvgFrame>
  );
});

const FortyFiveArt = memo(function FortyFiveArt() {
  return (
    <SvgFrame label="45 45 90 triangle with sides s, s, and s square root 2">
      <path d="M38 96 V29 L105 96 Z" />
      <path d="M38 88 H46 V96" strokeWidth={0.8} />
      <SvgLabel x={40} y={60}>45°</SvgLabel>
      <SvgLabel x={73} y={92}>45°</SvgLabel>
      <SvgLabel x={28} y={67}>s</SvgLabel>
      <SvgLabel x={68} y={109}>s</SvgLabel>
      <SvgLabel x={74} y={62}>s√2</SvgLabel>
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
      <msup><mi>c</mi><mn>2</mn></msup>
      <mo>=</mo>
      <msup><mi>a</mi><mn>2</mn></msup>
      <mo>+</mo>
      <msup><mi>b</mi><mn>2</mn></msup>
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
/* Fixed canvas: four plane figures and two special triangles above five
   solids, followed by the three angle/circle facts from the reference. */
/* ------------------------------------------------------------------ */

function SatReferenceSheetInner({
  viewportWidth = 1000,
  zoom = 1,
  stageWidth,
  stageHeight,
  examScale = 1,
}: {
  viewportWidth?: number;
  zoom?: number;
  stageWidth?: number | undefined;
  stageHeight?: number | undefined;
  examScale?: number;
}) {
  const scale = useFitScale(viewportWidth, zoom, stageHeight, examScale);
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
          <MemoFigure
            x={0}
            y={24}
            label="Circle"
            art={<CircleArt />}
            formula={<CircleFormula />}
          />
          <MemoFigure
            x={160}
            y={24}
            label="Rectangle"
            art={<RectangleArt />}
            formula={<RectangleFormula />}
          />
          <MemoFigure
            x={320}
            y={24}
            label="Triangle"
            art={<TriangleArt />}
            formula={<TriangleFormula />}
          />
          <MemoFigure
            x={480}
            y={24}
            label="Right triangle"
            art={<RightTriangleArt />}
            formula={<RightTriangleFormula />}
          />
          <section
            aria-labelledby="sat-special-triangles"
            style={{ position: "absolute", left: 640, top: 24, width: 320 }}
          >
            <div style={{ display: "flex" }}>
              <ThirtySixtyNinetyArt />
              <FortyFiveArt />
            </div>
            <h2
              id="sat-special-triangles"
              style={{
                margin: "4px 0 0",
                textAlign: "center",
                fontSize: 16,
                fontWeight: 700,
                fontFamily: SAT_REF_MATH_FONT,
              }}
            >
              Special Right Triangles
            </h2>
          </section>

          <MemoFigure
            x={0}
            y={210}
            label="Rectangular prism"
            art={<PrismArt />}
            formula={<PrismFormula />}
          />
          <MemoFigure
            x={160}
            y={210}
            label="Cylinder"
            art={<CylinderArt />}
            formula={<CylinderFormula />}
          />
          <MemoFigure
            x={320}
            y={210}
            label="Sphere"
            art={<SphereArt />}
            formula={<SphereFormula />}
          />
          <MemoFigure
            x={480}
            y={210}
            label="Cone"
            art={<ConeArt />}
            formula={<ConeFormula />}
          />
          <MemoFigure
            x={640}
            y={210}
            label="Rectangular pyramid"
            art={<PyramidArt />}
            formula={<PyramidFormula />}
          />

          <section
            aria-label="Angle and circle facts"
            style={{
              position: "absolute",
              left: 42,
              top: 440,
              width: 916,
              fontFamily: SAT_REF_MATH_FONT,
              fontSize: 20,
              lineHeight: 1.4,
            }}
          >
            <p style={{ margin: "0 0 10px" }}>
              The number of degrees of arc in a circle is 360.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              The number of radians of arc in a circle is <math><mn>2</mn><mi>π</mi></math>.
            </p>
            <p style={{ margin: 0 }}>
              The sum of the measures in degrees of the angles of a triangle is 180.
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}

export const SatReferenceSheet = memo(SatReferenceSheetInner);
export default SatReferenceSheet;
