import DOMPurify from 'dompurify';
import { normalizeImageUrl } from './imageUrl';

/**
 * Schemes allowed in href/src after sanitization. Everything else (notably
 * `javascript:`/`vbscript:` and `data:text/html`) is stripped so a
 * validate-then-sanitize gap cannot smuggle an executable URL through.
 */
const ALLOWED_URI_PATTERN = /^(?:(?:https?|mailto|tel|data:image\/(?:png|gif|jpeg|webp|svg\+xml)):[^\s]*|[^a-zA-Z0-9+.-]*#[^\s]*|\/[^\s]*|[^\s:/?#]+(?:[^\s]*))$/i;

function scrubUnsafeUrlAttributes(root: DocumentFragment): void {
  root.querySelectorAll('[href],[src],[xlink\\:href]').forEach((element) => {
    for (const attribute of ['href', 'src', 'xlink:href']) {
      const raw = element.getAttribute(attribute);
      if (raw === null) continue;
      const value = raw.trim();
      if (value.length > 0 && !ALLOWED_URI_PATTERN.test(value)) {
        element.removeAttribute(attribute);
      }
    }
  });
}

function normalizeSanitizedImageSources(html: string): string {
  if (typeof document === 'undefined') {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  // normalizeImageUrl maps javascript:/vbscript:/data:text/html to ''; an
  // empty src is removed so the attribute cannot be revived into a payload by
  // later string handling.
  template.content.querySelectorAll('img[src]').forEach((image) => {
    const source = image.getAttribute('src') ?? '';
    const normalized = normalizeImageUrl(source);
    if (normalized) {
      image.setAttribute('src', normalized);
    } else {
      image.removeAttribute('src');
    }
  });
  scrubUnsafeUrlAttributes(template.content);

  return template.innerHTML;
}

/**
 * Sanitize untrusted HTML for dangerouslySetInnerHTML sinks.
 *
 * Ordering guarantee (validate BEFORE sanitize OR re-sanitize after): the raw
 * input is first passed through DOMPurify (which strips scripts, event
 * handlers, and javascript: URLs), and the result is then RE-SANITIZED after
 * the image-source normalization step rewrites `src` attributes — so a
 * validator/normalizer running between the two passes cannot reintroduce an
 * executable URL into already-sanitized markup.
 */
export function sanitizeHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });

  const normalized = normalizeSanitizedImageSources(sanitized);

  // Re-sanitize after rewriting attributes: any URL the normalizer produced
  // (Drive thumbnail/http) is allowlisted, anything executable is dropped.
  return DOMPurify.sanitize(normalized, {
    USE_PROFILES: { html: true },
  });
}
