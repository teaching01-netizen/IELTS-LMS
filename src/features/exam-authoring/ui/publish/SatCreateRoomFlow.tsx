import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ExamEntity } from "../../../../types/domain";
import { useExamQuery } from "../../api/examQueries";
import { assessmentAccessLinksApi } from "../../api/assessmentAccessLinksApi";
import { useCreateAccessLink } from "../../api/assessmentAccessLinkQueries";
import type {
  AccessLinkMemberInput,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import type { AssessmentValidationIssue, SatPublishScope } from "../../contracts/assessment";
import type { AssessmentReleaseState } from "../../contracts/release";
import { AccessLinkEditorSheet } from "../access-links/AccessLinkEditorSheet";
import {
  availableAccessLinkSections,
  effectiveAccessLinkSections,
} from "../../contracts/accessLinks";
import {
  canPublishFromBlockers,
  getFreshWarnings,
  getPublishBlockers,
  getSATPublishBlockers,
  isReadinessFresh,
  isSATPublishReadinessIssue,
  isSATPublishReadinessValid,
  publishIssueDestinationLabel,
  resolvePublishIssueDestination,
  SAT_PUBLISH_SCOPE_OPTIONS,
  satPublishScopeCopy,
} from "../release/releaseSelectors";
import { useReleaseOnline } from "../release/releaseUi";
import type { DeliveryTarget } from "../shell/examLifecycle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../../components/ui/sheet";
import { useSatPublish } from "./useSatPublish";

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];

type SetupSnapshot =
  | { kind: "published"; target: DeliveryTarget }
  | { kind: "draft"; versionId: string; versionRevision: number; versionNumber: number }
  | { kind: "unavailable"; message: string };

interface SatCreateRoomFlowProps {
  examId: string;
  examTitle: string;
  pinnedTarget?: DeliveryTarget | null;
  onClose: () => void;
  onFixIssue: (issue: AssessmentValidationIssue) => void;
  onPublished?: (target: DeliveryTarget) => void;
  onRoomCreated: (link: AssessmentAccessLink) => void;
}

/** Creates a room from the currently published version or publishes the exact draft shown in setup. */
export function SatCreateRoomFlow(props: SatCreateRoomFlowProps) {
  const examQuery = useExamQuery(props.examId);
  if (!examQuery.data) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open) props.onClose(); }}>
        <SheetContent side="right" className="sat-product sat-staff-root flex w-[min(96vw,560px)] max-w-[560px] flex-col gap-0 p-0">
          <SheetHeader className="border-b border-[var(--sat-staff-border-hairline)] px-6 py-5 text-left">
            <SheetTitle className="text-[20px] leading-7">Create room</SheetTitle>
            <SheetDescription>The latest exam setup is needed before a room can be created.</SheetDescription>
          </SheetHeader>
          {examQuery.error ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-sm text-[var(--sat-staff-danger,#b42318)]">The exam could not be loaded.</p>
              <button type="button" onClick={() => void examQuery.refetch()} className="sat-btn sat-btn--secondary sat-press">Retry</button>
            </div>
          ) : <p role="status" className="p-6 text-sm text-[var(--sat-staff-text-secondary,#515154)]">Loading exam details…</p>}
        </SheetContent>
      </Sheet>
    );
  }
  return <SatCreateRoomFlowReady {...props} exam={examQuery.data} onExamRefresh={() => examQuery.refetch()} />;
}

function SatCreateRoomFlowReady({
  exam,
  onExamRefresh,
  ...props
}: SatCreateRoomFlowProps & { exam: ExamEntity; onExamRefresh: () => Promise<unknown> }) {
  const publish = useSatPublish(exam, onExamRefresh);
  const online = useReleaseOnline();
  const createMutation = useCreateAccessLink(exam.id);
  const [setupSnapshot, setSetupSnapshot] = useState<SetupSnapshot | null>(null);
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [target, setTarget] = useState<DeliveryTarget | null>(props.pinnedTarget ?? null);
  const targetRef = useRef<DeliveryTarget | null>(props.pinnedTarget ?? null);
  const [phase, setPhase] = useState<"idle" | "publishing" | "creating" | "checking">("idle");
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [reconciliationMessage, setReconciliationMessage] = useState<string | null>(null);
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const submittingRef = useRef(false);
  const publishOperationRef = useRef<Map<string, string>>(new Map());
  const pendingCreateRef = useRef<CreateAttempt | null>(null);
  const releaseState = publish.releaseState;
  const currentPublished = releaseState?.currentPublishedVersion ?? null;

  useEffect(() => {
    if (props.pinnedTarget && !targetRef.current) {
      targetRef.current = props.pinnedTarget;
      setTarget(props.pinnedTarget);
    }
    if (scopeInitialized) return;
    if (props.pinnedTarget) {
      publish.setPublishScope(props.pinnedTarget.publishScope);
      targetRef.current = props.pinnedTarget;
      setTarget(props.pinnedTarget);
      setSetupSnapshot({ kind: "published", target: props.pinnedTarget });
      setScopeInitialized(true);
      return;
    }
    if (!releaseState) return;

    const initialScope = currentPublished?.publishScope ?? "full";
    publish.setPublishScope(initialScope);
    if (releaseState.state === "published_current" && currentPublished) {
      const selectedTarget = releaseTarget(currentPublished);
      targetRef.current = selectedTarget;
      setTarget(selectedTarget);
      setSetupSnapshot({ kind: "published", target: selectedTarget });
      setScopeInitialized(true);
      return;
    }
    if (releaseState.state === "published_current") {
      setSetupSnapshot({ kind: "unavailable", message: "The published version could not be confirmed. Retry to load the current exam version." });
      setScopeInitialized(true);
      return;
    }
    if (publish.shell) {
      const draft = releaseState.workingDraft;
      if (draft && draft.id === publish.shell.versionId) {
        setSetupSnapshot({
          kind: "draft",
          versionId: publish.shell.versionId,
          versionRevision: publish.shell.versionRevision,
          versionNumber: draft.versionNumber,
        });
      } else {
        setSetupSnapshot({ kind: "unavailable", message: "The latest saved draft could not be matched to this setup. Close Create room and reopen it to refresh." });
      }
      setScopeInitialized(true);
      return;
    }
    if (publish.shellState.kind === "no-draft") {
      setSetupSnapshot({ kind: "unavailable", message: "There is no editable draft to publish. Open the exam draft, then create a room." });
      setScopeInitialized(true);
    } else if (publish.shellState.kind === "error" || publish.shellState.kind === "forbidden" || publish.shellState.kind === "exam-not-found") {
      setSetupSnapshot({ kind: "unavailable", message: publish.shellLoadError ?? "The draft could not be loaded." });
      setScopeInitialized(true);
    }
  }, [
    currentPublished,
    exam.id,
    props.pinnedTarget,
    publish,
    publish.shell,
    publish.shellLoadError,
    publish.shellState.kind,
    publish.setPublishScope,
    releaseState,
    scopeInitialized,
  ]);

  // If another staff member publishes the exact draft and scope selected here,
  // pin to that same immutable version. A different version or scope is never adopted.
  useEffect(() => {
    if (targetRef.current || setupSnapshot?.kind !== "draft" || !currentPublished) return;
    if (currentPublished.id !== setupSnapshot.versionId || currentPublished.publishScope !== publish.publishScope) return;
    const selectedTarget = releaseTarget(currentPublished);
    targetRef.current = selectedTarget;
    setTarget(selectedTarget);
  }, [currentPublished, exam.id, publish.publishScope, setupSnapshot]);

  const needsPublish = setupSnapshot?.kind === "draft" && !target;
  const readiness = publish.readinessQuery.data ?? null;
  const readinessFresh = isReadinessFresh(readiness, publish.shell, publish.publishScope);
  const blockers = getSATPublishBlockers(readiness, readinessFresh);
  const warnings = getFreshWarnings(readiness, readinessFresh).filter(isSATPublishReadinessIssue);
  const readinessValid = isSATPublishReadinessValid(readiness, readinessFresh, publish.publishScope);
  const publishGate = getPublishBlockers({
    lifecycleState: releaseState?.state ?? "never_published",
    readinessFresh,
    readinessValid,
    blockerCount: blockers.length,
    dirtyCount: 0,
    isPublishing: publish.isPublishing,
    canEdit: exam.canEdit,
    canPublishExam: exam.canPublish,
  });
  const canPublish = online && !publish.draftBusy && canPublishFromBlockers(publishGate);
  const draftChanged = setupSnapshot?.kind === "draft" && (
    (releaseState?.workingDraft
      ? releaseState.workingDraft.id !== setupSnapshot.versionId
      : currentPublished ? currentPublished.id !== setupSnapshot.versionId : false) ||
    Boolean(publish.shell &&
      (publish.shell.versionId !== setupSnapshot.versionId || publish.shell.versionRevision !== setupSnapshot.versionRevision))
  );
  const selectedDraftPublishedWithOtherScope = setupSnapshot?.kind === "draft" && Boolean(
    currentPublished?.id === setupSnapshot.versionId && currentPublished.publishScope !== publish.publishScope,
  );
  const selectedDraftSuperseded = setupSnapshot?.kind === "draft" && Boolean(
    releaseState?.state === "published_current" && currentPublished?.id !== setupSnapshot.versionId,
  );
  const canSubmit = Boolean(
    exam.canEdit &&
    setupSnapshot &&
    setupSnapshot.kind !== "unavailable" &&
    !outcomeUnknown &&
    (target || (needsPublish && scopeConfirmed && canPublish && !draftChanged && !selectedDraftPublishedWithOtherScope && !selectedDraftSuperseded)),
  );

  const setPublishedTarget = useCallback((next: DeliveryTarget) => {
    targetRef.current = next;
    setTarget(next);
    props.onPublished?.(next);
  }, [props]);

  const publishKeyFor = (snapshot: Extract<SetupSnapshot, { kind: "draft" }>, scope: SatPublishScope) => {
    const fingerprint = `${snapshot.versionId}:${snapshot.versionRevision}:${scope}`;
    const existing = publishOperationRef.current.get(fingerprint);
    if (existing) return existing;
    const key = crypto.randomUUID();
    publishOperationRef.current.set(fingerprint, key);
    return key;
  };

  const onCreate = async (request: CreateAssessmentAccessLinkRequest) => {
    if (submittingRef.current) return;
    if (!canSubmit && !targetRef.current) throw new Error("Choose the exam content and resolve its publish checks before creating the room.");
    submittingRef.current = true;
    try {
      let selectedTarget = targetRef.current;
      if (!selectedTarget) {
        if (!needsPublish || setupSnapshot?.kind !== "draft") {
          throw new Error("The selected exam version is unavailable. Close Create room and reopen it to refresh.");
        }
        setPhase("publishing");
        const operationKey = publishKeyFor(setupSnapshot, publish.publishScope);
        try {
          selectedTarget = await publish.publish(publish.publishScope, undefined, {
            expectedDraft: {
              versionId: setupSnapshot.versionId,
              versionRevision: setupSnapshot.versionRevision,
            },
            operationKey,
          });
        } catch (publishError) {
          // A retry reuses its operation key. If another staff member already
          // published this exact draft and scope, the release projection is its receipt.
          const refreshed = await publish.releaseQuery.refetch().catch(() => null);
          const published = refreshed?.data?.currentPublishedVersion;
          if (published?.id === setupSnapshot.versionId && published.publishScope === publish.publishScope) {
            selectedTarget = releaseTarget(published);
          } else {
            throw publishError;
          }
        }
        setPublishedTarget(selectedTarget);
      }

      const pinnedRequest = { ...request, publishedVersionId: selectedTarget.versionId };
      const attempt: CreateAttempt = {
        request: pinnedRequest,
        target: selectedTarget,
        startedAt: Date.now(),
      };
      setPhase("creating");
      try {
        const created = await createMutation.mutateAsync(pinnedRequest);
        props.onRoomCreated(created);
      } catch (createError) {
        if (isDefinitiveCreateRejection(createError)) throw createError;
        pendingCreateRef.current = attempt;
        setPhase("checking");
        setReconciliationBusy(true);
        const outcome = await reconcileCreate(exam.id, attempt);
        setReconciliationBusy(false);
        if (outcome.kind === "found") {
          pendingCreateRef.current = null;
          props.onRoomCreated(outcome.link);
          return;
        }
        if (outcome.kind === "not-found") {
          pendingCreateRef.current = null;
          setReconciliationMessage("No room matching this setup was found. You can retry creation.");
          throw createError;
        }
        setOutcomeUnknown(true);
        setReconciliationMessage(outcome.kind === "ambiguous"
          ? "Several rooms match this setup. Check Rooms before retrying."
          : "The room could not be confirmed. Check again before retrying.");
        throw new Error("Room creation could not be confirmed. Check its status before trying again.");
      }
    } finally {
      submittingRef.current = false;
      setPhase("idle");
      setReconciliationBusy(false);
    }
  };

  const checkCreateOutcome = async () => {
    const attempt = pendingCreateRef.current;
    if (!attempt || reconciliationBusy) return;
    setReconciliationBusy(true);
    setPhase("checking");
    const outcome = await reconcileCreate(exam.id, attempt);
    setReconciliationBusy(false);
    setPhase("idle");
    if (outcome.kind === "found") {
      pendingCreateRef.current = null;
      setOutcomeUnknown(false);
      props.onRoomCreated(outcome.link);
    } else if (outcome.kind === "not-found") {
      pendingCreateRef.current = null;
      setOutcomeUnknown(false);
      setReconciliationMessage("No matching room was found. You can retry creation.");
    } else {
      setReconciliationMessage(outcome.kind === "ambiguous"
        ? "Several rooms match this setup. Check Rooms before retrying."
        : "The room could not be confirmed. Check again before retrying.");
    }
  };

  const contentBeforeFields = (
    <section className="space-y-4 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4" aria-label="Exam content and publish status">
      {target ? (
        <div role="status" className="space-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Room uses Version {target.versionNumber} · {satPublishScopeCopy(target.publishScope)}</p>
          <p>Existing rooms keep their version. No exam timer starts yet.</p>
        </div>
      ) : setupSnapshot?.kind === "draft" && !target ? (
        <>
          <div className="space-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Publish the latest draft and create this room</p>
            <p>Version {setupSnapshot.versionNumber} will be checked and published as a new version. Existing rooms keep their version. No exam timer starts yet.</p>
          </div>
          <fieldset className="space-y-2" disabled={publish.isPublishing || phase !== "idle" || !exam.canPublish}>
            <legend className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Exam content students will receive</legend>
            {SAT_PUBLISH_SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--sat-staff-border-strong)] bg-white px-3 text-[14px] font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">
                <input
                  type="radio"
                  name="sat-create-room-publish-scope"
                  value={option.value}
                  checked={scopeConfirmed && publish.publishScope === option.value}
                  onChange={() => { publish.setPublishScope(option.value); setScopeConfirmed(true); }}
                  className="h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]"
                />
                {option.label}{option.value !== "full" ? " only" : ""}
              </label>
            ))}
          </fieldset>
          {publish.readinessQuery.isFetching ? (
            <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Checking the latest draft…</p>
          ) : null}
          {publish.readinessQuery.error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">
              <span>The publish checks could not load.</span>
              <button type="button" disabled={phase !== "idle"} onClick={() => void publish.readinessQuery.refetch()} className="sat-btn sat-btn--quiet sat-press">Retry checks</button>
            </div>
          ) : null}
          {blockers.length > 0 ? (
            <ul className="space-y-2" aria-label="Issues to fix before publishing">
              {blockers.map((issue, index) => {
                const destination = resolvePublishIssueDestination(issue, publish.shell ?? null);
                const destinationLabel = publishIssueDestinationLabel(destination);
                return (
                  <li key={`${issue.code}:${issue.path}:${index}`} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--sat-staff-danger,#b42318)]/20 bg-white px-3 py-2 text-[14px] leading-5">
                    <span>{issue.message}</span>
                    {destinationLabel ? (
                      <button type="button" disabled={phase !== "idle"} aria-label={`Fix ${destinationLabel}`} onClick={() => props.onFixIssue(issue)} className="min-h-11 shrink-0 font-semibold text-[var(--sat-staff-accent,#0071e3)] disabled:opacity-50">Fix</button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {warnings.length > 0 && readinessFresh ? (
            <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{warnings.length} publish {warnings.length === 1 ? "note" : "notes"} will remain visible for review.</p>
          ) : null}
          {!scopeConfirmed ? <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">Choose the exam content for this room before continuing.</p> : null}
          {draftChanged ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">The draft changed while you were setting up this room. Close Create room and reopen it to review the latest draft.</p> : null}
          {selectedDraftPublishedWithOtherScope ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">This draft was published with a different scope while you were setting up. Close and reopen Create room to review that version.</p> : null}
          {selectedDraftSuperseded ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">A different version was published while you were setting up. Close and reopen Create room to review it.</p> : null}
          {!exam.canPublish ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">You do not have permission to publish this draft.</p> : null}
          {!online ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">Reconnect before publishing and creating a room.</p> : null}
          {!publish.draftBusy && scopeConfirmed && !publish.readinessQuery.isFetching && !publish.readinessQuery.error && !readinessValid && blockers.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              <span>Run checks to confirm this draft is ready.</span>
              <button type="button" disabled={phase !== "idle"} onClick={() => void publish.readinessQuery.refetch()} className="sat-btn sat-btn--quiet sat-press"><RefreshCw size={15} aria-hidden="true" />Run checks</button>
            </div>
          ) : null}
          {publishGate.length > 0 && !blockers.length && scopeConfirmed && !publish.readinessQuery.isFetching ? (
            <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{publishGate[0]}</p>
          ) : null}
        </>
      ) : setupSnapshot?.kind === "unavailable" ? (
        <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{setupSnapshot.message}</p>
      ) : (
        <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Loading the current exam version…</p>
      )}
      {reconciliationMessage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]" role={outcomeUnknown ? "alert" : "status"}>
          <span>{reconciliationMessage}</span>
          {outcomeUnknown ? (
            <button type="button" disabled={reconciliationBusy} onClick={() => void checkCreateOutcome()} className="sat-btn sat-btn--secondary sat-press">
              {reconciliationBusy ? "Checking…" : "Check again"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  if (!scopeInitialized || !setupSnapshot) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open) props.onClose(); }}>
        <SheetContent side="right" className="sat-product sat-staff-root flex w-[min(96vw,560px)] max-w-[560px] flex-col gap-0 p-0">
          <SheetHeader className="border-b border-[var(--sat-staff-border-hairline)] px-6 py-5 text-left">
            <SheetTitle className="text-[20px] leading-7">Create room</SheetTitle>
            <SheetDescription>Checking the latest saved exam version and publish status.</SheetDescription>
          </SheetHeader>
          {publish.releaseQuery.error ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-sm text-[var(--sat-staff-danger,#b42318)]">The current exam version could not be loaded.</p>
              <button
                type="button"
                onClick={() => {
                  void publish.releaseQuery.refetch();
                  void publish.shellLifecycle.refresh();
                }}
                className="sat-btn sat-btn--secondary sat-press"
              >Retry</button>
            </div>
          ) : <p role="status" className="p-6 text-sm text-[var(--sat-staff-text-secondary,#515154)]">Loading the latest exam setup…</p>}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AccessLinkEditorSheet
      open
      link={null}
      providerKey="sat"
      examTitle={props.examTitle}
      publishScope={target?.publishScope ?? publish.publishScope}
      targetVersionNumber={target?.versionNumber ?? (setupSnapshot.kind === "draft" ? setupSnapshot.versionNumber : null)}
      members={EMPTY_MEMBERS}
      isSaving={publish.isPublishing || createMutation.isPending || reconciliationBusy}
      inputsDisabled={outcomeUnknown}
      submitDisabled={!canSubmit || phase === "checking"}
      submitLabel={target ? "Create room" : "Publish & create room"}
      pendingLabel={phase === "publishing" ? "Publishing…" : phase === "checking" ? "Checking…" : "Creating…"}
      contentBeforeFields={contentBeforeFields}
      onClose={props.onClose}
      onCreate={onCreate}
    />
  );
}

interface CreateAttempt {
  request: CreateAssessmentAccessLinkRequest;
  target: DeliveryTarget;
  startedAt: number;
}

type ReconcileResult =
  | { kind: "found"; link: AssessmentAccessLink }
  | { kind: "not-found" }
  | { kind: "unknown" }
  | { kind: "ambiguous" };

async function reconcileCreate(examId: string, attempt: CreateAttempt): Promise<ReconcileResult> {
  let readSucceeded = false;
  for (let check = 0; check < 3; check += 1) {
    if (check > 0) await new Promise((resolve) => window.setTimeout(resolve, check * 250));
    try {
      const overview = await assessmentAccessLinksApi.overview(examId);
      readSucceeded = true;
      const matches = overview.links.filter((link) => matchesCreateAttempt(link, attempt));
      if (matches.length === 1) return { kind: "found", link: matches[0]! };
      if (matches.length > 1) return { kind: "ambiguous" };
    } catch {
      // Retry the authoritative room listing before allowing another create.
    }
  }
  return readSucceeded ? { kind: "not-found" } : { kind: "unknown" };
}

function matchesCreateAttempt(link: AssessmentAccessLink, attempt: CreateAttempt): boolean {
  const { request, target, startedAt } = attempt;
  const createdAt = new Date(link.createdAt).getTime();
  const expectedSections = (request.enabledSections?.length
    ? request.enabledSections
    : availableAccessLinkSections(target.publishScope)).slice().sort();
  const actualSections = effectiveAccessLinkSections(link.enabledSections, target.publishScope).slice().sort();
  return (
    createdAt >= startedAt - 60_000 &&
    link.publishedVersionId === target.versionId &&
    link.name === request.name &&
    link.audienceType === request.audienceType &&
    link.audienceLabel === (request.audienceLabel ?? null) &&
    link.accessMode === request.accessMode &&
    link.availabilityType === request.availabilityType &&
    sameInstant(link.opensAt, request.opensAt ?? null) &&
    sameInstant(link.closesAt, request.closesAt ?? null) &&
    link.selectedStudentCount === request.selectedStudents.length &&
    expectedSections.length === actualSections.length &&
    expectedSections.every((section, index) => section === actualSections[index])
  );
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (!left || !right) return left === right;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

function isDefinitiveCreateRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = "status" in error ? (error as { status?: unknown }).status
    : "statusCode" in error ? (error as { statusCode?: unknown }).statusCode
      : null;
  return typeof status === "number" && status >= 400 && status < 500;
}

function releaseTarget(version: NonNullable<AssessmentReleaseState["currentPublishedVersion"]>): DeliveryTarget {
  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    publishScope: version.publishScope,
  };
}
