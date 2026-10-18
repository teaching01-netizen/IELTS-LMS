import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config';
import { createServer } from './server';
import { createRuntime, resolveRepoRoot } from './wiring';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const repoRoot = resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  let runtime;
  try {
    runtime = createRuntime({ config, repoRoot });
  } catch (error) {
    process.stderr.write(`[portal] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `[portal] recovered: interrupted=${runtime.recovery.interrupted.length} held=${runtime.recovery.held.length} ` +
      `pruned=${runtime.recovery.pruned.length} catalog=${runtime.recovery ? '' : ''}\n`,
  );
  for (const runId of runtime.recovery.interrupted) {
    process.stdout.write(`[portal] interrupted run ${runId}: reconcile remote fixtures before rerunning\n`);
  }
  for (const runId of runtime.recovery.held) {
    process.stdout.write(`[portal] held queued run ${runId}: release through the portal after review\n`);
  }

  const { app } = createServer({
    config,
    orchestrator: runtime.orchestrator,
    targets: runtime.targets,
    isReady: () => true,
  });

  const server = app.listen(config.port, config.host, () => {
    process.stdout.write(`[portal] listening on http://${config.host}:${config.port}\n`);
    if (!config.productionEnabled) {
      process.stdout.write('[portal] production execution disabled (PORTAL_PRODUCTION_ENABLED=false)\n');
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`[portal] ${signal} received; draining\n`);
    server.close();
    await runtime.orchestrator.shutdown(15_000);
    runtime.store.releaseLock();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
