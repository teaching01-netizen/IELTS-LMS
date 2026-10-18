import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';

/**
 * Disposable test-database provisioning.
 *
 * The controller holds a dedicated admin credential used ONLY to create and
 * drop the per-execution schema and its least-privilege user. Child test
 * processes receive the scoped URL and never the admin credential.
 */

export interface LocalDatabaseHandle {
  database: string;
  userName: string;
  url: string;
  goDsn: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

interface ParsedAdminUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  baseDatabase: string;
}

function parseAdminUrl(raw: string): ParsedAdminUrl {
  const url = new URL(raw);
  if (url.protocol !== 'mysql:') throw new Error('PORTAL_TEST_DB_ADMIN_URL must use the mysql:// scheme.');
  if (!url.username) throw new Error('PORTAL_TEST_DB_ADMIN_URL must include a user.');
  const database = url.pathname.replace(/^\//, '');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    baseDatabase: database || 'mysql',
  };
}

function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}

export async function provisionLocalDatabase(
  adminUrl: string,
  options?: { prefix?: string; migrationsDir?: string; repoRoot?: string },
): Promise<LocalDatabaseHandle> {
  const admin = parseAdminUrl(adminUrl);
  const suffix = randomSuffix();
  const database = `${options?.prefix ?? 'portal_test'}_${suffix}`;
  const userName = `${options?.prefix ?? 'portal_test'}_${suffix}`;
  const password = randomBytes(18).toString('base64url');
  const connection = await mysql.createConnection({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password,
    database: admin.baseDatabase,
    multipleStatements: false,
  });
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`CREATE USER '${userName}'@'%' IDENTIFIED BY ?`, [password]);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${userName}'@'%'`);
    created = true;
  } catch (error) {
    if (created) {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
      await connection.query(`DROP USER IF EXISTS '${userName}'@'%'`).catch(() => undefined);
    }
    throw error;
  } finally {
    await connection.end();
  }

  const url = `mysql://${encodeURIComponent(userName)}:${encodeURIComponent(password)}@${admin.host}:${admin.port}/${database}`;
  const goDsn = `${userName}:${password}@tcp(${admin.host}:${admin.port})/${database}?parseTime=true&multiStatements=true&charset=utf8mb4`;
  const migrationsDir = options?.migrationsDir ?? 'backend/go/migrations';
  const env: Record<string, string> = {
    DATABASE_URL: goDsn,
    DATABASE_DIRECT_URL: goDsn,
    TEST_DATABASE_URL: url,
    TEST_MYSQL_DSN: goDsn,
    AUTHORING_COEDIT_MYSQL_DSN: url,
    COEDIT_LIVE_DATABASE_URL: url,
    COEDIT_LIVE_PREPROVISIONED_DB: 'true',
    MIGRATIONS_DIR: migrationsDir,
  };

  return {
    database,
    userName,
    url,
    goDsn,
    env,
    cleanup: async () => {
      const adminConnection = await mysql.createConnection({
        host: admin.host,
        port: admin.port,
        user: admin.user,
        password: admin.password,
        database: admin.baseDatabase,
      });
      try {
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await adminConnection.query(`DROP USER IF EXISTS '${userName}'@'%'`);
      } finally {
        await adminConnection.end();
      }
    },
  };
}
