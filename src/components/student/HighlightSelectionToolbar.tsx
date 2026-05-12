import React from 'react';
import {
  studentHighlightPalette,
  type StudentHighlightColor,
} from './highlightPalette';

interface HighlightSelectionToolbarProps {
  visible: boolean;
  left: number;
  top: number;
  canEraseSelection: boolean;
  onApplyColor: (color: StudentHighlightColor) => void;
  onEraseSelection: () => void;
}

export function HighlightSelectionToolbar({
  visible,
  left,
  top,
  canEraseSelection,
  onApplyColor,
  onEraseSelection,
}: HighlightSelectionToolbarProps) {
  if (!visible) {
    return null;
  }

  const preserveSelection = (event: React.SyntheticEvent) => {
    event.preventDefault();
  };

  return (
    <div
      className="fixed z-[95] -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white p-1.5 shadow-2xl"
      style={{ left, top: top - 12 }}
      role="toolbar"
      aria-label="Highlight selection actions"
      onMouseDown={preserveSelection}
      onMouseDownCapture={preserveSelection}
      onPointerDown={preserveSelection}
      onPointerDownCapture={preserveSelection}
      onTouchStart={preserveSelection}
      onTouchStartCapture={preserveSelection}
    >
      <div className="flex items-center gap-1">
        {studentHighlightPalette.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onMouseDown={preserveSelection}
            onPointerDown={preserveSelection}
            onTouchStart={preserveSelection}
            onClick={() => onApplyColor(entry.id)}
            className={`h-7 w-7 rounded-full border border-gray-200 ${entry.swatchClassName}`}
            aria-label={`Apply ${entry.label} highlight`}
            title={entry.label}
          />
        ))}
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <button
          type="button"
          onMouseDown={preserveSelection}
          onPointerDown={preserveSelection}
          onTouchStart={preserveSelection}
          onClick={onEraseSelection}
          disabled={!canEraseSelection}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Remove highlight from selection"
          title="Remove highlight"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
