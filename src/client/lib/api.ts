/**
 * Central API Client for Quizzi
 * 
 * Handles prepending the backend URL (Render) in production and 
 * uses relative paths in development (proxied by Vite).
 */

import { getParticipantToken } from './studentSession.ts';

const API_BASE = import.meta.env.VITE_API_PROXY_TARGET || (import.meta.env.PROD ? 'https://quizzi-mqru.onrender.com' : '');

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
    const rawAuth = window.localStorage.getItem('quizzi.teacher.auth');
    if (rawAuth) {
      try {
        const session = JSON.parse(rawAuth);
        teacherToken = session?.token || '';
      } catch {
        // Ignore parse error
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
    
  return fetch(url, {
    ...init,
    headers,
    // credentials: 'include' is still good for local/same-origin cases
    credentials: 'include',
  });
}

/**
 * Helper for JSON requests
 */
export async function apiFetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    }
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
