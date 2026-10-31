import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plan §6.7 audit: every staff notice strip that can hide work from the room
 * must ship a close control. The blocking overlays, status text and
 * confirmation boxes are the documented exceptions and are not in this list.
 *
 * This is a structural guard in addition to the component tests: adding a new
 * inline warning without a close is the kind of regression a single-component
 * test misses.
 */
const BANNER_COMPONENTS = [
  ['staff route panel', '../SatStaffRoutePanel.tsx'],
  ['room entry panel', '../room/SatRoomEntryPanel.tsx'],
  ['attempt answers poll notice', '../../routes/SatAttemptAnswersRoute.tsx'],
  ['room notice strip', '../SatRoomNotices.tsx'],
];

describe('SAT banner close-control audit', () => {
  it.each(BANNER_COMPONENTS)('%s imports the shared dismiss control', (_name, file) => {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    expect(source).toMatch(/SatBannerDismissButton/);
  });
});
