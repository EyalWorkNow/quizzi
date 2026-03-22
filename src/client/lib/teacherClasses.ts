import { apiFetch, apiFetchJson } from './api.ts';

export const TEACHER_CLASS_COLOR_OPTIONS = [
  'bg-brand-purple',
  'bg-brand-orange',
  'bg-brand-yellow',
  'bg-brand-dark',
  'bg-white',
] as const;

export type TeacherClassColor = (typeof TEACHER_CLASS_COLOR_OPTIONS)[number];

export type TeacherClassStudent = {
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
  students: TeacherClassStudent[];
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

export type TeacherClassPayload = {
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  notes: string;
  pack_id: number | null;
  students?: Array<{ name: string }>;
};

export async function listTeacherClasses() {
  return apiFetchJson<TeacherClassBoard[]>('/api/teacher/classes');
}

export async function createTeacherClass(payload: TeacherClassPayload) {
  return apiFetchJson<TeacherClassBoard>('/api/teacher/classes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherClass(classId: number, payload: TeacherClassPayload) {
  return apiFetchJson<TeacherClassBoard>(`/api/teacher/classes/${classId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteTeacherClass(classId: number) {
  return apiFetchJson<{ success: boolean }>(`/api/teacher/classes/${classId}`, {
    method: 'DELETE',
  });
}

export async function addTeacherClassStudent(classId: number, name: string) {
  return apiFetchJson<TeacherClassBoard>(`/api/teacher/classes/${classId}/students`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function removeTeacherClassStudent(classId: number, studentId: number) {
  return apiFetchJson<TeacherClassBoard>(`/api/teacher/classes/${classId}/students/${studentId}`, {
    method: 'DELETE',
  });
}

export async function createClassSession({
  classId,
  packId,
}: {
  classId: number;
  packId: number;
}) {
  const response = await apiFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quiz_pack_id: packId,
      teacher_class_id: classId,
      game_type: 'classic_quiz',
      team_count: 0,
      mode_config: {},
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload?.error || 'Failed to create class session');
  }

  return response.json() as Promise<{
    id: number;
    pin: string;
    teacher_class_id: number | null;
    status: string;
    game_type: string;
    team_count: number;
    mode_config: Record<string, unknown>;
  }>;
}
