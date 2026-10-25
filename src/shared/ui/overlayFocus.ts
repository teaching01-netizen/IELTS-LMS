/** Return to a persistent control rather than a menu item that will unmount. */
export function captureOverlayReturnTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const triggerId = active.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  return (triggerId ? document.getElementById(triggerId) : null) ?? active;
}
