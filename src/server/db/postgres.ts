import { Pool, type PoolConfig } from 'pg';
import { applyPostgresSchema } from './postgresSchema.js';

export type PostgresHealth = {
  configured: boolean;
  ok: boolean;
  database: string | null;
  host: string | null;
  source: string | null;
  checkedAt: string;
  message: string;
};

type PoolOptions = {
  preferDirect?: boolean;
  max?: number;
};

let sharedRuntimePool: Pool | null = null;
let warnedAboutSuspiciousDirectUrl = false;

const POOLED_CONNECTION_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_DB_URL',
] as const;

const DIRECT_CONNECTION_ENV_KEYS = [
  'DIRECT_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_DIRECT_URL',
  'SUPABASE_DIRECT_URL',
] as const;

function resolveEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) {
      return {
        key,
        value,
      };
    }
  }

  return {
    key: null,
    value: '',
  };
}

function normalizeEnvValue(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function pointsToSupabasePooler(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    return /pooler\.supabase\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveConnectionCandidate(options: PoolOptions = {}) {
  const pooled = resolveEnvValue(POOLED_CONNECTION_ENV_KEYS);
  const direct = resolveEnvValue(DIRECT_CONNECTION_ENV_KEYS);

  if (options.preferDirect) {
    const suspiciousDirect = Boolean(direct.value) && pointsToSupabasePooler(direct.value);
    if (suspiciousDirect && pooled.value) {
      if (!warnedAboutSuspiciousDirectUrl) {
        warnedAboutSuspiciousDirectUrl = true;
        console.warn(
          `[db] ${direct.key} points at the Supabase pooler host, so mirror/setup operations will fall back to ${pooled.key}.`,
        );
      }
      return {
        key: pooled.key,
        value: pooled.value,
      };
    }

    return {
      key: direct.key || pooled.key,
      value: direct.value || pooled.value,
    };
  }

  return {
    key: pooled.key || direct.key,
    value: pooled.value || direct.value,
  };
}

export function getPostgresConnectionString(options: PoolOptions = {}) {
  return resolveConnectionCandidate(options).value || '';
}

export function getPostgresConnectionSource(options: PoolOptions = {}) {
  return resolveConnectionCandidate(options).key || null;
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
      source: getPostgresConnectionSource(options),
    };
  } catch {
    return { configured: true, host: null, database: null, source: getPostgresConnectionSource(options) };
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
    connectionTimeoutMillis: Math.max(3_500, Number(process.env.QUIZZI_POSTGRES_CONNECT_TIMEOUT_MS || 15_000)),
    keepAliveInitialDelayMillis: 10_000,
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
      source: null,
      checkedAt: new Date().toISOString(),
      message:
        'Supabase Postgres is not configured yet. Set DATABASE_URL or DIRECT_URL (or POSTGRES_URL / POSTGRES_URL_NON_POOLING).',
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
      source: summary.source,
      checkedAt: new Date().toISOString(),
      message: 'Supabase Postgres connection is healthy.',
    };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      database: summary.database,
      host: summary.host,
      source: summary.source,
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
    await applyPostgresSchema(client);
    return {
      ok: true,
      ...describePostgresConnection({ preferDirect: true }),
      message: 'Supabase Postgres schema is ready.',
    };
  } catch (error: any) {
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
