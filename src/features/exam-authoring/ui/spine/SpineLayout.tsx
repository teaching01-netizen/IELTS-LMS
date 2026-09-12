import type { CSSProperties, ReactNode } from "react";
import { RailResizer } from "./RailResizer";
import "./spine.css";

export interface SpineLayoutProps {
  header: ReactNode;
  queue: ReactNode;
  banner?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  inspector?: ReactNode | undefined;
  railWidth?: number | undefined;
  onRailWidthChange?: ((value: number) => void) | undefined;
}

/**
 * Single-column exam-paper spine shell (plan Phase 1).
 * Presentational only: the workspace stays the orchestrator and passes its
 * existing panes/callbacks through these slots until later phases replace
 * each slot with the dedicated spine component.
 */
export function SpineLayout({
  header,
  queue,
  banner,
  children,
  footer,
  inspector,
  railWidth,
  onRailWidthChange,
}: SpineLayoutProps) {
  return (
    <div
      className="sat-spine"
      style={{
        minHeight: "100dvh",
        ...(railWidth ? ({ "--spine-rail-width": `${railWidth}px` } as CSSProperties) : {}),
      }}
    >
      <a href="#sat-spine-main" className="sat-spine__skip-link">
        Skip to question
      </a>
      {header}
      {banner}
      <div className="sat-spine__body">
        <div className="sat-spine__queue" aria-label="Question queue">
          {queue}
        </div>
        {queue && railWidth && onRailWidthChange ? (
          <RailResizer width={railWidth} onWidthChange={onRailWidthChange} />
        ) : null}
        <main id="sat-spine-main" className="sat-spine__main" tabIndex={-1}>
          <div className="sat-spine__column">{children}</div>
        </main>
        {inspector}
      </div>
      {footer}
    </div>
  );
}
