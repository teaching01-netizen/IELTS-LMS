import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  PORTAL_SCHEMA_VERSION,
  PortalError,
  isTerminalRunStatus,
  type ArtifactRecord,
  type RunRecord,
} from './contracts';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROL_SCHEMA_VERSION = 1;

interface Tombstone {
  runId: string;
  artifactsExpireAt: string;
  prunedAt: string;
}

export interface RunStoreOptions {
  dataDir: string;
  retentionDays: number;
  logLimitBytes: number;
  artifactLimitBytes: number;
  minFreeBytes: number;
}

export interface CreateArtifactInput {
  runId: string;
  executionId: string;
  sourcePath: string;
  fileName: string;
  mediaType: string;
  expiresAt: string;
}

export class ControllerLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControllerLockError';
  }
}

export class RunStore {
  readonly runsDir: string;
  readonly quarantineDir: string;
  readonly tombstonesDir: string;
  readonly lockPath: string;
  private readonly options: RunStoreOptions;
  private readonly records = new Map<string, RunRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly logBytes = new Map<string, number>();
  private readonly unknownSchemaRuns = new Set<string>();
  private mutationChain: Promise<unknown> = Promise.resolve();
  private lockFd: number | null = null;

  constructor(options: RunStoreOptions) {
    this.options = options;
    this.runsDir = path.join(options.dataDir, 'runs');
    this.quarantineDir = path.join(options.dataDir, 'quarantine');
    this.tombstonesDir = path.join(options.dataDir, 'tombstones');
    this.lockPath = path.join(options.dataDir, 'controller.lock');
  }

  // -- lifecycle ------------------------------------------------------------

  initialize(): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    mkdirSync(this.runsDir, { recursive: true });
    mkdirSync(this.quarantineDir, { recursive: true });
    mkdirSync(this.tombstonesDir, { recursive: true });
    this.acquireLock();
    this.load();
  }

  private acquireLock(): void {
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        writeSync(fd, payload);
        fsyncSync(fd);
        this.lockFd = fd;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;
        if (attempt === 1) {
          throw new ControllerLockError(
            'Another portal controller holds the data-directory lock. Reuse the running controller or stop it first.',
          );
        }
        this.removeStaleLock();
      }
    }
  }

  private removeStaleLock(): void {
    let pid: number | null = null;
    try {
      const raw = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { pid?: unknown };
      if (typeof raw.pid === 'number' && Number.isInteger(raw.pid)) pid = raw.pid;
    } catch {
      // Corrupt lock: treat as stale.
    }
    if (pid !== null && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        throw new ControllerLockError(`Portal controller lock is held by live process ${pid}.`);
      } catch (error) {
        if (error instanceof ControllerLockError) throw error;
        // ESRCH: owner is gone.
      }
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Best effort; a retry will surface a real conflict.
    }
  }

  releaseLock(): void {
    if (this.lockFd !== null) {
      try {
        closeSync(this.lockFd);
      } catch {
        // ignore
      }
      this.lockFd = null;
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // ignore
    }
  }

  private load(): void {
    for (const entry of readdirSync(this.runsDir)) {
      const runDir = path.join(this.runsDir, entry);
      const manifestPath = path.join(runDir, 'run.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunRecord;
        if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > PORTAL_SCHEMA_VERSION) {
          // Newer unknown schema: keep on disk, never mutate or serve writes.
          this.unknownSchemaRuns.add(entry);
          continue;
        }
        if (raw.schemaVersion < PORTAL_SCHEMA_VERSION) {
          this.migrate(raw);
        }
        if (raw.runId !== entry) throw new Error('runId does not match its directory');
        this.records.set(raw.runId, raw);
        if (raw.idempotencyKey) this.idempotency.set(raw.idempotencyKey, raw.runId);
      } catch (error) {
        this.quarantine(entry, manifestPath, error);
      }
    }
  }

  private migrate(record: RunRecord): void {
    // Additive-only migrations. Unknown future versions never reach here.
    if (!Array.isArray(record.reconciliationNotes)) record.reconciliationNotes = [];
    if (!Array.isArray(record.executions)) record.executions = [];
    record.schemaVersion = PORTAL_SCHEMA_VERSION;
  }

  private quarantine(entry: string, manifestPath: string, error: unknown): void {
    const suffix = `${Date.now()}`;
    const target = path.join(this.quarantineDir, `${entry}-${suffix}.json`);
    try {
      renameSync(manifestPath, target);
      writeFileSync(`${target}.reason`, error instanceof Error ? error.message : String(error));
    } catch {
      // Quarantine is best effort; the corrupt file stays in place.
    }
  }

  /** Serialized mutation lane: every durable decision passes through here. */
  mutate<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.mutationChain.then(fn, fn);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // -- reads ---------------------------------------------------------------

  get(runId: string): RunRecord | null {
    if (this.unknownSchemaRuns.has(runId)) {
      throw new PortalError(503, 'UNAVAILABLE', 'This run was written by a newer portal schema and is read-only.');
    }
    return this.records.get(runId) ?? null;
  }

  require(runId: string): RunRecord {
    const record = this.get(runId);
    if (!record) throw new PortalError(404, 'NOT_FOUND', 'Run not found.');
    return record;
  }

  findByIdempotencyKey(key: string): RunRecord | null {
    const runId = this.idempotency.get(key);
    return runId ? this.records.get(runId) ?? null : null;
  }

  nextAdmissionSequence(): number {
    let max = 0;
    for (const record of this.records.values()) {
      if (record.admissionSequence > max) max = record.admissionSequence;
    }
    return max + 1;
  }

  queued(): RunRecord[] {
    return [...this.records.values()]
      .filter((record) => record.status === 'queued')
      .sort((a, b) => a.admissionSequence - b.admissionSequence);
  }

  nonTerminal(): RunRecord[] {
    return [...this.records.values()].filter((record) => !isTerminalRunStatus(record.status));
  }

  list(options: { limit: number; beforeSequence?: number }): { runs: RunRecord[]; nextCursor: number | null } {
    const limit = Math.min(Math.max(options.limit, 1), 100);
    const all = [...this.records.values()]
      .filter((record) => options.beforeSequence === undefined || record.admissionSequence < options.beforeSequence)
      .sort((a, b) => b.admissionSequence - a.admissionSequence);
    const page = all.slice(0, limit);
    const nextCursor = all.length > limit && page.length > 0 ? (page[page.length - 1]?.admissionSequence ?? null) : null;
    return { runs: page, nextCursor };
  }

  countQueued(): number {
    return [...this.records.values()].filter((record) => record.status === 'queued').length;
  }

  tombstone(runId: string): Tombstone | null {
    const file = path.join(this.tombstonesDir, `${runId}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Tombstone;
    } catch {
      return null;
    }
  }

  // -- writes --------------------------------------------------------------

  /** Persist a record atomically: temp file + fsync + rename + directory fsync. */
  save(record: RunRecord): void {
    if (!SAFE_ID.test(record.runId)) throw new Error(`Unsafe run id: ${record.runId}`);
    if (this.unknownSchemaRuns.has(record.runId)) {
      throw new PortalError(503, 'UNAVAILABLE', 'Cannot overwrite a run written by a newer portal schema.');
    }
    this.assertSpaceAvailable();
    record.updatedAt = new Date().toISOString();
    record.revision += 1;
    const runDir = path.join(this.runsDir, record.runId);
    mkdirSync(runDir, { recursive: true });
    const target = path.join(runDir, 'run.json');
    const temp = path.join(runDir, `.run.json.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    const fd = openSync(temp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
    fsyncDir(runDir);
    this.records.set(record.runId, record);
    if (record.idempotencyKey) this.idempotency.set(record.idempotencyKey, record.runId);
  }

  /** Insert a brand-new record; refuses to overwrite an existing run id. */
  insert(record: RunRecord): void {
    if (this.records.has(record.runId)) {
      throw new PortalError(409, 'CONFLICT', 'Run already exists.');
    }
    this.save(record);
  }

  remove(runId: string): void {
    const runDir = path.join(this.runsDir, runId);
    rmSync(runDir, { recursive: true, force: true });
    const record = this.records.get(runId);
    if (record) this.idempotency.delete(record.idempotencyKey);
    this.records.delete(runId);
  }

  // -- logs ----------------------------------------------------------------

  logPath(runId: string, executionId: string): string {
    this.assertSafeId(executionId);
    return path.join(this.runsDir, runId, 'logs', `${executionId}.jsonl`);
  }

  /** Append a JSONL evidence line; truncation is explicit, never silent. */
  appendLog(runId: string, executionId: string, line: string): boolean {
    this.assertSafeId(runId);
    this.assertSafeId(executionId);
    const file = this.logPath(runId, executionId);
    const key = `${runId}/${executionId}`;
    const current = this.logBytes.get(key) ?? (existsSync(file) ? statSync(file).size : 0);
    const encoded = `${line}\n`;
    if (current + Buffer.byteLength(encoded) > this.options.logLimitBytes) {
      this.logBytes.set(key, current);
      return false;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const fd = openSync(file, 'a', 0o600);
    try {
      writeSync(fd, encoded);
    } finally {
      closeSync(fd);
    }
    this.logBytes.set(key, current + Buffer.byteLength(encoded));
    return true;
  }

  readLogTail(runId: string, executionId: string, maxLines: number): string[] {
    const file = this.logPath(runId, executionId);
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, 'utf8').split('\n');
    return raw.slice(Math.max(0, raw.length - 1 - maxLines), -1);
  }

  // -- artifacts -----------------------------------------------------------

  artifactsDir(runId: string): string {
    this.assertSafeId(runId);
    return path.join(this.runsDir, runId, 'artifacts');
  }

  createArtifact(input: CreateArtifactInput): ArtifactRecord {
    this.assertSafeId(input.runId);
    this.assertSafeId(input.executionId);
    const sourceStat = statSync(input.sourcePath);
    if (!sourceStat.isFile()) throw new Error('Artifact source is not a regular file.');
    if (sourceStat.size > this.options.artifactLimitBytes) {
      throw new Error(`Artifact exceeds the per-run artifact limit of ${this.options.artifactLimitBytes} bytes.`);
    }
    this.assertSpaceAvailable(sourceStat.size);
    const artifactId = createHash('sha256')
      .update(`${input.runId}:${input.executionId}:${input.fileName}:${Date.now()}`)
      .digest('hex')
      .slice(0, 32);
    const fileName = safeFileName(input.fileName);
    const dir = path.join(this.artifactsDir(input.runId), artifactId);
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    copyFileSync(input.sourcePath, target);
    const sha256 = hashFile(target);
    return {
      artifactId,
      executionId: input.executionId,
      fileName,
      mediaType: input.mediaType,
      sizeBytes: sourceStat.size,
      sha256,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
  }

  resolveArtifact(runId: string, artifactId: string): { record: RunRecord; artifact: ArtifactRecord; absolutePath: string } {
    this.assertSafeId(runId);
    this.assertSafeId(artifactId);
    const record = this.require(runId);
    let artifact: ArtifactRecord | null = null;
    for (const execution of record.executions) {
      for (const candidate of execution.artifacts) {
        if (candidate.artifactId === artifactId) artifact = candidate;
      }
    }
    if (!artifact) throw new PortalError(404, 'NOT_FOUND', 'Artifact not found.');
    const artifactsDir = this.artifactsDir(runId);
    if (!existsSync(artifactsDir)) throw new PortalError(404, 'NOT_FOUND', 'Artifact not found.');
    const root = realpathSync(artifactsDir);
    const candidatePath = path.join(root, artifactId, artifact.fileName);
    if (!candidatePath.startsWith(`${root}${path.sep}`)) {
      throw new PortalError(404, 'NOT_FOUND', 'Artifact not found.');
    }
    if (!existsSync(candidatePath)) {
      throw new PortalError(404, 'NOT_FOUND', 'Artifact file is missing.');
    }
    const stats = statSync(candidatePath);
    if (!stats.isFile()) throw new PortalError(404, 'NOT_FOUND', 'Artifact is not a regular file.');
    const real = realpathSync(candidatePath);
    if (real !== candidatePath) {
      throw new PortalError(404, 'NOT_FOUND', 'Artifact path escaped its manifest entry.');
    }
    return { record, artifact, absolutePath: candidatePath };
  }

  hashArtifactFile(absolutePath: string): string {
    return hashFile(absolutePath);
  }

  // -- retention and space -------------------------------------------------

  /** Prune only terminal runs whose retention window has expired. */
  prune(now = Date.now()): { pruned: string[]; expiredArtifacts: string[] } {
    const cutoff = now - this.options.retentionDays * 24 * 60 * 60 * 1000;
    const pruned: string[] = [];
    const expiredArtifacts: string[] = [];
    for (const record of [...this.records.values()]) {
      if (!isTerminalRunStatus(record.status)) continue;
      const updated = Date.parse(record.updatedAt);
      if (!Number.isFinite(updated) || updated > cutoff) continue;
      const hasUnexpiredArtifacts = record.executions.some((execution) =>
        execution.artifacts.some((artifact) => Date.parse(artifact.expiresAt) > now),
      );
      if (hasUnexpiredArtifacts) continue;
      expiredArtifacts.push(record.runId);
      this.recordTombstone(record);
      this.remove(record.runId);
      pruned.push(record.runId);
    }
    this.pruneTombstones(now);
    return { pruned, expiredArtifacts };
  }

  private recordTombstone(record: RunRecord): void {
    const tombstone: Tombstone = {
      runId: record.runId,
      artifactsExpireAt: record.artifactsExpireAt,
      prunedAt: new Date().toISOString(),
    };
    const file = path.join(this.tombstonesDir, `${record.runId}.json`);
    writeFileSync(file, JSON.stringify(tombstone), { mode: 0o600 });
  }

  private pruneTombstones(now: number): void {
    const cutoff = now - this.options.retentionDays * 2 * 24 * 60 * 60 * 1000;
    for (const entry of readdirSync(this.tombstonesDir)) {
      const file = path.join(this.tombstonesDir, entry);
      try {
        if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }

  /** Reserve free space before admitting work; throws when the reserve is threatened. */
  assertSpaceAvailable(additionalBytes = 0): void {
    if (this.options.minFreeBytes <= 0) return;
    try {
      const stats = statfsSync(this.options.dataDir);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (free - additionalBytes < this.options.minFreeBytes) {
        throw new PortalError(
          503,
          'UNAVAILABLE',
          `Evidence storage is below the reserved free space (${this.options.minFreeBytes} bytes).`,
        );
      }
    } catch (error) {
      if (error instanceof PortalError) throw error;
      // statfs is unavailable (older platform): do not block on it.
    }
  }

  private assertSafeId(id: string): void {
    if (!SAFE_ID.test(id)) throw new Error(`Unsafe identifier: ${id}`);
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is best effort on platforms that refuse it.
  }
}

function hashFile(file: string): string {
  const hash = createHash('sha256');
  // Synchronous read keeps artifact finalize ordering deterministic; portal
  // artifacts are bounded (1 GiB/run) and read in chunks through the stream.
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, position);
      if (bytes <= 0) break;
      hash.update(buffer.subarray(0, bytes));
      position += bytes;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '_');
  const trimmed = base.replace(/^\.+/, '').slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'artifact.bin';
}

export function streamFile(absolutePath: string): NodeJS.ReadableStream {
  return createReadStream(absolutePath);
}
