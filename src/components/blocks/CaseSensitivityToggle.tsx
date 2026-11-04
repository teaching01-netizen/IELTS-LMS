import React from 'react';
import type { CaseSensitivity } from '../../types';

interface CaseSensitivityToggleProps extends CaseSensitivity {
  /** True = exact case required (default). False = opt-out insensitive. */
  onChange: (caseSensitive: boolean | undefined) => void;
  label?: string | undefined;
}

export function CaseSensitivityToggle({
  caseSensitive,
  onChange,
  label = 'Require exact capitalization',
}: CaseSensitivityToggleProps) {
  const checked = caseSensitive !== false;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600" title="When off, letter case is ignored for this answer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? undefined : false)}
        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        aria-label={label}
      />
      {label}
    </label>
  );
}
