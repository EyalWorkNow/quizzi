import { getToken } from "@/lib/auth";
import type {
  DashboardOverview,
  LiveSessionMetrics,
  SessionInsights,
  StudentLiveMetrics,
  TeamLeaderboardOut
} from "@/lib/schemas";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api/v1";

function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === "string" && detail.trim().length > 0) return detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const row = item as { msg?: unknown; loc?: unknown };
          const msg = typeof row.msg === "string" ? row.msg : "";
          if (Array.isArray(row.loc)) {
            const path = row.loc.map((piece) => String(piece)).join(".");
            return msg ? `${path}: ${msg}` : path;
          }
          return msg || JSON.stringify(item);
        }
        return String(item);
      })
      .filter((part) => part.trim().length > 0);

    if (parts.length > 0) return parts.join(" | ");
  }

  if (detail && typeof detail === "object") {
    const obj = detail as { message?: unknown; msg?: unknown; error?: unknown };
    if (typeof obj.message === "string" && obj.message.trim().length > 0) return obj.message;
    if (typeof obj.msg === "string" && obj.msg.trim().length > 0) return obj.msg;
    if (typeof obj.error === "string" && obj.error.trim().length > 0) return obj.error;
    return JSON.stringify(detail);
  }

  if (detail != null) return String(detail);
  return "";
}

async function apiFetch<T = any>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");

  if (auth) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = formatApiErrorDetail((data as { detail?: unknown; message?: unknown; error?: unknown }).detail ?? data);
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  signup: (email: string, password: string) =>
    apiFetch<{ access_token: string }>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  logout: () => apiFetch("/auth/logout", { method: "POST" }),
  me: () => apiFetch("/auth/me"),
  listClasses: () =>
    apiFetch<Array<{ id: string; name: string; grade_level: string; join_code: string; created_at: string }>>("/classes"),
  createClass: (name: string, grade_level: string) =>
    apiFetch("/classes", { method: "POST", body: JSON.stringify({ name, grade_level }) }),
  getClassRegistration: (classId: string) => apiFetch(`/classes/${classId}/registration`),
  rotateClassRegistration: (classId: string) => apiFetch(`/classes/${classId}/registration/rotate`, { method: "POST" }),
  listStudents: (classId: string) => apiFetch(`/classes/${classId}/students`),
  studentRegister: (payload: { join_code: string; pseudonym: string; display_name?: string }) =>
    apiFetch("/students/register", { method: "POST", body: JSON.stringify(payload) }, false),
  importRoster: (classId: string, csv_text: string) =>
    apiFetch(`/classes/${classId}/roster/import`, { method: "POST", body: JSON.stringify({ csv_text }) }),
  createSkill: (payload: Record<string, unknown>) =>
    apiFetch("/skills", { method: "POST", body: JSON.stringify(payload) }),
  listSkills: (classId: string) => apiFetch(`/skills?class_id=${classId}`),
  createSource: (payload: Record<string, unknown>) =>
    apiFetch("/content/sources", { method: "POST", body: JSON.stringify(payload) }),
  generateCandidates: (sourceId: string, payload: Record<string, unknown>) =>
    apiFetch(`/content/sources/${sourceId}/generate-candidates`, { method: "POST", body: JSON.stringify(payload) }),
  listCandidates: (classId: string) => apiFetch(`/questions/candidates?class_id=${classId}`),
  patchQuestion: (questionId: string, payload: Record<string, unknown>) =>
    apiFetch(`/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  approveQuestion: (questionId: string) => apiFetch(`/questions/${questionId}/approve`, { method: "POST" }),
  rejectQuestion: (questionId: string) => apiFetch(`/questions/${questionId}/reject`, { method: "POST" }),
  createQuiz: (payload: Record<string, unknown>) =>
    apiFetch("/quizzes", { method: "POST", body: JSON.stringify(payload) }),
  listQuizzes: (classId: string) => apiFetch(`/quizzes?class_id=${classId}`),
  createSession: (class_id: string, quiz_id: string) =>
    apiFetch("/sessions", { method: "POST", body: JSON.stringify({ class_id, quiz_id }) }),
  getSession: (sessionId: string) => apiFetch(`/sessions/${sessionId}`),
  getJoinAccess: (sessionId: string) => apiFetch(`/sessions/${sessionId}/join-access`),
  getDashboardOverview: () => apiFetch<DashboardOverview>("/dashboard/overview"),
  getSessionLiveMetrics: (sessionId: string) => apiFetch<LiveSessionMetrics>(`/dashboard/sessions/${sessionId}/live`),
  getStudentLiveMetrics: (sessionId: string, participantToken: string) =>
    apiFetch<StudentLiveMetrics>(
      `/dashboard/sessions/${sessionId}/me?participant_token=${encodeURIComponent(participantToken)}`,
      undefined,
      false
    ),
  nextQuestion: (sessionId: string) => apiFetch(`/sessions/${sessionId}/next`, { method: "POST" }),
  pauseSession: (sessionId: string) => apiFetch(`/sessions/${sessionId}/pause`, { method: "POST" }),
  resumeSession: (sessionId: string) => apiFetch(`/sessions/${sessionId}/resume`, { method: "POST" }),
  endSession: (sessionId: string) => apiFetch(`/sessions/${sessionId}/end`, { method: "POST" }),
  joinSession: (pin: string, nickname: string) =>
    apiFetch<{ session_id: string; participant_id: string; participant_token: string }>(
      "/sessions/join",
      { method: "POST", body: JSON.stringify({ pin, nickname }) },
      false
    ),
  joinSessionWithTeam: (pin: string, nickname: string, team_name?: string) =>
    apiFetch<{ session_id: string; participant_id: string; participant_token: string; team_name?: string }>(
      "/sessions/join",
      { method: "POST", body: JSON.stringify({ pin, nickname, team_name }) },
      false
    ),
  submitResponse: (sessionId: string, payload: Record<string, unknown>) =>
    apiFetch(`/sessions/${sessionId}/responses`, { method: "POST", body: JSON.stringify(payload) }, false),
  getLeaderboard: (sessionId: string) => apiFetch(`/sessions/${sessionId}/leaderboard`),
  getTeamLeaderboard: (sessionId: string) =>
    apiFetch<TeamLeaderboardOut>(`/sessions/${sessionId}/teams/leaderboard`),
  getReport: (sessionId: string) => apiFetch(`/sessions/${sessionId}/report`),
  getSessionInsights: (sessionId: string) =>
    apiFetch<SessionInsights>(`/analytics/sessions/${sessionId}/insights`),
  getDiagnostics: (sessionId: string) => apiFetch(`/diagnostics/sessions/${sessionId}`),
  getPassport: (classId: string, studentId: string) => apiFetch(`/classes/${classId}/students/${studentId}/passport`)
};
