import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');
const SAT_ROOT = resolve(__dirname, '../..');

function readSource(relative: string): string {
  return readFileSync(resolve(SAT_ROOT, relative), 'utf8');
}

describe('SAT contrast tokens (Phase 01)', () => {
  it('freezes the neutral dot at #6e6e73', () => {
    expect(CSS).toMatch(/--sat-staff-neutral-dot:\s*#6e6e73/);
  });

  it('keeps the search-clear target at 28px on both axes', () => {
    const rule = CSS.match(/\.sat-product\s+\.sat-search-clear\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/min-block-size:\s*28px\s*!important/);
    expect(rule).toMatch(/min-inline-size:\s*28px\s*!important/);
  });

  it('uses text-slate-400 (tertiary remap) on every chevron slot', () => {
    for (const relative of [
      'routes/SatSessionsRoute.tsx',
      'routes/SatResultsRoute.tsx',
      'routes/SatExamLibraryRoute.tsx',
    ]) {
      const source = readSource(relative);
      const chevrons = source.match(/sat-row-chevron[^"']*/g) ?? [];
      expect(chevrons.length, relative).toBeGreaterThan(0);
      for (const chevron of chevrons) {
        expect(chevron, `${relative}: ${chevron}`).toContain('text-slate-400');
        expect(chevron, `${relative}: ${chevron}`).not.toContain('text-slate-300');
      }
    }
    expect(readSource('routes/SatSessionRoomRoute.tsx')).toContain('className="text-slate-400"');
  });
});
