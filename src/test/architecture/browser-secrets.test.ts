import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('browser secret boundary', () => {
  it('does not expose the retired Gemini credential through Vite or the example environment', () => {
    const retiredCredential = ['GEMINI', 'API', 'KEY'].join('_');

    expect(readProjectFile('vite.config.ts')).not.toContain(retiredCredential);
    expect(readProjectFile('.env.example')).not.toContain(retiredCredential);
  });
});
