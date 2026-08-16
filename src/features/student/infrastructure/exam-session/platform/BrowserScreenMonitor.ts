export interface StudentScreenSnapshot {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export function readBrowserScreenSnapshot(): StudentScreenSnapshot | null {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
    return null;
  }

  return {
    width: window.screen.width,
    height: window.screen.height,
    pixelRatio: window.devicePixelRatio || 1,
  };
}
