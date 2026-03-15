import { seedAnalyticsShowcase, seedDemoData } from '../src/server/db/seeding.ts';
import { initDb } from '../src/server/db/index.ts';

initDb();

async function main() {
  await seedDemoData();
  const result = await seedAnalyticsShowcase();

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
        route: result.sessionId ? `/teacher/analytics/class/${result.sessionId}` : null,
      },
    null,
    2,
  ),
);
}

main().catch(console.error);
