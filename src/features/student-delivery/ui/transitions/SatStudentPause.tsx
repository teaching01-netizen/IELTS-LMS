import { SatErrorSurface } from "../feedback/SatStateSurfaces";

type PauseControlProps = {
  pending?: boolean;
  error?: string | undefined;
  onAction: () => void;
};

export function SatPauseAndLeaveAction({ pending, error, onAction }: PauseControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1">
      <button
        type="button"
        disabled={pending}
        onClick={onAction}
        className="sat-touch-target rounded-full border border-[var(--sat-divider)] px-4 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Pausing…" : "Pause and leave"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function SatStudentPausedScreen({ pending, error, onAction }: PauseControlProps) {
  return (
    <SatErrorSurface
      title="Exam paused"
      description="Your answers are saved and your personal timer is paused. You can close this page and return using your exam link."
      actionLabel={pending ? "Resuming…" : "Resume exam"}
      {...(error ? { detail: error } : {})}
      onAction={() => { if (!pending) onAction(); }}
    />
  );
}
