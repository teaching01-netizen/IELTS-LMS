import { forwardRef, useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

/**
 * Shared primitives for the Digital SAT staff workspace (Exams, Rooms,
 * Responses, exam workspace). One sans, one accent (var(--sat-staff-accent)),
 * 44px controls, grouped hairline surfaces, dot+label status (color never
 * carries state alone). Visual rules live in index.css (`.sat-btn`,
 * `.sat-field`, `.sat-input`, `.sat-table`); these components apply them.
 */

const MEASURE_CLASS = {
  list: 'max-w-[var(--sat-staff-measure-list,1180px)]',
  settings: 'max-w-[var(--sat-staff-measure-settings,920px)]',
  full: 'max-w-none',
} as const;

export type SatMeasure = keyof typeof MEASURE_CLASS;

/** Page column: 16px gutters on small screens, 24px above; header and content share it. */
export function SatContainer({ children, className, measure = 'list' }: { children: ReactNode; className?: string; measure?: SatMeasure }) {
  return (
    <div className={'mx-auto w-full px-4 pb-14 pt-6 sm:px-6 md:pt-8 ' + MEASURE_CLASS[measure] + (className ? ' ' + className : '')}>
      {children}
    </div>
  );
}

export type SatCrumb = {
  label: string;
  /** Real URL so the crumb is a link (middle-click, copy). */
  href?: string;
  /** Guard-aware navigation; a plain click calls this instead of following href. */
  onSelect?: () => void;
};

/**
 * Location trail. Every crumb but the last navigates; the last is the current
 * page (aria-current). Collapses to the parent crumb on narrow screens so the
 * way back never wraps under the title.
 */
export function SatBreadcrumbs({ items, className }: { items: SatCrumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={'sat-breadcrumbs min-w-0' + (className ? ' ' + className : '')}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-[14px] leading-5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const parent = index === items.length - 2;
          return (
            <li key={`${index}-${item.label}`} className={'min-w-0 items-center gap-1 ' + (last || parent ? 'flex' : 'hidden sm:flex')}>
              {last ? (
                <span aria-current="page" className="truncate font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{item.label}</span>
              ) : (
                <>
                  <a
                    href={item.href ?? '#'}
                    onClick={(event) => {
                      if (!item.onSelect) return;
                      const plainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
                      if (!plainLeftClick && item.href) return;
                      event.preventDefault();
                      item.onSelect();
                    }}
                    className="inline-flex min-h-11 items-center truncate px-0.5 font-medium"
                  >
                    {item.label}
                  </a>
                  <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SatPageHeader({
  eyebrow,
  title,
  description,
  actions,
  backLabel,
  onBack,
  breadcrumbs,
  meta,
  titleId,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional location/back link rendered above the eyebrow (both props required to render). */
  backLabel?: string;
  onBack?: () => void;
  /** Location trail above the title; replaces the back link when present. */
  breadcrumbs?: SatCrumb[] | undefined;
  /** Status pills / version line beside the description. */
  meta?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <SatBreadcrumbs items={breadcrumbs} className="-mt-2 mb-1" />
        ) : backLabel && onBack ? (
          <button type="button" onClick={onBack} className="sat-btn sat-btn--quiet sat-press -ml-3 mb-1 px-3">
            <ArrowLeft size={16} aria-hidden="true" />
            {backLabel}
          </button>
        ) : null}
        {eyebrow ? <SatEyebrow>{eyebrow}</SatEyebrow> : null}
        <h1 id={titleId} className={'text-balance text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]' + (eyebrow ? ' mt-1' : '')}>{title}</h1>
        {description || meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {meta}
            {description ? <p className="max-w-2xl text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p> : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div> : null}
    </header>
  );
}

/** Section title (20/28) with optional description and trailing actions. */
export function SatSectionHeader({
  id,
  title,
  description,
  actions,
  as: Heading = 'h2',
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</Heading>
        {description ? <p className="mt-1 max-w-2xl text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <div className={'relative min-w-0 flex-1 basis-full sm:basis-auto' + (widthClassName ? ' ' + widthClassName : '')}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-hidden="true" />
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
        className="sat-input pl-9 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="sat-search-clear group absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-[var(--sat-staff-radius-control,10px)] text-[var(--sat-staff-text-tertiary,#6e6e73)]"
        >
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full transition-colors group-hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] group-hover:text-[var(--sat-staff-text-secondary,#515154)] group-active:bg-[var(--sat-staff-fill-active,rgba(0,0,0,0.065))]">
            <X size={14} />
          </span>
        </button>
      ) : null}
    </div>
  );
}

export type SatButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-secondary';

export type SatButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: SatButtonVariant;
  /** 16px Lucide icon; the pending spinner takes its slot. */
  icon?: ReactNode;
  /** In flight: keeps focus and size, announces busy, ignores further presses. */
  pending?: boolean;
  /** Icon-only square (44×44). Requires aria-label. */
  iconOnly?: boolean;
  block?: boolean;
  children?: ReactNode;
};

/**
 * The one staff button. Variants: primary (at most one dominant per header or
 * dialog), secondary, quiet, danger (confirmations), danger-secondary
 * (destructive entry points). Pending never changes the box and never drops
 * focus: the control stays focusable with aria-disabled + aria-busy.
 */
export const SatButton = forwardRef<HTMLButtonElement, SatButtonProps>(function SatButton(
  { variant = 'secondary', icon, pending = false, iconOnly = false, block = false, disabled = false, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  const spinner = <span aria-hidden="true" className={'sat-btn__spinner' + (icon || iconOnly ? '' : ' sat-btn__spinner--overlay')} />;
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-disabled={pending || rest['aria-disabled'] ? true : undefined}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={
        'sat-btn sat-press sat-btn--' + variant +
        (iconOnly ? ' sat-btn--icon' : '') +
        (block ? ' sat-btn--block' : '') +
        (className ? ' ' + className : '')
      }
    >
      {pending && (icon || iconOnly) ? spinner : icon}
      {iconOnly ? null : (
        <span className="sat-btn__label" data-pending-hidden={pending && !icon ? '' : undefined}>{children}</span>
      )}
      {pending && !icon && !iconOnly ? spinner : null}
    </button>
  );
});

/** Icon-only 44×44 control; the label is both its accessible name and its tooltip. */
export const SatIconButton = forwardRef<HTMLButtonElement, Omit<SatButtonProps, 'iconOnly' | 'children' | 'aria-label'> & { label: string; icon: ReactNode }>(
  function SatIconButton({ label, variant = 'quiet', title, ...rest }, ref) {
    return <SatButton ref={ref} {...rest} variant={variant} iconOnly aria-label={label} title={title ?? label} />;
  },
);

/** Compatible wrapper: existing callers keep their props; renders the primary SatButton. */
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
  return (
    <SatButton variant="primary" onClick={onClick} icon={icon} aria-label={ariaLabel} pending={pending} disabled={disabled}>
      {children}
    </SatButton>
  );
}

export type SatFieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

/**
 * Label / help / error wrapper for one control. Children receive the ids the
 * control must carry, so help and errors are announced with it.
 */
export function SatField({
  id,
  label,
  help,
  error,
  optional = false,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (control: SatFieldControlProps) => ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helpId = help ? controlId + '-help' : undefined;
  const errorId = error ? controlId + '-error' : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={'sat-field' + (className ? ' ' + className : '')}>
      <label htmlFor={controlId} className="sat-field__label">
        {label}
        {optional ? <span className="sat-field__optional">Optional</span> : null}
      </label>
      {children({ id: controlId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} role="alert" className="sat-field__error">
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
      {help ? <p id={helpId} className="sat-field__help">{help}</p> : null}
    </div>
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
    <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[14px] font-semibold ' + TONE_PILL_CLASS[tone]}>
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
 * One toolbar grammar for every staff list, under the page header: status
 * tabs (with counts) on the left, search / filters / sort on the right; they
 * stack on narrow widths. Render it in every state (loading, empty, error)
 * so filters never disappear.
 */
export function SatListToolbar({ tabs, children, label = 'List controls' }: { tabs?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between" role="group" aria-label={label}>
      {tabs ? <div className="max-w-full overflow-x-auto xl:shrink-0">{tabs}</div> : null}
      {children ? <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap xl:justify-end">{children}</div> : null}
    </div>
  );
}

/**
 * Native select sized like every other toolbar control, with its label shown
 * inside the control ("Sort  Last updated") so the toolbar stays one row.
 */
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
    <div className="sat-select relative flex min-h-11 shrink-0 items-center rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-control,rgba(0,0,0,0.42))] bg-[var(--sat-staff-surface-solid-fallback,#fff)] pl-3 focus-within:border-[var(--sat-staff-accent,#0071e3)] focus-within:ring-[3px] focus-within:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
      <label htmlFor={id} className="whitespace-nowrap text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-11 cursor-pointer appearance-none rounded-[var(--sat-staff-radius-control,10px)] bg-transparent py-0 pl-2 pr-9 text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none focus-visible:outline-none sm:text-[14px]"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
    </div>
  );
}

/**
 * SatListRow contract (call sites own the chevron slot): the row owns the
 * <button> frame + ariaLabel passthrough; callers render the title and meta lines (meta is never below
 * 12px, the staff floor), and an always-visible trailing chevron
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

/**
 * Column labels for a grouped list whose rows lay out on the same grid
 * (`gridClassName` is shared with the rows). Visual only: each row's button
 * already reads its full content, so the header stays out of the a11y tree.
 * Hidden below md, where rows collapse to title + meta.
 */
export function SatListColumns({ gridClassName, columns }: { gridClassName: string; columns: ReadonlyArray<{ label: string; align?: 'start' | 'end' }> }) {
  return (
    <div aria-hidden="true" className={'hidden min-h-10 items-center bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)] md:grid ' + gridClassName}>
      {columns.map((column, index) => (
        <span key={index} className={column.align === 'end' ? 'text-right' : undefined}>{column.label}</span>
      ))}
    </div>
  );
}

/**
 * Narrow-width placement for list rows laid out on a 2-column mobile grid
 * (`minmax(0,1fr) 16px`): the status drops under the title and the chevron
 * spans both lines; from md the row's own column grid takes over.
 */
export const SAT_ROW_STACK = {
  status: 'col-start-1 row-start-2 mt-2 flex md:col-start-auto md:row-start-auto md:mt-0',
  chevron: 'col-start-2 row-span-2 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto',
} as const;

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
    <p role="status" aria-live="polite" className="mt-3 text-[14px] font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">
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
            <p className="truncate text-[14px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{stat.label}</p>
            <p className="mt-1 truncate text-[22px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{stat.value}</p>
            {stat.hint ? <p className="mt-0.5 truncate text-[14px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{stat.hint}</p> : null}
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
      <h2 className="mt-4 text-balance text-[18px] font-semibold tracking-[-0.02em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
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
    <div role="alert" className="mt-4 flex gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-5">
      <AlertCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--sat-staff-danger,#b42318)]" />
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
        <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
        {onRetry ? <SatButton variant="secondary" onClick={onRetry} className="mt-4">{retryLabel}</SatButton> : null}
      </div>
    </div>
  );
}

/** Trivial release-status tag for results rows: small text, no tone pill. */
export function SatReleaseTag({ releaseStatus }: { releaseStatus: string }) {
  return <span className="text-[14px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">Practice · {releaseStatus}</span>;
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
    <p id={id} className={'text-[14px] font-semibold uppercase tracking-[0.14em] text-[var(--sat-staff-text-tertiary,#6e6e73)]' + (className ? ' ' + className : '')}>
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
          className="w-full max-w-md rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-6"
        >
          <h1 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h1>
          <p className="mt-1.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
          {onRetry ? <SatButton variant="primary" onClick={onRetry} className="mt-5">{retryLabel}</SatButton> : null}
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
    <p className={'text-[14px] text-[var(--sat-staff-text-tertiary,#6e6e73)]' + (className ? ' ' + className : '')}>{children}</p>
  );
}
