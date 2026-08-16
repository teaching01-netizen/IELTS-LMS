import type { StudentPlatformEvent } from '../../contracts/exam-session/StudentPlatformMonitor';

export type StudentPlatformAction =
  | { readonly kind: 'network'; readonly status: 'offline' | 'online' }
  | { readonly kind: 'visibility'; readonly visible: boolean }
  | {
      readonly kind: 'integrity';
      readonly violationType: string;
      readonly severity: 'medium' | 'high';
      readonly detail: string | null;
    }
  | { readonly kind: 'storage'; readonly blocked: true; readonly detail: string | null };

export function classifyStudentPlatformEvent(
  event: StudentPlatformEvent,
): StudentPlatformAction {
  switch (event.type) {
    case 'NETWORK_OFFLINE':
      return { kind: 'network', status: 'offline' };
    case 'NETWORK_ONLINE':
      return { kind: 'network', status: 'online' };
    case 'VISIBILITY_HIDDEN':
      return { kind: 'visibility', visible: false };
    case 'VISIBILITY_VISIBLE':
      return { kind: 'visibility', visible: true };
    case 'SECONDARY_SCREEN_DETECTED':
    case 'DEVICE_FINGERPRINT_CHANGED':
      return {
        kind: 'integrity',
        violationType: event.type,
        severity: 'high',
        detail: event.detail ?? null,
      };
    case 'FORBIDDEN_SHORTCUT':
    case 'SCREENSHOT_ATTEMPTED':
    case 'CLIPBOARD_ATTEMPTED':
      return {
        kind: 'integrity',
        violationType: event.type,
        severity: 'medium',
        detail: event.detail ?? null,
      };
    case 'STORAGE_UNAVAILABLE':
      return {
        kind: 'storage',
        blocked: true,
        detail: event.detail ?? null,
      };
  }
}
