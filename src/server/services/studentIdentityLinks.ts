import db from '../db/index.js';
import { normalizeStudentEmail } from './studentUsers.js';

export type StudentIdentityLinkSource =
  | 'anonymous_device'
  | 'claimed_device'
  | 'account_join'
  | 'social_login'
  | 'password_reset'
  | 'teacher_merge';

function normalizeIdentityKey(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 128);
}

function normalizeSource(value: unknown): StudentIdentityLinkSource {
  const normalized = String(value || '').trim() as StudentIdentityLinkSource;
  return ['anonymous_device', 'claimed_device', 'account_join', 'social_login', 'password_reset', 'teacher_merge'].includes(normalized)
    ? normalized
    : 'claimed_device';
}

export async function listStudentIdentityLinks(studentUserId: number) {
  return (await db
    .prepare(`
      SELECT *
      FROM student_identity_links
      WHERE student_user_id = ?
      ORDER BY is_primary DESC, created_at ASC, id ASC
    `)
    .all(studentUserId)) as any[];
}

export async function listStudentIdentityKeys(studentUserId: number) {
  const rows = await listStudentIdentityLinks(studentUserId);
  return Array.from(
    new Set(
      rows
        .map((row: any) => normalizeIdentityKey(row.identity_key))
        .filter(Boolean),
    ),
  );
}

export async function getStudentIdentityLinkByIdentityKey(identityKey: string) {
  return (await db
    .prepare(`
      SELECT *
      FROM student_identity_links
      WHERE identity_key = ?
      LIMIT 1
    `)
    .get(normalizeIdentityKey(identityKey))) as any;
}

export async function getPrimaryIdentityKey(studentUserId: number) {
  const row = (await db
    .prepare(`
      SELECT identity_key
      FROM student_identity_links
      WHERE student_user_id = ?
      ORDER BY is_primary DESC, created_at ASC, id ASC
      LIMIT 1
    `)
    .get(studentUserId)) as any;
  return normalizeIdentityKey(row?.identity_key);
}

export async function linkStudentIdentity({
  studentUserId,
  identityKey,
  source = 'claimed_device',
  makePrimary = false,
}: {
  studentUserId: number;
  identityKey: string;
  source?: StudentIdentityLinkSource;
  makePrimary?: boolean;
}) {
  const safeIdentityKey = normalizeIdentityKey(identityKey);
  if (!studentUserId || !safeIdentityKey) return null;

  const transaction = db.transaction((nextStudentUserId: number, nextIdentityKey: string, nextSource: StudentIdentityLinkSource, nextMakePrimary: boolean) => {
    const existing = db
      .prepare(`
        SELECT *
        FROM student_identity_links
        WHERE identity_key = ?
        LIMIT 1
      `)
      .get(nextIdentityKey) as any;

    const firstLink = !db
      .prepare('SELECT 1 FROM student_identity_links WHERE student_user_id = ? LIMIT 1')
      .get(nextStudentUserId);

    const shouldBePrimary = nextMakePrimary || firstLink;

    if (shouldBePrimary) {
      db
        .prepare('UPDATE student_identity_links SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE student_user_id = ?')
        .run(nextStudentUserId);
    }

    if (existing) {
      db
        .prepare(`
          UPDATE student_identity_links
          SET student_user_id = ?,
              source = ?,
              is_primary = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .run(nextStudentUserId, nextSource, shouldBePrimary ? 1 : Number(existing.is_primary || 0), Number(existing.id));
      return Number(existing.id);
    }

    const result = db
      .prepare(`
        INSERT INTO student_identity_links (
          student_user_id,
          identity_key,
          source,
          is_primary,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .run(nextStudentUserId, nextIdentityKey, nextSource, shouldBePrimary ? 1 : 0);

    return Number(result.lastInsertRowid || 0);
  });

  const linkId = transaction(studentUserId, safeIdentityKey, normalizeSource(source), makePrimary);
  return linkId
    ? (await db.prepare('SELECT * FROM student_identity_links WHERE id = ?').get(linkId)) as any
    : null;
}

export async function claimRosterRowsForStudentUser({
  studentUserId,
  email,
}: {
  studentUserId: number;
  email: string;
}) {
  const normalizedEmail = normalizeStudentEmail(email);
  if (!studentUserId || !normalizedEmail) return [];

  await db
    .prepare(`
      UPDATE teacher_class_students
      SET student_user_id = ?,
          invite_status = CASE
            WHEN COALESCE(invite_status, '') = '' THEN 'invited'
            ELSE invite_status
          END,
          invite_delivery_status = CASE
            WHEN COALESCE(invite_delivery_status, '') = '' THEN 'none'
            ELSE invite_delivery_status
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(COALESCE(email, '')) = LOWER(?)
    `)
    .run(studentUserId, normalizedEmail);

  return (await db
    .prepare(`
      SELECT *
      FROM teacher_class_students
      WHERE student_user_id = ?
      ORDER BY updated_at DESC, id DESC
    `)
    .all(studentUserId)) as any[];
}

export function findRosterRowForStudentUserInClass({
  studentUserId,
  classId,
  email,
}: {
  studentUserId: number;
  classId: number;
  email?: string | null;
}) {
  const safeStudentUserId = Math.max(0, Math.floor(Number(studentUserId) || 0));
  const safeClassId = Math.max(0, Math.floor(Number(classId) || 0));
  const normalizedEmail = normalizeStudentEmail(email || '');
  if (!safeStudentUserId || !safeClassId) return null;

  return db
    .prepare(`
      SELECT *
      FROM teacher_class_students
      WHERE class_id = ?
        AND (
          student_user_id = ?
          OR LOWER(COALESCE(email, '')) = LOWER(?)
        )
      ORDER BY
        CASE WHEN student_user_id = ? THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1
    `)
    .get(safeClassId, safeStudentUserId, normalizedEmail, safeStudentUserId) as any;
}

export function markRosterRowClaimed({
  rosterStudentId,
  studentUserId,
  touchSeenAt = true,
}: {
  rosterStudentId: number;
  studentUserId?: number | null;
  touchSeenAt?: boolean;
}) {
  const safeRosterStudentId = Math.max(0, Math.floor(Number(rosterStudentId) || 0));
  const safeStudentUserId = Math.max(0, Math.floor(Number(studentUserId) || 0));
  if (!safeRosterStudentId) return null;

  const updateSql = `
    UPDATE teacher_class_students
    SET student_user_id = COALESCE(?, student_user_id),
        invite_status = 'claimed',
        invite_delivery_status = CASE
          WHEN COALESCE(invite_delivery_status, '') IN ('', 'none') THEN 'claimed'
          ELSE invite_delivery_status
        END,
        claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
        ${touchSeenAt ? 'last_seen_at = CURRENT_TIMESTAMP,' : ''}
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  db.prepare(updateSql).run(safeStudentUserId || null, safeRosterStudentId);

  return db
    .prepare(`
      SELECT *
      FROM teacher_class_students
      WHERE id = ?
      LIMIT 1
    `)
    .get(safeRosterStudentId) as any;
}

export async function acceptRosterRowForStudentUser({
  studentUserId,
  classId,
}: {
  studentUserId: number;
  classId: number;
}) {
  const safeStudentUserId = Math.max(0, Math.floor(Number(studentUserId) || 0));
  const safeClassId = Math.max(0, Math.floor(Number(classId) || 0));
  if (!safeStudentUserId || !safeClassId) return null;

  const rosterRow = findRosterRowForStudentUserInClass({
    studentUserId: safeStudentUserId,
    classId: safeClassId,
  });
  if (!rosterRow?.id) return null;

  return markRosterRowClaimed({
    rosterStudentId: Number(rosterRow.id),
    studentUserId: safeStudentUserId,
    touchSeenAt: true,
  });
}
