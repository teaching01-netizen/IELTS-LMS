import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Link2, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useAuthSession, type StudentQueuedAdmission } from '../../auth/api/authSession';
import { useStudentAccessLink } from '../api/access-link/studentAccessLinkQueries';
import type { PublicStudentAccessLink } from '../contracts/access-link/PublicStudentAccessLink';

interface AccessForm {
  studentCode: string;
  studentName: string;
  email: string;
}

const STUDENT_LINK_PROFILE_PREFIX = 'student-access-link-profile:';

function normalizeStudentCode(value: string): string {
  const trimmed = value.trim();
  return /^w\d{6}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function readProfile(linkId: string): AccessForm {
  if (typeof window === 'undefined') return { studentCode: '', studentName: '', email: '' };
  const raw = window.localStorage.getItem(`${STUDENT_LINK_PROFILE_PREFIX}${linkId}`);
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
  window.localStorage.setItem(`${STUDENT_LINK_PROFILE_PREFIX}${linkId}`, JSON.stringify(form));
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
  const [form, setForm] = useState<AccessForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof AccessForm, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queued, setQueued] = useState<StudentQueuedAdmission | null>(null);
  const [queuedForm, setQueuedForm] = useState<AccessForm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clearFieldError = (field: keyof AccessForm) => {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  useEffect(() => {
    setForm(initial);
    setErrors({});
    setSubmitError(null);
    setQueued(null);
    setQueuedForm(null);
  }, [initial]);

  const link = linkQuery.data ?? null;
  const canEnter = link?.status === 'live';

  const finishEntry = useCallback((activeLink: PublicStudentAccessLink, submitted: AccessForm, result: { scheduleId: string; studentCode: string }) => {
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
      nickname: '',
      ieltsCourse: '',
    });
  }, [studentEntry]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link || !canEnter || !accessLinkId) return;
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
    setSubmitting(true);
    setSubmitError(null);
    setQueued(null);
    const submitted = { studentCode: normalizedCode, studentName: normalizedName, email: normalizedEmail };
    try {
      const result = await submitEntry(link, submitted);
      if (!('user' in result)) {
        setQueued(result);
        setQueuedForm(submitted);
        return;
      }
      finishEntry(link, submitted, result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to enter this exam.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!link || !queued || !queuedForm) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await submitEntry(link, queuedForm);
        if (cancelled) return;
        if (!('user' in result)) {
          setQueued(result);
          return;
        }
        finishEntry(link, queuedForm, result);
      } catch (error) {
        if (!cancelled) setSubmitError(error instanceof Error ? error.message : 'Unable to continue from the admission queue.');
      }
    }, Math.max(500, queued.pollAfterMs || 1500));
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [finishEntry, link, queued, queuedForm, submitEntry]);

  if (linkQuery.isLoading) return <EntryShell><div className="flex min-h-72 flex-col items-center justify-center"><LoaderCircle size={24} className="animate-spin text-slate-400"/><p className="mt-3 text-sm font-medium text-slate-500">Opening your exam…</p></div></EntryShell>;
  if (linkQuery.error || !link) return <EntryShell><UnavailableState icon={<AlertCircle size={24}/>} title="This Student Link isn't available" description={linkQuery.error instanceof Error ? linkQuery.error.message : 'Ask your teacher for a current link.'}/></EntryShell>;
  if (!canEnter) return <EntryShell><LinkAvailabilityState link={link}/></EntryShell>;

  return (
    <EntryShell>
      <div className="p-6 sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0071e3]/10 text-[#0071e3]"><Link2 size={20}/></div>
        <p className="mt-5 text-[11px] font-semibold text-slate-400">{link.examTitle} · Version {link.versionNumber}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">{link.name}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Check your details, then continue to the exam.</p>
        {link.audienceLabel ? <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-2.5 py-1.5 text-[10px] font-semibold text-slate-600"><LockKeyhole size={11}/>{link.audienceLabel}</div> : null}

        {submitError ? <div role="alert" className="mt-5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] font-medium text-red-700">{submitError}</div> : null}
        {queued ? <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3"><p className="text-[11px] font-semibold text-blue-800">You're in the admission queue</p><p className="mt-1 text-[10px] text-blue-600">Position {queued.position}. This page will continue automatically.</p></div> : null}

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
