const GOOGLE_DRIVE_FILE_ID_PATTERNS = [
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
  /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i,
  /https?:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
];

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

  const driveFileId = extractGoogleDriveFileId(trimmed);
  if (!driveFileId) {
    return trimmed;
  }

  return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
};
