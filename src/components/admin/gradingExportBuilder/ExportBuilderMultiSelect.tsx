import React from 'react';
import { ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';

export interface ExportBuilderMultiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ExportBuilderMultiSelectProps {
  id: string;
  label: string;
  value: readonly string[];
  options: readonly ExportBuilderMultiSelectOption[];
  disabled: boolean;
  onChange: (value: readonly string[]) => void;
}

function summaryLabel(
  label: string,
  value: readonly string[],
  options: readonly ExportBuilderMultiSelectOption[],
): string {
  if (value.length === 0) return `Any ${label.toLowerCase()}`;
  if (value.length > 1) return `${value.length} selected`;
  return options.find((option) => option.value === value[0])?.label ?? '1 selected';
}

export function ExportBuilderMultiSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: ExportBuilderMultiSelectProps) {
  const selected = new Set(value);

  const toggleOption = (optionValue: string) => {
    onChange(selected.has(optionValue)
      ? value.filter((currentValue) => currentValue !== optionValue)
      : [...value, optionValue]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} filter`}
          disabled={disabled}
          data-filter-control={id}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-sm border border-gray-200 bg-white px-3 text-left shadow-sm transition hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</span>
            <span className="mt-0.5 block truncate text-sm font-medium text-gray-800">
              {summaryLabel(label, value, options)}
            </span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        collisionPadding={12}
        className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1.5rem)] border-gray-200 bg-white text-gray-900 shadow-lg"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.length === 0 ? (
          <DropdownMenuLabel className="font-normal text-muted-foreground">No options available</DropdownMenuLabel>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.has(option.value)}
              onCheckedChange={() => toggleOption(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
