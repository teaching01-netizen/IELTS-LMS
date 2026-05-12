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
    swatchClassName: 'bg-yellow-200',
    highlightClassName: 'rounded-sm bg-yellow-200/80 text-gray-900',
    highlightColorValue: '#fde68a',
  },
  {
    id: 'amber',
    label: 'Pink',
    swatchClassName: 'bg-pink-200',
    highlightClassName: 'rounded-sm bg-pink-200/80 text-gray-900',
    highlightColorValue: '#f9a8d4',
  },
  {
    id: 'green',
    label: 'Green',
    swatchClassName: 'bg-emerald-200',
    highlightClassName: 'rounded-sm bg-emerald-200/80 text-gray-900',
    highlightColorValue: '#a7f3d0',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatchClassName: 'bg-sky-200',
    highlightClassName: 'rounded-sm bg-sky-200/80 text-gray-900',
    highlightColorValue: '#bae6fd',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatchClassName: 'bg-violet-200',
    highlightClassName: 'rounded-sm bg-violet-200/80 text-gray-900',
    highlightColorValue: '#ddd6fe',
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
