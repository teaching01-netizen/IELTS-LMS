import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Link2, Plus, RefreshCw, XCircle } from "lucide-react";
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
import { logError, useNotificationStore } from "../../infrastructure/authoringUiGateway";
import { AccessLinkEditorSheet } from "./AccessLinkEditorSheet";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import type { SatMenuItem } from "../../../../products/sat/ui/Menu";
import { AccessLinkPresentView, AccessLinkShareSheet } from "./AccessLinkShareSheet";
import { AccessLinkDetail } from "./AccessLinkDetail";
import { AccessLinkRow } from "./AccessLinkRow";
import { LinksToolbar, type StatusFilter } from "./LinksToolbar";
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListSkeleton,
  SatPageHeader,
  SatPrimaryButton,
} from "../../../../products/sat/ui/SatPage";
import { copyText, studentJoinUrl } from "./accessLinkUi";
import { CollaborationHeaderCluster } from "../collaboration/CollaborationHeaderCluster";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";

interface StudentLinksDashboardProps {
  exam: ExamEntity;
  overview: AccessDistributionOverview | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  onBackToRelease: () => void;
}

const EMPTY_ACCESS_LINKS: AssessmentAccessLink[] = [];
const STATUS_RANK: Record<AccessLinkStatus, number> = { live: 0, upcoming: 1, paused: 2, ended: 3, revoked: 4 };

type LinkUpdateOptions = { silent?: boolean };

function projectSharedAccessLink(
  fallback: AssessmentAccessLink,
  value: Record<string, unknown>,
): AssessmentAccessLink {
  const next = { ...fallback };
  if (typeof value["name"] === "string") next.name = value["name"];
  if (value["audienceType"] === "anyone" || value["audienceType"] === "cohort" || value["audienceType"] === "selected_students") next.audienceType = value["audienceType"];
  if (typeof value["audienceLabel"] === "string" || value["audienceLabel"] === null) next.audienceLabel = value["audienceLabel"];
  if (value["accessMode"] === "student_code" || value["accessMode"] === "open") next.accessMode = value["accessMode"];
  if (value["availabilityType"] === "scheduled" || value["availabilityType"] === "anytime") next.availabilityType = value["availabilityType"];
  if (typeof value["opensAt"] === "string" || value["opensAt"] === null) next.opensAt = value["opensAt"];
  if (typeof value["closesAt"] === "string" || value["closesAt"] === null) next.closesAt = value["closesAt"];
  if (value["lifecycleState"] === "active" || value["lifecycleState"] === "paused" || value["lifecycleState"] === "revoked") next.lifecycleState = value["lifecycleState"];
  if (value["status"] === "live" || value["status"] === "upcoming" || value["status"] === "ended" || value["status"] === "paused" || value["status"] === "revoked") next.status = value["status"];
  if (typeof value["revision"] === "number") next.revision = value["revision"];
  if (typeof value["updatedAt"] === "string") next.updatedAt = value["updatedAt"];
  return next;
}

function isSharedAccessLinkCandidate(value: Record<string, unknown>): value is Record<string, unknown> & Pick<AssessmentAccessLink, "id" | "name" | "examId" | "revision"> {
  return typeof value["id"] === "string" && typeof value["name"] === "string" && typeof value["examId"] === "string" && typeof value["revision"] === "number";
}

function isRevisionConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /revision|stale|conflict|changed elsewhere|409/i.test(error.message);
}

export function StudentLinksDashboard({ exam, overview, isLoading, error, onRefresh, onBackToRelease }: StudentLinksDashboardProps) {
  const version = overview?.currentPublishedVersion ?? null;
  const collaboration = useSatAuthoringCollaboration();
  const announceWorkspaceCommand = useCallback(
    (command: Parameters<NonNullable<typeof collaboration>["publishCommand"]>[0], payload: Record<string, unknown>) => {
      collaboration?.publishCommand(command, payload);
    },
    [collaboration],
  );
  const sourceLinks = overview?.links ?? EMPTY_ACCESS_LINKS;
  const sharedValues = collaboration?.workspaceSnapshot.values;
  const links = useMemo(() => {
    const byId = new Map(sourceLinks.map((link) => [link.id, link]));
    for (const [path, raw] of Object.entries(sharedValues ?? {})) {
      if (!path.startsWith("access/") || path === "access/index" || raw === null || typeof raw !== "object") continue;
      const candidate = raw as Record<string, unknown>;
      if (!isSharedAccessLinkCandidate(candidate)) continue;
      const fallback = byId.get(candidate.id);
      if (fallback) {
        byId.set(candidate.id, projectSharedAccessLink(fallback, candidate));
      } else if (candidate["publishedVersionId"] === version?.id || candidate["examId"] === exam.id) {
        // A newly created link is broadcast before the overview query has
        // returned it. It is safe to show only a complete link-shaped payload;
        // malformed room values stay invisible at this UI boundary.
        byId.set(candidate.id, candidate as unknown as AssessmentAccessLink);
      }
    }
    return [...byId.values()];
  }, [exam.id, sharedValues, sourceLinks, version?.id]);

  // Link rows are seeded through the room's arbiter like every other shared
  // value: the overview query only proposes the first copy, and the readiness
  // barrier (initial sync plus the IndexedDB replay) keeps that proposal from
  // racing the replayed local cache.
  useEffect(() => {
    if (!collaboration?.workspaceSnapshot.ready || !collaboration.workspaceSnapshot.localReady) return;
    for (const link of sourceLinks) collaboration.seedValue(`access/${link.id}`, link);
  }, [
    collaboration,
    collaboration?.workspaceSnapshot.localReady,
    collaboration?.workspaceSnapshot.ready,
    sourceLinks,
  ]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AssessmentAccessLink | null>(null);
  const [shareLink, setShareLink] = useState<AssessmentAccessLink | null>(null);
  const [presentLink, setPresentLink] = useState<AssessmentAccessLink | null>(null);
  const [confirm, setConfirm] = useState<{ link: AssessmentAccessLink; action: "revoke" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);
  const notifySuccess = useNotificationStore((state) => state.addSuccess);
  const searchTimer = useRef<number | null>(null);

  const createMutation = useCreateAccessLink(exam.id);
  const updateMutation = useUpdateAccessLink(exam.id);
  const lifecycleMutation = useSetAccessLinkLifecycle(exam.id);
  const duplicateMutation = useDuplicateAccessLink(exam.id);
  const membersQuery = useAccessLinkMembers(editingLink?.id ?? null);

  useEffect(() => {
    if (!editingLink) return;
    const live = links.find((link) => link.id === editingLink.id);
    if (live && live.revision !== editingLink.revision) setEditingLink(live);
  }, [editingLink, links]);

  useEffect(() => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setDebouncedSearch(search), 150);
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, [search]);

  const counts = useMemo(() => {
    const result: Record<AccessLinkStatus, number> = { live: 0, upcoming: 0, ended: 0, paused: 0, revoked: 0 };
    for (const link of links) result[link.status] += 1;
    return result;
  }, [links]);

  const visibleLinks = useMemo(() => {
    const query = debouncedSearch.trim().toLocaleLowerCase();
    return links
      .filter((link) => {
        if (statusFilter !== "all" && link.status !== statusFilter) return false;
        if (!query) return true;
        return [link.name, link.audienceLabel ?? "", link.examTitle, `version ${link.versionNumber}`]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status] || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [links, debouncedSearch, statusFilter]);

  const selectedLink = visibleLinks.find((link) => link.id === selectedId) ?? null;
  const activityQuery = useAccessLinkActivity(selectedLink?.id ?? null);

  useEffect(() => {
    if (selectedId && visibleLinks.some((link) => link.id === selectedId)) return;
    setSelectedId(visibleLinks[0]?.id ?? null);
  }, [selectedId, visibleLinks]);

  // Global "/" focuses search; list arrows move selection. Skipped inside inputs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inField = target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !inField && !editorOpen && !shareLink && !presentLink && !confirm) {
        event.preventDefault();
        document.getElementById("student-links-search")?.focus();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !inField && visibleLinks.length > 1) {
        const index = visibleLinks.findIndex((link) => link.id === selectedId);
        if (index < 0) return;
        event.preventDefault();
        const next = visibleLinks[(index + (event.key === "ArrowDown" ? 1 : -1) + visibleLinks.length) % visibleLinks.length];
        if (next) setSelectedId(next.id);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirm, editorOpen, presentLink, selectedId, shareLink, visibleLinks]);

  const showToast = useCallback((message: string) => {
    notifySuccess(message);
  }, [notifySuccess]);

  const reportActionError = useCallback((message: string, context: Record<string, unknown>, err: unknown) => {
    setActionError(message);
    setStaleConflict(isRevisionConflict(err));
    logError(err, { feature: "student-access", ...context });
  }, []);

  const createLink = async (request: CreateAssessmentAccessLinkRequest) => {
    const created = await createMutation.mutateAsync(request);
    collaboration?.setValue(`access/${created.id}`, created);
    announceWorkspaceCommand("access.created", { linkId: created.id });
    setSelectedId(created.id);
    showToast("Student Link created");
  };
  const updateLink = async (linkId: string, request: UpdateAssessmentAccessLinkRequest, options?: LinkUpdateOptions) => {
    const updated = await updateMutation.mutateAsync({ linkId, request });
    collaboration?.setValue(`access/${linkId}`, updated);
    announceWorkspaceCommand("access.updated", { linkId });
    setSelectedId(updated.id);
    if (!options?.silent) showToast("Student Link updated");
  };
  const setLifecycle = async (
    link: AssessmentAccessLink,
    state: "active" | "paused" | "revoked",
  ): Promise<boolean> => {
    setActionError(null);
    setStaleConflict(false);
    try {
      const updated = await lifecycleMutation.mutateAsync({ linkId: link.id, request: { revision: link.revision, state } });
      collaboration?.setValues({
        [`access/${link.id}`]: {
          ...updated,
          lifecycleState: state,
          status: state === "active" ? "live" : state,
        },
      });
      announceWorkspaceCommand("access.lifecycle_changed", { linkId: link.id, state });
      showToast(state === "active" ? "Student Link resumed" : state === "paused" ? "Student Link paused" : "Student Link revoked");
      return true;
    } catch (err) {
      reportActionError(
        isRevisionConflict(err)
          ? "This link changed elsewhere. Refresh and retry."
          : "Student Link could not be changed.",
        { action: "set-lifecycle", linkId: link.id, state },
        err,
      );
      return false;
    }
  };
  const duplicate = async (link: AssessmentAccessLink, releaseTarget: "source" | "current" = "source") => {
    setActionError(null);
    setStaleConflict(false);
    const request: DuplicateAssessmentAccessLinkRequest = releaseTarget === "current"
      ? { revision: link.revision, name: link.name, releaseTarget: "current" }
      : { revision: link.revision, name: `${link.name} Copy`, releaseTarget: "source" };
    try {
      const created = await duplicateMutation.mutateAsync({ linkId: link.id, request });
      collaboration?.setValue(`access/${created.id}`, created);
      announceWorkspaceCommand("access.duplicated", { linkId: created.id, sourceLinkId: link.id });
      setSelectedId(created.id);
      showToast(releaseTarget === "current" ? `Created for Version ${version?.versionNumber ?? "current"}` : "Student Link duplicated");
    } catch (err) {
      reportActionError(
        isRevisionConflict(err)
          ? "This link changed elsewhere. Refresh and retry."
          : "Student Link could not be duplicated.",
        { action: "duplicate", linkId: link.id, releaseTarget },
        err,
      );
    }
  };
  const copy = useCallback(async (link: AssessmentAccessLink) => {
    try {
      await copyText(studentJoinUrl(link.id));
      showToast("Link copied");
    } catch (err) {
      reportActionError("Link could not be copied. Clipboard is unavailable.", { action: "copy", linkId: link.id }, err);
    }
  }, [reportActionError, showToast]);

  const openEditor = useCallback((link: AssessmentAccessLink | null) => {
    setEditingLink(link);
    setEditorOpen(true);
  }, []);

  const menuItemsFor = useCallback((link: AssessmentAccessLink): SatMenuItem[] => [
    { id: "copy", label: "Copy link", onSelect: () => { void copy(link); } },
    { id: "share", label: "Share", onSelect: () => setShareLink(link) },
    { id: "present", label: "Present to Students", onSelect: () => setPresentLink(link) },
    { id: "edit", label: "Edit Link", onSelect: () => openEditor(link) },
    { id: "duplicate", label: "Duplicate Link", onSelect: () => { void duplicate(link); } },
    ...(link.lifecycleState !== "revoked"
      ? [{ id: "pause", label: link.lifecycleState === "paused" ? "Resume Link" : "Pause Link", onSelect: () => { void setLifecycle(link, link.lifecycleState === "paused" ? "active" : "paused"); } } as SatMenuItem]
      : []),
    { id: "revoke", label: "Revoke Link", onSelect: () => setConfirm({ link, action: "revoke" }), destructive: true, separatorBefore: true, disabled: link.lifecycleState === "revoked" },
  ], [copy, duplicate, openEditor, setLifecycle]);

  if (isLoading) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        <SatContainer>
          <SatPageHeader eyebrow="Digital SAT · Release" title="Student Access" description="Share this exam with students." />
          <SatListSkeleton rows={3} label="Loading Student Access" />
        </SatContainer>
      </div>
    );
  }
  if (error) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        <SatContainer>
          <div role="alert" className="mt-8 rounded-2xl border border-black/[0.06] bg-white p-6">
            <h1 className="text-[16px] font-semibold text-slate-900">Student Access could not load</h1>
            <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={onBackToRelease} className="flex min-h-11 items-center rounded-[12px] px-4 text-[13px] font-semibold text-slate-600 hover:bg-black/[0.04]">Release</button>
              <SatPrimaryButton onClick={() => { void onRefresh(); }} icon={<RefreshCw size={14} aria-hidden="true" />}>Retry</SatPrimaryButton>
            </div>
          </div>
        </SatContainer>
      </div>
    );
  }
  if (!version) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        <SatContainer>
          <SatEmptyState
            icon={<Link2 size={20} aria-hidden="true" />}
            title="Publish before creating Student Access"
            hint="Student access always uses an immutable published release."
            action={<SatPrimaryButton onClick={onBackToRelease}>Return to Release</SatPrimaryButton>}
          />
        </SatContainer>
      </div>
    );
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="sat-product min-h-screen bg-au-fill text-slate-950">
      <header className="sticky top-0 z-40 border-b border-black/[0.07] authoring-glass">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1180px] items-center gap-3 px-4 sm:px-6 lg:px-10">
          <button type="button" onClick={onBackToRelease} className="flex min-h-11 items-center gap-1.5 rounded-[12px] px-2.5 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"><ArrowLeft size={15} aria-hidden="true" />Release</button>
          <div className="h-5 w-px bg-black/[0.08]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold tracking-[-0.01em]">{exam.title}</p>
            <p className="truncate text-[11px] font-medium text-slate-500">Student Access · Version {version.versionNumber} is published</p>
          </div>
          <CollaborationHeaderCluster surface="access" />
          <SatPrimaryButton onClick={() => openEditor(null)} icon={<Plus size={14} aria-hidden="true" />} ariaLabel="New Student Link">New Student Link</SatPrimaryButton>
        </div>
      </header>

      <SatContainer>
        <SatPageHeader
          eyebrow="Digital SAT · Release"
          title="Student Access"
          description="Share this exam with students. Existing links stay on the release they were created for."
        />
        {actionError ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-700/20 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            <span>{actionError}</span>
            <span className="flex shrink-0 items-center gap-1">
              {staleConflict ? (
                <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); void onRefresh(); }} className="flex min-h-11 items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-semibold hover:bg-red-100"><RefreshCw size={13} aria-hidden="true" />Refresh</button>
              ) : null}
              <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); }} aria-label="Dismiss error" className="flex h-11 w-11 items-center justify-center rounded-[10px] hover:bg-red-100"><XCircle size={15} aria-hidden="true" /></button>
            </span>
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section aria-label="Student Links" className="flex min-w-0 flex-col border-black/[0.06] max-lg:border-b lg:border-r">
            <LinksToolbar
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              counts={counts}
              total={links.length}
              resultCount={visibleLinks.length}
            />
            <div className="p-2 sm:p-3">
              {visibleLinks.length ? (
                <SatList>
                  {visibleLinks.map((link, index) => (
                    <AccessLinkRow
                      key={link.id}
                      link={link}
                      selected={selectedId === link.id}
                      isStaleRelease={link.publishedVersionId !== version.id}
                      onSelect={() => setSelectedId(link.id)}
                      menuItems={menuItemsFor(link)}
                      resultIndex={index}
                    />
                  ))}
                </SatList>
              ) : links.length > 0 ? (
                <SatEmptyState
                  icon={<Link2 size={20} aria-hidden="true" />}
                  title="No matching links"
                  hint="Change the search or status filter."
                />
              ) : (
                <SatEmptyState
                  icon={<Link2 size={20} aria-hidden="true" />}
                  title="No student access yet"
                  hint="Create a link when you are ready to share this exam. Links stay pinned to the release they were created for."
                  action={<SatPrimaryButton onClick={() => openEditor(null)} icon={<Plus size={14} aria-hidden="true" />} ariaLabel="New Student Link">New Student Link</SatPrimaryButton>}
                />
              )}
            </div>
          </section>
          <section aria-label="Link details" className="min-w-0 bg-au-fill max-lg:min-h-[420px]">
            {selectedLink ? (
              <AccessLinkDetail
                link={selectedLink}
                isStaleRelease={selectedLink.publishedVersionId !== version.id}
                currentVersionNumber={version.versionNumber}
                url={studentJoinUrl(selectedLink.id)}
                activity={activityQuery.data ?? []}
                activityLoading={activityQuery.isLoading}
                activityError={activityQuery.error instanceof Error ? activityQuery.error.message : null}
                onRetryActivity={() => { void activityQuery.refetch(); }}
                onCopy={() => { void copy(selectedLink); }}
                onShare={() => setShareLink(selectedLink)}
                onEdit={() => openEditor(selectedLink)}
                onPresent={() => setPresentLink(selectedLink)}
                onCreateForCurrent={() => { void duplicate(selectedLink, "current"); }}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Link2 size={28} className="mx-auto text-slate-300" aria-hidden="true" />
                  <p className="mt-3 text-[13px] font-semibold text-slate-700">Select a Student Link</p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-500">Details, activity, sharing, and lifecycle controls appear here.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </SatContainer>

      <AccessLinkEditorSheet open={editorOpen} link={editingLink} members={(membersQuery.data ?? []) as AccessLinkMemberInput[]} isSaving={saving} onClose={() => { if (!saving) { setEditorOpen(false); setEditingLink(null); } }} onCreate={createLink} onUpdate={updateLink} />
      <AccessLinkShareSheet open={Boolean(shareLink)} link={shareLink} onClose={() => setShareLink(null)} onPresent={() => { setPresentLink(shareLink); setShareLink(null); }} />
      <AccessLinkPresentView open={Boolean(presentLink)} link={presentLink} onClose={() => setPresentLink(null)} />
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
    </div>
  );
}
