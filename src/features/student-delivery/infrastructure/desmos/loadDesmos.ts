import type { DesmosNamespace } from './desmosTypes';

const SCRIPT_ID = 'sat-desmos-api-v1-12';
const DEFAULT_HOSTED_API_URL = 'https://www.desmos.com/api/v1.12/calculator.js';
const DEFAULT_SELF_HOSTED_API_URL = '/vendor/desmos/v1.12/calculator.js';
const LOAD_TIMEOUT_MS = 20_000;

type DesmosDistributionMode = 'desmos-hosted' | 'self-hosted';

let pendingLoad: Promise<DesmosNamespace> | null = null;

function distributionMode(): DesmosDistributionMode {
  const configured = import.meta.env['VITE_DESMOS_MODE']?.trim() || 'desmos-hosted';
  if (configured !== 'desmos-hosted' && configured !== 'self-hosted') {
    throw new Error('VITE_DESMOS_MODE must be "desmos-hosted" or "self-hosted".');
  }
  return configured;
}

function isOfficialDesmosHost(url: URL) {
  return url.hostname === 'www.desmos.com' || url.hostname === 'desmos.com';
}

function selfHostedSource(configuredUrl: string | undefined): URL {
  const source = new URL(configuredUrl || DEFAULT_SELF_HOSTED_API_URL, window.location.origin);
  if (source.origin !== window.location.origin) {
    throw new Error('Self-hosted Desmos must use the same origin as the exam application.');
  }
  return source;
}function hostedSource(configuredUrl: string | undefined, apiKey: string | undefined): URL {
  const source = new URL(configuredUrl || DEFAULT_HOSTED_API_URL, window.location.origin);
  if (!isOfficialDesmosHost(source)) {
    throw new Error('Desmos-hosted mode only permits the official desmos.com API host.');
  }
  if (!apiKey) {
    throw new Error('VITE_DESMOS_API_KEY is required when VITE_DESMOS_MODE is desmos-hosted.');
  }
  source.searchParams.set('apiKey', apiKey);
  return source;
}

function buildSource(): string {
  const configuredUrl = import.meta.env['VITE_DESMOS_API_URL']?.trim() || undefined;
  const apiKey = import.meta.env['VITE_DESMOS_API_KEY']?.trim() || undefined;
  const mode = distributionMode();
  return mode === 'self-hosted'
    ? selfHostedSource(configuredUrl).toString()
    : hostedSource(configuredUrl, apiKey).toString();
}

function resolveGlobal(): DesmosNamespace {
  if (!window.Desmos) throw new Error('Desmos API loaded without exposing window.Desmos.');
  return window.Desmos;
}

function rejectAndReset(reject: (reason?: unknown) => void, error: Error) {
  pendingLoad = null;
  reject(error);
}export function loadDesmos(): Promise<DesmosNamespace> {
  if (window.Desmos) return Promise.resolve(window.Desmos);
  if (pendingLoad) return pendingLoad;

  pendingLoad = new Promise<DesmosNamespace>((resolve, reject) => {
    let timeoutId = 0;
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    const cleanupListeners = () => {
      window.clearTimeout(timeoutId);
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
    };
    const handleLoad = () => {
      cleanupListeners();
      try {
        resolve(resolveGlobal());
      } catch (error) {
        rejectAndReset(reject, error instanceof Error ? error : new Error(String(error)));
      }
    };
    const handleError = () => {
      cleanupListeners();
      script?.remove();
      rejectAndReset(reject, new Error('Unable to load the Desmos calculator API.'));
    };
    try {
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        script.src = buildSource();
        document.head.appendChild(script);
      }
      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
      timeoutId = window.setTimeout(() => {
        cleanupListeners();
        script?.remove();
        rejectAndReset(reject, new Error('Timed out while loading the Desmos calculator API.'));
      }, LOAD_TIMEOUT_MS);
    } catch (error) {
      cleanupListeners();
      rejectAndReset(
        reject,
        error instanceof Error ? error : new Error('Unable to configure the Desmos calculator API.'),
      );
    }
  });

  return pendingLoad;
}

export function resetDesmosLoaderForTests() {
  pendingLoad = null;
}
