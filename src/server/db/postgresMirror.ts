import type Database from 'better-sqlite3';
import { bootstrapPostgresSchema, createPostgresPool, isPostgresConfigured } from './postgres.js';
import { POSTGRES_TABLE_ORDER, resetPostgresSequences } from './postgresSchema.js';

type MirrorAction =
  | 'not_configured'
  | 'empty'
  | 'balanced'
  | 'sqlite_to_supabase'
  | 'supabase_to_sqlite'
  | 'failed';

export type PostgresMirrorStatus = {
  configured: boolean;
  active: boolean;
  ready: boolean;
  sqlitePath: string;
  initialAction: MirrorAction | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncedTables: string[];
  pendingTables: string[];
};

type CountsByTable = Record<(typeof POSTGRES_TABLE_ORDER)[number], number>;

const SQLITE_BOOLEAN_COLUMNS = new Map<string, Set<string>>([
  ['answers', new Set(['is_correct'])],
  ['practice_attempts', new Set(['is_correct'])],
]);

const MUTATION_PATTERNS = [
  /^\s*insert\s+into\s+["`[]?([a-z_][\w]*)/i,
  /^\s*update\s+["`[]?([a-z_][\w]*)/i,
  /^\s*delete\s+from\s+["`[]?([a-z_][\w]*)/i,
  /^\s*replace\s+into\s+["`[]?([a-z_][\w]*)/i,
  /^\s*alter\s+table\s+["`[]?([a-z_][\w]*)/i,
  /^\s*create\s+table(?:\s+if\s+not\s+exists)?\s+["`[]?([a-z_][\w]*)/i,
  /^\s*drop\s+table(?:\s+if\s+exists)?\s+["`[]?([a-z_][\w]*)/i,
  /^\s*truncate\s+table\s+["`[]?([a-z_][\w]*)/i,
] as const;

const DEFAULT_SYNC_DEBOUNCE_MS = Math.max(750, Number(process.env.QUIZZI_POSTGRES_SYNC_DEBOUNCE_MS || 4000));

export function createPostgresMirror(db: Database.Database, options: { sqlitePath: string }) {
  let active = false;
  let ready = false;
  let initialAction: MirrorAction | null = isPostgresConfigured() ? null : 'not_configured';
  let lastSyncAt: string | null = null;
  let lastSyncError: string | null = null;
  let lastSyncedTables: string[] = [];
  let suppressWriteTracking = false;
  const pendingDirtyTables = new Set<string>();
  const transactionStack: Array<Set<string>> = [];
  let syncTimer: NodeJS.Timeout | null = null;
  let syncInFlight: Promise<void> | null = null;
  let syncQueuedDuringFlight = false;

  function getStatus(): PostgresMirrorStatus {
    return {
      configured: isPostgresConfigured(),
      active,
      ready,
      sqlitePath: options.sqlitePath,
      initialAction,
      lastSyncAt,
      lastSyncError,
      lastSyncedTables: [...lastSyncedTables],
      pendingTables: sortTables([...pendingDirtyTables]),
    };
  }

  async function setup() {
    if (!isPostgresConfigured()) {
      return getStatus();
    }

    try {
      await bootstrapPostgresSchema();
      active = true;
      ready = false;
      lastSyncError = null;
      initialAction = await reconcileMirror();
      ready = true;
      console.log(`[db] Postgres mirror ready (${initialAction})`);
    } catch (error) {
      active = false;
      ready = false;
      initialAction = 'failed';
      lastSyncError = formatError(error);
      console.error('[db] Postgres mirror setup failed:', error);
    }

    return getStatus();
  }

  function wrapDatabase() {
    const instrumentedDb = db as Database.Database & { __postgresMirrorWrapped?: boolean };
    if (instrumentedDb.__postgresMirrorWrapped) return;
    instrumentedDb.__postgresMirrorWrapped = true;

    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      const mutatedTables = extractMutatedTables(sql);
      if (!mutatedTables.length) {
        return statement;
      }

      const originalRun = statement.run.bind(statement);
      (statement as any).run = ((...args: any[]) => {
        const result = originalRun(...args);
        recordDirtyTables(mutatedTables);
        return result;
      }) as typeof statement.run;

      return statement;
    }) as typeof db.prepare;

    const originalTransaction = db.transaction.bind(db);
    (db as any).transaction = (((fn: (...args: any[]) => unknown) =>
      originalTransaction((...args: any[]) => runTrackedTransaction(fn, args))) as typeof db.transaction);
  }

  async function reconcileMirror(): Promise<MirrorAction> {
    const sqliteCounts = getSqliteTableCounts(db);
    const postgresCounts = await withPostgresConnection(async (client) => getPostgresTableCounts(client));
    const sqliteTotal = sumCounts(sqliteCounts);
    const postgresTotal = sumCounts(postgresCounts);
    const hasCountMismatch = POSTGRES_TABLE_ORDER.some((table) => sqliteCounts[table] !== postgresCounts[table]);

    if (sqliteTotal === 0 && postgresTotal === 0) {
      return 'empty';
    }

    if (postgresTotal > sqliteTotal || (postgresTotal === sqliteTotal && hasCountMismatch)) {
      await withPostgresConnection(async (client) => hydrateSqliteFromPostgres(client));
      return 'supabase_to_sqlite';
    }

    if (sqliteTotal > postgresTotal) {
      await withPostgresConnection(async (client) => syncTablesToPostgres(client, POSTGRES_TABLE_ORDER));
      lastSyncAt = new Date().toISOString();
      lastSyncedTables = [...POSTGRES_TABLE_ORDER];
      return 'sqlite_to_supabase';
    }

    return 'balanced';
  }

  function runTrackedTransaction<T>(fn: (...args: any[]) => T, args: any[]): T {
    transactionStack.push(new Set<string>());
    try {
      const result = fn(...args);
      const completedTables = transactionStack.pop() || new Set<string>();

      if (transactionStack.length) {
        mergeTables(transactionStack[transactionStack.length - 1], completedTables);
      } else {
        queueDirtyTables(completedTables);
      }

      return result;
    } catch (error) {
      transactionStack.pop();
      throw error;
    }
  }

  function recordDirtyTables(tables: string[]) {
    if (suppressWriteTracking || !isPostgresConfigured()) {
      return;
    }

    if (transactionStack.length) {
      mergeTables(transactionStack[transactionStack.length - 1], tables);
      return;
    }

    queueDirtyTables(tables);
  }

  function queueDirtyTables(tables: Iterable<string>) {
    let changed = false;
    for (const table of tables) {
      if (!POSTGRES_TABLE_ORDER.includes(table as (typeof POSTGRES_TABLE_ORDER)[number])) {
        continue;
      }
      if (pendingDirtyTables.has(table)) {
        continue;
      }
      pendingDirtyTables.add(table);
      changed = true;
    }

    if (!changed || !active || !ready) {
      return;
    }

    scheduleSync();
  }

  function scheduleSync(delayMs = DEFAULT_SYNC_DEBOUNCE_MS) {
    if (syncTimer) return;

    syncTimer = setTimeout(() => {
      syncTimer = null;
      void flushDirtyTables();
    }, delayMs);
    syncTimer.unref?.();
  }

  async function flushDirtyTables() {
    if (!active || !ready || !pendingDirtyTables.size) {
      return;
    }

    if (syncInFlight) {
      syncQueuedDuringFlight = true;
      return syncInFlight;
    }

    const tables = sortTables([...pendingDirtyTables]);
    pendingDirtyTables.clear();

    syncInFlight = (async () => {
      try {
        await withPostgresConnection(async (client) => syncTablesToPostgres(client, tables));
        lastSyncAt = new Date().toISOString();
        lastSyncError = null;
        lastSyncedTables = tables;
      } catch (error) {
        lastSyncError = formatError(error);
        mergeTables(pendingDirtyTables, tables);
        console.error('[db] Postgres mirror sync failed:', error);
        scheduleSync(Math.max(DEFAULT_SYNC_DEBOUNCE_MS, 10_000));
      } finally {
        syncInFlight = null;
        if (syncQueuedDuringFlight || pendingDirtyTables.size) {
          syncQueuedDuringFlight = false;
          scheduleSync(1_000);
        }
      }
    })();

    return syncInFlight;
  }

  async function hydrateSqliteFromPostgres(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }) {
    const rowsByTable = new Map<string, any[]>();
    for (const table of POSTGRES_TABLE_ORDER) {
      const result = await client.query(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY id ASC`);
      rowsByTable.set(table, result.rows || []);
    }

    const sqliteColumnsByTable = new Map<string, string[]>();
    for (const table of POSTGRES_TABLE_ORDER) {
      sqliteColumnsByTable.set(
        table,
        ((db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as any[]) || []).map((column) => String(column.name)),
      );
    }

    suppressWriteTracking = true;
    try {
      db.pragma('foreign_keys = OFF');
      const applySnapshot = db.transaction(() => {
        for (const table of [...POSTGRES_TABLE_ORDER].reverse()) {
          db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
        }
        db.prepare('DELETE FROM sqlite_sequence').run();

        for (const table of POSTGRES_TABLE_ORDER) {
          const rows = rowsByTable.get(table) || [];
          if (!rows.length) continue;

          const columns = (sqliteColumnsByTable.get(table) || []).filter((column) => column in rows[0]);
          if (!columns.length) continue;

          const insert = db.prepare(`
            INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
          `);

          for (const row of rows) {
            insert.run(...columns.map((column) => normalizePostgresValueForSqlite(table, column, row[column])));
          }
        }
      });

      applySnapshot();
    } finally {
      db.pragma('foreign_keys = ON');
      suppressWriteTracking = false;
    }
  }

  async function syncTablesToPostgres(
    client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
    },
    tables: readonly string[],
  ) {
    const orderedTables = sortTables(tables);

    await client.query('BEGIN');
    try {
      for (const table of orderedTables) {
        await replacePostgresTableFromSqlite(client, table);
      }
      await resetPostgresSequences(client as any);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  async function replacePostgresTableFromSqlite(
    client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
    },
    table: string,
  ) {
    await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY id ASC`).all() as Array<Record<string, unknown>>;
    if (!rows.length) return;

    const columns = Object.keys(rows[0]);
    const batchSize = 200;

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const sql = buildInsertStatement(table, columns, batch.length);
      const values = batch.flatMap((row) =>
        columns.map((column) => normalizeSqliteValueForPostgres(table, column, row[column])),
      );
      await client.query(sql, values);
    }
  }

  async function withPostgresConnection<T>(
    work: (client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
    }) => Promise<T>,
  ) {
    const pool = createPostgresPool({ preferDirect: true, max: 1 });
    const client = await pool.connect();

    try {
      return await work(client);
    } finally {
      client.release();
      await pool.end();
    }
  }

  return {
    getStatus,
    setup,
    wrapDatabase,
  };
}

function extractMutatedTables(sql: string) {
  const normalized = String(sql || '').trim();
  if (!normalized) return [];

  for (const pattern of MUTATION_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const table = String(match[1]).replace(/["`\]]/g, '');
    if (POSTGRES_TABLE_ORDER.includes(table as (typeof POSTGRES_TABLE_ORDER)[number])) {
      return [table];
    }
  }

  return [];
}

function mergeTables(target: Set<string>, source: Iterable<string>) {
  for (const table of source) {
    target.add(table);
  }
}

function sortTables(tables: readonly string[]) {
  const order = new Map(POSTGRES_TABLE_ORDER.map((table, index) => [table, index]));
  return [...new Set(tables)].sort((left, right) => {
    const leftOrder = order.get(left as (typeof POSTGRES_TABLE_ORDER)[number]) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right as (typeof POSTGRES_TABLE_ORDER)[number]) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function getSqliteTableCounts(db: Database.Database): CountsByTable {
  const entries = POSTGRES_TABLE_ORDER.map((table) => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count?: number };
    return [table, Number(row?.count || 0)];
  });
  return Object.fromEntries(entries) as CountsByTable;
}

async function getPostgresTableCounts(client: {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}): Promise<CountsByTable> {
  const entries: Array<readonly [string, number]> = [];
  for (const table of POSTGRES_TABLE_ORDER) {
    const result = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM ${quoteIdentifier(table)}`);
    entries.push([table, Number(result.rows[0]?.count || 0)] as const);
  }
  return Object.fromEntries(entries) as CountsByTable;
}

function sumCounts(counts: CountsByTable) {
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

function buildInsertStatement(table: string, columns: string[], rowCount: number) {
  const columnSql = columns.map(quoteIdentifier).join(', ');
  const valuesSql = Array.from({ length: rowCount }, (_unused, rowIndex) => {
    const placeholderSql = columns
      .map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`)
      .join(', ');
    return `(${placeholderSql})`;
  }).join(', ');

  return `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES ${valuesSql}`;
}

function normalizeSqliteValueForPostgres(table: string, column: string, value: unknown) {
  if (value === undefined) return null;

  if (SQLITE_BOOLEAN_COLUMNS.get(table)?.has(column)) {
    if (value === null) return null;
    return Boolean(Number(value));
  }

  return value;
}

function normalizePostgresValueForSqlite(table: string, column: string, value: unknown) {
  if (value === undefined) return null;

  if (SQLITE_BOOLEAN_COLUMNS.get(table)?.has(column)) {
    if (value === null) return null;
    return Number(Boolean(value));
  }

  return value;
}

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
