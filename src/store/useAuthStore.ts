/**
 * Auth State Store - Authentication state management with Zustand
 * Manages user authentication, permissions, and session state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'proctor' | 'grader' | 'student';
  permissions: string[];
  institution?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  /** Epoch ms when the session expires, or null for a non-expiring session. */
  expiresAt: number | null;
  
  // Actions
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  /** Stores the token with an absolute expiry; expired sessions read as logged out. */
  setSession: (token: string | null, expiresAt: number | null) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: User['role']) => boolean;
}

/** Storage schema version: bump when the persisted shape changes. Unknown or
 * older versions are discarded (fail-closed to logged-out) instead of being
 * hydrated into a mismatched state shape. */
export const AUTH_STORAGE_VERSION = 1;
export const AUTH_STORAGE_KEY = 'auth-storage';

type PersistedAuth = {
  version?: number | undefined;
  state?:
    | {
        user?: User | null | undefined;
        token?: string | null | undefined;
        isAuthenticated?: boolean | undefined;
        expiresAt?: number | null | undefined;
      }
    | undefined;
};

function isSessionExpired(expiresAt: number | null | undefined): boolean {
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && Date.now() >= expiresAt;
}

function sanitizePersistedAuth(raw: unknown): PersistedAuth | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const version = (raw as { version?: unknown }).version;
  if (version !== AUTH_STORAGE_VERSION) return null;
  const state = (raw as PersistedAuth).state;
  if (typeof state !== 'object' || state === null) return null;
  if (isSessionExpired(state.expiresAt)) return null;
  return { version, state };
}

const versionedStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // Legacy (unversioned) payloads predate the version guard: discard so a
      // stale token from an older schema can never hydrate as authenticated.
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
        localStorage.removeItem(name);
        return null;
      }
      if (!sanitizePersistedAuth(parsed)) {
        localStorage.removeItem(name);
        return null;
      }
      return raw;
    } catch {
      localStorage.removeItem(name);
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    localStorage.setItem(name, value);
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
}));

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      token: null,
      expiresAt: null,

      setUser: (user) =>
        set((state) => ({
          user,
          // An expired session stays logged out even if a user object is set.
          isAuthenticated: !!user && !isSessionExpired(state.expiresAt),
        })),
      setToken: (token) => set({ token, expiresAt: null }),
      setSession: (token, expiresAt) =>
        set({
          token,
          expiresAt,
          isAuthenticated: !!token && !!get().user && !isSessionExpired(expiresAt),
        }),
      logout: () => set({ user: null, token: null, expiresAt: null, isAuthenticated: false }),
      setLoading: (loading) => set({ isLoading: loading }),
      
      hasPermission: (permission) => {
        const { user, expiresAt } = get();
        if (!user || isSessionExpired(expiresAt)) return false;
        return user.permissions.includes(permission);
      },
      
      hasRole: (role) => {
        const { user, expiresAt } = get();
        if (!user || isSessionExpired(expiresAt)) return false;
        return user.role === role;
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      version: AUTH_STORAGE_VERSION,
      storage: versionedStorage,
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated && !isSessionExpired(state.expiresAt),
        expiresAt: state.expiresAt,
      }),
      // Cross-tab sync: another tab's login/logout rehydrates here. Expired
      // sessions merge as logged-out so a stale tab cannot stay authenticated.
      onRehydrateStorage: () => (rehydrated) => {
        if (rehydrated && isSessionExpired(rehydrated.expiresAt)) {
          useAuthStore.setState({
            user: null,
            token: null,
            expiresAt: null,
            isAuthenticated: false,
          });
        }
      },
    }
  )
);

// Cross-tab sync: apply other tabs' auth writes immediately (zustand `persist`
// only rehydrates on load/storage events for its own key via the listener
// below). Malformed or version-mismatched payloads are ignored.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== AUTH_STORAGE_KEY) return;
    if (event.newValue === null) {
      useAuthStore.setState({ user: null, token: null, expiresAt: null, isAuthenticated: false });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      const clean = sanitizePersistedAuth(parsed);
      if (!clean?.state) return;
      useAuthStore.setState({
        user: clean.state.user ?? null,
        token: clean.state.token ?? null,
        expiresAt: clean.state.expiresAt ?? null,
        isAuthenticated: !!clean.state.isAuthenticated && !isSessionExpired(clean.state.expiresAt),
      });
    } catch {
      // Ignore malformed cross-tab payloads; current tab state is unchanged.
    }
  });
}
