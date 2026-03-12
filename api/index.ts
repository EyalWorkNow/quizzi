import express from 'express';
import apiRouter from '../src/server/routes/api.js';
import { initDb, seedAnalyticsShowcase, seedDemoData } from '../src/server/db/index.js';
import { checkPostgresHealth } from '../src/server/db/postgres.js';
import { checkSupabaseRestHealth } from '../src/server/services/supabaseAdmin.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

try {
  initDb();
  seedDemoData();
  seedAnalyticsShowcase();
} catch (error) {
  console.warn('Initialization warnings (expected on Vercel read-only or empty memory DB):', error);
}

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get('/api/healthz', async (_req, res) => {
  const latestPostgresHealth = await checkPostgresHealth();
  const latestSupabaseRestHealth = await checkSupabaseRestHealth();
  res.json({
    status: 'ok',
    app: 'quizzi',
    primary_db: 'sqlite',
    environment: 'vercel_serverless',
    supabase_postgres: latestPostgresHealth,
    supabase_rest: latestSupabaseRestHealth,
  });
});

app.use('/api', apiRouter);

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'Uploaded file is too large. Maximum size is 8MB.' });
    return;
  }
  res.status(400).json({ error: error?.message || 'Request failed' });
});

export default app;
