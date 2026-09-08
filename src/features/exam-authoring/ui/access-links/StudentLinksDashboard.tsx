import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Share2,
  XCircle,
} from "lucide-react";
import type { ExamEntity } from "../../../../types/domain";
import {
  useAccessLinkActivity,
  useAccessLinkMembers,
  useCreateAccessLink,
  useDuplicateAccessLink,
  useSetAccessLinkLifecycle,
  useUpdateAccessLink,
} from "../../api/assessmentAccessLinkQueries";
import type {
  AccessDistributionOverview,
  AccessLinkMemberInput,
  AccessLinkStatus,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
  DuplicateAssessmentAccessLinkRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import { AccessLinkEditorSheet } from "./AccessLinkEditorSheet";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { SatMenu } from "../../../../products/sat/ui/Menu";
import { AccessLinkPresentView, AccessLinkShareSheet } from "./AccessLinkShareSheet";
import {
  accessLinkStatusDescription,
  copyText,
  formatAccessLinkStatus,
  formatCompactDateTime,
  studentJoinUrl,
} from "./accessLinkUi";

interface StudentLinksDashboardProps {
  exam: ExamEntity;
  overview: AccessDistributionOverview | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  onBackToRelease: () => void;
}

type StatusFilter = "all" | AccessLinkStatus;

const EMPTY_ACCESS_LINKS: AssessmentAccessLink[] = [];

export function StudentLinksDashboard({ exam, overview, isLoading, error, onRefresh, onBackToRelease }: StudentLinksDashboardProps) {
  const reduceMotion = useReducedMotion();
  const version = overview?.currentPublishedVersion ?? null;
  const links = overview?.links ?? EMPTY_ACCESS_LINKS;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AssessmentAccessLink | null>(null);
  const [shareLink, setShareLink] = useState<AssessmentAccessLink | null>(null);
  const [presentLink, setPresentLink] = useState<AssessmentAccessLink | null>(null);
  const [confirm, setConfirm] = useState<{ link: AssessmentAccessLink; action: "revoke" } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const createMutation = useCreateAccessLink(exam.id);
  const updateMutation = useUpdateAccessLink(exam.id);
  const lifecycleMutation = useSetAccessLinkLifecycle(exam.id);
  const duplicateMutation = useDuplicateAccessLink(exam.id);
  const membersQuery = useAccessLinkMembers(editingLink?.id ?? null);

  const visibleLinks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const statusRank: Record<AccessLinkStatus, number> = { live: 0, upcoming: 1, paused: 2, ended: 3, revoked: 4 };
    return links
      .filter((link) => {
        if (statusFilter !== "all" && link.status !== statusFilter) return false;
        if (!query) return true;
        return [link.name, link.audienceLabel ?? "", link.examTitle, `version ${link.versionNumber}`]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => statusRank[left.status] - statusRank[right.status] || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [links, search, statusFilter]);
  const selectedLink = visibleLinks.find((link) => link.id === selectedId) ?? null;
  const activityQuery = useAccessLinkActivity(selectedLink?.id ?? null);

  useEffect(() => {
    if (selectedId && visibleLinks.some((link) => link.id === selectedId)) return;
    setSelectedId(visibleLinks[0]?.id ?? null);
  }, [selectedId, visibleLinks]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const createLink = async (request: CreateAssessmentAccessLinkRequest) => {
    const created = await createMutation.mutateAsync(request);
    setSelectedId(created.id);
    setToast("Student Link created");
  };
  const updateLink = async (linkId: string, request: UpdateAssessmentAccessLinkRequest) => {
    const updated = await updateMutation.mutateAsync({ linkId, request });
    setSelectedId(updated.id);
    setToast("Student Link updated");
  };
  const setLifecycle = async (
    link: AssessmentAccessLink,
    state: "active" | "paused" | "revoked",
  ): Promise<boolean> => {
    setActionError(null);
    try {
      await lifecycleMutation.mutateAsync({ linkId: link.id, request: { revision: link.revision, state } });
      setToast(state === "active" ? "Student Link resumed" : state === "paused" ? "Student Link paused" : "Student Link revoked");
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Student Link could not be changed.");
      return false;
    }
  };
  const duplicate = async (link: AssessmentAccessLink, releaseTarget: "source" | "current" = "source") => {
    setActionError(null);
    const request: DuplicateAssessmentAccessLinkRequest = releaseTarget === "current"
      ? { revision: link.revision, name: link.name, releaseTarget: "current" }
      : { revision: link.revision, name: `${link.name} Copy`, releaseTarget: "source" };
    try {
      const created = await duplicateMutation.mutateAsync({ linkId: link.id, request });
      setSelectedId(created.id);
      setToast(releaseTarget === "current" ? `Created for Version ${version?.versionNumber ?? "current"}` : "Student Link duplicated");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Student Link could not be duplicated.");
    }
  };
  const copy = async (link: AssessmentAccessLink) => {
    try {
      await copyText(studentJoinUrl(link.id));
      setToast("Link copied");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Link could not be copied.");
    }
  };

  if (isLoading) return <StudentLinksLoading onBack={onBackToRelease} />;
  if (error) return <StudentLinksError error={error} onBack={onBackToRelease} onRetry={onRefresh} />;
  if (!version) return <NoPublishedVersion onBack={onBackToRelease} />;

  const liveCount = links.filter((link) => link.status === "live").length;
  const upcomingCount = links.filter((link) => link.status === "upcoming").length;

  return (
    <div className="sat-product flex min-h-screen flex-col bg-au-fill text-slate-950">
      <header className="sticky top-0 z-40 border-b border-au-separator authoring-glass">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={onBackToRelease} className="flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-slate-500 hover:bg-au-fill hover:text-slate-900"><ArrowLeft size={15} aria-hidden="true"/>Release</button>
          <div className="h-5 w-px bg-au-fill"/>
          <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold tracking-[-0.01em]">{exam.title}</p><p className="text-[9px] font-medium text-slate-400">Student Access · Version {version.versionNumber} is published</p></div>
          <button type="button" onClick={() => { setEditingLink(null); setEditorOpen(true); }} className="authoring-button authoring-button--primary flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[11px]"><Plus size={13} aria-hidden="true"/>New Link</button>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-4 py-6 sm:px-6">
        <section className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
          <div><div className="flex items-center gap-2"><h1 className="text-[28px] font-semibold tracking-[-0.04em]">Student Access</h1></div><p className="mt-1 text-[12px] text-slate-500">Share this exam with students. Existing links stay on the release they were created for.</p></div>
          <div className="flex gap-5 text-right"><MetricCompact value={links.length} label="Links"/><MetricCompact value={liveCount} label="Live"/><MetricCompact value={upcomingCount} label="Upcoming"/></div>
        </section>

        {actionError ? <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-au-danger/15 bg-au-danger-tint px-3 py-2 text-[11px] font-medium text-au-danger-text"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"><XCircle size={14} aria-hidden="true"/></button></div> : null}

        <div className="authoring-surface flex min-h-[620px] flex-1 overflow-hidden max-[900px]:min-h-[720px] max-[900px]:flex-col">
          <section className="flex min-w-0 flex-[0_0_56%] flex-col border-r border-au-separator max-[900px]:min-h-[360px] max-[900px]:flex-[0_0_auto] max-[900px]:border-b max-[900px]:border-r-0">
            <div className="border-b border-au-separator p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1"><Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search Student Links" placeholder="Search links" className="h-10 w-full rounded-xl bg-au-fill pl-9 pr-3 text-[11px] outline-none focus:bg-au-surface focus:ring-4 focus:ring-au-accent/10"/></div>
                
              </div>
              <div className="mt-2 flex items-center gap-1 overflow-x-auto">{(["all","live","upcoming","ended","paused","revoked"] as StatusFilter[]).map((status) => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[9px] font-semibold capitalize ${statusFilter === status ? "bg-au-accent text-white" : "text-slate-500 hover:bg-au-fill"}`}>{status === "all" ? `All ${links.length}` : formatAccessLinkStatus(status)}</button>)}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {visibleLinks.length ? visibleLinks.map((link) => <AccessLinkRow key={link.id} link={link} selected={selectedId === link.id} currentVersionId={version.id} onSelect={() => setSelectedId(link.id)} onCopy={() => void copy(link)} onShare={() => setShareLink(link)} onEdit={() => { setEditingLink(link); setEditorOpen(true); }} onDuplicate={() => { void duplicate(link); }} onPauseResume={() => { void setLifecycle(link, link.lifecycleState === "paused" ? "active" : "paused"); }} onPresent={() => { setPresentLink(link); }} onRevoke={() => { setConfirm({ link, action: "revoke" }); }} />) : <EmptyLinks hasLinks={links.length > 0} onCreate={() => { setEditingLink(null); setEditorOpen(true); }}/>}
            </div>
          </section>
          <section className="min-w-0 flex-1 bg-au-fill max-[900px]:min-h-[360px]">{selectedLink ? <AccessLinkDetail link={selectedLink} currentVersionId={version.id} currentVersionNumber={version.versionNumber} activity={activityQuery.data ?? []} activityLoading={activityQuery.isLoading} onCopy={() => void copy(selectedLink)} onShare={() => setShareLink(selectedLink)} onEdit={() => { setEditingLink(selectedLink); setEditorOpen(true); }} onPresent={() => setPresentLink(selectedLink)} onCreateForCurrent={() => void duplicate(selectedLink, "current")} /> : <div className="flex h-full items-center justify-center p-8 text-center"><div><Link2 size={28} className="mx-auto text-slate-300" aria-hidden="true"/><p className="mt-3 text-[12px] font-semibold text-slate-600">Select a Student Link</p><p className="mt-1 text-[10px] leading-5 text-slate-400">Details, activity, sharing, and lifecycle controls appear here.</p></div></div>}</section>
        </div>
      </main>

      <AccessLinkEditorSheet open={editorOpen} link={editingLink} members={(membersQuery.data ?? []) as AccessLinkMemberInput[]} isSaving={createMutation.isPending || updateMutation.isPending} onClose={() => { if (!createMutation.isPending && !updateMutation.isPending) { setEditorOpen(false); setEditingLink(null); } }} onCreate={createLink} onUpdate={updateLink}/>
      <AccessLinkShareSheet open={Boolean(shareLink)} link={shareLink} onClose={() => setShareLink(null)} onPresent={() => { setPresentLink(shareLink); setShareLink(null); }}/>
      <AccessLinkPresentView open={Boolean(presentLink)} link={presentLink} onClose={() => setPresentLink(null)}/>
      <AuthoringConfirmDialog
        open={Boolean(confirm)}
        title="Revoke this Student Link?"
        description="Students who have not entered yet will permanently lose access through this link. Existing exam attempts are not deleted. Revocation cannot be undone."
        confirmLabel="Revoke Link"
        destructive
        busy={lifecycleMutation.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const target = confirm?.link;
          if (!target) return;
          void setLifecycle(target, "revoked").then((success) => {
            if (success) setConfirm(null);
          });
        }}
      />
      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            className="fixed bottom-6 left-1/2 z-[150] flex -translate-x-1/2 items-center gap-2 rounded-full bg-au-accent px-4 py-2.5 text-[11px] font-semibold text-white shadow-md"
          >
            <Check size={13} className="text-au-success" aria-hidden="true" />
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AccessLinkRow({
  link,
  selected,
  currentVersionId,
  onSelect,
  onCopy,
  onShare,
  onEdit,
  onDuplicate,
  onPauseResume,
  onPresent,
  onRevoke,
}: {
  link: AssessmentAccessLink;
  selected: boolean;
  currentVersionId: string;
  onSelect: () => void;
  onCopy: () => void;
  onShare: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onPauseResume: () => void;
  onPresent: () => void;
  onRevoke: () => void;
}) {
  return (
    <div className={`group relative mb-1 rounded-xl border transition ${selected ? "border-au-accent/30 bg-au-accent-tint" : "border-transparent hover:bg-au-fill"}`}>
      <button type="button" onClick={onSelect} className="w-full px-3 py-3 text-left">
        <div className="flex items-start gap-3">
          <StatusDot status={link.status}/>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[12px] font-semibold text-slate-900">{link.name}</h3>
              {link.publishedVersionId !== currentVersionId ? <span className="shrink-0 text-[8px] font-medium text-slate-400">Version {link.versionNumber}</span> : null}
            </div>
            <p className="mt-1 truncate text-[9px] font-medium text-slate-400">{formatAccessLinkStatus(link.status)} · {audienceText(link)} · {accessLinkStatusDescription(link)}</p>
            <div className="mt-2 flex items-center gap-3 text-[9px] tabular-nums text-slate-400"><span>{link.metrics.registered} joined</span><span>{link.metrics.started} started</span><span>{link.metrics.submitted} submitted</span></div>
          </div>
          <div className="w-[108px] shrink-0 truncate pt-0.5 text-right font-mono text-[8px] text-slate-400">…/{link.id.slice(0, 8)}</div>
        </div>
      </button>
      <div className="absolute right-2 top-9 flex items-center gap-0.5 opacity-100 transition">
        <button type="button" onClick={onCopy} aria-label={`Copy ${link.name} link`} className="authoring-icon-button h-8 w-8 rounded-lg bg-au-surface shadow-sm"><Copy size={12} aria-hidden="true"/></button>
        <button type="button" onClick={onShare} aria-label={`Share ${link.name}`} className="authoring-icon-button h-8 w-8 rounded-lg bg-au-surface shadow-sm"><Share2 size={12} aria-hidden="true"/></button>
        <SatMenu
          label={`More actions for ${link.name}`}
          compact
          align="end"
          triggerContent={<Ellipsis size={13} aria-hidden="true" />}
          items={[
            { id: "edit", label: "Edit Link", onSelect: onEdit },
            { id: "duplicate", label: "Duplicate Link", onSelect: onDuplicate },
            { id: "present", label: "Present to Students", onSelect: onPresent },
            ...(link.lifecycleState !== "revoked"
              ? [{ id: "pause", label: link.lifecycleState === "paused" ? "Resume Link" : "Pause Link", onSelect: onPauseResume }]
              : []),
            { id: "revoke", label: "Revoke Link", onSelect: onRevoke, destructive: true, separatorBefore: true, disabled: link.lifecycleState === "revoked" },
          ]}
        />
      </div>
    </div>
  );
}

function AccessLinkDetail({ link, currentVersionId, currentVersionNumber, activity, activityLoading, onCopy, onShare, onEdit, onPresent, onCreateForCurrent }: { link: AssessmentAccessLink; currentVersionId: string; currentVersionNumber: number; activity: { kind: string; studentName: string; occurredAt: string }[]; activityLoading: boolean; onCopy: () => void; onShare: () => void; onEdit: () => void; onPresent: () => void; onCreateForCurrent: () => void }) {
  const url = studentJoinUrl(link.id);
  return <div className="h-full overflow-y-auto p-5"><div className="flex items-start gap-3"><StatusDot status={link.status} large/><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-slate-400">{formatAccessLinkStatus(link.status)}</p><h2 className="mt-0.5 text-[20px] font-semibold tracking-[-0.03em] text-slate-950">{link.name}</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">{accessLinkStatusDescription(link)}</p></div><button type="button" onClick={onEdit} className="flex h-9 items-center gap-1 rounded-full px-3 text-[10px] font-semibold text-slate-600 hover:bg-au-fill"><Pencil size={12} aria-hidden="true"/>Edit</button></div>
    {link.publishedVersionId !== currentVersionId ? <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-au-separator bg-au-surface px-3 py-2.5"><div><p className="text-[10px] font-semibold text-slate-700">Uses Version {link.versionNumber}</p><p className="mt-0.5 text-[9px] text-slate-400">Version {currentVersionNumber} is available. This link stays unchanged.</p></div><button type="button" onClick={onCreateForCurrent} className="shrink-0 rounded-full bg-au-accent px-3 py-2 text-[9px] font-semibold text-white hover:bg-au-accent-hover">Create Version {currentVersionNumber} Link</button></div> : null}
    <div className="mt-5 rounded-xl border border-au-separator bg-au-surface p-3"><p className="truncate font-mono text-[10px] text-slate-500">{url}</p><div className="mt-2 grid grid-cols-3 gap-1.5"><DetailAction onClick={onShare} icon={<Share2 size={13} aria-hidden="true" />}>Share</DetailAction><DetailAction onClick={onCopy} icon={<Copy size={13} aria-hidden="true" />}>Copy</DetailAction><DetailAction onClick={onPresent} icon={<Presentation size={13} aria-hidden="true" />}>Present</DetailAction></div><a href={url} target="_blank" rel="noreferrer" className="mt-1.5 flex min-h-8 items-center justify-center gap-1 text-[9px] font-semibold text-slate-400 hover:text-slate-700"><ExternalLink size={11} aria-hidden="true"/>Open student page</a></div>
    <div className="mt-5 grid grid-cols-3 gap-2"><MetricCard value={link.metrics.registered} label="Joined"/><MetricCard value={link.metrics.started} label="Started"/><MetricCard value={link.metrics.submitted} label="Submitted"/></div>
    <dl className="mt-5 divide-y divide-au-separator rounded-xl border border-au-separator bg-au-surface px-3"><InfoRow label="Exam" value={`${link.examTitle} · Version ${link.versionNumber}`}/><InfoRow label="Audience" value={audienceText(link)}/><InfoRow label="Identification" value={link.accessMode === "student_code" ? "Student code required" : "Name + email"}/><InfoRow label="Availability" value={availabilityText(link)}/>{link.audienceType === "selected_students" ? <InfoRow label="Allowed students" value={`${link.selectedStudentCount}`}/> : null}</dl>
    <section className="mt-6"><div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold text-slate-700">Recent Activity</h3>{activityLoading ? <LoaderCircle size={12} className="animate-spin text-slate-400" aria-hidden="true"/> : null}</div><div className="mt-2 rounded-xl border border-au-separator bg-au-surface">{activity.length ? activity.slice(0, 12).map((item, index) => <div key={`${item.kind}-${item.occurredAt}-${index}`} className="flex items-center gap-2 border-b border-au-separator px-3 py-2.5 last:border-0"><ActivityIcon kind={item.kind}/><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-slate-700">{item.studentName}</p><p className="mt-0.5 text-[8px] text-slate-400">{activityVerb(item.kind)}</p></div><time className="text-[8px] tabular-nums text-slate-400">{formatCompactDateTime(new Date(item.occurredAt))}</time></div>) : <p className="px-3 py-5 text-center text-[9px] text-slate-400">No student activity yet.</p>}</div></section>
  </div>;
}

function EmptyLinks({ hasLinks, onCreate }: { hasLinks: boolean; onCreate: () => void }) { return <div className="flex min-h-[420px] items-center justify-center px-8 text-center"><div className="max-w-xs"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-au-fill text-slate-400"><Link2 size={20} aria-hidden="true"/></div><h3 className="mt-4 text-[14px] font-semibold text-slate-800">{hasLinks ? "No matching links" : "No student access yet"}</h3><p className="mt-1 text-[10px] leading-5 text-slate-400">{hasLinks ? "Change the search or status filter." : "Create a link when you are ready to share this exam."}</p>{!hasLinks ? <button type="button" onClick={onCreate} className="mt-4 min-h-10 rounded-full bg-au-accent px-4 text-[11px] font-semibold text-white hover:bg-au-accent-hover"><Plus size={12} className="mr-1 inline" aria-hidden="true"/>New Student Link</button> : null}</div></div>; }
function StatusDot({ status, large = false }: { status: AccessLinkStatus; large?: boolean }) { const cls = status === "live" ? "bg-au-success" : status === "upcoming" ? "bg-au-warning" : status === "paused" ? "bg-slate-400" : status === "revoked" ? "bg-au-danger" : "bg-slate-300"; return <span role="img" className={`${large ? "mt-2 h-3 w-3" : "mt-1 h-2.5 w-2.5"} shrink-0 rounded-full ${cls}`} aria-label={formatAccessLinkStatus(status)}/>; }
function audienceText(link: AssessmentAccessLink) { if (link.audienceType === "anyone") return "Anyone with link"; if (link.audienceType === "cohort") return link.audienceLabel ?? "Cohort"; return `${link.audienceLabel ?? "Selected students"} · ${link.selectedStudentCount} students`; }
function availabilityText(link: AssessmentAccessLink) { if (link.availabilityType === "anytime") return "Anytime while active"; if (!link.opensAt || !link.closesAt) return "Scheduled"; const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); return `${formatter.format(new Date(link.opensAt))} – ${formatter.format(new Date(link.closesAt))}`; }
function activityVerb(kind: string) { return kind === "joined" ? "Joined through this link" : kind === "started" ? "Started the exam" : kind === "submitted" ? "Submitted the exam" : kind; }
function ActivityIcon({ kind }: { kind: string }) { return <span aria-hidden="true" className={`h-2 w-2 rounded-full ${kind === "submitted" ? "bg-au-success" : kind === "started" ? "bg-au-accent" : "bg-slate-300"}`}/>; }
function MetricCompact({ value, label }: { value: number; label: string }) { return <div><p className="text-[18px] font-semibold tabular-nums tracking-[-0.03em]">{value}</p><p className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{label}</p></div>; }
function MetricCard({ value, label }: { value: number; label: string }) { return <div className="rounded-xl border border-au-separator bg-au-surface p-3"><p className="text-xl font-semibold tabular-nums tracking-[-0.03em]">{value}</p><p className="mt-0.5 text-[8px] font-semibold text-slate-400">{label}</p></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex min-h-10 items-center gap-3 py-2"><dt className="w-24 shrink-0 text-[9px] font-medium text-slate-400">{label}</dt><dd className="min-w-0 flex-1 text-right text-[9px] font-semibold text-slate-600">{value}</dd></div>; }
function DetailAction({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button type="button" onClick={onClick} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-au-fill text-[9px] font-semibold text-slate-600 hover:bg-au-fill-strong">{icon}{children}</button>; }
function StudentLinksLoading({ onBack }: { onBack: () => void }) { return <div className="sat-product min-h-screen bg-au-fill p-6" role="status" aria-busy="true"><button type="button" onClick={onBack} className="text-sm text-slate-500">← Release</button><div className="mx-auto mt-16 max-w-5xl"><div className="h-8 w-48 animate-pulse rounded-lg bg-au-fill-strong"/><div className="mt-6 h-[620px] animate-pulse rounded-[22px] bg-au-surface"/></div></div>; }
function StudentLinksError({ error, onBack, onRetry }: { error: string; onBack: () => void; onRetry: () => Promise<unknown> }) { return <div className="sat-product min-h-screen bg-au-fill p-6"><div role="alert" className="mx-auto max-w-lg rounded-[20px] bg-au-surface p-6"><h1 className="text-base font-semibold">Student Access could not load</h1><p className="mt-2 text-sm text-slate-500">{error}</p><div className="mt-5 flex gap-2"><button type="button" onClick={onBack} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600">Release</button><button type="button" onClick={() => void onRetry()} className="flex items-center gap-1 rounded-xl bg-au-accent px-4 py-2 text-sm font-semibold text-white"><RefreshCw size={13} aria-hidden="true"/>Retry</button></div></div></div>; }
function NoPublishedVersion({ onBack }: { onBack: () => void }) { return <div className="sat-product min-h-screen bg-au-fill p-6"><div className="mx-auto mt-20 max-w-lg rounded-[22px] bg-au-surface p-7 text-center"><Link2 size={28} className="mx-auto text-slate-300" aria-hidden="true"/><h1 className="mt-4 text-lg font-semibold">Publish before creating Student Access</h1><p className="mt-2 text-sm text-slate-500">Student access always uses an immutable published release.</p><button type="button" onClick={onBack} className="mt-5 rounded-xl bg-au-accent px-4 py-2.5 text-sm font-semibold text-white">Return to Release</button></div></div>; }
