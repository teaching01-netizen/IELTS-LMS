import { memo } from "react";
import { Check, Ellipsis } from "lucide-react";
import { accessLinkSectionBadge, type AssessmentAccessLink } from "../../contracts/accessLinks";
import { SatMenu, type SatMenuItem } from "../../../../products/sat/ui/Menu";
import { SatStatusPill } from "../../../../products/sat/ui/SatPage";
import {
  accessLinkStatusDescription,
  accessLinkStatusTone,
  formatAccessLinkStatus,
  formatCompactDateTime,
  shouldPulseAccessLinkStatus,
} from "./accessLinkUi";

export interface AccessLinkRowProps {
  link: AssessmentAccessLink;
  selected: boolean;
  isStaleRelease: boolean;
  onSelect: () => void;
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
  /**
   * Transient inline confirmation ("Copied", "Paused"). Rendered in the funnel
   * line so it can never change the row's height or push its neighbours.
   */
  confirmation?: string | null;
}

export function rowElementId(linkId: string): string {
  return `access-link-row-${linkId}`;
}

function audienceShort(link: AssessmentAccessLink): string {
  if (link.audienceType === "anyone") return "Anyone with link";
  if (link.audienceType === "cohort") return link.audienceLabel ?? "Cohort";
  return `${link.audienceLabel ?? "Selected students"} · ${link.selectedStudentCount} students`;
}

function availabilityShort(link: AssessmentAccessLink): string {
  if (link.availabilityType === "anytime") return "Anytime";
  const opens = link.opensAt ? new Date(link.opensAt) : null;
  const closes = link.closesAt ? new Date(link.closesAt) : null;
  const valid = (date: Date | null): date is Date => date instanceof Date && !Number.isNaN(date.getTime());
  if (valid(opens) && valid(closes)) return `${formatCompactDateTime(opens)} – ${formatCompactDateTime(closes)}`;
  return "Scheduled";
}

/**
 * A single Student Link row: two lines max (title + meta), status pill,
 * funnel counts, and an overflow menu. Row button carries right padding so
 * the absolutely-positioned menu never overlaps truncated text.
 *
 * Interaction contract:
 * - `.sat-list-row` + `.sat-press-row`: the shared hover fill and press scale,
 *   including the reduced-motion reset. There is no per-row press literal.
 * - Busy never moves anything: the spinner occupies the trigger's own 40px box
 *   and the pending label replaces the meta text inside the same line.
 * - The confirmation line replaces the funnel counts for ~1.6s in place.
 */
export const AccessLinkRow = memo(function AccessLinkRow({
  link,
  selected,
  isStaleRelease,
  onSelect,
  menuItems,
  resultIndex,
  busy = false,
  pendingLabel = null,
  confirmation = null,
}: AccessLinkRowProps) {
  const tone = accessLinkStatusTone(link.status);
  // Nobody should share a verbal-only link with a math class by accident, so a
  // scoped link is labelled in the list itself.
  const sectionBadge = accessLinkSectionBadge(link.enabledSections, link.publishScope);
  const metaText = pendingLabel ?? `${audienceShort(link)} · ${availabilityShort(link)}`;
  return (
    <div className="relative mb-1.5">
      <button
        type="button"
        id={rowElementId(link.id)}
        onClick={onSelect}
        aria-current={selected || undefined}
        aria-busy={busy || undefined}
        aria-label={`Open ${link.name}`}
        style={resultIndex !== undefined && resultIndex < 6 ? ({ "--sat-row-index": resultIndex } as React.CSSProperties) : undefined}
        className={
          "sat-list-row sat-press-row flex min-h-[76px] w-full items-center rounded-2xl border px-4 py-3.5 pr-14 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 " +
          (resultIndex !== undefined && resultIndex < 6 ? "sat-row-enter " : "") +
          (selected
            ? "border-au-accent/30 bg-au-accent-tint"
            : "border-black/[0.06] bg-white")
        }
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-slate-900">{link.name}</span>
            {isStaleRelease ? (
              <span className="shrink-0 text-[10px] font-medium text-slate-400">Version {link.versionNumber}</span>
            ) : null}
            {sectionBadge ? (
              <span className="shrink-0 rounded-full bg-au-fill px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {sectionBadge}
              </span>
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <SatStatusPill tone={tone} pulse={shouldPulseAccessLinkStatus(link.status) && !busy}>
              {formatAccessLinkStatus(link.status)}
            </SatStatusPill>
            <span className={"truncate text-[11px] " + (busy ? "font-medium text-slate-600" : "text-slate-500")}>
              {metaText}
            </span>
          </span>
          {confirmation ? (
            <span className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <Check size={12} className="text-emerald-600" aria-hidden="true" />
              {confirmation}
            </span>
          ) : (
            <span className="mt-1 block truncate text-[11px] tabular-nums text-slate-500" title={accessLinkStatusDescription(link)}>
              {link.metrics.registered} joined · {link.metrics.started} started · {link.metrics.submitted} submitted
            </span>
          )}
        </span>
      </button>
      <span className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center">
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
  prev.selected === next.selected &&
  prev.isStaleRelease === next.isStaleRelease &&
  prev.resultIndex === next.resultIndex &&
  prev.busy === next.busy &&
  prev.pendingLabel === next.pendingLabel &&
  prev.confirmation === next.confirmation &&
  prev.menuItems === next.menuItems &&
  prev.onSelect === next.onSelect,
);
