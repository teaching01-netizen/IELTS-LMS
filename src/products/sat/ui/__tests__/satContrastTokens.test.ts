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
    // SatResultsRoute.tsx renders rows via SatExamGroupSection.tsx (group-by-exam
    // drill-down): the route owns composition, chevrons live in the section file.
    for (const relative of [
      'routes/SatSessionsRoute.tsx',
      'routes/SatExamGroupSection.tsx',
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
    // The session room moved its tertiary text into the room stylesheet rather
    // than slate utility literals: the roster meta, the empty-state copy, and
    // the inspector labels all resolve from --sat-staff-text-tertiary.
    const roomCss = readFileSync(resolve(SAT_ROOT, 'ui/sat-session-room.css'), 'utf8');
    for (const selector of ['.sat-room__cohort', '.sat-room__row-meta', '.sat-room__empty-hint', '.sat-room__eyebrow']) {
      const rule = roomCss.match(new RegExp(`\\${selector} \\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, selector).toContain('--sat-staff-text-tertiary');
    }
    const room = readSource('routes/SatSessionRoomRoute.tsx');
    expect(room).not.toMatch(/text-slate-300/);
  });
});
