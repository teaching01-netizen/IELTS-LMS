/**
 * Phase 02 — Word / Google Docs vendor-chrome pre-pass.
 *
 * Runs BEFORE the generic parser and returns still-generic HTML: detection
 * first (deterministic regex signals), then DOM-based stripping of vendor
 * wrappers. Semantic tags are kept as-is; mso-list fake bullets and
 * footnote refs are kept as text plus a diagnostic (restructuring them is
 * out of scope). Lives in adapters/ (needs host DOM).
 */
import type { ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";

export type VendorKind = "word" | "gdocs" | "none";

export interface VendorSignal {
  vendor: VendorKind;
  evidence: string[];
}

export interface VendorChromeOutcome {
  html: string;
  signal: VendorSignal;
  warnings: ImportWarning[];
  transformations: string[];
}

const WORD_RE = /MsoNormal|mso-|schemas-microsoft|<o:p|if\s+gte\s+mso/i;
const GDOCS_RE = /docs-internal-guid/i;

export function detectVendor(html: string): VendorSignal {
  if (WORD_RE.test(html)) return { vendor: "word", evidence: ["mso-marker"] };
  if (GDOCS_RE.test(html)) return { vendor: "gdocs", evidence: ["docs-internal-guid"] };
  return { vendor: "none", evidence: [] };
}

function unwrap(el: Element, counter: { stripped: number }): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  counter.stripped += 1;
}

export function stripVendorChrome(html: string, signal: VendorSignal): VendorChromeOutcome {
  const warnings: ImportWarning[] = [];
  const transformations: string[] = [];
  if (signal.vendor === "none" || html.trim().length === 0) {
    return { html, signal, warnings, transformations };
  }
  let body: HTMLElement;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.body) return { html, signal, warnings, transformations };
    body = doc.body;
  } catch {
    return { html, signal, warnings, transformations };
  }
  const counter = { stripped: 0 };

  if (signal.vendor === "word") {
    for (const el of Array.from(body.querySelectorAll("*"))) {
      const tag = el.tagName.toLowerCase();
      if (tag === "o:p" || tag.includes(":")) unwrap(el, counter);
    }
    for (const el of Array.from(body.querySelectorAll("*"))) {
      const cls = el.getAttribute("class") ?? "";
      const style = el.getAttribute("style") ?? "";
      if (/MsoNormal|MsoListParagraph/i.test(cls)) {
        el.removeAttribute("class");
        counter.stripped += 1;
      }
      if (/mso-/i.test(style)) {
        el.removeAttribute("style");
        counter.stripped += 1;
      }
    }
  }

  if (signal.vendor === "gdocs") {
    const guid = body.querySelector("#docs-internal-guid");
    if (guid) unwrap((guid.closest("b") ?? guid) as Element, counter);
    for (const el of Array.from(body.querySelectorAll("*"))) {
      const cls = el.getAttribute("class") ?? "";
      if (/\bc\d+\b/.test(cls)) {
        el.removeAttribute("class");
        counter.stripped += 1;
      }
      if (el.getAttribute("id") === "docs-internal-guid") {
        el.removeAttribute("id");
        counter.stripped += 1;
      }
    }
  }

  if (counter.stripped > 0) {
    transformations.push("vendor." + signal.vendor + "-chrome-removed:" + counter.stripped);
    warnings.push({
      code: "import.style.stripped",
      message: DIAGNOSTIC_MESSAGES["import.style.stripped"],
      count: counter.stripped,
    });
  }
  return { html: body.innerHTML, signal, warnings, transformations };
}
