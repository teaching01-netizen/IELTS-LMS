/**
 * A starting description for an image, derived from the name it arrived with.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sat.accessibility.alt.required` is a BLOCKING publish rule
 * (backend/go/internal/authoring/readiness.go, mirrored by the SAT provider
 * validator), so an image that reaches a question with empty alt text cannot be
 * published until an author types a description. That turned every upload into
 * a second, unrelated task. Filling the description at upload time keeps the
 * gate satisfied without the author doing that work, and the field stays
 * editable for anyone who wants to write something better.
 *
 * The name is a hint, not a description: `supply-demand-curve.png` says
 * "Supply demand curve", while camera and OS names (`IMG_2384.png`,
 * `Screenshot 2026-09-25 at 10.32.11.png`) carry no information at all and fall
 * back to a neutral label rather than leaking a meaningless string into the
 * published question.
 *
 * Casing comes from the name itself, so acronyms survive (`GDP-per-capita.png`
 * says "GDP per capita"); only a leading letter is capitalised.
 *
 * Pure by construction: no React, no TipTap, no host globals — the same rule
 * every other `ingestion/domain` module follows, so the naming rules can be
 * tested on their own.
 */

/** What an image is called when its name carries no usable words. */
export const ALT_TEXT_FALLBACK = "Image";

/** Descriptions are sentences, not documents. */
const MAX_ALT_TEXT_LENGTH = 200;

/**
 * Tokens that appear in a file name because of the camera, the OS, or the
 * export step — never because of what the picture shows.
 */
const NOISE_TOKENS = new Set([
  "img", "image", "images", "photo", "photos", "picture", "pictures", "pic", "pics",
  "screenshot", "screenshots", "screen", "shot", "shots", "capture", "captures",
  "scan", "scans", "scanned", "untitled", "download", "downloads", "file", "files",
  "temp", "tmp", "clipboard", "dsc", "dscn", "dscf", "export", "exported", "copy",
  "final", "new", "edit",
]);

/**
 * Words that only connect others. They can never make a name meaningful —
 * `Screenshot 2026-09-25 at 10.32.11` is still nameless — and they are dropped
 * when they would LEAD the description, where they carry no meaning at all.
 */
const CONNECTIVE_TOKENS = new Set(["of", "the", "and", "with", "at", "a", "an", "for", "to"]);

/** The last segment of a file name, path, or URL, without query or extension. */
function namePart(source: string): string {
  const withoutQuery = String(source ?? "").split(/[?#]/)[0] ?? "";
  const segment = withoutQuery.split(/[\\/]/).pop() ?? "";
  return segment.replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

function tokensOf(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // supplyDemand -> supply Demand
    .replace(/[_+.]+/g, " ")
    .replace(/-+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Camera and export names number themselves: `dsc00042`, `img2384`. */
function isNoise(token: string): boolean {
  return NOISE_TOKENS.has(token.toLowerCase().replace(/\d+$/, ""));
}

function isDescriptive(token: string): boolean {
  if (!/[A-Za-z]/.test(token)) return false; // pure numbers, date and time runs
  return !isNoise(token) && !CONNECTIVE_TOKENS.has(token.toLowerCase());
}

/**
 * Best available alt text for a file name, path, or URL. Never empty — the
 * fallback is what keeps the publish gate satisfied for a nameless source.
 */
export function suggestAltText(source: string): string {
  const tokens = tokensOf(namePart(source));
  if (!tokens.some(isDescriptive)) return ALT_TEXT_FALLBACK;
  const words = tokens.filter((token) => !isNoise(token));
  while (words.length > 0 && CONNECTIVE_TOKENS.has((words[0] ?? "").toLowerCase())) {
    words.shift();
  }
  const phrase = words.join(" ").trim();
  if (!phrase) return ALT_TEXT_FALLBACK;
  const capped =
    phrase.length > MAX_ALT_TEXT_LENGTH
      ? phrase.slice(0, MAX_ALT_TEXT_LENGTH).trimEnd()
      : phrase;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}
