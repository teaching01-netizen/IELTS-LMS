import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export function SatPreStartScreen({
  reason,
  runtimeStatus,
  proctorStatus,
  stageReady,
}: {
  reason: "initial" | "waiting" | "restoring" | "loading";
  runtimeStatus: string;
  proctorStatus: string;
  stageReady: boolean;
}) {
  const isPaused = proctorStatus === "paused" || runtimeStatus === "paused";
  const title =
    reason === "loading"
      ? "Preparing your SAT session"
      : isPaused
      ? "Your exam is paused"
      : runtimeStatus !== "live"
        ? "Waiting for the proctor to start your exam"
        : !stageReady
          ? "Your section will open automatically"
          : reason === "restoring"
            ? "Preparing your exam"
            : reason === "waiting"
              ? "Waiting for your next module"
              : "Your exam is ready";
  const description =
    reason === "loading"
      ? "Your session is loading. You do not need to do anything."
      : isPaused
      ? "Your answers are saved. Your exam will continue when the proctor resumes it."
      : runtimeStatus !== "live"
        ? "Stay on this screen. Your first module opens automatically when the proctor starts the session."
        : !stageReady
          ? "Stay on this screen. Your module opens automatically when its scheduled time begins."
          : reason === "restoring"
            ? "Your SAT session is being restored. The module will open automatically."
            : reason === "waiting"
              ? "Your next module opens automatically as soon as it is available."
              : "The exam opens automatically. You do not need to do anything.";

  return (
    <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg py-10">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p
          className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {description}
        </p>
      </main>
    </SatPresenceSurface>
  );
}
