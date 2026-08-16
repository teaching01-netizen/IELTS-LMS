export type StudentPlatformEvent =
  | {
      readonly type: 'NETWORK_OFFLINE' | 'NETWORK_ONLINE';
      readonly timestamp: string;
    }
  | {
      readonly type: 'VISIBILITY_HIDDEN' | 'VISIBILITY_VISIBLE';
      readonly timestamp: string;
    }
  | {
      readonly type: 'FORBIDDEN_SHORTCUT' | 'SCREENSHOT_ATTEMPTED' | 'CLIPBOARD_ATTEMPTED';
      readonly timestamp: string;
      readonly detail?: string;
    }
  | {
      readonly type: 'SECONDARY_SCREEN_DETECTED' | 'DEVICE_FINGERPRINT_CHANGED';
      readonly timestamp: string;
      readonly detail?: string;
    }
  | {
      readonly type: 'STORAGE_UNAVAILABLE';
      readonly timestamp: string;
      readonly detail?: string;
    };

export interface StudentPlatformMonitor {
  subscribe(listener: (event: StudentPlatformEvent) => void): () => void;
}
