import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Link2, RefreshCw, XCircle } from "lucide-react";
import type { ExamEntity } from "../../../../types/domain";
import {
  useAccessLinkMembers,
  useDeleteAccessLink,
  useSetAccessLinkLifecycle,
  useUpdateAccessLink,
} from "../../api/assessmentAccessLinkQueries";
import type {
  AccessDistributionOverview,
  AccessLinkMemberInput,
  AssessmentAccessLink,
  UpdateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import { logError, useNotificationStore } from "../../infrastructure/authoringUiGateway";
import { AccessLinkEditorSheet } from "./AccessLinkEditorSheet";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import type { SatMenuItem } from "../../../../products/sat/ui/Menu";
import { AccessLinkPresentView, AccessLinkShareSheet } from "./AccessLinkShareSheet";
import { AccessLinkRow, PHASE_TONE, rowElementId } from "./AccessLinkRow";
import { useTransientValue } from "./useTransientValue";
import {
  SatButton,
  SatContainer,
  SatEmptyState,
  SatList,
  SatListSkeleton,
  SatPageHeader,
  SatPrimaryButton,
  SatResultCount,
  SatSearchField,
  SatStatusPill,
} from "../../../../products/sat/ui/SatPage";
import { ExamWorkspaceHeader, type ExamShellNavigation } from "../shell/ExamWorkspaceHeader";
import { SESSION_PHASE_LABEL, type AccessSessionBindings, type SessionPhase } from "../delivery/sessionState";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import { SatCreateRoomFlow } from "../publish/SatCreateRoomFlow";
import { copyText, studentJoinUrl } from "./accessLinkUi";
import { CollaborationHeaderCluster } from "../collaboration/CollaborationHeaderCluster";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";
import { readRecentRooms } from "../../../../products/sat/ui/recentRooms";

interface StudentLinksDashboardProps {
  exam: ExamEntity;
  overview: AccessDistributionOverview | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  /** Staff who may create rooms; a room needs no prior publication. */
  canCreate: boolean;
  /** Opens the exam content a create-room check named, so the author can fix it. */
  onFixIssue: (issue: AssessmentValidationIssue) => void;
  /** Navigation + lifecycle for the shared exam header, supplied by the route. */
  shell: ExamShellNavigation;
  /** Opens the create form immediately when `id` changes. */
  createRequest?: CreateRequest | null;
  /** The room the viewer came back from: tinted, tagged "Last opened" and focused. */
  highlightLinkId?: string | null;
  /** Opens this room's edit sheet once its row is loaded (the room page's "Room settings"). */
  editLinkId?: string | null;
  /** Called once `editLinkId` has been acted on, so the host can drop it from the URL. */
  onEditHandled?: () => void;
  /** Opens the global Rooms list filtered to this exam. */
  onOpenAllRooms?: () => void;
  /** Session status and actions per room; omit to show configuration only. */
  session?: AccessSessionBindings;
}

export interface CreateRequest {
  id: number;
}

const EMPTY_ACCESS_LINKS: AssessmentAccessLink[] = [];
const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];
const RECENT_LIMIT = 3;
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
/** Transient acknowledgement rendered on the row where the action happened. */
type Confirmation = { linkId: string; kind: "copy" | "action"; text: string };

type LinkUpdateOptions = { silent?: boolean };

type GroupKey = "live" | "ready" | "finished" | "other" | "closed";
const GROUPS: Array<{ key: GroupKey; title: string }> = [
  { key: "live", title: "Live now" },
  { key: "ready", title: "Ready to start" },
  { key: "finished", title: "Finished" },
  // Rooms whose exam status is unknown are listed, never guessed into a phase.
  { key: "other", title: "Other rooms" },
];

function groupFor(link: AssessmentAccessLink, phase: SessionPhase | null): GroupKey {
  if (link.lifecycleState === "revoked" || phase === "cancelled") return "closed";
  if (phase === "live" || phase === "paused") return "live";
  if (phase === "ready") return "ready";
  if (phase === "finished") return "finished";
  return "other";
}

function createdTime(link: AssessmentAccessLink): number {
  const time = new Date(link.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** "Opened 12 minutes ago" for the Jump back in cards. */
function openedAgo(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "Opened just now";
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (minutes < 60) return `Opened ${format.format(-minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Opened ${format.format(-hours, "hour")}`;
  return `Opened ${format.format(-Math.round(hours / 24), "day")}`;
}

/** Scrolls a row into view (and focuses it). A just-created row may land a frame later. */
function revealRow(linkId: string, focus: boolean) {
  const reveal = (attempt: number) => {
    const element = document.getElementById(rowElementId(linkId));
    if (!element) {
      if (attempt === 0 && typeof window !== "undefined") window.requestAnimationFrame(() => reveal(1));
      return;
    }
    element.scrollIntoView?.({ block: "nearest" });
    if (focus) element.focus({ preventScroll: true });
  };
  reveal(0);
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

export function StudentLinksDashboard({ exam, overview, isLoading, error, onRefresh, canCreate, onFixIssue, shell, createRequest = null, session, highlightLinkId = null, editLinkId = null, onEditHandled, onOpenAllRooms }: StudentLinksDashboardProps) {
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AssessmentAccessLink | null>(null);
  const [prefillLink, setPrefillLink] = useState<AssessmentAccessLink | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateRequest | null>(null);
  const [shareLink, setShareLink] = useState<AssessmentAccessLink | null>(null);
  const [presentLink, setPresentLink] = useState<AssessmentAccessLink | null>(null);
  const [confirm, setConfirm] = useState<{ link: AssessmentAccessLink; action: "revoke" | "delete" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);
  const notifySuccess = useNotificationStore((state) => state.addSuccess);
  const searchTimer = useRef<number | null>(null);
  // Read once per visit: the list is this browser's history, not live data.
  const [recentRooms] = useState(() => readRecentRooms(exam.id));

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

  // Small workspaces echo the keystroke immediately; a large library keeps the
  // debounced term so re-sorting stays off the typing path.
  const effectiveSearch = links.length <= SEARCH_FAST_PATH_MAX ? search : debouncedSearch;
  const query = effectiveSearch.trim().toLocaleLowerCase();

  const phaseOf = useCallback(
    (link: AssessmentAccessLink): SessionPhase | null => (session?.canRun ? session.infoFor(link.scheduleId)?.phase ?? null : null),
    [session],
  );

  const visibleLinks = useMemo(() => links
    .filter((link) => !query || [link.name, link.audienceLabel ?? "", link.examTitle, `version ${link.versionNumber}`]
      .some((value) => value.toLocaleLowerCase().includes(query)))
    .sort((left, right) => createdTime(right) - createdTime(left)), [links, query]);

  const groups = useMemo(() => {
    const result: Record<GroupKey, AssessmentAccessLink[]> = { live: [], ready: [], finished: [], other: [], closed: [] };
    for (const link of visibleLinks) result[groupFor(link, phaseOf(link))].push(link);
    return result;
  }, [phaseOf, visibleLinks]);

  const recentLinks = useMemo(() => {
    const byScheduleId = new Map(links.map((link) => [link.scheduleId, link]));
    return recentRooms
      .flatMap((entry) => {
        const link = byScheduleId.get(entry.scheduleId);
        return link ? [{ link, at: entry.at }] : [];
      })
      .slice(0, RECENT_LIMIT);
  }, [links, recentRooms]);

  // Coming back from a room: bring its row under the eye and the focus ring once.
  const revealedHighlight = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightLinkId || revealedHighlight.current === highlightLinkId) return;
    if (!links.some((link) => link.id === highlightLinkId)) return;
    revealedHighlight.current = highlightLinkId;
    revealRow(highlightLinkId, true);
  }, [highlightLinkId, links]);

  // Global "/" focuses search. Skipped inside inputs and over dialogs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || !(target instanceof HTMLElement) || target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if (event.key === "/" && !inField && !editorOpen && !shareLink && !presentLink && !confirm) {
        event.preventDefault();
        document.getElementById("student-links-search")?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirm, editorOpen, presentLink, shareLink]);

  const showToast = useCallback((message: string) => {
    notifySuccess(message);
  }, [notifySuccess]);

  const reportActionError = useCallback((message: string, context: Record<string, unknown>, err: unknown) => {
    setActionError(message);
    setStaleConflict(isRevisionConflict(err));
    logError(err, { feature: "student-access", ...context });
  }, []);

  const updateLink = async (linkId: string, request: UpdateAssessmentAccessLinkRequest, options?: LinkUpdateOptions) => {
    const updated = await updateMutation.mutateAsync({ linkId, request });
    collaboration?.setValue(`access/${linkId}`, updated);
    announceWorkspaceCommand("access.updated", { linkId });
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
    setEditorOpen(true);
  }, []);

  const openDuplicateSetup = useCallback((link: AssessmentAccessLink) => {
    setEditingLink(null);
    setPrefillLink(link);
    setEditorOpen(true);
  }, []);

  // The room page's "Room settings" lands here with ?edit=1: open that room's
  // editor once its row exists, then let the host clear the request.
  const handledEdit = useRef<string | null>(null);
  useEffect(() => {
    if (!editLinkId || handledEdit.current === editLinkId) return;
    if (isLoading) return;
    const target = links.find((link) => link.id === editLinkId);
    if (!target && !error && !overview) return;
    handledEdit.current = editLinkId;
    if (target) openEditor(target);
    onEditHandled?.();
  }, [editLinkId, error, isLoading, links, onEditHandled, openEditor, overview]);

  /** The row's one action: open the room, or share it for staff who cannot run rooms. */
  const openRoom = (link: AssessmentAccessLink) => {
    if (session?.canRun) session.onOpenRoom(link.scheduleId);
    else setShareLink(link);
  };

  // A host (publish-less now) can ask for the create form with a request id; each new id opens it once.
  const handledCreateRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!createRequest || handledCreateRequest.current === createRequest.id) return;
    if (isLoading || error) return;
    handledCreateRequest.current = createRequest.id;
    setEditingLink(null);
    setPrefillLink(null);
    setEditorOpen(true);
  }, [createRequest, isLoading, error]);

  const onRoomCreated = (created: AssessmentAccessLink) => {
    setEditorOpen(false);
    setPrefillLink(null);
    collaboration?.setValue(`access/${created.id}`, created);
    announceWorkspaceCommand("access.created", { linkId: created.id });
    setSearch("");
    setDebouncedSearch("");
    revealRow(created.id, true);
    // The new row lands already confirmed: the page never relies on a global
    // channel to say the write was accepted.
    showConfirmation({ linkId: created.id, kind: "action", text: "Room created" });
    showToast("Room created");
    // The session is the object staff work with next: take runners straight to its waiting room.
    // Staff who cannot run sessions stay here, on the new row, which they can share.
    if (session?.canRun) session.onOpenRoom(created.scheduleId, { created: true });
  };

  const rosterSource = prefillLink;
  const createFlow = editorOpen && !editingLink ? (
    <SatCreateRoomFlow
      key={prefillLink?.id ?? "new-room"}
      examId={exam.id}
      examTitle={exam.title}
      sectionScope={exam.satSectionScope ?? "full"}
      prefill={prefillLink}
      reuseOptions={links}
      onReuseSetup={openDuplicateSetup}
      members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
      membersLoading={Boolean(rosterSource?.audienceType === "selected_students" && membersQuery.isLoading)}
      membersError={rosterSource?.audienceType === "selected_students" && membersQuery.error ? "The student roster could not load. Retry before continuing." : null}
      onRetryMembers={() => void membersQuery.refetch()}
      onClose={() => { setEditorOpen(false); setPrefillLink(null); }}
      onFixIssue={(issue) => {
        setEditorOpen(false);
        setPrefillLink(null);
        onFixIssue(issue);
      }}
      onRoomCreated={onRoomCreated}
    />
  ) : null;

  // While one write is in flight the menu closes behind it; the row keeps the
  // acknowledgement, so the actions stay visible but cannot be re-fired.
  const menuItemsFor = (link: AssessmentAccessLink, busy = false): SatMenuItem[] => [
    { id: "copy", label: "Copy student link", disabled: busy, onSelect: () => { void copy(link); } },
    { id: "share", label: "Share", disabled: busy, onSelect: () => setShareLink(link) },
    { id: "present", label: "Present to Students", disabled: busy, onSelect: () => setPresentLink(link) },
    { id: "edit", label: "Edit room", disabled: busy, onSelect: () => openEditor(link) },
    { id: "duplicate", label: "Duplicate setup", disabled: busy, onSelect: () => openDuplicateSetup(link) },
    ...(session?.canRun && phaseOf(link) === "finished"
      ? [{ id: "results", label: "View results", onSelect: () => session.onOpenResults(link.scheduleId) } as SatMenuItem]
      : []),
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
        contextLine={version ? `Latest room exam · Version ${version.versionNumber} · ${version.publishScope === "full" ? "Full SAT" : version.publishScope === "math" ? "Math only" : "Reading & Writing only"}` : "A room captures your latest saved exam"}
        collaborationSlot={<CollaborationHeaderCluster surface="access" />}
        onPreview={shell.onPreview}
        {...(shell.onQuickSettings ? { onQuickSettings: shell.onQuickSettings } : {})}
        {...(canCreate ? { onCreateSession: () => openEditor(null) } : {})}
      />
  );

  if (isLoading) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        {workspaceHeader}
        <SatContainer className="sat-workspace-enter">
          <SatPageHeader eyebrow="Digital SAT" title="Rooms" description="Find a room for this exam and open it to share, start and monitor." />
          <SatListSkeleton rows={3} label="Loading Rooms" />
        </SatContainer>
      </div>
    );
  }
  if (error && !overview) {
    return (
      <div className="sat-product min-h-screen bg-au-fill">
        {workspaceHeader}
        <SatContainer className="sat-workspace-enter">
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
        <SatContainer className="sat-workspace-enter">
          <SatEmptyState
            icon={<Link2 size={20} aria-hidden="true" />}
            title="Create your first room"
            hint="Create a room, then share its student link and start the exam when everyone is ready. The room captures your latest saved exam automatically."
            action={canCreate ? <SatPrimaryButton onClick={() => openEditor(null)}>Create room</SatPrimaryButton> : undefined}
          />
        </SatContainer>
        {createFlow}
      </div>
    );
  }

  const saving = updateMutation.isPending;
  let rowIndex = 0;
  const renderRow = (link: AssessmentAccessLink) => {
    const busy = pendingWrite?.linkId === link.id;
    return (
      <AccessLinkRow
        key={link.id}
        link={link}
        phase={phaseOf(link)}
        highlighted={link.id === highlightLinkId}
        onOpen={() => openRoom(link)}
        menuItems={menuItemsFor(link, busy)}
        resultIndex={rowIndex++}
        busy={busy}
        pendingLabel={busy ? pendingWrite.label : null}
        confirmation={confirmation?.linkId === link.id ? confirmation.text : null}
      />
    );
  };

  return (
    <div className="sat-product min-h-screen bg-au-fill text-slate-950">
      {workspaceHeader}

      <SatContainer className="sat-workspace-enter">
        <SatPageHeader
          eyebrow={`${exam.title} · Version ${version.versionNumber}`}
          title="Rooms"
          description="Find a room for this exam and open it to share, start and monitor."
          {...(onOpenAllRooms ? {
            actions: <SatButton variant="quiet" icon={<ArrowUpRight size={16} aria-hidden="true" />} onClick={onOpenAllRooms}>All rooms</SatButton>,
          } : {})}
        />
        {/* One polite region for in-place confirmations: the visual copy lives
            at the control, and screen readers hear it once. */}
        <p role="status" aria-live="polite" className="sr-only">{confirmation?.text ?? ""}</p>
        {error ? <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Access details could not refresh. Displayed entry information may be out of date. <button type="button" onClick={() => void onRefresh()} className="min-h-11 px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button></div> : null}
        {session?.canRun && session.stale && links.length ? (
          <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-4 py-2 text-[14px] text-slate-600">
            <span>Room status could not refresh, so some rooms are listed without it.</span>
            <SatButton variant="quiet" pending={session.refreshing} icon={<RefreshCw size={16} aria-hidden="true" />} onClick={session.onRefresh}>Retry</SatButton>
          </div>
        ) : null}
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

        {recentLinks.length ? (
          <section aria-labelledby="rooms-recent-heading" className="mt-6">
            <h2 id="rooms-recent-heading" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Jump back in</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {recentLinks.map(({ link, at }) => {
                const phase = phaseOf(link);
                const tone = phase ? PHASE_TONE[phase] : undefined;
                const joined = session?.canRun ? session.infoFor(link.scheduleId)?.joined ?? null : null;
                return (
                  <li key={link.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openRoom(link)}
                      aria-label={`Open ${link.name}, ${openedAgo(at).toLocaleLowerCase()}`}
                      className="sat-list-row sat-press-row flex min-h-[88px] w-full flex-col items-start justify-between gap-2 rounded-2xl border border-black/[0.06] bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-slate-900">{link.name}</span>
                        {phase && tone ? <SatStatusPill tone={tone} pulse={phase === "live"}>{SESSION_PHASE_LABEL[phase]}</SatStatusPill> : null}
                      </span>
                      <span className="text-[14px] tabular-nums text-slate-500">
                        {openedAgo(at)}{joined !== null ? ` · ${joined} joined` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section aria-label="Rooms" className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <SatSearchField
              id="student-links-search"
              label="Search rooms"
              value={search}
              onChange={setSearch}
              placeholder="Search by name, audience or version"
              widthClassName="sm:max-w-sm"
            />
          </div>
          <SatResultCount total={links.length} visible={visibleLinks.length} itemLabel={links.length === 1 ? "room" : "rooms"} />

          {links.length === 0 ? (
            <SatEmptyState
              icon={<Link2 size={20} aria-hidden="true" />}
              title="No rooms yet"
              hint="Create a room when you are ready to run this exam. Each room keeps the exam content it was created with."
              action={canCreate ? <SatPrimaryButton onClick={() => openEditor(null)}>Create room</SatPrimaryButton> : undefined}
            />
          ) : visibleLinks.length === 0 ? (
            <SatEmptyState
              icon={<Link2 size={20} aria-hidden="true" />}
              title={`No rooms match “${search.trim()}”`}
              hint="Try a room name, audience or version number."
              action={<SatButton variant="secondary" onClick={() => setSearch("")}>Clear search</SatButton>}
            />
          ) : (
            <div className="mt-4 space-y-6">
              {GROUPS.filter((group) => groups[group.key].length).map((group) => (
                <section key={group.key} aria-labelledby={`rooms-group-${group.key}`}>
                  <h2 id={`rooms-group-${group.key}`} className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                    {group.title} <span className="tabular-nums text-slate-400">{groups[group.key].length}</span>
                  </h2>
                  <SatList variant="cards">{groups[group.key].map(renderRow)}</SatList>
                </section>
              ))}
              {groups.closed.length ? (
                <details
                  className="group"
                  open={Boolean(query) || groups.closed.some((link) => link.id === highlightLinkId) || undefined}
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-1 text-[14px] font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                    Closed rooms ({groups.closed.length})
                  </summary>
                  <div className="mt-2">
                    <SatList variant="cards">{groups.closed.map(renderRow)}</SatList>
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </section>
      </SatContainer>

      {createFlow}
      {editingLink ? (
        <AccessLinkEditorSheet
          open={editorOpen}
          link={editingLink}
          providerKey={exam.providerKey ?? null}
          examTitle={exam.title}
          publishScope={version?.publishScope ?? "full"}
          members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
          membersLoading={Boolean(editingLink.audienceType === "selected_students" && membersQuery.isLoading)}
          membersError={editingLink.audienceType === "selected_students" && membersQuery.error ? "The student roster could not load. Retry before continuing." : null}
          onRetryMembers={() => void membersQuery.refetch()}
          isSaving={saving}
          onClose={() => { if (!saving) { setEditorOpen(false); setEditingLink(null); } }}
          onCreate={async () => { throw new Error("Rooms are created from Create room."); }}
          onUpdate={updateLink}
        />
      ) : null}
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
