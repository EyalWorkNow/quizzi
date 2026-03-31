console.log('[server] Initializing with process.cwd:', process.cwd());
import 'dotenv/config';
console.log('[server] Environment loaded. NODE_ENV:', process.env.NODE_ENV);

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';

import { seedAnalyticsShowcase, seedDemoData } from './src/server/db/seeding.js';
import { flushPostgresMirror, getPostgresMirrorStatus, getSqliteStorageStatus } from './src/server/db/index.js';
import { checkPostgresHealth, closePostgresPool } from './src/server/db/postgres.js';
import { checkSupabaseRestHealth } from './src/server/services/supabaseAdmin.js';
import { isAllowedBrowserOrigin, normalizeOrigin } from './src/server/services/requestGuards.js';
import { assertSecureAuthConfig, getAuthSecretStatus } from './src/server/services/authSecrets.js';
import { logMailHealth } from './src/server/services/mailer.js';
import apiRouter from './src/server/routes/api.js';

// Global error handlers for better logging on Render
process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  // Give some time for logs to flush before exiting
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});


function resolveConfiguredEnvKey(keys: readonly string[]) {
  for (const key of keys) {
    if (String(process.env[key] || '').trim()) {
      return key;
    }
  }

  return null;
}

function shouldRequireSupabaseMirrorInProduction() {
  const configuredValue = String(process.env.QUIZZI_REQUIRE_SUPABASE_MIRROR || '').trim().toLowerCase();
  if (!configuredValue) return process.env.NODE_ENV === 'production';
  return !['0', 'false', 'no', 'off'].includes(configuredValue);
}

function isUnsafePersistenceExplicitlyAllowed() {
  const configuredValue = String(process.env.QUIZZI_ALLOW_UNSAFE_PERSISTENCE || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(configuredValue);
}

function getStartupConfigSummary() {
  const sqliteStorage = getSqliteStorageStatus();

  return {
    node_env: process.env.NODE_ENV || 'development',
    app_url_configured: Boolean(String(process.env.APP_URL || '').trim()),
    render_external_url_configured: Boolean(String(process.env.RENDER_EXTERNAL_URL || '').trim()),
    render_disk_path_configured: Boolean(String(process.env.RENDER_DISK_PATH || '').trim()),
    sqlite_storage: sqliteStorage,
    auth_signing: getAuthSecretStatus(),
    postgres: {
      require_mirror: shouldRequireSupabaseMirrorInProduction(),
      pooled_source: resolveConfiguredEnvKey([
        'DATABASE_URL',
        'POSTGRES_URL',
        'SUPABASE_DATABASE_URL',
        'SUPABASE_DB_URL',
      ]),
      direct_source: resolveConfiguredEnvKey([
        'DIRECT_URL',
        'POSTGRES_URL_NON_POOLING',
        'POSTGRES_DIRECT_URL',
        'SUPABASE_DIRECT_URL',
      ]),
    },
    supabase_rest: {
      url_source: resolveConfiguredEnvKey([
        'SUPABASE_URL',
        'VITE_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
      ]),
      key_source: resolveConfiguredEnvKey([
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ]),
    },
  };
}

function assertSafePersistenceConfig() {
  if (process.env.NODE_ENV !== 'production' || isUnsafePersistenceExplicitlyAllowed()) {
    return;
  }

  const mirrorStatus = getPostgresMirrorStatus();
  const sqliteStatus = getSqliteStorageStatus();

  if (shouldRequireSupabaseMirrorInProduction() && !mirrorStatus.configured) {
    throw new Error(
      '[CRITICAL CONFIG] Production requires Supabase persistence, but DATABASE_URL/DIRECT_URL are missing. ' +
      'Set Supabase Postgres env vars before deploying so teacher content is not trapped in local SQLite.',
    );
  }

  if (!mirrorStatus.configured && !sqliteStatus.persistent) {
    throw new Error(
      `[CRITICAL CONFIG] Unsafe production storage detected. SQLite is using ${sqliteStatus.path} with no persistent disk and no Supabase mirror. ` +
      'Mount /var/data or configure RENDER_DISK_PATH, and set DATABASE_URL/DIRECT_URL.',
    );
  }
}

async function startServer() {
  console.log('[startup] Config summary:', JSON.stringify(getStartupConfigSummary(), null, 2));
  console.log('[startup] Verifying auth config...');
  console.log('[startup] Verifying auth config...');
  try {
    assertSecureAuthConfig();
  } catch (err) {
    console.warn('[startup] Auth check warning:', err);
  }

  console.log('[startup] Verifying safety config...');
  try {
    assertSafePersistenceConfig();
    console.log('[startup] Persistence verified.');
  } catch (err: any) {
    console.warn('[startup] Persistence configuration warning:', err?.message || err);
    // We log the error but continue to allow the server to start so the user can see logs/health status
  }

  logMailHealth('startup');



  const app = express();
  const preferredPort = Number(process.env.PORT || 3000);
  const distDir = path.resolve(process.cwd(), 'dist');
  const server = http.createServer(app);
  
  if (process.env.NODE_ENV === 'production') {
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(distDir)) {
      console.error('[CRITICAL] Missing "dist" directory in production! Ensure "vite build" ran successfully.');
    } else if (!fs.existsSync(indexPath)) {
      console.error('[CRITICAL] Missing "dist/index.html"! Build seems incomplete.');
    } else {
      console.log('[startup] Found production assets in dist/');
    }
  }

  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  const allowedHeaders = [
    'Content-Type',
    'Authorization',
    'X-Quizzi-Participant-Token',
    'X-Quizzi-Student-Auth',
    'X-Requested-With',
  ];

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Using standard 'cors' middleware for reliable preflight/actual handling.
  // Same-origin browser requests should always work, even on custom domains or preview URLs.
  const resolveCorsOptions: Parameters<typeof cors>[0] = (req, callback) => {
    const origin = String(req.headers.origin || '').trim();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    const expectedOrigin = forwardedHost ? normalizeOrigin(`${forwardedProto}://${forwardedHost}`) : '';
    const allowed =
      !origin ||
      isAllowedBrowserOrigin(origin) ||
      (expectedOrigin && normalizeOrigin(origin) === expectedOrigin) ||
      process.env.NODE_ENV !== 'production';

    if (!allowed) {
      console.warn(`[cors] Blocked origin: ${origin}`);
    }

    callback(null, {
      origin: allowed ? true : false,
      credentials: true,
      methods: allowedMethods,
      allowedHeaders,
      exposedHeaders: ['X-Quizzi-Participant-Token', 'X-Request-Id'],
      optionsSuccessStatus: 204,
    });
  };

  app.use(cors(resolveCorsOptions));
  app.options('*', cors(resolveCorsOptions));

  // In production, we move seeding to background to avoid blocking port binding
  const initializeHeavyData = async () => {
    try {
      console.log('[db] Starting background seeding...');
      seedDemoData();
      seedAnalyticsShowcase();
      console.log('[db] Background seeding complete.');
    } catch (err) {
      console.warn('[db] Background seeding failed:', err);
    }
  };

  if (process.env.NODE_ENV !== 'production') {
    initializeHeavyData();
  }

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
    // Firebase/Google auth popups rely on window.close/window.closed checks that are noisy
    // under stricter COOP settings in some browsers. We do not need cross-origin isolation here.
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (process.env.NODE_ENV === 'production') {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
      if (forwardedProto.includes('https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.vary('Origin');
    res.vary('Cookie');
    res.vary('X-Quizzi-Participant-Token');
    next();
  });

  app.get('/healthz', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const latestPostgresHealth = await checkPostgresHealth();
    const latestSupabaseRestHealth = await checkSupabaseRestHealth();
    const postgresMirror = getPostgresMirrorStatus();
    const sqliteStorage = getSqliteStorageStatus();
    res.json({
      status: 'ok',
      app: 'quizzi',
      primary_db: postgresMirror.active ? 'sqlite_with_supabase_mirror' : 'sqlite',
      sqlite_seeded: true,
      sqlite_storage: sqliteStorage,
      postgres_mirror: postgresMirror,
      supabase_postgres: latestPostgresHealth,
      supabase_rest: latestSupabaseRestHealth,
      auth_signing: getAuthSecretStatus(),
    });
  });

  // API Routes
  app.use('/api', apiRouter);

  // Debug logger for unhandled /api requests
  app.use('/api', (req, res) => {
    console.warn(`[server] UNHANDLED API REQUEST: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });
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

    res.status(400).json({ error: 'Request failed' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
          return;
        }

        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }

      if (path.extname(req.path)) {
        res.status(404).end();
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const listenWithFallback = async (host: string, initialPort: number) => {
    const maxAttempts = process.env.NODE_ENV === 'production' ? 1 : 10;
    let currentPort = initialPort;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          const handleListening = () => {
            server.off('error', handleError);
            resolve();
          };
          const handleError = (error: any) => {
            server.off('listening', handleListening);
            reject(error);
          };
          server.once('listening', handleListening);
          server.once('error', handleError);
          server.listen(currentPort, host);
        });
        return currentPort;
      } catch (error: any) {
        if (error?.code === 'EADDRINUSE' && process.env.NODE_ENV !== 'production' && attempt < maxAttempts - 1) {
          console.warn(`[server] Port ${currentPort} is already in use. Retrying on ${currentPort + 1}...`);
          currentPort += 1;
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Failed to bind Quizzi server after ${maxAttempts} attempts.`);
  };

  const boundPort = await listenWithFallback('0.0.0.0', preferredPort);

  console.log(`[server] QUIZZI back-end listening on 0.0.0.0:${boundPort}`);
  console.log(`[server] Production mode: ${process.env.NODE_ENV === 'production'}`);

  // Start background tasks after the port is bound.
  runHealthChecks();
  if (process.env.NODE_ENV === 'production') {
    initializeHeavyData();
  }

  // Automatic Keep-Alive Ping for Render Free Tier Instances
  const rawAppUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  const isProduction = process.env.NODE_ENV === 'production';
  const hasExternalUrl = Boolean(process.env.RENDER_EXTERNAL_URL);

  if (rawAppUrl && (isProduction || hasExternalUrl)) {
    // Resolve localhost to 127.0.0.1 to avoid IPv6 resolution issues (::1) on some systems
    const renderExternalUrl = rawAppUrl.replace('localhost', '127.0.0.1');
    console.log(`[keep-alive] Auto-ping activated for ${renderExternalUrl}`);
    const keepAliveTimer = setInterval(async () => {
      try {
        const res = await fetch(`${renderExternalUrl}/healthz`);
        if (!res.ok) {
          console.warn(`[keep-alive] Pinged ${renderExternalUrl}/healthz: ${res.status} ${res.statusText}`);
        }
      } catch (err: any) {
        if (err?.code === 'ECONNREFUSED') {
          // Silently ignore connection refused for local pings to avoid log noise if dev server isn't up
          return;
        }
        console.error('[keep-alive] Ping failed:', err?.message || err);
      }
    }, 5 * 60 * 1000); // 5 minutes
    keepAliveTimer.unref?.();
  }

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
    await flushPostgresMirror().catch((error) => {
      console.warn('[server] Failed to flush Postgres mirror cleanly:', error);
    });
    await closePostgresPool().catch((error) => {
      console.warn('[server] Failed to close Postgres pool cleanly:', error);
    });
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

try {
  startServer().catch((error) => {
    console.error('--------------------------------------------------');
    console.error('[FATAL STARTUP ERROR] server.ts failed to boot:');
    console.error(error);
    console.error('--------------------------------------------------');
    setTimeout(() => process.exit(1), 1000);
  });
} catch (globalError) {
  console.error('[CRITICAL] Global execution error in server.ts:', globalError);
  setTimeout(() => process.exit(1), 1000);
}
