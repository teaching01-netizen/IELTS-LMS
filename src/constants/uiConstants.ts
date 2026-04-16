/**
 * UI-related constants to avoid magic numbers in the codebase
 * Centralized values for consistent styling and behavior
 */

// Virtualization heights
export const VIRTUAL_LIST_HEIGHTS = {
  EXAM_LIST: '600px',
  ALERT_PANEL: '100%',
  PROCTOR_STUDENT_LIST: 'calc(100vh - 400px)',
} as const;

// Minimum heights
export const MIN_HEIGHTS = {
  WRITING_EDITOR: '200px',
  MAP_LABELING: '256px',
} as const;

// Animation timing
export const TIMING = {
  PROGRESS_INITIAL_DELAY_MS: 80,
  PROGRESS_SECONDARY_DELAY_MS: 140,
  PROGRESS_INITIAL_VALUE: 34,
  PROGRESS_SECONDARY_VALUE: 67,
  TOAST_DURATION_MS: 2000,
} as const;

// Character height calculations (for text areas)
export const CHAR_HEIGHT_PX = 12;

// Writing workspace constants
export const WRITING = {
  MIN_HEIGHT_CHARS: 12,
  MIN_PROGRESS_HEIGHT_CHARS: 16,
} as const;
