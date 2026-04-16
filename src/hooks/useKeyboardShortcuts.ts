import { useEffect } from 'react';

export interface KeyboardShortcut {
  allowInInputs?: boolean;
  combo: string;
  enabled?: boolean;
  handler: (event: KeyboardEvent) => void;
}

const normalizeCombo = (combo: string) => combo.toLowerCase().replace(/\s+/g, '');

const eventTargetIsEditable = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
};

const matchesCombo = (event: KeyboardEvent, combo: string) => {
  const normalized = normalizeCombo(combo);
  const parts = normalized.split('+');

  const expectsMeta = parts.includes('mod')
    ? event.metaKey || event.ctrlKey
    : parts.includes('meta')
      ? event.metaKey
      : parts.includes('ctrl')
        ? event.ctrlKey
        : !event.metaKey && !event.ctrlKey;

  const expectsShift = parts.includes('shift') ? event.shiftKey : !event.shiftKey;
  const expectsAlt = parts.includes('alt') ? event.altKey : !event.altKey;
  const key = parts[parts.length - 1];

  return expectsMeta && expectsShift && expectsAlt && event.key.toLowerCase() === key;
};

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      shortcuts.forEach((shortcut) => {
        if (shortcut.enabled === false) {
          return;
        }

        if (!shortcut.allowInInputs && eventTargetIsEditable(event.target)) {
          return;
        }

        if (matchesCombo(event, shortcut.combo)) {
          event.preventDefault();
          shortcut.handler(event);
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
