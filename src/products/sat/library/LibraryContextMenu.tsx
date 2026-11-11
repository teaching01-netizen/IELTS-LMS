import { useRef, type ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import type { SatMenuItem } from "../ui/Menu";

const MENU_ELEVATION =
  "var(--sat-staff-shadow-menu, 0 0 0 0.5px rgba(0, 0, 0, 0.055), 0 2px 8px rgba(0, 0, 0, 0.055), 0 14px 44px rgba(0, 0, 0, 0.14))";

function supportsNativeMenu(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * Local right-click menu for library rows. Uses the installed Radix
 * ContextMenu primitive (keyboard, Escape, focus) with the existing sat-menu
 * styling, and keeps the visible three-dot button as the keyboard/touch
 * path. Non-modal so opening a dialog from an item never overlaps a
 * pointer lock. In constrained environments (no matchMedia, e.g. jsdom)
 * renders only the children: right-click is a browser-only gesture.
 */
export function LibraryContextMenu({
  label,
  items,
  children,
}: {
  label: string;
  items: SatMenuItem[];
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const actionButton = () => triggerRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? null;
  if (!supportsNativeMenu()) return <>{children}</>;
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger ref={triggerRef} asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label={label}
          data-sat-menu-animate=""
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = actionButton();
            queueMicrotask(() => {
              // Let a chosen dialog own focus; Escape returns to the row's
              // visible menu button rather than an unmounted context item.
              if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return;
              if (target?.isConnected) target.focus();
            });
          }}
          style={{ minWidth: 176, boxShadow: MENU_ELEVATION }}
          className="sat-menu sat-product sat-staff-root z-[110]"
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && index > 0 ? <ContextMenu.Separator className="my-1 h-px bg-[var(--sat-staff-separator,rgba(60,60,67,0.12))]" /> : null}
              <ContextMenu.Item
                disabled={Boolean(item.disabled)}
                data-destructive={item.destructive || undefined}
                className="sat-menu-item"
                onSelect={() => {
                  const trigger = actionButton();
                  trigger?.focus({ preventScroll: true });
                  item.onSelect(trigger);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </ContextMenu.Item>
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
