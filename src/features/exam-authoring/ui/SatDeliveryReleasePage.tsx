import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GitBranch,
  Info,
  Link2,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
} from "lucide-react";
import type { ExamEntity } from "../../../types/domain";
import { useUpdateSectionDeliverySettings } from "../api/assessmentQueries";
import type {
  AssessmentAuthoringShell,
  AssessmentSectionShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
} from "../contracts/assessment";
import type { AssessmentReleaseState } from "../contracts/release";

interface SatDeliveryReleasePageProps {
  exam: ExamEntity;
  shell: AssessmentAuthoringShell | null;
  releaseState: AssessmentReleaseState | null;
  isLoading: boolean;
  loadError: string | null;
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  readinessError: string | null;
  isPublishing: boolean;
  publishError: string | null;
  onBackToBuilder: () => void;
  onBackToExams: () => void;
  onRefreshReadiness: () => Promise<unknown>;
  onPublish: (publishNotes?: string) => Promise<void>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
  onOpenStudentAccess: () => void;
}

const surfaceClass =
  "rounded-[22px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

export function SatDeliveryReleasePage(props: SatDeliveryReleasePageProps) {
  const {
    exam,
    shell,
    releaseState,
    isLoading,
    loadError,
    readiness,
    isChecking,
    readinessError,
    isPublishing,
    publishError,
    onBackToBuilder,
    onBackToExams,
    onRefreshReadiness,
    onPublish,
    onIssueClick,
    onOpenStudentAccess,
  } = props;
  const [dirtySections, setDirtySections] = useState<Set<string>>(() => new Set());
  const [showPublishDialog, setShowPublishDialog] = useState(false);

  const setSectionDirty = useCallback((sectionId: string, dirty: boolean) => {
    setDirtySections((current) => {
      if (current.has(sectionId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  if (isLoading) {
    return <ReleaseLoadingSurface />;
  }

  if (loadError || !shell || !releaseState) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] px-6 py-12">
        <div className="mx-auto max-w-2xl rounded-[22px] border border-red-200 bg-white p-6">
          <p className="text-base font-semibold text-slate-950">
            Delivery & Release could not load
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {loadError ?? "The current SAT release state is unavailable."}
          </p>
          <button
            type="button"
            onClick={onBackToExams}
            className="mt-5 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"
          >
            Exam Library
          </button>
        </div>
      </div>
    );
  }
  const readinessFresh =
    readiness?.versionId === shell.versionId && readiness.versionRevision === shell.versionRevision;
  const blockers = readinessFresh ? readiness.errors : [];
  const warnings = readinessFresh ? readiness.warnings : [];
  const totalCandidateSeconds = shell.sections.reduce(
    (sum, section) => sum + section.durationSeconds + section.breakAfterSeconds,
    0
  );
  const canPublish =
    releaseState.state !== "published_current" &&
    Boolean(readinessFresh && readiness?.valid) &&
    dirtySections.size === 0 &&
    !isPublishing;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-950">
      <ReleaseHeader
        examTitle={exam.title}
        onBack={onBackToBuilder}
        onOpenStudentAccess={releaseState.currentPublishedVersion ? onOpenStudentAccess : undefined}
      />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <ReleaseStatusHero
          releaseState={releaseState}
          readiness={readinessFresh ? readiness : null}
          isChecking={isChecking}
          dirtyCount={dirtySections.size}
        />

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className={`${surfaceClass} p-5 sm:p-6`}>
              <SectionHeading
                eyebrow="Delivery plan"
                title="Timing & adaptive routing"
                description="Configure the server-authoritative path a candidate can take. Each section saves independently with optimistic concurrency protection."
              />
              <div className="mt-6 space-y-4">
                {shell.sections.map((section) => (
                  <SectionDeliveryEditor
                    key={section.id}
                    examId={exam.id}
                    section={section}
                    onDirtyChange={setSectionDirty}
                  />
                ))}
              </div>
            </section>

            {releaseState.state !== "published_current" ? (
              <ReadinessPanel
                readiness={readinessFresh ? readiness : null}
                isChecking={isChecking}
                error={readinessError}
                onRefresh={onRefreshReadiness}
                onIssueClick={onIssueClick}
              />
            ) : null}

            <RuntimePolicyPanel />
          </div>

          <ReleaseSummary
            examTitle={exam.title}
            releaseState={releaseState}
            blockerCount={blockers.length}
            warningCount={warnings.length}
            dirtyCount={dirtySections.size}
            canPublish={canPublish}
            isPublishing={isPublishing}
            publishError={publishError}
            onPublish={() => setShowPublishDialog(true)}
            onOpenStudentAccess={onOpenStudentAccess}
          />
        </div>
      </main>

      <PublishAssessmentDialog
        open={showPublishDialog}
        examTitle={exam.title}
        shell={shell}
        blockerCount={blockers.length}
        warningCount={warnings.length}
        candidateSeconds={totalCandidateSeconds}
        isPublishing={isPublishing}
        isUpdate={releaseState.state === "unpublished_changes"}
        currentPublishedVersionNumber={releaseState.currentPublishedVersion?.versionNumber ?? null}
        onClose={() => setShowPublishDialog(false)}
        onConfirm={onPublish}
      />
    </div>
  );
}

function ReleaseHeader({
  examTitle,
  onBack,
  onOpenStudentAccess,
}: {
  examTitle: string;
  onBack: () => void;
  onOpenStudentAccess?: (() => void) | undefined;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/88 backdrop-blur-2xl">
      <div className="mx-auto flex min-h-[68px] max-w-[1240px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Questions
        </button>
        <div className="h-5 w-px bg-black/[0.08]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-950">{examTitle}</p>
          <p className="mt-0.5 text-xs text-slate-500">Release</p>
        </div>
        {onOpenStudentAccess ? (
          <button
            type="button"
            onClick={onOpenStudentAccess}
            className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-950"
          >
            <Link2 size={14} aria-hidden="true" />
            Student Access
          </button>
        ) : null}
      </div>
    </header>
  );
}

function ReleaseStatusHero({
  releaseState,
  readiness,
  isChecking,
  dirtyCount,
}: {
  releaseState: AssessmentReleaseState;
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  dirtyCount: number;
}) {
  const publishedVersion = releaseState.currentPublishedVersion;
  const ready = Boolean(readiness?.valid) && dirtyCount === 0;
  const publishedCurrent = releaseState.state === "published_current" && dirtyCount === 0;
  const changed = releaseState.state === "unpublished_changes" || dirtyCount > 0;
  const heading = publishedCurrent
    ? "Published"
    : changed && publishedVersion
      ? "Unpublished changes"
      : isChecking
        ? "Checking publish readiness…"
        : ready
          ? "Ready to publish"
          : readiness
            ? "Review required"
            : "Preparing release checks";
  const description = dirtyCount > 0
    ? `Save ${dirtyCount} delivery section${dirtyCount === 1 ? "" : "s"} before publishing.`
    : publishedCurrent && publishedVersion
      ? `Version ${publishedVersion.versionNumber} is what students receive.`
      : changed && publishedVersion
        ? `Students still receive Version ${publishedVersion.versionNumber}.`
        : readiness?.valid
          ? "Everything required for the first release is ready."
          : "Resolve blocking issues before publishing.";
  const tone = publishedCurrent || ready ? "emerald" : changed || readiness ? "amber" : "slate";

  return (
    <section className={`${surfaceClass} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${tone === "emerald" ? "bg-emerald-50 text-emerald-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
          {isChecking && !publishedCurrent ? <LoaderCircle size={19} className="animate-spin" /> : publishedCurrent || ready ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Release status</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.025em] text-slate-950">{heading}</h1>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      {publishedVersion ? (
        <div className="shrink-0 self-start text-right sm:self-auto">
          <p className="text-xs font-semibold text-slate-700">Version {publishedVersion.versionNumber}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Published {formatPublishedDate(publishedVersion.publishedAt)}</p>
        </div>
      ) : null}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.02em] text-slate-950">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}
function SectionDeliveryEditor({
  examId,
  section,
  onDirtyChange,
}: {
  examId: string;
  section: AssessmentSectionShell;
  onDirtyChange: (sectionId: string, dirty: boolean) => void;
}) {
  const update = useUpdateSectionDeliverySettings(examId);
  const base = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "base"),
    [section.modules]
  );
  const lower = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "lower_branch"),
    [section.modules]
  );
  const higher = useMemo(
    () => section.modules.find((module) => module.adaptiveRole === "higher_branch"),
    [section.modules]
  );
  const routing = section.routingPolicy;
  const [baseMinutes, setBaseMinutes] = useState(1);
  const [lowerMinutes, setLowerMinutes] = useState(1);
  const [higherMinutes, setHigherMinutes] = useState(1);
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [threshold, setThreshold] = useState(1);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setBaseMinutes(secondsToMinutes(base?.durationSeconds ?? 60));
    setLowerMinutes(secondsToMinutes(lower?.durationSeconds ?? 60));
    setHigherMinutes(secondsToMinutes(higher?.durationSeconds ?? 60));
    setBreakMinutes(Math.max(0, Math.round(section.breakAfterSeconds / 60)));
    setThreshold(routing?.minimumCorrectForHigher ?? 1);
    setLocalError(null);
    onDirtyChange(section.id, false);
  }, [
    base?.durationSeconds,
    higher?.durationSeconds,
    lower?.durationSeconds,
    onDirtyChange,
    routing?.minimumCorrectForHigher,
    section.breakAfterSeconds,
    section.id,
    section.revision,
  ]);

  const operationalCount = Math.max(1, routing?.operationalQuestionCount ?? 1);
  const dirty = Boolean(
    base &&
    lower &&
    higher &&
    routing &&
    (baseMinutes * 60 !== base.durationSeconds ||
      lowerMinutes * 60 !== lower.durationSeconds ||
      higherMinutes * 60 !== higher.durationSeconds ||
      breakMinutes * 60 !== section.breakAfterSeconds ||
      threshold !== routing.minimumCorrectForHigher)
  );

  useEffect(() => {
    onDirtyChange(section.id, dirty);
  }, [dirty, onDirtyChange, section.id]);

  if (!base || !lower || !higher || !routing) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
        <p className="font-semibold">{section.title} has an incomplete adaptive structure.</p>
        <p className="mt-1 text-red-700">
          A base module plus lower and higher branches are required before publishing.
        </p>
      </div>
    );
  }

  const save = async () => {
    setLocalError(null);
    if (threshold < 1 || threshold > operationalCount) {
      setLocalError(`Higher-route threshold must be between 1 and ${operationalCount}.`);
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
      onDirtyChange(section.id, false);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Delivery settings could not be saved."
      );
    }
  };

  const candidateMinutes = baseMinutes + Math.max(lowerMinutes, higherMinutes);
  return (
    <article className="rounded-[18px] border border-black/[0.07] bg-[#fbfbfc] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.015em] text-slate-950">
            {section.title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Candidate path · {candidateMinutes} min
            {breakMinutes > 0 ? ` + ${breakMinutes} min break` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-black/[0.06]">
          <Clock3 size={12} aria-hidden="true" /> Server timed
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MinuteField label="Module 1" value={baseMinutes} onChange={setBaseMinutes} />
        <MinuteField label="Module 2 · Lower" value={lowerMinutes} onChange={setLowerMinutes} />
        <MinuteField label="Module 2 · Higher" value={higherMinutes} onChange={setHigherMinutes} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px]">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <GitBranch size={14} className="text-slate-400" aria-hidden="true" /> Adaptive routing
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr] sm:items-center">
            <NumberField
              label="Higher route at"
              value={threshold}
              min={1}
              max={operationalCount}
              suffix="correct"
              onChange={setThreshold}
            />
            <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-xs leading-5 text-slate-600">
              <span className="font-semibold text-slate-800">0–{Math.max(0, threshold - 1)}</span> →
              Lower
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-semibold text-slate-800">
                {threshold}–{operationalCount}
              </span>{" "}
              → Higher
              <div className="mt-0.5 text-[11px] text-slate-400">
                {operationalCount} operational questions · provider-defined
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <MinuteField
            label="Break after section"
            value={breakMinutes}
            onChange={setBreakMinutes}
            allowZero
          />
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            Applied after the section completes.
          </p>
        </div>
      </div>

      {localError ? (
        <p role="alert" className="mt-3 text-xs font-medium text-red-700">
          {localError}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-4">
        <p className="text-xs text-slate-400">Section revision {section.revision}</p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || update.isPending}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {update.isPending ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {update.isPending ? "Saving…" : dirty ? "Save section" : "Saved"}
        </button>
      </div>
    </article>
  );
}
function MinuteField({
  label,
  value,
  onChange,
  allowZero = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowZero?: boolean;
}) {
  const id = useId();
  const minimum = allowZero ? 0 : 1;
  return (
    <label htmlFor={id} className="block text-xs font-medium text-slate-500">
      {label}
      <div className="mt-1.5 flex min-h-11 items-center rounded-xl border border-black/[0.08] bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15">
        <input
          id={id}
          aria-label={label}
          type="number"
          min={minimum}
          value={value}
          onChange={(event) => onChange(Math.max(minimum, Number(event.target.value) || 0))}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-slate-950 outline-none"
        />
        <span className="text-xs text-slate-400">min</span>
      </div>
    </label>
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block text-xs font-medium text-slate-500">
      {label}
      <div className="mt-1.5 flex min-h-11 items-center rounded-xl border border-black/[0.08] bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15">
        <input
          id={id}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) =>
            onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))
          }
          className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-slate-950 outline-none"
        />
        <span className="text-[11px] text-slate-400">{suffix}</span>
      </div>
    </label>
  );
}

function secondsToMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}
function ReadinessPanel({
  readiness,
  isChecking,
  error,
  onRefresh,
  onIssueClick,
}: {
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  error: string | null;
  onRefresh: () => Promise<unknown>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
}) {
  const blockers = readiness?.errors ?? [];
  const warnings = readiness?.warnings ?? [];
  return (
    <section className={`${surfaceClass} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          eyebrow="Publish readiness"
          title="Release checks"
          description="Checks are evaluated by the SAT provider against the exact draft revision shown on this page."
        />
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isChecking}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-[#f5f5f7] px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-200/70 disabled:opacity-50"
        >
          {isChecking ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          {isChecking ? "Checking…" : "Run checks"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!readiness && !isChecking ? (
        <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4 text-sm leading-6 text-slate-600">
          Publish checks have not completed for this draft revision yet.
        </div>
      ) : null}

      {readiness ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ReadinessCount
            icon={blockers.length === 0 ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            label="Blocking issues"
            value={blockers.length}
            tone={blockers.length === 0 ? "success" : "danger"}
          />
          <ReadinessCount
            icon={<Info size={17} />}
            label="Recommendations"
            value={warnings.length}
            tone={warnings.length === 0 ? "neutral" : "warning"}
          />
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <IssueList
          title="Must fix before publishing"
          issues={blockers}
          onIssueClick={onIssueClick}
        />
      ) : readiness ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 size={17} aria-hidden="true" /> No blocking release issues.
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <IssueList title="Recommendations" issues={warnings} onIssueClick={onIssueClick} warning />
      ) : null}
    </section>
  );
}

function ReadinessCount({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  const classes = {
    success: "bg-emerald-50 text-emerald-800",
    danger: "bg-red-50 text-red-800",
    warning: "bg-amber-50 text-amber-800",
    neutral: "bg-[#f5f5f7] text-slate-700",
  } as const;
  return (
    <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${classes[tone]}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-lg font-semibold tracking-[-0.02em]">{value}</span>
    </div>
  );
}

function IssueList({
  title,
  issues,
  onIssueClick,
  warning = false,
}: {
  title: string;
  issues: AssessmentValidationIssue[];
  onIssueClick: (issue: AssessmentValidationIssue) => void;
  warning?: boolean;
}) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold text-slate-700">{title}</p>
      <div className="divide-y divide-black/[0.05] overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
        {issues.slice(0, 20).map((issue) => {
          const questionIssue = issue.path.startsWith("examQuestion:");
          return (
            <button
              key={`${issue.code}-${issue.path}`}
              type="button"
              onClick={() => onIssueClick(issue)}
              className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            >
              {warning ? (
                <Info size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              ) : (
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-red-600"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">{issue.message}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                  {questionIssue ? "Open question in Builder →" : issue.path}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {issues.length > 20 ? (
        <p className="mt-2 text-xs text-slate-400">+ {issues.length - 20} more issues</p>
      ) : null}
    </div>
  );
}
function RuntimePolicyPanel() {
  return (
    <details className={`${surfaceClass} group p-5 sm:p-6`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Runtime policy
          </p>
          <p className="mt-1 text-[17px] font-semibold tracking-[-0.015em] text-slate-950">
            Exam-day behavior
          </p>
        </div>
        <ChevronDown
          size={18}
          className="text-slate-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        These policies are runtime-authoritative and intentionally read-only here until every
        setting has a typed update contract and exam-day regression coverage.
      </p>
      <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-black/[0.06] pt-5 sm:grid-cols-2">
        <PolicyRow label="Start" value="Proctor controlled" />
        <PolicyRow label="Module transition" value="Automatic with proctor control" />
        <PolicyRow label="Time extension" value="+5 / +10 minutes" />
        <PolicyRow label="Auto submit" value="Enabled" />
        <PolicyRow label="Pause" value="Allowed by runtime policy" />
        <PolicyRow label="Offline protection" value="Buffered + device continuity" />
      </dl>
    </details>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function ReleaseSummary({
  examTitle,
  releaseState,
  blockerCount,
  warningCount,
  dirtyCount,
  canPublish,
  isPublishing,
  publishError,
  onPublish,
  onOpenStudentAccess,
}: {
  examTitle: string;
  releaseState: AssessmentReleaseState;
  blockerCount: number;
  warningCount: number;
  dirtyCount: number;
  canPublish: boolean;
  isPublishing: boolean;
  publishError: string | null;
  onPublish: () => void;
  onOpenStudentAccess: () => void;
}) {
  const published = releaseState.currentPublishedVersion;
  const publishedCurrent = releaseState.state === "published_current" && dirtyCount === 0;
  const isUpdate = releaseState.state === "unpublished_changes" || (published && dirtyCount > 0);
  const { summary, access } = releaseState;

  return (
    <aside className="xl:sticky xl:top-[92px]">
      <div className={`${surfaceClass} overflow-hidden`}>
        <div className="border-b border-black/[0.06] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {publishedCurrent ? "Published" : isUpdate ? "Next release" : "Release summary"}
          </p>
          <h2 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.02em] text-slate-950">{examTitle}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {publishedCurrent && published
              ? `Version ${published.versionNumber} is available to students.`
              : isUpdate && published
                ? `Students still receive Version ${published.versionNumber} until you publish these changes.`
                : "Publish once the exam is ready for students."}
          </p>
        </div>
        <dl className="divide-y divide-black/[0.05] px-5">
          {published ? (
            <SummaryRow
              label="Current release"
              value={`Version ${published.versionNumber}`}
              detail={publishedCurrent ? `Published ${formatPublishedDate(published.publishedAt)}` : "Unchanged until you publish"}
            />
          ) : null}
          <SummaryRow label="Candidate time" value={formatDuration(summary.candidateDurationSeconds)} />
          <SummaryRow
            label="Questions"
            value={`${summary.deliveredQuestionCount} delivered max`}
            detail={`${summary.authoredQuestionCount} authored across branches`}
          />
          {publishedCurrent ? (
            <SummaryRow
              label="Student access"
              value={`${access.totalLinks} link${access.totalLinks === 1 ? "" : "s"}`}
              detail={access.liveLinks > 0 ? `${access.liveLinks} live · ${access.upcomingLinks} upcoming` : "No live links"}
            />
          ) : (
            <SummaryRow
              label="Readiness"
              value={`${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`}
              detail={`${warningCount} recommendation${warningCount === 1 ? "" : "s"}`}
            />
          )}
        </dl>
        <div className="p-5">
          {dirtyCount > 0 ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Save all delivery changes before publishing.
            </div>
          ) : null}
          {publishedCurrent ? (
            <button
              type="button"
              onClick={onOpenStudentAccess}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <Link2 size={16} />
              Student Access
            </button>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={!canPublish || isPublishing}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {isPublishing ? <LoaderCircle size={16} className="animate-spin" /> : <Rocket size={16} />}
              {isPublishing ? "Publishing…" : isUpdate ? "Publish Update" : "Publish"}
            </button>
          )}
          {published && !publishedCurrent ? (
            <button type="button" onClick={onOpenStudentAccess} className="mt-2 min-h-10 w-full rounded-xl text-xs font-semibold text-slate-500 hover:bg-black/[0.035] hover:text-slate-800">
              Student Access
            </button>
          ) : null}
          {publishError ? <p role="alert" className="mt-3 text-xs leading-5 text-red-700">{publishError}</p> : null}
          <p className="mt-3 text-center text-[11px] leading-5 text-slate-400">
            {publishedCurrent ? "Existing links remain on the release they were created for." : "Publishing creates an immutable release. Existing links never change automatically."}
          </p>
        </div>
      </div>
    </aside>
  );
}

function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-800">
        {value}
        {detail ? (
          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{detail}</span>
        ) : null}
      </dd>
    </div>
  );
}
function PublishAssessmentDialog({
  open,
  examTitle,
  shell,
  blockerCount,
  warningCount,
  candidateSeconds,
  isPublishing,
  isUpdate,
  currentPublishedVersionNumber,
  onClose,
  onConfirm,
}: {
  open: boolean;
  examTitle: string;
  shell: AssessmentAuthoringShell;
  blockerCount: number;
  warningCount: number;
  candidateSeconds: number;
  isPublishing: boolean;
  isUpdate: boolean;
  currentPublishedVersionNumber: number | null;
  onClose: () => void;
  onConfirm: (publishNotes?: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (!isPublishing) onClose();
    };
    const handleClose = () => {
      if (open && !isPublishing) onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [isPublishing, onClose, open]);

  useEffect(() => {
    if (!open) {
      setNotes("");
      setLocalError(null);
    }
  }, [open]);

  const submit = async () => {
    if (blockerCount > 0 || isPublishing) return;
    setLocalError(null);
    try {
      await onConfirm(notes);
      onClose();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The SAT version could not be published."
      );
    }
  };
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sat-publish-dialog-title"
      className="m-auto w-[min(94vw,620px)] max-h-[88vh] overflow-y-auto rounded-[24px] border-0 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-black/35 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#0071e3]">
            <Rocket size={19} aria-hidden="true" />
          </div>
          <div>
            <h2
              id="sat-publish-dialog-title"
              className="text-[21px] font-semibold tracking-[-0.025em]"
            >
              {isUpdate ? `Publish changes to ${examTitle}?` : `Publish ${examTitle}?`}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {isUpdate && currentPublishedVersionNumber
                ? `Students continue to receive Version ${currentPublishedVersionNumber} until this update is published.`
                : "Students will receive this release until you publish a later update."}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">Candidate time</span>
            <span className="font-semibold text-slate-800">{formatDuration(candidateSeconds)}</span>
          </div>
          <div className="mt-3 border-t border-black/[0.06] pt-3">
            {shell.sections.map((section) => (
              <div
                key={section.id}
                className="flex items-center justify-between gap-3 py-1.5 text-xs"
              >
                <span className="text-slate-500">{section.title}</span>
                <span className="font-semibold text-slate-700">
                  {formatDuration(section.durationSeconds + section.breakAfterSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-black/[0.06] p-4">
          {blockerCount === 0 ? (
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-600" />
          )}
          <div className="text-sm leading-6 text-slate-600">
            <p className="font-semibold text-slate-800">
              {blockerCount === 0
                ? "Release checks passed"
                : `${blockerCount} blocking issue${blockerCount === 1 ? "" : "s"}`}
            </p>
            <p>
              {warningCount} recommendation{warningCount === 1 ? "" : "s"} remain.
            </p>
          </div>
        </div>

        <label htmlFor="sat-publish-notes" className="mt-5 block text-xs font-medium text-slate-500">
          Publish notes <span className="font-normal text-slate-400">Optional</span>
          <textarea
            id="sat-publish-notes"
            aria-label="Publish notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="What changed in this release?"
            className="mt-1.5 w-full resize-y rounded-xl border border-black/[0.08] px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
          />
        </label>

        {warningCount > 0 && blockerCount === 0 ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            Recommendations do not block publishing; review them if they affect your intended
            delivery.
          </p>
        ) : null}
        {localError ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700">
            {localError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="min-h-11 rounded-xl bg-[#f5f5f7] px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200/70 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={blockerCount > 0 || isPublishing}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-5 text-sm font-semibold text-white hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isPublishing ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Rocket size={15} />
            )}
            {isPublishing ? "Publishing…" : isUpdate ? "Publish Update" : "Publish"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ReleaseLoadingSurface() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-950" aria-busy="true">
      <div className="border-b border-black/[0.06] bg-white/88">
        <div className="mx-auto flex min-h-[68px] max-w-[1240px] items-center px-4 sm:px-6 lg:px-8">
          <div className="h-4 w-48 animate-pulse rounded-full bg-slate-200" />
        </div>
      </div>
      <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-32 animate-pulse rounded-[22px] bg-white" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="h-[420px] animate-pulse rounded-[22px] bg-white" />
            <div className="h-72 animate-pulse rounded-[22px] bg-white" />
          </div>
          <div className="h-96 animate-pulse rounded-[22px] bg-white" />
        </div>
      </main>
    </div>
  );
}

function formatPublishedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
