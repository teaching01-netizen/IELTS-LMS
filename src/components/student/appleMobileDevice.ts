export function isAppleMobileDevice(userAgent: string = navigator.userAgent): boolean {
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) {
    return true;
  }

  const navigatorWithTouch = navigator as Navigator & { maxTouchPoints?: number };
  if (/Macintosh/i.test(userAgent) && (/(Mobile|CriOS|FxiOS|EdgiOS)/i.test(userAgent) || (navigatorWithTouch.maxTouchPoints ?? 0) > 1)) {
    return true;
  }

  return false;
}
