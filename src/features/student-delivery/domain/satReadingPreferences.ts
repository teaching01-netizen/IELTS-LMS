export const SAT_READING_TEXT_SCALES = [1, 1.15, 1.3, 1.5, 1.75, 2] as const;

export type SatReadingTextScale = (typeof SAT_READING_TEXT_SCALES)[number];
export type SatReadingLineSpacing = "standard" | "relaxed";

export interface SatReadingPreferences {
  version: 1;
  textScale: SatReadingTextScale;
  lineSpacing: SatReadingLineSpacing;
  splitRatio: number;
  lineReaderEnabled?: boolean;
  lineReaderPosition?: number;
  examZoom?: number;
  contrastMode?: 'default' | 'high-contrast';
}

export const SAT_READING_SPLIT_MIN = 0.38;
export const SAT_READING_SPLIT_MAX = 0.62;
export const SAT_READING_SPLIT_STEP = 0.05;

export function createSatReadingPreferences(): SatReadingPreferences {
  return {
    version: 1,
    textScale: 1,
    lineSpacing: "standard",
    splitRatio: 0.5,
  };
}

export function clampSatReadingSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(SAT_READING_SPLIT_MAX, Math.max(SAT_READING_SPLIT_MIN, value));
}

export function normalizeSatReadingPreferences(value: unknown): SatReadingPreferences {
  if (!value || typeof value !== "object") return createSatReadingPreferences();
  const candidate = value as Partial<SatReadingPreferences>;
  if (candidate.version !== 1) return createSatReadingPreferences();
  const textScale = SAT_READING_TEXT_SCALES.find((scale) => scale === candidate.textScale) ?? 1;
  const lineSpacing = candidate.lineSpacing === "relaxed" ? "relaxed" : "standard";
  const splitRatio = clampSatReadingSplitRatio(
    typeof candidate.splitRatio === "number" ? candidate.splitRatio : 0.5
  );
  return { version: 1, textScale, lineSpacing, splitRatio,
    ...(typeof candidate.examZoom === 'number' && Number.isFinite(candidate.examZoom)
      ? { examZoom: Math.max(1, Math.min(2, Math.round(candidate.examZoom * 4) / 4)) } : {}),
    ...(candidate.contrastMode === 'default' || candidate.contrastMode === 'high-contrast' ? { contrastMode: candidate.contrastMode } : {}),
    ...(typeof candidate.lineReaderEnabled === 'boolean' ? { lineReaderEnabled: candidate.lineReaderEnabled } : {}),
    ...(typeof candidate.lineReaderPosition === 'number' && Number.isFinite(candidate.lineReaderPosition)
      ? { lineReaderPosition: Math.max(0.05, Math.min(0.95, candidate.lineReaderPosition)) } : {}),
  };
}

export function previousSatReadingTextScale(current: SatReadingTextScale): SatReadingTextScale {
  const index = SAT_READING_TEXT_SCALES.indexOf(current);
  return SAT_READING_TEXT_SCALES[Math.max(0, index - 1)] ?? 1;
}

export function nextSatReadingTextScale(current: SatReadingTextScale): SatReadingTextScale {
  const index = SAT_READING_TEXT_SCALES.indexOf(current);
  return SAT_READING_TEXT_SCALES[Math.min(SAT_READING_TEXT_SCALES.length - 1, index + 1)] ?? 2;
}

export function isDefaultSatReadingPreferences(preferences: SatReadingPreferences): boolean {
  return (
    preferences.textScale === 1 &&
    (preferences.examZoom ?? 1) === 1 &&
    (preferences.contrastMode ?? 'default') === 'default' &&
    preferences.lineSpacing === "standard" &&
    Math.abs(preferences.splitRatio - 0.5) < 0.001
  );
}
