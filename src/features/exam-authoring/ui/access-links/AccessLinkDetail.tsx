import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Presentation,
  RefreshCw,
  Share2,
} from "lucide-react";
import {
  accessLinkSectionBadge,
  effectiveAccessLinkSections,
  ACCESS_LINK_SECTION_LABELS,
  type AccessLinkActivity,
  type AssessmentAccessLink,
} from "../../contracts/accessLinks";
import {
  SatSectionCard,
  SatStatusPill,
} from "../../../../products/sat/ui/SatPage";
import type { SatStatusTone } from "../../../../products/sat/ui/SatPage";
import {
  accessLinkStatusDescription,
  accessLinkStatusTone,
  formatAccessLinkStatus,
  formatCompactDateTime,
  shouldPulseAccessLinkStatus,
} from "./accessLinkUi";

export type DetailTab = "overview" | "activity" | "settings";

export interface AccessLinkDetailProps {
  link: AssessmentAccessLink;
  isStaleRelease: boolean;
  currentVersionNumber: number;
  url: string;
  activity: AccessLinkActivity[];
  activityLoading: boolean;
  activityError?: string | null;
  onRetryActivity?: () => void;
  onCopy: () => void;
  onShare: () => void;
  onEdit: () => void;
  onPresent: () => void;
  onCreateForCurrent: () => void;
  defaultTab?: DetailTab;
  /** Transient copy acknowledgement owned by the dashboard (one timer, one source). */
  copyConfirmed?: boolean;
  /** Escape in the pane hands focus back to the selected row, never to the body. */
  onEscapeToRow?: () => void;
}

const STATUS_TONE: Record<AssessmentAccessLink["status"], SatStatusTone> = {
  live: accessLinkStatusTone("live"),
  upcoming: accessLinkStatusTone("upcoming"),
  paused: accessLinkStatusTone("paused"),
  ended: accessLinkStatusTone("ended"),
  revoked: accessLinkStatusTone("revoked"),
};

const TAB_ORDER: DetailTab[] = ["overview", "activity", "settings"];
const TAB_INDICATOR_ID = "sat-access-detail-tab-indicator";

export function AccessLinkDetail(props: AccessLinkDetailProps) {
  const {
    link,
    isStaleRelease,
    currentVersionNumber,
    url,
    activity,
    activityLoading,
    activityError,
    onRetryActivity,
    onCopy,
    onShare,
    onEdit,
    onPresent,
    onCreateForCurrent,
    defaultTab,
    copyConfirmed = false,
    onEscapeToRow,
  } = props;
  const [activeTab, setActiveTab] = useState<DetailTab>(defaultTab ?? "overview");
  const sectionBadge = accessLinkSectionBadge(link.enabledSections, link.publishScope);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab("overview");
  }, [link.id]);

  // A different link starts a different story: without this the pane keeps the
  // previous link's scroll offset and the new header is already off-screen.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [link.id]);

  const shareLabelId = `access-link-share-${link.id}`;
  const tabId = (tab: DetailTab) => `access-link-tab-${link.id}-${tab}`;
  const panelId = (tab: DetailTab) => `access-link-panel-${link.id}-${tab}`;

  // ARIA tab pattern: Arrow keys wrap, Home/End jump, and focus follows the
  // selection so the next keystroke stays in the tablist.
  const handleTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_ORDER.indexOf(activeTab);
    let next: DetailTab | null = null;
    if (event.key === "ArrowRight") next = TAB_ORDER[(index + 1 + TAB_ORDER.length) % TAB_ORDER.length] ?? "overview";
    else if (event.key === "ArrowLeft") next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length] ?? "overview";
    else if (event.key === "Home") next = TAB_ORDER[0] ?? "overview";
    else if (event.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1] ?? "overview";
    if (!next) return;
    event.preventDefault();
    setActiveTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  const handlePaneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !onEscapeToRow) return;
    // Never steal Escape from an open overlay/field: the pane only answers it
    // when the pane itself is the surrounding context.
    event.preventDefault();
    setActiveTab("overview");
    onEscapeToRow();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the pane is a scroll container, not a control: Escape is a convenience shortcut for the focus already inside it (every action is a native button below), so no custom role or tabindex belongs here.
    <div
      ref={scrollRef}
      onKeyDown={handlePaneKeyDown}
      className="flex h-full flex-col overflow-y-auto p-4 sm:p-5"
      data-testid="access-link-detail"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <SatStatusPill tone={STATUS_TONE[link.status]} pulse={shouldPulseAccessLinkStatus(link.status)}>
            {formatAccessLinkStatus(link.status)}
          </SatStatusPill>
          <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-slate-950 sm:text-[22px]">
            {link.name}
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            {accessLinkStatusDescription(link)}
          </p>
          {sectionBadge ? (
            <span className="mt-2 inline-block rounded-full bg-au-fill px-2.5 py-1 text-[10px] font-semibold text-slate-600">
              {sectionBadge}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${link.name}`}
          className="sat-press sat-press-fill flex min-h-11 shrink-0 items-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-3 text-[12px] font-semibold text-slate-700"
        >
          <Pencil size={13} aria-hidden="true" />
          Edit
        </button>
      </div>

      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- tabs are natively focusable buttons; the list only handles ArrowLeft/Right. */}
      <div
        role="tablist"
        aria-label="Link details"
        onKeyDown={handleTabListKeyDown}
        className="relative mt-4 flex gap-1 border-b border-black/[0.06]"
      >
        {TAB_ORDER.map((tab) => {
          const selected = activeTab === tab;
          const label =
            tab === "overview" ? "Overview" : tab === "activity" ? `Activity (${activity.length})` : "Settings";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={tabId(tab)}
              aria-selected={selected}
              aria-controls={panelId(tab)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              className={
                "sat-press relative flex min-h-11 items-center px-3 text-[12px] font-semibold " +
                (selected ? "text-slate-950" : "text-slate-500")
              }
            >
              {selected ? (
                <motion.span
                  layoutId={TAB_INDICATOR_ID}
                  aria-hidden="true"
                  transition={{ type: "spring", stiffness: 640, damping: 50 }}
                  className="sat-tab-indicator"
                />
              ) : null}
              <span className="relative" style={selected ? { fontWeight: 700 } : undefined}>{label}</span>
            </button>
          );
        })}
      </div>

      <div key={activeTab} className="sat-panel-enter min-h-0">
      {activeTab === "overview" ? (
        <div role="tabpanel" id={panelId("overview")} aria-labelledby={tabId("overview")}>
          {isStaleRelease ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-4">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-slate-900">
                  Uses Version {link.versionNumber}
                </p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Version {currentVersionNumber} is available. This link stays unchanged.
                </p>
              </div>
              <button
                type="button"
                onClick={onCreateForCurrent}
                className="sat-press sat-press-fill-accent flex min-h-11 shrink-0 items-center rounded-[12px] bg-au-accent px-4 text-[12px] font-semibold text-white hover:bg-au-accent-hover"
              >
                Create Version {currentVersionNumber} Link
              </button>
            </div>
          ) : null}

          <SatSectionCard labelledBy={shareLabelId} className="mt-4">
            <p id={shareLabelId} className="text-[12px] font-semibold text-slate-900">
              Share this link
            </p>
            <p className="mt-2 break-all font-mono text-[12px] leading-5 text-slate-600">
              {url}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onShare}
                className="sat-press sat-press-fill-accent flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] bg-au-accent px-2 text-[12px] font-semibold text-white hover:bg-au-accent-hover"
              >
                <Share2 size={14} aria-hidden="true" />
                Share
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="sat-press sat-press-fill flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-2 text-[12px] font-semibold text-slate-700"
              >
                {copyConfirmed ? (
                  <Check size={14} className="text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {copyConfirmed ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onPresent}
                className="sat-press sat-press-fill flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] px-2 text-[12px] font-semibold text-slate-600"
              >
                <Presentation size={14} aria-hidden="true" />
                Present
              </button>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="sat-press sat-press-fill mt-1 flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] text-[12px] font-semibold text-slate-500"
            >
              <ExternalLink size={13} aria-hidden="true" />
              Open student page
            </a>
          </SatSectionCard>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-black/[0.06] bg-white p-4">
            <div>
              <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-slate-950">
                {link.metrics.registered}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Joined
              </p>
            </div>
            <div>
              <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-slate-950">
                {link.metrics.started}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Started
              </p>
            </div>
            <div>
              <p className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-slate-950">
                {link.metrics.submitted}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Submitted
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div role="tabpanel" id={panelId("activity")} aria-labelledby={tabId("activity")}>
          <section aria-label="Recent activity" className="mt-4">
            <div className="flex min-h-11 items-center justify-between">
              <h3 className="text-[12px] font-semibold text-slate-900">Recent activity</h3>
              {activityLoading ? (
                <span role="status" aria-label="Loading activity">
                  <LoaderCircle size={14} className="animate-spin text-slate-400" aria-hidden="true" />
                </span>
              ) : null}
            </div>
            {activityError ? (
              <div
                role="alert"
                className="mt-2 rounded-2xl border border-black/[0.06] bg-white p-4"
              >
                <p className="text-[12px] text-slate-600">{activityError}</p>
                {onRetryActivity ? (
                  <button
                    type="button"
                    onClick={onRetryActivity}
                    className="sat-press sat-press-fill mt-2 flex min-h-11 items-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-3 text-[12px] font-semibold text-slate-700"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    Retry
                  </button>
                ) : null}
              </div>
            ) : activity.length ? (
              <ul aria-live="polite" className="mt-2 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white px-4">
                {activity.slice(0, 12).map((item, index) => (
                  <li
                    key={`${item.kind}-${item.occurredAt}-${index}`}
                    className="flex min-h-11 items-center gap-2 py-2"
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "h-2 w-2 shrink-0 rounded-full " +
                        (item.kind === "submitted"
                          ? "bg-emerald-500"
                          : item.kind === "started"
                            ? "bg-au-accent"
                            : "bg-slate-300")
                      }
                    />
                    {item.kind === "submitted" ? (
                      <Check size={12} className="shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-900">
                        {item.studentName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{activityVerb(item.kind)}</p>
                    </div>
                    <time
                      dateTime={item.occurredAt}
                      className="shrink-0 text-[11px] tabular-nums text-slate-500"
                    >
                      {formatCompactDateTime(new Date(item.occurredAt))}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-2xl border border-black/[0.06] bg-white px-4 py-6 text-center text-[12px] text-slate-500">
                No student activity yet.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div role="tabpanel" id={panelId("settings")} aria-labelledby={tabId("settings")}>
          <dl className="mt-4 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white px-4">
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Exam</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                {`${link.examTitle} · Version ${link.versionNumber}`}
              </dd>
            </div>
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Audience</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                {audienceText(link)}
              </dd>
            </div>
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Identification</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                {link.accessMode === "student_code" ? "Student code required" : "Name + email"}
              </dd>
            </div>
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Sections</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                {sectionsText(link)}
              </dd>
            </div>
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Availability</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                {availabilityText(link)}
              </dd>
            </div>
            {link.audienceType === "selected_students" ? (
              <div className="flex min-h-11 items-center gap-3 py-2">
                <dt className="w-28 shrink-0 text-[11px] text-slate-500">Allowed students</dt>
                <dd className="min-w-0 flex-1 break-words text-right text-[12px] font-semibold text-slate-900">
                  {link.selectedStudentCount}
                </dd>
              </div>
            ) : null}
            <div className="flex min-h-11 items-center gap-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] text-slate-500">Link ID</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <span className="min-w-0 flex-1 truncate break-words text-right font-mono text-[12px] font-semibold text-slate-900">
                  {link.id}
                </span>
                <button
                  type="button"
                  onClick={onCopy}
                  aria-label="Copy link ID"
                  className="sat-press sat-press-fill flex min-h-11 shrink-0 items-center gap-1 rounded-[12px] px-2 text-[12px] font-semibold text-slate-600"
                >
                  {copyConfirmed ? (
                    <Check size={13} className="text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Copy size={13} aria-hidden="true" />
                  )}
                  {copyConfirmed ? "Copied" : "Copy"}
                </button>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      </div>
    </div>
  );
}

/** Settings copy for the section scope; the badge is the short form. */
function sectionsText(link: AssessmentAccessLink): string {
  const selected = effectiveAccessLinkSections(link.enabledSections, link.publishScope);
  if (selected.length === 0) return "No available sections · update link scope before sharing";
  const labels = selected.map((key) => ACCESS_LINK_SECTION_LABELS[key]).join(" + ");
  return selected.length === 2 && link.publishScope === "full" ? `Both sections · ${labels}` : `${labels} only · no total score`;
}

function audienceText(link: AssessmentAccessLink): string {
  if (link.audienceType === "anyone") return "Anyone with link";
  if (link.audienceType === "cohort") return link.audienceLabel ?? "Cohort";
  return `${link.audienceLabel ?? "Selected students"} · ${link.selectedStudentCount} students`;
}

function availabilityText(link: AssessmentAccessLink): string {
  if (link.availabilityType === "anytime") return "Anytime while active";
  if (!link.opensAt || !link.closesAt) return "Scheduled";
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(link.opensAt))} – ${formatter.format(new Date(link.closesAt))}`;
}

function activityVerb(kind: string): string {
  if (kind === "joined") return "Joined through this link";
  if (kind === "started") return "Started the exam";
  if (kind === "submitted") return "Submitted the exam";
  return kind;
}
