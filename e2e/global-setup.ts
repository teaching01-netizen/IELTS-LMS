import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import {
  ADMIN_STORAGE_STATE_PATH,
  BUILDER_STORAGE_STATE_PATH,
  GENERATED_DIR,
  MANIFEST_PATH,
  STUDENT_STORAGE_STATE_PATH,
  UNREGISTERED_STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

function loadEnvFile(filePath: string) {
  dotenv.config({ path: filePath, override: false });
}

function runGoCommand(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn('go', args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

		reject(new Error(`e2e Go command failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

export default async function globalSetup(config: FullConfig) {
  const workspaceRoot = process.cwd();
  const backendRoot = path.resolve(workspaceRoot, 'backend');
  const frontendOrigin = config.projects[0]?.use?.baseURL?.toString() ?? 'http://localhost:3000';

	loadEnvFile(path.resolve(workspaceRoot, '.env'));
	loadEnvFile(path.resolve(backendRoot, '.env'));
	loadEnvFile(path.resolve(workspaceRoot, '.env.example'));

	process.env.COOKIE_SECURE ??= 'false';
	process.env.SESSION_COOKIE_NAME ??= 'session';
	process.env.CSRF_COOKIE_NAME ??= 'csrf';
	process.env.APP_ENV ??= 'test';
	process.env.MIGRATIONS_DIR ??= 'migrations';

  await fs.mkdir(GENERATED_DIR, { recursive: true });

	await runGoCommand(
		['run', './cmd/migrate'],
		path.resolve(backendRoot, 'go'),
		process.env,
	);

	const seedArgs = [
		'run',
		'./cmd/e2e_seed',
		'--manifest',
    MANIFEST_PATH,
    '--builder-storage',
    BUILDER_STORAGE_STATE_PATH,
    '--student-storage',
    STUDENT_STORAGE_STATE_PATH,
    '--unregistered-student-storage',
    UNREGISTERED_STUDENT_STORAGE_STATE_PATH,
    '--admin-storage',
    ADMIN_STORAGE_STATE_PATH,
    '--frontend-origin',
    frontendOrigin,
  ];

	await runGoCommand(seedArgs, path.resolve(backendRoot, 'go'), process.env);
}
