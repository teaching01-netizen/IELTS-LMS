/**
 * UI Preferences Store (legacy barrel).
 *
 * The canonical UI store lives at `src/store/useUIStore.ts`. This module keeps
 * the `src/app/store/*` import path working without maintaining a second
 * divergent copy of the state — it re-exports the canonical hook.
 */

export { useUIStore } from '../../store/useUIStore';
