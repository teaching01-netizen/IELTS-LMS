import { ArrowRight, BarChart3, Copy, ExternalLink, LoaderCircle, Presentation, QrCode, RefreshCw, RotateCcw, Radio } from "lucide-react";
import type { AssessmentAccessLink } from "../../contracts/accessLinks";
import { SatStatusPill, type SatStatusTone } from "../../../../products/sat/ui/SatPage";
import {
  sessionActionPlan,
  sessionStatusLine,
  type AccessSessionBindings,
  type SessionActionKind,
  type SessionPhase,
} from "./sessionState";

const PHASE_TONE: Record<SessionPhase, SatStatusTone> = {
  ready: "info",
  live: "live",
  paused: "paused",
  finished: "finished",
  cancelled: "cancelled",
  unknown: "neutral",
};

const ACTION_BUTTON =
  "sat-press flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${ACTION_BUTTON} bg-au-accent text-white hover:bg-au-accent-hover`;
const SECONDARY = `${ACTION_BUTTON} border border-black/[0.08] bg-white text-slate-700 hover:bg-black/[0.03]`;

const ICON: Record<SessionActionKind, typeof Radio> = {
  "open-live": Radio,
  "view-results": BarChart3,
  refresh: RefreshCw,
  "open-room": ArrowRight,
  duplicate: RotateCcw,
};

export interface AccessLinkSessionPanelProps {
  link: AssessmentAccessLink;
  session: AccessSessionBindings;
  /** Right after creation: the next steps are Share → Run. */
  justCreated?: boolean;
  copyConfirmed: boolean;
  onCopy: () => void;
  onShowQr: () => void;
  onPresent: () => void;
  url: string;
  onDuplicate: () => void;
  onDismissNextSteps?: () => void;
}

/**
 * Share the selected session and lead into its room. Check-in and exam state
 * are stated separately and the main action follows the session phase; starting
 * and resuming happen in the session room, where readiness is in view.
 */
export function AccessLinkSessionPanel({
  link,
  session,
  justCreated = false,
  copyConfirmed,
  onCopy,
  onShowQr,
  onPresent,
  url,
  onDuplicate,
  onDismissNextSteps,
}: AccessLinkSessionPanelProps) {
  const info = session.infoFor(link.scheduleId);
  const phase: SessionPhase = info?.phase ?? "unknown";
  const plan = sessionActionPlan(phase, { canRun: session.canRun, stale: session.stale });
  const run = (kind: SessionActionKind) => {
    switch (kind) {
      case "refresh":
        session.onRefresh();
        return;
      case "open-live":
      case "open-room":
        session.onOpenRoom(link.scheduleId);
        return;
      case "view-results":
        session.onOpenResults(link.scheduleId);
        return;
      case "duplicate":
        onDuplicate();
        return;
    }
  };

  const joined = link.metrics.registered;
  const actions = [...(plan.primary ? [{ ...plan.primary, primary: true }] : []), ...plan.supporting.map((a) => ({ ...a, primary: false }))];

  return (
    <section aria-label="Room" className="mt-4 rounded-2xl border border-black/[0.06] bg-white p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-slate-950">Share and run</h3>
      {justCreated ? (
        <div role="status" className="sat-banner-enter mb-4 rounded-xl bg-au-accent/10 p-3">
          <p className="text-[13px] font-semibold text-slate-950">Room created</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-600">
            Next: share the student link. Students wait in check-in until the proctor starts the exam. Copying is optional.
          </p>
          {onDismissNextSteps ? (
            <button type="button" onClick={onDismissNextSteps} className="mt-1 min-h-11 text-[12px] font-semibold text-slate-600 underline">
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] font-semibold text-slate-900">Status</p>
        <SatStatusPill tone={PHASE_TONE[phase]} pulse={phase === "live"}>
          {sessionStatusLine(link.status, phase)}
        </SatStatusPill>
      </div>
      <p className="mt-2 text-[12px] tabular-nums text-slate-600">
        {joined} registered{info?.ready != null ? ` · ${info.ready} ready` : ""} · {link.metrics.started} started · {link.metrics.submitted} submitted
      </p>
      <p className="mt-3 break-all font-mono text-[12px] leading-5 text-slate-600">{url}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onCopy} className={SECONDARY}>
          <Copy size={14} aria-hidden="true" />
          {copyConfirmed ? "Copied" : "Copy student link"}
        </button>
        <button type="button" onClick={onShowQr} className={SECONDARY}>
          <QrCode size={14} aria-hidden="true" />
          Show QR
        </button>
        <button type="button" onClick={onPresent} className={SECONDARY}><Presentation size={14} aria-hidden="true" />Present</button>
        {actions.map((action) => {
          const Icon = ICON[action.kind];
          const busy = action.kind === "refresh" && session.refreshing;
          return (
            <button
              key={action.kind}
              type="button"
              onClick={() => run(action.kind)}
              disabled={busy}
              aria-busy={busy || undefined}
              className={action.primary ? PRIMARY : SECONDARY}
            >
              {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
              {busy ? "Refreshing…" : action.label}
            </button>
          );
        })}
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"><ExternalLink size={14} aria-hidden="true" />Open student page</a>

      {!session.canRun ? (
        <p className="mt-3 text-[12px] leading-5 text-slate-500">Running rooms is available to administrators.</p>
      ) : session.stale ? (
        <p role="status" className="mt-3 text-[12px] leading-5 text-amber-800">
          Session status could not be refreshed. Displayed details may be out of date.
        </p>
      ) : null}
    </section>
  );
}
