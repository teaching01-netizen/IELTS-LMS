import { extractGoogleDriveFileId } from './audioUrl';

const UNSAFE_IMAGE_URL_PATTERN = /^\s*(javascript|vbscript):/i;
const UNSAFE_DATA_HTML_PATTERN = /^\s*data\s*:\s*text\/html/i;

/**
 * True when a URL must never be used as an image source: script schemes and
 * HTML data URLs (SVG/HTML payloads execute script in some renderers).
 */
export function isUnsafeImageUrl(value: string): boolean {
  return UNSAFE_IMAGE_URL_PATTERN.test(value) || UNSAFE_DATA_HTML_PATTERN.test(value);
}

export const getImageUrlCandidates = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  // Never surface an executable URL as a loadable image candidate: callers
  // fall back through this list into <img src>, where javascript:/vbscript:/
  // data:text/html payloads are an XSS vector.
  if (isUnsafeImageUrl(trimmed)) {
    return [];
  }

  const driveFileId = extractGoogleDriveFileId(trimmed);
  if (!driveFileId) {
    return [trimmed];
  }

  return [
    `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w2000`,
    `https://lh3.googleusercontent.com/d/${driveFileId}=s2000`,
    `https://drive.google.com/uc?export=view&id=${driveFileId}`,
    `https://drive.usercontent.google.com/download?id=${driveFileId}&export=view`,
  ];
};

export const normalizeImageUrl = (value: string): string => {
  // Drops javascript:/vbscript:/data:text/html to '' so downstream <img src>
  // and sanitizeHtml post-processing never emit an executable source.
  // Benign data:image/* URLs pass through unchanged.
  return getImageUrlCandidates(value)[0] ?? '';
};
