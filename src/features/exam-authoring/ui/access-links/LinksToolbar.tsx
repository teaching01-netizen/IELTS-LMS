import type { AccessLinkStatus } from "../../contracts/accessLinks";
import { SatSearchField } from "../../../../products/sat/ui/SatPage";
import { formatAccessLinkStatus } from "./accessLinkUi";

export type StatusFilter = "all" | AccessLinkStatus;

export interface LinksToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  counts: Record<AccessLinkStatus, number>;
  total: number;
  resultCount: number;
  searchId?: string;
}

const FILTERS: StatusFilter[] = ["all", "live", "upcoming", "ended", "paused", "revoked"];

/**
 * Search + status pills + live result count. Pure presentational; the
 * dashboard owns filtering. Pills keep a 44px hitbox with a compact visual.
 */
export function LinksToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  counts,
  total,
  resultCount,
  searchId = "student-links-search",
}: LinksToolbarProps) {
  return (
    <div className="border-b border-black/[0.06] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SatSearchField
          id={searchId}
          label="Search Student Links"
          value={search}
          onChange={onSearchChange}
          placeholder="Search by name, audience, or version"
          widthClassName="sm:max-w-xs"
        />
        <p role="status" aria-live="polite" className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
          {resultCount} of {total} links
        </p>
      </div>
      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by status">
        {FILTERS.map((status) => {
          const active = statusFilter === status;
          const label = status === "all" ? `All ${total}` : `${formatAccessLinkStatus(status)} ${counts[status]}`;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => onStatusFilterChange(status)}
              className={
                "flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[11px] font-semibold capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 " +
                (active ? "bg-au-accent text-white" : "border border-black/[0.08] bg-white text-slate-500 hover:text-slate-900")
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
