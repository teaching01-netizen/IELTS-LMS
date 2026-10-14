import type { HTMLAttributes } from 'react';

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'aside';
};

/**
 * The one room surface: white, hairline border, card radius, the soft card lift. Every
 * pane of the live room sits on this, so the roster, the context column and the
 * inspector read as one workspace rather than separate tools.
 */
export function SatRoomSurface({ as: Element = 'section', className, children, ...props }: SurfaceProps) {
  return (
    <Element
      className={
        'min-w-0 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] shadow-[var(--sat-staff-shadow-card,none)]' +
        (className ? ' ' + className : '')
      }
      {...props}
    >
      {children}
    </Element>
  );
}
