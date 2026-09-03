import { describe, expect, it } from 'vitest';

import { resolvePrettierRange, selectPrettierFiles } from '../check-prettier-changed';

describe('changed-file Prettier selection', () => {
  it('checks only changed TypeScript source files', () => {
    expect(
      selectPrettierFiles([
        'src/components/ActScienceWorkspace.tsx',
        'src/utils/examUtils.ts',
        'src/styles.css',
        'e2e/smoke.spec.ts',
        'backend/crates/api/src/main.rs',
        'src/notes.md',
      ]),
    ).toEqual([
      'src/components/ActScienceWorkspace.tsx',
      'src/utils/examUtils.ts',
    ]);
  });

  it('returns no files when a PR changes no TypeScript source', () => {
    expect(selectPrettierFiles(['README.md', 'backend/migrations/0032.sql'])).toEqual([]);
  });

  it('uses pull request base and head commits when GitHub provides them', () => {
    expect(
      resolvePrettierRange({}, {
        pull_request: {
          base: { sha: 'base-sha' },
          head: { sha: 'head-sha' },
        },
      }),
    ).toEqual({ base: 'base-sha', head: 'head-sha' });
  });
});
