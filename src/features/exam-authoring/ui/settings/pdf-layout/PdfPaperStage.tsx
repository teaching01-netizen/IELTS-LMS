import { useId, type ReactNode } from "react";
import { SatButton } from "../../../../../products/sat/ui/SatPage";

/**
 * The paper. A4 landscape at 96dpi is 1123px wide, so "100%" is the real
 * printed size and the staff member can check a slide the way it will be
 * read. The page is the only white object on the canvas; every rail around it
 * stays quiet.
 */

export type PdfZoom = "fit" | "1" | "1.5";

const A4_LANDSCAPE_PX = 1123;

const ZOOM_OPTIONS: ReadonlyArray<{ value: PdfZoom; label: string }> = [
  { value: "fit", label: "Fit width" },
  { value: "1", label: "100%" },
  { value: "1.5", label: "150%" },
];

export function PdfPaperStage({
  heading,
  subheading,
  caption,
  pageSrc,
  pageAlt,
  slideSrc,
  slideAlt,
  zoom,
  onZoomChange,
  busy,
  error,
  onRetry,
  before,
  after,
}: {
  heading: string;
  subheading?: string | null | undefined;
  caption?: string | null | undefined;
  pageSrc?: string | null | undefined;
  pageAlt?: string | undefined;
  slideSrc?: string | null | undefined;
  slideAlt?: string | undefined;
  zoom: PdfZoom;
  onZoomChange: (zoom: PdfZoom) => void;
  busy?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const width = zoom === "fit" ? "100%" : `${Math.round(A4_LANDSCAPE_PX * Number(zoom))}px`;
  const zoomId = useId();
  return (
    <section className="min-w-0" aria-label="Report preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{heading}</h3>
          {subheading ? <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{subheading}</p> : null}
        </div>
        <label htmlFor={zoomId} className="sat-select relative flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] pl-3">
          <span className="text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">Zoom</span>
          <select
            id={zoomId}
            value={zoom}
            onChange={(event) => onZoomChange(event.currentTarget.value as PdfZoom)}
            className="min-h-11 cursor-pointer appearance-none rounded-[var(--sat-staff-radius-control,8px)] bg-transparent py-0 pl-2 pr-6 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none"
          >
            {ZOOM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-danger-border,#d92d2033)] bg-[var(--sat-staff-danger-tint,#d92d2014)] px-3 py-2">
          <p className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{error}</p>
          {onRetry ? <SatButton variant="quiet" onClick={onRetry}>Retry</SatButton> : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-col items-center gap-3">
        {before}
        <div className="w-full overflow-auto pb-1">
          <div style={{ width }} className="mx-auto">
            <div
              className="relative w-full overflow-hidden rounded-[2px] bg-white shadow-[var(--sat-staff-shadow-paper)]"
              style={{ aspectRatio: "297 / 210" }}
            >
              {slideSrc ? (
                <img src={slideSrc} alt={slideAlt ?? ""} className="h-full w-full bg-white object-contain" />
              ) : pageSrc ? (
                <img src={pageSrc} alt={pageAlt ?? ""} className="h-full w-full bg-white object-contain" />
              ) : busy ? (
                <div className="h-full w-full animate-pulse bg-[var(--sat-staff-skeleton-bar-soft,#0000000d)]" aria-hidden="true" />
              ) : (
                <p className="flex h-full items-center justify-center px-6 text-center text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                  No sample page is available for this section.
                </p>
              )}
            </div>
          </div>
        </div>
        {after}
        {caption ? (
          <p className="text-center text-[13px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{caption}</p>
        ) : null}
      </div>
    </section>
  );
}
