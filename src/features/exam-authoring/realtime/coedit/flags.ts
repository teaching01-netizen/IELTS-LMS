// Frontend co-edit posture.
//
// Prompt co-editing is always enabled in the product build. Keep the exported
// name and resolver for callers that still import the old flag contract, but do
// not make authors configure a Vite variable before the collaborative header
// and editor can appear.
export const VITE_AUTHORING_REALTIME_COEDITING = "VITE_AUTHORING_REALTIME_COEDITING";

export function resolveCoeditFrontendFlag(
  _env: Record<string, unknown> = {},
): boolean {
  return true;
}

/** Kept as a compatibility seam; the frontend co-edit posture is always on. */
export function coeditFrontendEnabled(): boolean {
  return true;
}
