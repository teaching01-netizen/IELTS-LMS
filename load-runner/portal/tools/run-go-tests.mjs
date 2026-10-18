#!/usr/bin/env node
// Checked-in tooling: runs `go test -json` and tees the JSON event stream to
// PORTAL_GO_TEST_JSON so the portal can tally results without relying on a
// bounded stdout capture. The child inherits the portal-controlled cwd; no
// caller-provided shell text is executed.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

const outputPath = process.env['PORTAL_GO_TEST_JSON'] ?? 'portal-results/go-test.json';
mkdirSync(path.dirname(outputPath), { recursive: true });
const sink = createWriteStream(outputPath, { mode: 0o600 });

const [cwd, ...args] = process.argv.slice(2);
const child = spawn('go', ['test', '-json', ...args], {
  cwd: cwd ?? '.',
  stdio: ['ignore', 'pipe', 'inherit'],
  env: process.env,
});

child.stdout.on('data', (chunk) => {
  sink.write(chunk);
  process.stdout.write(chunk);
});

child.on('error', (error) => {
  process.stderr.write(`run-go-tests: ${error.message}\n`);
  sink.end();
  process.exit(1);
});

child.on('close', (code) => {
  sink.end(() => process.exit(code ?? 1));
});
