import { Pool, type PoolConfig } from 'pg';
import { applyPostgresSchema } from './postgresSchema.js';

export type PostgresHealth = {
  configured: boolean;
  ok: boolean;
  database: string | null;
  host: string | null;
  checkedAt: string;
  message: string;
};

type PoolOptions = {
  preferDirect?: boolean;
  max?: number;
};

let sharedRuntimePool: Pool | null = null;

export function getPostgresConnectionString(options: PoolOptions = {}) {
  const pooled = String(process.env.DATABASE_URL || '').trim();
  const direct = String(process.env.DIRECT_URL || '').trim();

  if (options.preferDirect) {
    return direct || pooled || '';
  }

  return pooled || direct || '';
}

export function isPostgresConfigured() {
  return Boolean(getPostgresConnectionString());
}

export function describePostgresConnection(options: PoolOptions = {}) {
  const connectionString = getPostgresConnectionString(options);
  if (!connectionString) {
    return { configured: false, host: null, database: null };
  }

  try {
    const parsed = new URL(connectionString);
    return {
      configured: true,
      host: parsed.hostname || null,
      database: parsed.pathname.replace(/^\//, '') || null,
    };
  } catch {
    return { configured: true, host: null, database: null };
  }
}

export function createPostgresPool(options: PoolOptions = {}) {
  const connectionString = getPostgresConnectionString(options);
  if (!connectionString) {
    throw new Error('DATABASE_URL or DIRECT_URL must be set before connecting to Postgres.');
  }

  const config: PoolConfig = {
    connectionString,
    max: options.max ?? (options.preferDirect ? 2 : 6),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_500,
  };

  if (shouldUseSsl(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
}

export function getPostgresPool() {
  if (!sharedRuntimePool) {
    sharedRuntimePool = createPostgresPool();
  }

  return sharedRuntimePool;
}

export async function closePostgresPool() {
  if (!sharedRuntimePool) return;
  await sharedRuntimePool.end();
  sharedRuntimePool = null;
}

export async function checkPostgresHealth(options: PoolOptions = {}): Promise<PostgresHealth> {
  const summary = describePostgresConnection(options);
  if (!summary.configured) {
    return {
      configured: false,
      ok: false,
      database: null,
      host: null,
      checkedAt: new Date().toISOString(),
      message: 'Supabase Postgres is not configured yet.',
    };
  }

  const pool = options.preferDirect ? createPostgresPool({ ...options, max: 1 }) : getPostgresPool();

  try {
    const result = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
    return {
      configured: true,
      ok: true,
      database: result.rows[0]?.database_name || summary.database,
      host: summary.host,
      checkedAt: new Date().toISOString(),
      message: 'Supabase Postgres connection is healthy.',
    };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      database: summary.database,
      host: summary.host,
      checkedAt: new Date().toISOString(),
      message: error?.message || 'Supabase Postgres connection failed.',
    };
  } finally {
    if (options.preferDirect) {
      await pool.end();
    }
  }
}

export async function bootstrapPostgresSchema() {
  const pool = createPostgresPool({ preferDirect: true, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await applyPostgresSchema(client);
    await client.query('COMMIT');
    return {
      ok: true,
      ...describePostgresConnection({ preferDirect: true }),
      message: 'Supabase Postgres schema is ready.',
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function shouldUseSsl(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    return /supabase\.co$/.test(parsed.hostname) || /pooler\.supabase\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}
