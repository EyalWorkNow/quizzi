import { loadTeacherSettings, saveTeacherSettings } from './localData.ts';

export const DEMO_TEACHER_EMAIL = 'mail@mail.com';
export const DEMO_TEACHER_PASSWORD = '123123';

const AUTH_KEY = 'quizzi.teacher.auth';
const AUTH_REQUEST_TIMEOUT_MS = 8000;

export interface TeacherAuthSession {
  email: string;
  provider: 'password' | 'google' | 'facebook';
  signedInAt: string;
  expiresAt?: string;
}

function readAuth(): TeacherAuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as TeacherAuthSession;
    if (session?.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

function writeAuth(session: TeacherAuthSession | null) {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(AUTH_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

function syncTeacherProfile(email: string, name?: string, school?: string) {
  const settings = loadTeacherSettings();
  const safeName = String(name || '').trim();
  const [firstName = settings.profile.firstName, lastName = settings.profile.lastName] = safeName
    ? safeName.split(/\s+/, 2)
    : [settings.profile.firstName, settings.profile.lastName];

  saveTeacherSettings({
    ...settings,
    profile: {
      ...settings.profile,
      firstName,
      lastName,
      email: email.trim().toLowerCase(),
      school: String(school || '').trim() || settings.profile.school,
    },
  });
}

async function readJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || 'Teacher authentication request failed');
  }
  return payload;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Authentication request timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function loadTeacherAuth() {
  return readAuth();
}

export function isTeacherAuthenticated() {
  return !!readAuth();
}

export function getTeacherEntryRoute() {
  return isTeacherAuthenticated() ? '/teacher/dashboard' : '/auth';
}

export async function refreshTeacherSession() {
  const response = await fetchWithTimeout('/api/auth/session', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    writeAuth(null);
    return null;
  }

  const payload = (await response.json()) as TeacherAuthSession;
  writeAuth(payload);
  return payload;
}

export async function signInTeacherWithPassword({
  email,
  password,
  name,
  school,
}: {
  email: string;
  password: string;
  name?: string;
  school?: string;
}) {
  const response = await fetchWithTimeout('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
    }),
  });
  const payload = (await readJsonOrThrow(response)) as TeacherAuthSession;
  syncTeacherProfile(payload.email, name, school);
  writeAuth(payload);
  return payload;
}

export async function registerTeacherWithPassword({
  email,
  password,
  name,
  school,
}: {
  email: string;
  password: string;
  name?: string;
  school?: string;
}) {
  const response = await fetchWithTimeout('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      name: String(name || '').trim(),
      school: String(school || '').trim(),
    }),
  });
  const payload = (await readJsonOrThrow(response)) as TeacherAuthSession;
  syncTeacherProfile(payload.email, name, school);
  writeAuth(payload);
  return payload;
}

export async function signInTeacherWithProvider({
  provider,
}: {
  provider: 'google' | 'facebook';
}): Promise<TeacherAuthSession> {
  throw new Error(
    `${provider === 'google' ? 'Google' : 'Facebook'} sign-in is not configured yet. Use email registration or the demo account for now.`,
  );
}

export async function signOutTeacher() {
  writeAuth(null);
  try {
    await fetchWithTimeout('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    });
  } catch {
    // Keep logout resilient even if the network request fails.
  }
}
