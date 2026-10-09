import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, RefreshCw, XCircle } from "lucide-react";
import type { ExamEntity } from "../../../../types/domain";
import {
  useAccessLinkActivity,
  useAccessLinkMembers,
  useCreateAccessLink,
  useDeleteAccessLink,
  useSetAccessLinkLifecycle,
  useUpdateAccessLink,
} from "../../api/assessmentAccessLinkQueries";
import type {
  AccessDistributionOverview,
  AccessLinkMemberInput,
  AccessLinkStatus,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
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
import { ExamWorkspaceHeader, type ExamShellNavigation } from "../shell/ExamWorkspaceHeader";
import { DeliverySetupGuide } from "../delivery/DeliverySetupGuide";
import { SESSION_PHASE_LABEL, type AccessSessionBindings, type AccessSessionInfo } from "../delivery/sessionState";
import type { SatPublishScope } from "../../contracts/assessment";
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
  /** Navigation + lifecycle for the shared exam header, supplied by the route. */
  shell: ExamShellNavigation;
  /**
   * Opens the create form immediately when `id` changes (the publish sheet's
   * "Configure student access"). `versionId` pins the new group to the exact
   * version that was just published, even if someone publishes again meanwhile.
   */
  createRequest?: CreateRequest | null;
  selectedLinkId?: string | null;
  onSelectionChange?: (linkId: string | null) => void;
  /** Session status and actions per access group; omit to show configuration only. */
  session?: AccessSessionBindings;
}

export interface CreateRequest {
  id: number;
  versionId?: string;
  versionNumber?: number;
  publishScope?: SatPublishScope;
}

const EMPTY_ACCESS_LINKS: AssessmentAccessLink[] = [];
const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];
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

/** "Exam: Running" for the row; null while the status is unknown so a guess is never shown. */
function sessionRowLabel(info: AccessSessionInfo | null): string | null {
  return info && info.phase !== "unknown" ? `Exam: ${SESSION_PHASE_LABEL[info.phase]}` : null;
}

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

export function StudentLinksDashboard({ exam, overview, isLoading, error, onRefresh, onBackToRelease, shell, createRequest = null, session, selectedLinkId = null, onSelectionChange }: StudentLinksDashboardProps) {
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
  const [selectedId, setSelectedId] = useState<string | null>(selectedLinkId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AssessmentAccessLink | null>(null);
  const [prefillLink, setPrefillLink] = useState<AssessmentAccessLink | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateRequest | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
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
  const membersQuery = useAccessLinkMembers((editingLink ?? prefillLink)?.id ?? null);
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
    if (updateMutation.isPending && updateMutation.variables) {
      return { linkId: updateMutation.variables.linkId, label: "Saving…" };
    }
    return null;
  }, [
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

  useEffect(() => { setSelectedId(selectedLinkId); }, [selectedLinkId]);

  const selectedLink = visibleLinks.find((link) => link.id === selectedId) ?? null;
  const activityQuery = useAccessLinkActivity(selectedLink?.id ?? null);

  useEffect(() => {
    if (selectedId && visibleLinks.some((link) => link.id === selectedId)) return;
    if (isLoading || error) return;
    const nextId = visibleLinks[0]?.id ?? null;
    setSelectedId(nextId);
    if (nextId !== selectedLinkId) onSelectionChange?.(nextId);
  }, [selectedId, visibleLinks, isLoading, error, selectedLinkId, onSelectionChange]);

  /**
   * Selecting a link always keeps it under the eye and (optionally) under the
   * focus ring: arrow-key navigation otherwise moves the right pane while the
   * selected row stays off-screen.
   */
  const selectLink = useCallback((linkId: string, options?: { focus?: boolean }) => {
    setSelectedId(linkId);
    onSelectionChange?.(linkId);
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
  }, [onSelectionChange]);

  const focusSelectedRow = useCallback(() => {
    if (selectedId) document.getElementById(rowElementId(selectedId))?.focus();
  }, [selectedId]);

  // Global "/" focuses search; list arrows move selection. Skipped inside inputs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || !(target instanceof HTMLElement) || target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const inField = target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "/" && !inField && !editorOpen && !shareLink && !presentLink && !confirm) {
        event.preventDefault();
        document.getElementById("student-links-search")?.focus();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !inField && target.closest('[aria-label="Rooms"]') && visibleLinks.length > 1) {
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
    // A group created from the publish flow is pinned to the exact version that was
    // just published; any other creation follows the current release as before.
    const pinned = createTarget?.versionId ? { publishedVersionId: createTarget.versionId } : {};
    const created = await createMutation.mutateAsync({ ...request, ...pinned });
    setJustCreatedId(created.id);
    setCreateTarget(null);
    setPrefillLink(null);
    collaboration?.setValue(`access/${created.id}`, created);
    announceWorkspaceCommand("access.created", { linkId: created.id });
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    selectLink(created.id);
    // The new row lands already confirmed: the page never relies on a global
    // channel to say the write was accepted.
    showConfirmation({ linkId: created.id, kind: "action", text: "Room created" });
    showToast("Room created");
    // The session is the object staff work with next: take runners straight to its waiting room.
    // Staff who cannot run sessions stay here, where the new row is selected and shareable.
    if (session?.canRun) session.onOpenRoom(created.scheduleId);
  };
  const updateLink = async (linkId: string, request: UpdateAssessmentAccessLinkRequest, options?: LinkUpdateOptions) => {
    const updated = await updateMutation.mutateAsync({ linkId, request });
    collaboration?.setValue(`access/${linkId}`, updated);
    announceWorkspaceCommand("access.updated", { linkId });
    selectLink(updated.id);
    if (!options?.silent) {
      showConfirmation({ linkId: updated.id, kind: "action", text: "Changes saved" });
      showToast("Room updated");
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
        },
      });
      announceWorkspaceCommand("access.lifecycle_changed", { linkId: link.id, state });
      showConfirmation({
        linkId: link.id,
        kind: "action",
        text: state === "active" ? "Resumed" : state === "paused" ? "Paused" : "Revoked",
      });
      showToast(state === "active" ? "Check-in resumed" : state === "paused" ? "Check-in paused" : "Student link revoked");
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
    setPrefillLink(null);
    setCreateTarget(!link && version ? { id: Date.now(), versionId: version.id, versionNumber: version.versionNumber, publishScope: version.publishScope } : null);
    setEditorOpen(true);
  }, [version]);

  const openDuplicateSetup = useCallback((link: AssessmentAccessLink, target?: CreateRequest) => {
    setEditingLink(null);
    setPrefillLink(link);
    setCreateTarget(target ?? (version ? { id: Date.now(), versionId: version.id, versionNumber: version.versionNumber, publishScope: version.publishScope } : null));
    setEditorOpen(true);
  }, [version]);

  // The publish sheet asks for the create form with a request id; each new id opens it once.
  const handledCreateRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!createRequest || handledCreateRequest.current === createRequest.id) return;
    if (!version || isLoading || error) return;
    handledCreateRequest.current = createRequest.id;
    const target = createRequest.versionId ? createRequest : { ...createRequest, versionId: version.id, versionNumber: version.versionNumber, publishScope: version.publishScope };
    setCreateTarget(target);
    setEditingLink(null);
    setPrefillLink(null);
    setEditorOpen(true);
  }, [createRequest, version, isLoading, error]);

  // While one write is in flight the menu closes behind it; the row keeps the
  // acknowledgement, so the actions stay visible but cannot be re-fired.
  const menuItemsFor = (link: AssessmentAccessLink, busy = false): SatMenuItem[] => [
    { id: "copy", label: "Copy student link", disabled: busy, onSelect: () => { void copy(link); } },
    { id: "share", label: "Share", disabled: busy, onSelect: () => setShareLink(link) },
    { id: "present", label: "Present to Students", disabled: busy, onSelect: () => setPresentLink(link) },
    { id: "edit", label: "Edit room", disabled: busy, onSelect: () => openEditor(link) },
    { id: "duplicate", label: "Duplicate setup", disabled: busy, onSelect: () => openDuplicateSetup(link) },
    ...(link.lifecycleState !== "revoked"
      ? [{ id: "pause", label: link.lifecycleState === "paused" ? "Resume check-in" : "Pause check-in", disabled: busy, onSelect: () => { void setLifecycle(link, link.lifecycleState === "paused" ? "active" : "paused"); } } as SatMenuItem]
      : []),
    { id: "revoke", label: "Revoke student link", onSelect: () => setConfirm({ link, action: "revoke" }), destructive: true, separatorBefore: true, disabled: busy || link.lifecycleState === "revoked" },
    { id: "delete", label: "Delete permanently", onSelect: () => setConfirm({ link, action: "delete" }), destructive: true, disabled: busy, separatorBefore: true },
  ];

  const workspaceHeader = (
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={shell.lifecycle}
        activeTab="delivery"
        showResponses={shell.showResponses}
        onSelectTab={shell.onSelectTab}
        onBack={shell.onBack}
        contextLine={version ? `Current release · Version ${version.versionNumber} · ${version.publishScope === "full" ? "Full SAT" : version.publishScope === "math" ? "Math only" : "Reading & Writing only"}` : "Publish an exam version to create rooms"}
        collaborationSlot={<CollaborationHeaderCluster surface="access" />}
        onPreview={shell.onPreview}
        {...(shell.onPublish ? { onPublish: shell.onPublish } : {})}
        {...(shell.onQuickSettings ? { onQuickSettings: shell.onQuickSettings } : {})}
        {...(version ? { onCreateSession: () => openEditor(null) } : {})}
      />
  );

  if (isLoading) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        {workspaceHeader}
        <SatContainer>
          <SatPageHeader eyebrow="Digital SAT" title="Rooms" description="Prepare, share and run sittings of this exam." />
          <SatListSkeleton rows={3} label="Loading Rooms" />
        </SatContainer>
      </div>
    );
  }
  if (error && !overview) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        {workspaceHeader}
        <SatContainer>
          <div role="alert" className="mt-8 rounded-2xl border border-black/[0.06] bg-white p-6">
            <h1 className="text-[16px] font-semibold text-slate-900">Rooms could not load</h1>
            <p className="mt-1.5 text-[14px] leading-5 text-slate-500">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => shell.onSelectTab("questions")} className="sat-btn sat-btn--quiet sat-press">Questions</button>
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
        {workspaceHeader}
        <SatContainer>
          <SatEmptyState
            icon={<Link2 size={20} aria-hidden="true" />}
            title="Publish your exam to create rooms"
            hint="Publish a version, create a room, then share its student link and start the exam when everyone is ready."
            action={<SatPrimaryButton onClick={shell.onPublish ?? onBackToRelease}>{shell.onPublish ? "Publish exam" : "Review publishing"}</SatPrimaryButton>}
          />
        </SatContainer>
      </div>
    );
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="sat-product min-h-screen bg-au-fill text-slate-950">
      {workspaceHeader}

      <SatContainer>
        <SatPageHeader
          eyebrow={`${exam.title} · Version ${version.versionNumber}`}
          title="Rooms"
          description="Prepare, share and run sittings of this exam. Each room stays on the version it was created for."
        />
        {/* One polite region for in-place confirmations: the visual copy lives
            at the control, and screen readers hear it once. */}
        <p role="status" aria-live="polite" className="sr-only">{confirmation?.text ?? ""}</p>
        {error ? <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Access details could not refresh. Displayed entry information may be out of date. <button type="button" onClick={() => void onRefresh()} className="min-h-11 px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button></div> : null}
        {actionError ? (
          <div role="alert" className="sat-banner-enter mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-700/20 bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700">
            <span>{actionError}</span>
            <span className="flex shrink-0 items-center gap-1">
              {staleConflict ? (
                <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); void onRefresh(); }} className="sat-press sat-press-fill flex min-h-11 items-center gap-1 rounded-[10px] px-2.5 text-[14px] font-semibold hover:bg-red-100"><RefreshCw size={13} aria-hidden="true" />Refresh</button>
              ) : null}
              <button type="button" onClick={() => { setActionError(null); setStaleConflict(false); }} aria-label="Dismiss error" className="sat-press sat-press-fill flex h-11 w-11 items-center justify-center rounded-[10px] hover:bg-red-100"><XCircle size={15} aria-hidden="true" /></button>
            </span>
          </div>
        ) : null}

        <DeliverySetupGuide versionNumber={version.versionNumber} groupCount={links.filter((link) => link.publishedVersionId === version.id && link.lifecycleState !== "revoked").length} runningCount={links.filter((link) => link.publishedVersionId === version.id && session?.infoFor(link.scheduleId)?.phase === "live").length} finishedCount={links.filter((link) => link.publishedVersionId === version.id && session?.infoFor(link.scheduleId)?.phase === "finished").length} onCreate={() => openEditor(null)} />

        <div className="mt-4 overflow-hidden rounded-2xl border border-black/[0.06] bg-white lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section aria-label="Rooms" className="flex min-w-0 flex-col border-black/[0.06] max-lg:border-b lg:border-r">
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
                <SatList variant="cards">
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
                      sessionLabel={session?.canRun ? sessionRowLabel(session.infoFor(link.scheduleId)) : null}
                      {...(session?.canRun && !session.stale && session.infoFor(link.scheduleId)?.phase === "live" ? {
                        quickAction: { label: "Open live room", onSelect: () => session.onOpenRoom(link.scheduleId) },
                      } : {})}
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
                  title="No rooms yet"
                  hint="Create a room when you are ready to run this exam. Each room stays on the version it was created for."
                />
              )}
            </div>
          </section>
          <section aria-label="Room details" className="min-w-0 bg-au-fill max-lg:min-h-[420px]">
            {selectedLink ? (
              <AccessLinkDetail
                key={selectedLink.id}
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
                onCreateForCurrent={() => openDuplicateSetup(selectedLink)}
                copyConfirmed={confirmation?.linkId === selectedLink.id && confirmation.kind === "copy"}
                onEscapeToRow={focusSelectedRow}
                {...(session ? { session } : {})}
                justCreated={justCreatedId === selectedLink.id}
                onDismissNextSteps={() => setJustCreatedId(null)}
                onDuplicateSetup={() => openDuplicateSetup(selectedLink)}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Link2 size={28} className="mx-auto text-slate-300" aria-hidden="true" />
                  <p className="mt-3 text-[14px] font-semibold text-slate-700">Select a room</p>
                  <p className="mt-1 text-[14px] leading-5 text-slate-500">Details, activity, sharing, and check-in controls appear here.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </SatContainer>

      <AccessLinkEditorSheet
        open={editorOpen}
        link={editingLink}
        prefill={prefillLink}
        targetVersionNumber={createTarget?.versionNumber ?? version.versionNumber}
        providerKey={exam.providerKey ?? null}
        examTitle={exam.title}
        publishScope={createTarget?.publishScope ?? version?.publishScope ?? "full"}
        members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
        membersLoading={Boolean((editingLink ?? prefillLink)?.audienceType === "selected_students" && membersQuery.isLoading)}
        membersError={(editingLink ?? prefillLink)?.audienceType === "selected_students" && membersQuery.error ? "The student roster could not load. Retry before continuing." : null}
        onRetryMembers={() => void membersQuery.refetch()}
        isSaving={saving}
        reuseOptions={links}
        onReuseSetup={(link) => openDuplicateSetup(link, createTarget ?? undefined)}
        onClose={() => { if (!saving) { setEditorOpen(false); setEditingLink(null); setPrefillLink(null); setCreateTarget(null); } }}
        onCreate={createLink}
        onUpdate={updateLink}
      />
      <AccessLinkShareSheet open={Boolean(shareLink)} link={shareLink} onClose={() => setShareLink(null)} onPresent={() => { setPresentLink(shareLink); setShareLink(null); }} />
      <AccessLinkPresentView open={Boolean(presentLink)} link={presentLink} onClose={() => setPresentLink(null)} />
      <AuthoringConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === "delete" ? "Delete this student link permanently?" : "Revoke this student link?"}
        description={confirm?.action === "delete"
          ? "This URL will no longer let students enter. Schedules, exam attempts, scores, and exam history will be preserved. Deletion cannot be undone."
          : "Students who have not entered yet will permanently lose access through this link. Existing exam attempts are not deleted. Revocation cannot be undone."}
        confirmLabel={confirm?.action === "delete" ? "Delete permanently" : "Revoke student link"}
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
