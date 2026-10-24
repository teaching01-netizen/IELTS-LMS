import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { ApiError } from "@/src/shared/api-client/errors";
import { AuthoringConfirmDialog, AuthoringDialog } from "../authoringPrimitives";
import { SatField, SatInlineError } from "@/src/products/sat/ui/SatPage";
import {
  EvaEmbedFrame,
  FORM_REASONS,
  FormFields,
  useExamForms,
  useSaveExamForms,
  type EvaMode,
  type EvaSimConfig,
  type ExamForms,
  type ExamFormsDocument,
  type FieldScope,
  type FormField,
  type FormIssue,
  applicableFields,
  checkEmbedUrl,
  errorReason,
  evaReadinessIssue,
  fieldTypeLabel,
  newFieldId,
  sameForms,
  scopeLabel,
  sectionIssues,
  withFieldType,
  upgradeToSectionForms,
  type RawAnswers,
  type SittingSection,
} from "@/src/features/assessment-forms/api/assessmentForms";

/* Exam Settings: Registration form and Eva SIM (UX spec §1). Both sections
 * share one save owner (useSaveExamForms): a section save sends its submitted
 * draft plus the OTHER section's last server-confirmed value, never its
 * unsaved input, and an acknowledgement only settles the submitted snapshot. */

type SectionKey = "registration" | "evaSim" | "verbal" | "math";

const CARD =
  "rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] p-5 sm:p-6";
const H2 =
  "text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]";
const MUTED = "text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]";

function issueMessage(error: unknown): { message: string; paths: Record<string, string> } {
  const fields = error instanceof ApiError ? error.details?.["fields"] : undefined;
  const paths: Record<string, string> = {};
  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields as Record<string, unknown>))
      if (typeof value === "string") paths[key] = value;
  }
  return {
    message: error instanceof Error ? error.message : "The forms could not be saved.",
    paths,
  };
}

/** "registration.fields[2].label" -> "Question 3: …" for an inline list. */
function describePath(path: string, message: string): string {
  const match = /fields\[(\d+)\](?:\.options\[(\d+)\])?/.exec(path);
  if (!match) return message;
  const question = `Question ${Number(match[1]) + 1}`;
  return match[2] !== undefined
    ? `${question}, option ${Number(match[2]) + 1}: ${message}`
    : `${question}: ${message}`;
}

function cleanEva(eva: EvaSimConfig): EvaSimConfig {
  // The persisted union keeps only the active branch.
  return eva.mode === "native"
    ? { enabled: eva.enabled, mode: "native", fields: eva.fields ?? [] }
    : { enabled: eva.enabled, mode: "embed", url: (eva.url ?? "").trim() };
}

function enabledSections(forms: ExamForms | null | undefined): Record<"verbal" | "math", boolean> {
  return forms?.schemaVersion === 2
    ? {
        verbal: forms.sectionEntry["reading-writing"].enabled ?? true,
        math: forms.sectionEntry.math.enabled ?? true,
      }
    : { verbal: true, math: true };
}

export interface FormsSettingsPanelProps {
  examId: string;
  canEdit: boolean;
  /** Sections with unsaved edits, for the Settings leave guard. */
  onDirtyCountChange?: (count: number) => void;
  /** Explicit "open a working draft" gesture when only a published version exists. */
  onEditExam?: () => void;
}

export function FormsSettingsPanel({
  examId,
  canEdit,
  onDirtyCountChange,
  onEditExam,
}: FormsSettingsPanelProps) {
  const query = useExamForms(examId);
  const doc = query.data;
  if (query.isPending) {
    return (
      <p role="status" className={MUTED}>
        Loading form settings…
      </p>
    );
  }
  if (!doc) {
    return (
      <SatInlineError
        title="Form settings could not load"
        description={query.error instanceof Error ? query.error.message : "Try again."}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <FormsEditor
      key={doc.versionId}
      examId={examId}
      doc={doc}
      canEdit={canEdit && doc.editable}
      onDirtyCountChange={onDirtyCountChange}
      onEditExam={canEdit && !doc.editable ? onEditExam : undefined}
      reload={async () => (await query.refetch()).data}
    />
  );
}

function FormsEditor({
  examId,
  doc,
  canEdit,
  onDirtyCountChange,
  onEditExam,
  reload,
}: {
  examId: string;
  doc: ExamFormsDocument;
  canEdit: boolean;
  onDirtyCountChange?: ((count: number) => void) | undefined;
  onEditExam?: (() => void) | undefined;
  reload: () => Promise<ExamFormsDocument | undefined>;
}) {
  const save = useSaveExamForms(examId);
  // Last server-confirmed forms (null: legacy/unconfigured version).
  const [confirmed, setConfirmed] = useState<ExamForms | null>(doc.forms);
  const [registration, setRegistration] = useState<FormField[]>(
    doc.forms?.registration.fields ?? []
  );
  const [eva, setEva] = useState<EvaSimConfig>(doc.forms?.evaSim ?? doc.standard.evaSim);
  const [verbal, setVerbal] = useState<FormField[]>(
    doc.forms?.schemaVersion === 2 ? doc.forms.sectionEntry["reading-writing"].fields : []
  );
  const [math, setMath] = useState<FormField[]>(
    doc.forms?.schemaVersion === 2 ? doc.forms.sectionEntry.math.fields : []
  );
  const [sectionEnabled, setSectionEnabled] = useState(() => enabledSections(doc.forms));
  const [reviewUpgrade, setReviewUpgrade] = useState(false);
  const [saving, setSaving] = useState<SectionKey | null>(null);
  const [errors, setErrors] = useState<
    Partial<Record<SectionKey, { message: string; paths: Record<string, string> }>>
  >({});
  const [conflict, setConflict] = useState<SectionKey | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [issues, setIssues] = useState<FormIssue[]>(doc.issues);
  const revisionRef = useRef({ versionId: doc.versionId, revision: doc.versionRevision });

  const legacy = confirmed === null;
  const registrationDirty =
    !legacy && JSON.stringify(registration) !== JSON.stringify(confirmed.registration.fields);
  const evaDirty =
    !legacy && JSON.stringify(cleanEva(eva)) !== JSON.stringify(cleanEva(confirmed.evaSim));
  const split = confirmed?.schemaVersion === 2;
  const verbalDirty =
    split &&
    (JSON.stringify(verbal) !== JSON.stringify(confirmed.sectionEntry["reading-writing"].fields) ||
      sectionEnabled.verbal !== (confirmed.sectionEntry["reading-writing"].enabled ?? true));
  const mathDirty =
    split &&
    (JSON.stringify(math) !== JSON.stringify(confirmed.sectionEntry.math.fields) ||
      sectionEnabled.math !== (confirmed.sectionEntry.math.enabled ?? true));
  const dirtyCount =
    Number(registrationDirty) + Number(evaDirty) + Number(verbalDirty) + Number(mathDirty);
  useEffect(() => {
    onDirtyCountChange?.(dirtyCount);
  }, [dirtyCount, onDirtyCountChange]);
  useEffect(() => () => onDirtyCountChange?.(0), [onDirtyCountChange]);

  const submit = useCallback(
    async (section: SectionKey, base: ExamForms, attempt = 0): Promise<void> => {
      const submittedRegistration = registration;
      const submittedEva = cleanEva(eva);
      const submittedSection = section === "verbal" ? verbal : math;
      const submittedEnabled = section === "verbal" ? sectionEnabled.verbal : sectionEnabled.math;
      let forms: ExamForms =
        section === "registration"
          ? { ...base, registration: { fields: submittedRegistration } }
          : section === "evaSim"
            ? { ...base, evaSim: submittedEva }
            : base;
      if (base.schemaVersion === 2 && (section === "verbal" || section === "math")) {
        const key = section === "verbal" ? "reading-writing" : "math";
        forms = {
          ...base,
          sectionEntry: {
            ...base.sectionEntry,
            [key]: { fields: submittedSection, enabled: submittedEnabled },
          },
        };
      }
      if (forms.schemaVersion === 2) {
        // A question's owning form replaces the legacy per-question scope.
        forms = structuredClone(forms);
        for (const field of [
          ...forms.registration.fields,
          ...forms.sectionEntry["reading-writing"].fields,
          ...forms.sectionEntry.math.fields,
          ...(forms.evaSim.fields ?? []),
        ])
          delete field.scope;
      }
      setSaving(section);
      setErrors((prev) => ({ ...prev, [section]: undefined }));
      setConflict(null);
      try {
        const ack = await save.mutateAsync({
          expectedVersionId: revisionRef.current.versionId,
          expectedRevision: revisionRef.current.revision,
          forms,
        });
        revisionRef.current = { versionId: ack.versionId, revision: ack.versionRevision };
        setIssues(ack.issues);
        if (ack.forms) {
          const accepted = ack.forms;
          setConfirmed(accepted);
          // Settle only the submitted snapshot; keep edits typed since.
          if (section === "registration") {
            setRegistration((current) =>
              current === submittedRegistration ? accepted.registration.fields : current
            );
          } else if (section === "verbal" && accepted.schemaVersion === 2) {
            setSectionEnabled((current) =>
              current.verbal === submittedEnabled
                ? { ...current, verbal: accepted.sectionEntry["reading-writing"].enabled ?? true }
                : current
            );
            setVerbal((current) =>
              current === submittedSection
                ? accepted.sectionEntry["reading-writing"].fields
                : current
            );
          } else if (section === "math" && accepted.schemaVersion === 2) {
            setSectionEnabled((current) =>
              current.math === submittedEnabled
                ? { ...current, math: accepted.sectionEntry.math.enabled ?? true }
                : current
            );
            setMath((current) =>
              current === submittedSection ? accepted.sectionEntry.math.fields : current
            );
          } else {
            setEva((current) =>
              JSON.stringify(cleanEva(current)) === JSON.stringify(submittedEva)
                ? accepted.evaSim
                : current
            );
          }
        }
        setAnnouncement(
          `${section === "registration" ? "Registration form" : section === "evaSim" ? "Eva SIM" : section === "verbal" ? "Verbal entry form" : "Math entry form"} saved.`
        );
      } catch (error) {
        if (errorReason(error) === FORM_REASONS.draftChanged && attempt === 0) {
          // Question edits also bump the draft revision. When the forms on
          // the server are still what we last confirmed, retry once with the
          // new revision; otherwise surface the conflict.
          const latest = await reload().catch(() => undefined);
          if (
            latest &&
            latest.versionId === revisionRef.current.versionId &&
            sameForms(latest.forms, base)
          ) {
            revisionRef.current = { versionId: latest.versionId, revision: latest.versionRevision };
            return submit(section, base, 1);
          }
          setConflict(section);
        } else if (errorReason(error) === FORM_REASONS.draftChanged) {
          setConflict(section);
        } else {
          setErrors((prev) => ({ ...prev, [section]: issueMessage(error) }));
        }
      } finally {
        setSaving(null);
      }
    },
    [eva, registration, verbal, math, sectionEnabled, reload, save]
  );

  const saveSection = (section: SectionKey) => {
    if (saving || !confirmed) return;
    if (section === "evaSim" && eva.mode === "embed" && (eva.url ?? "").trim()) {
      const check = checkEmbedUrl(eva.url ?? "");
      if (!check.ok) {
        setErrors((prev) => ({
          ...prev,
          evaSim: {
            message: check.message ?? "Enter a valid URL.",
            paths: { "evaSim.url": check.message ?? "" },
          },
        }));
        return;
      }
    }
    void submit(section, confirmed);
  };

  const addStandard = (upgrade = false) => {
    if (saving) return;
    const standard = upgrade && confirmed ? upgradeToSectionForms(confirmed) : doc.standard;
    setSaving("registration");
    void save
      .mutateAsync({
        expectedVersionId: revisionRef.current.versionId,
        expectedRevision: revisionRef.current.revision,
        forms: standard,
      })
      .then((ack) => {
        revisionRef.current = { versionId: ack.versionId, revision: ack.versionRevision };
        setIssues(ack.issues);
        if (ack.forms) {
          setConfirmed(ack.forms);
          setRegistration(ack.forms.registration.fields);
          setEva(ack.forms.evaSim);
          setVerbal(
            ack.forms.schemaVersion === 2 ? ack.forms.sectionEntry["reading-writing"].fields : []
          );
          setMath(ack.forms.schemaVersion === 2 ? ack.forms.sectionEntry.math.fields : []);
          setSectionEnabled(enabledSections(ack.forms));
          setReviewUpgrade(false);
        }
        setAnnouncement(
          upgrade ? "Separate section forms enabled for new rooms." : "Standard SAT fields added."
        );
      })
      .catch((error: unknown) =>
        setErrors((prev) => ({ ...prev, registration: issueMessage(error) }))
      )
      .finally(() => setSaving(null));
  };

  const loadLatest = async () => {
    setConfirmReload(false);
    const latest = await reload().catch(() => undefined);
    if (!latest) return;
    revisionRef.current = { versionId: latest.versionId, revision: latest.versionRevision };
    setConfirmed(latest.forms);
    setRegistration(latest.forms?.registration.fields ?? []);
    setEva(latest.forms?.evaSim ?? latest.standard.evaSim);
    setVerbal(
      latest.forms?.schemaVersion === 2 ? latest.forms.sectionEntry["reading-writing"].fields : []
    );
    setMath(latest.forms?.schemaVersion === 2 ? latest.forms.sectionEntry.math.fields : []);
    setSectionEnabled(enabledSections(latest.forms));
    setIssues(latest.issues);
    setConflict(null);
    setErrors({});
  };

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {!doc.editable ? (
        <div className={`${CARD} mb-4 ${MUTED}`}>
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
            Showing the published version.
          </p>
          <p className="mt-1">
            Forms belong to the working draft. Rooms keep the version they captured.
          </p>
          {onEditExam ? (
            <button
              type="button"
              onClick={onEditExam}
              className="sat-btn sat-btn--primary sat-press mt-4"
            >
              Edit this exam
            </button>
          ) : null}
        </div>
      ) : null}
      {conflict ? (
        <div
          role="alert"
          className={`${CARD} mb-4 border-[var(--sat-staff-warning-border)] ${MUTED}`}
        >
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
            These forms changed elsewhere.
          </p>
          <p className="mt-1">
            Load the latest version to continue. Your unsaved form changes are kept until you
            choose.
          </p>
          <button
            type="button"
            className="sat-btn sat-btn--secondary sat-press mt-3"
            onClick={() => setConfirmReload(true)}
          >
            Load latest version
          </button>
        </div>
      ) : null}

      <section aria-labelledby="exam-settings-registration" className="mt-12">
        <h2 id="exam-settings-registration" className={H2}>
          Registration form
        </h2>
        <p className={`mt-2 max-w-2xl ${MUTED}`}>
          Changes apply to newly created rooms. Existing rooms keep their version.
        </p>
        <div className={`${CARD} mt-6`}>
          <dl className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)]">
            <dt className="text-[14px] font-semibold">System details</dt>
            <dd className={MUTED}>
              Student ID/WCODE, full name and email · collected according to access mode
            </dd>
          </dl>
          {legacy ? (
            <div className="mt-5 border-t border-[var(--sat-staff-border-hairline)] pt-4">
              <p className={MUTED}>This version has no registration questions.</p>
              {canEdit ? (
                <button
                  type="button"
                  className="sat-btn sat-btn--primary sat-press mt-3"
                  onClick={() => addStandard()}
                  disabled={saving !== null}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add standard SAT fields
                </button>
              ) : null}
              <SectionErrors error={errors.registration} />
            </div>
          ) : (
            <>
              <FieldListEditor
                fields={registration}
                onChange={setRegistration}
                canEdit={canEdit && saving !== "registration"}
                allowScope={!split}
                kind="registration"
                announce={setAnnouncement}
                pathErrors={errors.registration?.paths ?? {}}
              />
              <SectionErrors error={errors.registration} />
              <SectionFooter
                busy={saving !== null}
                dirty={registrationDirty}
                saving={saving === "registration"}
                canEdit={canEdit}
                label="Save registration form"
                onSave={() => saveSection("registration")}
                extra={<RegistrationPreview fields={registration} />}
              />
            </>
          )}
        </div>
      </section>

      {confirmed?.schemaVersion === 1 ? (
        <div className={`${CARD} mt-6`}>
          <h3 className="font-semibold">Separate section forms</h3>
          <p className={`mt-2 ${MUTED}`}>
            This version collects scoped questions at check-in. Upgrade this draft to ask Verbal
            questions before Verbal and Math questions after the break. New rooms use individual
            timers.
          </p>
          {canEdit ? (
            <button
              type="button"
              className="sat-btn sat-btn--secondary mt-3"
              disabled={saving !== null || dirtyCount > 0}
              onClick={() => setReviewUpgrade(true)}
            >
              Review section form upgrade
            </button>
          ) : null}
          {dirtyCount > 0 ? (
            <p className={`mt-2 ${MUTED}`}>Save your changes before reviewing the upgrade.</p>
          ) : null}
        </div>
      ) : null}
      {split
        ? [
            {
              key: "verbal" as const,
              title: "Verbal entry form",
              fields: verbal,
              enabled: sectionEnabled.verbal,
              change: setVerbal,
              dirty: verbalDirty,
              path: "sectionEntry.reading-writing",
              copy: "Shown before the first Verbal module. An empty form is skipped.",
            },
            {
              key: "math" as const,
              title: "Math entry form",
              fields: math,
              enabled: sectionEnabled.math,
              change: setMath,
              dirty: mathDirty,
              path: "sectionEntry.math",
              copy: "Shown after the break, before the first Math module. Math-only sittings show it before Math. An empty form is skipped.",
            },
          ].map((item) => (
            <section key={item.key} aria-labelledby={`exam-settings-${item.key}`} className="mt-12">
              <h2 id={`exam-settings-${item.key}`} className={H2}>
                {item.title}
              </h2>
              <p className={`mt-2 max-w-2xl ${MUTED}`}>
                {item.copy} Filling this form does not use exam time. Answers are sealed on
                submission. Changes apply to new rooms.
              </p>
              <div className={`${CARD} mt-6`}>
                <label
                  htmlFor={`section-${item.key}-enabled`}
                  className="flex min-h-11 items-center justify-between gap-4 text-[15px] font-semibold"
                >
                  Enable {item.title}
                  <input
                    id={`section-${item.key}-enabled`}
                    type="checkbox"
                    role="switch"
                    aria-label={`Enable ${item.title}`}
                    checked={item.enabled}
                    disabled={!canEdit || saving === item.key}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setSectionEnabled((current) => ({ ...current, [item.key]: enabled }));
                    }}
                    className="h-5 w-5 shrink-0 accent-[var(--sat-staff-accent,#0071e3)]"
                  />
                </label>
                {!item.enabled ? (
                  <p className={`mt-2 ${MUTED}`}>
                    Disabled — students skip this form. Questions are kept so you can enable it
                    again later.
                  </p>
                ) : null}
                <FieldListEditor
                  fields={item.fields}
                  onChange={item.change}
                  canEdit={canEdit && saving !== item.key}
                  allowScope={false}
                  kind={item.path}
                  announce={setAnnouncement}
                  pathErrors={errors[item.key]?.paths ?? {}}
                />
                <SectionErrors error={errors[item.key]} />
                <SectionFooter
                  busy={saving !== null}
                  dirty={item.dirty}
                  saving={saving === item.key}
                  canEdit={canEdit}
                  label={`Save ${item.title}`}
                  onSave={() => saveSection(item.key)}
                  extra={
                    <RegistrationPreview
                      fields={item.fields}
                      title={item.title}
                      sectionForm
                      disabledForm={!item.enabled}
                    />
                  }
                />
              </div>
            </section>
          ))
        : null}
      {reviewUpgrade && confirmed ? (
        <AuthoringDialog
          open
          title="Review section form upgrade"
          description="Only this working draft changes. Existing rooms keep their forms and timers."
          onClose={() => setReviewUpgrade(false)}
        >
          {(() => {
            const next = upgradeToSectionForms(confirmed);
            return [
              { title: "Common check-in", fields: next.registration.fields },
              { title: "Before Verbal", fields: next.sectionEntry["reading-writing"].fields },
              { title: "Before Math", fields: next.sectionEntry.math.fields },
            ].map((item) => (
              <div key={item.title} className="mt-4">
                <h3 className="font-semibold">{item.title}</h3>
                <p className={MUTED}>
                  {item.fields.map((field) => field.label).join(", ") || "No questions — skipped"}
                </p>
              </div>
            ));
          })()}
          <p className={`mt-4 ${MUTED}`}>
            Question IDs, options and validation are preserved. New rooms require individual timers.
          </p>
          <SectionErrors error={errors.registration} />
          <button
            type="button"
            className="sat-btn sat-btn--primary mt-4"
            disabled={saving !== null}
            onClick={() => addStandard(true)}
          >
            {saving ? "Saving…" : "Enable separate section forms"}
          </button>
        </AuthoringDialog>
      ) : null}

      {!legacy ? (
        <section aria-labelledby="exam-settings-eva" className="mt-12">
          <h2 id="exam-settings-eva" className={H2}>
            Eva SIM
          </h2>
          <p className={`mt-2 max-w-2xl ${MUTED}`}>
            Shown after Math is completed. Staff End exam closes access here. Changes apply to newly
            created rooms.
          </p>
          <EvaEditor
            eva={eva}
            sectionForms={split}
            onChange={setEva}
            canEdit={canEdit && saving !== "evaSim"}
            announce={setAnnouncement}
            errors={errors.evaSim}
            readiness={
              evaReadinessIssue({ ...confirmed, evaSim: eva }) ??
              sectionIssues(issues, "evaSim")[0]?.message ??
              null
            }
            footer={
              <SectionFooter
                busy={saving !== null}
                dirty={evaDirty}
                saving={saving === "evaSim"}
                canEdit={canEdit}
                label="Save Eva SIM"
                onSave={() => saveSection("evaSim")}
              />
            }
          />
        </section>
      ) : null}

      <AuthoringConfirmDialog
        open={confirmReload}
        title="Load the latest forms?"
        description="Your unsaved form changes will be discarded."
        confirmLabel="Discard and load"
        destructive
        onCancel={() => setConfirmReload(false)}
        onConfirm={() => void loadLatest()}
      />
    </>
  );
}

function SectionErrors({
  error,
}: {
  error: { message: string; paths: Record<string, string> } | undefined;
}) {
  if (!error) return null;
  const entries = Object.entries(error.paths).filter(([path]) => path !== "evaSim.url");
  return (
    <div
      role="alert"
      className="mt-4 text-[14px] font-medium leading-5 text-[var(--sat-staff-danger,#b42318)]"
    >
      {entries.length === 0 && !error.paths["evaSim.url"] ? <p>{error.message}</p> : null}
      {entries.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {entries.map(([path, message]) => (
            <li key={path}>{describePath(path, message)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SectionFooter({
  dirty,
  busy = false,
  saving,
  canEdit,
  label,
  onSave,
  extra,
}: {
  dirty: boolean;
  busy?: boolean;
  saving: boolean;
  canEdit: boolean;
  label: string;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sat-staff-border-hairline)] pt-4">
      <p role="status" className={`flex items-center gap-1.5 ${MUTED}`}>
        {saving ? (
          "Saving…"
        ) : dirty ? (
          "Unsaved changes"
        ) : (
          <>
            <Check
              size={16}
              aria-hidden="true"
              className="text-[var(--sat-staff-success-dot,#059669)]"
            />
            Saved
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {canEdit ? (
          <button
            type="button"
            onClick={onSave}
            disabled={saving || busy || !dirty}
            aria-busy={saving || undefined}
            className="sat-btn sat-btn--primary sat-press"
          >
            {saving ? (
              <span aria-hidden="true" className="sat-btn__spinner" />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- field editor

function FieldListEditor({
  fields,
  legacyEvaScope = false,
  onChange,
  canEdit,
  allowScope,
  kind,
  announce,
  pathErrors,
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
  canEdit: boolean;
  allowScope: boolean;
  kind: string;
  legacyEvaScope?: boolean;
  announce: (message: string) => void;
  pathErrors: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormField | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const move = (index: number, delta: number, direction: "up" | "down") => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = fields.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(next);
    announce(`${item.label || "Question"} moved to position ${target + 1} of ${next.length}.`);
    // Keep focus on the moved question's same control.
    requestAnimationFrame(() => {
      const button = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-move="${item.id}-${direction}"]`
      );
      const fallback = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-move="${item.id}-${direction === "up" ? "down" : "up"}"]`
      );
      (button && !button.disabled ? button : fallback)?.focus();
    });
  };

  const update = (index: number, field: FormField) =>
    onChange(fields.map((current, i) => (i === index ? field : current)));

  const add = () => {
    const field: FormField = {
      id: newFieldId("q"),
      type: "text",
      label: "",
      required: false,
      ...(allowScope
        ? { scope: "all" as const }
        : legacyEvaScope
          ? { scope: "math" as const }
          : {}),
      maxLength: 255,
    };
    onChange([...fields, field]);
    setExpanded(field.id);
    requestAnimationFrame(() => document.getElementById(`${field.id}-label`)?.focus());
  };

  return (
    <div className="mt-5 border-t border-[var(--sat-staff-border-hairline)] pt-4">
      {fields.length === 0 ? <p className={MUTED}>No questions yet.</p> : null}
      <ol ref={listRef} className="space-y-2">
        {fields.map((field, index) => {
          const open = expanded === field.id;
          const fieldErrors = Object.entries(pathErrors)
            .filter(([path]) => path.startsWith(`${kind}.fields[${index}]`))
            .map(([, message]) => message);
          return (
            <li
              key={field.id}
              className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)]"
            >
              <div className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                    {field.label || "Untitled question"}
                  </p>
                  <p className={MUTED}>
                    {fieldTypeLabel(field.type)} · {field.required ? "Required" : "Optional"}
                    {allowScope ? ` · ${scopeLabel(field.scope)}` : ""}
                  </p>
                  {fieldErrors.length > 0 && !open ? (
                    <p className="text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)]">
                      {fieldErrors[0]}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-move={`${field.id}-up`}
                      className="sat-btn sat-btn--quiet sat-btn--icon"
                      aria-label={`Move ${field.label || "question"} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1, "up")}
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-move={`${field.id}-down`}
                      className="sat-btn sat-btn--quiet sat-btn--icon"
                      aria-label={`Move ${field.label || "question"} down`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1, "down")}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="sat-btn sat-btn--quiet sat-btn--icon"
                      aria-label={`Delete ${field.label || "question"}`}
                      onClick={() => setPendingDelete(field)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="sat-btn sat-btn--secondary sat-press"
                  aria-expanded={open}
                  aria-controls={`${field.id}-editor`}
                  onClick={() => setExpanded(open ? null : field.id)}
                >
                  {open ? (
                    <ChevronUp size={16} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={16} aria-hidden="true" />
                  )}
                  {canEdit ? (open ? "Done" : "Edit") : open ? "Hide" : "View"}
                  <span className="sr-only"> {field.label || "question"}</span>
                </button>
              </div>
              {open ? (
                <div
                  id={`${field.id}-editor`}
                  className="border-t border-[var(--sat-staff-border-hairline)] p-3"
                >
                  <FieldEditor
                    field={field}
                    onChange={(next) => update(index, next)}
                    canEdit={canEdit}
                    allowScope={allowScope}
                    errors={fieldErrors}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canEdit ? (
        <button type="button" className="sat-btn sat-btn--secondary sat-press mt-3" onClick={add}>
          <Plus size={16} aria-hidden="true" />
          Add question
        </button>
      ) : null}
      <AuthoringConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.label || "Untitled question"}”?`}
        description="Rooms already created keep their questions and responses. New rooms will not ask this question."
        confirmLabel="Delete question"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          onChange(fields.filter((field) => field.id !== target.id));
          announce(`${target.label || "Question"} deleted.`);
        }}
      />
    </div>
  );
}

function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function FieldEditor({
  field,
  onChange,
  canEdit,
  allowScope,
  errors,
}: {
  field: FormField;
  onChange: (field: FormField) => void;
  canEdit: boolean;
  allowScope: boolean;
  errors: string[];
}) {
  const disabled = !canEdit;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SatField id={`${field.id}-label`} label="Label" className="sm:col-span-2">
        {(control) => (
          <input
            {...control}
            className="sat-input"
            value={field.label}
            disabled={disabled}
            maxLength={200}
            onChange={(event) => onChange({ ...field, label: event.target.value })}
          />
        )}
      </SatField>
      <SatField id={`${field.id}-help`} label="Help text" optional className="sm:col-span-2">
        {(control) => (
          <input
            {...control}
            className="sat-input"
            value={field.help ?? ""}
            disabled={disabled}
            maxLength={300}
            onChange={(event) => onChange({ ...field, help: event.target.value || undefined })}
          />
        )}
      </SatField>
      <SatField id={`${field.id}-type`} label="Type">
        {(control) => (
          <select
            {...control}
            className="sat-input"
            value={field.type}
            disabled={disabled}
            onChange={(event) =>
              onChange(withFieldType(field, event.target.value as FormField["type"]))
            }
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="single_choice">Single choice</option>
          </select>
        )}
      </SatField>
      {allowScope ? (
        <SatField id={`${field.id}-scope`} label="Applies to">
          {(control) => (
            <select
              {...control}
              className="sat-input"
              value={field.scope}
              disabled={disabled}
              onChange={(event) => onChange({ ...field, scope: event.target.value as FieldScope })}
            >
              <option value="all">All sections</option>
              <option value="math">Math</option>
              <option value="reading-writing">Reading &amp; Writing</option>
            </select>
          )}
        </SatField>
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-[14px] font-semibold sm:col-span-2">
        <input
          type="checkbox"
          className="size-5"
          checked={field.required}
          disabled={disabled}
          onChange={(event) => onChange({ ...field, required: event.target.checked })}
        />
        Required
      </label>
      {field.type === "text" ? (
        <SatField id={`${field.id}-max`} label="Character limit">
          {(control) => (
            <input
              {...control}
              className="sat-input"
              inputMode="numeric"
              value={String(field.maxLength)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...field,
                  maxLength: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                })
              }
            />
          )}
        </SatField>
      ) : null}
      {field.type === "number" ? (
        <>
          <label className="flex min-h-11 items-center gap-2 text-[14px] font-semibold sm:col-span-2">
            <input
              type="checkbox"
              className="size-5"
              checked={Boolean(field.integer)}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...field, integer: event.target.checked || undefined })
              }
            />
            Whole numbers only
          </label>
          <SatField id={`${field.id}-min`} label="Minimum" optional>
            {(control) => (
              <input
                {...control}
                className="sat-input"
                inputMode="decimal"
                defaultValue={field.min ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...field, min: numberOrUndefined(event.target.value) })
                }
              />
            )}
          </SatField>
          <SatField id={`${field.id}-max`} label="Maximum" optional>
            {(control) => (
              <input
                {...control}
                className="sat-input"
                inputMode="decimal"
                defaultValue={field.max ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...field, max: numberOrUndefined(event.target.value) })
                }
              />
            )}
          </SatField>
        </>
      ) : null}
      {field.type === "single_choice" ? (
        <fieldset className="sm:col-span-2">
          <legend className="text-[14px] font-semibold">Options</legend>
          <ol className="mt-2 space-y-2">
            {field.options.map((option, index) => (
              <li key={option.id} className="flex items-center gap-2">
                <input
                  className="sat-input"
                  aria-label={`Option ${index + 1}`}
                  value={option.label}
                  disabled={disabled}
                  maxLength={200}
                  onChange={(event) =>
                    onChange({
                      ...field,
                      options: field.options.map((o) =>
                        o.id === option.id ? { ...o, label: event.target.value } : o
                      ),
                    })
                  }
                />
                {canEdit ? (
                  <button
                    type="button"
                    className="sat-btn sat-btn--quiet sat-btn--icon"
                    aria-label={`Remove option ${option.label || index + 1}`}
                    disabled={field.options.length <= 1}
                    onClick={() =>
                      onChange({
                        ...field,
                        options: field.options.filter((o) => o.id !== option.id),
                      })
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {canEdit && field.options.length < 50 ? (
            <button
              type="button"
              className="sat-btn sat-btn--quiet sat-press mt-2"
              onClick={() =>
                onChange({
                  ...field,
                  options: [
                    ...field.options,
                    { id: newFieldId("opt"), label: `Option ${field.options.length + 1}` },
                  ],
                })
              }
            >
              <Plus size={16} aria-hidden="true" />
              Add option
            </button>
          ) : null}
        </fieldset>
      ) : null}
      {errors.length > 0 ? (
        <ul
          role="alert"
          className="list-disc space-y-1 pl-5 text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)] sm:col-span-2"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ preview

const PREVIEW_SCOPES: ReadonlyArray<{
  value: string;
  label: string;
  sections: SittingSection[] | null;
}> = [
  { value: "full", label: "Full SAT", sections: null },
  { value: "math", label: "Math only", sections: ["math"] },
  { value: "reading-writing", label: "Reading & Writing only", sections: ["reading-writing"] },
];

function RegistrationPreview({
  fields,
  title = "Registration form",
  sectionForm = false,
  disabledForm = false,
}: {
  fields: FormField[];
  title?: string;
  sectionForm?: boolean;
  disabledForm?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("full");
  const [values, setValues] = useState<RawAnswers>({});
  const groupId = useId();
  const sections = PREVIEW_SCOPES.find((option) => option.value === scope)?.sections ?? null;
  const shown = applicableFields(fields, sections);
  return (
    <>
      <button
        type="button"
        className="sat-btn sat-btn--secondary sat-press"
        onClick={() => setOpen(true)}
      >
        <Eye size={16} aria-hidden="true" />
        {title === "Registration form" ? "Preview registration" : `Preview ${title}`}
      </button>
      <AuthoringDialog
        open={open}
        title={
          title === "Registration form"
            ? "Preview registration (draft)"
            : `Preview ${title} (draft)`
        }
        description="Draft content. Nothing is submitted."
        onClose={() => setOpen(false)}
      >
        {disabledForm ? (
          <p className={`mb-4 ${MUTED}`}>
            This form is disabled for new rooms. These questions are kept for later.
          </p>
        ) : null}
        {!sectionForm ? (
          <fieldset aria-labelledby={groupId} className="mb-4">
            <p id={groupId} className="text-[14px] font-semibold">
              Sitting
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {PREVIEW_SCOPES.map((option) => (
                <label key={option.value} className="flex min-h-11 items-center gap-2 text-[14px]">
                  <input
                    type="radio"
                    name={`${groupId}-scope`}
                    value={option.value}
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="sat-ui rounded-xl border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] p-5 text-[var(--sat-text)]">
          <p className="text-[15px] font-semibold">{sectionForm ? title : "Exam details"}</p>
          <div className="mt-3">
            {shown.length === 0 ? (
              <p className="text-[14px] text-[var(--sat-text-secondary)]">
                No exam details are asked for this sitting.
              </p>
            ) : (
              <FormFields
                fields={shown}
                values={values}
                onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
                idPrefix="registration-preview"
              />
            )}
          </div>
        </div>
      </AuthoringDialog>
    </>
  );
}

// --------------------------------------------------------------------- Eva

function EvaEditor({
  eva,
  sectionForms = false,
  onChange,
  canEdit,
  announce,
  errors,
  readiness,
  footer,
}: {
  eva: EvaSimConfig;
  sectionForms?: boolean;
  onChange: (eva: EvaSimConfig) => void;
  canEdit: boolean;
  announce: (message: string) => void;
  errors: { message: string; paths: Record<string, string> } | undefined;
  readiness: string | null;
  footer: React.ReactNode;
}) {
  const [pendingMode, setPendingMode] = useState<EvaMode | null>(null);
  const [preview, setPreview] = useState(false);
  const modeName = useId();
  const switchMode = (mode: EvaMode) => {
    if (mode === eva.mode) return;
    const hasContent =
      eva.mode === "native" ? (eva.fields?.length ?? 0) > 0 : Boolean((eva.url ?? "").trim());
    if (hasContent) setPendingMode(mode);
    else
      onChange(
        mode === "native"
          ? { enabled: eva.enabled, mode, fields: [] }
          : { enabled: eva.enabled, mode, url: "" }
      );
  };
  const url = eva.url ?? "";
  const urlCheck = url.trim() ? checkEmbedUrl(url) : null;
  const urlError =
    errors?.paths["evaSim.url"] || (urlCheck && !urlCheck.ok ? urlCheck.message : null) || null;
  return (
    <div className={`${CARD} mt-6`}>
      <label className="flex min-h-11 items-center justify-between gap-3 text-[15px] font-semibold">
        Enable Eva SIM
        <input
          type="checkbox"
          role="switch"
          className="size-5"
          checked={eva.enabled}
          disabled={!canEdit}
          onChange={(event) => onChange({ ...eva, enabled: event.target.checked })}
        />
      </label>
      <fieldset className="mt-4 border-t border-[var(--sat-staff-border-hairline)] pt-4">
        <legend className="text-[14px] font-semibold">Form type</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(["native", "embed"] as const).map((mode) => (
            <label key={mode} className="flex min-h-11 items-center gap-2 text-[14px]">
              <input
                type="radio"
                name={modeName}
                value={mode}
                checked={eva.mode === mode}
                disabled={!canEdit}
                onChange={() => switchMode(mode)}
              />
              {mode === "native" ? "Native form" : "Embedded link"}
            </label>
          ))}
        </div>
        <p className={`mt-1 ${MUTED}`}>Saving replaces the previous form type for future rooms.</p>
      </fieldset>
      {readiness && eva.enabled ? (
        <p
          role="status"
          className="mt-4 rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-warning-border)] bg-[var(--sat-staff-warning-tint)] p-3 text-[14px] text-[var(--sat-staff-warning-text,#92400e)]"
        >
          {readiness} Rooms cannot be created until this is fixed.
        </p>
      ) : null}
      {eva.mode === "native" ? (
        <FieldListEditor
          fields={eva.fields ?? []}
          onChange={(fields) => onChange({ ...eva, fields })}
          canEdit={canEdit}
          allowScope={false}
          kind="evaSim"
          legacyEvaScope={!sectionForms}
          announce={announce}
          pathErrors={errors?.paths ?? {}}
        />
      ) : (
        <div className="mt-5 border-t border-[var(--sat-staff-border-hairline)] pt-4">
          <SatField
            id="eva-sim-url"
            label="Form URL"
            error={urlError}
            help={
              urlCheck?.ok
                ? `Destination: ${urlCheck.host}`
                : "An https:// link to the external form. Students see the destination hostname."
            }
          >
            {(control) => (
              <input
                {...control}
                type="url"
                inputMode="url"
                className="sat-input [overflow-wrap:anywhere]"
                value={url}
                disabled={!canEdit}
                maxLength={2048}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onChange({ ...eva, url: event.target.value })}
              />
            )}
          </SatField>
          {urlCheck?.ok ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="sat-btn sat-btn--secondary sat-press"
                onClick={() => setPreview(true)}
              >
                <Eye size={16} aria-hidden="true" />
                Preview
              </button>
              <a
                href={url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="sat-btn sat-btn--quiet sat-press"
              >
                Open in new tab
                <ExternalLink size={16} aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          ) : null}
        </div>
      )}
      <SectionErrors error={errors} />
      {footer}
      <AuthoringConfirmDialog
        open={pendingMode !== null}
        title="Change the Eva SIM form type?"
        description={
          pendingMode === "embed"
            ? "Your native Eva SIM questions in this draft will be discarded when you save."
            : "The Eva SIM URL in this draft will be discarded when you save."
        }
        confirmLabel="Change form type"
        destructive
        onCancel={() => setPendingMode(null)}
        onConfirm={() => {
          const mode = pendingMode;
          setPendingMode(null);
          if (!mode) return;
          onChange(
            mode === "native"
              ? { enabled: eva.enabled, mode, fields: [] }
              : { enabled: eva.enabled, mode, url: "" }
          );
        }}
      />
      {preview && urlCheck?.ok ? (
        <AuthoringDialog
          open
          title="Eva SIM preview"
          description="Preview — opening this external form may allow real submissions."
          onClose={() => setPreview(false)}
          contentClassName="max-w-[960px]"
        >
          <p className="text-[14px] font-semibold text-[var(--sat-staff-warning-text,#92400e)]">
            Preview — opening this external form may allow real submissions.
          </p>
          <p className={`mt-1 ${MUTED}`}>Responses are collected by {urlCheck.host}.</p>
          <a
            href={url.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="sat-btn sat-btn--quiet sat-press mt-2"
          >
            Open in new tab
            <ExternalLink size={16} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <EvaEmbedFrame
            src={url.trim()}
            host={urlCheck.host ?? ""}
            className="mt-3 block h-[60vh] min-h-[360px] w-full rounded-xl border border-[var(--sat-staff-border-hairline)] bg-white"
          />
        </AuthoringDialog>
      ) : null}
    </div>
  );
}
