import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Link2, LockKeyhole, X } from "lucide-react";
import {
  ACCESS_LINK_SECTION_KEYS,
  ACCESS_LINK_SECTION_LABELS,
  availableAccessLinkSections,
  accessLinkSectionRequest,
  accessLinkSectionsChanged,
  editableAccessLinkSections,
  effectiveAccessLinkSections,
  selectedAccessLinkSections,
  accessLinkAudienceChoice,
  accessLinkAudienceTypeFor,
  type AccessLinkAudienceType,
  type AccessLinkAvailabilityType,
  type AccessLinkMemberInput,
  type AccessLinkMode,
  type AccessLinkSectionKey,
  type AssessmentAccessLink,
  type CreateAssessmentAccessLinkRequest,
  type UpdateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import type { SatPublishScope } from "../../contracts/assessment";
import { copyText, localDateTimeToIso, parseAccessLinkMembers, serializeAccessLinkMembers, toLocalDateTimeInput } from "./accessLinkUi";
import { describeRosterResult, rosterTemplate, validateRosterSource } from "./rosterValidation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../../../components/ui/sheet";
import { AuthoringConfirmDialog, restoreAuthoringFocus } from "../authoringPrimitives";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";
import { validateSatScheduleTimes } from "../../../../products/sat/routes/scheduleValidation";

interface AccessLinkEditorSheetProps {
  open: boolean;
  link: AssessmentAccessLink | null;
  /**
   * The exam's provider, for a NEW link (an existing link carries its own
   * providerKey). The section toggles are SAT-only.
   */
  providerKey?: string | null;
  /** Current published scope for a new link; existing links carry their pin. */
  publishScope?: SatPublishScope;
  /** The version a NEW link will be pinned to, shown so the target is never implicit. */
  targetVersionNumber?: number | null;
  /** The test's title, shown in the SAT pre-submit summary. An existing link carries its own. */
  examTitle?: string | null;
  /**
   * Duplicate setup: a new group pre-filled from this one's audience, entry
   * requirement and sections. Availability starts from the defaults so the new
   * window is always an explicit choice.
   */
  prefill?: AssessmentAccessLink | null;
  /**
   * Earlier sessions of this exam. When given (new session only) the form offers
   * "Start from an earlier session", which re-opens the form as a duplicate setup.
   */
  reuseOptions?: readonly AssessmentAccessLink[];
  onReuseSetup?: (link: AssessmentAccessLink) => void;
  members: readonly AccessLinkMemberInput[];
  isSaving: boolean;
  membersLoading?: boolean;
  membersError?: string | null;
  onRetryMembers?: () => void;
  onClose: () => void;
  onCreate: (request: CreateAssessmentAccessLinkRequest) => Promise<void>;
  /** Required to edit an existing session; a host that only creates sessions omits it. */
  onUpdate?: (
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
  // Both sections by default: a new link is unscoped (stored NULL), which is
  // what every link created before this feature holds.
  const [sections, setSections] = useState<AccessLinkSectionKey[]>([...ACCESS_LINK_SECTION_KEYS]);
  const [membersSource, setMembersSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const initialSnapshotRef = useRef("");
  const hydratingRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const sharedLink = props.link
    ? collaboration?.workspaceSnapshot.values[`access/${props.link.id}`]
    : undefined;
  const sharedLinkSignature =
    sharedLink && typeof sharedLink === "object" ? JSON.stringify(sharedLink) : null;
  const selfId = collaboration?.participants.find((participant) => participant.isSelf)?.id ?? null;
  // "Disabled" is the no-room posture (no editable draft): not read-only, just
  // a link this sheet edits through its own HTTP path.
  const readOnly = Boolean(
    collaboration &&
      collaboration.status !== "disabled" &&
      (collaboration.workspaceSnapshot.readOnly || collaboration.lifecyclePhase !== "active"),
  );
  // Section scope is SAT-only, and it freezes at the first student: runtime
  // sections are built at proctor start, so a later edit either does nothing to
  // that run or silently changes the sitting a registered student expected.
  const isSat = (props.link?.providerKey ?? props.providerKey) === "sat";
  const audienceChoice = accessLinkAudienceChoice(audienceType);
  const pinnedPublishScope = props.link?.publishScope ?? props.publishScope ?? "full";
  const releaseSections = availableAccessLinkSections(pinnedPublishScope);
  const sectionsLocked = Boolean(props.link?.hasParticipation);
  const summaryTest = props.link?.examTitle ?? props.examTitle ?? "Selected test";
  const summaryVersion = props.link?.versionNumber ?? props.targetVersionNumber ?? "being published";
  const checkInSummary = availabilityType === "scheduled"
    ? `${formatLocalDateTime(opensAt)} to ${formatLocalDateTime(closesAt)} (${localTimeZone()})`
    : "Open now, until paused or revoked";

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
    // A malformed scope from another tab (or an older client) must hydrate
    // safely: anything that is not a string array falls back to "both".
    const sharedSections = value["enabledSections"];
    if (sharedSections === null || Array.isArray(sharedSections)) {
      const sharedScope = selectedAccessLinkSections(
        Array.isArray(sharedSections)
          ? sharedSections.filter((entry): entry is string => typeof entry === "string")
          : null,
      ).filter((key) => releaseSections.includes(key));
      setSections(sharedScope.length > 0 ? sharedScope : releaseSections);
    }
    if (typeof value["membersSource"] === "string") setMembersSource(value["membersSource"]);
  }, [defaults.closesAt, defaults.opensAt, props.link, props.open, selfId, sharedLink, sharedLinkSignature, pinnedPublishScope]);

  useEffect(() => {
    if (!props.open) {
      setShowDiscardDialog(false);
      setIsDirty(false);
      return;
    }
    const link = props.link;
    const source = link ?? props.prefill ?? null;
    const nextName = link?.name ?? (props.prefill ? `${props.prefill.name} (copy)` : "");
    const nextAudienceType = source?.audienceType ?? "anyone";
    const nextAudienceLabel = source?.audienceLabel ?? "";
    const nextAccessMode = source?.accessMode ?? "student_code";
    const nextAvailabilityType = link?.availabilityType ?? props.prefill?.availabilityType ?? "anytime";
    const nextOpensAt = link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.opensAt) : defaults.opensAt;
    const nextClosesAt = link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.closesAt) : defaults.closesAt;
    const nextSections = editableAccessLinkSections(source?.enabledSections, link?.publishScope ?? props.publishScope ?? "full");
    const nextMembersSource = serializeAccessLinkMembers(props.members);
    setName(nextName);
    setAudienceType(nextAudienceType);
    setAudienceLabel(nextAudienceLabel);
    setAccessMode(nextAccessMode);
    setAvailabilityType(nextAvailabilityType);
    setOpensAt(nextOpensAt);
    setClosesAt(nextClosesAt);
    setSections(nextSections);
    setMembersSource(nextMembersSource);
    setError(null);
    setNameError(null);
    setWindowError(null);
    setSectionsError(null);
    setRosterError(null);
    initialSnapshotRef.current = editorSnapshot(
      nextName,
      nextAudienceType,
      nextAudienceLabel,
      nextAccessMode,
      nextAvailabilityType,
      nextOpensAt,
      nextClosesAt,
      nextSections,
      nextMembersSource,
    );
    hydratingRef.current = true;
    setIsDirty(false);
  }, [defaults.closesAt, defaults.opensAt, props.link, props.members, props.open, props.prefill, props.publishScope]);

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
        sections,
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
    sections,
  ]);

  const validateName = (value: string): string | null => {
    if (!value.trim()) return "Give this session a name people will recognize.";
    return null;
  };
  const validateWindow = (kind: AccessLinkAvailabilityType, opens: string, closes: string): string | null => {
    if (kind !== "scheduled") return null;
    const scheduledOpensAt = localDateTimeToIso(opens);
    const scheduledClosesAt = localDateTimeToIso(closes);
    if (!scheduledOpensAt || !scheduledClosesAt) return "Choose both an opening and closing time.";
    if (new Date(scheduledClosesAt) <= new Date(scheduledOpensAt)) return "Closing time must be after opening time.";
    // D2 scheduling policy for a NEW SAT session: no past opening, at least 15 minutes.
    // An existing session keeps its stored window editable (it may legitimately be in the past).
    if (isSat && !props.link) {
      const policy = validateSatScheduleTimes(opens, closes);
      return policy.start ?? policy.end ?? null;
    }
    return null;
  };
  const validateSections = (selection: readonly AccessLinkSectionKey[]): string | null => {
    if (!isSat) return null;
    if (selection.length === 0) return "A session needs at least one section.";
    return null;
  };
  const toggleSection = (key: AccessLinkSectionKey) => {
    if (sectionsLocked || !releaseSections.includes(key)) return;
    const next = sections.includes(key)
      ? sections.filter((entry) => entry !== key)
      : releaseSections.filter((entry) => entry === key || sections.includes(entry));
    setSections(next);
    updateShared({ enabledSections: accessLinkSectionRequest(next) ?? [] });
    setSectionsError(validateSections(next));
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
      // Sent only when the scope actually changes: an omitted field keeps the
      // stored scope, so an untouched editor can never clear (or fail to clear)
      // a scope the link already has.
      ...(accessLinkSectionsChanged(props.link.enabledSections, sections)
        ? { enabledSections: accessLinkSectionRequest(sections) ?? [] }
        : {}),
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
    if (!collaboration || !props.open || !props.link || !props.onUpdate || !isDirty || readOnly || !selfId || props.isSaving) return;
    const link = props.link;
    const onUpdate = props.onUpdate;
    const raw = collaboration.workspaceSnapshot.values[`access/${link.id}`];
    const writerId = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["writerId"] : null;
    if (writerId !== selfId) return;
    const timer = globalThis.setTimeout(() => {
      const nextNameError = validateName(name);
      const nextWindowError = validateWindow(availabilityType, opensAt, closesAt);
      const nextSectionsError = validateSections(sections);
      const nextRosterError = audienceType === "selected_students" ? validateRoster(membersSource) : null;
      if (nextNameError || nextWindowError || nextSectionsError || nextRosterError) {
        setNameError(nextNameError);
        setWindowError(nextWindowError);
        setSectionsError(nextSectionsError);
        setRosterError(nextRosterError);
        return;
      }
      const request = buildUpdateRequest();
      if (!request) return;
      void onUpdate(link.id, request, { silent: true })
        .then(() => {
          initialSnapshotRef.current = editorSnapshot(
            name,
            audienceType,
            audienceLabel,
            accessMode,
            availabilityType,
            opensAt,
            closesAt,
            sections,
            membersSource,
          );
          setIsDirty(false);
        })
        .catch((saveError: unknown) => {
          setError(saveError instanceof Error ? saveError.message : "The session could not be saved.");
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
    sections,
    selfId,
    validateRoster,
    validateSections,
  ]);

  const submit = async () => {
    if (submittingRef.current || props.isSaving || props.membersLoading || props.membersError) return;
    if (readOnly) return;
    setError(null);
    const nextNameError = validateName(name);
    const nextWindowError = validateWindow(availabilityType, opensAt, closesAt);
    const nextSectionsError = validateSections(sections);
    const nextRosterError = audienceType === "selected_students" ? validateRoster(membersSource) : null;
    setNameError(nextNameError);
    setWindowError(nextWindowError);
    setSectionsError(nextSectionsError);
    setRosterError(nextRosterError);
    if (nextNameError ?? nextWindowError ?? nextSectionsError ?? nextRosterError) return;
    const normalizedName = name.trim();
    let selectedStudents: AccessLinkMemberInput[] = [];
    if (audienceType === "selected_students") {
      selectedStudents = parseAccessLinkMembers(membersSource);
    }
    const scheduledOpensAt = availabilityType === "scheduled" ? localDateTimeToIso(opensAt) : null;
    const scheduledClosesAt = availabilityType === "scheduled" ? localDateTimeToIso(closesAt) : null;
    const shared = {
      name: normalizedName,
      // Create always states the scope ([] = all sections, the stored NULL
      // shape); update states it only when it changed.
      ...(props.link
        ? accessLinkSectionsChanged(props.link.enabledSections, sections)
          ? { enabledSections: accessLinkSectionRequest(sections) ?? [] }
          : {}
        : { enabledSections: accessLinkSectionRequest(sections) ?? [] }),
      audienceType,
      ...(audienceLabel.trim() ? { audienceLabel: audienceLabel.trim() } : { audienceLabel: null }),
      accessMode: audienceType === "selected_students" ? "student_code" as const : accessMode,
      availabilityType,
      ...(availabilityType === "scheduled"
        ? { opensAt: scheduledOpensAt, closesAt: scheduledClosesAt }
        : { opensAt: null, closesAt: null }),
    };
    submittingRef.current = true;
    try {
      if (props.link) {
        if (!props.onUpdate) throw new Error("This session cannot be edited here.");
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
      setError(saveError instanceof Error ? saveError.message : "The session could not be saved.");
    } finally {
      submittingRef.current = false;
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
              <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-slate-400">Digital SAT · Version {props.link?.versionNumber ?? props.targetVersionNumber ?? "being published"}</p><SheetTitle className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-slate-950">{props.link ? "Edit session setup" : props.prefill ? "Duplicate session setup" : "Create session"}</SheetTitle>
                <SheetDescription className="sr-only">Set up who can join this session, how they identify themselves, and when check-in is open.</SheetDescription></div>
              <button type="button" onClick={requestClose} disabled={props.isSaving} aria-label="Close session setup" className="authoring-icon-button"><X size={16} aria-hidden="true"/></button>
            </header>
            {props.membersLoading ? <p role="status" className="px-5 py-3 text-sm text-slate-600">Loading student roster…</p> : null}
            {props.membersError ? <div role="alert" className="px-5 py-3 text-sm text-red-700">{props.membersError}<button type="button" onClick={props.onRetryMembers} className="min-h-11 px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry roster</button></div> : null}
            <fieldset disabled={props.isSaving || readOnly || props.membersLoading || Boolean(props.membersError)} data-coedit-read-only={readOnly ? "true" : undefined} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-5">
                {!props.link && props.prefill ? (
                  <p role="note" className="rounded-xl bg-au-accent/10 p-3 text-[12px] leading-5 text-slate-700">
                    Creates a new session on <strong>Version {props.targetVersionNumber ?? "—"}</strong> with the audience, identification and sections of “{props.prefill.name}”. Choose its check-in window below.
                  </p>
                ) : null}
                {!props.link && !props.prefill && !isDirty && props.onReuseSetup && props.reuseOptions && props.reuseOptions.length > 0 ? (
                  <Field label="Start from an earlier session (optional)" description="Copies its audience, identification and sections. You still choose the check-in window.">
                    <select
                      aria-label="Start from an earlier session"
                      value=""
                      onChange={(event) => {
                        const chosen = props.reuseOptions?.find((link) => link.id === event.target.value);
                        if (chosen) props.onReuseSetup?.(chosen);
                      }}
                      className={inputClass}
                    >
                      <option value="">Start from scratch</option>
                      {props.reuseOptions.map((link) => <option key={link.id} value={link.id}>{link.name} · Version {link.versionNumber}</option>)}
                    </select>
                  </Field>
                ) : null}
                {isSat ? <h2 className="mb-2 text-sm font-semibold text-slate-950">Session details</h2> : null}
                <Field label="Session name" description="Use the name staff will recognize when sharing or monitoring this session." error={nameError} errorId="access-link-name-error"><input value={name} onChange={(event) => { setName(event.target.value); updateShared({ name: event.target.value }); if (nameError) setNameError(validateName(event.target.value)); }} onBlur={() => setNameError(validateName(name))} maxLength={160} aria-label="Session name" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "access-link-name-error" : undefined} className={inputClass} placeholder="Saturday morning mock" /></Field>
                <Field label="Class or group (optional)" description="A label for your own organization. It does not limit who can join.">
                  <input
                    aria-label="Class or group label"
                    value={audienceLabel}
                    maxLength={255}
                    onChange={(event) => {
                      const next = event.target.value;
                      setAudienceLabel(next);
                      if (audienceChoice === "listed") {
                        updateShared({ audienceLabel: next });
                        return;
                      }
                      const nextType = accessLinkAudienceTypeFor("anyone", next);
                      setAudienceType(nextType);
                      updateShared({ audienceLabel: next, audienceType: nextType });
                    }}
                    className={inputClass}
                    placeholder="SAT September · Saturday"
                  />
                </Field>
                {isSat ? <Field label="Sections" description={sectionsLocked ? "Sections are fixed once a student has joined this session. Duplicate its setup to change the scope." : `Choose from the sections enabled in Version ${props.link?.versionNumber ?? props.targetVersionNumber ?? "being published"}. The exam ends after the last section.`} error={sectionsError} errorId="access-link-sections-error"><div className={`grid gap-2 ${releaseSections.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>{releaseSections.map((key) => <SectionToggle key={key} label={ACCESS_LINK_SECTION_LABELS[key]} active={sections.includes(key)} locked={sectionsLocked} onToggle={() => toggleSection(key)} />)}</div>{props.link && effectiveAccessLinkSections(props.link.enabledSections, pinnedPublishScope).length === 0 ? <p role="status" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-4 text-amber-800">{sectionsLocked ? "This session has no available sections and is fixed because a student has joined. Create a new session with an available section." : "This session’s saved section is not available in its published version. Saving will update it to the available section."}</p> : null}<p className="mt-2 text-[12px] leading-4 text-slate-500">{sectionsSummary(sections, sectionsLocked)}</p></Field> : null}
                {isSat ? <h2 className="mb-2 text-sm font-semibold text-slate-950">Students</h2> : null}
                <Field label="Who can join?" description={audienceChoice === "listed" ? "Only students on the list below are admitted. Anyone else is turned away at check-in." : "Anyone who has the session link can check in. A student code identifies a student; it is not checked against a roster."}>
                  <div className="grid grid-cols-2 gap-2">
                    <Choice active={audienceChoice === "anyone"} onClick={() => { const nextType = accessLinkAudienceTypeFor("anyone", audienceLabel); setAudienceType(nextType); updateShared({ audienceType: nextType }); }} icon={<Link2 size={15} aria-hidden="true"/>} title="Anyone with the link" subtitle="No roster check" />
                    <Choice active={audienceChoice === "listed"} onClick={() => { setAudienceType("selected_students"); setAccessMode("student_code"); updateShared({ audienceType: "selected_students", accessMode: "student_code" }); }} icon={<LockKeyhole size={15} aria-hidden="true"/>} title="Listed students only" subtitle="Checked at check-in" />
                  </div>
                </Field>
                <Field label="Student identification" description={audienceChoice === "listed" ? "Listed students must enter their listed student code. It is checked at check-in." : "Choose how students identify themselves. This identifies a student; it does not verify them."}>
                  <div className="authoring-segmented flex w-full rounded-xl p-1">
                    <Segment active={accessMode === "student_code"} onClick={() => { setAccessMode("student_code"); updateShared({ accessMode: "student_code" }); }}>Require student code</Segment>
                    <Segment active={accessMode === "open"} disabled={audienceType === "selected_students"} onClick={() => { setAccessMode("open"); updateShared({ accessMode: "open" }); }}>Name + email only</Segment>
                  </div>
                </Field>
                {audienceType === "selected_students" ? <Field label="Selected students" description="One student per line: code, name, email. Name and email are optional; code is required." error={rosterError} errorId="access-link-roster-error"><div className="mb-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { const next = membersSource ? `${membersSource.trimEnd()}\nW123456, Jane Doe, jane@example.com` : rosterTemplate(); setMembersSource(next); updateShared({ membersSource: next }); setRosterError(null); }} className="sat-press sat-press-fill flex min-h-11 items-center rounded-lg bg-au-fill px-3 text-[12px] font-semibold text-slate-600 hover:bg-au-fill-strong">Insert template</button><button type="button" onClick={() => { void copyRosterFormat(); }} className="sat-press sat-press-fill flex min-h-11 items-center rounded-lg px-3 text-[12px] font-semibold text-slate-500 hover:bg-au-fill">Copy format</button><span role="status" aria-live="polite" className="text-[12px] font-medium text-slate-500">{rosterSummary}</span></div><textarea aria-label="Selected students" value={membersSource} onChange={(event) => { setMembersSource(event.target.value); updateShared({ membersSource: event.target.value }); if (rosterError) setRosterError(validateRoster(event.target.value)); }} onBlur={() => setRosterError(validateRoster(membersSource))} aria-invalid={rosterError ? true : undefined} aria-describedby={rosterError ? "access-link-roster-error access-link-roster-hint" : "access-link-roster-hint"} spellCheck={false} className="min-h-36 w-full resize-y rounded-xl border border-au-separator bg-au-surface px-3 py-2.5 font-mono text-[12px] leading-5 outline-none focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10" placeholder={'W123456, Jane Doe, jane@example.com\nW123457, John Doe, john@example.com'} /><p id="access-link-roster-hint" className="mt-1.5 text-[12px] leading-4 text-slate-500">Codes must be unique. Email is optional but must look like name@example.com.</p>{rosterRowErrors.length ? <ul className="mt-2 space-y-1" aria-label="Roster issues">{rosterRowErrors.map((issue) => <li key={issue.row} className="text-[12px] font-medium text-au-danger-text">Row {issue.row}: {issue.message.replace(/^Row \d+[:\s]*/, "")}</li>)}{rosterResult.errors.length > rosterRowErrors.length ? <li className="text-[12px] text-slate-500">+{rosterResult.errors.length - rosterRowErrors.length} more — fix these first, then review the rest.</li> : null}</ul> : null}</Field> : null}
                {isSat ? <h2 className="mb-2 text-sm font-semibold text-slate-950">Check-in window</h2> : null}
                <Field label="Check-in" description="Students can join during this window. The proctor starts the exam.">
                  <div className="grid grid-cols-2 gap-2">
                    <Choice active={availabilityType === "scheduled"} onClick={() => { setAvailabilityType("scheduled"); updateShared({ availabilityType: "scheduled" }); }} icon={<Clock3 size={15} aria-hidden="true"/>} title="Scheduled window" subtitle="Choose when it opens" />
                    <Choice active={availabilityType === "anytime"} onClick={() => { setAvailabilityType("anytime"); updateShared({ availabilityType: "anytime", opensAt: null, closesAt: null }); }} icon={<Link2 size={15} aria-hidden="true"/>} title="Open now" subtitle="Until paused or revoked" />
                  </div>
                  {availabilityType === "scheduled" ? <><div className="mt-2 grid grid-cols-2 gap-2"><label htmlFor="access-link-opens-at" className="text-[12px] font-medium text-slate-500">Opens<input id="access-link-opens-at" aria-label="Opens" type="datetime-local" value={opensAt} onChange={(event) => { setOpensAt(event.target.value); updateShared({ opensAt: localDateTimeToIso(event.target.value) }); if (windowError) setWindowError(validateWindow(availabilityType, event.target.value, closesAt)); }} onBlur={() => setWindowError(validateWindow(availabilityType, opensAt, closesAt))} aria-invalid={windowError ? true : undefined} aria-describedby={windowError ? "access-link-window-error" : undefined} className={`${inputClass} mt-1`} /></label><label htmlFor="access-link-closes-at" className="text-[12px] font-medium text-slate-500">Closes<input id="access-link-closes-at" aria-label="Closes" type="datetime-local" value={closesAt} onChange={(event) => { setClosesAt(event.target.value); updateShared({ closesAt: localDateTimeToIso(event.target.value) }); if (windowError) setWindowError(validateWindow(availabilityType, opensAt, event.target.value)); }} onBlur={() => setWindowError(validateWindow(availabilityType, opensAt, closesAt))} aria-invalid={windowError ? true : undefined} aria-describedby={windowError ? "access-link-window-error" : undefined} className={`${inputClass} mt-1`} /></label></div>{windowError ? <p id="access-link-window-error" role="alert" className="mt-1.5 text-[12px] font-medium text-au-danger-text">{windowError}</p> : null}</> : <div className="mt-2 rounded-xl bg-au-surface px-3 py-3 text-[12px] leading-5 text-slate-500">Students can check in until you pause or revoke this session’s link. Pausing check-in does not stop students who are already taking the exam.</div>}
                  <p className="mt-2 text-[12px] leading-4 text-slate-500">{availabilityType === "scheduled" ? `Times use your local timezone (${localTimeZone()}). ` : ""}Opening check-in never starts the exam.</p>
                </Field>
                {isSat ? (
                  <section aria-labelledby="access-link-summary-heading" className="rounded-xl bg-au-surface px-4 py-3">
                    <h2 id="access-link-summary-heading" className="mb-2 text-sm font-semibold text-slate-950">Summary</h2>
                    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-[12px] leading-5">
                      <dt className="font-medium text-slate-500">Test</dt>
                      <dd className="text-slate-900">{summaryTest} · Version {summaryVersion}</dd>
                      <dt className="font-medium text-slate-500">Who can join</dt>
                      <dd className="text-slate-900">{audienceChoice === "listed" ? "Listed students only" : "Anyone with the link"}</dd>
                      <dt className="font-medium text-slate-500">Sections</dt>
                      <dd className="text-slate-900">{sectionsPlainText(sections)}</dd>
                      <dt className="font-medium text-slate-500">Check-in</dt>
                      <dd className="text-slate-900">{checkInSummary}</dd>
                    </dl>
                    <p className="mt-3 text-[12px] leading-4 text-slate-600">The proctor starts the exam.</p>
                  </section>
                ) : null}
              </div>
            </fieldset>
            <footer className="border-t border-au-separator px-5 py-4 authoring-glass">
              {error ? <p role="alert" className="mb-3 rounded-xl bg-au-danger-tint px-3 py-2 text-[12px] font-medium text-au-danger-text">{error}</p> : null}
              <div className="flex justify-end gap-2"><button type="button" onClick={requestClose} disabled={props.isSaving} className="sat-press sat-press-fill min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-au-fill">Cancel</button>{/* The primary action keeps its own box while pending (min-w covers the
                  longest label and the spinner) and stays enabled so the press is never
                  cancelled by focus loss; the handler and aria-disabled own the guard. */}<button type="button" onClick={() => { if (props.isSaving) return; void submit(); }} disabled={readOnly || props.membersLoading || Boolean(props.membersError)} aria-busy={props.isSaving || undefined} aria-disabled={readOnly ? true : undefined} className="sat-press sat-press-fill-accent flex min-h-11 min-w-[8.5rem] items-center justify-center gap-2 rounded-xl bg-au-accent px-5 text-sm font-semibold text-white hover:bg-au-accent-hover disabled:opacity-45">{props.isSaving ? <span aria-hidden="true" className="sat-spinner block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white/40 border-t-white" /> : null}{props.isSaving ? "Saving…" : readOnly ? "View only" : props.link ? "Save changes" : "Create session"}</button></div>
            </footer>
      </SheetContent>
      <AuthoringConfirmDialog
        open={showDiscardDialog}
        title="Discard session setup changes?"
        description="Your unsaved session settings will be lost."
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

function formatLocalDateTime(value: string): string {
  const iso = localDateTimeToIso(value);
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "not set";
}

/** The summary's plain-language scope: which sections a sitting includes. */
function sectionsPlainText(selection: readonly AccessLinkSectionKey[]): string {
  if (selection.length === 0) return "None selected";
  if (ACCESS_LINK_SECTION_KEYS.every((key) => selection.includes(key))) return "Both sections, with a total score";
  return `${sectionLabels(selection)} only`;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
}

function editorSnapshot(
  name: string,
  audienceType: AccessLinkAudienceType,
  audienceLabel: string,
  accessMode: AccessLinkMode,
  availabilityType: AccessLinkAvailabilityType,
  opensAt: string,
  closesAt: string,
  sections: readonly AccessLinkSectionKey[],
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
    accessLinkSectionRequest(sections),
    membersSource,
  ]);
}

const inputClass = "h-11 w-full rounded-xl border border-au-separator bg-au-surface px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-au-accent/35 focus:ring-4 focus:ring-au-accent/10";
function Field({ label, description, error, errorId, children }: { label: string; description?: string; error?: string | null; errorId?: string; children: React.ReactNode }) { return <section><div className="mb-2"><h3 className="text-[12px] font-semibold text-slate-800">{label}</h3>{description ? <p className="mt-0.5 text-[12px] leading-4 text-slate-500">{description}</p> : null}</div>{children}{error ? <p id={errorId} role="alert" className="mt-1.5 text-[12px] font-medium text-au-danger-text">{error}</p> : null}</section>; }
function Choice({ active, onClick, icon, title, subtitle }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`sat-press sat-press-fill min-h-[68px] rounded-xl border p-2.5 text-left ${active ? "border-au-accent/35 bg-au-accent-tint text-au-accent" : "border-au-separator bg-au-surface text-slate-600 hover:bg-au-fill"}`}><span className="flex items-center gap-1.5 text-[12px] font-semibold"><span aria-hidden="true">{icon}</span>{title}</span><span className="mt-1 block text-[12px] font-medium text-slate-500">{subtitle}</span></button>; }
/**
 * One section toggle. A locked toggle stays visible (so the scope is legible)
 * but disabled, mirroring how a revoked link's editor is presented.
 */
function SectionToggle({ label, active, locked, onToggle }: { label: string; active: boolean; locked: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={active} disabled={locked} onClick={onToggle} className={`sat-press sat-press-fill flex min-h-11 items-center justify-between rounded-xl border px-3 text-left text-[12px] font-semibold ${active ? "border-au-accent/35 bg-au-accent-tint text-au-accent" : "border-au-separator bg-au-surface text-slate-600 hover:bg-au-fill"} disabled:opacity-45`}><span>{label}</span><span aria-hidden="true">{active ? "On" : "Off"}</span></button>;
}

/** The one-line consequence of the current selection, including the score rule. */
function sectionsSummary(selection: readonly AccessLinkSectionKey[], locked: boolean): string {
  if (selection.length === 0) return "Pick at least one section before saving.";
  const both = ACCESS_LINK_SECTION_KEYS.every((key) => selection.includes(key));
  const base = both
    ? "Students take both sections and receive a total score."
    : `Students take ${sectionLabels(selection)} only, and the exam ends after that section. A one-section sitting reports its 200–800 section score with no total.`;
  return locked ? `${base} The scope is locked now.` : base;
}

function sectionLabels(selection: readonly AccessLinkSectionKey[]): string {
  return ACCESS_LINK_SECTION_KEYS.filter((key) => selection.includes(key)).map((key) => ACCESS_LINK_SECTION_LABELS[key]).join(" and ");
}

function Segment({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`sat-press sat-press-fill flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-[12px] font-semibold ${active ? "bg-au-surface text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"} disabled:opacity-35`}>{children}</button>; }
