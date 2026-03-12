import 'dotenv/config';
import { bootstrapPostgresSchema, checkPostgresHealth } from '../src/server/db/postgres.ts';

async function run() {
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    throw new Error('Set DATABASE_URL or DIRECT_URL before bootstrapping Supabase Postgres.');
  }

  const bootstrap = await bootstrapPostgresSchema();
  const health = await checkPostgresHealth();

  console.log(
    JSON.stringify(
      {
        ok: true,
        bootstrap,
        health,
      },
      null,
      2,
    ),
  );
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
