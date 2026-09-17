import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
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
 *
 * Current-item contract: `item.current` keeps the trailing check glyph, stays
 * clickable (no behavior change), and adds aria-current="true" in BOTH
 * branches (Radix item + static button). Both triggers always carry
 * aria-label={label} (compact or not) so the accessible name is branch-stable.
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
  /** Leading glyph. Icons are for items whose meaning is unambiguous alone. */
  icon?: LucideIcon;
  /**
   * Replaces the item face with the menu's own rendering of the effect (for
   * example a style option shown at its real weight and size). The visible
   * preview text is what names the item, so it must read as the label.
   */
  preview?: ReactNode;
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
  /**
   * Replaces the standard trigger geometry. Callers that own a denser strip
   * (the rich-editor toolbar) keep one menu contract but their own trigger
   * proportions; the accessible name still comes from `label`.
   */
  triggerClassName?: string | undefined;
  /**
   * Where the popup is portaled. Defaults to `document.body`, which is right for
   * a trigger that lives in stable chrome.
   *
   * A menu opened from a *floating* surface must share that surface's container
   * instead. Tiptap hides a bubble menu as soon as focus leaves the element the
   * surface was appended to, and Radix moves focus into the popup when it opens
   * — so a body-portaled menu hides its own surface, which removes the very
   * button Radix anchors the popup against, and the popup lands wherever a
   * zero-sized anchor puts it: the top-left of the screen. Sharing the container
   * keeps the surface up, the trigger attached, and the popup under the trigger.
   */
  portalContainer?: HTMLElement | null;
};

const MENU_ELEVATION =
  'var(--sat-staff-shadow-menu, 0 0 0 0.5px rgba(0, 0, 0, 0.055), 0 2px 8px rgba(0, 0, 0, 0.055), 0 14px 44px rgba(0, 0, 0, 0.14))';

const COMPACT_TRIGGER_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-[var(--sat-staff-radius-control,10px)] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill,rgba(120,120,128,0.08))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]';

const WORKSPACE_TRIGGER_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-[var(--sat-staff-radius-input,12px)] px-3 text-left transition-colors hover:bg-[var(--sat-staff-fill,rgba(120,120,128,0.08))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#0071e3)]';

function supportsNativeMenu(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function ItemFace({ item }: { item: SatMenuItem }) {
  if (item.preview !== undefined && item.preview !== null) {
    return (
      <>
        <span className="min-w-0 flex-1">{item.preview}</span>
        {item.current ? <Check size={13} className="shrink-0 text-[var(--sat-staff-accent,#0071e3)]" aria-hidden="true" /> : null}
      </>
    );
  }
  const Icon = item.icon;
  return (
    <>
      {Icon ? <Icon size={15} className="sat-menu-item__icon" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.current ? <Check size={13} className="shrink-0 text-[var(--sat-staff-accent,#0071e3)]" aria-hidden="true" /> : null}
    </>
  );
}

function StaticMenu({ label, items, triggerContent, icon: Icon, compact, align = 'start', width, triggerClassName }: SatMenuProps) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const initialItem =
      menuRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]') ??
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    initialItem?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-sat-menu-root]')) {
        setOpen(false);
      }
    };
    // The native Radix branch owns Escape in real browsers. This listener is
    // only for the static compatibility branch used where Radix cannot mount.
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!menuItems.length) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const moveTo = (index: number) => {
      event.preventDefault();
      menuItems[(index + menuItems.length) % menuItems.length]?.focus();
    };
    if (event.key === 'ArrowDown') moveTo(currentIndex < 0 ? 0 : currentIndex + 1);
    else if (event.key === 'ArrowUp') moveTo(currentIndex < 0 ? menuItems.length - 1 : currentIndex - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(menuItems.length - 1);
  };

  return (
    <div className="relative" data-sat-menu-root>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
        }}
        className={triggerClassName ?? (compact ? COMPACT_TRIGGER_CLASS : WORKSPACE_TRIGGER_CLASS)}
      >
        {triggerContent ?? (
          <>
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            {!compact ? <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span> : null}
          </>
        )}
        {!compact ? <ChevronDown size={14} data-open={open || undefined} className="sat-menu-trigger-chevron shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={popupId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          data-sat-menu-animate=""
          onKeyDown={handleMenuKeyDown}
          style={{ minWidth: width ?? 176, boxShadow: MENU_ELEVATION, ['--sat-menu-origin' as string]: align === 'end' ? 'top right' : 'top left' }}
          className={`sat-menu sat-product absolute top-[calc(100%+6px)] z-50 ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && index > 0 ? <div role="separator" className="my-1 h-px bg-[var(--sat-staff-separator,rgba(60,60,67,0.12))]" /> : null}
              <button
                type="button"
                role="menuitem"
                disabled={Boolean(item.disabled)}
                data-destructive={item.destructive || undefined}
                data-current={item.current || undefined}
                aria-current={item.current ? 'true' : undefined}
                className="sat-menu-item"
                onClick={() => {
                  closeMenu(true);
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
  const { label, items, triggerContent, icon: Icon, compact, align = 'start', width, triggerClassName, portalContainer } = props;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={label} className={`group ${triggerClassName ?? (compact ? COMPACT_TRIGGER_CLASS : WORKSPACE_TRIGGER_CLASS)}`}>
          {triggerContent ?? (
            <>
              {Icon ? <Icon size={16} aria-hidden="true" /> : null}
              {!compact ? <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span> : null}
            </>
          )}
          {!compact ? <ChevronDown size={14} className="sat-menu-trigger-chevron shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)] group-data-[state=open]:rotate-180" aria-hidden="true" /> : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer ?? null}>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          aria-label={label}
          data-sat-menu-animate=""
          style={{ minWidth: width ?? 176, boxShadow: MENU_ELEVATION, ['--sat-menu-origin' as string]: align === 'end' ? 'top right' : 'top left' }}
          className="sat-menu sat-product z-[110]"
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && index > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-[var(--sat-staff-separator,rgba(60,60,67,0.12))]" /> : null}
              <DropdownMenu.Item
                disabled={Boolean(item.disabled)}
                data-destructive={item.destructive || undefined}
                data-current={item.current || undefined}
                aria-current={item.current ? 'true' : undefined}
                className="sat-menu-item"
                onSelect={() => {
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
