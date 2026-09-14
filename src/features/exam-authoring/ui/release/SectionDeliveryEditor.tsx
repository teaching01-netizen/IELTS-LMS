import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, GitBranch, LoaderCircle, Save } from "lucide-react";
import { useUpdateSectionDeliverySettings } from "../../api/assessmentQueries";
import type { AssessmentSectionShell } from "../../contracts/assessment";
import { operationalCountForSection, secondsToMinutes, toUserFacingReleaseError } from "./releaseSelectors";
import { releaseDisabledButtonClass } from "./releaseUi";
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
  const collaborationReadOnly = Boolean(
    collaboration &&
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

  useEffect(() => {
    if (!collaboration?.workspaceSnapshot.ready) return;
    collaboration.ensureValue(sharedPath, deliverySeed);
  }, [collaboration, collaboration?.workspaceSnapshot.ready, deliverySeed, sharedPath]);

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
        className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm leading-6 text-destructive"
      >
        <p className="font-semibold">{section.title} has an incomplete adaptive structure.</p>
        <p className="mt-1">A base module plus lower and higher branches are required before publishing.</p>
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
    <article aria-label={section.title} className="rounded-2xl border border-border bg-muted p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.015em] text-foreground">
            {section.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Candidate path · {candidateMinutes} min
            {breakMinutes > 0 ? ` + ${breakMinutes} min break` : ""}
            {dirty ? " · Unsaved changes" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-ring/10">
          <Clock3 size={12} aria-hidden="true" /> Server timed
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <NumericField label="Module 1" value={baseMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeBaseMinutes} />
        <NumericField label="Module 2 · Lower" value={lowerMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeLowerMinutes} />
        <NumericField label="Module 2 · Higher" value={higherMinutes} min={1} max={600} suffix="min" disabled={!effectiveCanEdit} onChange={changeHigherMinutes} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <GitBranch size={14} className="text-muted-foreground" aria-hidden="true" /> Adaptive routing
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
            <NumericField
              label="Higher route at"
              value={threshold}
              min={1}
              max={operationalCount}
              suffix="correct"
              disabled={!effectiveCanEdit}
              onChange={changeThreshold}
            />
            <div className="rounded-xl bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <span className="font-semibold text-foreground">0–{Math.max(0, threshold - 1)}</span> → Lower
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="font-semibold text-foreground">
                {threshold}–{operationalCount}
              </span>{" "}
              → Higher
              <div className="mt-0.5 text-xs text-muted-foreground">
                {operationalCount} operational questions · provider-defined
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
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
          <p className="mt-2 text-xs leading-4 text-muted-foreground">
            Applied after the section completes.
          </p>
        </div>
      </div>

      {localError ? (
        <p role="alert" className="mt-3 text-xs font-medium text-destructive">
          {localError}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">Section revision {section.revision}</p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saveDisabled}
          aria-describedby={saveReason ? saveReasonId : undefined}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${saveDisabled ? "cursor-not-allowed bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"} ${releaseDisabledButtonClass}`}
        >
          {update.isPending ? (
            <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Save size={15} aria-hidden="true" />
          )}
          {update.isPending ? "Saving…" : collaboration && dirty ? "Saving automatically…" : dirty ? "Save section" : "Saved"}
        </button>
      </div>
      {saveReason ? (
        <p id={saveReasonId} className="mt-2 text-xs text-muted-foreground">
          {saveReason}
        </p>
      ) : null}
    </article>
  );
}

export const SectionDeliveryEditor = memo(SectionDeliveryEditorInner);
