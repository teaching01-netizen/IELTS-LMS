import type { ReactNode } from "react";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export function SatPreStartScreen({
  reason,
  runtimeStatus,
  proctorStatus,
  stageReady,
  startingModuleTwo = false,
  footer = null,
  moduleTitle,
  startingEntry = false,
  entryWindowExpired = false,
  onCheckEntryStatus,
  onStartModule,
}: {
  reason: "waiting" | "loading" | "module-entry";
  runtimeStatus: string;
  proctorStatus: string;
  stageReady: boolean;
  startingModuleTwo?: boolean;
  moduleTitle?: string;
  startingEntry?: boolean;
  entryWindowExpired?: boolean;
  onCheckEntryStatus?: () => void;
  onStartModule?: () => void;
  /** Secondary, non-exam action (e.g. allowing a pre-start device change). */
  footer?: ReactNode;
}) {
  const isPaused = proctorStatus === "paused" || runtimeStatus === "paused";
  const title = entryWindowExpired
    ? "Module entry window expired"
    : reason === "loading"
      ? "Loading your SAT session"
      : reason === "module-entry"
        ? `${moduleTitle ?? "Your next module"} is ready`
        : isPaused
          ? "Your exam is paused"
          : startingModuleTwo
            ? "Module 2 is ready — starting"
            : runtimeStatus !== "live"
              ? "Waiting for your proctor…"
              : !stageReady
                ? "Your section will open automatically"
                : "Your exam is ready";
  const description = entryWindowExpired
    ? "This module did not start before the 2-minute entry window closed. Your module timer has not started. Check the exam state or ask your proctor to review the entry exception."
    : reason === "loading"
      ? "Your session is loading. You do not need to do anything."
      : reason === "module-entry"
        ? "Your previous module’s answers are confirmed. This 2-minute entry window starts when the module becomes available. Begin before it closes; your module timer starts when you begin."
        : isPaused
          ? "Your answers are saved. Your exam will continue when the proctor resumes it."
          : startingModuleTwo
            ? "Stay on this screen. Module 2 opens automatically."
            : runtimeStatus !== "live"
              ? "Stay on this screen. Your first module opens automatically when the proctor starts the session."
              : !stageReady
                ? "Stay on this screen. Your module opens automatically when its scheduled time begins."
                : "The exam opens automatically. You do not need to do anything.";

  return (
    <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">
          Digital SAT
        </p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-3 text-2xl font-semibold tracking-tight"
        >
          {title}
        </h1>
        <p
          className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {description}
        </p>
        {entryWindowExpired ? (
          <button
            type="button"
            className="sat-touch-target sat-pressable mt-6 rounded-full border border-[var(--sat-divider)] px-6 font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
            onClick={onCheckEntryStatus}
            disabled={!onCheckEntryStatus}
          >
            Check status
          </button>
        ) : reason === "module-entry" ? (
          <button
            type="button"
            className="sat-touch-target sat-pressable mt-6 rounded-full bg-[var(--sat-text)] px-6 font-semibold text-[var(--sat-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            onClick={onStartModule}
            disabled={startingEntry || !onStartModule}
          >
            {startingEntry ? "Starting module…" : "Begin module"}
          </button>
        ) : null}
        {footer}
      </main>
    </SatPresenceSurface>
  );
}
