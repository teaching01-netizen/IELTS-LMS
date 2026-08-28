import type {
  DesmosGraphingOptions,
  DesmosScientificOptions,
} from './desmosTypes';

/**
 * College Board testing configuration published by Desmos for SAT/PSAT.
 * Images, folders, and notes are disabled; applicable regressions default
 * to Log Mode. The scientific calculator matches the standard calculator.
 */
export const SAT_DESMOS_GRAPHING_OPTIONS: DesmosGraphingOptions = {
  expressions: true,
  graphpaper: true,
  settingsMenu: true,
  zoomButtons: true,
  keypad: true,
  images: false,
  folders: false,
  notes: false,
  links: false,
  authorFeatures: false,
  forceLogModeRegressions: true,
  showEvaluationCopyButtons: false,
  brailleControls: true,
};

export const SAT_DESMOS_SCIENTIFIC_OPTIONS: DesmosScientificOptions = {
  // External help links are disabled inside the locked exam surface.
  links: false,
  qwertyKeyboard: true,
  degreeMode: false,
  allowComplex: true,
  settingsMenu: true,
};
