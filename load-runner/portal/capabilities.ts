import { accessSync, constants, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CapabilitySnapshot {
  tools: Set<string>;
  browsers: boolean;
  playwrightBrowserPath: string | null;
}

const TOOL_NAMES = ['node', 'bun', 'bunx', 'go', 'gofmt', 'k6', 'cc', 'gcc', 'mysql'] as const;

function findOnPath(name: string, env: Record<string, string | undefined>): string | null {
  const pathValue = env['PATH'] ?? '';
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep searching
      }
    }
  }
  return null;
}

export function probeCapabilities(
  env: Record<string, string | undefined> = process.env,
  homeDir = os.homedir(),
): CapabilitySnapshot {
  const tools = new Set<string>();
  for (const name of TOOL_NAMES) {
    const resolved = findOnPath(name, env);
    if (resolved) tools.add(name);
  }
  const explicitPath = env['PLAYWRIGHT_BROWSERS_PATH'];
  const candidates = [
    explicitPath && explicitPath !== '0' ? explicitPath : null,
    path.join(homeDir, '.cache', 'ms-playwright'),
    path.join(homeDir, 'Library', 'Caches', 'ms-playwright'),
    '/ms-playwright',
  ].filter((value): value is string => Boolean(value));
  let playwrightBrowserPath: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      playwrightBrowserPath = candidate;
      break;
    }
  }
  return {
    tools,
    browsers: playwrightBrowserPath !== null || tools.has('playwright'),
    playwrightBrowserPath,
  };
}
