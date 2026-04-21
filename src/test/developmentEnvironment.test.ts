// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import viteConfigFactory from '../../vite.config';

const projectRoot = path.resolve(__dirname, '../..');
const backendRoot = path.join(projectRoot, 'backend');

function readBackendFile(relativePath: string): string {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

function readBackendFileIfExists(relativePath: string): string | null {
  const filePath = path.join(backendRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

describe('development environment wiring', () => {
  it('proxies frontend api requests to the backend server in dev', () => {
    const config = viteConfigFactory({ command: 'serve', mode: 'development' });

    expect(config.server?.proxy).toBeDefined();
    expect(config.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:4000',
      changeOrigin: true,
    });
  });

  it('aligns backend compose ports, env defaults, and bootstrap flow', () => {
    const compose = readBackendFile('docker-compose.yml');
    const backendEnv = readBackendFileIfExists('.env');
    const backendEnvExample = readBackendFile('.env.example');
    const makefile = readBackendFile('Makefile');

    expect(compose).toContain('pingcap/tidb');
    expect(compose).toContain('"4000:4000"');
    expect(compose).toContain('mysqladmin ping');

    for (const envFile of [backendEnv, backendEnvExample].filter(
      (value): value is string => typeof value === 'string',
    )) {
      expect(envFile).toContain('DATABASE_URL=mysql://root:root@127.0.0.1:4000/ielts');
      expect(envFile).toContain('DATABASE_DIRECT_URL=mysql://root:root@127.0.0.1:4000/ielts');
      expect(envFile).toContain('DATABASE_MIGRATOR_URL=mysql://root:root@127.0.0.1:4000/ielts');
      expect(envFile).toContain('DATABASE_WORKER_URL=mysql://root:root@127.0.0.1:4000/ielts');
    }

    expect(makefile).toContain('docker-compose.yml up -d tidb minio');
  });
});
