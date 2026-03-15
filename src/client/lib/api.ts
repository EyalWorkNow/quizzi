/**
 * Central API Client for Quizzi
 * 
 * Handles prepending the backend URL (Render) in production and 
 * uses relative paths in development (proxied by Vite).
 */

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
    
  return fetch(url, {
    ...init,
    // CRITICAL: credentials: 'include' is required for cross-origin cookie sending
    // Without this, the browser won't send the session cookie from Vercel to Render
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
