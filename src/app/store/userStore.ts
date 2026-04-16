/**
 * User Session Store
 * Manages user authentication and session state globally
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'proctor' | 'teacher' | 'student';
  organization?: string;
}

interface UserStore {
  // State
  user: UserSession | null;
  isAuthenticated: boolean;
  
  // Actions
  setUser: (user: UserSession | null) => void;
  logout: () => void;
  updateUser: (updates: Partial<UserSession>) => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      
      setUser: (user) => set({ 
        user, 
        isAuthenticated: !!user 
      }),
      
      logout: () => set({ 
        user: null, 
        isAuthenticated: false 
      }),
      
      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null,
      })),
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
