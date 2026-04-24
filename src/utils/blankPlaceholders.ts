export function countBlankPlaceholders(text: string): number {
  if (!text) return 0;
  return text.match(/_{2,}/g)?.length ?? 0;
}

