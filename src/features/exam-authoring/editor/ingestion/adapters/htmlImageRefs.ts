/**
 * Extract image references from pasted HTML before structural sanitization.
 * Image bytes are fetched and validated separately before upload.
 */
export interface HtmlImageRef {
  src: string;
  alt: string;
}

export interface HtmlImageRefsOutcome {
  refs: HtmlImageRef[];
  truncated: number;
}

export const MAX_HTML_IMAGES = 5;

export function extractHtmlImageRefs(
  html: string,
  maxImages = MAX_HTML_IMAGES
): HtmlImageRefsOutcome {
  if (!html.trim() || maxImages <= 0) return { refs: [], truncated: 0 };
  let body: HTMLElement;
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    if (!parsed.body) return { refs: [], truncated: 0 };
    body = parsed.body;
  } catch {
    return { refs: [], truncated: 0 };
  }

  const refs: HtmlImageRef[] = [];
  const seen = new Set<string>();
  let truncated = 0;
  for (const element of Array.from(body.querySelectorAll("img"))) {
    const src = element.getAttribute("src")?.trim() ?? "";
    if (!src || seen.has(src)) continue;
    seen.add(src);
    if (refs.length >= maxImages) {
      truncated += 1;
      continue;
    }
    refs.push({ src, alt: element.getAttribute("alt")?.trim() ?? "" });
  }
  return { refs, truncated };
}
