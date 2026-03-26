import { apiFetch } from './api.ts';
import {
  ensureFirebaseAuthReady,
  getRedirectResult,
  googleProvider,
  signInWithRedirect,
  signOutFirebase,
} from './firebase.ts';
import { getOrCreateStudentIdentityKey } from './studentSession.ts';

const AUTH_KEY = 'quizzi.student.auth';
const AUTH_TOKEN_KEY = 'quizzi.student.token';
const AUTH_REQUEST_TIMEOUT_MS = 30000;

export interface StudentAuthSession {
  student_user_id: number;
  email: string;
  displayName: string;
  provider: 'password' | 'google';
  signedInAt: string;
  expiresAt?: string;
  token?: string;
  preferred_language?: string;
  claimed_classes_count?: number;
}

function readAuth(): StudentAuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as StudentAuthSession;
    if (session?.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(AUTH_KEY);
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(AUTH_KEY);
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return null;
  }
}

function writeAuth(session: StudentAuthSession | null) {
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

function ensureStudentSessionPayload(payload: any): StudentAuthSession {
  const email = String(payload?.email || '').trim().toLowerCase();
  const token = String(payload?.token || '').trim();
  const displayName = String(payload?.displayName || payload?.display_name || '').trim();
  const studentUserId = Number(payload?.student_user_id || payload?.studentUserId || 0);
  const provider = (payload?.provider || 'password') as 'password' | 'google';

  if (!email || !token || !displayName || !studentUserId) {
    throw new Error('Student session could not be established. Please sign in again.');
  }

  return {
    ...payload,
    student_user_id: studentUserId,
    email,
    displayName,
    provider,
    token,
  };
}

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

async function readJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || 'Student authentication request failed');
  }
  return payload;
}

export function loadStudentAuth() {
  return readAuth();
}

export function clearStudentAuth() {
  writeAuth(null);
}

export function isStudentAuthenticated() {
  return !!readAuth();
}

export async function refreshStudentSession() {
  const response = await fetchWithTimeout('/api/student-auth/session', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    writeAuth(null);
    return null;
  }

  const payload = ensureStudentSessionPayload(await response.json());
  writeAuth(payload);
  return payload;
}

export async function registerStudentWithPassword({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName: string;
}) {
  const response = await fetchWithTimeout('/api/student-auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      display_name: String(displayName || '').trim(),
      identity_key: getOrCreateStudentIdentityKey(),
    }),
  });
  const payload = ensureStudentSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  return payload;
}

export async function signInStudentWithPassword({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const response = await fetchWithTimeout('/api/student-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      identity_key: getOrCreateStudentIdentityKey(),
    }),
  });
  const payload = ensureStudentSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  return payload;
}

export async function signInStudentWithProvider({
  provider,
}: {
  provider: 'google';
}): Promise<StudentAuthSession | null> {
  if (provider !== 'google') {
    throw new Error(`Student ${provider} sign-in is not available yet.`);
  }

  const auth = await ensureFirebaseAuthReady();
  if (!auth) {
    throw new Error('Firebase Authentication is not available. Please check your configuration.');
  }

  const completeGoogleServerSession = async (idToken: string, displayName?: string | null) => {
    const response = await fetchWithTimeout('/api/student-auth/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        provider: 'google',
        idToken,
        identity_key: getOrCreateStudentIdentityKey(),
      }),
    });

    const payload = ensureStudentSessionPayload(await readJsonOrThrow(response));
    writeAuth(payload);
    return payload;
  };

  try {
    // Firebase popup flows can be blocked by browser COOP handling.
    // Student sign-in is more reliable when we always prefer redirect.
    await signInWithRedirect(auth, googleProvider);
    return null;
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (
      error?.code === 'auth/popup-blocked' ||
      message.includes('cross-origin-opener-policy') ||
      message.includes('window.closed')
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

export async function handleStudentAuthRedirect() {
  const auth = await ensureFirebaseAuthReady();
  if (!auth) return null;

  const redirectResult = await getRedirectResult(auth).catch((error: any) => {
    console.error('[studentAuth] Failed to restore Google redirect:', error);
    throw new Error('Google sign-in could not be completed. Please try again.');
  });

  if (!redirectResult?.user) {
    return null;
  }

  const idToken = await redirectResult.user.getIdToken();
  const response = await fetchWithTimeout('/api/student-auth/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      provider: 'google',
      idToken,
      identity_key: getOrCreateStudentIdentityKey(),
    }),
  });
  const payload = ensureStudentSessionPayload(await readJsonOrThrow(response));
  writeAuth(payload);
  return payload;
}

export async function signOutStudent() {
  writeAuth(null);
  const auth = await ensureFirebaseAuthReady().catch(() => null);
  if (auth) {
    await signOutFirebase(auth).catch(() => undefined);
  }
  try {
    await fetchWithTimeout('/api/student-auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
  } catch {
    // Resilience
  }
}
