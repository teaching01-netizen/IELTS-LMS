const DESMOS_ORIGIN = "https://www.desmos.com";

export function ensureDesmosPreconnect(documentRef: Document = document): void {
  const head = documentRef.head;
  if (!head) return;

  const existing = head.querySelector<HTMLLinkElement>(
    `link[rel="preconnect"][href="${DESMOS_ORIGIN}"]`
  );
  if (existing) return;

  const link = documentRef.createElement("link");
  link.rel = "preconnect";
  link.href = DESMOS_ORIGIN;
  link.crossOrigin = "anonymous";
  link.dataset["satDesmosPreconnect"] = "true";
  head.append(link);
}
