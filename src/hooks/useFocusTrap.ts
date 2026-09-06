import { useEffect, useRef } from 'react';

/**
 * Custom hook to trap focus within a modal or dialog
 * Ensures keyboard navigation stays within the modal when it's open
 *
 * @param isActive - Whether the focus trap should be active
 * @param onEscape - Optional callback when Escape key is pressed
 */
export function useFocusTrap(isActive: boolean, onEscape?: () => void) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Queried live on every Tab press so async content participates in the
    // trap instead of being skipped by a mount-time snapshot.
    const queryFocusable = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls]',
        ),
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
    const firstOf = (): HTMLElement => queryFocusable()[0] ?? container;
    const lastOf = (): HTMLElement => queryFocusable().slice(-1)[0] ?? container;
    const firstElement = firstOf();

    // Focus the first element when trap activates
    if (firstElement) {
      firstElement.focus();
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const first = firstOf();
      const last = lastOf();
      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && onEscape) {
        onEscape();
      }
    };

    container.addEventListener('keydown', handleTabKey);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      container.removeEventListener('keydown', handleTabKey);
      document.removeEventListener('keydown', handleEscapeKey);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isActive, onEscape]);

  return containerRef;
}
