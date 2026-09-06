/**
 * Notification Store
 * Manages global notifications and toasts
 */

import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
  timestamp: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const DEFAULT_DURATION_MS = 5000;
const MAX_NOTIFICATIONS = 20;

interface NotificationStore {
  // State
  notifications: Notification[];
  
  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  addSuccess: (message: string, title?: string) => void;
  addError: (message: string, title?: string) => void;
  addWarning: (message: string, title?: string) => void;
  addInfo: (message: string, title?: string) => void;
}

// Timers live outside the store so replacing/clearing the array can never
// orphan a pending auto-dismiss (which would otherwise remove a newer toast
// or leak after all subscribers unmount).
const dismissalTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearDismissalTimer(id: string): void {
  const timer = dismissalTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    dismissalTimers.delete(id);
  }
}

function scheduleDismissal(
  id: string,
  duration: number,
  remove: (id: string) => void,
): void {
  clearDismissalTimer(id);
  if (duration <= 0) {
    return;
  }
  dismissalTimers.set(
    id,
    setTimeout(() => {
      dismissalTimers.delete(id);
      remove(id);
    }, duration),
  );
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  
  addNotification: (notification) => {
    const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
    const newNotification: Notification = {
      ...notification,
      duration: notification.duration ?? DEFAULT_DURATION_MS,
      id,
      timestamp: Date.now(),
    };
    
    set((state) => ({
      notifications: [...state.notifications, newNotification].slice(-MAX_NOTIFICATIONS),
    }));
    
    // Auto-remove after duration (default 5s); duration <= 0 pins the toast.
    scheduleDismissal(id, newNotification.duration ?? DEFAULT_DURATION_MS, get().removeNotification);
  },
  
  removeNotification: (id) => {
    clearDismissalTimer(id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
  
  clearNotifications: () => {
    for (const timer of dismissalTimers.values()) {
      clearTimeout(timer);
    }
    dismissalTimers.clear();
    set({ notifications: [] });
  },
  
  addSuccess: (message, title = 'Success') => {
    get().addNotification({
      type: 'success',
      title,
      message,
      duration: 5000,
    });
  },
  
  addError: (message, title = 'Error') => {
    get().addNotification({
      type: 'error',
      title,
      message,
      duration: 8000,
    });
  },
  
  addWarning: (message, title = 'Warning') => {
    get().addNotification({
      type: 'warning',
      title,
      message,
      duration: 6000,
    });
  },
  
  addInfo: (message, title = 'Info') => {
    get().addNotification({
      type: 'info',
      title,
      message,
      duration: 4000,
    });
  },
}));
