import mysql from "mysql2/promise";
import { log, metrics } from "./telemetry.js";

/**
 * One environment-scoped MySQL advisory lock held by ONE dedicated connection.
 *
 * Why a dedicated connection: MySQL advisory locks are released when the
 * session ends. Taking the lock from a pooled connection would let the pool
 * close that session (or hand it to another query) and silently drop the lock
 * while this process still believed it was the singleton.
 *
 * Failure behavior (all fail closed):
 *   - readiness is false until the lock is held;
 *   - a second process waits `lockTimeoutSeconds` and then exits non-zero;
 *   - if the connection is lost or ownership cannot be confirmed, readiness
 *     becomes false, every socket closes with a retryable reason, and the
 *     process exits — a blue/green overlap must never produce split rooms.
 */
export interface SingletonLockOptions {
  dsn: string;
  lockName: string;
  lockTimeoutSeconds: number;
  /** Confirmation interval for `IS_USED_LOCK` (ownership check). */
  confirmIntervalMs?: number;
}

/** Reason the lock was reported lost, for logs only (never a metric label). */
export type LockLossHandler = (reason: string) => void;

const DEFAULT_CONFIRM_INTERVAL_MS = 5_000;

export class SingletonLock {
  private readonly options: SingletonLockOptions;
  private connection: mysql.Connection | null = null;
  private held = false;
  private confirmTimer: ReturnType<typeof setInterval> | null = null;
  private lost = false;
  /** Set by the service that owns this lock. */
  onLost: LockLossHandler = () => {};

  constructor(options: SingletonLockOptions) {
    this.options = options;
  }

  isReady(): boolean {
    return this.held && !this.lost;
  }

  /** Acquires the lock or throws (the caller exits non-zero). */
  async acquire(): Promise<void> {
    const connection = await mysql.createConnection({
      uri: this.options.dsn,
      // The lock connection is deliberately NOT part of an application pool.
      multipleStatements: false,
    });
    this.connection = connection;
    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT GET_LOCK(?, ?) AS acquired",
        [this.options.lockName, this.options.lockTimeoutSeconds],
      );
      const acquired = Number(rows[0]?.["acquired"] ?? 0);
      if (acquired !== 1) {
        throw new Error(
          `another authoring-coedit process already owns ${this.options.lockName}`,
        );
      }
      this.held = true;
      metrics.setGauge("authoring_coedit_singleton_lock", 1);
      connection.on("error", (error: Error) => {
        this.markLost(`lock connection error: ${error.message}`);
      });
      this.armConfirmation();
    } catch (error) {
      await this.release().catch(() => undefined);
      throw error;
    }
  }

  private armConfirmation(): void {
    const interval = this.options.confirmIntervalMs ?? DEFAULT_CONFIRM_INTERVAL_MS;
    this.confirmTimer = setInterval(() => {
      void this.confirmOwnership();
    }, interval);
  }

  /**
   * Confirms this session still owns the lock.
   *
   * `IS_USED_LOCK` returns the connection id that holds the lock, or NULL when
   * nobody does. Comparing it against our own connection id is the only
   * trustworthy ownership check available to MySQL clients.
   */
  async confirmOwnership(): Promise<void> {
    if (!this.connection || this.lost) return;
    try {
      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
        "SELECT IS_USED_LOCK(?) AS owner, CONNECTION_ID() AS self",
        [this.options.lockName],
      );
      const owner = rows[0]?.["owner"];
      const self = rows[0]?.["self"];
      if (owner === null || owner === undefined) {
        this.markLost("singleton lock is no longer held");
        return;
      }
      if (String(owner) !== String(self)) {
        this.markLost("singleton lock is owned by another session");
      }
    } catch (error) {
      this.markLost(`lock confirmation failed: ${(error as Error).message}`);
    }
  }

  private markLost(reason: string): void {
    if (this.lost) return;
    this.lost = true;
    this.held = false;
    metrics.setGauge("authoring_coedit_singleton_lock", 0);
    log("error", "singleton lock lost", { event: "singleton_lock_lost", reason });
    if (this.confirmTimer) {
      clearInterval(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.onLost(reason);
  }

  async release(): Promise<void> {
    if (this.confirmTimer) {
      clearInterval(this.confirmTimer);
      this.confirmTimer = null;
    }
    const connection = this.connection;
    this.connection = null;
    this.held = false;
    metrics.setGauge("authoring_coedit_singleton_lock", 0);
    if (!connection) return;
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [this.options.lockName]);
    } catch {
      // Releasing is best-effort; the session close below releases it anyway.
    }
    try {
      await connection.end();
    } catch {
      // Ignore.
    }
  }
}
