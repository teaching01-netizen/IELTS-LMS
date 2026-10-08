import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';

/**
 * Shared Calm Ops Bento primitives for the Digital SAT staff list pages
 * (Exam Library, Sessions, Results). Operate mode: the tool disappears into
 * the task - one sans, one accent (var(--sat-staff-accent)), soft 16-20px card rows,
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
  backLabel,
  onBack,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional location/back link rendered above the eyebrow (both props required to render). */
  backLabel?: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {backLabel && onBack ? (
          <button type="button" onClick={onBack} className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
            <ArrowLeft size={16} aria-hidden="true" />
            {backLabel}
          </button>
        ) : null}
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{eyebrow}</p>
        <h1 className="mt-1 text-balance text-[24px] font-semibold tracking-[-0.04em] sm:text-[30px] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-xl text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div> : null}
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
    <div className={'relative min-w-0 flex-1' + (widthClassName ? ' ' + widthClassName : '')}>
      <Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-hidden="true" />
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        className="h-11 w-full rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-input,rgba(0,0,0,0.075))] bg-[var(--sat-staff-surface,#fff)] pl-9 pr-8 text-[14px] text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none transition placeholder:text-[var(--sat-staff-text-tertiary,#6e6e73)] focus:border-[var(--sat-staff-accent,#0071e3)] focus:ring-2 focus:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="sat-search-clear sat-press sat-press-fill absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-skeleton-bar-soft,rgba(0,0,0,0.05))] hover:text-[var(--sat-staff-text-secondary,#515154)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function SatPrimaryButton({
  onClick,
  icon,
  ariaLabel,
  children,
  pending = false,
  disabled = false,
}: {
  onClick: () => void;
  icon?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  pending?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || pending;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      disabled={isDisabled}
      className="sat-press sat-press-fill-accent flex h-11 min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[14px] font-semibold text-white hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#0071e3)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sat-staff-canvas,#f5f5f7)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
    >
      {pending ? (
        <span aria-hidden="true" className="sat-spinner block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        icon
      )}
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
  published: 'border-emerald-700/20 bg-[var(--sat-staff-success-tint,rgba(5,150,105,0.1))] text-[var(--sat-staff-success-text,#067647)]',
  live: 'border-emerald-700/20 bg-[var(--sat-staff-success-tint,rgba(5,150,105,0.1))] text-[var(--sat-staff-success-text,#067647)]',
  changes: 'border-amber-700/25 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] text-[var(--sat-staff-warning-text,#92400e)]',
  paused: 'border-amber-700/25 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] text-[var(--sat-staff-warning-text,#92400e)]',
  info: 'border-[var(--sat-staff-accent,#0071e3)]/25 bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] text-[var(--sat-staff-info-text,#0067c9)]',
  ready: 'border-[var(--sat-staff-accent,#0071e3)]/25 bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] text-[var(--sat-staff-info-text,#0067c9)]',
  invalidated: 'border-red-700/20 bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] text-[var(--sat-staff-danger,#b42318)]',
  draft: 'border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-neutral-text,#515154)]',
  archived: 'border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-neutral-text,#515154)]',
  finished: 'border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-neutral-text,#515154)]',
  cancelled: 'border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-neutral-text,#515154)]',
  neutral: 'border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-neutral-text,#515154)]',
  pending: 'border-amber-700/25 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] text-[var(--sat-staff-warning-text,#92400e)]',
};

/**
 * outcomeStatus -> tone table (results lanes must import this; do not fork):
 *   scored                -> 'ready'
 *   pending               -> 'pending'
 *   invalidated_proctor   -> 'invalidated'
 *   invalidated_timeout   -> 'invalidated'
 *   anything else         -> 'neutral'
 */
export function satOutcomeTone(outcome: string): SatStatusTone {
  if (outcome === 'scored' || outcome === 'pending') return 'ready';
  if (outcome === 'invalidated_proctor' || outcome === 'invalidated_timeout') return 'invalidated';
  return 'neutral';
}

const TONE_DOT_CLASS: Record<SatStatusTone, string> = {
  published: 'bg-[var(--sat-staff-success-dot,#059669)]',
  live: 'bg-[var(--sat-staff-success-dot,#059669)]',
  changes: 'bg-[var(--sat-staff-warning-dot,#d97706)]',
  paused: 'bg-[var(--sat-staff-warning-dot,#d97706)]',
  info: 'bg-[var(--sat-staff-info-dot,#0071e3)]',
  ready: 'bg-[var(--sat-staff-info-dot,#0071e3)]',
  invalidated: 'bg-red-500',
  draft: 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]',
  archived: 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]',
  finished: 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]',
  cancelled: 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]',
  neutral: 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]',
  pending: 'bg-[var(--sat-staff-warning-dot,#d97706)]',
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
    <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ' + TONE_PILL_CLASS[tone]}>
      <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full ' + TONE_DOT_CLASS[tone] + (pulse ? ' sat-live-dot' : '')} />
      <span>{children}</span>
    </span>
  );
}

/**
 * Routine records sit in ONE grouped surface separated by hairlines (no card
 * per row). `cards` keeps separately framed rows for callers whose rows carry
 * their own frame (Student link rows).
 */
export function SatList({ children, variant = 'grouped' }: { children: ReactNode; variant?: 'grouped' | 'cards' }) {
  if (variant === 'cards') return <div className="mt-4 space-y-2">{children}</div>;
  return (
    <div className="mt-3 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] overflow-hidden rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)]">
      {children}
    </div>
  );
}

/**
 * One toolbar grammar for every staff list, under the page header:
 * status tabs (with counts) → search / filters / sort. Render it in every
 * state (loading, empty, error-free) so filters never disappear.
 */
export function SatListToolbar({ tabs, children, label = 'List controls' }: { tabs?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <div className="mt-5 flex flex-col gap-3" role="group" aria-label={label}>
      {tabs ? <div className="max-w-full overflow-x-auto">{tabs}</div> : null}
      {children ? <div className="flex flex-wrap items-end gap-2">{children}</div> : null}
    </div>
  );
}

/** Labelled native select sized like every other toolbar control. */
export function SatToolbarSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-11 rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-input,rgba(0,0,0,0.075))] bg-[var(--sat-staff-surface,#fff)] px-3 text-[14px] font-normal text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/**
 * SatListRow contract (call sites own the chevron slot): the row owns the
 * <button> frame + ariaLabel passthrough; callers render title at 14px
 * semibold, meta lines at 12px (the staff floor), and an always-visible trailing chevron
 * (`.sat-row-chevron`) so affordance never depends on hover alone. Rows are
 * flat (the grouped SatList draws the frame); 56px keeps a comfortable touch
 * target while showing more records per screen.
 */
export function SatListRow({
  onOpen,
  ariaLabel,
  disabled = false,
  children,
  index,
  rowId,
  current = false,
}: {
  onOpen: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  children: ReactNode;
  /** Optional position for a capped stagger (first 6 rows). Omit for no entrance. */
  index?: number;
  /** Record id, so a page can return focus to the record it opened. */
  rowId?: string;
  /** The record the reviewer last opened from this list. */
  current?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      aria-current={current ? 'true' : undefined}
      data-sat-row-id={rowId}
      disabled={disabled}
      style={index !== undefined ? ({ '--sat-row-index': index } as CSSProperties) : undefined}
      className={
        'sat-list-row group flex min-h-14 w-full items-center bg-[var(--sat-staff-surface,#fff)] px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent,#0071e3)] aria-[current=true]:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]' +
        (index !== undefined ? ' sat-row-enter' : '')
      }
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
  /** Optional filter action. When present the stat renders as a <button>, else a <div>. */
  onSelect?: () => void;
};

/**
 * Filter/result count line: one polite live region per list so screen-reader
 * and sighted users both know what a filter did. Render only when data is
 * present — never alongside the loading skeleton (avoids double announce).
 *
 * Skeleton-XOR rule: callers render EITHER SatListSkeleton (loading) OR
 * SatResultCount (loaded); rendering both announces twice. Null when
 * total <= 0 keeps the region silent for empty data so the empty-state
 * owns the announcement. Optional scopeLabel overrides itemLabel for the
 * unit word (backward compatible: absent scopeLabel keeps itemLabel path).
 *
 * Press contract: SatPrimaryButton carries the shared `sat-press`
 * vocabulary (instant press-in, 100ms release, accent pressed fill) so the
 * one primary action grammar is identical on every staff surface.
 * SatSearchField's clear control keeps its pinned 28px target (F-A6) and
 * presses without changing size.
 */
export function SatResultCount({ total, visible, itemLabel, scopeLabel }: { total: number; visible: number; itemLabel: string; scopeLabel?: string }) {
  if (total <= 0) return null;
  const unit = scopeLabel ?? itemLabel;
  const text = visible === total ? `${total} ${unit}` : `${visible} of ${total} ${unit}`;
  return (
    <p role="status" aria-live="polite" className="mt-3 text-[12px] font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">
      {text}
    </p>
  );
}

/** Columns follow the stat count so a row never ends with one orphaned card. */
const STAT_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
};

export function SatStatStrip({ stats, label = 'Summary' }: { stats: SatStat[]; label?: string }) {
  return (
    <section aria-label={label} className={'sat-route-enter mt-5 grid gap-2 ' + (STAT_COLUMNS[stats.length] ?? 'grid-cols-2 sm:grid-cols-3')}>
      {stats.map((stat) => {
        const cardClassName =
          'min-w-0 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] px-3.5 py-3 text-left shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))]';
        const body = (
          <>
            <p className="truncate text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{stat.label}</p>
            <p className="mt-1 truncate text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{stat.value}</p>
            {stat.hint ? <p className="mt-0.5 truncate text-[12px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{stat.hint}</p> : null}
          </>
        );
        if (stat.onSelect) {
          return (
            <button
              key={stat.id}
              type="button"
              onClick={stat.onSelect}
              aria-label={stat.label + ': ' + String(stat.value)}
              className={cardClassName + ' transition-colors hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]'}
            >
              {body}
            </button>
          );
        }
        return (
          <div key={stat.id} className={cardClassName}>
            {body}
          </div>
        );
      })}
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
    <div className="sat-route-enter flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] text-[var(--sat-staff-text-tertiary,#6e6e73)] shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))]">
        {icon}
      </div>
      <h2 className="mt-4 text-balance text-[16px] font-semibold tracking-[-0.02em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
      <p className="mt-1 max-w-sm text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SatListSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="mt-3 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] overflow-hidden rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)]">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="sat-skeleton-shimmer flex min-h-14 items-center gap-3 bg-[var(--sat-staff-surface,#fff)] px-4 py-3"
       >
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-2/5 rounded-full bg-[var(--sat-staff-skeleton-bar,rgba(0,0,0,0.07))]" />
            <div className="mt-2 h-2.5 w-1/3 rounded-full bg-[var(--sat-staff-skeleton-bar-soft,rgba(0,0,0,0.05))]" />
          </div>
          <div className="h-6 w-16 shrink-0 rounded-full bg-[var(--sat-staff-skeleton-bar-soft,rgba(0,0,0,0.05))]" />
        </div>
      ))}
    </div>
  );
}

/**
 * Workspace-styled inline error (NOT a full-page surface): white card with
 * title, description, and an optional primary retry action. role="alert"
 * announces it; the retry button keeps a min 44px target with the workspace
 * accent. Never pair with SatListSkeleton — error replaces loading output.
 */
export function SatInlineError({
  title,
  description,
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="mt-4 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-5 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))]">
      <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
      <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 rounded-[var(--sat-staff-radius-input,12px)] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[14px] font-semibold text-white transition hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--sat-staff-accent-ring-button,rgba(0,113,227,0.25))] active:bg-[var(--sat-staff-accent-active,#0067c9)]"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Trivial release-status tag for results rows: small text, no tone pill. */
export function SatReleaseTag({ releaseStatus }: { releaseStatus: string }) {
  return <span className="text-[12px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">Practice · {releaseStatus}</span>;
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
    <p id={id} className={'text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--sat-staff-text-tertiary,#6e6e73)]' + (className ? ' ' + className : '')}>
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
        'rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-5 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))] sm:p-6' +
        (className ? ' ' + className : '')
      }
    >
      {children}
    </div>
  );
}

/**
 * Full-page staff loading state: SAT workspace skin (NOT the admin grey
 * skeleton). Centers a shimmer row block inside the staff container so
 * detail/access/room cold opens never flash IELTS chrome. Label preserved
 * for the sr-only announcement; role="status" keeps a single live region.
 */
export function SatPageLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <SatContainer>
      <div className="flex min-h-[60vh] flex-col justify-center">
        <SatListSkeleton rows={rows} label={label} />
      </div>
    </SatContainer>
  );
}

/**
 * Full-page staff error state: SAT workspace skin (NOT the admin grey
 * ErrorSurface). Centers a workspace card with title, description, and an
 * optional primary retry action. role="alert" announces it once.
 */
export function SatPageError({
  title,
  description,
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <SatContainer>
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div
          role="alert"
          className="w-full max-w-md rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-6 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))]"
        >
          <h1 className="text-[17px] font-semibold tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 min-h-11 rounded-[var(--sat-staff-radius-input,12px)] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[14px] font-semibold text-white transition hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--sat-staff-accent-ring-button,rgba(0,113,227,0.25))] active:bg-[var(--sat-staff-accent-active,#0067c9)]"
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </SatContainer>
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
    <p className={'text-[12px] text-[var(--sat-staff-text-tertiary,#6e6e73)]' + (className ? ' ' + className : '')}>{children}</p>
  );
}
