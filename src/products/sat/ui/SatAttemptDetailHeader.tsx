import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SatStatusPill, type SatStatusTone } from './SatPage';
import { formatTestTimeLine, viewerTimeZoneLabel } from '../routes/satTestTime';

/**
 * One identity header for every attempt detail (scored result and saved
 * answers): the same back behaviour, context line, name, status and timing,
 * with a single `summary` slot for what differs (a score, or save evidence).
 */
export function SatAttemptDetailHeader({
  embedded,
  backLabel,
  onBack,
  examTitle,
  versionNumber,
  studentName,
  studentId,
  cohortName,
  status,
  testStartedAt,
  submittedAt,
  summary,
}: {
  embedded: boolean;
  /** Visible label of the way back; omitted when there is nowhere to go back to. */
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  examTitle: string;
  versionNumber: number;
  studentName: string;
  studentId: string;
  cohortName: string | null;
  status: { label: string; tone: SatStatusTone };
  testStartedAt: string | null | undefined;
  submittedAt: string | null | undefined;
  summary?: ReactNode;
}) {
  const Title = embedded ? 'h2' : 'h1';
  return (
    <header className="border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] pb-6">
      {backLabel && onBack ? (
        <button type="button" onClick={onBack} className="sat-btn sat-btn--quiet sat-press -ml-3 mb-2 px-3">
          <ArrowLeft size={16} aria-hidden="true" />{backLabel}
        </button>
      ) : null}
      <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{examTitle} · Version {versionNumber}</p>
      <div className="mt-1 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Title className="text-balance text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{studentName}</Title>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            <SatStatusPill tone={status.tone}>{status.label}</SatStatusPill>
            <span>{studentId}{cohortName ? ` · ${cohortName}` : ''}</span>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px] leading-5 tabular-nums">
            <dt className="text-[var(--sat-staff-text-secondary,#515154)]">Test started</dt>
            <dd className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{formatTestTimeLine(testStartedAt)}</dd>
            <dt className="text-[var(--sat-staff-text-secondary,#515154)]">Submitted</dt>
            <dd className="text-[var(--sat-staff-text-primary,#1d1d1f)]">{submittedAt ? formatTestTimeLine(submittedAt) : 'Not submitted'}</dd>
          </dl>
          <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">Times shown in {viewerTimeZoneLabel()}.</p>
        </div>
        {summary ? <div className="shrink-0 sm:max-w-[320px]">{summary}</div> : null}
      </div>
    </header>
  );
}
