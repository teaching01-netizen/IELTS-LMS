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
  mode: 'briefing' | 'waiting';
  config?: ExamConfig | undefined;
  examTitle: string;
  candidateName?: string | null | undefined;
  candidateId?: string | null | undefined;
  footer?: React.ReactNode;
  error?: string | null | undefined;
}

export function ExamEntryCard({ mode, config, examTitle, candidateName, candidateId, footer, error }: ExamEntryCardProps) {
  const sections = Object.values(config?.sections ?? {})
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order);
  const totalDuration = sections.reduce((total, section) => total + section.duration, 0);
  const waiting = mode === 'waiting';

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-gray-100 bg-white shadow-[0_8px_24px_rgba(9,30,66,0.08)]">
        <div className="flex-shrink-0 border-b border-gray-200 px-3 py-4 sm:px-4 md:px-6 lg:px-10 lg:py-8">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            {waiting ? 'Waiting for the exam to start' : 'Before you continue'}
          </h2>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6 lg:p-10">
          <section aria-label="Exam details" className="space-y-3">
            <div><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Exam</p><p className="font-bold text-gray-900">{examTitle}</p></div>
            {candidateName ? <div><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Candidate</p><p className="font-bold text-gray-900">{candidateName}</p></div> : null}
            {candidateId ? <div><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Candidate ID</p><p className="text-gray-900">{candidateId}</p></div> : null}
          </section>
          <section aria-label="Exam duration" className="space-y-2">
            <div className="flex justify-between border-b border-gray-200 pb-2 font-bold"><span>Total duration</span><span>{formatExamDuration(totalDuration)}</span></div>
            {sections.map((section) => <div data-testid="exam-section" key={section.label} className="flex justify-between text-sm"><span>{section.label}</span><span>{formatExamDuration(section.duration)}</span></div>)}
          </section>
          {waiting ? (
            <section className="space-y-4">
              <p>You are ready. Please keep this page open. The exam will begin automatically when the proctor starts it.</p>
              <p role="status" aria-live="polite" className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-900">Waiting for proctor</p>
            </section>
          ) : (
            <section className="space-y-3 text-sm leading-relaxed text-gray-700">
              <p>After you continue, you will enter the waiting room. Your exam timer will not begin while you are waiting. The timer will begin when the proctor starts the exam.</p>
              <p>Your answers will be saved automatically. If your connection is interrupted, return using the same device and browser. Refreshing or leaving the page will not pause the timer after the exam begins.</p>
            </section>
          )}
          {error ? <div role="alert" className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div> : null}
        </div>
        {footer ? <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4 md:px-10">{footer}</div> : null}
      </div>
    </div>
  );
}
