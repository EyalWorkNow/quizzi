import { apiFetch, apiFetchJson } from './api.ts';
import { DEFAULT_STUDENT_ASSISTANCE_POLICY, type StudentAssistancePolicy } from '../../shared/studentAssistance.ts';

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
  student_assistance_policy: StudentAssistancePolicy;
  active_session: TeacherClassSessionSummary | null;
  latest_session: TeacherClassSessionSummary | null;
  latest_completed_session: TeacherClassSessionSummary | null;
  retention: TeacherClassRetentionSummary;
  packs: TeacherClassPackSummary[];
};

export type TeacherClassWorkspace = TeacherClassCard & {
  students: TeacherClassStudent[];
  recent_sessions: TeacherClassSessionSummary[];
  assignment_board?: TeacherClassAssignmentBoard;
  self_practice_board?: TeacherClassSelfPracticeBoard;
  mail_health: {
    configured: boolean;
    mode: 'smtp' | 'gmail' | 'none';
    from_address: string;
    missing: string[];
    hint: string | null;
  };
};

export type TeacherClassAssignmentRosterProgress = {
  student_id: number;
  name: string;
  email: string;
  attempted_questions: number;
  attempt_count: number;
  accuracy_pct: number | null;
  last_activity_at: string | null;
  completion_pct: number;
  question_goal: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'overdue';
};

export type TeacherClassAssignment = {
  id: number;
  class_id: number;
  pack_id: number;
  pack_title: string;
  title: string;
  instructions: string;
  due_at: string | null;
  question_goal: number;
  status: string;
  created_at: string | null;
  student_assistance_policy: StudentAssistancePolicy;
  summary: {
    assigned_count: number;
    started_count: number;
    completed_count: number;
    overdue_count: number;
  };
  roster_progress: TeacherClassAssignmentRosterProgress[];
};

export type TeacherClassAssignmentBoard = {
  active_assignment: TeacherClassAssignment | null;
  assignments: TeacherClassAssignment[];
};

export type TeacherClassSelfPracticeStudent = {
  student_id: number;
  name: string;
  email: string;
  account_linked: boolean;
  last_practice_at: string | null;
  latest_mode: 'adaptive' | 'lesson' | null;
  latest_mission_label: string | null;
  practice_days_7d: number;
  attempts_7d: number;
  total_attempts: number;
  adaptive_attempts: number;
  adaptive_attempts_7d: number;
  adaptive_accuracy_pct: number | null;
  lesson_attempts: number;
  lesson_attempts_7d: number;
  lesson_accuracy_pct: number | null;
};

export type TeacherClassSelfPracticeBoard = {
  summary: {
    active_students_7d: number;
    attempts_7d: number;
    adaptive_attempts_7d: number;
    lesson_attempts_7d: number;
    accuracy_pct_7d: number | null;
    latest_activity_at: string | null;
  };
  students: TeacherClassSelfPracticeStudent[];
};

export type TeacherClassProgressPoint = {
  session_id: number;
  label: string;
  pin: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  pack_title: string;
  accuracy_pct: number | null;
  participant_count?: number;
  answer_count?: number;
};

export type TeacherClassProgressStudentSummary = {
  id: number;
  name: string;
  email: string;
  account_linked: boolean;
  session_count: number;
  avg_accuracy: number | null;
  latest_accuracy: number | null;
  best_accuracy?: number | null;
  improvement_delta?: number | null;
  weakest_tag?: string | null;
  strongest_tag?: string | null;
  last_activity_at: string | null;
};

export type TeacherClassProgressTopicSummary = {
  tag: string;
  class_accuracy: number | null;
  class_answers: number;
  selected_accuracy: number | null;
  selected_answers: number;
  compare_accuracy: number | null;
  compare_answers: number;
};

export type TeacherClassProgressAction = {
  kind: 'class_focus' | 'student_support' | 'student_challenge';
  title: string;
  body: string;
  student_id: number | null;
  tag: string | null;
};

export type TeacherClassProgressBoard = {
  class_id: number;
  class_name: string;
  class_series: TeacherClassProgressPoint[];
  students: TeacherClassProgressStudentSummary[];
  selected_student_id: number | null;
  compare_student_id: number | null;
  selected_student_series: TeacherClassProgressPoint[];
  compare_student_series: TeacherClassProgressPoint[];
  topic_summary: TeacherClassProgressTopicSummary[];
  recommended_actions: TeacherClassProgressAction[];
};

export type TeacherClassBoard = TeacherClassWorkspace;

export type TeacherClassPayload = {
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  notes: string;
  pack_id: number | null;
  student_assistance_policy?: StudentAssistancePolicy | null;
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
      student_assistance_policy: matchedClass.student_assistance_policy || DEFAULT_STUDENT_ASSISTANCE_POLICY,
      self_practice_board: {
        summary: {
          active_students_7d: 0,
          attempts_7d: 0,
          adaptive_attempts_7d: 0,
          lesson_attempts_7d: 0,
          accuracy_pct_7d: null,
          latest_activity_at: null,
        },
        students: [],
      },
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

export async function getTeacherClassProgress(classId: number, studentId?: number | null, compareStudentId?: number | null) {
  const params = new URLSearchParams();
  if (studentId && Number(studentId) > 0) {
    params.set('student_id', String(studentId));
  }
  if (compareStudentId && Number(compareStudentId) > 0) {
    params.set('compare_student_id', String(compareStudentId));
  }
  const suffix = params.toString();
  return apiFetchJson<TeacherClassProgressBoard>(
    suffix ? `/api/teacher/classes/${classId}/progress?${suffix}` : `/api/teacher/classes/${classId}/progress`,
  );
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

export type TeacherClassInviteDelivery = {
  ok: boolean;
  deliveryStatus: 'sent' | 'failed' | 'not_configured';
  sentAt: string | null;
  error: string | null;
  messageId?: string | null;
};

export async function resendTeacherClassStudentInvite(classId: number, studentId: number) {
  return apiFetchJson<{ board: TeacherClassWorkspace; delivery: TeacherClassInviteDelivery | null }>(
    `/api/teacher/classes/${classId}/students/${studentId}/resend-invite`,
    {
    method: 'POST',
  });
}

export async function createTeacherClassAssignment(
  classId: number,
  payload: {
    title: string;
    instructions?: string;
    due_at?: string | null;
    question_goal?: number;
    pack_id?: number | null;
    student_assistance_policy?: StudentAssistancePolicy | null;
  },
) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTeacherClassAssignment(
  classId: number,
  assignmentId: number,
  payload: {
    title: string;
    instructions?: string;
    due_at?: string | null;
    question_goal?: number;
    status?: string;
    student_assistance_policy?: StudentAssistancePolicy | null;
  },
) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/assignments/${assignmentId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteTeacherClassAssignment(classId: number, assignmentId: number) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/assignments/${assignmentId}`, {
    method: 'DELETE',
  });
}

export async function addPackToClass(classId: number, packId: number) {
  try {
    return await apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/packs`, {
      method: 'POST',
      body: JSON.stringify({ packId }),
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (!message.includes('API route not found')) {
      throw error;
    }

    const existingClass = await getTeacherClass(classId);
    return updateTeacherClass(classId, {
      name: existingClass.name,
      subject: existingClass.subject,
      grade: existingClass.grade,
      color: existingClass.color,
      notes: existingClass.notes,
      pack_id: packId,
    });
  }
}

export async function removePackFromClass(classId: number, packId: number) {
  return apiFetchJson<TeacherClassWorkspace>(`/api/teacher/classes/${classId}/packs/${packId}`, {
    method: 'DELETE',
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
