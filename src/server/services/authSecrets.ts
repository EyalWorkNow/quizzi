import { createHmac } from 'crypto';

const DEFAULT_AUTH_SECRET = 'quizzi-dev-secret-change-me-in-production-2024';
const isProduction = process.env.NODE_ENV === 'production';

export function getAuthSecret() {
  return String(process.env.QUIZZI_AUTH_SECRET || DEFAULT_AUTH_SECRET);
}

export function getAuthSecretStatus() {
  const configuredSecret = String(process.env.QUIZZI_AUTH_SECRET || '');
  const usingFallback = !configuredSecret || configuredSecret === DEFAULT_AUTH_SECRET;

  return {
    configured: !usingFallback,
    using_fallback: usingFallback,
    source: usingFallback ? 'fallback' : 'environment',
  };
}

export function assertSecureAuthConfig() {
  const authSecretStatus = getAuthSecretStatus();
  if (isProduction && authSecretStatus.using_fallback) {
    console.error(
      '[CRITICAL SECURITY] QUIZZI_AUTH_SECRET is not configured or uses the default value in production. ' +
      'Teacher session cookies and scoped auth tokens are being signed with an unsafe fallback secret. ' +
      'Set a strong, stable QUIZZI_AUTH_SECRET in your deployment environment (example: `openssl rand -base64 32`). ' +
      'Changing this value will invalidate existing signed sessions.',
    );
  }
}

export function isDemoAuthEnabled() {
  const explicit = String(process.env.QUIZZI_ENABLE_DEMO_AUTH || '').trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return !isProduction;
}

export function buildScopedHmac(scope: string, value: string) {
  return createHmac('sha256', `${getAuthSecret()}:${scope}`).update(value).digest('hex');
}
