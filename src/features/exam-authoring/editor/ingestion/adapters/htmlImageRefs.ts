/**
 * Extract image references from pasted HTML before structural sanitization.
 * Image bytes are fetched and validated separately before upload.
 */
export interface HtmlImageRef {
  /** Stable within one paste; used to reconnect the fetched file to the AST. */
  refId?: string;
  src: string;
  alt: string;
}

export interface HtmlImageRefsOutcome {
  refs: HtmlImageRef[];
  truncated: number;
}

export interface MarkHtmlImageRefsOutcome {
  html: string;
  refs: HtmlImageRef[];
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
    refs.push({
      refId: "html-image-" + String(refs.length),
      src,
      alt: element.getAttribute("alt")?.trim() ?? "",
    });
  }
  return { refs, truncated };
}

/**
 * Replace only the extracted image elements with inert, sanitizer-approved
 * markers. The original src never reaches the structural HTML parser.
 */
export function markHtmlImageRefs(html: string, refs: readonly HtmlImageRef[]): string {
  return markHtmlImageRefsWithOccurrences(html, refs).html;
}

/**
 * Marks every occurrence while keeping one fetch reference per unique source.
 * Repeated occurrences receive distinct IDs so each inserted node gets its own
 * upload lifecycle even when the source URL is reused.
 */
export function markHtmlImageRefsWithOccurrences(
  html: string,
  refs: readonly HtmlImageRef[]
): MarkHtmlImageRefsOutcome {
  if (!html.trim() || refs.length === 0) return { html, refs: [] };
  let body: HTMLElement;
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    if (!parsed.body) return { html, refs: [] };
    body = parsed.body;
  } catch {
    return { html, refs: [] };
  }

  const bySource = new Map<string, HtmlImageRef>();
  for (const ref of refs) {
    if (ref.refId) bySource.set(ref.src, ref);
  }
  // Do not trust a marker supplied by the clipboard payload. Only markers
  // created by this function may carry a reference into the fetched-image map.
  for (const element of Array.from(body.querySelectorAll("[data-sat-image-ref]"))) {
    element.removeAttribute("data-sat-image-ref");
  }
  const occurrences = new Map<string, number>();
  const markerRefs: HtmlImageRef[] = [];
  for (const element of Array.from(body.querySelectorAll("img"))) {
    const src = element.getAttribute("src")?.trim() ?? "";
    const ref = bySource.get(src);
    if (!ref?.refId) continue;
    const occurrence = occurrences.get(src) ?? 0;
    occurrences.set(src, occurrence + 1);
    const refId = occurrence === 0 ? ref.refId : ref.refId + "-occurrence-" + String(occurrence);
    const marker = body.ownerDocument.createElement("span");
    marker.setAttribute("data-sat-image-ref", refId);
    element.replaceWith(marker);
    markerRefs.push({
      refId,
      src: ref.src,
      alt: element.getAttribute("alt")?.trim() ?? ref.alt,
    });
  }
  return { html: body.innerHTML, refs: markerRefs };
}
