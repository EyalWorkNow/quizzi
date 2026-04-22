export type ClassItem = {
  id: string;
  name: string;
  grade_level: string;
  join_code: string;
  created_at: string;
};

export type CandidateQuestion = {
  id: string;
  class_id: string;
  status: "candidate" | "approved" | "rejected";
  stem: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  options: Array<{ id: string; option_key: string; text: string; is_correct: boolean }>;
  tags: Array<{ id: string; tag_type: "skill" | "misconception"; tag_value: string }>;
};

export type SessionEvent = {
  seq: number;
  type: string;
  session_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type DashboardOverview = {
  teacher_id: string;
  totals: {
    classes: number;
    students: number;
    sessions: number;
    active_sessions: number;
    candidate_questions: number;
  };
  classes: Array<{
    id: string;
    name: string;
    grade_level: string;
    join_code: string;
    students_count: number;
    total_sessions: number;
    active_sessions: number;
    weak_skills: Array<{
      skill_id: string;
      skill_name: string;
      avg_mastery: number;
      samples: number;
    }>;
    recent_sessions: Array<{
      session_id: string;
      status: "lobby" | "active" | "paused" | "ended";
      started_at: string | null;
      ended_at: string | null;
    }>;
  }>;
  generated_at: string;
};

export type LiveSessionMetrics = {
  session_id: string;
  class_id: string;
  status: "lobby" | "active" | "paused" | "ended";
  pin: string;
  current_question_index: number;
  active_students: number;
  joined_students: number;
  responses_total: number;
  expected_total: number;
  participation_rate: number;
  teams_active: number;
  top_teams: Array<Record<string, unknown>>;
  current_question: {
    question_id: string;
    stem: string;
    responses: number;
    correct_count: number;
    incorrect_count: number;
    incorrect_rate: number;
    top_wrong_option: string | null;
    top_misconception: string | null;
  } | null;
  dropout_events: number;
  reconnect_events: number;
  assist_cards_count: number;
  updated_at: string;
};

export type StudentLiveMetrics = {
  session_id: string;
  participant_id: string;
  nickname: string;
  status: "lobby" | "active" | "paused" | "ended";
  is_connected: boolean;
  score: number;
  rank: number;
  answered_count: number;
  total_questions: number;
  updated_at: string;
};

export type TeamLeaderboardOut = {
  session_id: string;
  items: Array<{
    team_name: string;
    total_score: number;
    members: number;
    avg_score: number;
  }>;
};

export type SessionInsights = {
  session_id: string;
  question_timeline: Array<Record<string, unknown>>;
  skill_deltas: Array<Record<string, unknown>>;
  latency_analysis: Record<string, unknown>;
  at_risk_students: Array<Record<string, unknown>>;
  assist_effectiveness: Array<Record<string, unknown>>;
  team_insights: Array<Record<string, unknown>>;
  recommendations: string[];
};
