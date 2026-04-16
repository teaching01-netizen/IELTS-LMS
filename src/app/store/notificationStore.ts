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

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  
  addNotification: (notification) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
    };
    
    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));
    
    // Auto-remove after duration if specified
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, notification.duration);
    }
  },
  
  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
  
  clearNotifications: () => {
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
