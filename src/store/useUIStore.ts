/**
 * UI State Store - Global UI state management with Zustand
 * Manages sidebar, modals, toasts, and other UI-related state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface ModalState {
  id: string;
  isOpen: boolean;
  data?: unknown;
}

interface UIState {
  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Modals
  modals: Record<string, ModalState>;
  openModal: (id: string, data?: unknown) => void;
  closeModal: (id: string) => void;
  closeAllModals: () => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Loading states
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
}

/** Maximum toasts retained: the newest toast evicts the oldest (FIFO). */
export const MAX_TOASTS = 5;

// Auto-dismiss timer handles keyed by toast id. Tracked in module scope (not
// in the persisted store) so manual dismiss and clearToasts can cancel a
// pending setTimeout instead of leaving an orphaned timer that fires a stale
// removeToast after the toast is gone.
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearToastTimer(id: string): void {
  const timer = toastTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Sidebar
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Modals
      modals: {},
      openModal: (id, data) =>
        set((state) => ({
          modals: {
            ...state.modals,
            [id]: { id, isOpen: true, data },
          },
        })),
      closeModal: (id) =>
        set((state) => ({
          modals: {
            ...state.modals,
            [id]: { id, isOpen: false, data: state.modals[id]?.data },
          },
        })),
      closeAllModals: () =>
        set((state) => ({
          modals: Object.entries(state.modals).reduce<Record<string, ModalState>>((acc, [key, modal]) => {
            acc[key] = { ...modal, isOpen: false };
            return acc;
          }, {}),
        })),

      // Toasts
      toasts: [],
      addToast: (toast) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const newToast: Toast = { ...toast, id };
        // Cap: evict oldest first so the stack stays bounded; cancelled
        // timers of evicted toasts are cleared to avoid orphaned callbacks.
        set((state) => {
          const next = [...state.toasts, newToast];
          while (next.length > MAX_TOASTS) {
            const evicted = next.shift();
            if (evicted) clearToastTimer(evicted.id);
          }
          return { toasts: next };
        });

        // Auto-remove toast after duration. `duration <= 0` (including 0)
        // means sticky: no timer, matching the Toast component semantics.
        if (!(toast.duration !== undefined ? toast.duration > 0 : true)) {
          return;
        }
        const delay = toast.duration ?? 5000;
        const timer = setTimeout(() => {
          toastTimers.delete(id);
          get().removeToast(id);
        }, delay);
        toastTimers.set(id, timer);
      },
      removeToast: (id) => {
        clearToastTimer(id);
        set((state) => ({
          toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
      },
      clearToasts: () => {
        for (const id of toastTimers.keys()) {
          clearToastTimer(id);
        }
        set({ toasts: [] });
      },

      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),

      // Loading
      globalLoading: false,
      setGlobalLoading: (loading) => set({ globalLoading: loading }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);
