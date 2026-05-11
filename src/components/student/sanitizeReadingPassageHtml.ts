import { sanitizeHtml } from '../../utils/sanitizeHtml';

const FONT_STYLE_PROPERTIES = ['font-family', 'font-size', 'line-height'] as const;

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

function stripTypographyStyleOverrides(container: HTMLTemplateElement): void {
  container.content.querySelectorAll<HTMLElement>('*[style]').forEach((element) => {
    FONT_STYLE_PROPERTIES.forEach((property) => {
      element.style.removeProperty(property);
    });

    if (element.style.length === 0) {
      element.removeAttribute('style');
    }
  });
}

export function sanitizeReadingPassageHtml(html: string): string {
  const sanitized = sanitizeHtml(html);
  if (typeof document === 'undefined') {
    return sanitized;
  }

  const template = document.createElement('template');
  template.innerHTML = sanitized;

  unwrapFontElements(template);
  stripTypographyStyleOverrides(template);

  return template.innerHTML;
}
