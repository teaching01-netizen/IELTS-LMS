import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  Link2,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
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
  const version = overview?.currentPublishedVersion ?? null;
  const links = overview?.links ?? EMPTY_ACCESS_LINKS;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AssessmentAccessLink | null>(null);
  const [shareLink, setShareLink] = useState<AssessmentAccessLink | null>(null);
  const [presentLink, setPresentLink] = useState<AssessmentAccessLink | null>(null);
  const [menuLinkId, setMenuLinkId] = useState<string | null>(null);
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
  const setLifecycle = async (link: AssessmentAccessLink, state: "active" | "paused" | "revoked") => {
    setActionError(null);
    try {
      await lifecycleMutation.mutateAsync({ linkId: link.id, request: { revision: link.revision, state } });
      setToast(state === "active" ? "Student Link resumed" : state === "paused" ? "Student Link paused" : "Student Link revoked");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Student Link could not be changed.");
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
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-black/[0.055] bg-white/88 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={onBackToRelease} className="flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04] hover:text-slate-900"><ArrowLeft size={15}/>Release</button>
          <div className="h-5 w-px bg-black/[0.08]"/>
          <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold tracking-[-0.01em]">{exam.title}</p><p className="text-[9px] font-medium text-slate-400">Student Access · Version {version.versionNumber} is published</p></div>
          <button type="button" onClick={() => { setEditingLink(null); setEditorOpen(true); }} className="flex min-h-10 items-center gap-1.5 rounded-full bg-[#0071e3] px-4 text-[11px] font-semibold text-white hover:bg-[#0077ed]"><Plus size={13}/>New Link</button>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-4 py-6 sm:px-6">
        <section className="mb-5 flex flex-wrap items-end justify-between gap-4 px-1">
          <div><div className="flex items-center gap-2"><h1 className="text-[28px] font-semibold tracking-[-0.04em]">Student Access</h1></div><p className="mt-1 text-[12px] text-slate-500">Share this exam with students. Existing links stay on the release they were created for.</p></div>
          <div className="flex gap-5 text-right"><MetricCompact value={links.length} label="Links"/><MetricCompact value={liveCount} label="Live"/><MetricCompact value={upcomingCount} label="Upcoming"/></div>
        </section>

        {actionError ? <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"><XCircle size={14}/></button></div> : null}

        <div className="flex min-h-[620px] flex-1 overflow-hidden rounded-[22px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <section className="flex min-w-0 flex-[0_0_56%] flex-col border-r border-black/[0.06]">
            <div className="border-b border-black/[0.055] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1"><Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search Student Links" placeholder="Search links" className="h-10 w-full rounded-xl bg-black/[0.035] pl-9 pr-3 text-[11px] outline-none focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10"/></div>
                
              </div>
              <div className="mt-2 flex items-center gap-1 overflow-x-auto">{(["all","live","upcoming","ended","paused","revoked"] as StatusFilter[]).map((status) => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[9px] font-semibold capitalize ${statusFilter === status ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-black/[0.04]"}`}>{status === "all" ? `All ${links.length}` : formatAccessLinkStatus(status)}</button>)}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {visibleLinks.length ? visibleLinks.map((link) => <AccessLinkRow key={link.id} link={link} selected={selectedId === link.id} currentVersionId={version.id} menuOpen={menuLinkId === link.id} onSelect={() => setSelectedId(link.id)} onCopy={() => void copy(link)} onShare={() => setShareLink(link)} onMenu={() => setMenuLinkId((current) => current === link.id ? null : link.id)} onEdit={() => { setEditingLink(link); setEditorOpen(true); setMenuLinkId(null); }} onDuplicate={() => { void duplicate(link); setMenuLinkId(null); }} onPauseResume={() => { void setLifecycle(link, link.lifecycleState === "paused" ? "active" : "paused"); setMenuLinkId(null); }} onPresent={() => { setPresentLink(link); setMenuLinkId(null); }} onRevoke={() => { setConfirm({ link, action: "revoke" }); setMenuLinkId(null); }} />) : <EmptyLinks hasLinks={links.length > 0} onCreate={() => { setEditingLink(null); setEditorOpen(true); }}/>} 
            </div>
          </section>
          <section className="min-w-[360px] flex-1 bg-[#fbfbfc]">{selectedLink ? <AccessLinkDetail link={selectedLink} currentVersionId={version.id} currentVersionNumber={version.versionNumber} activity={activityQuery.data ?? []} activityLoading={activityQuery.isLoading} onCopy={() => void copy(selectedLink)} onShare={() => setShareLink(selectedLink)} onEdit={() => { setEditingLink(selectedLink); setEditorOpen(true); }} onPresent={() => setPresentLink(selectedLink)} onCreateForCurrent={() => void duplicate(selectedLink, "current")} /> : <div className="flex h-full items-center justify-center p-8 text-center"><div><Link2 size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-[12px] font-semibold text-slate-600">Select a Student Link</p><p className="mt-1 text-[10px] leading-5 text-slate-400">Details, activity, sharing, and lifecycle controls appear here.</p></div></div>}</section>
        </div>
      </main>

      <AccessLinkEditorSheet open={editorOpen} link={editingLink} members={(membersQuery.data ?? []) as AccessLinkMemberInput[]} isSaving={createMutation.isPending || updateMutation.isPending} onClose={() => { if (!createMutation.isPending && !updateMutation.isPending) { setEditorOpen(false); setEditingLink(null); } }} onCreate={createLink} onUpdate={updateLink}/>
      <AccessLinkShareSheet open={Boolean(shareLink)} link={shareLink} onClose={() => setShareLink(null)} onPresent={() => { setPresentLink(shareLink); setShareLink(null); }}/>
      <AccessLinkPresentView open={Boolean(presentLink)} link={presentLink} onClose={() => setPresentLink(null)}/>
      <ConfirmDialog open={Boolean(confirm)} title="Revoke this Student Link?" description="Students who have not entered yet will permanently lose access through this link. Existing exam attempts are not deleted. Revocation cannot be undone." confirmLabel="Revoke Link" destructive onCancel={() => setConfirm(null)} onConfirm={() => { const target = confirm?.link; setConfirm(null); if (target) void setLifecycle(target, "revoked"); }}/>
      <AnimatePresence>{toast ? <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-6 left-1/2 z-[150] flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-[11px] font-semibold text-white shadow-xl"><Check size={13} className="text-emerald-400"/>{toast}</motion.div> : null}</AnimatePresence>
    </div>
  );
}

function AccessLinkRow({ link, selected, currentVersionId, menuOpen, onSelect, onCopy, onShare, onMenu, onEdit, onDuplicate, onPauseResume, onPresent, onRevoke }: { link: AssessmentAccessLink; selected: boolean; currentVersionId: string; menuOpen: boolean; onSelect: () => void; onCopy: () => void; onShare: () => void; onMenu: () => void; onEdit: () => void; onDuplicate: () => void; onPauseResume: () => void; onPresent: () => void; onRevoke: () => void }) {
  return <div className={`group relative mb-1 rounded-xl border transition ${selected ? "border-[#0071e3]/30 bg-[#0071e3]/[0.045]" : "border-transparent hover:bg-black/[0.02]"}`}>
    <button type="button" onClick={onSelect} className="w-full px-3 py-3 text-left"><div className="flex items-start gap-3"><StatusDot status={link.status}/><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-[12px] font-semibold text-slate-900">{link.name}</h3>{link.publishedVersionId !== currentVersionId ? <span className="shrink-0 text-[8px] font-medium text-slate-400">Version {link.versionNumber}</span> : null}</div><p className="mt-1 truncate text-[9px] font-medium text-slate-400">{formatAccessLinkStatus(link.status)} · {audienceText(link)} · {accessLinkStatusDescription(link)}</p><div className="mt-2 flex items-center gap-3 text-[9px] tabular-nums text-slate-400"><span>{link.metrics.registered} joined</span><span>{link.metrics.started} started</span><span>{link.metrics.submitted} submitted</span></div></div><div className="w-[108px] shrink-0 truncate pt-0.5 text-right font-mono text-[8px] text-slate-400">…/{link.id.slice(0, 8)}</div></div></button>
    <div className="absolute right-2 top-9 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"><button type="button" onClick={onCopy} aria-label={`Copy ${link.name} link`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm hover:text-slate-800"><Copy size={12}/></button><button type="button" onClick={onShare} aria-label={`Share ${link.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm hover:text-slate-800"><Share2 size={12}/></button><button type="button" onClick={onMenu} aria-label={`More actions for ${link.name}`} aria-expanded={menuOpen} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm hover:text-slate-800"><Ellipsis size={13}/></button></div>
    {menuOpen ? <div className="absolute right-2 top-[70px] z-30 w-48 rounded-xl border border-black/[0.08] bg-white p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)]"><MenuAction icon={<Pencil size={12}/>} onClick={onEdit}>Edit Link</MenuAction><MenuAction icon={<Copy size={12}/>} onClick={onDuplicate}>Duplicate Link</MenuAction><MenuAction icon={<Presentation size={12}/>} onClick={onPresent}>Present to Students</MenuAction>{link.lifecycleState !== "revoked" ? <MenuAction icon={link.lifecycleState === "paused" ? <Play size={12}/> : <Pause size={12}/>} onClick={onPauseResume}>{link.lifecycleState === "paused" ? "Resume Link" : "Pause Link"}</MenuAction> : null}<div className="my-1 h-px bg-black/[0.06]"/><MenuAction destructive icon={<XCircle size={12}/>} onClick={onRevoke} disabled={link.lifecycleState === "revoked"}>Revoke Link</MenuAction></div> : null}
  </div>;
}

function AccessLinkDetail({ link, currentVersionId, currentVersionNumber, activity, activityLoading, onCopy, onShare, onEdit, onPresent, onCreateForCurrent }: { link: AssessmentAccessLink; currentVersionId: string; currentVersionNumber: number; activity: { kind: string; studentName: string; occurredAt: string }[]; activityLoading: boolean; onCopy: () => void; onShare: () => void; onEdit: () => void; onPresent: () => void; onCreateForCurrent: () => void }) {
  const url = studentJoinUrl(link.id);
  return <div className="h-full overflow-y-auto p-5"><div className="flex items-start gap-3"><StatusDot status={link.status} large/><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-slate-400">{formatAccessLinkStatus(link.status)}</p><h2 className="mt-0.5 text-[20px] font-semibold tracking-[-0.03em] text-slate-950">{link.name}</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">{accessLinkStatusDescription(link)}</p></div><button type="button" onClick={onEdit} className="flex h-9 items-center gap-1 rounded-full px-3 text-[10px] font-semibold text-slate-600 hover:bg-black/[0.04]"><Pencil size={12}/>Edit</button></div>
    {link.publishedVersionId !== currentVersionId ? <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-white px-3 py-2.5"><div><p className="text-[10px] font-semibold text-slate-700">Uses Version {link.versionNumber}</p><p className="mt-0.5 text-[9px] text-slate-400">Version {currentVersionNumber} is available. This link stays unchanged.</p></div><button type="button" onClick={onCreateForCurrent} className="shrink-0 rounded-full bg-[#0071e3] px-3 py-2 text-[9px] font-semibold text-white hover:bg-[#0077ed]">Create Version {currentVersionNumber} Link</button></div> : null}
    <div className="mt-5 rounded-xl border border-black/[0.06] bg-white p-3"><p className="truncate font-mono text-[10px] text-slate-500">{url}</p><div className="mt-2 grid grid-cols-3 gap-1.5"><DetailAction onClick={onShare} icon={<Share2 size={13}/>}>Share</DetailAction><DetailAction onClick={onCopy} icon={<Copy size={13}/>}>Copy</DetailAction><DetailAction onClick={onPresent} icon={<Presentation size={13}/>}>Present</DetailAction></div><a href={url} target="_blank" rel="noreferrer" className="mt-1.5 flex min-h-8 items-center justify-center gap-1 text-[9px] font-semibold text-slate-400 hover:text-slate-700"><ExternalLink size={11}/>Open student page</a></div>
    <div className="mt-5 grid grid-cols-3 gap-2"><MetricCard value={link.metrics.registered} label="Joined"/><MetricCard value={link.metrics.started} label="Started"/><MetricCard value={link.metrics.submitted} label="Submitted"/></div>
    <dl className="mt-5 divide-y divide-black/[0.055] rounded-xl border border-black/[0.06] bg-white px-3"><InfoRow label="Exam" value={`${link.examTitle} · Version ${link.versionNumber}`}/><InfoRow label="Audience" value={audienceText(link)}/><InfoRow label="Identification" value={link.accessMode === "student_code" ? "Student code required" : "Name + email"}/><InfoRow label="Availability" value={availabilityText(link)}/>{link.audienceType === "selected_students" ? <InfoRow label="Allowed students" value={`${link.selectedStudentCount}`}/> : null}</dl>
    <section className="mt-6"><div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold text-slate-700">Recent Activity</h3>{activityLoading ? <LoaderCircle size={12} className="animate-spin text-slate-400"/> : null}</div><div className="mt-2 rounded-xl border border-black/[0.06] bg-white">{activity.length ? activity.slice(0, 12).map((item, index) => <div key={`${item.kind}-${item.occurredAt}-${index}`} className="flex items-center gap-2 border-b border-black/[0.045] px-3 py-2.5 last:border-0"><ActivityIcon kind={item.kind}/><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-slate-700">{item.studentName}</p><p className="mt-0.5 text-[8px] text-slate-400">{activityVerb(item.kind)}</p></div><time className="text-[8px] tabular-nums text-slate-400">{formatCompactDateTime(new Date(item.occurredAt))}</time></div>) : <p className="px-3 py-5 text-center text-[9px] text-slate-400">No student activity yet.</p>}</div></section>
  </div>;
}

function EmptyLinks({ hasLinks, onCreate }: { hasLinks: boolean; onCreate: () => void }) { return <div className="flex min-h-[420px] items-center justify-center px-8 text-center"><div className="max-w-xs"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f7] text-slate-400"><Link2 size={20}/></div><h3 className="mt-4 text-[14px] font-semibold text-slate-800">{hasLinks ? "No matching links" : "No student access yet"}</h3><p className="mt-1 text-[10px] leading-5 text-slate-400">{hasLinks ? "Change the search or status filter." : "Create a link when you are ready to share this exam."}</p>{!hasLinks ? <button type="button" onClick={onCreate} className="mt-4 min-h-10 rounded-full bg-[#0071e3] px-4 text-[11px] font-semibold text-white hover:bg-[#0077ed]"><Plus size={12} className="mr-1 inline"/>New Student Link</button> : null}</div></div>; }
function StatusDot({ status, large = false }: { status: AccessLinkStatus; large?: boolean }) { const cls = status === "live" ? "bg-emerald-500" : status === "upcoming" ? "bg-amber-400" : status === "paused" ? "bg-slate-400" : status === "revoked" ? "bg-red-400" : "bg-slate-300"; return <span className={`${large ? "mt-2 h-3 w-3" : "mt-1 h-2.5 w-2.5"} shrink-0 rounded-full ${cls}`} aria-label={formatAccessLinkStatus(status)}/>; }
function audienceText(link: AssessmentAccessLink) { if (link.audienceType === "anyone") return "Anyone with link"; if (link.audienceType === "cohort") return link.audienceLabel ?? "Cohort"; return `${link.audienceLabel ?? "Selected students"} · ${link.selectedStudentCount} students`; }
function availabilityText(link: AssessmentAccessLink) { if (link.availabilityType === "anytime") return "Anytime while active"; if (!link.opensAt || !link.closesAt) return "Scheduled"; const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); return `${formatter.format(new Date(link.opensAt))} – ${formatter.format(new Date(link.closesAt))}`; }
function activityVerb(kind: string) { return kind === "joined" ? "Joined through this link" : kind === "started" ? "Started the exam" : kind === "submitted" ? "Submitted the exam" : kind; }
function ActivityIcon({ kind }: { kind: string }) { return <span className={`h-2 w-2 rounded-full ${kind === "submitted" ? "bg-emerald-500" : kind === "started" ? "bg-blue-500" : "bg-slate-300"}`}/>; }
function MetricCompact({ value, label }: { value: number; label: string }) { return <div><p className="text-[18px] font-semibold tabular-nums tracking-[-0.03em]">{value}</p><p className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{label}</p></div>; }
function MetricCard({ value, label }: { value: number; label: string }) { return <div className="rounded-xl border border-black/[0.06] bg-white p-3"><p className="text-xl font-semibold tabular-nums tracking-[-0.03em]">{value}</p><p className="mt-0.5 text-[8px] font-semibold text-slate-400">{label}</p></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex min-h-10 items-center gap-3 py-2"><dt className="w-24 shrink-0 text-[9px] font-medium text-slate-400">{label}</dt><dd className="min-w-0 flex-1 text-right text-[9px] font-semibold text-slate-600">{value}</dd></div>; }
function DetailAction({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button type="button" onClick={onClick} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-[#f5f5f7] text-[9px] font-semibold text-slate-600 hover:bg-slate-200/70">{icon}{children}</button>; }
function MenuAction({ icon, onClick, children, destructive = false, disabled = false }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode; destructive?: boolean; disabled?: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[10px] font-medium ${destructive ? "text-red-600 hover:bg-red-50" : "text-slate-600 hover:bg-slate-100"} disabled:opacity-35`}>{icon}{children}</button>; }

function ConfirmDialog({ open, title, description, confirmLabel, destructive, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) { return <AnimatePresence>{open ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[140] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"><motion.div role="alertdialog" aria-modal="true" initial={{ scale: 0.98, y: 6 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-sm rounded-[20px] border border-black/[0.08] bg-white p-5 shadow-2xl"><h2 className="text-[15px] font-semibold text-slate-950">{title}</h2><p className="mt-2 text-[11px] leading-5 text-slate-500">{description}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-10 rounded-xl px-4 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" onClick={onConfirm} className={`min-h-10 rounded-xl px-4 text-[11px] font-semibold text-white ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-[#0071e3]"}`}>{confirmLabel}</button></div></motion.div></motion.div> : null}</AnimatePresence>; }
function StudentLinksLoading({ onBack }: { onBack: () => void }) { return <div className="min-h-screen bg-[#f5f5f7] p-6"><button type="button" onClick={onBack} className="text-sm text-slate-500">← Release</button><div className="mx-auto mt-16 max-w-5xl"><div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200"/><div className="mt-6 h-[620px] animate-pulse rounded-[22px] bg-white"/></div></div>; }
function StudentLinksError({ error, onBack, onRetry }: { error: string; onBack: () => void; onRetry: () => Promise<unknown> }) { return <div className="min-h-screen bg-[#f5f5f7] p-6"><div className="mx-auto max-w-lg rounded-[20px] bg-white p-6"><h1 className="text-base font-semibold">Student Access could not load</h1><p className="mt-2 text-sm text-slate-500">{error}</p><div className="mt-5 flex gap-2"><button onClick={onBack} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600">Release</button><button onClick={() => void onRetry()} className="flex items-center gap-1 rounded-xl bg-[#0071e3] px-4 py-2 text-sm font-semibold text-white"><RefreshCw size={13}/>Retry</button></div></div></div>; }
function NoPublishedVersion({ onBack }: { onBack: () => void }) { return <div className="min-h-screen bg-[#f5f5f7] p-6"><div className="mx-auto mt-20 max-w-lg rounded-[22px] bg-white p-7 text-center"><Link2 size={28} className="mx-auto text-slate-300"/><h1 className="mt-4 text-lg font-semibold">Publish before creating Student Access</h1><p className="mt-2 text-sm text-slate-500">Student access always uses an immutable published release.</p><button type="button" onClick={onBack} className="mt-5 rounded-xl bg-[#0071e3] px-4 py-2.5 text-sm font-semibold text-white">Return to Release</button></div></div>; }
