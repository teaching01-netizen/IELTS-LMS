/**
 * Global State Management Stores
 * Exports all Zustand stores for shared state management
 */

export { useUserStore } from './userStore';
export { useUIStore } from './uiStore';
export { useNotificationStore } from './notificationStore';
export type { Notification, NotificationType } from './notificationStore';
