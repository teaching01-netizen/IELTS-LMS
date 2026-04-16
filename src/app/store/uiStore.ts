/**
 * UI Preferences Store
 * Manages global UI state like theme, sidebar state, etc.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIPreferences {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  showCommandPalette: boolean;
}

interface UIStore extends UIPreferences {
  // Actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setCompactMode: (compact: boolean) => void;
  toggleCommandPalette: (show?: boolean) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      fontSize: 'medium',
      compactMode: false,
      showCommandPalette: false,
      
      setTheme: (theme) => set({ theme }),
      
      toggleSidebar: () => set((state) => ({ 
        sidebarCollapsed: !state.sidebarCollapsed 
      })),
      
      setSidebarCollapsed: (collapsed) => set({ 
        sidebarCollapsed: collapsed 
      }),
      
      setFontSize: (fontSize) => set({ fontSize }),
      
      setCompactMode: (compactMode) => set({ compactMode }),
      
      toggleCommandPalette: (show) => set((state) => ({ 
        showCommandPalette: show !== undefined ? show : !state.showCommandPalette 
      })),
    }),
    {
      name: 'ui-preferences',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        fontSize: state.fontSize,
        compactMode: state.compactMode,
      }),
    }
  )
);
