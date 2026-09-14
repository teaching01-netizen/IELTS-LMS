import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Link2, LockKeyhole, Users, X } from "lucide-react";
import type {
  AccessLinkAudienceType,
  AccessLinkAvailabilityType,
  AccessLinkMemberInput,
  AccessLinkMode,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import { copyText, localDateTimeToIso, parseAccessLinkMembers, serializeAccessLinkMembers, toLocalDateTimeInput } from "./accessLinkUi";
import { describeRosterResult, rosterTemplate, validateRosterSource } from "./rosterValidation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../../../components/ui/sheet";
import { AuthoringConfirmDialog, restoreAuthoringFocus } from "../authoringPrimitives";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";

interface AccessLinkEditorSheetProps {
  open: boolean;
  link: AssessmentAccessLink | null;
  members: readonly AccessLinkMemberInput[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: (request: CreateAssessmentAccessLinkRequest) => Promise<void>;
  onUpdate: (
    linkId: string,
    request: UpdateAssessmentAccessLinkRequest,
    options?: { silent?: boolean },
  ) => Promise<void>;
}

function defaultScheduledWindow(): { opensAt: string; closesAt: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return { opensAt: toLocalDateTimeInput(start.toISOString()), closesAt: toLocalDateTimeInput(end.toISOString()) };
}

export function AccessLinkEditorSheet(props: AccessLinkEditorSheetProps) {
  const collaboration = useSatAuthoringCollaboration();
  const defaults = useMemo(defaultScheduledWindow, []);
  const [name, setName] = useState("");
  const [audienceType, setAudienceType] = useState<AccessLinkAudienceType>("anyone");
  const [audienceLabel, setAudienceLabel] = useState("");
  // Free by default: new links admit anyone, anytime, with any access code
  // (no preset roster, no scheduled window). The code field stays required
  // at check-in — any non-empty format is accepted.
  const [accessMode, setAccessMode] = useState<AccessLinkMode>("student_code");
  const [availabilityType, setAvailabilityType] = useState<AccessLinkAvailabilityType>("anytime");
  const [opensAt, setOpensAt] = useState(defaults.opensAt);
  const [closesAt, setClosesAt] = useState(defaults.closesAt);
  const [membersSource, setMembersSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const initialSnapshotRef = useRef("");
  const hydratingRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const sharedLink = props.link
    ? collaboration?.workspaceSnapshot.values[`access/${props.link.id}`]
    : undefined;
  const sharedLinkSignature =
    sharedLink && typeof sharedLink === "object" ? JSON.stringify(sharedLink) : null;
  const selfId = collaboration?.participants.find((participant) => participant.isSelf)?.id ?? null;
  const readOnly = Boolean(
    collaboration &&
      (collaboration.workspaceSnapshot.readOnly || collaboration.lifecyclePhase !== "active"),
  );

  const updateShared = (patch: Record<string, unknown>) => {
    if (!props.link || readOnly) return;
    const base = sharedLink && typeof sharedLink === "object" ? sharedLink : props.link;
    collaboration?.setValue(`access/${props.link.id}`, {
      ...(base as object),
      ...patch,
      ...(selfId ? { writerId: selfId } : {}),
    });
  };

  useEffect(() => {
    if (!props.open || !props.link || !sharedLinkSignature || !sharedLink || typeof sharedLink !== "object") return;
    const value = sharedLink as Record<string, unknown>;
    if (value["writerId"] !== selfId) hydratingRef.current = true;
    if (typeof value["name"] === "string") setName(value["name"]);
    if (value["audienceType"] === "anyone" || value["audienceType"] === "cohort" || value["audienceType"] === "selected_students") setAudienceType(value["audienceType"]);
    if (typeof value["audienceLabel"] === "string" || value["audienceLabel"] === null) setAudienceLabel(value["audienceLabel"] ?? "");
    if (value["accessMode"] === "student_code" || value["accessMode"] === "open") setAccessMode(value["accessMode"]);
    if (value["availabilityType"] === "scheduled" || value["availabilityType"] === "anytime") setAvailabilityType(value["availabilityType"]);
    if (typeof value["opensAt"] === "string" || value["opensAt"] === null) setOpensAt(value["opensAt"] ? toLocalDateTimeInput(value["opensAt"] as string) : defaults.opensAt);
    if (typeof value["closesAt"] === "string" || value["closesAt"] === null) setClosesAt(value["closesAt"] ? toLocalDateTimeInput(value["closesAt"] as string) : defaults.closesAt);
    if (typeof value["membersSource"] === "string") setMembersSource(value["membersSource"]);
  }, [defaults.closesAt, defaults.opensAt, props.link, props.open, selfId, sharedLink, sharedLinkSignature]);

  useEffect(() => {
    if (!props.open) {
      setShowDiscardDialog(false);
      setIsDirty(false);
      return;
    }
    const link = props.link;
    const nextName = link?.name ?? "";
    const nextAudienceType = link?.audienceType ?? "anyone";
    const nextAudienceLabel = link?.audienceLabel ?? "";
    const nextAccessMode = link?.accessMode ?? "student_code";
    const nextAvailabilityType = link?.availabilityType ?? "anytime";
    const nextOpensAt = link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.opensAt) : defaults.opensAt;
    const nextClosesAt = link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.closesAt) : defaults.closesAt;
    const nextMembersSource = serializeAccessLinkMembers(props.members);
    setName(nextName);
    setAudienceType(nextAudienceType);
    setAudienceLabel(nextAudienceLabel);
    setAccessMode(nextAccessMode);
    setAvailabilityType(nextAvailabilityType);
    setOpensAt(nextOpensAt);
    setClosesAt(nextClosesAt);
    setMembersSource(nextMembersSource);
    setError(null);
    setNameError(null);
    setAudienceError(null);
    setWindowError(null);
    setRosterError(null);
    initialSnapshotRef.current = editorSnapshot(
      nextName,
      nextAudienceType,
      nextAudienceLabel,
      nextAccessMode,
      nextAvailabilityType,
      nextOpensAt,
      nextClosesAt,
      nextMembersSource,
    );
    hydratingRef.current = true;
    setIsDirty(false);
  }, [defaults.closesAt, defaults.opensAt, props.link, props.members, props.open]);

  useEffect(() => {
    if (!props.open) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    setIsDirty(
      editorSnapshot(
        name,
        audienceType,
        audienceLabel,
        accessMode,
        availabilityType,
        opensAt,
        closesAt,
        membersSource,
      ) !== initialSnapshotRef.current,
    );
  }, [
    accessMode,
    audienceLabel,
    audienceType,
    availabilityType,
    closesAt,
    membersSource,
    name,
    opensAt,
    props.open,
  ]);

  const validateName = (value: string): string | null => {
    if (!value.trim()) return "Give this Student Link a name people will recognize.";
    return null;
  };
  const validateAudienceLabel = (type: AccessLinkAudienceType, label: string): string | null => {
    if ((type === "cohort" || type === "selected_students") && !label.trim()) return "Add an audience name for this link.";
    return null;
  };
  const validateWindow = (kind: AccessLinkAvailabilityType, opens: string, closes: string): string | null => {
    if (kind !== "scheduled") return null;
    const scheduledOpensAt = localDateTimeToIso(opens);
    const scheduledClosesAt = localDateTimeToIso(closes);
    if (!scheduledOpensAt || !scheduledClosesAt) return "Choose both an opening and closing time.";
    if (new Date(scheduledClosesAt) <= new Date(scheduledOpensAt)) return "Closing time must be after opening time.";
    return null;
  };
  const rosterResult = validateRosterSource(membersSource);
  const rosterSummary = audienceType === "selected_students" ? describeRosterResult(rosterResult) : "";
  const rosterRowErrors = audienceType === "selected_students" ? rosterResult.errors.slice(0, 3) : [];
  const copyRosterFormat = async () => {
    try {
      await copyText("student_code, student_name, student_email\nW123456, Jane Doe, jane@example.com");
    } catch {
      setError("Roster format could not be copied.");
    }
  };
  const validateRoster = (source: string): string | null => {
    const result = validateRosterSource(source);
    if (result.totalRows === 0) return "Add at least one selected student.";
    const first = result.errors[0];
    if (first) return first.message;
    return null;
  };

  const buildUpdateRequest = (): UpdateAssessmentAccessLinkRequest | null => {
    if (!props.link) return null;
    const selectedStudents = audienceType === "selected_students"
      ? parseAccessLinkMembers(membersSource)
      : undefined;
    return {
      revision: props.link.revision,
      name: name.trim(),
      audienceType,
      ...(audienceLabel.trim() ? { audienceLabel: audienceLabel.trim() } : { audienceLabel: null }),
      accessMode: audienceType === "selected_students" ? "student_code" : accessMode,
      availabilityType,
      ...(availabilityType === "scheduled"
        ? { opensAt: localDateTimeToIso(opensAt), closesAt: localDateTimeToIso(closesAt) }
        : { opensAt: null, closesAt: null }),
      ...(selectedStudents ? { selectedStudents } : {}),
    };
  };

  // Existing-link settings are content edits rather than structural actions:
  // the local author writes the room immediately, then the tab that owns the
  // room value materializes one debounced API update. Other tabs still render
  // the Yjs value but never duplicate the write.
  useEffect(() => {
    if (!collaboration || !props.open || !props.link || !isDirty || readOnly || !selfId || props.isSaving) return;
    const link = props.link;
    const raw = collaboration.workspaceSnapshot.values[`access/${link.id}`];
    const writerId = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["writerId"] : null;
    if (writerId !== selfId) return;
    const timer = globalThis.setTimeout(() => {
      const nextNameError = validateName(name);
      const nextAudienceError = validateAudienceLabel(audienceType, audienceLabel);
      const nextWindowError = validateWindow(availabilityType, opensAt, closesAt);
      const nextRosterError = audienceType === "selected_students" ? validateRoster(membersSource) : null;
      if (nextNameError || nextAudienceError || nextWindowError || nextRosterError) {
        setNameError(nextNameError);
        setAudienceError(nextAudienceError);
        setWindowError(nextWindowError);
        setRosterError(nextRosterError);
        return;
      }
      const request = buildUpdateRequest();
      if (!request) return;
      void props.onUpdate(link.id, request, { silent: true })
        .then(() => {
          initialSnapshotRef.current = editorSnapshot(
            name,
            audienceType,
            audienceLabel,
            accessMode,
            availabilityType,
            opensAt,
            closesAt,
            membersSource,
          );
          setIsDirty(false);
        })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : "Student Link could not be saved.");
        });
    }, 700);
    return () => globalThis.clearTimeout(timer);
  }, [
    accessMode,
    audienceLabel,
    audienceType,
    availabilityType,
    buildUpdateRequest,
    collaboration,
    closesAt,
    isDirty,
    membersSource,
    name,
    opensAt,
    props,
    readOnly,
    selfId,
    validateRoster,
  ]);

  const submit = async () => {
    if (readOnly) return;
    setError(null);
    const nextNameError = validateName(name);
    const nextAudienceError = validateAudienceLabel(audienceType, audienceLabel);
    const nextWindowError = validateWindow(availabilityType, opensAt, closesAt);
    const nextRosterError = audienceType === "selected_students" ? validateRoster(membersSource) : null;
    setNameError(nextNameError);
    setAudienceError(nextAudienceError);
    setWindowError(nextWindowError);
    setRosterError(nextRosterError);
    if (nextNameError ?? nextAudienceError ?? nextWindowError ?? nextRosterError) return;
    const normalizedName = name.trim();
    let selectedStudents: AccessLinkMemberInput[] = [];
    if (audienceType === "selected_students") {
      selectedStudents = parseAccessLinkMembers(membersSource);
    }
    const scheduledOpensAt = availabilityType === "scheduled" ? localDateTimeToIso(opensAt) : null;
    const scheduledClosesAt = availabilityType === "scheduled" ? localDateTimeToIso(closesAt) : null;
    const shared = {
      name: normalizedName,
      audienceType,
      ...(audienceLabel.trim() ? { audienceLabel: audienceLabel.trim() } : { audienceLabel: null }),
      accessMode: audienceType === "selected_students" ? "student_code" as const : accessMode,
      availabilityType,
      ...(availabilityType === "scheduled"
        ? { opensAt: scheduledOpensAt, closesAt: scheduledClosesAt }
        : { opensAt: null, closesAt: null }),
    };
    try {
      if (props.link) {
        await props.onUpdate(props.link.id, {
          revision: props.link.revision,
          ...shared,
          selectedStudents,
        });
      } else {
        await props.onCreate({
          ...shared,
          selectedStudents,
        });
      }
      setIsDirty(false);
      props.onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Student Link could not be saved.");
    }
  };

  const requestClose = () => {
    if (props.isSaving) return;
    if (isDirty) {
      setShowDiscardDialog(true);
      return;
    }
    props.onClose();
  };

  return (
    <Sheet
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          if (document.activeElement instanceof HTMLElement) {
            restoreFocusRef.current = document.activeElement;
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = restoreFocusRef.current;
          restoreFocusRef.current = null;
          restoreAuthoringFocus(opener);
        }}
        className="sat-product authoring-mobile-sheet au-elevation-sheet flex h-full w-full max-w-[520px] flex-col gap-0 border-l border-au-separator bg-au-fill p-0 sm:max-w-[520px]"
      >
            <header className="flex items-center gap-3 border-b border-au-separator px-5 py-4 authoring-glass">
              <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-slate-400">Digital SAT · Current release</p><SheetTitle className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-slate-950">{props.link ? "Edit Student Link" : "Create Student Link"}</SheetTitle>
                <SheetDescription className="sr-only">Configure who can use this Student Link, how they identify themselves, and when it is available.</SheetDescription></div>
              <button type="button" onClick={requestClose} disabled={props.isSaving} aria-label="Close Student Link editor" className="authoring-icon-button"><X size={16} aria-hidden="true"/></button>
            </header>
            <fieldset disabled={props.isSaving || readOnly} data-coedit-read-only={readOnly ? "true" : undefined} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-5">
                <Field label="Name" description="Use the name staff will recognize when sharing or monitoring this link." error={nameError} errorId="access-link-name-error"><input value={name} onChange={(event) => { setName(event.target.value); updateShared({ name: event.target.value }); if (nameError) setNameError(validateName(event.target.value)); }} onBlur={() => setNameError(validateName(name))} maxLength={160} aria-label="Student Link name" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "access-link-name-error" : undefined} className={inputClass} placeholder="Saturday Class — September" /></Field>
                <Field label="Who is this for?">
                  <div className="grid grid-cols-3 gap-2">
                    <Choice active={audienceType === "anyone"} onClick={() => { setAudienceType("anyone"); updateShared({ audienceType: "anyone" }); }} icon={<Link2 size={15} aria-hidden="true"/>} title="Anyone" subtitle="With the link" />
                    <Choice active={audienceType === "cohort"} onClick={() => { setAudienceType("cohort"); updateShared({ audienceType: "cohort" }); }} icon={<Users size={15} aria-hidden="true"/>} title="Cohort" subtitle="Named group" />
                    <Choice active={audienceType === "selected_students"} onClick={() => { setAudienceType("selected_students"); setAccessMode("student_code"); updateShared({ audienceType: "selected_students", accessMode: "student_code" }); }} icon={<LockKeyhole size={15} aria-hidden="true"/>} title="Selected" subtitle="Allowlist" />
                  </div>
                  {audienceType !== "anyone" ? <><input aria-label="Audience name" value={audienceLabel} onChange={(event) => { setAudienceLabel(event.target.value); updateShared({ audienceLabel: event.target.value }); if (audienceError) setAudienceError(validateAudienceLabel(audienceType, event.target.value)); }} onBlur={() => setAudienceError(validateAudienceLabel(audienceType, audienceLabel))} aria-invalid={audienceError ? true : undefined} aria-describedby={audienceError ? "access-link-audience-error" : undefined} className={`${inputClass} mt-2`} placeholder={audienceType === "cohort" ? "SAT September · Saturday" : "Scholarship Students"} />{audienceError ? <p id="access-link-audience-error" role="alert" className="mt-1.5 text-[11px] font-medium text-au-danger-text">{audienceError}</p> : null}</> : null}
                </Field>
                <Field label="Student identification" description={audienceType === "selected_students" ? "Selected-student links always require the allowlisted student code." : "Choose how this link identifies a student."}>
                  <div className="authoring-segmented flex w-full rounded-xl p-1">
                    <Segment active={accessMode === "student_code"} onClick={() => { setAccessMode("student_code"); updateShared({ accessMode: "student_code" }); }}>Require student code</Segment>
                    <Segment active={accessMode === "open"} disabled={audienceType === "selected_students"} onClick={() => { setAccessMode("open"); updateShared({ accessMode: "open" }); }}>Name + email only</Segment>
                  </div>
                </Field>
                {audienceType === "selected_students" ? <Field label="Selected students" description="One student per line: code, name, email. Name and email are optional; code is required." error={rosterError} errorId="access-link-roster-error"><div className="mb-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { const next = membersSource ? `${membersSource.trimEnd()}\nW123456, Jane Doe, jane@example.com` : rosterTemplate(); setMembersSource(next); updateShared({ membersSource: next }); setRosterError(null); }} className="flex min-h-9 items-center rounded-lg bg-au-fill px-3 text-[11px] font-semibold text-slate-600 hover:bg-au-fill-strong">Insert template</button><button type="button" onClick={() => { void copyRosterFormat(); }} className="flex min-h-9 items-center rounded-lg px-3 text-[11px] font-semibold text-slate-500 hover:bg-au-fill">Copy format</button><span role="status" aria-live="polite" className="text-[11px] font-medium text-slate-500">{rosterSummary}</span></div><textarea aria-label="Selected students" value={membersSource} onChange={(event) => { setMembersSource(event.target.value); updateShared({ membersSource: event.target.value }); if (rosterError) setRosterError(validateRoster(event.target.value)); }} onBlur={() => setRosterError(validateRoster(membersSource))} aria-invalid={rosterError ? true : undefined} aria-describedby={rosterError ? "access-link-roster-error access-link-roster-hint" : "access-link-roster-hint"} spellCheck={false} className="min-h-36 w-full resize-y rounded-xl border border-au-separator bg-au-surface px-3 py-2.5 font-mono text-[12px] leading-5 outline-none focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10" placeholder={'W123456, Jane Doe, jane@example.com\nW123457, John Doe, john@example.com'} /><p id="access-link-roster-hint" className="mt-1.5 text-[11px] leading-4 text-slate-500">Codes must be unique. Email is optional but must look like name@example.com.</p>{rosterRowErrors.length ? <ul className="mt-2 space-y-1" aria-label="Roster issues">{rosterRowErrors.map((issue) => <li key={issue.row} className="text-[11px] font-medium text-au-danger-text">Row {issue.row}: {issue.message.replace(/^Row \d+[:\s]*/, "")}</li>)}{rosterResult.errors.length > rosterRowErrors.length ? <li className="text-[11px] text-slate-500">+{rosterResult.errors.length - rosterRowErrors.length} more — fix these first, then review the rest.</li> : null}</ul> : null}</Field> : null}
                <Field label="When can students enter?">
                  <div className="grid grid-cols-2 gap-2">
                    <Choice active={availabilityType === "scheduled"} onClick={() => { setAvailabilityType("scheduled"); updateShared({ availabilityType: "scheduled" }); }} icon={<Clock3 size={15} aria-hidden="true"/>} title="Scheduled" subtitle="Set a window" />
                    <Choice active={availabilityType === "anytime"} onClick={() => { setAvailabilityType("anytime"); updateShared({ availabilityType: "anytime", opensAt: null, closesAt: null }); }} icon={<Link2 size={15} aria-hidden="true"/>} title="Anytime" subtitle="While active" />
                  </div>
                  {availabilityType === "scheduled" ? <><div className="mt-2 grid grid-cols-2 gap-2"><label htmlFor="access-link-opens-at" className="text-[11px] font-medium text-slate-500">Opens<input id="access-link-opens-at" aria-label="Opens" type="datetime-local" value={opensAt} onChange={(event) => { setOpensAt(event.target.value); updateShared({ opensAt: localDateTimeToIso(event.target.value) }); if (windowError) setWindowError(validateWindow(availabilityType, event.target.value, closesAt)); }} onBlur={() => setWindowError(validateWindow(availabilityType, opensAt, closesAt))} aria-invalid={windowError ? true : undefined} aria-describedby={windowError ? "access-link-window-error" : undefined} className={`${inputClass} mt-1`} /></label><label htmlFor="access-link-closes-at" className="text-[11px] font-medium text-slate-500">Closes<input id="access-link-closes-at" aria-label="Closes" type="datetime-local" value={closesAt} onChange={(event) => { setClosesAt(event.target.value); updateShared({ closesAt: localDateTimeToIso(event.target.value) }); if (windowError) setWindowError(validateWindow(availabilityType, opensAt, event.target.value)); }} onBlur={() => setWindowError(validateWindow(availabilityType, opensAt, closesAt))} aria-invalid={windowError ? true : undefined} aria-describedby={windowError ? "access-link-window-error" : undefined} className={`${inputClass} mt-1`} /></label></div>{windowError ? <p id="access-link-window-error" role="alert" className="mt-1.5 text-[11px] font-medium text-au-danger-text">{windowError}</p> : null}</> : <div className="mt-2 rounded-xl bg-au-surface px-3 py-3 text-[11px] leading-5 text-slate-500">Students can enter whenever this link is Active. Pause or revoke it at any time without changing the published exam.</div>}
                </Field>
              </div>
            </fieldset>
            <footer className="border-t border-au-separator px-5 py-4 authoring-glass">
              {error ? <p role="alert" className="mb-3 rounded-xl bg-au-danger-tint px-3 py-2 text-[11px] font-medium text-au-danger-text">{error}</p> : null}
              <div className="flex justify-end gap-2"><button type="button" onClick={requestClose} disabled={props.isSaving} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-au-fill">Cancel</button><button type="button" onClick={() => void submit()} disabled={props.isSaving || readOnly} className="min-h-11 rounded-xl bg-au-accent px-5 text-sm font-semibold text-white hover:bg-au-accent-hover disabled:opacity-45">{props.isSaving ? "Saving…" : readOnly ? "View only" : props.link ? "Save Changes" : "Create Link"}</button></div>
            </footer>
      </SheetContent>
      <AuthoringConfirmDialog
        open={showDiscardDialog}
        title="Discard Student Link changes?"
        description="Your unsaved Student Link settings will be lost."
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setShowDiscardDialog(false)}
        onConfirm={() => {
          setShowDiscardDialog(false);
          setIsDirty(false);
          props.onClose();
        }}
      />
    </Sheet>
  );
}

function editorSnapshot(
  name: string,
  audienceType: AccessLinkAudienceType,
  audienceLabel: string,
  accessMode: AccessLinkMode,
  availabilityType: AccessLinkAvailabilityType,
  opensAt: string,
  closesAt: string,
  membersSource: string,
): string {
  return JSON.stringify([
    name,
    audienceType,
    audienceLabel,
    accessMode,
    availabilityType,
    opensAt,
    closesAt,
    membersSource,
  ]);
}

const inputClass = "h-11 w-full rounded-xl border border-au-separator bg-au-surface px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10";
function Field({ label, description, error, errorId, children }: { label: string; description?: string; error?: string | null; errorId?: string; children: React.ReactNode }) { return <section><div className="mb-2"><h3 className="text-[12px] font-semibold text-slate-800">{label}</h3>{description ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{description}</p> : null}</div>{children}{error ? <p id={errorId} role="alert" className="mt-1.5 text-[11px] font-medium text-au-danger-text">{error}</p> : null}</section>; }
function Choice({ active, onClick, icon, title, subtitle }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-[68px] rounded-xl border p-2.5 text-left transition ${active ? "border-au-accent/35 bg-au-accent-tint text-au-accent" : "border-au-separator bg-au-surface text-slate-600 hover:bg-au-fill"}`}><span className="flex items-center gap-1.5 text-[11px] font-semibold"><span aria-hidden="true">{icon}</span>{title}</span><span className="mt-1 block text-[10px] font-medium text-slate-500">{subtitle}</span></button>; }
function Segment({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-[11px] font-semibold transition ${active ? "bg-au-surface text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"} disabled:opacity-35`}>{children}</button>; }
