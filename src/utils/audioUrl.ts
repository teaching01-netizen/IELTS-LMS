const GOOGLE_DRIVE_FILE_ID_PATTERNS = [
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i,
  /https?:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
];

const UNSAFE_AUDIO_URL_PATTERN = /^\s*(javascript|vbscript):/i;
const UNSAFE_DATA_HTML_PATTERN = /^\s*data\s*:\s*text\/html/i;

/** True when a URL must never be used as an audio source (script execution vector). */
export function isUnsafeAudioUrl(value: string): boolean {
  return UNSAFE_AUDIO_URL_PATTERN.test(value) || UNSAFE_DATA_HTML_PATTERN.test(value);
}

export const extractGoogleDriveFileId = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  for (const pattern of GOOGLE_DRIVE_FILE_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  try {
    const parsed = new URL(trimmed);
    const idFromQuery = parsed.searchParams.get('id');
    if (idFromQuery) {
      return idFromQuery;
    }
  } catch {
    return null;
  }

  return null;
};

export const normalizeAudioUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  // Mirror normalizeImageUrl: never emit an executable source downstream.
  if (isUnsafeAudioUrl(trimmed)) {
    return '';
  }

  const driveFileId = extractGoogleDriveFileId(trimmed);
  if (!driveFileId) {
    return trimmed;
  }

  return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
};
