function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hasHtmlMarkup(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function normalizeLineContent(line: string): string {
  return line.replace(/[ \t\f\v]+/g, ' ').trim();
}

function looksLikeHeading(line: string): boolean {
  if (line.length < 3 || line.length > 72) {
    return false;
  }

  if (/[.!?]$/.test(line)) {
    return false;
  }

  const alphaOnly = line.replace(/[^A-Za-z]/g, '');
  if (alphaOnly.length < 3) {
    return false;
  }

  const uppercaseRatio = (alphaOnly.match(/[A-Z]/g)?.length ?? 0) / alphaOnly.length;
  const startsWithUpper = /^[A-Z0-9]/.test(line);
  const titleCaseLike = /^([A-Z][a-z0-9'’.-]*)(\s+[A-Z][a-z0-9'’.-]*)*$/.test(line);

  return startsWithUpper && (uppercaseRatio >= 0.62 || titleCaseLike);
}

function splitLongParagraph(text: string): string[] {
  const normalized = normalizeLineContent(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= 360) {
    return [normalized];
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 2) {
    return [normalized];
  }

  const paragraphs: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    const shouldBreak = buffer.length >= 240 && candidate.length >= 320;

    if (shouldBreak) {
      paragraphs.push(buffer);
      buffer = sentence;
      continue;
    }

    buffer = candidate;
  }

  if (buffer) {
    paragraphs.push(buffer);
  }

  return paragraphs;
}

interface StructuredBlock {
  kind: 'heading' | 'paragraph';
  text: string;
}

function toStructuredParagraphBlocks(content: string): StructuredBlock[] {
  const normalizedContent = content
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (!normalizedContent) {
    return [];
  }

  const explicitParagraphs = normalizedContent
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map(normalizeLineContent)
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);

  if (explicitParagraphs.length > 1) {
    return explicitParagraphs.map((text) => ({
      kind: looksLikeHeading(text) ? 'heading' : 'paragraph',
      text,
    }));
  }

  const singleBlockLines = normalizedContent
    .split('\n')
    .map(normalizeLineContent)
    .filter(Boolean);

  if (singleBlockLines.length <= 1) {
    return splitLongParagraph(singleBlockLines[0] ?? '').map((text) => ({ kind: 'paragraph', text }));
  }

  const blocks: StructuredBlock[] = [];
  let paragraphBuffer = '';

  const flushParagraphBuffer = () => {
    if (!paragraphBuffer) {
      return;
    }

    splitLongParagraph(paragraphBuffer).forEach((chunk) => {
      blocks.push({ kind: 'paragraph', text: chunk });
    });
    paragraphBuffer = '';
  };

  singleBlockLines.forEach((line, index) => {
    if (looksLikeHeading(line)) {
      flushParagraphBuffer();
      blocks.push({ kind: 'heading', text: line });
      return;
    }

    paragraphBuffer = paragraphBuffer ? `${paragraphBuffer} ${line}` : line;

    const nextLine = singleBlockLines[index + 1];
    if (!nextLine) {
      return;
    }

    if (paragraphBuffer.length >= 420 && looksLikeHeading(nextLine)) {
      flushParagraphBuffer();
    }
  });

  flushParagraphBuffer();

  return blocks;
}

export function normalizeReadingPlainTextForDisplay(content: string): string {
  if (!content) {
    return '';
  }

  const blocks = toStructuredParagraphBlocks(content);
  if (blocks.length === 0) {
    return '';
  }

  return blocks
    .map((block) => {
      if (block.kind === 'heading') {
        return `<h3>${escapeHtml(block.text)}</h3>`;
      }

      return `<p>${escapeHtml(block.text)}</p>`;
    })
    .join('');
}

function htmlToPlainText(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blockTexts = collectLeafReadableBlocks(doc.body)
      .map((node) => normalizeLineContent(node.textContent ?? ''))
      .filter(Boolean);

    if (blockTexts.length > 0) {
      return blockTexts.join('\n\n');
    }

    return normalizeLineContent(doc.body.textContent ?? '');
  }

  return normalizeLineContent(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|pre)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' '),
  );
}

export function normalizeReadingContentForHighlightText(content: string): string {
  if (!content) {
    return '';
  }

  if (hasHtmlMarkup(content)) {
    return htmlToPlainText(content);
  }

  const blocks = toStructuredParagraphBlocks(content);
  return blocks.map((block) => block.text).join('\n\n');
}

function inlineWrapWithMarkers(text: string, markerState: { bold: boolean; italic: boolean }): string {
  if (!text) {
    return '';
  }

  if (markerState.bold && markerState.italic) {
    return `***${text}***`;
  }
  if (markerState.bold) {
    return `**${text}**`;
  }
  if (markerState.italic) {
    return `*${text}*`;
  }
  return text;
}

function hasBoldStyle(styleValue: string | null): boolean {
  if (!styleValue) {
    return false;
  }
  const normalized = styleValue.toLowerCase();
  if (/font-weight\s*:\s*(bold|bolder)/.test(normalized)) {
    return true;
  }
  const numericMatch = normalized.match(/font-weight\s*:\s*([1-9]00)/);
  if (!numericMatch) {
    return false;
  }
  const numericWeight = Number.parseInt(numericMatch[1], 10);
  return Number.isFinite(numericWeight) && numericWeight >= 600;
}

function hasItalicStyle(styleValue: string | null): boolean {
  if (!styleValue) {
    return false;
  }
  return /font-style\s*:\s*(italic|oblique)/i.test(styleValue);
}

function hasBoldClass(className: string): boolean {
  if (!className) {
    return false;
  }
  return /\b(ql-bold|font-bold|fw-bold)\b/i.test(className);
}

function hasItalicClass(className: string): boolean {
  if (!className) {
    return false;
  }
  return /\b(ql-italic|italic|font-italic|fst-italic)\b/i.test(className);
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const RICH_TEXT_BLOCK_SELECTOR =
  'p,div,section,article,li,h1,h2,h3,h4,h5,h6,blockquote,pre';

function collectLeafReadableBlocks(root: ParentNode): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll(RICH_TEXT_BLOCK_SELECTOR));
  return candidates.filter((candidate) => !candidate.querySelector(RICH_TEXT_BLOCK_SELECTOR));
}

function htmlToMarkedText(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return htmlToPlainText(html);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const renderNode = (
    node: Node,
    markerState: { bold: boolean; italic: boolean },
  ): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = normalizeInlineText(node.textContent ?? '');
      return inlineWrapWithMarkers(value, markerState);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const className = element.className ?? '';
    const styleValue = element.getAttribute('style');
    const nextState = {
      bold: markerState.bold || tag === 'strong' || tag === 'b' || hasBoldStyle(styleValue) || hasBoldClass(className),
      italic:
        markerState.italic ||
        tag === 'em' ||
        tag === 'i' ||
        hasItalicStyle(styleValue) ||
        hasItalicClass(className),
    };

    if (tag === 'br') {
      return '\n';
    }

    const children = Array.from(element.childNodes)
      .map((child) => renderNode(child, nextState))
      .filter(Boolean);

    const joined = children.join('').replace(/[ \t\f\v]+/g, ' ');
    return joined;
  };

  const blocks = collectLeafReadableBlocks(doc.body)
    .map((node) => renderNode(node, { bold: false, italic: false }))
    .filter(Boolean);

  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }

  return renderNode(doc.body, { bold: false, italic: false });
}

export function normalizeReadingContentForHighlightedFormattedText(content: string): string {
  if (!content) {
    return '';
  }

  if (hasHtmlMarkup(content)) {
    return htmlToMarkedText(content);
  }

  return normalizeReadingContentForHighlightText(content);
}
