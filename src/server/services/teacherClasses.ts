import db from '../db/index.js';

export const TEACHER_CLASS_COLOR_OPTIONS = [
  'bg-brand-purple',
  'bg-brand-orange',
  'bg-brand-yellow',
  'bg-brand-dark',
  'bg-white',
] as const;

export type TeacherClassColor = (typeof TEACHER_CLASS_COLOR_OPTIONS)[number];

export type TeacherClassStudentRecord = {
  id: number;
  class_id: number;
  name: string;
  joined_at: string;
  created_at: string;
  updated_at: string;
};

export type TeacherClassSessionSummary = {
  id: number;
  teacher_class_id: number | null;
  quiz_pack_id: number;
  pin: string;
  status: string;
  game_type: string;
  team_count: number;
  participant_count: number;
  accuracy_rate: number | null;
  started_at: string | null;
  ended_at: string | null;
};

export type TeacherClassRetentionStudent = {
  name: string;
  status: 'never_started' | 'inactive_14d' | 'slipping';
  reason: string;
  last_activity_at: string | null;
  live_answers_7d: number;
  practice_attempts_7d: number;
};

export type TeacherClassRetentionSummary = {
  level: 'low' | 'medium' | 'high';
  headline: string;
  body: string;
  active_last_7d: number;
  slipping: number;
  inactive_14d: number;
  never_started: number;
  started_count: number;
  needs_attention_count: number;
  watchlist_students: TeacherClassRetentionStudent[];
};

export type TeacherClassBoard = {
  id: number;
  teacher_id: number;
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  notes: string;
  pack_id: number | null;
  created_at: string;
  updated_at: string;
  students: TeacherClassStudentRecord[];
  pack: {
    id: number;
    title: string;
    question_count: number;
  } | null;
  stats: {
    student_count: number;
    session_count: number;
    active_session_count: number;
    total_participant_count: number;
    average_accuracy: number | null;
  };
  latest_session: TeacherClassSessionSummary | null;
  latest_completed_session: TeacherClassSessionSummary | null;
  recent_sessions: TeacherClassSessionSummary[];
  retention: TeacherClassRetentionSummary;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeRosterName(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseTimestampMs(value: unknown) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getLatestIsoTimestamp(values: Array<unknown>) {
  const timestamps = values
    .map((value) => parseTimestampMs(value))
    .filter((value): value is number => value !== null);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function getDaysSince(value: unknown) {
  const timestamp = parseTimestampMs(value);
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / DAY_MS));
}

function buildTeacherRetentionSummary({
  students,
  participantSignals,
  practiceByIdentity,
}: {
  students: TeacherClassStudentRecord[];
  participantSignals: Array<{
    nickname: string;
    identity_key: string;
    last_live_activity_at: string | null;
    live_answers_7d: number;
    live_answers_total: number;
  }>;
  practiceByIdentity: Map<string, { last_practice_at: string | null; practice_attempts_7d: number }>;
}): TeacherClassRetentionSummary {
  if (!students.length) {
    return {
      level: 'low',
      headline: 'Add roster members to unlock retention tracking',
      body: 'Quizzi will start surfacing comeback and dropout signals as soon as students are attached to this class.',
      active_last_7d: 0,
      slipping: 0,
      inactive_14d: 0,
      never_started: 0,
      started_count: 0,
      needs_attention_count: 0,
      watchlist_students: [],
    };
  }

  const watchlist: TeacherClassRetentionStudent[] = [];
  let activeLast7d = 0;
  let slipping = 0;
  let inactive14d = 0;
  let neverStarted = 0;
  let startedCount = 0;

  students.forEach((student) => {
    const normalizedStudentName = normalizeRosterName(student.name);
    const matchedParticipants = participantSignals.filter(
      (entry) => normalizeRosterName(entry.nickname) === normalizedStudentName,
    );
    const matchedIdentityKeys = Array.from(
      new Set(
        matchedParticipants
          .map((entry) => String(entry.identity_key || '').trim())
          .filter(Boolean),
      ),
    );
    const practiceSignals = matchedIdentityKeys
      .map((identityKey) => practiceByIdentity.get(identityKey) || null)
      .filter((entry): entry is { last_practice_at: string | null; practice_attempts_7d: number } => Boolean(entry));
    const liveAnswers7d = matchedParticipants.reduce((sum, entry) => sum + Number(entry.live_answers_7d || 0), 0);
    const practiceAttempts7d = practiceSignals.reduce((sum, entry) => sum + Number(entry.practice_attempts_7d || 0), 0);
    const lastActivityAt = getLatestIsoTimestamp([
      ...matchedParticipants.map((entry) => entry.last_live_activity_at),
      ...practiceSignals.map((entry) => entry.last_practice_at),
    ]);
    const daysSinceLastActivity = getDaysSince(lastActivityAt);

    if (!matchedParticipants.length) {
      neverStarted += 1;
      watchlist.push({
        name: student.name,
        status: 'never_started',
        reason: 'This roster member has not joined a live Quizzi session yet.',
        last_activity_at: null,
        live_answers_7d: 0,
        practice_attempts_7d: 0,
      });
      return;
    }

    startedCount += 1;

    if (liveAnswers7d + practiceAttempts7d > 0) {
      activeLast7d += 1;
      return;
    }

    if ((daysSinceLastActivity ?? 0) >= 14) {
      inactive14d += 1;
      watchlist.push({
        name: student.name,
        status: 'inactive_14d',
        reason: `No live or practice activity for ${daysSinceLastActivity} days.`,
        last_activity_at: lastActivityAt,
        live_answers_7d: liveAnswers7d,
        practice_attempts_7d: practiceAttempts7d,
      });
      return;
    }

    if ((daysSinceLastActivity ?? 0) >= 7) {
      slipping += 1;
      watchlist.push({
        name: student.name,
        status: 'slipping',
        reason: `Momentum is fading after ${daysSinceLastActivity} days without activity.`,
        last_activity_at: lastActivityAt,
        live_answers_7d: liveAnswers7d,
        practice_attempts_7d: practiceAttempts7d,
      });
    }
  });

  const needsAttentionCount = neverStarted + inactive14d + slipping;
  const rosterCount = students.length;
  const riskRatio = rosterCount > 0 ? needsAttentionCount / rosterCount : 0;
  const level: TeacherClassRetentionSummary['level'] =
    riskRatio >= 0.35 || neverStarted >= Math.max(1, Math.round(rosterCount * 0.2))
      ? 'high'
      : riskRatio >= 0.16
        ? 'medium'
        : 'low';
  const headline =
    level === 'high'
      ? `${needsAttentionCount} students need re-entry support`
      : level === 'medium'
        ? 'Momentum is softening in this class'
        : 'Participation looks healthy';
  const body =
    level === 'high'
      ? 'Use a short rematch, focused practice, or direct outreach before these students disappear from the loop.'
      : level === 'medium'
        ? 'A few students are drifting. A tighter follow-up pack or a lighter homework check-in can pull them back.'
        : 'Most roster members are still active. Keep the rhythm going with short follow-up practice between live sessions.';
  const severityOrder = {
    never_started: 3,
    inactive_14d: 2,
    slipping: 1,
  } as const;

  return {
    level,
    headline,
    body,
    active_last_7d: activeLast7d,
    slipping,
    inactive_14d: inactive14d,
    never_started: neverStarted,
    started_count: startedCount,
    needs_attention_count: needsAttentionCount,
    watchlist_students: [...watchlist]
      .sort((left, right) => {
        const severityDelta = severityOrder[right.status] - severityOrder[left.status];
        if (severityDelta !== 0) return severityDelta;
        return (getDaysSince(right.last_activity_at) || 999) - (getDaysSince(left.last_activity_at) || 999);
      })
      .slice(0, 4),
  };
}

function uniqueNumbers(values: Array<number | string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

async function bootstrapTeacherClassesFromUnlinkedSessions(teacherUserId: number) {
  const packRows = (await db
      .prepare(`
      SELECT
        qp.id,
        qp.title,
        COALESCE(qp.course_code, '') AS course_code,
        COALESCE(qp.course_name, '') AS course_name,
        COALESCE(qp.section_name, '') AS section_name,
        COALESCE(qp.academic_term, '') AS academic_term,
        MAX(COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00')) AS last_activity_at
      FROM quiz_packs qp
      JOIN sessions s ON s.quiz_pack_id = qp.id
      WHERE qp.teacher_id = ?
        AND COALESCE(s.teacher_class_id, 0) = 0
      GROUP BY qp.id
      ORDER BY last_activity_at DESC, qp.id DESC
    `)
      .all(teacherUserId)) as any[];

  if (!packRows.length) return false;

  for (const [index, packRow] of packRows.entries()) {
    const className = String(packRow.course_name || packRow.title || `Recovered Class ${index + 1}`).trim();
    const subject = String(packRow.course_code || packRow.course_name || 'General').trim();
    const grade = String(packRow.section_name || packRow.academic_term || 'Mixed').trim();
    const color = TEACHER_CLASS_COLOR_OPTIONS[index % TEACHER_CLASS_COLOR_OPTIONS.length];
    const notes = 'Recovered automatically from historical Quizzi live sessions.';

    const insertResult = await db
      .prepare(`
        INSERT INTO teacher_classes (
          teacher_id,
          name,
          subject,
          grade,
          color,
          notes,
          pack_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        teacherUserId,
        className || `Recovered Class ${index + 1}`,
        subject || 'General',
        grade || 'Mixed',
        color,
        notes,
        Number(packRow.id || 0) || null,
      );

    const classId = Number(insertResult.lastInsertRowid || 0);
    const packId = Number(packRow.id || 0);
    if (!classId || !packId) continue;

    const sessionRows = (await db
        .prepare(`
        SELECT id
        FROM sessions
        WHERE quiz_pack_id = ?
          AND COALESCE(teacher_class_id, 0) = 0
      `)
        .all(packId)) as any[];
    const sessionIds = uniqueNumbers(sessionRows.map((row: any) => row.id));

    await db
      .prepare(`
        UPDATE sessions
        SET teacher_class_id = ?
        WHERE quiz_pack_id = ?
          AND COALESCE(teacher_class_id, 0) = 0
      `)
      .run(classId, packId);

    if (!sessionIds.length) continue;

    const participantRows = (await db
        .prepare(`
        SELECT nickname
        FROM participants
        WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})
        ORDER BY created_at ASC, id ASC
      `)
        .all(...sessionIds)) as any[];
    const seenNames = new Set<string>();

    for (const row of participantRows) {
      const rawName = String(row.nickname || '').trim();
      const normalizedName = normalizeRosterName(rawName);
      if (!normalizedName || seenNames.has(normalizedName)) continue;
      seenNames.add(normalizedName);
      await db
        .prepare(`
          INSERT INTO teacher_class_students (class_id, name)
          VALUES (?, ?)
        `)
        .run(classId, rawName);
    }
  }

  return true;
}

export function sanitizeTeacherClassColor(value: unknown): TeacherClassColor {
  const normalized = String(value || '').trim() as TeacherClassColor;
  return TEACHER_CLASS_COLOR_OPTIONS.includes(normalized) ? normalized : 'bg-brand-purple';
}

export async function getTeacherOwnedClass(classId: number, teacherUserId: number, includeArchived = false) {
  const archiveFilter = includeArchived ? '' : 'AND COALESCE(archived, 0) = 0';
  return (await db
      .prepare(`
      SELECT *
      FROM teacher_classes
      WHERE id = ? AND teacher_id = ? ${archiveFilter}
      LIMIT 1
    `)
      .get(classId, teacherUserId)) as any;
}

export async function getTeacherOwnedStudent(studentId: number, classId: number, teacherUserId: number) {
  return (await db
      .prepare(`
      SELECT tcs.*
      FROM teacher_class_students tcs
      JOIN teacher_classes tc ON tc.id = tcs.class_id
      WHERE tcs.id = ? AND tcs.class_id = ? AND tc.teacher_id = ?
      LIMIT 1
    `)
      .get(studentId, classId, teacherUserId)) as any;
}

function mapSessionSummary(row: any): TeacherClassSessionSummary {
  return {
    id: Number(row.id),
    teacher_class_id: Number(row.teacher_class_id || 0) || null,
    quiz_pack_id: Number(row.quiz_pack_id || 0),
    pin: String(row.pin || ''),
    status: String(row.status || 'LOBBY'),
    game_type: String(row.game_type || 'classic_quiz'),
    team_count: Number(row.team_count || 0),
    participant_count: Number(row.participant_count || 0),
    accuracy_rate: row.accuracy_rate === null || row.accuracy_rate === undefined ? null : Number(row.accuracy_rate),
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
  };
}

export async function listTeacherClasses(
  teacherUserId: number,
  options: { includeArchived?: boolean; recentSessionLimit?: number } = {},
): Promise<TeacherClassBoard[]> {
  const includeArchived = Boolean(options.includeArchived);
  const recentSessionLimit = Math.max(1, Math.min(8, Number(options.recentSessionLimit || 4)));
  const archiveFilter = includeArchived ? '' : 'AND COALESCE(tc.archived, 0) = 0';

  let classRows = (await db
      .prepare(`
      SELECT
        tc.*,
        qp.title AS pack_title,
        COALESCE(qp.question_count_cache, 0) AS pack_question_count
      FROM teacher_classes tc
      LEFT JOIN quiz_packs qp
        ON qp.id = tc.pack_id
       AND qp.teacher_id = tc.teacher_id
      WHERE tc.teacher_id = ? ${archiveFilter}
      ORDER BY tc.updated_at DESC, tc.id DESC
    `)
      .all(teacherUserId)) as any[];

  let classIds = uniqueNumbers(classRows.map((row: any) => row.id));
  if (!classIds.length && !includeArchived) {
    const bootstrapped = await bootstrapTeacherClassesFromUnlinkedSessions(teacherUserId);
    if (bootstrapped) {
      classRows = (await db
          .prepare(`
          SELECT
            tc.*,
            qp.title AS pack_title,
            COALESCE(qp.question_count_cache, 0) AS pack_question_count
          FROM teacher_classes tc
          LEFT JOIN quiz_packs qp
            ON qp.id = tc.pack_id
           AND qp.teacher_id = tc.teacher_id
          WHERE tc.teacher_id = ? ${archiveFilter}
          ORDER BY tc.updated_at DESC, tc.id DESC
        `)
          .all(teacherUserId)) as any[];
      classIds = uniqueNumbers(classRows.map((row: any) => row.id));
    }
  }
  if (!classIds.length) return [];

  const placeholders = classIds.map(() => '?').join(', ');
  const studentRows = (await db
      .prepare(`
      SELECT *
      FROM teacher_class_students
      WHERE class_id IN (${placeholders})
      ORDER BY created_at ASC, id ASC
    `)
      .all(...classIds)) as any[];
  const sessionRows = (await db
      .prepare(`
      SELECT
        s.*,
        COALESCE(pc.participant_count, 0) AS participant_count,
        aa.accuracy_rate
      FROM sessions s
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS participant_count
        FROM participants
        GROUP BY session_id
      ) pc ON pc.session_id = s.id
      LEFT JOIN (
        SELECT session_id, AVG(CASE WHEN is_correct = 1 THEN 100.0 ELSE 0.0 END) AS accuracy_rate
        FROM answers
        GROUP BY session_id
      ) aa ON aa.session_id = s.id
      WHERE s.teacher_class_id IN (${placeholders})
      ORDER BY
        CASE WHEN UPPER(COALESCE(s.status, '')) <> 'ENDED' THEN 1 ELSE 0 END DESC,
        COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00') DESC,
        s.id DESC
    `)
      .all(...classIds)) as any[];
  const sessionIds = uniqueNumbers(sessionRows.map((row: any) => row.id));
  const accuracyRows = (await db
      .prepare(`
      SELECT
        s.teacher_class_id,
        AVG(CASE WHEN a.is_correct = 1 THEN 100.0 ELSE 0.0 END) AS accuracy_rate
      FROM sessions s
      JOIN answers a ON a.session_id = s.id
      WHERE s.teacher_class_id IN (${placeholders})
      GROUP BY s.teacher_class_id
    `)
      .all(...classIds)) as any[];
  const participantActivityRows = sessionIds.length
    ? ((await db
          .prepare(`
        SELECT
          p.session_id,
          p.identity_key,
          p.nickname,
          p.created_at AS joined_at,
          MAX(COALESCE(a.created_at, p.created_at)) AS last_activity_at,
          SUM(CASE WHEN a.id IS NOT NULL AND a.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS live_answers_7d,
          COUNT(a.id) AS live_answers_total
        FROM participants p
        LEFT JOIN answers a ON a.participant_id = p.id
        WHERE p.session_id IN (${sessionIds.map(() => '?').join(', ')})
        GROUP BY p.id
      `)
          .all(...sessionIds)) as any[])
    : [];
  const practiceIdentityKeys = Array.from(
    new Set(
      participantActivityRows
        .map((row: any) => String(row.identity_key || '').trim())
        .filter(Boolean),
    ),
  );
  const practiceRows = practiceIdentityKeys.length
    ? ((await db
          .prepare(`
        SELECT
          identity_key,
          MAX(created_at) AS last_practice_at,
          SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS practice_attempts_7d
        FROM practice_attempts
        WHERE identity_key IN (${practiceIdentityKeys.map(() => '?').join(', ')})
        GROUP BY identity_key
      `)
          .all(...practiceIdentityKeys)) as any[])
    : [];

  const studentsByClassId = new Map<number, TeacherClassStudentRecord[]>();
  for (const student of studentRows) {
    const classId = Number(student.class_id || 0);
    const current = studentsByClassId.get(classId) || [];
    current.push({
      id: Number(student.id),
      class_id: classId,
      name: String(student.name || ''),
      joined_at: student.joined_at || student.created_at || new Date().toISOString(),
      created_at: student.created_at || student.joined_at || new Date().toISOString(),
      updated_at: student.updated_at || student.created_at || student.joined_at || new Date().toISOString(),
    });
    studentsByClassId.set(classId, current);
  }

  const sessionsByClassId = new Map<number, TeacherClassSessionSummary[]>();
  for (const session of sessionRows) {
    const classId = Number(session.teacher_class_id || 0);
    if (!classId) continue;
    const current = sessionsByClassId.get(classId) || [];
    current.push(mapSessionSummary(session));
    sessionsByClassId.set(classId, current);
  }

  const accuracyByClassId = new Map<number, number | null>();
  for (const row of accuracyRows) {
    const classId = Number(row.teacher_class_id || 0);
    accuracyByClassId.set(
      classId,
      row.accuracy_rate === null || row.accuracy_rate === undefined ? null : Number(row.accuracy_rate),
    );
  }
  const sessionClassById = new Map<number, number>();
  sessionRows.forEach((row: any) => {
    sessionClassById.set(Number(row.id), Number(row.teacher_class_id || 0));
  });
  const participantSignalsByClassId = new Map<
    number,
    Array<{
      nickname: string;
      identity_key: string;
      last_live_activity_at: string | null;
      live_answers_7d: number;
      live_answers_total: number;
    }>
  >();
  participantActivityRows.forEach((row: any) => {
    const classId = sessionClassById.get(Number(row.session_id || 0)) || 0;
    if (!classId) return;
    const current = participantSignalsByClassId.get(classId) || [];
    current.push({
      nickname: String(row.nickname || ''),
      identity_key: String(row.identity_key || '').trim(),
      last_live_activity_at: row.last_activity_at || row.joined_at || null,
      live_answers_7d: Number(row.live_answers_7d || 0),
      live_answers_total: Number(row.live_answers_total || 0),
    });
    participantSignalsByClassId.set(classId, current);
  });
  const practiceByIdentity = new Map<string, { last_practice_at: string | null; practice_attempts_7d: number }>();
  practiceRows.forEach((row: any) => {
    practiceByIdentity.set(String(row.identity_key || '').trim(), {
      last_practice_at: row.last_practice_at || null,
      practice_attempts_7d: Number(row.practice_attempts_7d || 0),
    });
  });

  return classRows.map((row: any) => {
    const classId = Number(row.id);
    const students = studentsByClassId.get(classId) || [];
    const sessions = sessionsByClassId.get(classId) || [];
    const latestCompletedSession =
      sessions.find((session) => String(session.status || '').toUpperCase() === 'ENDED') || null;
    const totalParticipantCount = sessions.reduce(
      (sum, session) => sum + Number(session.participant_count || 0),
      0,
    );

    return {
      id: classId,
      teacher_id: Number(row.teacher_id || 0),
      name: String(row.name || ''),
      subject: String(row.subject || ''),
      grade: String(row.grade || ''),
      color: sanitizeTeacherClassColor(row.color),
      notes: String(row.notes || ''),
      pack_id: Number(row.pack_id || 0) || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || row.created_at || new Date().toISOString(),
      students,
      pack: row.pack_title
        ? {
            id: Number(row.pack_id || 0),
            title: String(row.pack_title || ''),
            question_count: Number(row.pack_question_count || 0),
          }
        : null,
      stats: {
        student_count: students.length,
        session_count: sessions.length,
        active_session_count: sessions.filter((session) => String(session.status || '').toUpperCase() !== 'ENDED').length,
        total_participant_count: totalParticipantCount,
        average_accuracy: accuracyByClassId.get(classId) ?? null,
      },
      latest_session: sessions[0] || null,
      latest_completed_session: latestCompletedSession,
      recent_sessions: sessions.slice(0, recentSessionLimit),
      retention: buildTeacherRetentionSummary({
        students,
        participantSignals: participantSignalsByClassId.get(classId) || [],
        practiceByIdentity,
      }),
    };
  });
}

export async function getHydratedTeacherClass(classId: number, teacherUserId: number, includeArchived = false) {
  const classes = await listTeacherClasses(teacherUserId, { includeArchived, recentSessionLimit: 5 });
  return classes.find((entry) => Number(entry.id) === Number(classId)) || null;
}
