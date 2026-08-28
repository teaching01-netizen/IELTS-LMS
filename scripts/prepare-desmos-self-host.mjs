import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPublicPath = '/vendor/desmos/v1.12/calculator.js';
const defaultSourceDir = 'vendor-private/desmos/v1.12';
const validModes = new Set(['desmos-hosted', 'self-hosted']);

function viteMode() {
  return process.env.npm_lifecycle_event === 'predev' ? 'development' : 'production';
}

async function loadLocalEnv() {
  const mode = viteMode();
  const merged = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    Object.assign(merged, dotenv.parse(await readFile(file)));
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}function distributionMode() {
  const mode = process.env.VITE_DESMOS_MODE?.trim() || 'desmos-hosted';
  if (!validModes.has(mode)) {
    throw new Error(`VITE_DESMOS_MODE must be "desmos-hosted" or "self-hosted"; received "${mode}".`);
  }
  return mode;
}

function managedPublicPath() {
  const configured = process.env.VITE_DESMOS_API_URL?.trim() || defaultPublicPath;
  if (!configured.startsWith('/') || configured.includes('?') || configured.includes('#')) {
    throw new Error('Self-hosted VITE_DESMOS_API_URL must be a same-origin absolute path without query/hash.');
  }
  const normalized = path.posix.normalize(configured);
  if (!normalized.startsWith('/vendor/desmos/') || path.posix.basename(normalized) !== 'calculator.js') {
    throw new Error('Self-hosted Desmos must be served below /vendor/desmos/ and end in calculator.js.');
  }
  return normalized;
}

async function assertSafeSourceTree(sourceDir) {
  const files = [];
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = path.join(relative, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Desmos bundle may not contain symlinks: ${relativePath}`);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) files.push({ relativePath, absolutePath });
      else throw new Error(`Unsupported filesystem entry in Desmos bundle: ${relativePath}`);
    }
  }
  await walk(sourceDir);
  return files;
}async function sha256(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function prepareSelfHostedBundle() {
  const publicPath = managedPublicPath();
  const relativeTargetDir = path.posix.dirname(publicPath).replace(/^\//, '');
  const targetDir = path.join(root, 'public', relativeTargetDir.replace(/^vendor\//, 'vendor/'));
  const sourceDir = path.resolve(root, process.env.DESMOS_SELF_HOST_SOURCE_DIR?.trim() || defaultSourceDir);
  const entry = path.join(sourceDir, 'calculator.js');

  if (!existsSync(sourceDir) || !(await stat(sourceDir)).isDirectory()) {
    throw new Error(`Licensed Desmos self-host bundle not found at ${sourceDir}.`);
  }
  if (!existsSync(entry) || !(await stat(entry)).isFile()) {
    throw new Error(`Desmos self-host bundle is missing calculator.js at ${entry}.`);
  }
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    throw new Error('DESMOS_SELF_HOST_SOURCE_DIR must not point at the generated public directory.');
  }

  const files = await assertSafeSourceTree(sourceDir);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true, preserveTimestamps: true });

  const manifest = {
    schemaVersion: 1,
    distribution: 'official-desmos-partner-self-hosted',
    apiVersion: 'v1.12',
    entry: 'calculator.js',
    entrySha256: await sha256(entry),
    fileCount: files.length,
    totalBytes: (await Promise.all(files.map(({ absolutePath }) => stat(absolutePath)))).reduce((sum, item) => sum + item.size, 0),
  };
  await writeFile(path.join(targetDir, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Desmos self-host bundle prepared at ${publicPath} (${files.length} files).`);
}async function cleanGeneratedBundle() {
  const vendorRoot = path.join(root, 'public', 'vendor', 'desmos');
  if (!existsSync(vendorRoot)) return;
  for (const entry of await readdir(vendorRoot, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    await rm(path.join(vendorRoot, entry.name), { recursive: true, force: true });
  }
}

async function main() {
  await loadLocalEnv();
  const mode = distributionMode();
  if (mode === 'desmos-hosted') {
    await cleanGeneratedBundle();
    console.log('Desmos distribution: desmos-hosted (no self-hosted vendor assets copied).');
    return;
  }
  await prepareSelfHostedBundle();
}

main().catch((error) => {
  console.error(`[desmos-self-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});