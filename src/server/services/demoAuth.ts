import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { buildScopedHmac, isDemoAuthEnabled } from './authSecrets.js';

const AUTH_COOKIE = 'quizzi_teacher_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEMO_TEACHER_EMAIL = 'mail@mail.com';
const DEMO_TEACHER_PASSWORD_HASH = buildScopedHmac('demo-teacher-password', '123123');

type AuthProvider = 'password' | 'google' | 'facebook';

export interface TeacherServerSession {
  email: string;
  provider: AuthProvider;
  signedInAt: string;
  expiresAt: string;
}

function parseCookies(headerValue?: string | null) {
  const raw = String(headerValue || '');
  if (!raw) return {} as Record<string, string>;
  return raw.split(';').reduce<Record<string, string>>((cookies, chunk) => {
    const [key, ...rest] = chunk.trim().split('=');
    if (!key) return cookies;
    const value = rest.join('=') || '';
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function signValue(value: string) {
  return buildScopedHmac('teacher-session-cookie', value);
}

function shouldUseSecureCookies(req?: Request) {
  if (process.env.QUIZZI_SECURE_COOKIES === 'true') return true;
  if (process.env.QUIZZI_SECURE_COOKIES === 'false') return false;

  const host = String(req?.headers.host || '').toLowerCase();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return false;
  }

  const forwardedProto = String(req?.headers['x-forwarded-proto'] || req?.protocol || '').toLowerCase();
  return forwardedProto.includes('https');
}

function serializeCookie(value: string, maxAgeSeconds: number, secure: boolean) {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // SameSite=None is REQUIRED for cross-origin cookies (Vercel frontend → Render backend)
    // Secure is mandatory when SameSite=None
    secure ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function serializeExpiredCookie(secure: boolean) {
  const parts = [
    `${AUTH_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function verifyDemoPassword(password: string) {
  if (!isDemoAuthEnabled()) return false;
  const candidate = buildScopedHmac('demo-teacher-password', String(password || ''));
  const left = Buffer.from(candidate);
  const right = Buffer.from(DEMO_TEACHER_PASSWORD_HASH);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createTeacherSession({
  email,
  provider,
}: {
  email: string;
  provider: AuthProvider;
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
  const session: TeacherServerSession = {
    email: email.trim().toLowerCase(),
    provider,
    signedInAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const payload = JSON.stringify(session);
  const token = `${Buffer.from(payload, 'utf8').toString('base64url')}.${signValue(payload)}`;
  return { session, token };
}

export function readTeacherSession(req: Request): TeacherServerSession | null {
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  if (!token || !token.includes('.')) return null;

  const [encodedPayload, signature] = token.split('.', 2);
  if (!encodedPayload || !signature) return null;

  let payload = '';
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = signValue(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const parsed = JSON.parse(payload) as TeacherServerSession;
    if (!parsed?.email || !parsed?.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return {
      email: String(parsed.email).trim().toLowerCase(),
      provider: parsed.provider,
      signedInAt: parsed.signedInAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function issueTeacherSession(req: Request, res: Response, token: string) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', serializeCookie(token, Math.floor(SESSION_TTL_MS / 1000), shouldUseSecureCookies(req)));
}

export function clearTeacherSession(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', serializeExpiredCookie(shouldUseSecureCookies(req)));
}

export function requireTeacherSession(req: Request, res: Response, next: NextFunction) {
  const session = readTeacherSession(req);
  if (!session) {
    res.status(401).json({ error: 'Teacher authentication required' });
    return;
  }
  (req as Request & { teacherSession?: TeacherServerSession }).teacherSession = session;
  next();
}

export function normalizeTeacherEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isDemoTeacherEmail(value: string) {
  return normalizeTeacherEmail(value) === DEMO_TEACHER_EMAIL;
}

export const authConfig = {
  cookieName: AUTH_COOKIE,
  demoEmail: DEMO_TEACHER_EMAIL,
  demoEnabled: isDemoAuthEnabled(),
};
