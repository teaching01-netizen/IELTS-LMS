import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function readSource(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

// Phase 01 type floor: nothing below 11px ships. Phase 02 deleted the
// duplicate 8px outcome line in SatResultsRoute, so this gate is now fully
// strict. text-[10px] eyebrow/pill bridge is a documented exception and is
// not asserted here.
describe('SAT type floor (Phase 01)', () => {
  const sources = [
    'SatRoot.tsx',
    'routes/SatResultsRoute.tsx',
    'routes/SatResultDetailRoute.tsx',
    'routes/SatSessionRoomRoute.tsx',
    'routes/SatSessionsRoute.tsx',
    'routes/SatExamLibraryRoute.tsx',
    'ui/SatPage.tsx',
  ];

  it('has no text-[9px] usages', () => {
    for (const relative of sources) {
      expect(readSource(relative), relative).not.toMatch(/text-\[9px\]/);
    }
  });

  it('has no text-[8px] usages except the Phase-02-owned Results line', () => {
    for (const relative of sources) {
      const source = readSource(relative);
      expect(source, relative).not.toMatch(/text-\[8px\]/);
    }
  });

  it('uses the fixed neutral-dot fallback in SatPage dot tones', () => {
    const source = readSource('ui/SatPage.tsx');
    expect(source).toContain('--sat-staff-neutral-dot,#6e6e73');
    expect(source).not.toContain('#9b9a97');
  });
});
