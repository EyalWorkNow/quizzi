import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import db from '../db/index.js';
import { normalizeTeacherEmail } from './demoAuth.js';

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function splitTeacherName(value: string) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const parts = normalized.split(' ');
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

export function validateTeacherEmail(value: string) {
  const email = normalizeTeacherEmail(value);
  if (!email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (email.length > 160) return 'Email is too long.';
  return null;
}

export function validateTeacherPassword(value: string) {
  const password = String(value || '');
  if (!password) return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be shorter than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export function hashTeacherPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyTeacherPassword(password: string, passwordHash: string | null | undefined) {
  const stored = String(passwordHash || '');
  const [prefix, salt, hash] = stored.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function getTeacherUserByEmail(email: string) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeTeacherEmail(email)) as any;
}

export function createTeacherUser({
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
  const normalizedEmail = normalizeTeacherEmail(email);
  const { firstName, lastName } = splitTeacherName(name || '');
  const normalizedSchool = String(school || '').trim().slice(0, 160);
  const passwordHash = hashTeacherPassword(password);

  const result = db
    .prepare(`
      INSERT INTO users (email, password_hash, first_name, last_name, school, auth_provider, updated_at)
      VALUES (?, ?, ?, ?, ?, 'password', CURRENT_TIMESTAMP)
    `)
    .run(normalizedEmail, passwordHash, firstName || null, lastName || null, normalizedSchool || null);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as any;
}
