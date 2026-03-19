import { createHmac } from 'crypto';

const DEFAULT_AUTH_SECRET = 'quizzi-dev-secret-change-me-in-production-2024';
const isProduction = process.env.NODE_ENV === 'production';

export function getAuthSecret() {
  return String(process.env.QUIZZI_AUTH_SECRET || DEFAULT_AUTH_SECRET);
}

export function assertSecureAuthConfig() {
  const configuredSecret = String(process.env.QUIZZI_AUTH_SECRET || '');
  if (isProduction && (!configuredSecret || configuredSecret === DEFAULT_AUTH_SECRET)) {
    throw new Error('QUIZZI_AUTH_SECRET must be configured to a strong, unique value in production.');
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
