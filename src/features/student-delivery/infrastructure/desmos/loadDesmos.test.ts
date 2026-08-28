import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDesmos, resetDesmosLoaderForTests } from './loadDesmos';
import type { DesmosNamespace } from './desmosTypes';

const SCRIPT_ID = 'sat-desmos-api-v1-12';
const namespace: DesmosNamespace = {
  enabledFeatures: { GraphingCalculator: true, ScientificCalculator: true },
  GraphingCalculator: vi.fn(),
  ScientificCalculator: vi.fn(),
};

describe('loadDesmos', () => {
  beforeEach(() => {
    delete window.Desmos;
    document.getElementById(SCRIPT_ID)?.remove();
    resetDesmosLoaderForTests();
    vi.stubEnv('VITE_DESMOS_MODE', 'desmos-hosted');
    vi.stubEnv('VITE_DESMOS_API_URL', '');
    vi.stubEnv('VITE_DESMOS_API_KEY', '');
  });

  afterEach(() => {
    document.getElementById(SCRIPT_ID)?.remove();
    delete window.Desmos;
    vi.unstubAllEnvs();
    resetDesmosLoaderForTests();
  });
  it('loads the official v1.12 API lazily with the configured partner key', async () => {
    vi.stubEnv('VITE_DESMOS_API_KEY', 'partner-test-key');
    const pending = loadDesmos();
    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement;
    expect(script.src).toContain('https://www.desmos.com/api/v1.12/calculator.js');
    expect(script.src).toContain('apiKey=partner-test-key');
    expect(script.referrerPolicy).toBe('no-referrer');
    window.Desmos = namespace;
    script.dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(namespace);
  });

  it('fails closed without a partner key in Desmos-hosted mode', async () => {
    await expect(loadDesmos()).rejects.toThrow(/VITE_DESMOS_API_KEY is required/);
  });

  it('uses the same-origin versioned bundle in self-hosted mode without exposing the API key', async () => {
    vi.stubEnv('VITE_DESMOS_MODE', 'self-hosted');
    vi.stubEnv('VITE_DESMOS_API_KEY', 'must-not-be-used');
    const pending = loadDesmos();
    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement;
    expect(script.src).toBe(`${window.location.origin}/vendor/desmos/v1.12/calculator.js`);
    expect(script.src).not.toContain('apiKey=');
    window.Desmos = namespace;
    script.dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(namespace);
  });
  it('rejects a cross-origin URL in self-hosted mode', async () => {
    vi.stubEnv('VITE_DESMOS_MODE', 'self-hosted');
    vi.stubEnv('VITE_DESMOS_API_URL', 'https://cdn.example.com/calculator.js');
    await expect(loadDesmos()).rejects.toThrow(/same origin/);
  });

  it('never sends the partner key to a non-Desmos host', async () => {
    vi.stubEnv('VITE_DESMOS_MODE', 'desmos-hosted');
    vi.stubEnv('VITE_DESMOS_API_KEY', 'partner-test-key');
    vi.stubEnv('VITE_DESMOS_API_URL', 'https://cdn.example.com/calculator.js');
    await expect(loadDesmos()).rejects.toThrow(/official desmos.com API host/);
  });
});
