import { sanitizeHtml } from '../../utils/sanitizeHtml';

const FONT_STYLE_PROPERTIES = ['font-family', 'font-size', 'line-height'] as const;
const LINE_WRAPPING_STYLE_PROPERTIES = [
  'white-space',
  'word-break',
  'overflow-wrap',
  'word-wrap',
  'line-break',
  'hyphens',
  '-webkit-hyphens',
  'word-spacing',
  'letter-spacing',
] as const;

function unwrapFontElements(container: HTMLTemplateElement): void {
  const fontElements = Array.from(container.content.querySelectorAll('font'));
  fontElements.forEach((fontElement) => {
    const parent = fontElement.parentNode;
    if (!parent) {
      return;
    }

    while (fontElement.firstChild) {
      parent.insertBefore(fontElement.firstChild, fontElement);
    }
    parent.removeChild(fontElement);
  });
}

function stripTypographyStyleOverrides(
  container: HTMLTemplateElement,
  options: { normalizeJustifiedText?: boolean; normalizeLineWrapping?: boolean },
): void {
  container.content.querySelectorAll<HTMLElement>('*[style]').forEach((element) => {
    FONT_STYLE_PROPERTIES.forEach((property) => {
      element.style.removeProperty(property);
    });

    if (options.normalizeLineWrapping) {
      LINE_WRAPPING_STYLE_PROPERTIES.forEach((property) => {
        element.style.removeProperty(property);
      });
    }

    // ACT passage content is sometimes pasted from Word with justified
    // paragraphs. That spreads spaces across the full iPad pane and makes the
    // passage hard to scan. Preserve deliberate left/center/right alignment,
    // but normalize justified text for ACT student delivery.
    if (options.normalizeJustifiedText && element.style.textAlign.toLowerCase() === 'justify') {
      element.style.textAlign = 'left';
    }

    if (element.style.length === 0) {
      element.removeAttribute('style');
    }
  });

  if (options.normalizeJustifiedText) {
    container.content.querySelectorAll<HTMLElement>('[align]').forEach((element) => {
      if (element.getAttribute('align')?.trim().toLowerCase() === 'justify') {
        element.setAttribute('align', 'left');
      }
    });
  }
}

export function sanitizeReadingPassageHtml(
  html: string,
  options: { normalizeJustifiedText?: boolean; normalizeLineWrapping?: boolean } = {},
): string {
  const sanitized = sanitizeHtml(html);
  if (typeof document === 'undefined') {
    return sanitized;
  }

  const template = document.createElement('template');
  template.innerHTML = sanitized;

  unwrapFontElements(template);
  stripTypographyStyleOverrides(template, options);

  return template.innerHTML;
}
