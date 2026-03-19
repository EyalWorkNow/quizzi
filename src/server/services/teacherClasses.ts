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
  recent_sessions: TeacherClassSessionSummary[];
};

function uniqueNumbers(values: Array<number | string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

export function sanitizeTeacherClassColor(value: unknown): TeacherClassColor {
  const normalized = String(value || '').trim() as TeacherClassColor;
  return TEACHER_CLASS_COLOR_OPTIONS.includes(normalized) ? normalized : 'bg-brand-purple';
}

export async function getTeacherOwnedClass(classId: number, teacherUserId: number, includeArchived = false) {
  const archiveFilter = includeArchived ? '' : 'AND archived = 0';
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
  const archiveFilter = includeArchived ? '' : 'AND tc.archived = 0';

  const classRows = (await db
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

  const classIds = uniqueNumbers(classRows.map((row: any) => row.id));
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

  return classRows.map((row: any) => {
    const classId = Number(row.id);
    const students = studentsByClassId.get(classId) || [];
    const sessions = sessionsByClassId.get(classId) || [];
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
      recent_sessions: sessions.slice(0, recentSessionLimit),
    };
  });
}

export async function getHydratedTeacherClass(classId: number, teacherUserId: number, includeArchived = false) {
  const classes = await listTeacherClasses(teacherUserId, { includeArchived, recentSessionLimit: 5 });
  return classes.find((entry) => Number(entry.id) === Number(classId)) || null;
}
