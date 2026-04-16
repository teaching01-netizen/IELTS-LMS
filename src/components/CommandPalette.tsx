import React, { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    return commands.filter((command) => {
      const source = [command.title, command.subtitle, command.category, ...(command.keywords ?? [])]
        .filter(Boolean)
        .join(' ');

      return source.toLowerCase().includes(query.toLowerCase()) || fuzzyMatch(source, query);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, filteredCommands.length - 1));
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
      }

      if (event.key === 'Enter') {
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          selected.perform();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredCommands, isOpen, onClose, selectedIndex]);

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
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
                  key={`${action}-${index}`}
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600 border border-gray-200"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
              No matching command.
            </div>
          )}

          {filteredCommands.map((command, index) => (
            <button
              key={command.id}
              onClick={() => {
                command.perform();
                onClose();
              }}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                index === selectedIndex
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
              }`}
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
