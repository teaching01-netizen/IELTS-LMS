import { describe, expect, test } from 'vitest';

import {
  createDefaultExportProfile,
  type ExportProfile,
} from '../gradingExportBuilder/exportPlan';
import { upsertExportProfile } from '../gradingExportBuilder/profileStorage';

describe('grading export profiles', () => {
  test('replaces a saved profile by id without changing other profiles', () => {
    const first = createDefaultExportProfile();
    const second: ExportProfile = {
      ...first,
      id: 'finance',
      name: 'Finance report',
    };
    const updated: ExportProfile = {
      ...second,
      name: 'Finance report v2',
    };

    const result = upsertExportProfile([first, second], updated);

    expect(result.map((profile) => profile.id)).toEqual(['warwick-standard', 'finance']);
    expect(result.find((profile) => profile.id === 'finance')?.name).toBe('Finance report v2');
  });
});
