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
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = (focusableElements[0] as HTMLElement | undefined) ?? container;
    const lastElement = (focusableElements[focusableElements.length - 1] as HTMLElement | undefined) ?? container;

    // Focus the first element when trap activates
    if (firstElement) {
      firstElement.focus();
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
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
