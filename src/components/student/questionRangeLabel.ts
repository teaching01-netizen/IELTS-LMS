export function formatQuestionRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}–${end}`;
}
