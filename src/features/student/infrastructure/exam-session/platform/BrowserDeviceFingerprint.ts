import { getDeviceFingerprint } from '../../../../../utils/deviceFingerprinting';

export function readBrowserDeviceFingerprint() {
  return getDeviceFingerprint();
}
