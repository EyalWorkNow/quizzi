import { loadTeacherSettings, saveTeacherSettings } from './localData.ts';
import {
  ensureFirebaseAuthReady,
  getRedirectResult,
  googleProvider,
  signInWithPopup,
  shouldPreferRedirectSignIn,
  signInWithRedirect,
  signOutFirebase,
} from './firebase.ts';

export const DEMO_AUTH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true';
export const DEMO_TEACHER_EMAIL = DEMO_AUTH_ENABLED ? 'mail@mail.com' : '';
export const DEMO_TEACHER_PASSWORD = DEMO_AUTH_ENABLED ? '123123' : '';

const AUTH_KEY = 'quizzi.teacher.auth';
const AUTH_TOKEN_KEY = 'quizzi.teacher.token';
const AUTH_REQUEST_TIMEOUT_MS = 30000;

export interface TeacherAuthSession {
  email: string;
  provider: 'password' | 'google' | 'facebook';
  signedInAt: string;
  token?: string;
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

function readAuthSnapshot() {
  if (typeof window === 'undefined') {
    return {
      rawAuth: '',
      token: '',
    };
  }

  return {
    rawAuth: window.localStorage.getItem(AUTH_KEY) || '',
    token: window.localStorage.getItem(AUTH_TOKEN_KEY) || '',
  };
}

function writeAuth(session: TeacherAuthSession | null) {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(AUTH_KEY);
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  if (session.token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, session.token);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function clearTeacherAuthCache() {
  writeAuth(null);
}

function ensureTeacherSessionPayload(payload: any): TeacherAuthSession {
  const provider = payload?.provider;
  const token = String(payload?.token || '').trim();
  const email = String(payload?.email || '').trim().toLowerCase();

  if (!email || !token || !['password', 'google', 'facebook'].includes(provider)) {
    throw new Error('Teacher session could not be established. Please sign in again.');
  }

  return {
    ...payload,
    email,
    provider,
    token,
  } as TeacherAuthSession;
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
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new Error('Authentication endpoint returned HTML instead of JSON. Check the deployed API base or hosting rewrites.');
  }
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
  const authSnapshot = readAuthSnapshot();
  const response = await fetchWithTimeout('/api/auth/session', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const currentSnapshot = readAuthSnapshot();
    if (
      currentSnapshot.rawAuth === authSnapshot.rawAuth &&
      currentSnapshot.token === authSnapshot.token
    ) {
      writeAuth(null);
    }
    return null;
  }

  const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
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
  const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  try {
    syncTeacherProfile(payload.email, name, school);
  } catch (error) {
    console.warn('[teacherAuth] Failed to sync teacher profile after password sign-in:', error);
  }
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
  const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  try {
    syncTeacherProfile(payload.email, name, school);
  } catch (error) {
    console.warn('[teacherAuth] Failed to sync teacher profile after registration:', error);
  }
  return payload;
}

export async function changeTeacherPassword({
  currentPassword,
  newPassword,
}: {
  currentPassword: string;
  newPassword: string;
}) {
  const response = await fetchWithTimeout('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      currentPassword,
      newPassword,
    }),
  });
  const payload = await readJsonOrThrow(response);
  if (payload?.email && payload?.provider) {
    writeAuth(ensureTeacherSessionPayload(payload));
  }
  return payload;
}

export async function signInTeacherWithProvider({
  provider,
}: {
  provider: 'google' | 'facebook';
}): Promise<TeacherAuthSession | null> {
  if (provider === 'facebook') {
    throw new Error('Facebook sign-in is not configured yet. Use Google or email registration for now.');
  }

  const auth = await ensureFirebaseAuthReady();
  if (!auth) {
    throw new Error('Firebase Authentication is not available. Please check your configuration.');
  }

  const completeGoogleServerSession = async (idToken: string, displayName?: string | null) => {
    const response = await fetchWithTimeout('/api/auth/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        provider: 'google',
        idToken,
      }),
    });

    const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
    writeAuth(payload);
    try {
      syncTeacherProfile(payload.email, displayName || undefined);
    } catch (error) {
      console.warn('[teacherAuth] Failed to sync teacher profile after social sign-in:', error);
    }
    return payload;
  };

  try {
    if (shouldPreferRedirectSignIn()) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    const popupResult = await signInWithPopup(auth, googleProvider);
    const idToken = await popupResult.user.getIdToken();
    return await completeGoogleServerSession(idToken, popupResult.user.displayName);
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (
      error?.code === 'auth/popup-blocked' ||
      message.includes('cross-origin-opener-policy') ||
      message.includes('window.closed') ||
      error?.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in was cancelled.');
    }
    throw error;
  }
}

export async function handleTeacherAuthRedirect() {
  const auth = await ensureFirebaseAuthReady();
  if (!auth) return null;

  const redirectResult = await getRedirectResult(auth).catch((error: any) => {
    console.error('[teacherAuth] Failed to restore Google redirect:', error);
    throw new Error('Google sign-in could not be completed. Please try again.');
  });

  if (!redirectResult?.user) {
    if (window.location.hash.includes('access_token') || window.location.hash.includes('id_token')) {
      console.warn('[teacherAuth] Hash contains tokens but getRedirectResult returned null. Possible COOP or Domain mismatch.');
    }
    return null;
  }

  console.log('[teacherAuth] Google redirect result detected for:', redirectResult.user.email);
  const idToken = await redirectResult.user.getIdToken();
  const response = await fetchWithTimeout('/api/auth/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      provider: 'google',
      idToken,
    }),
  });
  const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  try {
    syncTeacherProfile(payload.email, redirectResult.user.displayName || undefined);
  } catch (error) {
    console.warn('[teacherAuth] Failed to sync teacher profile after redirect sign-in:', error);
  }
  return payload;
}

export async function restoreTeacherSessionFromProvider() {
  const cachedSession = loadTeacherAuth();
  if (!cachedSession || cachedSession.provider !== 'google') {
    return null;
  }

  const auth = await ensureFirebaseAuthReady().catch(() => null);
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    return null;
  }

  const idToken = await currentUser.getIdToken(true);
  const response = await fetchWithTimeout('/api/auth/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      provider: 'google',
      idToken,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = ensureTeacherSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  try {
    syncTeacherProfile(payload.email, currentUser.displayName || undefined);
  } catch (error) {
    console.warn('[teacherAuth] Failed to sync teacher profile after provider restore:', error);
  }
  return payload;
}


export async function signOutTeacher() {
  clearTeacherAuthCache();
  const auth = await ensureFirebaseAuthReady().catch(() => null);
  if (auth) {
    await signOutFirebase(auth).catch(() => undefined);
  }
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
