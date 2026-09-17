import type { ReactElement } from "react";
import { Tooltip } from "radix-ui";

/**
 * Desktop hover label for icon-only controls.
 *
 * Delayed by 600 ms so the chrome never feels nervous, and skipped entirely in
 * environments where Radix cannot mount (jsdom, ancient engines): every control
 * already carries an `aria-label`, so the accessible name never depends on the
 * tooltip existing. Touch surfaces keep visible labels instead of hovering,
 * because there is no hover to discover them with.
 */
function supportsTooltip(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

export function EditorTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string | undefined;
  children: ReactElement;
}) {
  if (!supportsTooltip()) return children;
  return (
    <Tooltip.Root delayDuration={600}>
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
  );
}
