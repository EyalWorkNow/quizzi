import { loadTeacherSettings, saveTeacherSettings } from './localData.ts';
import { getFirebaseAuth, googleProvider, signInWithPopup } from './firebase.ts';

export const DEMO_TEACHER_EMAIL = 'mail@mail.com';
export const DEMO_TEACHER_PASSWORD = '123123';

const AUTH_KEY = 'quizzi.teacher.auth';
const AUTH_REQUEST_TIMEOUT_MS = 30000;

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

import { apiFetch } from './api.ts';

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

  try {
    return await apiFetch(input, {
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
    credentials: 'include',
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
    credentials: 'include',
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
    credentials: 'include',
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
  if (provider === 'facebook') {
    throw new Error('Facebook sign-in is not configured yet. Use Google or email registration for now.');
  }

  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not available. Please check your configuration.');
  }

  try {
    // Use signInWithPopup — signInWithRedirect requires Firebase Hosting (/__/auth/handler)
    // which doesn't exist when hosted on Vercel. Popup works with COOP: unsafe-none header.
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();

    const response = await fetchWithTimeout('/api/auth/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        provider: 'google',
        idToken,
      }),
    });

    const payload = (await readJsonOrThrow(response)) as TeacherAuthSession;
    syncTeacherProfile(payload.email, result.user.displayName || undefined);
    writeAuth(payload);
    return payload;
  } catch (error: any) {
    if (error?.code === 'auth/popup-closed-by-user') {
      throw new Error('Google sign-in was cancelled.');
    }
    if (error?.code === 'auth/popup-blocked') {
      throw new Error('Popup was blocked by your browser. Please allow popups for this site.');
    }
    throw error;
  }
}

/**
 * No-op: redirect flow is not used when hosted on Vercel.
 * Kept for backward compatibility with Auth.tsx.
 */
export async function handleTeacherAuthRedirect() {
  return null;
}


export async function signOutTeacher() {
  writeAuth(null);
  try {
    await fetchWithTimeout('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  } catch {
    // Keep logout resilient even if the network request fails.
  }
}
