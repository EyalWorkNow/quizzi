import { initDb, seedAnalyticsShowcase, seedDemoData } from '../src/server/db/index.ts';

initDb();
seedDemoData();
const result = seedAnalyticsShowcase();

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
