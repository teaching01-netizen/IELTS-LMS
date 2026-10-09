import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, GitBranch, Save } from "lucide-react";
import { useUpdateSectionDeliverySettings } from "../../api/assessmentQueries";
import type { AssessmentSectionShell } from "../../contracts/assessment";
import { operationalCountForSection, secondsToMinutes, toUserFacingReleaseError } from "./releaseSelectors";
import { NumericField } from "./NumericField";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";

interface SectionDeliveryEditorProps {
  examId: string;
  section: AssessmentSectionShell;
  canEdit: boolean;
  saveDisabledReason?: string | null;
  onDirtyChange: (sectionId: string, dirty: boolean) => void;
}

function SectionDeliveryEditorInner({
  examId,
  section,
  canEdit,
  saveDisabledReason,
  onDirtyChange,
}: SectionDeliveryEditorProps) {
  const collaboration = useSatAuthoringCollaboration();
  // "Disabled" is the no-room posture (no editable draft), which is NOT
  // read-only: the section's own HTTP save path owns this form then.
  const collaborationReadOnly = Boolean(
    collaboration &&
      collaboration.status !== "disabled" &&
      (collaboration.workspaceSnapshot.readOnly || collaboration.lifecyclePhase !== "active"),
  );
  const effectiveCanEdit = canEdit && !collaborationReadOnly;
  const update = useUpdateSectionDeliverySettings(examId);
  const base = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "base"),
    [section.modules],
  );
  const lower = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "lower_branch"),
    [section.modules],
  );
  const higher = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "higher_branch"),
    [section.modules],
  );
  const routing = section.routingPolicy;
  const [baseMinutes, setBaseMinutes] = useState(() => secondsToMinutes(base?.durationSeconds ?? 60));
  const [lowerMinutes, setLowerMinutes] = useState(() => secondsToMinutes(lower?.durationSeconds ?? 60));
  const [higherMinutes, setHigherMinutes] = useState(() =>
    secondsToMinutes(higher?.durationSeconds ?? 60),
  );
  const [breakMinutes, setBreakMinutes] = useState(() =>
    Math.max(0, Math.round(section.breakAfterSeconds / 60)),
  );
  const [threshold, setThreshold] = useState(() => routing?.minimumCorrectForHigher ?? 1);
  const [localError, setLocalError] = useState<string | null>(null);
  const mountedSectionRef = useRef(section.id);
  const sharedPath = `delivery/${section.id}`;
  const formRef = useRef({
    baseMinutes: secondsToMinutes(base?.durationSeconds ?? 60),
    lowerMinutes: secondsToMinutes(lower?.durationSeconds ?? 60),
    higherMinutes: secondsToMinutes(higher?.durationSeconds ?? 60),
    breakMinutes: Math.max(0, Math.round(section.breakAfterSeconds / 60)),
    threshold: routing?.minimumCorrectForHigher ?? 1,
    writerId: null as string | null,
  });
  const selfId = collaboration?.participants.find((participant) => participant.isSelf)?.id ?? null;
  const sharedDelivery = collaboration?.workspaceSnapshot.values[sharedPath];

  const deliverySeed = useMemo(
    () => ({
      baseMinutes: secondsToMinutes(base?.durationSeconds ?? 60),
      lowerMinutes: secondsToMinutes(lower?.durationSeconds ?? 60),
      higherMinutes: secondsToMinutes(higher?.durationSeconds ?? 60),
      breakMinutes: Math.max(0, Math.round(section.breakAfterSeconds / 60)),
      threshold: routing?.minimumCorrectForHigher ?? 1,
      writerId: null,
    }),
    [base?.durationSeconds, higher?.durationSeconds, lower?.durationSeconds, routing?.minimumCorrectForHigher, section.breakAfterSeconds],
  );

  // The room arbitrates the first value for this section; the readiness barrier
  // (initial sync plus the IndexedDB replay) keeps the proposal from racing the
  // replayed local cache. A populated path is skipped inside the provider.
  useEffect(() => {
    if (!collaboration?.workspaceSnapshot.ready || !collaboration.workspaceSnapshot.localReady) return;
    collaboration.seedValue(sharedPath, deliverySeed);
  }, [
    collaboration,
    collaboration?.workspaceSnapshot.localReady,
    collaboration?.workspaceSnapshot.ready,
    deliverySeed,
    sharedPath,
  ]);

  useEffect(() => {
    if (sharedDelivery === null || typeof sharedDelivery !== "object") return;
    const value = sharedDelivery as Record<string, unknown>;
    if (!Number.isFinite(value["baseMinutes"]) || !Number.isFinite(value["lowerMinutes"]) || !Number.isFinite(value["higherMinutes"]) || !Number.isFinite(value["breakMinutes"]) || !Number.isFinite(value["threshold"])) return;
    const next = {
      baseMinutes: Number(value["baseMinutes"]),
      lowerMinutes: Number(value["lowerMinutes"]),
      higherMinutes: Number(value["higherMinutes"]),
      breakMinutes: Number(value["breakMinutes"]),
      threshold: Number(value["threshold"]),
      writerId: typeof value["writerId"] === "string" ? value["writerId"] : null,
    };
    formRef.current = next;
    setBaseMinutes(next.baseMinutes);
    setLowerMinutes(next.lowerMinutes);
    setHigherMinutes(next.higherMinutes);
    setBreakMinutes(next.breakMinutes);
    setThreshold(next.threshold);
  }, [sharedDelivery]);

  // Reset local form only when the server revision actually changes, not on
  // every parent render. The dirty flag is derived below, never pushed in
  // this effect, so mount no longer emits a spurious onDirtyChange(false).
  useEffect(() => {
    if (mountedSectionRef.current !== section.id) {
      mountedSectionRef.current = section.id;
    }
    setBaseMinutes(secondsToMinutes(base?.durationSeconds ?? 60));
    setLowerMinutes(secondsToMinutes(lower?.durationSeconds ?? 60));
    setHigherMinutes(secondsToMinutes(higher?.durationSeconds ?? 60));
    setBreakMinutes(Math.max(0, Math.round(section.breakAfterSeconds / 60)));
    setThreshold(routing?.minimumCorrectForHigher ?? 1);
    setLocalError(null);
  }, [
    section.id,
    section.revision,
    base?.durationSeconds,
    lower?.durationSeconds,
    higher?.durationSeconds,
    section.breakAfterSeconds,
    routing?.minimumCorrectForHigher,
    routing?.revision,
  ]);

  // Derived bound (stored value -> SAT blueprint -> target-minus-pretest),
  // so threshold-only policy rows (the real DB shape) still edit against
  // the provider contract (RW 25 / Math 20) instead of clamping to 1.
  const operationalCount = operationalCountForSection(section);
  const structureValid = Boolean(base && lower && higher && routing);
  const dirty =
    structureValid &&
    (baseMinutes * 60 !== base!.durationSeconds ||
      lowerMinutes * 60 !== lower!.durationSeconds ||
      higherMinutes * 60 !== higher!.durationSeconds ||
      breakMinutes * 60 !== section.breakAfterSeconds ||
      threshold !== routing!.minimumCorrectForHigher);

  const callbackRef = useRef(onDirtyChange);
  callbackRef.current = onDirtyChange;
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current !== dirty) {
      lastDirtyRef.current = dirty;
      callbackRef.current(section.id, dirty);
    }
  }, [dirty, section.id]);

  // Keep this callback above the incomplete-structure return. Hooks must run
  // in the same order when a remote workspace update temporarily removes or
  // restores one of the delivery modules.
  const save = useCallback(async () => {
    if (!base || !lower || !higher || !routing || !effectiveCanEdit || update.isPending) return;
    setLocalError(null);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > operationalCount) {
      setLocalError(`Higher-route threshold must be between 1 and ${operationalCount}.`);
      return;
    }
    for (const minutes of [baseMinutes, lowerMinutes, higherMinutes, breakMinutes]) {
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600) {
        setLocalError("Module timing must be between 0 and 600 minutes.");
        return;
      }
    }
    if (baseMinutes < 1 || lowerMinutes < 1 || higherMinutes < 1) {
      setLocalError("Module timing must be at least 1 minute.");
      return;
    }
    try {
      await update.mutateAsync({
        sectionId: section.id,
        request: {
          expectedSectionRevision: section.revision,
          breakAfterSeconds: breakMinutes * 60,
          minimumCorrectForHigher: threshold,
          expectedRoutingRevision: routing.revision,
          moduleTimings: section.modules.map((module) => ({
            moduleId: module.id,
            durationSeconds:
              module.id === base.id
                ? baseMinutes * 60
                : module.id === lower.id
                  ? lowerMinutes * 60
                  : higherMinutes * 60,
            expectedRevision: module.revision,
          })),
        },
      });
      collaboration?.publishCommand("delivery.changed", { sectionId: section.id });
    } catch (error) {
      setLocalError(toUserFacingReleaseError(error));
    }
  }, [base, baseMinutes, breakMinutes, collaboration, effectiveCanEdit, higher, higherMinutes, lower, lowerMinutes, operationalCount, routing, section, threshold, update]);

  // Keep this effect above the incomplete-structure return. A remote
  // structural update can temporarily remove or restore a module; hooks must
  // stay in the same order while that live update is rendered.
  useEffect(() => {
    if (!collaboration || !dirty || !effectiveCanEdit || !selfId) return;
    if (!sharedDelivery || typeof sharedDelivery !== "object") return;
    const writerId = (sharedDelivery as Record<string, unknown>)["writerId"];
    if (writerId !== selfId) return;
    const timer = globalThis.setTimeout(() => void save(), 500);
    return () => globalThis.clearTimeout(timer);
  }, [collaboration, dirty, effectiveCanEdit, save, selfId, sharedDelivery]);

  if (!base || !lower || !higher || !routing) {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] p-5 text-[14px] leading-5"
      >
        <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--sat-staff-danger,#b42318)]" />
        <div>
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{section.title} has an incomplete adaptive structure.</p>
          <p className="mt-1 text-[var(--sat-staff-text-secondary,#515154)]">A base module plus lower and higher branches are required before timing can be set or the exam published.</p>
        </div>
      </div>
    );
  }

  const publishShared = (key: "baseMinutes" | "lowerMinutes" | "higherMinutes" | "breakMinutes" | "threshold", value: number) => {
    if (!effectiveCanEdit) return;
    formRef.current = { ...formRef.current, [key]: value, writerId: selfId };
    collaboration?.setValue(sharedPath, formRef.current);
  };

  const changeBaseMinutes = (value: number) => { setBaseMinutes(value); publishShared("baseMinutes", value); };
  const changeLowerMinutes = (value: number) => { setLowerMinutes(value); publishShared("lowerMinutes", value); };
  const changeHigherMinutes = (value: number) => { setHigherMinutes(value); publishShared("higherMinutes", value); };
  const changeBreakMinutes = (value: number) => { setBreakMinutes(value); publishShared("breakMinutes", value); };
  const changeThreshold = (value: number) => { setThreshold(value); publishShared("threshold", value); };

  const candidateMinutes = baseMinutes + Math.max(lowerMinutes, higherMinutes);
  const saveDisabled = !dirty || update.isPending || !effectiveCanEdit;
  const saveReasonId = `section-${section.id}-save-reason`;
  const saveReason = !effectiveCanEdit
    ? (saveDisabledReason ?? "You do not have permission to edit delivery settings.")
    : null;

  return (
    <article aria-label={section.title} className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-semibold leading-6 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
            {section.title}
          </h3>
          <p className="mt-1 text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
            Candidate path · {candidateMinutes} min
            {breakMinutes > 0 ? ` + ${breakMinutes} min break` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--sat-staff-border-strong)] px-2.5 py-1 text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          <Clock3 size={14} aria-hidden="true" /> Server-timed
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <NumericField label="Module 1" value={baseMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeBaseMinutes} />
        <NumericField label="Module 2 · Lower" value={lowerMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeLowerMinutes} />
        <NumericField label="Module 2 · Higher" value={higherMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeHigherMinutes} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
            <GitBranch size={16} className="text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-hidden="true" /> Adaptive routing
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
            <NumericField
              label="Higher route at"
              value={threshold}
              min={1}
              max={operationalCount}
              suffix="correct"
              disabled={!effectiveCanEdit}
              onChange={changeThreshold}
            />
            <div className="rounded-[var(--sat-staff-radius-control,10px)] bg-white px-3 py-2.5 text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
              <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">0–{Math.max(0, threshold - 1)}</span> → Lower
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                {threshold}–{operationalCount}
              </span>{" "}
              → Higher
              <div className="mt-0.5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                {operationalCount} operational questions · provider-defined
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-fill-faint)] p-4">
          <NumericField
            label="Break after section"
            value={breakMinutes}
            min={0}
            max={600}
            suffix="min"
            allowZero
            disabled={!effectiveCanEdit}
            onChange={changeBreakMinutes}
          />
          <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Starts when the section ends.
          </p>
        </div>
      </div>

      {localError ? (
        <p role="alert" className="mt-3 text-[14px] font-medium leading-5 text-[var(--sat-staff-danger,#b42318)]">
          {localError}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sat-staff-border-hairline)] pt-4">
        <p role="status" className="flex items-center gap-1.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {update.isPending ? "Saving…" : dirty ? (collaboration ? "Saving automatically…" : "Unsaved changes") : (
            <><Check size={16} aria-hidden="true" className="text-[var(--sat-staff-success-dot,#059669)]" />Saved · revision {section.revision}</>
          )}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saveDisabled}
          aria-busy={update.isPending || undefined}
          aria-describedby={saveReason ? saveReasonId : undefined}
          className="sat-btn sat-btn--primary sat-press"
        >
          {update.isPending ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Save size={16} aria-hidden="true" />}
          Save section
        </button>
      </div>
      {saveReason ? (
        <p id={saveReasonId} className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {saveReason}
        </p>
      ) : null}
    </article>
  );
}

export const SectionDeliveryEditor = memo(SectionDeliveryEditorInner);
