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

function normalizePlainTextPreservingLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
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

function normalizeHtmlTextInput(content: string | null | undefined): string {
  return typeof content === 'string' ? content : '';
}

export function htmlToPlainText(content: string | null | undefined): string {
  const safeContent = normalizeHtmlTextInput(content);

  if (!HTML_TAG_PATTERN.test(safeContent)) {
    return normalizePlainText(decodeEntities(safeContent));
  }

  const contentWithBreaks = safeContent
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

export function htmlToPlainTextPreserveLineBreaks(content: string | null | undefined): string {
  const safeContent = normalizeHtmlTextInput(content);

  if (!HTML_TAG_PATTERN.test(safeContent)) {
    return normalizePlainTextPreservingLineBreaks(decodeEntities(safeContent));
  }

  const contentWithBreaks = safeContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(BLOCK_BREAK_PATTERN, '\n')
    .replace(/<li\b[^>]*>/gi, '\n');

  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = contentWithBreaks;
    return normalizePlainTextPreservingLineBreaks(template.content.textContent ?? '').replace(/\n+$/g, '');
  }

  return normalizePlainTextPreservingLineBreaks(
    decodeEntities(contentWithBreaks.replace(/<[^>]+>/g, '')),
  ).replace(/\n+$/g, '');
}
