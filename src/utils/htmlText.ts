const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;
const BLOCK_BREAK_PATTERN =
  /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi;

function normalizePlainText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(content: string): string {
  if (!HTML_TAG_PATTERN.test(content)) {
    return normalizePlainText(decodeEntities(content));
  }

  const contentWithBreaks = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(BLOCK_BREAK_PATTERN, '\n')
    .replace(/<li\b[^>]*>/gi, '\n');

  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = contentWithBreaks;
    return normalizePlainText(template.content.textContent ?? '');
  }

  return normalizePlainText(
    decodeEntities(contentWithBreaks.replace(/<[^>]+>/g, '')),
  );
}
