import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('PostCSS Safari 100vh fallback', () => {
  const projectRoot = resolve(__dirname, '../..');
  const configPath = resolve(projectRoot, 'postcss.config.cjs');
  const studentAppSource = readFileSync(
    resolve(projectRoot, 'src/components/student/StudentApp.tsx'),
    'utf8',
  );
  const appCss = readFileSync(resolve(projectRoot, 'src/index.css'), 'utf8');

  it('emits -webkit-fill-available after the modern viewport cascade', async () => {
    expect(existsSync(configPath)).toBe(true);
    if (!existsSync(configPath)) return;

    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };
    expect(packageJson.devDependencies?.['postcss-100vh-fix']).toBeDefined();

    const require = createRequire(import.meta.url);
    const config = require(configPath) as { plugins: postcss.AcceptedPlugin[] };
    const result = await postcss(config.plugins).process(
      `.student-exam-shell {
        height: 100vh;
        height: 100svh;
        height: 100dvh;
      }`,
      { from: undefined },
    );

    expect(result.css).toContain('@supports (-webkit-touch-callout: none)');
    expect(result.css).toMatch(
      /@supports \(-webkit-touch-callout: none\)[\s\S]*height: -webkit-fill-available/,
    );
    expect(result.css).toContain('height: 100dvh');
  });

  it('routes every student app phase through the transformable h-screen utility', () => {
    const shellStyle = studentAppSource.match(
      /const studentShellStyle = \{([\s\S]*?)\}\s+as React\.CSSProperties/,
    )?.[1];
    expect(shellStyle).toBeDefined();
    expect(shellStyle).not.toMatch(/height:/);

    const shellClassNames = Array.from(
      studentAppSource.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g),
      (match) => match[1] ?? match[2] ?? '',
    ).filter((className) =>
      className.includes('student-exam-shell') || className.includes('flex flex-col h-screen'),
    );

    expect(shellClassNames).toHaveLength(3);
    expect(shellClassNames.every((className) => className.includes('h-screen'))).toBe(true);
    expect(appCss).toMatch(
      /@supports\s*\(height:\s*100dvh\)[\s\S]*?\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*100dvh/,
    );
  });
});
