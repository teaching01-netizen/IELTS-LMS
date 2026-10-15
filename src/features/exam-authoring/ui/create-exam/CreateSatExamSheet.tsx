import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthSession } from "../../../auth/authSession";
import { examAuthoringFacade } from "../../api/examAuthoringFacade";
import { invalidateExamList } from "../../api/examQueries";
import { useSatExamConfigDefaults } from "../../api/satExamConfigApi";
import {
  SAT_CONFIG_SECTION_KEYS,
  SAT_CONFIG_SECTION_LABELS,
  SHAPE_LABELS,
  satSectionPath,
  satExamConfigDiffers,
  validateSatExamConfig,
  type SatConfigFieldErrors,
  type SatExamConfig,
} from "../../contracts/satExamConfig";
import { SatButton, SatField } from "../../../../products/sat/ui/SatPage";
import { SatConfirmDialog, SatFormDialog } from "../../../../products/sat/ui/ConfirmDialog";
import { SatExamConfigFields } from "./SatExamConfigFields";

const FORM_ID = "sat-create-exam-form";
const STEP_NAMES = ["Basics", "Modules & timing", "Results", "Review"] as const;

function planSummary(config: SatExamConfig): string {
  return SAT_CONFIG_SECTION_KEYS
    .map((section) => {
      const shape = config.classroomPlan?.[section] ?? "full";
      const timing = config.sections[section];
      const breakSummary = timing.breakAfterMinutes > 0 ? ` · ${timing.breakAfterMinutes} min break` : "";
      return `${SAT_CONFIG_SECTION_LABELS[section]}: ${SHAPE_LABELS[shape]} · ${satSectionPath(shape, timing)}${breakSummary}`;
    })
    .join(" · ");
}

function looksLikeConverterError(message: string): boolean {
  return /converter|scoreType|calibrationSource|table|topology/i.test(message);
}

function looksLikePlanError(message: string): boolean {
  return /classroom plan|SAT section|SAT shape/i.test(message);
}

export function CreateSatExamSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const defaultsQuery = useSatExamConfigDefaults(open);
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [title, setTitle] = useState("");
  const [customModules, setCustomModules] = useState(false);
  const [config, setConfig] = useState<SatExamConfig | null>(null);
  const [configErrors, setConfigErrors] = useState<SatConfigFieldErrors>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [serverConverterError, setServerConverterError] = useState<string | null>(null);
  const [converterError, setConverterError] = useState<string | null>(null);
  const [converterMode, setConverterMode] = useState<"raw" | "upload">("raw");
  const [converterFileName, setConverterFileName] = useState<string | null>(null);
  const [readingConverter, setReadingConverter] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const createOperationRef = useRef<{ fingerprint: string; operationKey: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCreating(false);
    setConfirmDiscard(false);
    setTitle("");
    setCustomModules(false);
    setConfig(null);
    setConfigErrors({});
    setCreateError(null);
    setServerConverterError(null);
    setConverterError(null);
    setConverterMode("raw");
    setConverterFileName(null);
    setReadingConverter(false);
    createOperationRef.current = null;
  }, [open]);

  useEffect(() => {
    if (open && !config && defaultsQuery.data) setConfig(defaultsQuery.data.config);
  }, [config, defaultsQuery.data, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, step]);

  const dirty = useMemo(() => {
    if (title.trim() || customModules) return true;
    return Boolean(config && defaultsQuery.data && satExamConfigDiffers(config, defaultsQuery.data.config));
  }, [config, customModules, defaultsQuery.data, title]);

  const requestClose = () => {
    if (creating) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const submitExam = async (standardSettings: boolean) => {
    const nextTitle = title.trim();
    if (!nextTitle || creating) return;
    let configuration: SatExamConfig | undefined;
    if (!standardSettings && config && defaultsQuery.data) {
      const errors = validateSatExamConfig(config, defaultsQuery.data.limits);
      setConfigErrors(errors);
      if (Object.keys(errors).length > 0 || converterError) {
        setStep(converterError ? 2 : 1);
        return;
      }
      if (satExamConfigDiffers(config, defaultsQuery.data.config)) configuration = config;
    }

    const requestFingerprint = JSON.stringify({
      providerKey: "sat",
      providerExamType: "SAT",
      title: nextTitle,
      ...(configuration ? { configuration } : {}),
    });
    let operationKey = createOperationRef.current?.operationKey;
    if (createOperationRef.current?.fingerprint !== requestFingerprint || !operationKey) {
      operationKey = crypto.randomUUID();
      createOperationRef.current = { fingerprint: requestFingerprint, operationKey };
    }

    setCreating(true);
    setCreateError(null);
    setServerConverterError(null);
    try {
      const actor = session?.user.displayName?.trim() || session?.user.email || "Staff";
      const result = await examAuthoringFacade.lifecycle.createProviderExam(
        {
          providerKey: "sat",
          providerExamType: "SAT",
          title: nextTitle,
          ...(configuration ? { configuration } : {}),
          operationKey,
        },
        actor,
      );
      if (!result.success || !result.exam) {
        const message = result.error ?? "The exam could not be created.";
        if (looksLikeConverterError(message)) {
          setServerConverterError(message);
          setStep(2);
        } else if (looksLikePlanError(message)) {
          setCreateError(message);
          setStep(1);
        } else {
          setCreateError(message);
          setStep(configuration ? 3 : 0);
        }
        return;
      }
      await invalidateExamList(queryClient);
      onClose();
      navigate(`/sat/exams/${result.exam.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The exam could not be created.");
      setStep(configuration ? 3 : 0);
    } finally {
      setCreating(false);
    }
  };

  const validateAndAdvance = () => {
    setCreateError(null);
    if (step === 0) {
      if (!title.trim()) {
        setCreateError("Exam name is required.");
        return;
      }
      if (!defaultsQuery.data) {
        setCreateError(defaultsQuery.error instanceof Error ? defaultsQuery.error.message : "Exam settings are still loading.");
        return;
      }
    }
    if (step === 1 && config && defaultsQuery.data) {
      const errors = validateSatExamConfig(config, defaultsQuery.data.limits);
      setConfigErrors(errors);
      if (Object.keys(errors).length > 0) return;
    }
    if (step === 2 && converterError) return;
    if (step === 2 && converterMode === "upload" && config?.scoreConverter == null) {
      setConverterError("Choose a converter JSON file or select Raw scores only.");
      return;
    }
    setStep((current) => Math.min(STEP_NAMES.length - 1, current + 1));
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < STEP_NAMES.length - 1) validateAndAdvance();
    else void submitExam(false);
  };

  const setMode = (custom: boolean) => {
    setCustomModules(custom);
    setCreateError(null);
    if (!custom) setConfig((current) => {
      if (!current) return current;
      const { classroomPlan: _classroomPlan, ...withoutPlan } = current;
      return withoutPlan;
    });
  };

  const chooseConverter = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReadingConverter(true);
    setConverterError(null);
    setServerConverterError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setConfig((current) => current ? { ...current, scoreConverter: parsed } : current);
      setConverterFileName(file.name);
      setConverterMode("upload");
    } catch {
      setConfig((current) => current ? { ...current, scoreConverter: undefined } : current);
      setConverterFileName(null);
      setConverterMode("upload");
      setConverterError("The converter file must contain valid JSON.");
    } finally {
      setReadingConverter(false);
    }
  };

  const removeConverter = () => {
    setConfig((current) => current ? { ...current, scoreConverter: undefined } : current);
    setConverterFileName(null);
    setConverterError(null);
    setServerConverterError(null);
    setConverterMode("raw");
  };

  const customDisabled = !defaultsQuery.data?.classroomCreationEnabled;
  const hasCustomPlan = Boolean(config && Object.keys(config.classroomPlan ?? {}).length > 0);
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6">
      {step === 0 ? (
        <SatButton type="button" variant="quiet" disabled={!title.trim() || creating} pending={creating} onClick={() => void submitExam(true)}>
          {creating ? "Creating…" : "Create with standard settings"}
        </SatButton>
      ) : (
        <SatButton type="button" variant="quiet" disabled={creating} onClick={() => { setCreateError(null); setStep((current) => Math.max(0, current - 1)); }}>
          Back
        </SatButton>
      )}
      {step < STEP_NAMES.length - 1 ? (
        <SatButton type="button" variant="primary" disabled={creating || !title.trim() || (step === 0 && !defaultsQuery.data) || readingConverter} onClick={validateAndAdvance}>
          Continue
        </SatButton>
      ) : (
        <SatButton type="submit" form={FORM_ID} variant="primary" disabled={!title.trim()} pending={creating}>
          {creating ? "Creating…" : "Create exam"}
        </SatButton>
      )}
    </div>
  );

  return (
    <>
      <SatFormDialog
        open={open}
        eyebrow={`Digital SAT · Step ${step + 1} of 4`}
        title="New exam"
        onClose={requestClose}
        size="wide"
        footer={footer}
      >
        <form id={FORM_ID} onSubmit={handleFormSubmit} noValidate>
          <div className="max-h-[min(70vh,680px)] space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <p className="sr-only" aria-live="polite">Step {step + 1} of 4: {STEP_NAMES[step]}</p>
            <div key={step} className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
              <div>
                <h3 ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
                  {STEP_NAMES[step]}
                </h3>
              </div>

              {step === 0 ? (
                <>
                  <SatField id="sat-title" label="Exam name" error={createError} help="You can rename this exam later in Settings.">
                    {(control) => (
                      <input
                        {...control}
                        value={title}
                        disabled={creating}
                        onChange={(event) => { setTitle(event.target.value); setCreateError(null); }}
                        placeholder="Practice Test 06"
                        maxLength={255}
                        autoComplete="off"
                        className="sat-input"
                      />
                    )}
                  </SatField>
                  <fieldset className="space-y-2">
                    <legend className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">How will students take this exam?</legend>
                    <div role="radiogroup" aria-label="How students take this exam" className="grid gap-3 sm:grid-cols-2">
                      <label htmlFor="sat-exam-mode-full" className={`flex min-h-[116px] cursor-pointer gap-3 rounded-2xl border p-4 ${customModules ? "border-[var(--sat-staff-border-strong)] bg-white" : "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)]"}`}>
                        <input id="sat-exam-mode-full" type="radio" name="sat-exam-mode" aria-label="Full SAT" checked={!customModules} disabled={creating} onChange={() => setMode(false)} className="mt-1 h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]" />
                        <span>
                          <span className="block text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Full SAT</span>
                          <span className="mt-1 block text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Both sections with an adaptive Module 2. Works in Practice and Classroom rooms.</span>
                        </span>
                      </label>
                      <label
                        htmlFor="sat-exam-mode-custom"
                        aria-disabled={customDisabled}
                        className={`flex min-h-[116px] gap-3 rounded-2xl border p-4 ${customDisabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"} ${customModules ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)]" : "border-[var(--sat-staff-border-strong)] bg-white"}`}
                      >
                        <input id="sat-exam-mode-custom" type="radio" name="sat-exam-mode" aria-label="Custom modules" checked={customModules} disabled={customDisabled || creating} onChange={() => setMode(true)} className="mt-1 h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]" />
                        <span>
                          <span className="block text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Custom modules</span>
                          <span className="mt-1 block text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Choose which modules students sit, like one module for homework. Classroom rooms only.</span>
                        </span>
                      </label>
                    </div>
                    {defaultsQuery.data && !defaultsQuery.data.classroomCreationEnabled ? (
                      <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Classroom rooms aren't turned on for your organization yet, so custom modules aren't available.</p>
                    ) : defaultsQuery.isLoading ? (
                      <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Loading exam settings…</p>
                    ) : defaultsQuery.error ? (
                      <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">Exam settings could not load. You can still create with standard settings.</p>
                    ) : null}
                  </fieldset>
                </>
              ) : null}

              {step === 1 ? (
                config && defaultsQuery.data ? (
                  <>
                    {customModules ? <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Choose a module set for each section, then set the time students get for those modules.</p> : null}
                    <SatExamConfigFields
                      idPrefix="sat-create"
                      value={config}
                      defaults={defaultsQuery.data.config}
                      limits={defaultsQuery.data.limits}
                      errors={configErrors}
                      disabled={creating}
                      customModules={customModules}
                      onChange={setConfig}
                    />
                    {createError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{createError}</p> : null}
                  </>
                ) : (
                  <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">Exam settings could not load. Close this sheet and try again.</p>
                )
              ) : null}

              {step === 2 ? (
                config ? (
                  <div className="space-y-6">
                    <label htmlFor="sat-score-report" className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--sat-staff-border-hairline)] p-4 text-[14px] leading-5">
                      <input
                        id="sat-score-report"
                        type="checkbox"
                        role="switch"
                        aria-label="Show score report when a Classroom sitting ends"
                        checked={config.showClassroomScoreReport}
                        disabled={creating}
                        onChange={(event) => setConfig({ ...config, showClassroomScoreReport: event.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]"
                      />
                      <span>
                        <span className="block font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Show score report when a Classroom sitting ends</span>
                        <span className="mt-1 block text-[var(--sat-staff-text-secondary,#515154)]">Students see their scores and can download their answers. Practice rooms never show a report. You can change this anytime.</span>
                      </span>
                    </label>
                    <fieldset className="space-y-3">
                      <legend className="text-[15px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Estimated scores</legend>
                      <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">An approved table turns raw scores into 200–800 estimates. Add it now or later in Settings.</p>
                      <div role="radiogroup" aria-label="Estimated scores" className="grid gap-2 sm:grid-cols-2">
                        <label htmlFor="sat-score-converter-raw" className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-[14px] ${config.scoreConverter == null ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)]" : "border-[var(--sat-staff-border-strong)] bg-white"}`}>
                          <input id="sat-score-converter-raw" type="radio" name="sat-score-converter" aria-label="Raw scores only" checked={converterMode === "raw"} disabled={creating} onChange={removeConverter} className="h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]" />
                          <span className="font-medium">Raw scores only</span>
                        </label>
                        <label htmlFor="sat-score-converter-upload" className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-[14px] ${config.scoreConverter != null ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)]" : "border-[var(--sat-staff-border-strong)] bg-white"}`}>
                          <input id="sat-score-converter-upload" type="radio" name="sat-score-converter" aria-label="Upload converter" checked={converterMode === "upload"} disabled={creating} onChange={() => { setConverterMode("upload"); setConverterError(null); document.getElementById("sat-converter-file")?.click(); }} className="h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]" />
                          <span className="font-medium">Upload converter</span>
                        </label>
                      </div>
                      <input id="sat-converter-file" type="file" accept=".json,application/json" aria-label="Upload score converter JSON" disabled={creating} onChange={(event) => void chooseConverter(event)} className="sr-only" />
                      {config.scoreConverter != null ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--sat-staff-fill-faint)] px-3 py-2.5 text-[14px]">
                          <span className="min-w-0 truncate text-[var(--sat-staff-text-secondary,#515154)]">{readingConverter ? "Reading converter…" : converterFileName ?? "Converter attached"}</span>
                          <button type="button" disabled={creating} onClick={removeConverter} className="min-h-11 px-2 font-semibold text-[var(--sat-staff-accent,#0071e3)] underline disabled:opacity-50">Remove</button>
                        </div>
                      ) : null}
                      {converterError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{converterError}</p> : null}
                      {serverConverterError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{serverConverterError}</p> : null}
                    </fieldset>
                  </div>
                ) : null
              ) : null}

              {step === 3 ? (
                config ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3 border-b border-[var(--sat-staff-border-hairline)] pb-4">
                      <div><h4 className="text-[14px] font-semibold">Basics</h4><p className="mt-1 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">{title.trim()} · {customModules ? "Custom modules" : "Full SAT"}</p></div>
                      <button type="button" disabled={creating} onClick={() => setStep(0)} className="min-h-11 shrink-0 px-2 text-[14px] font-semibold text-[var(--sat-staff-accent,#0071e3)] underline disabled:opacity-50">Edit</button>
                    </div>
                    <div className="flex items-start justify-between gap-3 border-b border-[var(--sat-staff-border-hairline)] pb-4">
                      <div><h4 className="text-[14px] font-semibold">Modules & timing</h4><p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{planSummary(config)}</p></div>
                      <button type="button" disabled={creating} onClick={() => setStep(1)} className="min-h-11 shrink-0 px-2 text-[14px] font-semibold text-[var(--sat-staff-accent,#0071e3)] underline disabled:opacity-50">Edit</button>
                    </div>
                    {customModules && !hasCustomPlan ? <p className="rounded-xl bg-[var(--sat-staff-fill-faint)] px-3 py-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Both sections use the full adaptive test, so this exam also works in Practice rooms.</p> : null}
                    <div className="flex items-start justify-between gap-3 border-b border-[var(--sat-staff-border-hairline)] pb-4">
                      <div>
                        <h4 className="text-[14px] font-semibold">Results</h4>
                        <p className="mt-1 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Score report: {config.showClassroomScoreReport ? "Shown after Classroom sittings" : "Hidden"} · {config.scoreConverter == null ? "Raw scores only" : `Estimated scores${converterFileName ? ` · ${converterFileName}` : ""}`}</p>
                      </div>
                      <button type="button" disabled={creating} onClick={() => setStep(2)} className="min-h-11 shrink-0 px-2 text-[14px] font-semibold text-[var(--sat-staff-accent,#0071e3)] underline disabled:opacity-50">Edit</button>
                    </div>
                    {createError ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{createError}</p> : null}
                  </div>
                ) : null
              ) : null}
            </div>
          </div>
        </form>
      </SatFormDialog>
      {confirmDiscard ? (
        <SatConfirmDialog
          open
          title="Discard this exam?"
          description="The exam name and settings you entered will be lost."
          confirmLabel="Discard"
          destructive
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { if (creating) return; setConfirmDiscard(false); onClose(); }}
        />
      ) : null}
    </>
  );
}
