import { memo } from "react";
import { Ellipsis } from "lucide-react";
import type { AssessmentAccessLink } from "../../contracts/accessLinks";
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
 */
export const AccessLinkRow = memo(function AccessLinkRow({
  link,
  selected,
  isStaleRelease,
  onSelect,
  menuItems,
  resultIndex,
}: AccessLinkRowProps) {
  const tone = accessLinkStatusTone(link.status);
  return (
    <div className="relative mb-1.5">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        aria-label={`Open ${link.name}`}
        style={resultIndex !== undefined && resultIndex < 6 ? ({ "--sat-row-index": resultIndex } as React.CSSProperties) : undefined}
        className={
          "flex min-h-[76px] w-full items-center rounded-2xl border px-4 py-3.5 pr-14 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 " +
          (resultIndex !== undefined && resultIndex < 6 ? "sat-row-enter " : "") +
          (selected
            ? "border-au-accent/30 bg-au-accent-tint"
            : "border-black/[0.06] bg-white hover:bg-black/[0.02]")
        }
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-slate-900">{link.name}</span>
            {isStaleRelease ? (
              <span className="shrink-0 text-[10px] font-medium text-slate-400">Version {link.versionNumber}</span>
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <SatStatusPill tone={tone} pulse={shouldPulseAccessLinkStatus(link.status)}>
              {formatAccessLinkStatus(link.status)}
            </SatStatusPill>
            <span className="truncate text-[11px] text-slate-500">
              {audienceShort(link)} · {availabilityShort(link)}
            </span>
          </span>
          <span className="mt-1 block truncate text-[11px] tabular-nums text-slate-500" title={accessLinkStatusDescription(link)}>
            {link.metrics.registered} joined · {link.metrics.started} started · {link.metrics.submitted} submitted
          </span>
        </span>
      </button>
      <span className="absolute right-2 top-1/2 -translate-y-1/2">
        <SatMenu label={`Actions for ${link.name}`} compact triggerContent={<Ellipsis size={16} aria-hidden="true" />} items={menuItems} />
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
  prev.menuItems === next.menuItems &&
  prev.onSelect === next.onSelect,
);
