import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { seedAnalyticsShowcase, seedDemoData } from './src/server/db/seeding.js';
import { checkPostgresHealth, closePostgresPool } from './src/server/db/postgres.js';
import { checkSupabaseRestHealth } from './src/server/services/supabaseAdmin.js';
import { getTrustedOrigins } from './src/server/services/requestGuards.js';
import apiRouter from './src/server/routes/api.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const distDir = path.resolve(process.cwd(), 'dist');
  const allowedOrigins = getTrustedOrigins();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, origin);
      if (process.env.NODE_ENV !== 'production') return callback(null, origin);
      console.warn(`[cors] Blocked origin: ${origin}`);
      callback(null, false);
    },
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
    const requestId = String(req.headers['x-request-id'] || randomUUID());
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (process.env.NODE_ENV === 'production') {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
      if (forwardedProto.includes('https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get('/healthz', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
    
    // Start background tasks after the port is bound.
    runHealthChecks();

    // Automatic Keep-Alive Ping for Render Free Tier Instances
    const renderExternalUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (renderExternalUrl) {
      console.log(`[keep-alive] Auto-ping activated for ${renderExternalUrl}`);
      const keepAliveTimer = setInterval(async () => {
        try {
          const res = await fetch(`${renderExternalUrl}/healthz`);
          console.log(`[keep-alive] Pinged ${renderExternalUrl}/healthz: ${res.status}`);
        } catch (err) {
          console.error('[keep-alive] Ping failed:', err);
        }
      }, 5 * 60 * 1000); // 5 minutes
      keepAliveTimer.unref?.();
    }
  });

  server.keepAliveTimeout = Number(process.env.QUIZZI_KEEP_ALIVE_TIMEOUT_MS || 5_000);
  server.headersTimeout = Number(process.env.QUIZZI_HEADERS_TIMEOUT_MS || 10_000);
  server.requestTimeout = Number(process.env.QUIZZI_REQUEST_TIMEOUT_MS || 65_000);
  server.on('clientError', (error, socket) => {
    console.warn('[server] clientError', error?.message || error);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] Received ${signal}, draining connections...`);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await closePostgresPool().catch((error) => {
      console.warn('[server] Failed to close Postgres pool cleanly:', error);
    });
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

startServer();
