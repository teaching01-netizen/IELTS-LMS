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
    highlightClassName: 'rounded-sm bg-amber-100 text-gray-900',
    highlightColorValue: '#f3e6c8',
  },
  {
    id: 'amber',
    label: 'Pink',
    swatchClassName: 'bg-pink-200',
    highlightClassName: 'rounded-sm bg-pink-100 text-gray-900',
    highlightColorValue: '#f6dfec',
  },
  {
    id: 'green',
    label: 'Green',
    swatchClassName: 'bg-green-200',
    highlightClassName: 'rounded-sm bg-green-100 text-gray-900',
    highlightColorValue: '#dcebe1',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatchClassName: 'bg-blue-200',
    highlightClassName: 'rounded-sm bg-blue-100 text-gray-900',
    highlightColorValue: '#d9e9f8',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatchClassName: 'bg-purple-200',
    highlightClassName: 'rounded-sm bg-purple-100 text-gray-900',
    highlightColorValue: '#eae3f0',
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
