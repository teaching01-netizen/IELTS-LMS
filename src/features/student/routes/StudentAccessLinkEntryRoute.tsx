import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Link2, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useAuthSession, type StudentQueuedAdmission } from '../../auth/api/authSession';
import { useStudentAccessLink } from '../api/access-link/studentAccessLinkQueries';
import type { PublicStudentAccessLink } from '../contracts/access-link/PublicStudentAccessLink';

const SECTION_LABELS: Record<string, string> = {
  'reading-writing': 'Reading & Writing',
  math: 'Math',
};

/**
 * The scope copy for a narrowed link, or null when the link admits every
 * section. Stated on the entry card so a student knows the exam ends after one
 * section BEFORE they commit, instead of discovering it mid-sitting.
 */
export function accessLinkScopeCopy(link: PublicStudentAccessLink): string | null {
  const sections = (link.enabledSections ?? []).filter((key) => key in SECTION_LABELS);
  if (sections.length === 0 || sections.length >= Object.keys(SECTION_LABELS).length) return null;
  const labels = Object.keys(SECTION_LABELS)
    .filter((key) => sections.includes(key))
    .map((key) => SECTION_LABELS[key]);
  return `You'll take ${labels.join(' and ')} only. The exam ends after that section.`;
}

interface AccessForm {
  studentCode: string;
  studentName: string;
  email: string;
}

const STUDENT_LINK_PROFILE_PREFIX = 'student-access-link-profile:';
const STUDENT_LINK_QUEUE_TICKET_PREFIX = 'student-access-link-queue-ticket:';
const QUEUE_POLL_FLOOR_MS = 500;
const QUEUE_POLL_DEFAULT_MS = 1500;

interface AccessLinkQueuePollFailure {
  message: string;
  ticketId: string;
  position: number;
  attempts: number;
}

interface PersistedAccessLinkQueue {
  ticket: StudentQueuedAdmission;
  form: AccessForm;
}

function accessLinkQueueKey(linkId: string): string {
  return `${STUDENT_LINK_QUEUE_TICKET_PREFIX}${linkId}`;
}

function isPersistedAccessLinkQueue(value: unknown): value is PersistedAccessLinkQueue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { ticket?: unknown; form?: unknown };
  if (typeof candidate.ticket !== 'object' || candidate.ticket === null) return false;
  if (typeof candidate.form !== 'object' || candidate.form === null) return false;
  const ticket = candidate.ticket as { state?: unknown; ticketId?: unknown; position?: unknown };
  const form = candidate.form as { studentCode?: unknown; studentName?: unknown; email?: unknown };
  return (
    ticket.state === 'queued' &&
    typeof ticket.ticketId === 'string' &&
    ticket.ticketId.length > 0 &&
    typeof ticket.position === 'number' &&
    typeof form.studentCode === 'string' &&
    typeof form.studentName === 'string' &&
    typeof form.email === 'string'
  );
}

function loadPersistedAccessLinkQueue(linkId: string): PersistedAccessLinkQueue | null {
  if (!linkId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(accessLinkQueueKey(linkId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedAccessLinkQueue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistAccessLinkQueue(linkId: string, ticket: StudentQueuedAdmission, form: AccessForm): void {
  if (!linkId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(accessLinkQueueKey(linkId), JSON.stringify({ ticket, form }));
  } catch {
    // Queue polling still works in memory when storage is unavailable.
  }
}

function clearPersistedAccessLinkQueue(linkId: string): void {
  if (!linkId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(accessLinkQueueKey(linkId));
  } catch {
    // Storage cleanup is best-effort.
  }
}

function queueEtaSeconds(pollAfterMs: number | undefined): number {
  const floored = Math.max(QUEUE_POLL_FLOOR_MS, pollAfterMs || QUEUE_POLL_DEFAULT_MS);
  return Math.max(1, Math.round(floored / 1000));
}

function normalizeStudentCode(value: string): string {
  const trimmed = value.trim();
  return /^w\d{6}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function readProfile(linkId: string): AccessForm {
  if (typeof window === 'undefined') return { studentCode: '', studentName: '', email: '' };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(`${STUDENT_LINK_PROFILE_PREFIX}${linkId}`);
  } catch {
    // Storage-denied environments (blocked cookies, private mode) must still
    // render the entry form with empty defaults — never crash on read.
    return { studentCode: '', studentName: '', email: '' };
  }
  if (!raw) return { studentCode: '', studentName: '', email: '' };
  try {
    const parsed = JSON.parse(raw) as Partial<AccessForm>;
    return {
      studentCode: typeof parsed.studentCode === 'string' ? parsed.studentCode : '',
      studentName: typeof parsed.studentName === 'string' ? parsed.studentName : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
    };
  } catch {
    return { studentCode: '', studentName: '', email: '' };
  }
}

function saveProfile(linkId: string, form: AccessForm): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STUDENT_LINK_PROFILE_PREFIX}${linkId}`, JSON.stringify(form));
  } catch {
    // Profile recall is convenience-only (mirrors the best-effort queue
    // storage above): a full or blocked store must never block admission.
  }
}

function buildStudentRoute(scheduleId: string, code: string): string {
  return `/student/${scheduleId}/${encodeURIComponent(code)}`;
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export function StudentAccessLinkEntryRoute() {
  const { accessLinkId } = useParams<{ accessLinkId: string }>();
  const navigate = useNavigate();
  const linkQuery = useStudentAccessLink(accessLinkId);
  const { studentEntry } = useAuthSession();
  const initial = useMemo(() => readProfile(accessLinkId ?? ''), [accessLinkId]);
  const [restoredQueue] = useState<PersistedAccessLinkQueue | null>(() =>
    loadPersistedAccessLinkQueue(accessLinkId ?? ''),
  );
  const [form, setForm] = useState<AccessForm>(() => restoredQueue?.form ?? initial);
  const [errors, setErrors] = useState<Partial<Record<keyof AccessForm, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queued, setQueued] = useState<StudentQueuedAdmission | null>(() => restoredQueue?.ticket ?? null);
  const [queuedForm, setQueuedForm] = useState<AccessForm | null>(() => restoredQueue?.form ?? null);
  const [queuePollFailure, setQueuePollFailure] = useState<AccessLinkQueuePollFailure | null>(null);
  const [lastQueuedTicket, setLastQueuedTicket] = useState<StudentQueuedAdmission | null>(
    () => restoredQueue?.ticket ?? null,
  );
  const pollAttemptsRef = useRef(0);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const clearFieldError = (field: keyof AccessForm) => {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const mountSnapshotRef = useRef({
    accessLinkId,
    hadRestoredQueue: Boolean(restoredQueue),
  });
  useEffect(() => {
    // Skip reset while the mounted link still matches the restored queue
    // ticket, so a reload resumes polling instead of wiping the recovered
    // position. Snapshot comparison (not a one-shot flag) keeps this
    // correct under StrictMode double-effect invocation.
    const snapshot = mountSnapshotRef.current;
    if (snapshot.hadRestoredQueue && accessLinkId === snapshot.accessLinkId) {
      return;
    }
    setForm(initial);
    setErrors({});
    setSubmitError(null);
    setQueued(null);
    setQueuedForm(null);
    setQueuePollFailure(null);
    setLastQueuedTicket(null);
    pollAttemptsRef.current = 0;
    if (accessLinkId) {
      clearPersistedAccessLinkQueue(accessLinkId);
    }
  }, [accessLinkId, initial]);

  const link = linkQuery.data ?? null;
  const canEnter = link?.status === 'live';

  const finishEntry = useCallback((activeLink: PublicStudentAccessLink, submitted: AccessForm, result: { scheduleId: string; studentCode: string }) => {
    // Navigation depends only on admission success: saveProfile is
    // best-effort and never throws, so a full/blocked store still enters.
    const normalizedEmail = submitted.email.trim().toLocaleLowerCase();
    saveProfile(activeLink.id, {
      ...submitted,
      studentCode: activeLink.accessMode === 'open' ? '' : result.studentCode,
      email: normalizedEmail,
    });
    navigate(buildStudentRoute(result.scheduleId, result.studentCode));
  }, [navigate]);

  const submitEntry = useCallback(async (activeLink: PublicStudentAccessLink, submitted: AccessForm) => {
    const normalizedCode = normalizeStudentCode(submitted.studentCode);
    const normalizedName = submitted.studentName.trim();
    const normalizedEmail = submitted.email.trim().toLocaleLowerCase();
    return studentEntry({
      accessLinkId: activeLink.id,
      wcode: activeLink.accessMode === 'student_code' ? normalizedCode : '',
      email: normalizedEmail,
      studentName: normalizedName,
    });
  }, [studentEntry]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link || !canEnter || !accessLinkId || submitting || submittingRef.current) return;
    const nextErrors: Partial<Record<keyof AccessForm, string>> = {};
    const normalizedName = form.studentName.trim();
    const normalizedEmail = form.email.trim();
    const normalizedCode = normalizeStudentCode(form.studentCode);
    if (link.accessMode === 'student_code' && !normalizedCode) nextErrors.studentCode = 'Enter the student code provided by your teacher.';
    if (!normalizedName) nextErrors.studentName = 'Enter your full name.';
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) nextErrors.email = 'Enter a valid email address.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setQueued(null);
    setQueuePollFailure(null);
    const submitted = { studentCode: normalizedCode, studentName: normalizedName, email: normalizedEmail };
    try {
      const result = await submitEntry(link, submitted);
      if (!('user' in result)) {
        pollAttemptsRef.current = 0;
        setQueued(result);
        setQueuedForm(submitted);
        setLastQueuedTicket(result);
        persistAccessLinkQueue(accessLinkId, result, submitted);
        return;
      }
      clearPersistedAccessLinkQueue(accessLinkId);
      finishEntry(link, submitted, result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to enter this exam.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleRetryQueue = useCallback(() => {
    if (submitting || !accessLinkId || !queuedForm || !lastQueuedTicket) return;
    setSubmitError(null);
    setQueuePollFailure(null);
    setQueued(lastQueuedTicket);
    persistAccessLinkQueue(accessLinkId, lastQueuedTicket, queuedForm);
  }, [accessLinkId, lastQueuedTicket, queuedForm, submitting]);

  const handleLeaveQueue = useCallback(() => {
    if (accessLinkId) {
      clearPersistedAccessLinkQueue(accessLinkId);
    }
    pollAttemptsRef.current = 0;
    setQueued(null);
    setQueuedForm(null);
    setLastQueuedTicket(null);
    setQueuePollFailure(null);
    setSubmitError(null);
  }, [accessLinkId]);

  useEffect(() => {
    if (!link || !queued || !queuedForm || !accessLinkId || queuePollFailure) return;
    let cancelled = false;
    const ticketAtPollStart = queued;
    const timeout = window.setTimeout(async () => {
      pollAttemptsRef.current += 1;
      try {
        const result = await submitEntry(link, queuedForm);
        if (cancelled) return;
        if (!('user' in result)) {
          setQueued(result);
          setLastQueuedTicket(result);
          persistAccessLinkQueue(accessLinkId, result, queuedForm);
          return;
        }
        clearPersistedAccessLinkQueue(accessLinkId);
        finishEntry(link, queuedForm, result);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to continue from the admission queue.';
          // S3-C2: a failed poll must not dead-lock the form. Clear the
          // blocking queued state but keep the ticket + payload so Retry can
          // resume polling and Leave can discard the ticket.
          setQueued(null);
          setQueuePollFailure({
            message,
            ticketId: ticketAtPollStart.ticketId,
            position: ticketAtPollStart.position,
            attempts: pollAttemptsRef.current,
          });
          setSubmitError(message);
        }
      }
    }, Math.max(QUEUE_POLL_FLOOR_MS, queued.pollAfterMs || QUEUE_POLL_DEFAULT_MS));
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [accessLinkId, finishEntry, link, queuePollFailure, queued, queuedForm, submitEntry]);

  if (linkQuery.isLoading) return <EntryShell><div className="flex min-h-72 flex-col items-center justify-center"><LoaderCircle size={24} className="animate-spin text-slate-400"/><p className="mt-3 text-sm font-medium text-slate-500">Opening your exam…</p></div></EntryShell>;
  if (linkQuery.error || !link) return <EntryShell><UnavailableState icon={<AlertCircle size={24}/>} title="This Student Link isn't available" description={linkQuery.error instanceof Error ? linkQuery.error.message : 'Ask your teacher for a current link.'}/></EntryShell>;
  if (!canEnter) return <EntryShell><LinkAvailabilityState link={link}/></EntryShell>;

  const scopeCopy = accessLinkScopeCopy(link);

  return (
    <EntryShell>
      <div className="p-6 sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0071e3]/10 text-[#0071e3]"><Link2 size={20}/></div>
        <p className="mt-5 text-[11px] font-semibold text-slate-400">{link.examTitle} · Version {link.versionNumber}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">{link.name}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Check your details, then continue to the exam.</p>
        {scopeCopy ? <div role="note" className="mt-4 flex items-start gap-2 rounded-xl border border-[#0071e3]/15 bg-[#0071e3]/5 px-3 py-2.5 text-[11px] font-medium leading-4 text-[#0b5cad]"><Clock3 size={13} className="mt-0.5 shrink-0"/><span>{scopeCopy}</span></div> : null}
        {link.audienceLabel ? <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-2.5 py-1.5 text-[10px] font-semibold text-slate-600"><LockKeyhole size={11}/>{link.audienceLabel}</div> : null}

        {submitError ? <div role="alert" className="mt-5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] font-medium text-red-700">{submitError}</div> : null}
        {queued ? <div aria-live="polite" className="mt-5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3"><p className="text-[11px] font-semibold text-blue-800">You're in the admission queue</p><p className="mt-1 text-[10px] text-blue-600">Position {queued.position} · Ticket ref {queued.ticketId}. Checking again in ~{queueEtaSeconds(queued.pollAfterMs)}s — keep this tab open.</p><button type="button" onClick={handleLeaveQueue} className="mt-2 text-[10px] font-semibold text-blue-700 underline hover:text-blue-900">Leave queue</button></div> : null}
        {queuePollFailure ? <div aria-live="polite" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3"><p className="text-[11px] font-semibold text-amber-800">Queue check failed after {queuePollFailure.attempts} {queuePollFailure.attempts === 1 ? 'attempt' : 'attempts'}</p><p className="mt-1 text-[10px] text-amber-700">Ticket ref {queuePollFailure.ticketId} · Position at failure {queuePollFailure.position}. Your details are saved — retry to keep your place or leave the queue to edit the form.</p><div className="mt-2 flex gap-2"><button type="button" onClick={handleRetryQueue} className="rounded-lg bg-[#0071e3] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0077ed]">Retry</button><button type="button" onClick={handleLeaveQueue} className="rounded-lg border border-black/[0.09] bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600">Leave queue</button></div></div> : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {link.accessMode === 'student_code' ? <InputField id="student-link-code" label="Student code" value={form.studentCode} error={errors.studentCode} disabled={submitting || Boolean(queued)} onChange={(value) => { setForm((current) => ({ ...current, studentCode: value })); clearFieldError('studentCode'); }} placeholder="Enter your student code" autoComplete="off"/> : null}
          <InputField id="student-link-name" label="Full name" value={form.studentName} error={errors.studentName} disabled={submitting || Boolean(queued)} onChange={(value) => { setForm((current) => ({ ...current, studentName: value })); clearFieldError('studentName'); }} placeholder="Your full name" autoComplete="name"/>
          <InputField id="student-link-email" label="Email" type="email" value={form.email} error={errors.email} disabled={submitting || Boolean(queued)} onChange={(value) => { setForm((current) => ({ ...current, email: value })); clearFieldError('email'); }} placeholder="you@example.com" autoComplete="email"/>
          <button type="submit" disabled={submitting || Boolean(queued)} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">{queued ? 'Waiting…' : submitting ? <><LoaderCircle size={15} className="animate-spin"/>Checking…</> : <>Continue <ArrowRight size={15}/></>}</button>
        </form>
        <div className="mt-6 flex items-start gap-2 border-t border-black/[0.055] pt-4 text-[9px] leading-4 text-slate-400"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-500"/><span>This link is pinned to published Version {link.versionNumber}. Your teacher can pause or revoke this link without changing the exam itself.</span></div>
      </div>
    </EntryShell>
  );
}

function EntryShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f5f5f7] px-4 py-8 text-slate-950 sm:py-14"><main className="mx-auto w-full max-w-[460px] overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-[0_16px_55px_rgba(0,0,0,0.08)]">{children}</main></div>;
}

function LinkAvailabilityState({ link }: { link: PublicStudentAccessLink }) {
  const content = link.status === 'upcoming'
    ? { title: 'This exam isn’t open yet', description: link.opensAt ? `You can enter ${formatPublicDateTime(link.opensAt)}.` : 'Come back when your teacher opens this link.', icon: <Clock3 size={24}/> }
    : link.status === 'ended'
      ? { title: 'This link has ended', description: link.closesAt ? `Student entry closed ${formatPublicDateTime(link.closesAt)}.` : 'Ask your teacher if you still need access.', icon: <CheckCircle2 size={24}/> }
      : link.status === 'paused'
        ? { title: 'Entry is temporarily paused', description: 'Your teacher can reopen this same link. You don’t need a new URL.', icon: <Clock3 size={24}/> }
        : { title: 'This link is no longer active', description: 'Ask your teacher for a current Student Link.', icon: <AlertCircle size={24}/> };
  return <UnavailableState {...content} eyebrow={`${link.examTitle} · ${link.name}`}/>;
}

function UnavailableState({ icon, title, description, eyebrow }: { icon: React.ReactNode; title: string; description: string; eyebrow?: string }) {
  return <div className="p-7 text-center sm:p-9"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f7] text-slate-500">{icon}</div>{eyebrow ? <p className="mt-5 text-[10px] font-semibold text-slate-400">{eyebrow}</p> : null}<h1 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">{title}</h1><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p></div>;
}

function InputField({ id, label, value, error, disabled, onChange, placeholder, type = 'text', autoComplete }: { id: string; label: string; value: string; error: string | undefined; disabled: boolean; onChange: (value: string) => void; placeholder: string; type?: string; autoComplete?: string }) {
  return <div><label htmlFor={id} className="block text-[11px] font-semibold text-slate-700">{label}<input id={id} aria-label={label} type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className={`mt-1.5 block h-12 w-full rounded-xl border bg-white px-3 text-sm font-normal outline-none transition focus:ring-4 focus:ring-[#0071e3]/10 ${error ? 'border-red-300' : 'border-black/[0.09] focus:border-[#0071e3]/35'}`}/></label>{error ? <p id={`${id}-error`} className="mt-1 text-[10px] font-medium text-red-600">{error}</p> : null}</div>;
}

function formatPublicDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
