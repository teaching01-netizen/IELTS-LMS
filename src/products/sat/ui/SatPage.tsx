import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Shared Calm Ops Bento primitives for the Digital SAT staff list pages
 * (Exam Library, Sessions, Results). Operate mode: the tool disappears into
 * the task - one sans, one accent (#0071e3), soft 16-20px card rows,
 * dot+label status (color never carries state alone), 150-200ms transitions.
 */

export function SatContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={'mx-auto w-full max-w-[1180px] px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10' + (className ? ' ' + className : '')}>
      {children}
    </div>
  );
}

export function SatPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-black/[0.065] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{eyebrow}</p>
        <h1 className="mt-1 text-balance text-[30px] font-semibold tracking-[-0.045em] text-slate-950">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-xl text-pretty text-[13px] leading-5 text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div> : null}
    </div>
  );
}

export function SatSearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
  widthClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  widthClassName?: string;
}) {
  const clearLabel = 'Clear ' + label;
  return (
    <label htmlFor={id} className={'relative min-w-0 flex-1' + (widthClassName ? ' ' + widthClassName : '')}>
      <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[12px] border border-black/[0.075] bg-white pl-9 pr-8 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-black/[0.05] hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

export function SatPrimaryButton({
  onClick,
  icon,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-[#0071e3] px-3.5 text-[12px] font-semibold text-white shadow-[0_1px_2px_rgba(0,113,227,0.35)] transition duration-150 hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/25 active:scale-[0.97] active:bg-[#0067c9]"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export type SatStatusTone =
  | 'published'
  | 'live'
  | 'changes'
  | 'paused'
  | 'info'
  | 'ready'
  | 'invalidated'
  | 'draft'
  | 'archived'
  | 'finished'
  | 'cancelled'
  | 'neutral'
  | 'pending';

const TONE_PILL_CLASS: Record<SatStatusTone, string> = {
  published: 'border-emerald-700/20 bg-emerald-50 text-emerald-700',
  live: 'border-emerald-700/20 bg-emerald-50 text-emerald-700',
  changes: 'border-amber-700/25 bg-amber-50 text-amber-700',
  paused: 'border-amber-700/25 bg-amber-50 text-amber-700',
  info: 'border-[#0071e3]/25 bg-[#0071e3]/[0.07] text-[#0067c9]',
  ready: 'border-[#0071e3]/25 bg-[#0071e3]/[0.07] text-[#0067c9]',
  invalidated: 'border-red-700/20 bg-red-50 text-red-700',
  draft: 'border-black/[0.08] bg-black/[0.03] text-slate-500',
  archived: 'border-black/[0.08] bg-black/[0.03] text-slate-500',
  finished: 'border-black/[0.08] bg-black/[0.03] text-slate-500',
  cancelled: 'border-black/[0.08] bg-black/[0.03] text-slate-500',
  neutral: 'border-black/[0.08] bg-black/[0.03] text-slate-500',
  pending: 'border-amber-700/25 bg-amber-50 text-amber-700',
};

const TONE_DOT_CLASS: Record<SatStatusTone, string> = {
  published: 'bg-emerald-500',
  live: 'bg-emerald-500',
  changes: 'bg-amber-500',
  paused: 'bg-amber-500',
  info: 'bg-[#0071e3]',
  ready: 'bg-[#0071e3]',
  invalidated: 'bg-red-500',
  draft: 'bg-slate-400',
  archived: 'bg-slate-400',
  finished: 'bg-slate-400',
  cancelled: 'bg-slate-400',
  neutral: 'bg-slate-400',
  pending: 'bg-amber-500',
};

export function SatStatusPill({
  tone,
  pulse = false,
  children,
}: {
  tone: SatStatusTone;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ' + TONE_PILL_CLASS[tone]}>
      <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full ' + TONE_DOT_CLASS[tone] + (pulse ? ' animate-pulse' : '')} />
      <span>{children}</span>
    </span>
  );
}

export function SatList({ children }: { children: ReactNode }) {
  return <div className="mt-4 space-y-2">{children}</div>;
}

export function SatListRow({
  onOpen,
  ariaLabel,
  children,
}: {
  onOpen: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="group flex min-h-[76px] w-full items-center rounded-2xl border border-black/[0.06] bg-white px-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-black/[0.09] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f5f7] active:translate-y-0 active:scale-[0.99]"
    >
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export type SatStat = {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
};

export function SatStatStrip({ stats, label = 'Summary' }: { stats: SatStat[]; label?: string }) {
  return (
    <section aria-label={label} className="mt-5 grid grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div
          key={stat.id}
          className="rounded-2xl border border-black/[0.06] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">{stat.label}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-slate-950">{stat.value}</p>
          {stat.hint ? <p className="mt-0.5 truncate text-[10px] text-slate-400">{stat.hint}</p> : null}
        </div>
      ))}
    </section>
  );
}

export function SatEmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white text-slate-400 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {icon}
      </div>
      <h2 className="mt-4 text-balance text-[16px] font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
      <p className="mt-1 max-w-sm text-pretty text-[12px] leading-5 text-slate-400">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SatListSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="mt-4 space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex min-h-[76px] animate-pulse items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-2/5 rounded-full bg-black/[0.07]" />
            <div className="mt-2 h-2.5 w-1/3 rounded-full bg-black/[0.05]" />
          </div>
          <div className="h-6 w-16 shrink-0 rounded-full bg-black/[0.05]" />
        </div>
      ))}
    </div>
  );
}

export function SatEyebrow({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className={'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400' + (className ? ' ' + className : '')}>
      {children}
    </p>
  );
}

export function SatSectionCard({
  labelledBy,
  className,
  children,
}: {
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-labelledby={labelledBy}
      className={
        'rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6' +
        (className ? ' ' + className : '')
      }
    >
      {children}
    </div>
  );
}

export function SatMeta({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={'text-[11px] text-slate-400' + (className ? ' ' + className : '')}>{children}</p>
  );
}
