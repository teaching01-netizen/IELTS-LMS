import type { ReactNode } from 'react';

/**
 * Room section heading: a 16px title sharing its row with at most one trailing
 * action, and an optional description underneath at the section's full width.
 */
export function SatRoomSectionHeader({
  id,
  title,
  description,
  action,
  as: Heading = 'h2',
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Heading id={id} className="min-w-0 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
          {title}
        </Heading>
        {action ? <div className="-my-1.5 flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {description ? <p className="mt-0.5 text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p> : null}
    </div>
  );
}
