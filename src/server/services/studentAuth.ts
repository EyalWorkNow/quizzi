import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { buildScopedHmac } from './authSecrets.js';
import { normalizeStudentEmail } from './studentUsers.js';

const AUTH_COOKIE = 'quizzi_student_session';
const AUTH_HEADER = 'x-quizzi-student-auth';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface StudentServerSession {
  studentUserId: number;
  email: string;
  displayName: string;
  provider: 'password' | 'google';
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
  return buildScopedHmac('student-session-cookie', value);
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

export function createStudentSession({
  studentUserId,
  email,
  displayName,
  provider = 'password',
}: {
  studentUserId: number;
  email: string;
  displayName: string;
  provider?: 'password' | 'google';
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
  const session: StudentServerSession = {
    studentUserId: Math.max(0, Math.floor(Number(studentUserId) || 0)),
    email: normalizeStudentEmail(email),
    displayName: String(displayName || '').trim().slice(0, 160),
    provider,
    signedInAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const payload = JSON.stringify(session);
  const token = `${Buffer.from(payload, 'utf8').toString('base64url')}.${signValue(payload)}`;
  return { session, token };
}

export function readStudentSession(req: Request | { headers?: Record<string, string | string[] | undefined> }) {
  const cookieHeader = 'cookie' in (req.headers || {}) ? (req.headers as any).cookie : undefined;
  const headerToken = String((req.headers?.[AUTH_HEADER] as string) || '').trim();
  const token = parseCookies(cookieHeader)[AUTH_COOKIE] || headerToken;
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
    const parsed = JSON.parse(payload) as StudentServerSession;
    if (!parsed?.studentUserId || !parsed?.email || !parsed?.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return {
      studentUserId: Number(parsed.studentUserId),
      email: normalizeStudentEmail(parsed.email),
      displayName: String(parsed.displayName || '').trim().slice(0, 160),
      provider: parsed.provider === 'google' ? 'google' : 'password',
      signedInAt: String(parsed.signedInAt || ''),
      expiresAt: String(parsed.expiresAt || ''),
    } satisfies StudentServerSession;
  } catch {
    return null;
  }
}

export function issueStudentSession(req: Request, res: Response, token: string) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', serializeCookie(token, Math.floor(SESSION_TTL_MS / 1000), shouldUseSecureCookies(req)));
}

export function clearStudentSession(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', serializeExpiredCookie(shouldUseSecureCookies(req)));
}

export function requireStudentSession(req: Request, res: Response, next: NextFunction) {
  const session = readStudentSession(req);
  if (!session) {
    res.status(401).json({ error: 'Student authentication required' });
    return;
  }
  (req as Request & { studentSession?: StudentServerSession }).studentSession = session;
  next();
}

export const studentAuthConfig = {
  cookieName: AUTH_COOKIE,
  headerName: AUTH_HEADER,
};
