// UI-only bridge for the feature infrastructure boundary. The feature must
// not reach into app error/store modules directly, while the legacy app
// services remain available to the existing authoring surface.
export { logError } from '@app/error/errorLogger';
export { useNotificationStore } from '@app/store/notificationStore';
