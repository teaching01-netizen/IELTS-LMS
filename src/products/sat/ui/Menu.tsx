import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';

/**
 * A single platform menu contract for the Digital SAT staff workspace.
 *
 * Real browsers get the native Radix DropdownMenu primitive: typeahead, roving
 * focus, Escape/pointer-out dismissal, disabled and destructive item states.
 * Environments without window.matchMedia (jsdom, ancient engines) get a static
 * equivalent with the same DOM contract, so behavior never silently vanishes.
 */
export type SatMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Marks the active workspace/choice with a trailing check glyph. */
  current?: boolean;
  /** Renders a hairline separator above the item (group boundary). */
  separatorBefore?: boolean;
};

type SatMenuProps = {
  /** Accessible name of the trigger; also the visible label unless `compact`. */
  label: string;
  items: SatMenuItem[];
  /** Custom trigger content (badge + caption rows); the name still comes from `label`. */
  triggerContent?: ReactNode;
  icon?: LucideIcon;
  /** Icon-only 40px trigger with `label` as its accessible name. */
  compact?: boolean;
  align?: 'start' | 'end';
  width?: number;
};

const MENU_ELEVATION =
  'var(--sat-menu-elevation, 0 0 0 0.5px rgba(0, 0, 0, 0.055), 0 2px 8px rgba(0, 0, 0, 0.055), 0 14px 44px rgba(0, 0, 0, 0.14))';

const COMPACT_TRIGGER_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-[10px] text-slate-500 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/40';

const WORKSPACE_TRIGGER_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-black/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]';

function supportsNativeMenu(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function ItemFace({ item }: { item: SatMenuItem }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.current ? <Check size={13} className="shrink-0 text-[#0071e3]" aria-hidden="true" /> : null}
    </>
  );
}

function StaticMenu({ label, items, triggerContent, icon: Icon, compact, align = 'start', width }: SatMenuProps) {
  const [open, setOpen] = useState(false);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-sat-menu-root]')) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" data-sat-menu-root>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        onClick={() => setOpen((value) => !value)}
        className={compact ? COMPACT_TRIGGER_CLASS : WORKSPACE_TRIGGER_CLASS}
      >
        {triggerContent ?? (
          <>
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            {!compact ? <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span> : null}
          </>
        )}
        {!compact ? <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          style={{ minWidth: width ?? 176, boxShadow: MENU_ELEVATION }}
          className={`sat-menu absolute top-[calc(100%+6px)] z-50 ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && index > 0 ? <div role="separator" className="my-1 h-px bg-black/[0.07]" /> : null}
              <button
                ref={index === 0 ? firstItemRef : undefined}
                type="button"
                role="menuitem"
                disabled={Boolean(item.disabled)}
                data-destructive={item.destructive || undefined}
                data-current={item.current || undefined}
                className="sat-menu-item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <ItemFace item={item} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SatMenu(props: SatMenuProps) {
  if (!supportsNativeMenu()) return <StaticMenu {...props} />;
  const { label, items, triggerContent, icon: Icon, compact, align = 'start', width } = props;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={compact ? label : undefined} className={compact ? COMPACT_TRIGGER_CLASS : WORKSPACE_TRIGGER_CLASS}>
          {triggerContent ?? (
            <>
              {Icon ? <Icon size={16} aria-hidden="true" /> : null}
              {!compact ? <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span> : null}
            </>
          )}
          {!compact ? <ChevronDown size={14} className="shrink-0 text-slate-400 transition-transform" aria-hidden="true" /> : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          aria-label={label}
          style={{ minWidth: width ?? 176, boxShadow: MENU_ELEVATION }}
          className="sat-menu z-50"
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && index > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-black/[0.07]" /> : null}
              <DropdownMenu.Item
                disabled={Boolean(item.disabled)}
                data-destructive={item.destructive || undefined}
                data-current={item.current || undefined}
                className="sat-menu-item"
                onSelect={(event) => {
                  if (item.current) event.preventDefault();
                  item.onSelect();
                }}
              >
                <ItemFace item={item} />
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
