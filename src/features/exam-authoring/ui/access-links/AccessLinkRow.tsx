import { memo } from "react";
import { Check, ChevronRight, Ellipsis } from "lucide-react";
import { accessLinkSectionBadge, type AssessmentAccessLink } from "../../contracts/accessLinks";
import { SatMenu, type SatMenuItem } from "../../../../products/sat/ui/Menu";
import { SatStatusPill, type SatStatusTone } from "../../../../products/sat/ui/SatPage";
import { SESSION_PHASE_LABEL, type SessionPhase } from "../delivery/sessionState";
import {
  accessLinkStatusDescription,
  describeAccessLinkAudience,
  formatAccessLinkStatus,
  formatCompactDateTime,
} from "./accessLinkUi";

export interface AccessLinkRowProps {
  link: AssessmentAccessLink;
  /** Exam phase of the room's session; null or "unknown" shows no pill rather than a guess. */
  phase: SessionPhase | null;
  /** The room this viewer opened last: tinted and tagged so it is found at a glance. */
  highlighted?: boolean;
  onOpen: () => void;
  menuItems: SatMenuItem[];
  /** Optional position for a capped entrance stagger (first 6 rows). */
  resultIndex?: number;
  /**
   * A write against THIS link is in flight. The row keeps its geometry, shows
   * the pending label in the meta line, and swaps the overflow glyph for the
   * shared spinner — the pressed control is where the acknowledgement belongs.
   */
  busy?: boolean;
  /** Short present-tense label for the in-flight write ("Pausing…"). */
  pendingLabel?: string | null;
  /** Transient inline confirmation ("Copied", "Paused"), shown in place of the counts. */
  confirmation?: string | null;
}

export function rowElementId(linkId: string): string {
  return `access-link-row-${linkId}`;
}

export const PHASE_TONE: Partial<Record<SessionPhase, SatStatusTone>> = {
  live: "live",
  paused: "paused",
  ready: "ready",
  finished: "finished",
  cancelled: "cancelled",
};

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When the room runs (scheduled window) or, for anytime rooms, when it was created. */
function whenShort(link: AssessmentAccessLink): string {
  const opens = validDate(link.opensAt);
  const closes = validDate(link.closesAt);
  if (link.availabilityType === "scheduled" && opens && closes) return `${formatCompactDateTime(opens)} – ${formatCompactDateTime(closes)}`;
  const created = validDate(link.createdAt);
  return created ? `Created ${formatCompactDateTime(created)}` : "Open now";
}

/**
 * One room in the exam's room finder. The whole row opens the room; the ⋯ menu
 * holds share, edit and lifecycle actions. Three short lines: what it is
 * (name, version, sections), where it stands (exam phase, audience, when), and
 * how many students it has.
 *
 * Interaction contract:
 * - `.sat-list-row` + `.sat-press-row`: the shared hover fill and press scale.
 * - Busy never moves anything: the spinner occupies the trigger's own 40px box
 *   and the pending label replaces the meta text inside the same line.
 * - The confirmation line replaces the counts for ~1.6s in place.
 */
export const AccessLinkRow = memo(function AccessLinkRow({
  link,
  phase,
  highlighted = false,
  onOpen,
  menuItems,
  resultIndex,
  busy = false,
  pendingLabel = null,
  confirmation = null,
}: AccessLinkRowProps) {
  // Nobody should share a verbal-only link with a math class by accident, so a
  // scoped link is labelled in the list itself.
  const sectionBadge = accessLinkSectionBadge(link.enabledSections, link.publishScope);
  const phaseTone = phase ? PHASE_TONE[phase] : undefined;
  // Check-in is only worth a word when it is not the normal "open".
  const entryNote = link.status === "live" ? null : formatAccessLinkStatus(link.status);
  const metaText = pendingLabel ?? [describeAccessLinkAudience(link), whenShort(link), entryNote].filter(Boolean).join(" · ");
  const staggered = resultIndex !== undefined && resultIndex < 6;
  return (
    <div className="relative mb-2">
      <button
        type="button"
        id={rowElementId(link.id)}
        onClick={onOpen}
        aria-busy={busy || undefined}
        aria-label={`Open ${link.name}${highlighted ? " (last opened)" : ""}`}
        style={staggered ? ({ "--sat-row-index": resultIndex } as React.CSSProperties) : undefined}
        className={
          "sat-list-row sat-press-row flex min-h-[80px] w-full items-center rounded-2xl border px-4 py-3 pr-24 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 " +
          (staggered ? "sat-row-enter " : "") +
          (highlighted ? "border-au-accent/30 bg-au-accent-tint" : "border-black/[0.06] bg-white")
        }
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-slate-900">{link.name}</span>
            <span className="shrink-0 text-[14px] tabular-nums text-slate-400">Version {link.versionNumber}</span>
            {sectionBadge ? (
              <span className="shrink-0 rounded-full bg-au-fill px-2 py-0.5 text-[13px] font-semibold text-slate-600">{sectionBadge}</span>
            ) : null}
            {highlighted ? (
              <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[13px] font-semibold text-au-accent">Last opened</span>
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-2">
            {phase && phaseTone ? (
              <SatStatusPill tone={phaseTone} pulse={phase === "live" && !busy}>{SESSION_PHASE_LABEL[phase]}</SatStatusPill>
            ) : null}
            <span className={"truncate text-[14px] " + (busy ? "font-medium text-slate-600" : "text-slate-500")}>{metaText}</span>
          </span>
          {confirmation ? (
            <span className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold text-slate-600">
              <Check size={12} className="text-emerald-600" aria-hidden="true" />
              {confirmation}
            </span>
          ) : (
            <span className="mt-1 block truncate text-[14px] tabular-nums text-slate-500" title={accessLinkStatusDescription(link)}>
              {link.metrics.registered} registered · {link.metrics.submitted} submitted
            </span>
          )}
        </span>
        <ChevronRight size={16} aria-hidden="true" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" />
      </button>
      <span className="absolute right-10 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center">
        {busy ? (
          <span
            aria-hidden="true"
            data-testid={`access-link-pending-${link.id}`}
            className="sat-spinner block h-4 w-4 rounded-full border-2 border-black/15 border-t-slate-600"
          />
        ) : (
          <SatMenu label={`Actions for ${link.name}`} compact triggerContent={<Ellipsis size={16} aria-hidden="true" />} items={menuItems} />
        )}
      </span>
    </div>
  );
}, (prev, next) =>
  prev.link.id === next.link.id &&
  prev.link.revision === next.link.revision &&
  prev.link.status === next.link.status &&
  prev.link.updatedAt === next.link.updatedAt &&
  prev.link.metrics === next.link.metrics &&
  prev.phase === next.phase &&
  prev.highlighted === next.highlighted &&
  prev.resultIndex === next.resultIndex &&
  prev.busy === next.busy &&
  prev.pendingLabel === next.pendingLabel &&
  prev.confirmation === next.confirmation &&
  prev.menuItems === next.menuItems &&
  prev.onOpen === next.onOpen,
);
