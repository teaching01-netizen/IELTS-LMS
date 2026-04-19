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

function runSeedCommand(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('cargo', args, {
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

      reject(new Error(`e2e seed command failed with exit code ${code ?? 'unknown'}`));
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

  process.env.AUTH_COOKIE_SECURE ??= 'false';
  process.env.AUTH_SESSION_COOKIE_NAME ??= 'session';
  process.env.AUTH_CSRF_COOKIE_NAME ??= 'csrf';

  await fs.mkdir(GENERATED_DIR, { recursive: true });

  const cargoArgs = [
    'run',
    '-p',
    'ielts-backend-api',
    '--bin',
    'e2e_seed',
    '--',
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

  await runSeedCommand(cargoArgs, backendRoot, process.env);
}
