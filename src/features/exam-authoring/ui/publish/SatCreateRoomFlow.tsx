import { useRef, useState, type ReactNode } from "react";
import { useExamQuery } from "../../api/examQueries";
import { useClassroomPlan } from "../../api/assessmentQueries";
import { useSatExamConfigDefaults } from "../../api/satExamConfigApi";
import { clearSatRoomDraft, peekSatRoomDraft, stashSatRoomDraft } from "../../application/satRoomDraftStore";
import { useCreateSatRoom } from "./useCreateSatRoom";
import type {
  AccessLinkMemberInput,
  AssessmentAccessLink,
} from "../../contracts/accessLinks";
import type { AssessmentValidationIssue, SatClassroomPlan, SatPublishScope } from "../../contracts/assessment";
import type { CreateRoomState, SatRoomFields, SatRoomIssue, SatRoomReceipt } from "../../contracts/satCreateRoom";
import { AccessLinkEditorSheet } from "../access-links/AccessLinkEditorSheet";
import { publishIssueDestinationLabel, resolvePublishIssueDestination } from "../release/releaseSelectors";
import { useReleaseOnline } from "../release/releaseUi";

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];
const VERSION_SUMMARY = "the latest saved exam";

interface SatCreateRoomFlowProps {
  examId: string;
  examTitle: string;
  sectionScope?: SatPublishScope;
  /** Host content above the room name (the global Rooms page's exam picker). */
  examPicker?: ReactNode;
  /** Duplicate setup: start from an earlier room's audience, entry and sections. */
  prefill?: AssessmentAccessLink | null;
  reuseOptions?: readonly AssessmentAccessLink[];
  onReuseSetup?: (link: AssessmentAccessLink) => void;
  members?: readonly AccessLinkMemberInput[];
  membersLoading?: boolean;
  membersError?: string | null;
  onRetryMembers?: () => void;
  onClose: () => void;
  onFixIssue: (issue: AssessmentValidationIssue) => void;
  onRoomCreated: (link: AssessmentAccessLink, receipt: SatRoomReceipt) => void;
}

/**
 * The one room-creation surface for a SAT exam. Staff enter room details and
 * press Create room once; the server saves-checks the exam, captures (or reuses)
 * its immutable release, and creates the room in one transaction. There is no
 * publish step, version chooser, or scope chooser here by design.
 */
export function SatCreateRoomFlow(props: SatCreateRoomFlowProps) {
  const room = useCreateSatRoom(props.examId);
  const examQuery = useExamQuery(props.examId);
  const classroomPlanQuery = useClassroomPlan(props.examId);
  const satDefaultsQuery = useSatExamConfigDefaults();
  const online = useReleaseOnline();
  // Read once per mount: an author who left to fix an exam issue returns to the
  // form they had filled in. A duplicate setup never mixes with a restored one.
  const [restoreDraft] = useState<SatRoomFields | null>(() => (props.prefill ? null : peekSatRoomDraft(props.examId)));
  const lastFieldsRef = useRef<SatRoomFields | null>(null);
  const state = room.state;
  const canEdit = examQuery.data ? examQuery.data.canEdit : true;
  const classroomAvailability = room.classroomDisabledByServer
    ? "disabled"
    : satDefaultsQuery.isFetching
      ? "checking"
      : satDefaultsQuery.isSuccess
        ? satDefaultsQuery.data.classroomCreationEnabled ? "enabled" : "disabled"
        : "unknown";

  const complete = (receipt: SatRoomReceipt) => {
    clearSatRoomDraft(props.examId);
    props.onRoomCreated(receipt.room, receipt);
  };

  const onCreate = async (fields: SatRoomFields) => {
    lastFieldsRef.current = fields;
    const receipt = await room.submit(fields);
    if (receipt) {
      complete(receipt);
      return;
    }
    // Keep the typed form for a "Fix" round trip; the host re-opens it restored.
    stashSatRoomDraft(props.examId, fields);
    throw new Error(failureSummary(room.getState()));
  };

  /** An unresolved attempt that turns out to have committed finishes exactly like a normal create. */
  const resolveUnknown = async (attempt: () => Promise<SatRoomReceipt | null>) => {
    const receipt = await attempt();
    if (receipt) {
      complete(receipt);
      props.onClose();
    }
  };

  const fixIssue = (issue: SatRoomIssue) => {
    if (lastFieldsRef.current) stashSatRoomDraft(props.examId, lastFieldsRef.current);
    props.onFixIssue({ code: issue.code, path: issue.path, message: issue.message, blocking: true });
  };

  const pendingLabel = state.status === "syncing" ? "Saving changes…" : "Creating room…";
  const submitDisabled = !online || !canEdit || state.status === "unknown" || !classroomPlanQuery.isSuccess;

  const status = (
    <section
      className="space-y-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4"
      aria-label="Exam content for this room"
    >
      <div className="space-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">This room uses {VERSION_SUMMARY}</p>
        <p>Your changes are saved automatically. Existing rooms keep the exam they were created with. No exam timer starts yet.</p>
      </div>
      <FlowNotices
        state={state}
        online={online}
        canEdit={canEdit}
        onFix={fixIssue}
        onRetry={() => void resolveUnknown(() => room.retryUnknown())}
        onCheck={() => void resolveUnknown(() => room.checkStatus())}
        onDismiss={room.dismiss}
        canRetryUnknown={room.canRetryUnknown}
      />
    </section>
  );

  return (
    <AccessLinkEditorSheet
      open
      link={null}
      prefill={props.prefill ?? null}
      restoreDraft={restoreDraft}
      providerKey="sat"
      classroomPlan={(classroomPlanQuery.data?.plan ?? null) as SatClassroomPlan | null}
      classroomPlanStatus={classroomPlanQuery.isSuccess ? "ready" : classroomPlanQuery.error ? "error" : "loading"}
      onRetryClassroomPlan={() => void classroomPlanQuery.refetch()}
      classroomAvailability={classroomAvailability}
      examTitle={props.examTitle}
      publishScope={props.sectionScope ?? examQuery.data?.satSectionScope ?? "full"}
      versionSummary={VERSION_SUMMARY}
      members={props.members ?? restoreDraft?.selectedStudents ?? EMPTY_MEMBERS}
      {...(props.membersLoading !== undefined ? { membersLoading: props.membersLoading } : {})}
      membersError={props.membersError ?? null}
      {...(props.onRetryMembers ? { onRetryMembers: props.onRetryMembers } : {})}
      isSaving={room.isBusy}
      inputsDisabled={state.status === "unknown" || !classroomPlanQuery.isSuccess}
      submitDisabled={submitDisabled}
      submitLabel="Create room"
      pendingLabel={pendingLabel}
      contentBeforeFields={
        <div className="space-y-3">
          {props.examPicker}
          {status}
        </div>
      }
      {...(props.reuseOptions ? { reuseOptions: props.reuseOptions } : {})}
      {...(props.onReuseSetup ? { onReuseSetup: props.onReuseSetup } : {})}
      onClose={() => {
        // A close that follows a successful create has nothing to keep.
        if (!room.isBusy) props.onClose();
      }}
      onCreate={onCreate}
    />
  );
}

function failureSummary(state: CreateRoomState): string {
  switch (state.status) {
    case "invalid":
      return state.issues.length > 0
        ? `Room not created — fix ${state.issues.length} exam ${state.issues.length === 1 ? "issue" : "issues"}.`
        : state.message;
    case "conflict":
    case "failed":
    case "unknown":
      return state.message;
    default:
      return "The room could not be created.";
  }
}

function FlowNotices({
  state,
  online,
  canEdit,
  onFix,
  onRetry,
  onCheck,
  onDismiss,
  canRetryUnknown,
}: {
  state: CreateRoomState;
  online: boolean;
  canEdit: boolean;
  onFix: (issue: SatRoomIssue) => void;
  onRetry: () => void;
  onCheck: () => void;
  onDismiss: () => void;
  canRetryUnknown: boolean;
}) {
  const danger = "text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]";
  return (
    <>
      {state.status === "syncing" ? <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Checking saved changes…</p> : null}
      {state.status === "creating" ? <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Preparing the exam and creating the room…</p> : null}
      {!online ? <p role="alert" className={danger}>Reconnect before creating a room. Your entries are kept.</p> : null}
      {!canEdit ? <p role="alert" className={danger}>You do not have permission to create rooms for this exam.</p> : null}
      {state.status === "invalid" ? (
        <div role="alert" className="space-y-2">
          <p className={`${danger} font-semibold`}>{failureSummary(state)}</p>
          <ul className="space-y-2" aria-label="Exam issues to fix">
            {state.issues.map((issue, index) => {
              const label = publishIssueDestinationLabel(resolvePublishIssueDestination({ path: issue.path, code: issue.code }, null));
              return (
                <li key={`${issue.code}:${issue.path}:${index}`} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--sat-staff-danger,#b42318)]/20 bg-white px-3 py-2 text-[14px] leading-5">
                  <span>{issue.message}</span>
                  {label ? (
                    <button type="button" aria-label={`Fix: ${label}`} onClick={() => onFix(issue)} className="min-h-11 shrink-0 font-semibold text-[var(--sat-staff-accent,#0071e3)]">Fix</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={onDismiss} className="sat-btn sat-btn--quiet sat-press">Dismiss</button>
        </div>
      ) : null}
      {state.status === "conflict" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <span className={danger}>{state.message}</span>
          <button type="button" onClick={onDismiss} className="sat-btn sat-btn--secondary sat-press">Review latest exam</button>
        </div>
      ) : null}
      {state.status === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <span className={danger}>{state.message}</span>
          <button type="button" onClick={onDismiss} className="sat-btn sat-btn--quiet sat-press">Dismiss</button>
        </div>
      ) : null}
      {state.status === "unknown" ? (
        <div role="alert" className="space-y-2">
          <p className={danger}>{state.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onCheck} className="sat-btn sat-btn--secondary sat-press">Check status</button>
            <button type="button" onClick={onRetry} disabled={!canRetryUnknown} className="sat-btn sat-btn--quiet sat-press">Try again</button>
          </div>
        </div>
      ) : null}
      {state.status === "created" ? <p role="status" className="text-[14px] leading-5">Room created.</p> : null}
    </>
  );
}
