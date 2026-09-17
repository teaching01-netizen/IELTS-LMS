import type { ReactElement } from "react";
import { Tooltip } from "radix-ui";

/**
 * Desktop hover label for icon-only controls.
 *
 * Delayed so the chrome never feels nervous, and self-sufficient: Radix throws
 * unless a tooltip provider sits above it, so this component provides its own
 * rather than depending on every future call site remembering to. A control can
 * therefore be dropped anywhere in the editor and still be safe.
 *
 * The label is additive by design. Every control already carries an
 * `aria-label`, so the accessible name never depends on a tooltip — and touch,
 * where nothing hovers, still has the words somewhere (see the object controls,
 * which are labelled rather than icon-only).
 *
 * It is deliberately *not* gated on the environment. An earlier version skipped
 * the tooltip when `window.matchMedia` was missing, which meant jsdom never
 * rendered this subtree and a missing provider reached production; tests now
 * exercise the same path the browser takes.
 */
export function EditorTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string | undefined;
  children: ReactElement;
}) {
  return (
    <Tooltip.Provider delayDuration={600}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            collisionPadding={8}
            className="sat-tooltip sat-product"
          >
            <span>{label}</span>
            {shortcut ? <span className="sat-tooltip__shortcut">{shortcut}</span> : null}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
