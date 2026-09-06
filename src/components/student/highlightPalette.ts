export type StudentHighlightColor = 'yellow' | 'amber' | 'green' | 'blue' | 'purple';

export interface StudentHighlightPaletteEntry {
  id: StudentHighlightColor;
  label: string;
  swatchClassName: string;
  highlightClassName: string;
  highlightColorValue: string;
}

export const studentHighlightPalette: StudentHighlightPaletteEntry[] = [
  {
    id: 'yellow',
    label: 'Yellow',
    swatchClassName: 'bg-amber-200',
    highlightClassName: 'rounded-sm bg-amber-200 text-gray-900',
    highlightColorValue: '#e8cd95',
  },
  // S1-M5: id/label previously mismatched (pink swatch behind the Amber
  // name). Amber now renders a true amber ramp so the label, swatch, mark,
  // and selection color agree.
  {
    id: 'amber',
    label: 'Amber',
    swatchClassName: 'bg-amber-300',
    highlightClassName: 'rounded-sm bg-amber-300 text-gray-900',
    highlightColorValue: '#f2c14e',
  },
  {
    id: 'green',
    label: 'Green',
    swatchClassName: 'bg-green-200',
    highlightClassName: 'rounded-sm bg-green-200 text-gray-900',
    highlightColorValue: '#b9d6c3',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatchClassName: 'bg-blue-200',
    highlightClassName: 'rounded-sm bg-blue-200 text-gray-900',
    highlightColorValue: '#b3d3f1',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatchClassName: 'bg-purple-200',
    highlightClassName: 'rounded-sm bg-purple-200 text-gray-900',
    highlightColorValue: '#d5c7e2',
  },
];

export const defaultStudentHighlightColor: StudentHighlightColor = 'yellow';

export function getStudentHighlightPaletteEntry(
  color: StudentHighlightColor,
): StudentHighlightPaletteEntry {
  return studentHighlightPalette.find((entry) => entry.id === color) ?? studentHighlightPalette[0]!;
}

export function getStudentHighlightClassName(color: StudentHighlightColor): string {
  return getStudentHighlightPaletteEntry(color).highlightClassName;
}

export function getStudentHighlightColorValue(color: StudentHighlightColor): string {
  return getStudentHighlightPaletteEntry(color).highlightColorValue;
}
