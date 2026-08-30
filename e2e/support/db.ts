import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

/**
 * Minimal MySQL query helper for e2e database verification.
 *
 * Playwright test processes do NOT inherit backend/.env, so the connection
 * config is loaded explicitly from the repo's backend env file. Prefers
 * TEST_DATABASE_URL (falls back to DATABASE_URL / DATABASE_DIRECT_URL).
 *
 * The helper owns a lazy singleton pool; call `closeDb()` (e.g. from an
 * `afterAll` hook) when the spec is done so the Node process can exit.
 */

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

let pool: mysql.Pool | null = null;

function resolveDatabaseUrl(): string {
  const url =
    process.env['TEST_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    process.env['DATABASE_DIRECT_URL'];
  if (!url || url.length === 0) {
    throw new Error(
      'No database URL configured. Expected TEST_DATABASE_URL or DATABASE_URL in backend/.env.',
    );
  }
  return url;
}

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: resolveDatabaseUrl(),
      connectionLimit: 2,
      // The Railway MySQL session is UTC (see backend/.env notes); do not
      // let the driver convert TIMESTAMP values into local time.
      timezone: 'Z',
      dateStrings: true,
    });
  }
  return pool;
}

export type SqlParam = string | number | bigint | boolean | Date | null | Buffer | Uint8Array;

export async function queryDb<T extends object>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}

/**
 * Execute a non-SELECT statement (UPDATE/DELETE/INSERT) and return the number
 * of affected rows. mysql2 resolves UPDATE/DELETE with a ResultSetHeader
 * object instead of a rows array, which queryDb's SELECT-oriented typing
 * cannot surface (e.g. E2E-04's deadline manipulation).
 */
export async function executeUpdate(sql: string, params: SqlParam[] = []): Promise<number> {
  const [result] = await getPool().execute(sql, params);
  const affected = (result as mysql.ResultSetHeader).affectedRows;
  return Number(affected);
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
