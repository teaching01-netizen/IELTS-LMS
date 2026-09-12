import { useEffect, useState } from "react";
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
import type {
  AccessLinkActivity,
  AssessmentAccessLink,
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
}

const STATUS_TONE: Record<AssessmentAccessLink["status"], SatStatusTone> = {
  live: accessLinkStatusTone("live"),
  upcoming: accessLinkStatusTone("upcoming"),
  paused: accessLinkStatusTone("paused"),
  ended: accessLinkStatusTone("ended"),
  revoked: accessLinkStatusTone("revoked"),
};

const TAB_ORDER: DetailTab[] = ["overview", "activity", "settings"];

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
  } = props;
  const [activeTab, setActiveTab] = useState<DetailTab>(defaultTab ?? "overview");

  useEffect(() => {
    setActiveTab("overview");
  }, [link.id]);

  const shareLabelId = `access-link-share-${link.id}`;
  const tabId = (tab: DetailTab) => `access-link-tab-${link.id}-${tab}`;
  const panelId = (tab: DetailTab) => `access-link-panel-${link.id}-${tab}`;

  const handleTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TAB_ORDER.indexOf(activeTab);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length] ?? "overview";
    setActiveTab(next);
  };

  return (
    <div
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
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${link.name}`}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-3 text-[12px] font-semibold text-slate-700"
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
        className="mt-4 flex gap-1 border-b border-black/[0.06]"
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
              onClick={() => setActiveTab(tab)}
              className={
                "flex min-h-11 items-center border-b-2 px-3 text-[12px] font-semibold " +
                (selected
                  ? "border-[#0071e3] font-bold text-slate-950"
                  : "border-transparent text-slate-500")
              }
            >
              {label}
            </button>
          );
        })}
      </div>

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
                className="flex min-h-11 shrink-0 items-center rounded-[12px] bg-au-accent px-4 text-[12px] font-semibold text-white"
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
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] bg-au-accent px-2 text-[12px] font-semibold text-white"
              >
                <Share2 size={14} aria-hidden="true" />
                Share
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-2 text-[12px] font-semibold text-slate-700"
              >
                <Copy size={14} aria-hidden="true" />
                Copy
              </button>
              <button
                type="button"
                onClick={onPresent}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] px-2 text-[12px] font-semibold text-slate-600"
              >
                <Presentation size={14} aria-hidden="true" />
                Present
              </button>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex min-h-11 items-center justify-center gap-1.5 text-[12px] font-semibold text-slate-500"
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
                    className="mt-2 flex min-h-11 items-center gap-1.5 rounded-[12px] border border-black/[0.08] bg-white px-3 text-[12px] font-semibold text-slate-700"
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
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-[12px] px-2 text-[12px] font-semibold text-slate-600"
                >
                  <Copy size={13} aria-hidden="true" />
                  Copy
                </button>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
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
