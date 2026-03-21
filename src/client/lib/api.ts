/**
 * Central API Client for Quizzi
 * 
 * Handles prepending the backend URL (Render) in production and 
 * uses relative paths in development (proxied by Vite).
 */

import { getParticipantToken } from './studentSession.ts';

const API_BASE = import.meta.env.VITE_API_PROXY_TARGET || (import.meta.env.PROD ? 'https://quizzi-mqru.onrender.com' : '');
const TEACHER_AUTH_KEY = 'quizzi.teacher.auth';
const TEACHER_TOKEN_KEY = 'quizzi.teacher.token';
const TEACHER_AUTH_RETRY_HEADER = 'X-Quizzi-Teacher-Auth-Retry';

function clearTeacherAuthCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TEACHER_AUTH_KEY);
    window.localStorage.removeItem(TEACHER_TOKEN_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Normalizes an API path to include the base URL if needed.
 */
export function getApiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  
  // Ensure we don't double slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // In development, API_BASE is empty (Vite proxy handles it)
  // In production, API_BASE is the Render URL (e.g. https://quizzi.onrender.com)
  return `${API_BASE}${cleanPath}`;
}

function isTeacherProtectedPath(pathname: string) {
  return (
    pathname.startsWith('/api/teacher/') ||
    pathname.startsWith('/api/dashboard/teacher/') ||
    pathname.startsWith('/api/packs') ||
    pathname.startsWith('/api/sessions') ||
    pathname.startsWith('/api/extract-text') ||
    pathname.startsWith('/api/analytics/') ||
    pathname.startsWith('/api/reports/') ||
    pathname.startsWith('/api/follow-up/') ||
    pathname.startsWith('/api/adaptive-game/') ||
    pathname.startsWith('/api/report/')
  );
}

function shouldRetryTeacherAuth(url: string, headers: Headers, response: Response) {
  if (typeof window === 'undefined') return false;
  if (response.status !== 401) return false;
  if (headers.has(TEACHER_AUTH_RETRY_HEADER)) return false;

  const pathname = (() => {
    try {
      return new URL(url, window.location.origin).pathname;
    } catch {
      return '';
    }
  })();

  if (!isTeacherProtectedPath(pathname) || pathname.startsWith('/api/auth/')) {
    return false;
  }

  return !!(window.localStorage.getItem(TEACHER_TOKEN_KEY) || window.localStorage.getItem(TEACHER_AUTH_KEY));
}

async function refreshTeacherSessionForRetry() {
  const teacherAuth = await import('./teacherAuth.ts');
  return teacherAuth.refreshTeacherSession().catch(() => null);
}

function shouldSetJsonContentType(init?: RequestInit) {
  const method = String(init?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (init?.body == null) return false;
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) return false;
  if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) return false;
  return true;
}

async function executeApiFetch(url: RequestInfo | URL, init: RequestInit | undefined, headers: Headers) {
  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}

/**
 * Standard fetch wrapper that handles the base URL automatically.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' 
    ? getApiUrl(input) 
    : input;
  const participantToken = typeof window !== 'undefined' ? getParticipantToken() : '';
  
  // Also check for Teacher Token in localStorage for cross-origin Bearer Auth
  let teacherToken = '';
  if (typeof window !== 'undefined') {
    teacherToken = window.localStorage.getItem(TEACHER_TOKEN_KEY) || '';
    if (!teacherToken) {
      const rawAuth = window.localStorage.getItem(TEACHER_AUTH_KEY);
      if (rawAuth) {
        try {
          const session = JSON.parse(rawAuth);
          teacherToken = session?.token || '';
        } catch {
          // Ignore parse error
        }
      }
    }
    if (teacherToken) {
      teacherToken = String(teacherToken).trim();
    }
    if (!teacherToken) {
      try {
        window.localStorage.removeItem(TEACHER_TOKEN_KEY);
      } catch {
        // Ignore storage error
      }
    }
  }

  const headers = new Headers(init?.headers || undefined);
  if (participantToken && !headers.has('X-Quizzi-Participant-Token')) {
    headers.set('X-Quizzi-Participant-Token', participantToken);
  }
  
  if (teacherToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${teacherToken}`);
  }

  let response = await executeApiFetch(url, init, headers);

  if (typeof url === 'string' && shouldRetryTeacherAuth(url, headers, response)) {
    const refreshedSession = await refreshTeacherSessionForRetry();
    if (refreshedSession?.token) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set(TEACHER_AUTH_RETRY_HEADER, '1');
      retryHeaders.set('Authorization', `Bearer ${refreshedSession.token}`);
      response = await executeApiFetch(url, init, retryHeaders);
    }
  }

  if (typeof url === 'string') {
    const pathname = (() => {
      try {
        return new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').pathname;
      } catch {
        return '';
      }
    })();

    if (response.status === 401 && isTeacherProtectedPath(pathname)) {
      clearTeacherAuthCache();
    }
  }

  return response;
}

/**
 * Helper for JSON requests
 */
export async function apiFetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || undefined);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (shouldSetJsonContentType(init) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await apiFetch(input, {
    ...init,
    headers,
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API Request failed: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Helper for EventSource (Server-Sent Events) that handles the base URL.
 */
export function apiEventSource(path: string): EventSource {
  return new EventSource(getApiUrl(path), { withCredentials: true });
}
