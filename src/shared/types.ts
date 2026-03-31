import type { GameModeConfig, GameModeId } from './gameModes.ts';

export type SessionStatus =
  | 'LOBBY'
  | 'QUESTION_ACTIVE'
  | 'QUESTION_DISCUSSION'
  | 'QUESTION_REVOTE'
  | 'QUESTION_REVEAL'
  | 'LEADERBOARD'
  | 'ENDED';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface QuizPack {
  id: number;
  teacher_id: number;
  title: string;
  source_text: string;
  course_code?: string;
  course_name?: string;
  section_name?: string;
  academic_term?: string;
  week_label?: string;
  learning_objectives?: string[];
  bloom_levels?: string[];
  pack_notes?: string;
  generation_provider?: string;
  generation_model?: string;
  lms_provider?: string;
  lms_assignment_label?: string;
  created_at: string;
}

export interface Question {
  id: number;
  quiz_pack_id: number;
  type: string;
  prompt: string;
  answers_json: string; // stringified array of strings
  correct_index: number;
  explanation: string;
  tags_json: string; // stringified array of strings
  difficulty: number; // 1-5
  time_limit_seconds: number;
  question_order?: number;
  learning_objective?: string;
  bloom_level?: string;
  concept_id?: string;
  stem_length_chars?: number;
  prompt_complexity_score?: number;
  reading_difficulty?: string;
  media_type?: string;
  distractor_profile_json?: string;
  question_position_policy?: string;
}

export interface Session {
  id: number;
  quiz_pack_id: number;
  pin: string;
  game_type?: GameModeId;
  team_count?: number;
  mode_config?: GameModeConfig;
  status: SessionStatus;
  current_question_index: number;
  started_at: string | null;
  ended_at: string | null;
}

export interface Participant {
  id: number;
  session_id: number;
  nickname: string;
  created_at: string;
}

export interface Answer {
  id: number;
  session_id: number;
  question_id: number;
  participant_id: number;
  chosen_index: number;
  is_correct: boolean;
  response_ms: number;
  score_awarded: number;
  created_at: string;
}

export interface Mastery {
  id: number;
  nickname: string;
  tag: string;
  score: number;
  updated_at: string;
}

export interface PracticeAttempt {
  id: number;
  nickname: string;
  question_id: number;
  is_correct: boolean;
  response_ms: number;
  created_at: string;
}

// API Payloads
export interface CreatePackPayload {
  title: string;
  source_text: string;
}

export interface HostSessionPayload {
  quiz_pack_id: number;
  game_type?: GameModeId;
  team_count?: number;
  mode_config?: GameModeConfig;
}

export interface JoinSessionPayload {
  nickname: string;
}

export interface SubmitAnswerPayload {
  participant_id: number;
  question_id: number;
  chosen_index: number;
  response_ms: number;
  confidence_level?: number;
  telemetry?: TelemetryPayload;
}

export interface UpdateSessionStatePayload {
  status: SessionStatus;
  current_question_index: number;
}

export type TelemetryEventType =
  | 'question_rendered'
  | 'first_interaction'
  | 'option_hover_start'
  | 'option_hover_end'
  | 'option_selected'
  | 'option_deselected'
  | 'submit_clicked'
  | 'tab_blur'
  | 'tab_focus'
  | 'visibility_hidden'
  | 'visibility_visible'
  | 'prompt_reread'
  | 'media_opened'
  | 'network_state_changed'
  | 'ui_freeze_detected';

export interface TelemetryEvent {
  event_type: TelemetryEventType;
  event_ts_ms: number;
  event_seq: number;
  option_index?: number | null;
  payload_json?: string;
  network_latency_ms?: number;
  client_render_delay_ms?: number;
  device_profile?: string;
}

export interface TelemetryPayload {
  tfi_ms?: number;
  final_decision_buffer_ms?: number;
  total_swaps?: number;
  panic_swaps?: number;
  answer_path_json?: string;
  focus_loss_count?: number;
  idle_time_ms?: number;
  blur_time_ms?: number;
  longest_idle_streak_ms?: number;
  pointer_activity_count?: number;
  keyboard_activity_count?: number;
  touch_activity_count?: number;
  same_answer_reclicks?: number;
  option_dwell_json?: string;
  option_hover_counts_json?: string;
  outside_answer_pointer_moves?: number;
  rapid_pointer_jumps?: number;
  submission_retry_count?: number;
  reconnect_count?: number;
  visibility_interruptions?: number;
  network_degraded?: boolean;
  device_profile?: string;
  analytics_version?: string;
  events?: TelemetryEvent[];
}
