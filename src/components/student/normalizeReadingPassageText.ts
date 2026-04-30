export function normalizeReadingPlainTextForDisplay(content: string): string {
  if (!content) {
    return '';
  }

  const normalizedContent = content
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');

  const paragraphs = normalizedContent
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);

  return paragraphs.join('\n\n');
}
