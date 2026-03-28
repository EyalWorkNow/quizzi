import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import db from '../db/index.js';

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function splitStudentName(value: string) {
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

export function normalizeStudentEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function validateStudentEmail(value: string) {
  const email = normalizeStudentEmail(value);
  if (!email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (email.length > 160) return 'Email is too long.';
  return null;
}

export function validateStudentPassword(value: string) {
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

export function hashStudentPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyStudentPassword(password: string, passwordHash: string | null | undefined) {
  const stored = String(passwordHash || '');
  const [prefix, salt, hash] = stored.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function getStudentUserByEmail(email: string) {
  return (await db.prepare('SELECT * FROM student_users WHERE email = ?').get(normalizeStudentEmail(email))) as any;
}

export async function getStudentUserById(studentUserId: number) {
  return (await db.prepare('SELECT * FROM student_users WHERE id = ?').get(studentUserId)) as any;
}

export async function createStudentUser({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const normalizedEmail = normalizeStudentEmail(email);
  const safeDisplayName = String(displayName || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const { firstName, lastName } = splitStudentName(safeDisplayName);
  const passwordHash = hashStudentPassword(String(password || ''));

  const result = await db
    .prepare(`
      INSERT INTO student_users (
        email,
        password_hash,
        display_name,
        first_name,
        last_name,
        status,
        updated_at,
        last_login_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .run(
      normalizedEmail,
      passwordHash,
      safeDisplayName || normalizedEmail,
      firstName || null,
      lastName || null,
    );

  return (await db.prepare('SELECT * FROM student_users WHERE id = ?').get(Number(result.lastInsertRowid || 0))) as any;
}

export async function updateStudentLastLogin(studentUserId: number) {
  await db
    .prepare(`
      UPDATE student_users
      SET last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(studentUserId);
}

export async function updateStudentPreferredLanguage(studentUserId: number, language: string) {
  await db
    .prepare(`
      UPDATE student_users
      SET preferred_language = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(String(language || '').trim().slice(0, 12), studentUserId);
}

export async function updateStudentPassword(studentUserId: number, password: string) {
  const passwordHash = hashStudentPassword(String(password || ''));
  await db
    .prepare(`
      UPDATE student_users
      SET password_hash = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(passwordHash, studentUserId);
}
