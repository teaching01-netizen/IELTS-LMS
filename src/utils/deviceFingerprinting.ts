export interface DeviceFingerprintComponents {
  timezone: string | null;
  language: string | null;
  platform: string | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  screenResolution: string | null;
  colorDepth: number | null;
  canvasHash: string | null;
  webglRenderer: string | null;
}

function fallbackHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isJsdomCanvasEnvironment() {
  return /jsdom/i.test(navigator.userAgent);
}

function getCanvasHash(): string | null {
  if (isJsdomCanvasEnvironment()) {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.textBaseline = 'top';
    context.font = '16px Arial';
    context.fillStyle = '#102030';
    context.fillRect(0, 0, 240, 60);
    context.fillStyle = '#f3f4f6';
    context.fillText('IELTS integrity check', 10, 10);
    context.fillStyle = '#ef4444';
    context.fillText(navigator.userAgent, 10, 32);

    return fallbackHash(canvas.toDataURL());
  } catch {
    return null;
  }
}

function getWebGlRenderer(): string | null {
  if (isJsdomCanvasEnvironment()) {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');

    if (!context) {
      return null;
    }

    const gl = context as WebGLRenderingContext;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    if (debugInfo) {
      return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
    }

    return gl.getParameter(gl.RENDERER) as string;
  } catch {
    return null;
  }
}

export async function collectDeviceFingerprintComponents(): Promise<DeviceFingerprintComponents> {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    language: navigator.language ?? null,
    platform: navigator.platform ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: 'deviceMemory' in navigator ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null) : null,
    screenResolution:
      typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null,
    colorDepth: typeof screen !== 'undefined' ? screen.colorDepth ?? null : null,
    canvasHash: getCanvasHash(),
    webglRenderer: getWebGlRenderer(),
  };
}

export async function hashFingerprint(components: DeviceFingerprintComponents): Promise<string> {
  const value = JSON.stringify(components);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest))
      .map((chunk) => chunk.toString(16).padStart(2, '0'))
      .join('');
  }

  return fallbackHash(value);
}

export async function getDeviceFingerprint() {
  const components = await collectDeviceFingerprintComponents();
  const hash = await hashFingerprint(components);

  return {
    components,
    hash,
  };
}
