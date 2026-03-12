import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import { bootstrapPostgresSchema, createPostgresPool } from '../src/server/db/postgres.ts';
import {
  POSTGRES_TABLE_ORDER,
  resetPostgresSequences,
  truncatePostgresTables,
} from '../src/server/db/postgresSchema.ts';

const BOOLEAN_COLUMNS = new Map<string, Set<string>>([
  ['answers', new Set(['is_correct'])],
  ['practice_attempts', new Set(['is_correct'])],
]);

async function run() {
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    throw new Error('Set DATABASE_URL or DIRECT_URL before migrating data to Supabase Postgres.');
  }

  await bootstrapPostgresSchema();

  const sqlitePath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || 'quizzi.db');
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = createPostgresPool({ preferDirect: true, max: 1 });
  const client = await pool.connect();

  try {
    const summary: Record<string, number> = {};

    await client.query('BEGIN');
    await truncatePostgresTables(client);

    for (const table of POSTGRES_TABLE_ORDER) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      summary[table] = rows.length;

      if (!rows.length) {
        continue;
      }

      const columns = Object.keys(rows[0]);
      const batchSize = 100;

      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        const sql = buildInsertStatement(table, columns, batch.length);
        const values = batch.flatMap((row) =>
          columns.map((column) => normalizeSqliteValue(table, column, row[column])),
        );
        await client.query(sql, values);
      }
    }

    await resetPostgresSequences(client);
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          ok: true,
          sqlitePath,
          imported: summary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    client.release();
    await pool.end();
  }
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

function normalizeSqliteValue(table: string, column: string, value: unknown) {
  if (value === undefined) return null;

  if (BOOLEAN_COLUMNS.get(table)?.has(column)) {
    if (value === null) return null;
    return Boolean(Number(value));
  }

  return value;
}

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
