import { extractGoogleDriveFileId } from './audioUrl';

export const getImageUrlCandidates = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const driveFileId = extractGoogleDriveFileId(trimmed);
  if (!driveFileId) {
    return [trimmed];
  }

  return [
    `https://drive.google.com/uc?export=view&id=${driveFileId}`,
    `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w2000`,
    `https://drive.googleusercontent.com/uc?export=view&id=${driveFileId}`,
  ];
};

export const normalizeImageUrl = (value: string): string => {
  return getImageUrlCandidates(value)[0] ?? '';
};
