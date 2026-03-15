import type { Request } from 'express';

type RateLimitBucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const DEFAULT_TRUSTED_ORIGINS = [
  'https://quizzi-ivory.vercel.app',
  'https://quizzi-mqru.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
];

const RATE_LIMIT_BUCKETS_MAX = parsePositiveInt(process.env.QUIZZI_RATE_LIMIT_BUCKETS_MAX, 50_000);
const RATE_LIMIT_IDLE_TTL_MS = parsePositiveInt(process.env.QUIZZI_RATE_LIMIT_IDLE_TTL_MS, 15 * 60 * 1000);
const RATE_LIMIT_CLEANUP_INTERVAL_MS = parsePositiveInt(
  process.env.QUIZZI_RATE_LIMIT_CLEANUP_INTERVAL_MS,
  60 * 1000,
);

const trustedOrigins = Array.from(
  new Set(
    [
      ...DEFAULT_TRUSTED_ORIGINS,
      ...String(process.env.QUIZZI_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ].map((origin) => origin.replace(/\/+$/, '')),
  ),
);

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let lastCleanupAt = 0;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function cleanupRateLimitBuckets(now: number) {
  if (now - lastCleanupAt < RATE_LIMIT_CLEANUP_INTERVAL_MS && rateLimitBuckets.size < RATE_LIMIT_BUCKETS_MAX) {
    return;
  }

  lastCleanupAt = now;

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now || now - bucket.lastSeenAt > RATE_LIMIT_IDLE_TTL_MS) {
      rateLimitBuckets.delete(key);
    }
  }

  if (rateLimitBuckets.size <= RATE_LIMIT_BUCKETS_MAX) {
    return;
  }

  const oldestFirst = Array.from(rateLimitBuckets.entries()).sort(
    (left, right) => left[1].lastSeenAt - right[1].lastSeenAt,
  );
  const overflow = rateLimitBuckets.size - RATE_LIMIT_BUCKETS_MAX;

  for (let index = 0; index < overflow; index += 1) {
    const entry = oldestFirst[index];
    if (!entry) break;
    rateLimitBuckets.delete(entry[0]);
  }
}

function sanitizeKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:@-]/g, '_').slice(0, 160);
}

export function getTrustedOrigins() {
  return trustedOrigins;
}

export function resolveClientIp(req: Pick<Request, 'headers' | 'socket' | 'ip'>) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const candidate = forwardedFor || String(req.ip || req.socket?.remoteAddress || '').trim() || 'unknown';
  return candidate.replace(/[^a-fA-F0-9:.,]/g, '').slice(0, 96) || 'unknown';
}

export function buildRateLimitKey(req: Request, namespace: string, ...parts: Array<string | number | null | undefined>) {
  const normalizedParts = parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .map(sanitizeKeyPart);

  return [sanitizeKeyPart(namespace), sanitizeKeyPart(resolveClientIp(req)), ...normalizedParts].join(':');
}

export function checkRateLimit(bucketKey: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanupRateLimitBuckets(now);

  const existing = rateLimitBuckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
      lastSeenAt: now,
    });
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  existing.lastSeenAt = now;
  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}

export function isTrustedOrigin(req: Request) {
  const origin = normalizeOrigin(String(req.headers.origin || ''));
  if (!origin) return true;
  if (trustedOrigins.includes(origin)) return true;

  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();

  if (forwardedHost) {
    const expectedOrigin = normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
    if (origin === expectedOrigin) {
      return true;
    }
  }

  return process.env.NODE_ENV !== 'production';
}
