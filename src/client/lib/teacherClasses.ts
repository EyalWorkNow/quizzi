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
  email: string;
  student_user_id: number | null;
  invite_status: 'none' | 'invited' | 'claimed';
  invite_sent_at: string | null;
  invite_delivery_status: 'none' | 'sent' | 'failed' | 'not_configured' | 'claimed';
  invite_last_error: string | null;
  claimed_at: string | null;
  last_seen_at: string | null;
  account_linked: boolean;
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

export type TeacherClassPackSummary = {
  id: number;
  title: string;
  question_count: number;
};

export type TeacherClassStats = {
  student_count: number;
  session_count: number;
  active_session_count: number;
  total_participant_count: number;
  average_accuracy: number | null;
};

export type TeacherClassInviteSummary = {
  approved_count: number;
  pending_count: number;
  session_only_count: number;
  linked_count: number;
};

export type TeacherClassApprovalState = 'none' | 'invited' | 'claimed';

export type TeacherClassCard = {
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
  pack: TeacherClassPackSummary | null;
  stats: TeacherClassStats;
  student_count: number;
  pending_approval_count: number;
  linked_account: boolean;
  approval_state: TeacherClassApprovalState;
  invite_delivery_state: 'none' | 'sent' | 'failed' | 'not_configured' | 'claimed';
  invite_summary: TeacherClassInviteSummary;
  active_session: TeacherClassSessionSummary | null;
  latest_session: TeacherClassSessionSummary | null;
  latest_completed_session: TeacherClassSessionSummary | null;
  retention: TeacherClassRetentionSummary;
};

export type TeacherClassWorkspace = TeacherClassCard & {
  students: TeacherClassStudent[];
  recent_sessions: TeacherClassSessionSummary[];
  mail_health: {
    configured: boolean;
    mode: 'smtp' | 'gmail' | 'none';
    from_address: string;
    missing: string[];
    hint: string | null;
  };
};

export type TeacherClassBoard = TeacherClassWorkspace;

export type TeacherClassPayload = {
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  notes: string;
  pack_id: number | null;
  students?: Array<{ name: string; email?: string }>;
};

export async function listTeacherClasses() {
  return apiFetchJson<TeacherClassCard[]>('/api/teacher/classes');
}

export async function getTeacherClass(classId: number) {
  try {
    return await apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}`);
  } catch (error: any) {
    const message = String(error?.message || '');
    if (!message.includes('API route not found')) {
      throw error;
    }
    const allClasses = await listTeacherClasses();
    const matchedClass = allClasses.find((entry) => Number(entry.id) === Number(classId));
    if (!matchedClass) {
      throw error;
    }
    return {
      ...matchedClass,
      students: [],
      recent_sessions: [],
      mail_health: {
        configured: false,
        mode: 'none',
        from_address: 'eyalatiyawork@gmail.com',
        missing: [],
        hint: null,
      },
    } satisfies TeacherClassWorkspace;
  }
}

export async function createTeacherClass(payload: TeacherClassPayload) {
  return apiFetchJson<TeacherClassWorkspace>('/api/teacher/classes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherClass(classId: number, payload: TeacherClassPayload) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteTeacherClass(classId: number) {
  return apiFetchJson<{ success: boolean }>(`/api/teacher/classes/${classId}`, {
    method: 'DELETE',
  });
}

export async function addTeacherClassStudent(classId: number, name: string, email = '') {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/students`, {
    method: 'POST',
    body: JSON.stringify({ name, email }),
  });
}

export async function removeTeacherClassStudent(classId: number, studentId: number) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/students/${studentId}`, {
    method: 'DELETE',
  });
}

export async function resendTeacherClassStudentInvite(classId: number, studentId: number) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/students/${studentId}/resend-invite`, {
    method: 'POST',
  });
}

export async function deleteTeacherSession(sessionId: number) {
  return apiFetchJson<{ deleted: boolean; session_id: number }>(`/api/teacher/sessions/${sessionId}`, {
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
