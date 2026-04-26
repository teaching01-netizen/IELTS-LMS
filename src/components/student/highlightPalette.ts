export type StudentHighlightColor = 'yellow' | 'amber' | 'green' | 'blue';

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
    highlightClassName: 'rounded-sm bg-yellow-200/80 px-0.5 text-gray-900',
    highlightColorValue: '#fde68a',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatchClassName: 'bg-amber-200',
    highlightClassName: 'rounded-sm bg-amber-200/80 px-0.5 text-gray-900',
    highlightColorValue: '#fdba74',
  },
  {
    id: 'green',
    label: 'Green',
    swatchClassName: 'bg-emerald-200',
    highlightClassName: 'rounded-sm bg-emerald-200/80 px-0.5 text-gray-900',
    highlightColorValue: '#a7f3d0',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatchClassName: 'bg-sky-200',
    highlightClassName: 'rounded-sm bg-sky-200/80 px-0.5 text-gray-900',
    highlightColorValue: '#bae6fd',
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
