import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Link2, Plus, RefreshCw, XCircle } from "lucide-react";
import type { ExamEntity } from "../../../../types/domain";
import {
  useAccessLinkActivity,
  useAccessLinkMembers,
  useCreateAccessLink,
  useDeleteAccessLink,
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
import { AccessLinkRow, rowElementId } from "./AccessLinkRow";
import { LinksToolbar, type StatusFilter } from "./LinksToolbar";
import { useTransientValue } from "./useTransientValue";
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
/**
 * Search echo budget: filtering this list is a linear scan of a handful of
 * rows, so a small workspace filters on the committed keystroke (the count and
 * the rows move together, immediately). Only a genuinely large link library
 * pays the 150ms debounce, where re-sorting on every keystroke is real work.
 */
const SEARCH_FAST_PATH_MAX = 150;
/**
 * A write in flight for one link. Derived from the mutation itself rather than
 * mirrored into state, so the pending look can never outlive the request.
 */
type PendingWrite = { linkId: string; label: string };
/**
 * Transient acknowledgement rendered where the action happened. `kind` lets the
 * detail pane reuse the copy confirmation without re-deriving it from copy text.
 */
type Confirmation = { linkId: string; kind: "copy" | "action"; text: string };

type LinkUpdateOptions = { silent?: boolean };

/** Present-tense label for an in-flight lifecycle write. */
function lifecyclePendingLabel(state: "active" | "paused" | "revoked"): string {
  if (state === "active") return "Resuming…";
  if (state === "paused") return "Pausing…";
  return "Revoking…";
}

function projectSharedAccessLink(
  fallback: AssessmentAccessLink,
  value: Record<string, unknown>,
): AssessmentAccessLink {
  const next = { ...fallback };
  if (typeof value["name"] === "string") next.name = value["name"];
  // The coedit room carries the toggle state as a scope (null = all sections),
  // so other tabs badge the live value instead of their last server read.
  if (value["enabledSections"] === null || Array.isArray(value["enabledSections"])) {
    next.enabledSections = value["enabledSections"] as string[] | null;
  }
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
  return /revision|stale|conflict|changed (?:elsewhere|while)|409/i.test(error.message);
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
  const [deletedLinkIds, setDeletedLinkIds] = useState<Set<string>>(() => new Set());
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
    for (const linkId of deletedLinkIds) byId.delete(linkId);
    return [...byId.values()];
  }, [deletedLinkIds, exam.id, sharedValues, sourceLinks, version?.id]);

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
  const [confirm, setConfirm] = useState<{ link: AssessmentAccessLink; action: "revoke" | "delete" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);
  const notifySuccess = useNotificationStore((state) => state.addSuccess);
  const searchTimer = useRef<number | null>(null);

  const createMutation = useCreateAccessLink(exam.id);
  const updateMutation = useUpdateAccessLink(exam.id);
  const lifecycleMutation = useSetAccessLinkLifecycle(exam.id);
  const deleteMutation = useDeleteAccessLink(exam.id);
  const duplicateMutation = useDuplicateAccessLink(exam.id);
  const membersQuery = useAccessLinkMembers(editingLink?.id ?? null);
  const { value: confirmation, show: showConfirmation } = useTransientValue<Confirmation>(1600);

  const pendingWrite = useMemo<PendingWrite | null>(() => {
    if (lifecycleMutation.isPending && lifecycleMutation.variables) {
      return {
        linkId: lifecycleMutation.variables.linkId,
        label: lifecyclePendingLabel(lifecycleMutation.variables.request.state),
      };
    }
    if (deleteMutation.isPending && deleteMutation.variables) {
      return { linkId: deleteMutation.variables.linkId, label: "Deleting permanently…" };
    }
    if (duplicateMutation.isPending && duplicateMutation.variables) {
      return { linkId: duplicateMutation.variables.linkId, label: "Duplicating…" };
    }
    if (updateMutation.isPending && updateMutation.variables) {
      return { linkId: updateMutation.variables.linkId, label: "Saving…" };
    }
    return null;
  }, [
    duplicateMutation.isPending,
    duplicateMutation.variables,
    deleteMutation.isPending,
    deleteMutation.variables,
    lifecycleMutation.isPending,
    lifecycleMutation.variables,
    updateMutation.isPending,
    updateMutation.variables,
  ]);

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

  // Small workspaces echo the keystroke immediately; a large library keeps the
  // debounced term so re-sorting stays off the typing path.
  const effectiveSearch = links.length <= SEARCH_FAST_PATH_MAX ? search : debouncedSearch;

  const visibleLinks = useMemo(() => {
    const query = effectiveSearch.trim().toLocaleLowerCase();
    return links
      .filter((link) => {
        if (statusFilter !== "all" && link.status !== statusFilter) return false;
        if (!query) return true;
        return [link.name, link.audienceLabel ?? "", link.examTitle, `version ${link.versionNumber}`]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status] || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [links, effectiveSearch, statusFilter]);

  const selectedLink = visibleLinks.find((link) => link.id === selectedId) ?? null;
  const activityQuery = useAccessLinkActivity(selectedLink?.id ?? null);

  useEffect(() => {
    if (selectedId && visibleLinks.some((link) => link.id === selectedId)) return;
    setSelectedId(visibleLinks[0]?.id ?? null);
  }, [selectedId, visibleLinks]);

  /**
   * Selecting a link always keeps it under the eye and (optionally) under the
   * focus ring: arrow-key navigation otherwise moves the right pane while the
   * selected row stays off-screen.
   */
  const selectLink = useCallback((linkId: string, options?: { focus?: boolean }) => {
    setSelectedId(linkId);
    // A freshly created/duplicated row does not exist yet in this commit: retry
    // once on the next frame rather than scrolling nothing.
    const reveal = (attempt: number) => {
      const element = document.getElementById(rowElementId(linkId));
      if (!element) {
        if (attempt === 0 && typeof window !== "undefined") window.requestAnimationFrame(() => reveal(1));
        return;
      }
      element.scrollIntoView?.({ block: "nearest" });
      if (options?.focus) element.focus();
    };
    reveal(0);
  }, []);

  const focusSelectedRow = useCallback(() => {
    if (selectedId) document.getElementById(rowElementId(selectedId))?.focus();
  }, [selectedId]);

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
        if (next) selectLink(next.id);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirm, editorOpen, presentLink, selectLink, selectedId, shareLink, visibleLinks]);

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
    selectLink(created.id);
    // The new row lands already confirmed: the page never relies on a global
    // channel to say the write was accepted.
    showConfirmation({ linkId: created.id, kind: "action", text: "Student Link created" });
    showToast("Student Link created");
  };
  const updateLink = async (linkId: string, request: UpdateAssessmentAccessLinkRequest, options?: LinkUpdateOptions) => {
    const updated = await updateMutation.mutateAsync({ linkId, request });
    collaboration?.setValue(`access/${linkId}`, updated);
    announceWorkspaceCommand("access.updated", { linkId });
    selectLink(updated.id);
    if (!options?.silent) {
      showConfirmation({ linkId: updated.id, kind: "action", text: "Changes saved" });
      showToast("Student Link updated");
    }
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
      showConfirmation({
        linkId: link.id,
        kind: "action",
        text: state === "active" ? "Resumed" : state === "paused" ? "Paused" : "Revoked",
      });
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
  const deleteLink = async (link: AssessmentAccessLink): Promise<boolean> => {
    setActionError(null);
    setStaleConflict(false);
    try {
      await deleteMutation.mutateAsync({ linkId: link.id, request: { revision: link.revision } });
      setDeletedLinkIds((current) => new Set(current).add(link.id));
      collaboration?.setValue(`access/${link.id}`, undefined);
      announceWorkspaceCommand("access.deleted", { linkId: link.id });
      setEditingLink((current) => current?.id === link.id ? null : current);
      setShareLink((current) => current?.id === link.id ? null : current);
      setPresentLink((current) => current?.id === link.id ? null : current);
      showToast("Student Link deleted permanently");
      return true;
    } catch (err) {
      reportActionError(
        isRevisionConflict(err)
          ? "This link changed elsewhere. Refresh the link list before trying again."
          : "Student Link could not be deleted.",
        { action: "delete", linkId: link.id },
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
      selectLink(created.id);
      showConfirmation({
        linkId: created.id,
        kind: "action",
        text: releaseTarget === "current" ? `Created for Version ${version?.versionNumber ?? "current"}` : "Student Link duplicated",
      });
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
      // Confirmed at the control that was pressed (row or detail), not in a
      // channel the operator has to go looking for.
      showConfirmation({ linkId: link.id, kind: "copy", text: "Link copied" });
    } catch (err) {
      reportActionError("Link could not be copied. Clipboard is unavailable.", { action: "copy", linkId: link.id }, err);
    }
  }, [reportActionError, showConfirmation]);

  const openEditor = useCallback((link: AssessmentAccessLink | null) => {
    setEditingLink(link);
    setEditorOpen(true);
  }, []);

  // While one write is in flight the menu closes behind it; the row keeps the
  // acknowledgement, so the actions stay visible but cannot be re-fired.
  const menuItemsFor = useCallback((link: AssessmentAccessLink, busy = false): SatMenuItem[] => [
    { id: "copy", label: "Copy link", disabled: busy, onSelect: () => { void copy(link); } },
    { id: "share", label: "Share", disabled: busy, onSelect: () => setShareLink(link) },
    { id: "present", label: "Present to Students", disabled: busy, onSelect: () => setPresentLink(link) },
    { id: "edit", label: "Edit Link", disabled: busy, onSelect: () => openEditor(link) },
    { id: "duplicate", label: "Duplicate Link", disabled: busy, onSelect: () => { void duplicate(link); } },
    ...(link.lifecycleState !== "revoked"
      ? [{ id: "pause", label: link.lifecycleState === "paused" ? "Resume Link" : "Pause Link", disabled: busy, onSelect: () => { void setLifecycle(link, link.lifecycleState === "paused" ? "active" : "paused"); } } as SatMenuItem]
      : []),
    { id: "revoke", label: "Revoke Link", onSelect: () => setConfirm({ link, action: "revoke" }), destructive: true, separatorBefore: true, disabled: busy || link.lifecycleState === "revoked" },
    { id: "delete", label: "Delete permanently", onSelect: () => setConfirm({ link, action: "delete" }), destructive: true, disabled: busy, separatorBefore: true },
  ], [copy, deleteMutation.isPending, duplicate, openEditor, setLifecycle]);

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
              <button type="button" onClick={onBackToRelease} className="sat-press sat-press-fill flex min-h-11 items-center rounded-[12px] px-4 text-[13px] font-semibold text-slate-600 hover:bg-black/[0.04]">Release</button>
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
          <button type="button" onClick={onBackToRelease} className="sat-press sat-press-fill flex min-h-11 items-center gap-1.5 rounded-[12px] px-2.5 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"><ArrowLeft size={15} aria-hidden="true" />Release</button>
          <div className="h-5 w-px bg-black/[0.08]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold tracking-[-0.01em]">{exam.title}</p>
            <p className="truncate text-[11px] font-medium text-slate-500">Student Access · Version {version.versionNumber} · {version.publishScope === "full" ? "Full SAT" : `${version.publishScope === "math" ? "Math" : "Reading & Writing"} only`}</p>
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
        {/* One polite region for in-place confirmations: the visual copy lives
            at the control, and screen readers hear it once. */}
        <p role="status" aria-live="polite" className="sr-only">{confirmation?.text ?? ""}</p>
        {actionError ? (
          <div role="alert" className="sat-banner-enter mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-700/20 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            <span>{actionError}</span>
            <span className="flex shrink-0 items-center gap-1">
              {staleConflict ? (
                <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); void onRefresh(); }} className="sat-press sat-press-fill flex min-h-11 items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-semibold hover:bg-red-100"><RefreshCw size={13} aria-hidden="true" />Refresh</button>
              ) : null}
              <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); }} aria-label="Dismiss error" className="sat-press sat-press-fill flex h-11 w-11 items-center justify-center rounded-[10px] hover:bg-red-100"><XCircle size={15} aria-hidden="true" /></button>
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
                      onSelect={() => selectLink(link.id)}
                      menuItems={menuItemsFor(link, pendingWrite?.linkId === link.id)}
                      resultIndex={index}
                      busy={pendingWrite?.linkId === link.id}
                      pendingLabel={pendingWrite?.linkId === link.id ? pendingWrite.label : null}
                      confirmation={confirmation?.linkId === link.id ? confirmation.text : null}
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
                copyConfirmed={confirmation?.linkId === selectedLink.id && confirmation.kind === "copy"}
                onEscapeToRow={focusSelectedRow}
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

      <AccessLinkEditorSheet open={editorOpen} link={editingLink} providerKey={exam.providerKey ?? null} publishScope={version?.publishScope ?? "full"} members={(membersQuery.data ?? []) as AccessLinkMemberInput[]} isSaving={saving} onClose={() => { if (!saving) { setEditorOpen(false); setEditingLink(null); } }} onCreate={createLink} onUpdate={updateLink} />
      <AccessLinkShareSheet open={Boolean(shareLink)} link={shareLink} onClose={() => setShareLink(null)} onPresent={() => { setPresentLink(shareLink); setShareLink(null); }} />
      <AccessLinkPresentView open={Boolean(presentLink)} link={presentLink} onClose={() => setPresentLink(null)} />
      <AuthoringConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === "delete" ? "Delete this Student Link permanently?" : "Revoke this Student Link?"}
        description={confirm?.action === "delete"
          ? "This URL will no longer let students enter. Schedules, exam attempts, scores, and exam history will be preserved. Deletion cannot be undone."
          : "Students who have not entered yet will permanently lose access through this link. Existing exam attempts are not deleted. Revocation cannot be undone."}
        confirmLabel={confirm?.action === "delete" ? "Delete permanently" : "Revoke Link"}
        destructive
        busy={confirm?.action === "delete" ? deleteMutation.isPending : lifecycleMutation.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const target = confirm?.link;
          if (!target) return;
          void (confirm.action === "delete" ? deleteLink(target) : setLifecycle(target, "revoked")).then((success) => {
            if (success) setConfirm(null);
            else if (confirm.action === "delete") setConfirm(null);
          });
        }}
      />
    </div>
  );
}
