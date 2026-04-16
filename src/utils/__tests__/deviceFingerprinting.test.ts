import { describe, expect, it } from 'vitest';
import { hashFingerprint } from '../deviceFingerprinting';

describe('deviceFingerprinting', () => {
  it('returns a stable hash for the same session components', async () => {
    const components = {
      timezone: 'Asia/Bangkok',
      language: 'en-US',
      platform: 'MacIntel',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      screenResolution: '1440x900',
      colorDepth: 24,
      canvasHash: 'canvas-1',
      webglRenderer: 'renderer-1',
    };

    const firstHash = await hashFingerprint(components);
    const secondHash = await hashFingerprint(components);

    expect(firstHash).toBe(secondHash);
  });

  it('changes the hash when a relevant device signal changes', async () => {
    const baseComponents = {
      timezone: 'Asia/Bangkok',
      language: 'en-US',
      platform: 'MacIntel',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      screenResolution: '1440x900',
      colorDepth: 24,
      canvasHash: 'canvas-1',
      webglRenderer: 'renderer-1',
    };

    const baseHash = await hashFingerprint(baseComponents);
    const nextHash = await hashFingerprint({
      ...baseComponents,
      screenResolution: '1920x1080',
    });

    expect(nextHash).not.toBe(baseHash);
  });
});
