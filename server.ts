import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { initDb, seedAnalyticsShowcase, seedDemoData } from './src/server/db/index.js';
import { checkPostgresHealth } from './src/server/db/postgres.js';
import { checkSupabaseRestHealth } from './src/server/services/supabaseAdmin.js';
import apiRouter from './src/server/routes/api.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const distDir = path.resolve(process.cwd(), 'dist');
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Enable CORS
  app.use(cors({
    origin: true, // Allow all origins for now, or use req.header('Origin')
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  }));

  // Initialize DB
  seedDemoData();
  seedAnalyticsShowcase();
  // Move health checks after listen to avoid delaying port binding
  const runHealthChecks = async () => {
    try {
      const postgresHealth = await checkPostgresHealth();
      const supabaseRestHealth = await checkSupabaseRestHealth();
      if (postgresHealth.configured) {
        console.log(`[supabase] ${postgresHealth.message}`);
      }
      if (supabaseRestHealth.configured) {
        console.log(`[supabase rest] ${supabaseRestHealth.message}`);
      }
    } catch (err) {
      console.warn('[health] Background check failed:', err);
    }
  };

  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get('/healthz', async (_req, res) => {
    const latestPostgresHealth = await checkPostgresHealth();
    const latestSupabaseRestHealth = await checkSupabaseRestHealth();
    res.json({
      status: 'ok',
      app: 'quizzi',
      primary_db: 'sqlite',
      sqlite_seeded: true,
      supabase_postgres: latestPostgresHealth,
      supabase_rest: latestSupabaseRestHealth,
    });
  });

  // API Routes
  app.use('/api', apiRouter);
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (!req.path.startsWith('/api')) {
      next(error);
      return;
    }

    if (error?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Uploaded file is too large. Maximum size is 8MB.' });
      return;
    }

    res.status(400).json({ error: error?.message || 'Request failed' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] QUIZZI back-end listening on 0.0.0.0:${PORT}`);
    console.log(`[server] Production mode: ${process.env.NODE_ENV === 'production'}`);
    
    // Start background background tasks (non-blocking)
    runHealthChecks();
    seedDemoData();
    seedAnalyticsShowcase();

    // Automatic Keep-Alive Ping for Render Free Tier Instances
    const renderExternalUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (renderExternalUrl) {
      console.log(`[keep-alive] Auto-ping activated for ${renderExternalUrl}`);
      setInterval(async () => {
        try {
          const res = await fetch(`${renderExternalUrl}/healthz`);
          console.log(`[keep-alive] Pinged ${renderExternalUrl}/healthz: ${res.status}`);
        } catch (err) {
          console.error('[keep-alive] Ping failed:', err);
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
  });

}

startServer();
