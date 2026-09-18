/**
 * The surface for every authoring shell lifecycle state that is not READY.
 *
 * One owner for "what does this lifecycle state look like", so the workspace
 * itself only has to say "there is no shell yet — show the lifecycle surface".
 * The six states are deliberately distinct:
 *
 *   loading         the read is in flight (never an error, never a draft)
 *   no-draft        the exam exists, nobody opened a draft: an editor can open
 *                   one explicitly — this read never does
 *   exam-not-found  the exam does not exist, so there is nothing to open
 *   forbidden       the caller may not read this exam
 *   error           the read failed for a reason that is not a lifecycle answer
 *   ready           unreachable here (see below)
 */
import {
  SatAuthoringErrorSurface,
  SatAuthoringLoadingSurface,
} from "./SatAuthoringStateSurfaces";
import {
  toDraftOpenErrorInfo,
  type AuthoringShellState,
} from "../application/authoringShellLifecycle";

export interface AuthoringLifecycleSurfaceProps {
  state: AuthoringShellState;
  /** True for roles that may open a draft. UX gating only: the server decides. */
  canOpenDraft: boolean;
  /** The explicit draft-open command. Never invoked without a user gesture. */
  draftOpen: {
    isPending: boolean;
    error: unknown;
    open: () => void;
  };
  onRetry: () => void;
}

export function AuthoringLifecycleSurface({
  state,
  canOpenDraft,
  draftOpen,
  onRetry,
}: AuthoringLifecycleSurfaceProps) {
  switch (state.kind) {
    case "loading":
      return <SatAuthoringLoadingSurface label="Opening SAT workspace…" />;

    case "no-draft": {
      const info = draftOpen.error ? toDraftOpenErrorInfo(draftOpen.error) : null;
      const description =
        info?.kind === "exam-missing"
          ? "This exam does not exist, so there is no draft to open."
          : info?.kind === "forbidden"
            ? "You do not have permission to open an editable draft for this exam."
            : info?.kind === "conflict"
              ? "The draft changed while opening. Retry the open, or refresh to load the latest state."
              : info
                ? info.message
                : "This exam has no editable draft yet. Opening a draft creates one explicitly — refreshing never creates one.";
      return (
        <SatAuthoringErrorSurface
          title="No editable draft"
          description={description}
          actionLabel={
            canOpenDraft ? (draftOpen.isPending ? "Opening draft…" : "Open draft") : undefined
          }
          onAction={
            canOpenDraft
              ? () => {
                  if (draftOpen.isPending) return;
                  draftOpen.open();
                }
              : undefined
          }
          actionDisabled={draftOpen.isPending}
        />
      );
    }

    case "exam-not-found":
      // No "Open draft" CTA: opening a draft for an exam that does not exist is
      // not a recoverable action, and offering it would invite the user to
      // retry a command that cannot succeed.
      return (
        <SatAuthoringErrorSurface
          title="Exam not found"
          description="This exam does not exist or has been deleted."
        />
      );

    case "forbidden":
      return (
        <SatAuthoringErrorSurface
          title="You cannot author this exam"
          description="Your account does not have permission to open this exam's authoring workspace."
        />
      );

    case "error":
      return (
        <SatAuthoringErrorSurface
          title="Unable to load the SAT authoring workspace"
          description={state.error.message}
          actionLabel="Retry"
          onAction={onRetry}
        />
      );

    case "ready":
      // The caller mounts this surface only when it has no shell, and a ready
      // state always carries one. Rendering nothing (rather than an error) keeps
      // a stray ready state from being reported to the user as a failure.
      return null;
  }
}
