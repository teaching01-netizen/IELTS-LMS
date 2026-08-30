import type { ReactNode } from "react";

function Figure({ label, art, formula }: { label: string; art: ReactNode; formula: ReactNode }) {
  return (
    <figure className="min-w-0 px-3 py-4 text-center">
      <div className="mx-auto flex h-24 items-center justify-center">{art}</div>
      <figcaption className="mt-2 sat-type-reference text-[var(--sat-text)]">
        <span className="sr-only">{label}. </span>
        {formula}
      </figcaption>
    </figure>
  );
}

const line = "stroke-current fill-none";

export function SatReferenceSheet() {
  return (
    <article
      className="mx-auto max-w-[900px] bg-[var(--sat-surface)] px-5 py-6 text-[var(--sat-text)] sm:px-8"
      aria-label="SAT Math reference sheet"
    >
      <div className="grid grid-cols-2 border-b border-[var(--sat-divider-soft)] sm:grid-cols-3 lg:grid-cols-5">
        <Figure
          label="Circle"
          formula={
            <>
              <i>A</i> = π<i>r</i>²<br />
              <i>C</i> = 2π<i>r</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 100 80"
              className="h-20 w-24"
              role="img"
              aria-label="Circle with radius r"
            >
              <circle cx="50" cy="40" r="28" className={line} strokeWidth="1.5" />
              <circle cx="50" cy="40" r="2" fill="currentColor" />
              <line x1="50" y1="40" x2="78" y2="40" className={line} strokeWidth="1.5" />
              <text x="62" y="34" fontSize="14">
                r
              </text>
            </svg>
          }
        />
        <Figure
          label="Rectangle"
          formula={
            <>
              <i>A</i> = ℓ<i>w</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 110 80"
              className="h-20 w-28"
              role="img"
              aria-label="Rectangle with length l and width w"
            >
              <rect x="20" y="20" width="70" height="40" className={line} strokeWidth="1.5" />
              <text x="52" y="75" fontSize="14">
                ℓ
              </text>
              <text x="94" y="43" fontSize="14">
                w
              </text>
            </svg>
          }
        />
        <Figure
          label="Triangle"
          formula={
            <>
              <i>A</i> = ½<i>bh</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 110 80"
              className="h-20 w-28"
              role="img"
              aria-label="Triangle with base b and height h"
            >
              <path d="M15 65 L95 65 L65 12 Z" className={line} strokeWidth="1.5" />
              <line x1="65" y1="12" x2="65" y2="65" className={line} strokeDasharray="3 2" />
              <text x="53" y="77" fontSize="14">
                b
              </text>
              <text x="69" y="42" fontSize="14">
                h
              </text>
            </svg>
          }
        />
        <Figure
          label="Right triangle"
          formula={
            <>
              <i>a</i>² + <i>b</i>² = <i>c</i>²
            </>
          }
          art={
            <svg
              viewBox="0 0 110 80"
              className="h-20 w-28"
              role="img"
              aria-label="Right triangle with sides a b and c"
            >
              <path d="M20 65 L20 18 L92 65 Z" className={line} strokeWidth="1.5" />
              <path d="M20 55 L30 55 L30 65" className={line} strokeWidth="1" />
              <text x="8" y="43" fontSize="14">
                b
              </text>
              <text x="53" y="77" fontSize="14">
                a
              </text>
              <text x="59" y="37" fontSize="14">
                c
              </text>
            </svg>
          }
        />
        <Figure
          label="Rectangular prism"
          formula={
            <>
              <i>V</i> = ℓ<i>wh</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 110 80"
              className="h-20 w-28"
              role="img"
              aria-label="Rectangular prism with length width and height"
            >
              <rect x="20" y="30" width="58" height="35" className={line} strokeWidth="1.5" />
              <path
                d="M20 30 L35 15 L93 15 L78 30 M78 30 L93 15 L93 50 L78 65"
                className={line}
                strokeWidth="1.5"
              />
              <text x="47" y="76" fontSize="14">
                ℓ
              </text>
              <text x="84" y="62" fontSize="14">
                w
              </text>
              <text x="9" y="49" fontSize="14">
                h
              </text>
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-2 border-b border-[var(--sat-divider-soft)] sm:grid-cols-4">
        <Figure
          label="Cylinder"
          formula={
            <>
              <i>V</i> = π<i>r</i>²<i>h</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 100 80"
              className="h-20 w-24"
              role="img"
              aria-label="Cylinder with radius r and height h"
            >
              <ellipse cx="50" cy="20" rx="28" ry="9" className={line} strokeWidth="1.5" />
              <path d="M22 20 V60 M78 20 V60" className={line} strokeWidth="1.5" />
              <ellipse cx="50" cy="60" rx="28" ry="9" className={line} strokeWidth="1.5" />
              <line x1="50" y1="20" x2="78" y2="20" className={line} />
              <text x="63" y="15" fontSize="14">
                r
              </text>
              <text x="82" y="43" fontSize="14">
                h
              </text>
            </svg>
          }
        />
        <Figure
          label="Sphere"
          formula={
            <>
              <i>V</i> = ⁴⁄₃π<i>r</i>³
            </>
          }
          art={
            <svg
              viewBox="0 0 100 80"
              className="h-20 w-24"
              role="img"
              aria-label="Sphere with radius r"
            >
              <circle cx="50" cy="40" r="28" className={line} strokeWidth="1.5" />
              <ellipse cx="50" cy="40" rx="28" ry="9" className={line} strokeWidth="1" />
              <line x1="50" y1="40" x2="78" y2="40" className={line} />
              <text x="63" y="35" fontSize="14">
                r
              </text>
            </svg>
          }
        />
        <Figure
          label="Cone"
          formula={
            <>
              <i>V</i> = ⅓π<i>r</i>²<i>h</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 100 80"
              className="h-20 w-24"
              role="img"
              aria-label="Cone with radius r and height h"
            >
              <ellipse cx="50" cy="62" rx="28" ry="8" className={line} strokeWidth="1.5" />
              <path d="M22 62 L50 10 L78 62" className={line} strokeWidth="1.5" />
              <line x1="50" y1="10" x2="50" y2="62" className={line} strokeDasharray="3 2" />
              <text x="54" y="38" fontSize="14">
                h
              </text>
              <text x="63" y="58" fontSize="14">
                r
              </text>
            </svg>
          }
        />
        <Figure
          label="Rectangular pyramid"
          formula={
            <>
              <i>V</i> = ⅓ℓ<i>wh</i>
            </>
          }
          art={
            <svg
              viewBox="0 0 110 80"
              className="h-20 w-28"
              role="img"
              aria-label="Rectangular pyramid with length width and height"
            >
              <path
                d="M18 62 L75 62 L94 48 L37 48 Z M56 10 L18 62 M56 10 L75 62 M56 10 L94 48 M56 10 L37 48"
                className={line}
                strokeWidth="1.5"
              />
              <line x1="56" y1="10" x2="56" y2="55" className={line} strokeDasharray="3 2" />
              <text x="60" y="35" fontSize="14">
                h
              </text>
            </svg>
          }
        />
      </div>

      <div className="grid gap-8 border-b border-[var(--sat-divider-soft)] py-6 md:grid-cols-2">
        <section aria-labelledby="sat-special-triangles">
          <h2
            id="sat-special-triangles"
            className="text-center sat-type-control-primary font-semibold"
          >
            Special Right Triangles
          </h2>
          <div className="mt-4 flex items-end justify-center gap-10">
            <svg
              viewBox="0 0 120 90"
              className="h-24 w-32"
              role="img"
              aria-label="30 60 90 triangle with sides x, x square root 3, and 2x"
            >
              <path d="M15 75 L105 75 L75 12 Z" className={line} strokeWidth="1.5" />
              <text x="34" y="68" fontSize="14">
                30°
              </text>
              <text x="77" y="27" fontSize="14">
                60°
              </text>
              <text x="54" y="87" fontSize="14">
                x√3
              </text>
              <text x="91" y="48" fontSize="14">
                x
              </text>
              <text x="35" y="39" fontSize="14">
                2x
              </text>
            </svg>
            <svg
              viewBox="0 0 100 90"
              className="h-24 w-28"
              role="img"
              aria-label="45 45 90 triangle with sides x, x, and x square root 2"
            >
              <path d="M20 75 L20 15 L80 75 Z" className={line} strokeWidth="1.5" />
              <text x="24" y="28" fontSize="14">
                45°
              </text>
              <text x="57" y="70" fontSize="14">
                45°
              </text>
              <text x="5" y="48" fontSize="14">
                x
              </text>
              <text x="48" y="87" fontSize="14">
                x
              </text>
              <text x="53" y="43" fontSize="14">
                x√2
              </text>
            </svg>
          </div>
        </section>
        <section className="flex items-center" aria-label="Angle and circle facts">
          <div className="space-y-3 sat-type-reference text-[var(--sat-text)]">
            <p>The number of degrees of arc in a circle is 360.</p>
            <p>The number of radians of arc in a circle is 2π.</p>
            <p>The sum of the measures in degrees of the angles of a triangle is 180.</p>
          </div>
        </section>
      </div>
    </article>
  );
}
