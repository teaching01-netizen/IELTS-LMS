import { ArrowRight, BarChart3, Check, Copy, ExternalLink, Presentation, QrCode, RefreshCw, RotateCcw, Radio } from "lucide-react";
import type { AccessLinkStatus, AssessmentAccessLink } from "../../contracts/accessLinks";
import { SatStatusPill, type SatStatusTone } from "../../../../products/sat/ui/SatPage";
import {
  ENTRY_STATE,
  SESSION_PHASE_LABEL,
  sessionActionPlan,
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

const ENTRY_TONE: Record<AccessLinkStatus, SatStatusTone> = {
  live: "live",
  upcoming: "info",
  paused: "paused",
  ended: "finished",
  revoked: "cancelled",
};

const PRIMARY = "sat-btn sat-btn--primary sat-press";
const SECONDARY = "sat-btn sat-btn--secondary sat-press";

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
    <section aria-label="Room" className="mt-4 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-white p-5">
      <h3 className="mb-3 text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">Share and run</h3>
      {justCreated ? (
        <div role="status" className="sat-banner-enter mb-4 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent-tint)] p-3">
          <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">Room created</p>
          <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Next: share the student link. Students wait in check-in until the proctor starts the exam. Copying is optional.
          </p>
          {onDismissNextSteps ? (
            <button type="button" onClick={onDismissNextSteps} className="sat-btn sat-btn--quiet sat-press -ml-3 mt-1 px-3">
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Check-in (can students enter?) and the exam run state are separate
          facts with separate controls; they are never merged into one pill. */}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[14px] leading-5">
        <dt className="text-[var(--sat-staff-text-secondary,#515154)]">Check-in</dt>
        <dd><SatStatusPill tone={ENTRY_TONE[link.status]}>{ENTRY_STATE[link.status]}</SatStatusPill></dd>
        <dt className="text-[var(--sat-staff-text-secondary,#515154)]">Exam</dt>
        <dd><SatStatusPill tone={PHASE_TONE[phase]} pulse={phase === "live"}>{SESSION_PHASE_LABEL[phase]}</SatStatusPill></dd>
      </dl>
      <p className="mt-3 text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
        {joined} registered{info?.ready != null ? ` · ${info.ready} ready` : ""} · {link.metrics.started} started · {link.metrics.submitted} submitted
      </p>

      <div className="mt-4 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint)] px-3 py-2.5">
        <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">Student link</p>
        <p className="mt-0.5 break-all font-mono text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{url}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onCopy} className={SECONDARY}>
          {copyConfirmed ? <Check size={16} aria-hidden="true" className="text-[var(--sat-staff-success-dot,#059669)]" /> : <Copy size={16} aria-hidden="true" />}
          <span aria-live="polite">{copyConfirmed ? "Copied" : "Copy student link"}</span>
        </button>
        <button type="button" onClick={onShowQr} className={SECONDARY}>
          <QrCode size={16} aria-hidden="true" />
          Show QR
        </button>
        <button type="button" onClick={onPresent} className={SECONDARY}><Presentation size={16} aria-hidden="true" />Present</button>
        <a href={url} target="_blank" rel="noreferrer" className="sat-btn sat-btn--quiet sat-press px-3"><ExternalLink size={16} aria-hidden="true" />Open student page</a>
      </div>

      {actions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--sat-staff-border-hairline)] pt-4">
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
                {busy ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Icon size={16} aria-hidden="true" />}
                {busy ? "Refreshing…" : action.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {!session.canRun ? (
        <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Running rooms is available to administrators.</p>
      ) : session.stale ? (
        <p role="status" className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
          Room status could not be refreshed. Displayed details may be out of date.
        </p>
      ) : null}
    </section>
  );
}
