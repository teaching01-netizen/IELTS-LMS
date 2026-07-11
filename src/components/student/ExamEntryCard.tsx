import React from 'react';
import type { ExamConfig } from '../../types';

export function formatExamDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (remainder || !hours) parts.push(`${remainder} ${remainder === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

interface ExamEntryCardProps {
  config?: ExamConfig | undefined;
  examTitle: string;
  candidateName?: string | null | undefined;
  candidateId?: string | null | undefined;
  footer?: React.ReactNode;
  status?: 'connecting' | 'waiting' | undefined;
  statusDetail?: string | undefined;
}

export function ExamEntryCard({
  config,
  examTitle,
  candidateName,
  candidateId,
  footer,
  status = 'waiting',
  statusDetail,
}: ExamEntryCardProps) {
  const sections = Object.values(config?.sections ?? {})
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const totalDuration = sections.reduce((total, section) => total + section.duration, 0);

  const statusLabel =
    status === 'connecting' ? 'Preparing your connection…' : 'Waiting for the proctor to start the exam';

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-gray-100 bg-white shadow-[0_8px_24px_rgba(9,30,66,0.08)]">
        <div className="flex-shrink-0 border-b border-gray-200 px-3 py-4 sm:px-4 md:px-6 lg:px-10 lg:py-8">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Waiting for the exam to start
          </h2>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6 lg:p-10">
          <section aria-label="Exam details" className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Exam</p>
              <p className="font-bold text-gray-900">{examTitle}</p>
            </div>
            {candidateName ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Candidate</p>
                <p className="font-bold text-gray-900">{candidateName}</p>
              </div>
            ) : null}
            {candidateId ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Candidate ID</p>
                <p className="text-gray-900">{candidateId}</p>
              </div>
            ) : null}
          </section>
          <section aria-label="Exam duration" className="space-y-2">
            <div className="flex justify-between border-b border-gray-200 pb-2 font-bold">
              <span>Total duration</span>
              <span>{formatExamDuration(totalDuration)}</span>
            </div>
            {sections.map((section) => (
              <div data-testid="exam-section" key={section.label} className="flex justify-between text-sm">
                <span>{section.label}</span>
                <span>{formatExamDuration(section.duration)}</span>
              </div>
            ))}
          </section>
          <section className="space-y-4">
            <p className="text-base font-semibold text-gray-900">
              You're checked in and waiting for the exam to start. Please keep this page open.
            </p>
            <p className="text-sm leading-relaxed text-gray-700">
              Your exam timer will not begin while you are waiting. The timer starts when the proctor begins the exam.
            </p>
            <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
              <p className="font-semibold text-gray-900">During the exam</p>
              <p>
                Your answers save automatically. If your connection drops, return on the same device and browser. Once
                the exam begins, refreshing or leaving this page will not pause the timer.
              </p>
            </div>
            <div role="status" aria-live="polite" className="space-y-2">
              <p className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
                <span
                  className={
                    status === 'connecting'
                      ? 'h-2 w-2 rounded-full bg-gray-400 motion-safe:animate-pulse'
                      : 'h-2 w-2 rounded-full bg-gray-400'
                  }
                  aria-hidden="true"
                />
                {statusLabel}
              </p>
              {statusDetail ? <p className="text-sm text-gray-600">{statusDetail}</p> : null}
            </div>
          </section>
        </div>
        {footer ? <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4 md:px-10">{footer}</div> : null}
      </div>
    </div>
  );
}
