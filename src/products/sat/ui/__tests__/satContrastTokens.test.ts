import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');
const SPINE_CSS = readFileSync(
  resolve(__dirname, '../../../../features/exam-authoring/ui/spine/spine.css'),
  'utf8',
);
const SAT_ROOT = resolve(__dirname, '../..');

function readSource(relative: string): string {
  return readFileSync(resolve(SAT_ROOT, relative), 'utf8');
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) throw new Error(`Expected a 6-digit hex color, received ${hex}`);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

describe('SAT contrast tokens (Phase 01)', () => {
  it('keeps authoring accent and hover button text above 4.5:1 on white', () => {
    const accent = CSS.match(/--color-au-accent:\s*(#[\da-f]{6})/i)?.[1];
    const hover = CSS.match(/--color-au-accent-hover:\s*(#[\da-f]{6})/i)?.[1];

    expect(accent).toBeDefined();
    expect(hover).toBeDefined();
    expect(contrastWithWhite(accent!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastWithWhite(hover!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps tertiary authoring labels above 4.5:1 on white', () => {
    const tertiary = SPINE_CSS.match(/--spine-text-tertiary:\s*(#[\da-f]{6})/i)?.[1];

    expect(tertiary).toBeDefined();
    expect(contrastWithWhite(tertiary!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps SAT staff muted text and publish dialog copy above 4.5:1 on white', () => {
    expect(CSS).toMatch(/\.sat-product \{\s*--color-muted-foreground:\s*var\(--color-muted-foreground-text\);/);
    expect(CSS).toMatch(/\.authoring-dialog-description \{\s*color: var\(--color-gray-500-text\);/);
    const mutedText = CSS.match(/--color-gray-600:\s*(#[\da-f]{6})/i)?.[1];

    expect(mutedText).toBeDefined();
    expect(contrastWithWhite(mutedText!)).toBeGreaterThanOrEqual(4.5);
  });

  it('freezes the neutral dot at #6e6e73', () => {
    expect(CSS).toMatch(/--sat-staff-neutral-dot:\s*#6e6e73/);
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
