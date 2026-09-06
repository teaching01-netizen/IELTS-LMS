import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from './ui/Dialog';

export interface CommandPaletteCommand {
  category?: 'Navigation' | 'Actions' | 'Tools';
  id: string;
  keywords?: string[];
  perform: () => void;
  subtitle?: string;
  title: string;
}

interface CommandPaletteProps {
  commands: CommandPaletteCommand[];
  isOpen: boolean;
  onClose: () => void;
  recentActions?: string[];
}

const MAX_VISIBLE_COMMANDS = 50;

const fuzzyMatch = (value: string, query: string) => {
  if (!query) {
    return true;
  }

  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  let index = 0;

  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) {
      return false;
    }
    index += 1;
  }

  return true;
};

export function CommandPalette({
  commands,
  isOpen,
  onClose,
  recentActions = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listboxId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setSelectedIndex(0);
      // Focus the search input when the palette opens.
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(timer);
        // Restore focus to whatever opened the palette.
        previouslyFocusedRef.current?.focus?.();
        previouslyFocusedRef.current = null;
      };
    }
    return undefined;
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commands.slice(0, MAX_VISIBLE_COMMANDS);
    }
    const matches = commands.filter((command) => {
      const source = [command.title, command.subtitle, command.category, ...(command.keywords ?? [])]
        .filter(Boolean)
        .join(' ');

      return source.toLowerCase().includes(needle) || fuzzyMatch(source, query);
    });
    // Cap rendered rows so huge command lists stay responsive.
    return matches.slice(0, MAX_VISIBLE_COMMANDS);
  }, [commands, query]);

  // Clamp the selection whenever the list shrinks; the active descendant id
  // below is derived from the clamped index so no setState-in-updater occurs.
  useEffect(() => {
    setSelectedIndex((current) =>
      filteredCommands.length === 0 ? 0 : Math.min(current, filteredCommands.length - 1),
    );
  }, [filteredCommands.length]);

  const activeId = filteredCommands[selectedIndex]?.id;

  const handleSelect = useCallback(
    (command: CommandPaletteCommand) => {
      command.perform();
      onCloseRef.current();
    },
    [],
  );

  // Latest list/selection refs so the key handler stays subscribed once per
  // open state instead of re-subscribing on every keystroke/selection change.
  const filteredRef = useRef(filteredCommands);
  filteredRef.current = filteredCommands;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const list = filteredRef.current;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => (list.length === 0 ? 0 : Math.min(current + 1, list.length - 1)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        const selected = list[selectedRef.current];
        if (selected) {
          event.preventDefault();
          handleSelect(selected);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleSelect]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Command Palette"
      className="rounded-3xl"
    >
      <div className="space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            id={inputId}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-label="Search commands"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // Reset selection to the top on every new query.
              setSelectedIndex(0);
            }}
            placeholder="Search commands, tools, or locations"
            className="w-full rounded-2xl border border-gray-200 bg-gray-50 pl-11 pr-4 py-3 text-sm outline-none focus:border-blue-500 focus:bg-white"
          />
        </div>

        {!query && recentActions.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-[11px] font-black text-gray-400 uppercase tracking-[0.24em] mb-2">
              Recent Actions
            </p>
            <div className="flex flex-wrap gap-2">
              {recentActions.slice(-5).reverse().map((action, index) => (
                <span
                  key={action + '-' + index}
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600 border border-gray-200"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        )}

        <div
          id={listboxId}
          role="listbox"
          aria-label="Commands"
          className="space-y-2 max-h-[50vh] overflow-y-auto"
        >
          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
              No matching command.
            </div>
          )}

          {filteredCommands.map((command, index) => (
            <button
              key={command.id}
              id={command.id}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => handleSelect(command)}
              onMouseEnter={() => {
                setSelectedIndex(index);
              }}
              className={'w-full rounded-2xl border px-4 py-3 text-left transition-colors ' + (
                index === selectedIndex
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
              )}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{command.title}</p>
                {command.subtitle && (
                  <p className="text-xs text-gray-500 mt-1">{command.subtitle}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
