import type { CSSProperties } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";

type SatReadingCSSProperties = CSSProperties & {
  "--sat-reading-scale": string;
  "--sat-reading-line-height": string;
};

export function satReadingStyle(preferences: SatReadingPreferences): SatReadingCSSProperties {
  return {
    "--sat-reading-scale": String(preferences.textScale),
    "--sat-reading-line-height": preferences.lineSpacing === "relaxed" ? "1.85" : "1.6",
  };
}
