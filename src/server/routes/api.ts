import { Router } from 'express';
import { handleContactSubmission } from '../api/contact.js';
import { createHash, randomInt, randomUUID } from 'crypto';
import db from '../db/index.js';
import { seedDemoDataForTeacher } from '../db/seeding.js';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import { runPythonEngine } from '../services/pythonEngine.js';
import { translateUiTexts } from '../services/uiTranslation.js';
import { buildStudentMemorySnapshot, type StudentMemoryBuildInput, type StudentMemorySnapshot } from '../services/studentMemory.js';
import { broadcastToSession, registerSseClient } from '../services/sseHub.js';
import { resolvePublicAppUrlFromRequest } from '../services/mailer.js';
import { buildRateLimitKey, checkRateLimit, isTrustedOrigin } from '../services/requestGuards.js';
import { createBoundedTaskGate, defaultTaskConcurrency, envTaskConcurrency } from '../services/taskGate.js';
import { getFirebaseAdminAuth } from '../services/firebaseAdmin.js';
import { buildLmsExport } from '../services/lmsProviders.js';
import { GAME_MODES, getGameMode, getTeamGameModeIds, type GameModeConfig } from '../../shared/gameModes.js';
import { buildFollowUpEnginePreview, type FollowUpPlan } from '../../shared/followUpEngine.js';
import { sanitizeSessionSoundtrackChoice } from '../../shared/sessionSoundtracks.js';
import {
  createParticipantAccessToken,
  readParticipantAccessToken,
  resolveStudentIdentityKey,
} from '../services/studentIdentity.js';

import {
  clearTeacherSession,
  createTeacherSession,
  isDemoTeacherEmail,
  issueTeacherSession,
  normalizeTeacherEmail,
  readTeacherSession,
  requireTeacherSession,
  verifyDemoPassword,
} from '../services/demoAuth.js';
import {
  clearStudentSession,
  createStudentSession,
  issueStudentSession,
  readStudentSession,
  requireStudentSession,
} from '../services/studentAuth.js';
import {
  acceptRosterRowForStudentUser,
  claimRosterRowsForStudentUser,
  findRosterRowForStudentUserInClass,
  getPrimaryIdentityKey,
  linkStudentIdentity,
  listStudentIdentityKeys,
  markRosterRowClaimed,
} from '../services/studentIdentityLinks.js';
import {
  createStudentUser,
  getStudentUserByEmail,
  getStudentUserById,
  normalizeStudentEmail,
  updateStudentPassword,
  updateStudentLastLogin,
  updateStudentPreferredLanguage,
  validateStudentEmail,
  validateStudentPassword,
  verifyStudentPassword,
} from '../services/studentUsers.js';
import {
  createStudentPasswordResetRequest,
  verifyStudentPasswordResetCode,
} from '../services/studentPasswordReset.js';
import {
  createTeacherUser,
  getTeacherUserByEmail,
  validateTeacherEmail,
  validateTeacherPassword,
  verifyTeacherPassword,
} from '../services/teacherUsers.js';
import { sendStudentClassInviteEmail } from '../services/studentInvites.js';
import {
  getHydratedTeacherClass,
  getTeacherOwnedClass,
  getTeacherOwnedStudent,
  listTeacherClasses,
  normalizeRosterName,
  listStudentClassWorkspaces,
  sanitizeTeacherClassColor,
} from '../services/teacherClasses.js';
import {
  getHydratedPackWithQuestions,
  getOrCreateMaterialProfile,
  hydratePack,
  listHydratedPacks,
  normalizeGeneratedQuestions,
  syncPackDerivedData,
} from '../services/materialIntel.js';
import {
  buildQuestionGenerationInFlightKey,
  generateQuestionsFromSource,
  improveQuestionsFromSource,
} from '../services/questionGeneration.js';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req: any, file: any, callback: any) => {
    if (!ALLOWED_UPLOAD_TYPES.has(String(file?.mimetype || ''))) {
      callback(new Error(`Unsupported file type: ${String(file?.mimetype || 'unknown')}`));
      return;
    }
    callback(null, true);
  },
});

const router = Router();

router.post('/contact', handleContactSubmission);
const TEAM_GAME_TYPES = new Set(getTeamGameModeIds());
const TEAM_NAME_BANK = [
  'Alpha',
  'Nova',
  'Orbit',
  'Pulse',
  'Axis',
  'Spark',
  'Vertex',
  'Echo',
];

const SUPPORTED_UI_LANGUAGES = new Set(['en', 'he', 'ar']);
const MAX_SESSION_PARTICIPANTS = envTaskConcurrency('QUIZZI_MAX_SESSION_PARTICIPANTS', 500);
const MAX_QUESTION_ANSWERS = 8;
const SESSION_STATE_SET = new Set([
  'LOBBY',
  'QUESTION_ACTIVE',
  'QUESTION_DISCUSSION',
  'QUESTION_REVOTE',
  'QUESTION_REVEAL',
  'LEADERBOARD',
  'ENDED',
]);
const aiGenerationGate = createBoundedTaskGate({
  name: 'ai-generation',
  concurrency: envTaskConcurrency('QUIZZI_AI_GENERATION_CONCURRENCY', Math.max(2, defaultTaskConcurrency(2))),
  maxQueue: envTaskConcurrency('QUIZZI_AI_GENERATION_MAX_QUEUE', 24),
});
const inFlightQuestionGenerations = new Map<string, Promise<any>>();

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function enforceRateLimit(
  req: any,
  res: any,
  namespace: string,
  limit: number,
  windowMs: number,
  ...parts: Array<string | number | null | undefined>
) {
  const result = checkRateLimit(buildRateLimitKey(req, namespace, ...parts), limit, windowMs);
  if (result.allowed) {
    return true;
  }

  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({ error: 'Too many requests, slow down and try again shortly.' });
  return false;
}

function enforceTrustedOrigin(req: any, res: any) {
  if (isTrustedOrigin(req)) return true;
  console.warn(`[security] Origin mismatch: ${String(req.headers.origin || 'unknown')}`);
  res.status(403).json({ error: 'Origin mismatch' });
  return false;
}

function respondWithServerError(res: any, fallbackMessage: string) {
  res.status(500).json({ error: fallbackMessage });
}

function isUniqueConstraintError(error: any, hint = '') {
  const message = String(error?.message || '');
  return message.includes('UNIQUE constraint failed') && (!hint || message.includes(hint));
}

function sanitizeLine(value: unknown, maxLength = 120) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultiline(value: unknown, maxLength = 60000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function sanitizeTranslateTexts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      String(entry || '')
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, 400),
    )
    .filter(Boolean)
    .slice(0, 20);
}

function getRequestedUiLanguage(req: any) {
  const candidate = String(req.query?.ui_language || req.query?.lang || req.headers['x-ui-language'] || '').trim().toLowerCase();
  return SUPPORTED_UI_LANGUAGES.has(candidate) ? candidate : '';
}

async function translateAnalyticsFields<T>(payload: T, targetLanguage: string, selectors: Array<(root: any) => Array<{ holder: any; key: string }>>) {
  if (!payload || !targetLanguage || targetLanguage === 'en') return payload;

  const entries = selectors.flatMap((selector) => selector(payload));
  const originals = entries
    .map(({ holder, key }) => ({ holder, key, value: typeof holder?.[key] === 'string' ? String(holder[key]).trim() : '' }))
    .filter((entry) => entry.value);

  if (!originals.length) return payload;

  const uniqueTexts = Array.from(new Set(originals.map((entry) => entry.value)));
  const translations = await translateUiTexts(uniqueTexts, targetLanguage as 'he' | 'ar');
  const translationMap = new Map(uniqueTexts.map((text, index) => [text, String(translations[index] || text)]));

  originals.forEach(({ holder, key, value }) => {
    holder[key] = translationMap.get(value) || value;
  });

  return payload;
}

function parsePositiveInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback = minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function sanitizeBooleanFlag(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;

  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function sanitizeSessionPin(value: unknown) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

function sanitizeJsonBlob(value: unknown, maxLength: number, fallback: string) {
  try {
    const raw =
      typeof value === 'string'
        ? value
        : value === undefined || value === null
          ? fallback
          : JSON.stringify(value);
    const trimmed = String(raw || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
    return trimmed || fallback;
  } catch {
    return fallback;
  }
}

function sanitizeTelemetry(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const telemetry = value as Record<string, unknown>;
  return {
    tfi_ms: clampNumber(telemetry.tfi_ms, 0, 300_000, 0),
    final_decision_buffer_ms: clampNumber(telemetry.final_decision_buffer_ms, 0, 300_000, 0),
    total_swaps: clampNumber(telemetry.total_swaps, 0, 100, 0),
    panic_swaps: clampNumber(telemetry.panic_swaps, 0, 100, 0),
    answer_path_json: sanitizeJsonBlob(telemetry.answer_path_json, 8_000, '[]'),
    focus_loss_count: clampNumber(telemetry.focus_loss_count, 0, 100, 0),
    idle_time_ms: clampNumber(telemetry.idle_time_ms, 0, 300_000, 0),
    blur_time_ms: clampNumber(telemetry.blur_time_ms, 0, 300_000, 0),
    longest_idle_streak_ms: clampNumber(telemetry.longest_idle_streak_ms, 0, 300_000, 0),
    pointer_activity_count: clampNumber(telemetry.pointer_activity_count, 0, 10_000, 0),
    keyboard_activity_count: clampNumber(telemetry.keyboard_activity_count, 0, 10_000, 0),
    touch_activity_count: clampNumber(telemetry.touch_activity_count, 0, 10_000, 0),
    same_answer_reclicks: clampNumber(telemetry.same_answer_reclicks, 0, 10_000, 0),
    option_dwell_json: sanitizeJsonBlob(telemetry.option_dwell_json, 4_000, '{}'),
    submission_retry_count: clampNumber(telemetry.submission_retry_count, 0, 100, 0),
    reconnect_count: clampNumber(telemetry.reconnect_count, 0, 100, 0),
    visibility_interruptions: clampNumber(telemetry.visibility_interruptions, 0, 100, 0),
    network_degraded: sanitizeBooleanFlag(telemetry.network_degraded, false),
    device_profile: sanitizeLine(telemetry.device_profile, 40),
  };
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeStringList(value: unknown, maxItems = 8, maxLength = 80) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return Array.from(
    new Set(
      entries
        .map((entry) => sanitizeLine(entry, maxLength))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function sanitizeAcademicMeta(value: any) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    course_code: sanitizeLine(raw.course_code, 32),
    course_name: sanitizeLine(raw.course_name, 120),
    section_name: sanitizeLine(raw.section_name, 60),
    academic_term: sanitizeLine(raw.academic_term, 40),
    week_label: sanitizeLine(raw.week_label, 40),
    learning_objectives: sanitizeStringList(raw.learning_objectives, 8, 120),
    bloom_levels: sanitizeStringList(raw.bloom_levels, 6, 40),
    pack_notes: sanitizeMultiline(raw.pack_notes, 1200),
  };
}

function sanitizeGenerationMeta(value: any) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    provider: sanitizeLine(raw.provider || raw.provider_id, 32),
    model: sanitizeLine(raw.model || raw.model_id, 80),
    contract_version: sanitizeLine(raw.contract_version || raw.contract, 80),
  };
}

function sanitizeTeacherClassPayload(value: any) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    name: sanitizeLine(raw.name, 80),
    subject: sanitizeLine(raw.subject, 80),
    grade: sanitizeLine(raw.grade, 40),
    color: sanitizeTeacherClassColor(raw.color),
    notes: sanitizeMultiline(raw.notes, 1200),
    pack_id: parsePositiveInt(raw.pack_id ?? raw.packId),
  };
}

function sanitizeTeacherStudentName(value: unknown) {
  return sanitizeLine(value, 120);
}

function sanitizeStudentDisplayName(value: unknown) {
  return sanitizeLine(value, 160);
}

function sanitizeStudentEmailInput(value: unknown) {
  return normalizeStudentEmail(String(value || ''));
}

function deriveStudentNameFromEmail(email: string) {
  const localPart = String(email || '').split('@')[0] || '';
  const readableName = localPart.replace(/[._-]+/g, ' ').trim();
  return sanitizeTeacherStudentName(readableName || 'Student');
}

function sanitizeQuestionImage(value: unknown) {
  const normalized = sanitizeMultiline(value, 4_000_000);
  if (!normalized) return '';
  if (normalized.startsWith('data:image/')) return normalized;
  if (/^https?:\/\/\S+$/i.test(normalized)) return normalized;
  return '';
}

function sanitizeQuestionDraft(question: any, index: number, fallbackTags: string[] = []) {
  const safeTags = Array.isArray(question?.tags) ? question.tags : fallbackTags;
  const rawAnswers = Array.isArray(question?.answers)
    ? question.answers
    : typeof question?.answers_json === 'string'
      ? parseJsonArray(question.answers_json)
      : Array.isArray(question?.answers_json)
        ? question.answers_json
      : [];
  const answers = rawAnswers
    .map((answer: unknown) => sanitizeLine(answer, 180))
    .filter(Boolean)
    .slice(0, MAX_QUESTION_ANSWERS);
  return {
    prompt: sanitizeMultiline(question?.prompt, 320),
    answers,
    correct_index: clampNumber(question?.correct_index, 0, Math.max(0, answers.length - 1), 0),
    explanation: sanitizeMultiline(question?.explanation, 500),
    image_url: sanitizeQuestionImage(question?.image_url ?? question?.imageUrl),
    tags: sanitizeStringList(safeTags, 6, 40),
    time_limit_seconds: clampNumber(question?.time_limit_seconds, 10, 90, 20),
    question_order: clampNumber(question?.question_order, 1, 999, index + 1),
    learning_objective: sanitizeLine(question?.learning_objective, 120),
    bloom_level: sanitizeLine(question?.bloom_level, 40),
  };
}

function sanitizeModeConfig(gameType: string, value: unknown): GameModeConfig {
  const base = { ...getGameMode(gameType).defaultModeConfig };
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  const modeConfig: GameModeConfig = {
    ...base,
  };

  if (typeof raw.timer_multiplier === 'number' || typeof raw.timer_multiplier === 'string') {
    const timerMultiplier = Number(raw.timer_multiplier);
    if (Number.isFinite(timerMultiplier)) {
      modeConfig.timer_multiplier = Math.max(0.45, Math.min(1.5, Number(timerMultiplier.toFixed(2))));
    }
  }

  if (typeof raw.min_time_limit_seconds === 'number' || typeof raw.min_time_limit_seconds === 'string') {
    modeConfig.min_time_limit_seconds = clampNumber(raw.min_time_limit_seconds, 5, 60, 5);
  }

  if (typeof raw.max_time_limit_seconds === 'number' || typeof raw.max_time_limit_seconds === 'string') {
    modeConfig.max_time_limit_seconds = clampNumber(raw.max_time_limit_seconds, 5, 90, 30);
  }

  if (raw.timer_mode === 'countdown' || raw.timer_mode === 'unlimited') {
    modeConfig.timer_mode = raw.timer_mode;
  }

  if (typeof raw.requires_confidence === 'boolean') {
    modeConfig.requires_confidence = raw.requires_confidence;
  }

  if (typeof raw.peer_instruction_enabled === 'boolean') {
    modeConfig.peer_instruction_enabled = raw.peer_instruction_enabled;
  }

  if (typeof raw.discussion_seconds === 'number' || typeof raw.discussion_seconds === 'string') {
    modeConfig.discussion_seconds = clampNumber(raw.discussion_seconds, 10, 90, 30);
  }

  if (typeof raw.revote_seconds === 'number' || typeof raw.revote_seconds === 'string') {
    modeConfig.revote_seconds = clampNumber(raw.revote_seconds, 8, 60, 22);
  }

  if (
    raw.scoring_profile === 'standard' ||
    raw.scoring_profile === 'speed' ||
    raw.scoring_profile === 'confidence' ||
    raw.scoring_profile === 'coverage' ||
    raw.scoring_profile === 'accuracy'
  ) {
    modeConfig.scoring_profile = raw.scoring_profile;
  }

  if (raw.leaderboard_style === 'standard' || raw.leaderboard_style === 'accuracy') {
    modeConfig.leaderboard_style = raw.leaderboard_style;
  }

  if (raw.rejoin_policy === 'restore' || raw.rejoin_policy === 'strict') {
    modeConfig.rejoin_policy = raw.rejoin_policy;
  }

  if (typeof raw.sound_fx_enabled === 'boolean') {
    modeConfig.sound_fx_enabled = raw.sound_fx_enabled;
  }

  if (typeof raw.reveal_duration_seconds === 'number' || typeof raw.reveal_duration_seconds === 'string') {
    modeConfig.reveal_duration_seconds = clampNumber(raw.reveal_duration_seconds, 3, 15, 6);
  }

  if (raw.lobby_track_id !== undefined) {
    modeConfig.lobby_track_id = sanitizeSessionSoundtrackChoice(raw.lobby_track_id, base.lobby_track_id || 'none');
  }

  if (raw.gameplay_track_id !== undefined) {
    modeConfig.gameplay_track_id = sanitizeSessionSoundtrackChoice(
      raw.gameplay_track_id,
      base.gameplay_track_id || 'none',
    );
  }

  return modeConfig;
}

function getSessionModeConfig(session: any): GameModeConfig {
  return sanitizeModeConfig(String(session?.game_type || 'classic_quiz'), parseJsonObject(session?.mode_config_json));
}

function resolveQuestionTimeLimit(question: any, session: any) {
  const modeConfig = getSessionModeConfig(session);
  if (modeConfig.timer_mode === 'unlimited') {
    return 0;
  }
  const baseSeconds = clampNumber(question?.time_limit_seconds, 8, 90, 20);
  const timerMultiplier = Number(modeConfig.timer_multiplier || 1);
  const minSeconds = clampNumber(modeConfig.min_time_limit_seconds, 5, 90, 8);
  const maxSeconds = clampNumber(modeConfig.max_time_limit_seconds, minSeconds, 120, Math.max(minSeconds, 30));
  return Math.max(minSeconds, Math.min(maxSeconds, Math.round(baseSeconds * timerMultiplier)));
}

function resolvePhaseTimeLimit(question: any, session: any, status: string) {
  const modeConfig = getSessionModeConfig(session);
  if (status === 'QUESTION_DISCUSSION') {
    return clampNumber(modeConfig.discussion_seconds, 10, 90, 30);
  }
  if (status === 'QUESTION_REVOTE') {
    return clampNumber(modeConfig.revote_seconds, 8, 60, 22);
  }
  return resolveQuestionTimeLimit(question, session);
}

function resolveConfidenceBonus(gameType: string, isCorrect: boolean, confidenceLevel: number) {
  if (gameType !== 'confidence_climb' || !isCorrect) {
    return 0;
  }

  if (confidenceLevel >= 3) return 60;
  if (confidenceLevel === 2) return 30;
  return 10;
}

function hydrateSessionRow(session: any) {
  if (!session) return null;
  return {
    ...session,
    id: Number(session.id),
    quiz_pack_id: Number(session.quiz_pack_id),
    teacher_class_id: Number(session.teacher_class_id || 0) || null,
    current_question_index: Number(session.current_question_index || 0),
    team_count: Number(session.team_count || 0),
    mode_config: getSessionModeConfig(session),
  };
}

function buildTeamIdentity(teamId: number) {
  const index = Math.max(0, teamId - 1);
  return `Team ${TEAM_NAME_BANK[index] || `#${teamId}`}`;
}

function isTeamGame(gameType: string | null | undefined) {
  return TEAM_GAME_TYPES.has(String(gameType || '').trim() as any);
}

function getParticipantIdentityKey(participant: { identity_key?: string | null; nickname?: string | null }) {
  return resolveStudentIdentityKey(participant?.identity_key, participant?.nickname || '');
}

function humanizeTag(tag: unknown) {
  return String(tag || '')
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function getMasteryRows(identityKey: string) {
  return (await db.prepare('SELECT tag, score FROM mastery WHERE identity_key = ?').all(identityKey));
}

function parseMemorySnapshot(value: unknown): StudentMemorySnapshot | null {
  try {
    const parsed = JSON.parse(String(value || 'null'));
    return parsed && typeof parsed === 'object' ? (parsed as StudentMemorySnapshot) : null;
  } catch {
    return null;
  }
}

async function readStudentMemorySnapshot(identityKey: string) {
  const row = (await db
      .prepare('SELECT snapshot_json FROM student_memory_snapshots WHERE identity_key = ? LIMIT 1')
      .get(identityKey)) as any;
  return parseMemorySnapshot(row?.snapshot_json);
}

async function readStudentMemorySnapshotRow(identityKey: string) {
  return (await db
    .prepare(`
      SELECT snapshot_json, teacher_note, teacher_note_updated_at, updated_at
      FROM student_memory_snapshots
      WHERE identity_key = ?
      LIMIT 1
    `)
    .get(identityKey)) as any;
}

async function updateStudentMemorySnapshot(input: {
  identityKey: string;
  nickname: string;
  overallAnalytics?: any;
  sessionAnalytics?: any;
  mastery?: any[];
  answers?: any[];
  practiceAttempts?: any[];
  sessions?: any[];
  questions?: any[];
  teacherNote?: string | null;
  teacherNoteUpdatedAt?: string | null;
}) {
  const existing = await readStudentMemorySnapshotRow(input.identityKey);
  const teacherNote = sanitizeMultiline(existing?.teacher_note || '', 1200);
  const teacherNoteUpdatedAt = existing?.teacher_note_updated_at ? String(existing.teacher_note_updated_at) : null;
  const snapshot = buildStudentMemorySnapshot({
    ...input,
    teacherNote,
    teacherNoteUpdatedAt,
  });
  const sourceSummary = {
    sessions_played: Number(input.sessions?.length || 0),
    answers_count: Number(input.answers?.length || 0),
    practice_attempts_count: Number(input.practiceAttempts?.length || 0),
    mastery_tags_count: Number(input.mastery?.length || 0),
  };
  await db
    .prepare(`
      INSERT INTO student_memory_snapshots (identity_key, nickname, snapshot_json, source_summary_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(identity_key) DO UPDATE
      SET nickname = excluded.nickname,
          snapshot_json = excluded.snapshot_json,
          source_summary_json = excluded.source_summary_json,
          updated_at = CURRENT_TIMESTAMP
    `)
    .run(
      input.identityKey,
      input.nickname,
      JSON.stringify(snapshot),
      JSON.stringify(sourceSummary),
    );
  return snapshot;
}

async function saveStudentMemoryTeacherNote(identityKey: string, nickname: string, note: string) {
  const sanitizedNote = sanitizeMultiline(note, 1200);
  const existing = await readStudentMemorySnapshotRow(identityKey);
  const snapshot = parseMemorySnapshot(existing?.snapshot_json) || buildStudentMemorySnapshot({
    identityKey,
    nickname,
    teacherNote: sanitizedNote,
    teacherNoteUpdatedAt: new Date().toISOString(),
  });
  const mergedSnapshot: StudentMemorySnapshot = {
    ...snapshot,
    teacher_notes: {
      note: sanitizedNote,
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
  await db
    .prepare(`
      INSERT INTO student_memory_snapshots (
        identity_key,
        nickname,
        snapshot_json,
        source_summary_json,
        teacher_note,
        teacher_note_updated_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(identity_key) DO UPDATE
      SET nickname = excluded.nickname,
          snapshot_json = excluded.snapshot_json,
          teacher_note = excluded.teacher_note,
          teacher_note_updated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
    `)
    .run(
      identityKey,
      nickname,
      JSON.stringify(mergedSnapshot),
      existing?.source_summary_json || '{}',
      sanitizedNote,
    );
  return mergedSnapshot;
}

async function buildClassMemorySummary(sessionId: number) {
  const rows = (await db
    .prepare(`
      SELECT
        p.id,
        p.nickname,
        p.identity_key,
        p.student_user_id,
        sil.identity_key AS primary_identity_key,
        sms.snapshot_json,
        sms.teacher_note,
        sms.teacher_note_updated_at
      FROM participants p
      LEFT JOIN student_identity_links sil
        ON sil.student_user_id = p.student_user_id
       AND COALESCE(sil.is_primary, 0) = 1
      LEFT JOIN student_memory_snapshots sms
        ON sms.identity_key = COALESCE(sil.identity_key, p.identity_key)
      WHERE p.session_id = ?
    `)
    .all(sessionId)) as any[];

  const students = rows
    .map((row: any) => {
      const snapshot = parseMemorySnapshot(row?.snapshot_json);
      if (!snapshot) return null;
      return {
        id: Number(row.id || 0),
        nickname: String(row.nickname || snapshot.nickname || 'Student'),
        identity_key: String(row.primary_identity_key || row.identity_key || snapshot.identity_key || ''),
        account_linked: Boolean(Number(row.student_user_id || 0)),
        profile_mode: Number(row.student_user_id || 0) ? 'longitudinal' : 'session-only',
        action: snapshot.recommended_next_step?.action || 'monitor',
        focus_tags: Array.isArray(snapshot.recommended_next_step?.focus_tags) ? snapshot.recommended_next_step.focus_tags : [],
        confidence_band: snapshot.trust?.confidence_band || snapshot.behavior_baseline?.confidence_band || 'low',
        stress_index: Number(snapshot.behavior_baseline?.stress_index || 0),
        accuracy_pct: Number(snapshot.history_rollup?.accuracy_pct || 0),
        headline: snapshot.summary?.headline || '',
        coaching: snapshot.coaching || null,
        trust: snapshot.trust || null,
        teacher_note: String(row.teacher_note || snapshot.teacher_notes?.note || '').trim(),
      };
    })
    .filter(Boolean) as any[];

  const actionCounts = students.reduce((acc: Record<string, number>, student: any) => {
    const key = String(student.action || 'monitor');
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const focusTagCounts = students.reduce((acc: Record<string, number>, student: any) => {
    for (const tag of student.focus_tags || []) {
      acc[tag] = Number(acc[tag] || 0) + 1;
    }
    return acc;
  }, {});
  const sortedTags = Object.entries(focusTagCounts).sort((left, right) => Number(right[1]) - Number(left[1]));

  const alerts = [
    actionCounts.confidence_reset
      ? {
          id: 'memory-confidence-reset',
          severity: actionCounts.confidence_reset >= 3 ? 'high' : 'medium',
          title: `${actionCounts.confidence_reset} students need a confidence reset`,
          body: 'Their memory trace says pressure is distorting performance more than a new content push would help.',
          count: actionCounts.confidence_reset,
        }
      : null,
    sortedTags[0] && Number(sortedTags[0][1]) >= Math.max(2, Math.ceil(students.length * 0.25))
      ? {
          id: 'memory-shared-weak-tag',
          severity: Number(sortedTags[0][1]) >= Math.max(3, Math.ceil(students.length * 0.4)) ? 'high' : 'medium',
          title: `${humanizeTag(sortedTags[0][0])} keeps resurfacing across the class`,
          body: `${sortedTags[0][1]} students have this tag in their remembered weak spots right now.`,
          count: Number(sortedTags[0][1]),
        }
      : null,
    students.filter((student: any) => String(student.confidence_band) === 'low').length
      ? {
          id: 'memory-low-confidence-band',
          severity: students.filter((student: any) => String(student.confidence_band) === 'low').length >= 3 ? 'medium' : 'low',
          title: `${students.filter((student: any) => String(student.confidence_band) === 'low').length} students still have low memory confidence`,
          body: 'Those learners need more evidence before the board should treat the memory read as stable.',
          count: students.filter((student: any) => String(student.confidence_band) === 'low').length,
        }
      : null,
  ].filter(Boolean);

  const groups = [
    {
      id: 'memory-confidence-reset',
      label: 'Confidence Reset',
      body: 'High pressure plus weak memory traces. Use calmer pacing and fewer questions.',
      student_ids: students.filter((student: any) => student.action === 'confidence_reset').map((student: any) => student.id),
      students: students.filter((student: any) => student.action === 'confidence_reset').map((student: any) => student.nickname),
      focus_tags: Array.from(new Set(students.filter((student: any) => student.action === 'confidence_reset').flatMap((student: any) => student.focus_tags || []))).slice(0, 4),
    },
    {
      id: 'memory-adaptive-practice',
      label: 'Adaptive Practice',
      body: 'Students ready for targeted same-material practice based on remembered weak tags.',
      student_ids: students.filter((student: any) => student.action === 'adaptive_practice').map((student: any) => student.id),
      students: students.filter((student: any) => student.action === 'adaptive_practice').map((student: any) => student.nickname),
      focus_tags: Array.from(new Set(students.filter((student: any) => student.action === 'adaptive_practice').flatMap((student: any) => student.focus_tags || []))).slice(0, 4),
    },
    {
      id: 'memory-momentum',
      label: 'Momentum Keepers',
      body: 'Students whose memory trace is stable enough for reinforcement instead of reteach.',
      student_ids: students.filter((student: any) => student.action === 'keep_momentum').map((student: any) => student.id),
      students: students.filter((student: any) => student.action === 'keep_momentum').map((student: any) => student.nickname),
      focus_tags: Array.from(new Set(students.filter((student: any) => student.action === 'keep_momentum').flatMap((student: any) => student.focus_tags || []))).slice(0, 4),
    },
  ]
    .map((group) => ({ ...group, count: group.student_ids.length }))
    .filter((group) => group.count > 0);

  const watchlist = students
    .filter((student: any) =>
      student.action === 'confidence_reset' ||
      student.action === 'adaptive_practice' ||
      student.accuracy_pct < 72 ||
      student.stress_index >= 55,
    )
    .sort((left: any, right: any) =>
      Number(right.stress_index || 0) - Number(left.stress_index || 0) ||
      Number(left.accuracy_pct || 0) - Number(right.accuracy_pct || 0),
    )
    .slice(0, 6)
    .map((student: any) => ({
      id: student.id,
      nickname: student.nickname,
      action: student.action,
      headline: student.headline,
      focus_tags: student.focus_tags,
      stress_index: student.stress_index,
      accuracy_pct: student.accuracy_pct,
      teacher_note: student.teacher_note,
    }));

  const autopilotQueue = watchlist.map((student: any) => ({
    id: `autopilot-${student.id}`,
    participant_id: student.id,
    nickname: student.nickname,
    title:
      student.action === 'confidence_reset'
        ? `Launch a calm confidence reset for ${student.nickname}`
        : `Launch targeted memory practice for ${student.nickname}`,
    body:
      student.action === 'confidence_reset'
        ? `Lower pressure around ${student.focus_tags.slice(0, 2).join(', ') || 'the weakest areas'} before the next live round.`
        : `Use remembered weak tags ${student.focus_tags.slice(0, 3).join(', ') || 'from the memory trace'} for a same-material intervention.`,
    focus_tags: student.focus_tags.slice(0, 4),
    recommended_count: student.action === 'confidence_reset' ? 3 : 5,
  }));

  return {
    students,
    alerts,
    groups,
    watchlist,
    autopilot_queue: autopilotQueue,
    top_focus_tags: sortedTags.slice(0, 5).map(([tag, count]) => ({ tag, count })),
    summary: {
      snapshot_count: students.length,
      confidence_reset_count: Number(actionCounts.confidence_reset || 0),
      adaptive_practice_count: Number(actionCounts.adaptive_practice || 0),
      keep_momentum_count: Number(actionCounts.keep_momentum || 0),
    },
  };
}

function buildMemoryInterventionPlan(context: any) {
  const studentMemory = context?.studentMemory || {};
  const recommendedAction = String(studentMemory?.recommended_next_step?.action || '');
  const recommendedFocusTags = Array.isArray(studentMemory?.recommended_next_step?.focus_tags)
    ? studentMemory.recommended_next_step.focus_tags
    : [];
  const focusTags = uniqueStrings([
    ...recommendedFocusTags,
    ...deriveAdaptiveFocusTags({
      sessionAnalytics: context?.sessionAnalytics,
      overallAnalytics: context?.overallAnalytics,
      studentSummary: context?.studentSummary,
      participant: context?.participant,
    }),
  ]).slice(0, 4);
  const priorityQuestionIds = deriveAdaptivePriorityQuestionIds({
    sessionAnalytics: context?.sessionAnalytics,
    overallAnalytics: context?.overallAnalytics,
    answers: context?.classPayload?.answers?.filter((answer: any) => Number(answer?.participant_id || 0) === Number(context?.participant?.id || 0)) || [],
  });
  const recommendedCount =
    recommendedAction === 'confidence_reset'
      ? 3
      : recommendedAction === 'targeted_review'
        ? 4
        : 5;

  return {
    intervention_type: recommendedAction || 'adaptive_practice',
    focus_tags: focusTags,
    priority_question_ids: priorityQuestionIds,
    recommended_count: recommendedCount,
    reasons: Array.isArray(studentMemory?.recommended_next_step?.reasons) ? studentMemory.recommended_next_step.reasons : [],
    title: String(studentMemory?.recommended_next_step?.title || 'Run memory intervention'),
    body: String(studentMemory?.recommended_next_step?.body || 'Use the memory trace to shape the next support move.'),
  };
}

const upsertMastery = db.prepare(`
  INSERT INTO mastery (identity_key, nickname, tag, score) VALUES (?, ?, ?, ?)
  ON CONFLICT(identity_key, tag) DO UPDATE
  SET score = excluded.score,
      nickname = excluded.nickname,
      updated_at = CURRENT_TIMESTAMP
`);

const applyMasteryUpdates = db.transaction((
  identityKey: string,
  nickname: string,
  updates: Array<{ tag: string; score: number }>,
) => {
  for (const update of updates) {
    upsertMastery.run(identityKey, nickname, update.tag, update.score);
  }
});

async function getParticipantSessionScoreState(sessionId: number, participantId: number) {
  const totalScore = Number(
    (
      await db
        .prepare('SELECT COALESCE(SUM(score_awarded), 0) as total FROM answers WHERE session_id = ? AND participant_id = ?')
        .get(sessionId, participantId)
    )?.total || 0,
  );
  const recentAnswers = (await db
        .prepare(`
      SELECT a.is_correct
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      WHERE a.session_id = ? AND a.participant_id = ?
      ORDER BY q.question_order DESC, a.id DESC
      LIMIT 25
    `)
        .all(sessionId, participantId)) as any[];

  let streak = 0;
  for (const answer of recentAnswers) {
    if (!Number(answer?.is_correct)) break;
    streak += 1;
  }

  return {
    score: totalScore,
    streak,
  };
}

async function getSessionPayload(sessionId: number) {
  const session = (await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
  if (!session) return null;

  const pack = (await db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(session.quiz_pack_id));
  const participants = (await db.prepare('SELECT * FROM participants WHERE session_id = ?').all(sessionId));
  const questions = (await db
      .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
      .all(session.quiz_pack_id));
  const answers = (await db.prepare('SELECT * FROM answers WHERE session_id = ?').all(sessionId));
  const behavior_logs = (await db.prepare('SELECT * FROM student_behavior_logs WHERE session_id = ?').all(sessionId));

  return { session, pack, participants, questions, answers, behavior_logs };
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

async function getTeacherOwnedPack(packId: number, teacherUserId: number) {
  return (await db.prepare('SELECT * FROM quiz_packs WHERE id = ? AND teacher_id = ?').get(packId, teacherUserId)) as any;
}

async function getTeacherOwnedSession(sessionId: number, teacherUserId: number) {
  return (await db
      .prepare(`
      SELECT s.*
      FROM sessions s
      JOIN quiz_packs qp ON qp.id = s.quiz_pack_id
      WHERE s.id = ? AND qp.teacher_id = ?
    `)
      .get(sessionId, teacherUserId)) as any;
}

async function getTeacherOwnedSessionByPin(pin: string, teacherUserId: number) {
  return (await db
      .prepare(`
      SELECT s.*
      FROM sessions s
      JOIN quiz_packs qp ON qp.id = s.quiz_pack_id
      WHERE s.pin = ? AND qp.teacher_id = ?
    `)
      .get(pin, teacherUserId)) as any;
}

async function getTeacherOwnedParticipant(participantId: number, teacherUserId: number) {
  return (await db
      .prepare(`
      SELECT p.*, s.id AS live_session_id, s.quiz_pack_id
      FROM participants p
      JOIN sessions s ON s.id = p.session_id
      JOIN quiz_packs qp ON qp.id = s.quiz_pack_id
      WHERE p.id = ? AND qp.teacher_id = ?
    `)
      .get(participantId, teacherUserId)) as any;
}

async function getParticipantsForIdentityKey(identityKey: string) {
  return (await db.prepare('SELECT * FROM participants WHERE identity_key = ?').all(identityKey));
}

function buildSqlPlaceholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function mergeMasteryRows(rows: any[]) {
  const byTag = new Map<string, { tag: string; score: number; updated_at: string }>();
  rows.forEach((row: any) => {
    const tag = sanitizeLine(row?.tag, 64);
    if (!tag) return;
    const updatedAt = String(row?.updated_at || '');
    const score = Number(row?.score || 0);
    const existing = byTag.get(tag);
    if (!existing || updatedAt > existing.updated_at || score > existing.score) {
      byTag.set(tag, {
        tag,
        score,
        updated_at: updatedAt,
      });
    }
  });
  return Array.from(byTag.values()).sort((left, right) => left.tag.localeCompare(right.tag));
}

async function listResolvedIdentityKeys({
  studentUserId,
  identityKey,
}: {
  studentUserId?: number;
  identityKey?: string | null;
}) {
  const keys = new Set<string>();
  const safeIdentityKey = resolveStudentIdentityKey(identityKey, '');
  if (safeIdentityKey) {
    keys.add(safeIdentityKey);
  }

  const studentId = Math.max(0, Math.floor(Number(studentUserId) || 0));
  if (!studentId) {
    return Array.from(keys);
  }

  (await listStudentIdentityKeys(studentId)).forEach((key) => {
    const safeKey = resolveStudentIdentityKey(key, '');
    if (safeKey) keys.add(safeKey);
  });

  const participantIdentityRows = (await db
    .prepare(`
      SELECT DISTINCT identity_key
      FROM participants
      WHERE student_user_id = ?
        AND TRIM(COALESCE(identity_key, '')) <> ''
    `)
    .all(studentId)) as any[];
  participantIdentityRows.forEach((row: any) => {
    const safeKey = resolveStudentIdentityKey(row?.identity_key, '');
    if (safeKey) keys.add(safeKey);
  });

  return Array.from(keys);
}

async function getParticipantsForStudentScope({
  studentUserId,
  identityKeys,
}: {
  studentUserId?: number;
  identityKeys: string[];
}) {
  const studentId = Math.max(0, Math.floor(Number(studentUserId) || 0));
  const safeKeys = uniqueStrings(identityKeys.map((key) => resolveStudentIdentityKey(key, '')));
  if (!studentId && !safeKeys.length) return [];

  if (studentId && safeKeys.length) {
    return (await db
      .prepare(`
        SELECT *
        FROM participants
        WHERE student_user_id = ?
           OR identity_key IN (${buildSqlPlaceholders(safeKeys.length)})
        ORDER BY created_at DESC, id DESC
      `)
      .all(studentId, ...safeKeys)) as any[];
  }

  if (studentId) {
    return (await db
      .prepare(`
        SELECT *
        FROM participants
        WHERE student_user_id = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(studentId)) as any[];
  }

  return (await db
    .prepare(`
      SELECT *
      FROM participants
      WHERE identity_key IN (${buildSqlPlaceholders(safeKeys.length)})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...safeKeys)) as any[];
}

async function getAnswersForParticipantIds(participantIds: number[]) {
  const ids = uniqueNumbers(participantIds);
  if (!ids.length) return [];
  return (await db
    .prepare(`
      SELECT *
      FROM answers
      WHERE participant_id IN (${buildSqlPlaceholders(ids.length)})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...ids)) as any[];
}

async function getPracticeAttemptsForIdentityKeys(identityKeys: string[]) {
  const safeKeys = uniqueStrings(identityKeys.map((key) => resolveStudentIdentityKey(key, '')));
  if (!safeKeys.length) return [];
  return (await db
    .prepare(`
      SELECT *
      FROM practice_attempts
      WHERE identity_key IN (${buildSqlPlaceholders(safeKeys.length)})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...safeKeys)) as any[];
}

async function getMasteryRowsForIdentityKeys(identityKeys: string[]) {
  const safeKeys = uniqueStrings(identityKeys.map((key) => resolveStudentIdentityKey(key, '')));
  if (!safeKeys.length) return [];
  const rows = (await db
    .prepare(`
      SELECT tag, score, updated_at
      FROM mastery
      WHERE identity_key IN (${buildSqlPlaceholders(safeKeys.length)})
      ORDER BY updated_at DESC, id DESC
    `)
    .all(...safeKeys)) as any[];
  return mergeMasteryRows(rows);
}

async function buildStudentClassSummaries(studentUserId: number) {
  const studentUser = await getStudentUserById(studentUserId);
  return await listStudentClassWorkspaces(studentUserId, studentUser?.email || '');
}

function sanitizeAssignmentTitle(value: unknown) {
  return String(value || '').trim().slice(0, 140);
}

function sanitizeAssignmentInstructions(value: unknown) {
  return String(value || '').trim().slice(0, 2000);
}

function sanitizeAssignmentDueAt(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function sanitizeAssignmentQuestionGoal(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

async function listTeacherClassAssignments(classId: number) {
  return (await db
    .prepare(`
      SELECT
        tca.*,
        qp.title AS pack_title,
        COALESCE(qp.question_count_cache, 0) AS pack_question_count
      FROM teacher_class_assignments tca
      LEFT JOIN quiz_packs qp ON qp.id = tca.pack_id
      WHERE tca.class_id = ?
        AND COALESCE(tca.archived, 0) = 0
      ORDER BY
        CASE WHEN LOWER(COALESCE(tca.status, 'active')) = 'active' THEN 0 ELSE 1 END,
        COALESCE(tca.due_at, tca.created_at) ASC,
        tca.id DESC
    `)
    .all(classId)) as any[];
}

async function getTeacherClassAssignmentById(classId: number, assignmentId: number) {
  return (await db
    .prepare(`
      SELECT *
      FROM teacher_class_assignments
      WHERE id = ?
        AND class_id = ?
        AND COALESCE(archived, 0) = 0
      LIMIT 1
    `)
    .get(assignmentId, classId)) as any;
}

async function buildAssignmentProgressMap(classBoard: any, packId: number) {
  const students = Array.isArray(classBoard?.students) ? classBoard.students : [];
  const questionRows = (await db
    .prepare(`
      SELECT id
      FROM questions
      WHERE quiz_pack_id = ?
    `)
    .all(packId)) as any[];
  const questionIds = uniqueNumbers(questionRows.map((row: any) => row.id));
  if (!students.length || !questionIds.length) {
    return {
      totalQuestions: questionIds.length,
      byStudentId: new Map<number, { attemptedQuestions: number; attemptCount: number; accuracyPct: number | null; lastActivityAt: string | null }>(),
    };
  }

  const identityKeyToStudentId = new Map<string, number>();
  for (const student of students) {
    const studentUserId = Number(student?.student_user_id || 0);
    if (!studentUserId) continue;
    const identityKeys = await listResolvedIdentityKeys({ studentUserId });
    identityKeys.forEach((identityKey) => {
      const safeKey = resolveStudentIdentityKey(identityKey, '');
      if (safeKey) identityKeyToStudentId.set(safeKey, Number(student.id));
    });
  }

  const identityKeys = Array.from(identityKeyToStudentId.keys());
  if (!identityKeys.length) {
    return {
      totalQuestions: questionIds.length,
      byStudentId: new Map<number, { attemptedQuestions: number; attemptCount: number; accuracyPct: number | null; lastActivityAt: string | null }>(),
    };
  }

  const attemptRows = (await db
    .prepare(`
      SELECT identity_key, question_id, is_correct, created_at
      FROM practice_attempts
      WHERE identity_key IN (${buildSqlPlaceholders(identityKeys.length)})
        AND question_id IN (${buildSqlPlaceholders(questionIds.length)})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...identityKeys, ...questionIds)) as any[];

  const statsByStudentId = new Map<number, { questionIds: Set<number>; attemptCount: number; correctCount: number; lastActivityAt: string | null }>();
  attemptRows.forEach((row: any) => {
    const studentId = identityKeyToStudentId.get(String(row.identity_key || '').trim());
    if (!studentId) return;
    const existing = statsByStudentId.get(studentId) || {
      questionIds: new Set<number>(),
      attemptCount: 0,
      correctCount: 0,
      lastActivityAt: null,
    };
    existing.questionIds.add(Number(row.question_id || 0));
    existing.attemptCount += 1;
    existing.correctCount += Number(row.is_correct) ? 1 : 0;
    if (!existing.lastActivityAt || new Date(String(row.created_at || 0)).getTime() > new Date(String(existing.lastActivityAt || 0)).getTime()) {
      existing.lastActivityAt = row.created_at || null;
    }
    statsByStudentId.set(studentId, existing);
  });

  const byStudentId = new Map<number, { attemptedQuestions: number; attemptCount: number; accuracyPct: number | null; lastActivityAt: string | null }>();
  statsByStudentId.forEach((value, studentId) => {
    byStudentId.set(studentId, {
      attemptedQuestions: value.questionIds.size,
      attemptCount: value.attemptCount,
      accuracyPct: value.attemptCount > 0 ? Math.round((value.correctCount / Math.max(1, value.attemptCount)) * 100) : null,
      lastActivityAt: value.lastActivityAt,
    });
  });

  return {
    totalQuestions: questionIds.length,
    byStudentId,
  };
}

async function buildTeacherAssignmentBoard(classBoard: any) {
  const classId = Number(classBoard?.id || 0);
  if (!classId) {
    return { active_assignment: null, assignments: [] };
  }

  const assignments = await listTeacherClassAssignments(classId);
  const hydratedAssignments = [];
  for (const assignment of assignments) {
    const progressMap = await buildAssignmentProgressMap(classBoard, Number(assignment.pack_id || 0));
    const questionGoal = sanitizeAssignmentQuestionGoal(
      assignment.question_goal,
      Math.max(1, Math.min(Number(progressMap.totalQuestions || assignment.pack_question_count || 0) || 1, 10)),
    );
    const roster = (Array.isArray(classBoard?.students) ? classBoard.students : []).map((student: any) => {
      const progress = progressMap.byStudentId.get(Number(student.id)) || {
        attemptedQuestions: 0,
        attemptCount: 0,
        accuracyPct: null,
        lastActivityAt: null,
      };
      const completionPct = Math.round((Math.min(progress.attemptedQuestions, questionGoal) / Math.max(1, questionGoal)) * 100);
      const overdue = assignment.due_at ? new Date(String(assignment.due_at)).getTime() < Date.now() && completionPct < 100 : false;
      const status =
        completionPct >= 100 ? 'completed' : overdue ? 'overdue' : progress.attemptedQuestions > 0 ? 'in_progress' : 'not_started';
      return {
        student_id: Number(student.id),
        name: String(student.name || 'Student'),
        email: String(student.email || ''),
        attempted_questions: progress.attemptedQuestions,
        attempt_count: progress.attemptCount,
        accuracy_pct: progress.accuracyPct,
        last_activity_at: progress.lastActivityAt,
        completion_pct: completionPct,
        question_goal: questionGoal,
        status,
      };
    });

    hydratedAssignments.push({
      id: Number(assignment.id || 0),
      class_id: classId,
      pack_id: Number(assignment.pack_id || 0),
      pack_title: String(assignment.pack_title || classBoard?.pack?.title || 'Pack'),
      title: String(assignment.title || 'Class assignment'),
      instructions: String(assignment.instructions || ''),
      due_at: assignment.due_at || null,
      question_goal: questionGoal,
      status: String(assignment.status || 'active'),
      created_at: assignment.created_at || null,
      summary: {
        assigned_count: roster.length,
        started_count: roster.filter((row) => row.status === 'in_progress' || row.status === 'completed').length,
        completed_count: roster.filter((row) => row.status === 'completed').length,
        overdue_count: roster.filter((row) => row.status === 'overdue').length,
      },
      roster_progress: roster,
    });
  }

  return {
    active_assignment: hydratedAssignments.find((row) => String(row.status || 'active').toLowerCase() === 'active') || hydratedAssignments[0] || null,
    assignments: hydratedAssignments,
  };
}

async function buildStudentAssignmentView({
  classRow,
  studentUserId,
}: {
  classRow: any;
  studentUserId: number;
}) {
  const classId = Number(classRow?.class_id || classRow?.id || 0);
  const packId = Number(classRow?.pack?.id || 0);
  if (!classId || !packId || !studentUserId) return null;

  const assignmentRows = await listTeacherClassAssignments(classId);
  const assignment = assignmentRows.find((row: any) => String(row.status || 'active').toLowerCase() === 'active') || assignmentRows[0] || null;
  if (!assignment?.id) return null;

  const identityKeys = await listResolvedIdentityKeys({ studentUserId });
  const safeIdentityKeys = uniqueStrings(identityKeys.map((key) => resolveStudentIdentityKey(key, '')));
  const questionRows = (await db.prepare(`SELECT id FROM questions WHERE quiz_pack_id = ?`).all(packId)) as any[];
  const questionIds = uniqueNumbers(questionRows.map((row: any) => row.id));
  const questionGoal = sanitizeAssignmentQuestionGoal(
    assignment.question_goal,
    Math.max(1, Math.min(Number(assignment.pack_question_count || questionIds.length || 0) || 1, 10)),
  );
  if (!safeIdentityKeys.length || !questionIds.length) {
    return {
      id: Number(assignment.id || 0),
      title: String(assignment.title || 'Class assignment'),
      instructions: String(assignment.instructions || ''),
      due_at: assignment.due_at || null,
      question_goal: questionGoal,
      progress: {
        attempted_questions: 0,
        attempt_count: 0,
        completion_pct: 0,
        accuracy_pct: null,
        last_activity_at: null,
        status: assignment.due_at ? (new Date(String(assignment.due_at)).getTime() < Date.now() ? 'overdue' : 'not_started') : 'not_started',
      },
    };
  }

  const attemptRows = (await db
    .prepare(`
      SELECT question_id, is_correct, created_at
      FROM practice_attempts
      WHERE identity_key IN (${buildSqlPlaceholders(safeIdentityKeys.length)})
        AND question_id IN (${buildSqlPlaceholders(questionIds.length)})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...safeIdentityKeys, ...questionIds)) as any[];

  const attemptedQuestionIds = new Set<number>();
  let correctCount = 0;
  let lastActivityAt: string | null = null;
  attemptRows.forEach((row: any) => {
    attemptedQuestionIds.add(Number(row.question_id || 0));
    correctCount += Number(row.is_correct) ? 1 : 0;
    if (!lastActivityAt || new Date(String(row.created_at || 0)).getTime() > new Date(String(lastActivityAt || 0)).getTime()) {
      lastActivityAt = row.created_at || null;
    }
  });
  const attemptedQuestions = attemptedQuestionIds.size;
  const completionPct = Math.round((Math.min(attemptedQuestions, questionGoal) / Math.max(1, questionGoal)) * 100);
  const overdue = assignment.due_at ? new Date(String(assignment.due_at)).getTime() < Date.now() && completionPct < 100 : false;

  return {
    id: Number(assignment.id || 0),
    title: String(assignment.title || 'Class assignment'),
    instructions: String(assignment.instructions || ''),
    due_at: assignment.due_at || null,
    question_goal: questionGoal,
    progress: {
      attempted_questions: attemptedQuestions,
      attempt_count: attemptRows.length,
      completion_pct: completionPct,
      accuracy_pct: attemptRows.length ? Math.round((correctCount / Math.max(1, attemptRows.length)) * 100) : null,
      last_activity_at: lastActivityAt,
      status: completionPct >= 100 ? 'completed' : overdue ? 'overdue' : attemptedQuestions > 0 ? 'in_progress' : 'not_started',
    },
  };
}

async function getTeacherProfileSummary(teacherUserId: number) {
  if (!teacherUserId) return null;
  const row = (await db
    .prepare(`
      SELECT id, email, first_name, last_name
      FROM users
      WHERE id = ?
      LIMIT 1
    `)
    .get(teacherUserId)) as any;
  if (!row?.id) return null;
  const displayName = [row.first_name, row.last_name].map((value: any) => String(value || '').trim()).filter(Boolean).join(' ').trim();
  return {
    id: Number(row.id || 0),
    email: String(row.email || '').trim(),
    display_name: displayName || String(row.email || '').trim() || 'Teacher',
  };
}

async function recordTeacherClassInviteDelivery({
  studentId,
  deliveryStatus,
  sentAt,
  error,
}: {
  studentId: number;
  deliveryStatus: string;
  sentAt: string | null;
  error: string | null;
}) {
  await db
    .prepare(`
      UPDATE teacher_class_students
      SET invite_sent_at = ?,
          invite_delivery_status = ?,
          invite_last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(sentAt, deliveryStatus, error || '', studentId);
}

async function sendClassInviteForRosterStudent({
  teacherUserId,
  classBoard,
  studentRow,
  baseUrl,
}: {
  teacherUserId: number;
  classBoard: any;
  studentRow: any;
  baseUrl?: string | null;
}) {
  const email = sanitizeStudentEmailInput(studentRow?.email);
  if (!email) return null;
  const teacherProfile = await getTeacherProfileSummary(teacherUserId);
  const delivery = await sendStudentClassInviteEmail({
    studentName: String(studentRow?.name || 'Student'),
    studentEmail: email,
    classId: Number(classBoard?.id || studentRow?.class_id || 0),
    className: String(classBoard?.name || studentRow?.class_name || 'Class'),
    classSubject: String(classBoard?.subject || studentRow?.class_subject || ''),
    classGrade: String(classBoard?.grade || studentRow?.class_grade || ''),
    teacherName: teacherProfile?.display_name || null,
    teacherEmail: teacherProfile?.email || null,
    alreadyClaimed: String(studentRow?.invite_status || '') === 'claimed',
    baseUrl,
  });

  await recordTeacherClassInviteDelivery({
    studentId: Number(studentRow?.id || 0),
    deliveryStatus: delivery.deliveryStatus,
    sentAt: delivery.sentAt,
    error: delivery.error,
  });

  return delivery;
}

async function sendClassInvitesForBoard({
  teacherUserId,
  classBoard,
  rosterStudentIds,
  baseUrl,
}: {
  teacherUserId: number;
  classBoard: any;
  rosterStudentIds?: number[] | null;
  baseUrl?: string | null;
}) {
  const targetIds = new Set(uniqueNumbers(rosterStudentIds || []));
  const candidates = Array.isArray(classBoard?.students)
    ? classBoard.students.filter((student: any) => {
        if (!sanitizeStudentEmailInput(student?.email)) return false;
        if (!targetIds.size) return true;
        return targetIds.has(Number(student?.id || 0));
      })
    : [];
  for (const studentRow of candidates) {
    await sendClassInviteForRosterStudent({
      teacherUserId,
      classBoard,
      studentRow,
      baseUrl,
    });
  }
}

async function buildStudentAnalyticsContext({
  studentUserId,
  identityKey,
  nickname,
  displayName,
}: {
  studentUserId?: number;
  identityKey?: string | null;
  nickname?: string | null;
  displayName?: string | null;
}) {
  const identityKeys = await listResolvedIdentityKeys({ studentUserId, identityKey });
  const participants = await getParticipantsForStudentScope({ studentUserId, identityKeys });
  const participantIds = uniqueNumbers(participants.map((row: any) => row.id));
  const sessionIds = uniqueNumbers(participants.map((row: any) => row.session_id));
  const sessions = await getSessionsForIds(sessionIds);
  const packs = await getPacksForIds(uniqueNumbers(sessions.map((row: any) => row.quiz_pack_id)));
  const questions = await getQuestionsForPackIds(uniqueNumbers(packs.map((row: any) => row.id)));
  const answers = await getAnswersForParticipantIds(participantIds);
  const practiceAttempts = await getPracticeAttemptsForIdentityKeys(identityKeys);
  const mastery = await getMasteryRowsForIdentityKeys(identityKeys);
  const behaviorLogs = await getLogsForParticipantIds(participantIds);
  const primaryIdentityKey =
    (studentUserId ? await getPrimaryIdentityKey(studentUserId) : '') ||
    identityKeys[0] ||
    resolveStudentIdentityKey(identityKey, nickname || displayName || '');
  const latestParticipant = participants[0] || null;
  const canonicalNickname =
    sanitizeStudentDisplayName(displayName) ||
    sanitizeStudentDisplayName(nickname) ||
    sanitizeStudentDisplayName(latestParticipant?.display_name_snapshot) ||
    sanitizeStudentDisplayName(latestParticipant?.nickname) ||
    'Student';

  return {
    student_user_id: Math.max(0, Math.floor(Number(studentUserId) || 0)) || null,
    primary_identity_key: primaryIdentityKey,
    identity_keys: identityKeys,
    canonical_nickname: canonicalNickname,
    latest_participant: latestParticipant,
    participants,
    participant_ids: participantIds,
    sessions,
    packs,
    questions,
    answers,
    practice_attempts: practiceAttempts,
    mastery,
    behavior_logs: behaviorLogs,
  };
}

async function getAuthorizedParticipantAccess(req: any) {
  const access = readParticipantAccessToken(req);
  if (!access) return null;

  const participant = (await db
      .prepare('SELECT * FROM participants WHERE id = ? AND session_id = ?')
      .get(access.participantId, access.sessionId)) as any;
  if (!participant) return null;

  const identityKey = getParticipantIdentityKey(participant);
  if (identityKey !== access.identityKey) return null;

  return {
    access,
    participant: {
      ...participant,
      identity_key: identityKey,
    },
  };
}

async function getAuthorizedParticipantForPin(req: any, pin: string, claimedParticipantId = 0) {
  const authorized = await getAuthorizedParticipantAccess(req);
  if (!authorized) return null;
  if (claimedParticipantId && Number(authorized.participant.id) !== Number(claimedParticipantId)) {
    return null;
  }

  const session = (await db
      .prepare(`
      SELECT s.*
      FROM sessions s
      JOIN participants p ON p.session_id = s.id
      WHERE s.pin = ? AND p.id = ?
    `)
      .get(pin, authorized.participant.id)) as any;
  if (!session) return null;

  return {
    ...authorized,
    session: hydrateSessionRow(session),
  };
}

async function createSessionPin() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pin = String(randomInt(100000, 1_000_000));
    const existing = (await db.prepare('SELECT 1 FROM sessions WHERE pin = ?').get(pin));
    if (!existing) {
      return pin;
    }
  }

  throw new Error('Failed to generate a unique session PIN. Try again.');
}

function runInFlightQuestionGeneration<T>(key: string, task: () => Promise<T>) {
  const existing = inFlightQuestionGenerations.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = aiGenerationGate
    .run(key, task)
    .finally(() => {
      inFlightQuestionGenerations.delete(key);
    });

  inFlightQuestionGenerations.set(key, promise);
  return promise;
}

function readQuestionGenerationRequestBody(body: any) {
  return {
    sourceText: sanitizeMultiline(body?.source_text, 120000),
    count: Math.min(20, Math.max(3, parsePositiveInt(body?.count, 5))),
    difficulty: sanitizeLine(body?.difficulty || 'Medium', 24),
    language: sanitizeLine(body?.language || 'English', 24),
    questionFormat: sanitizeLine(body?.question_format || 'Multiple Choice', 32),
    cognitiveLevel: sanitizeLine(body?.cognitive_level || 'Mixed', 32),
    explanationDetail: sanitizeLine(body?.explanation_detail || 'Concise', 32),
    contentFocus: sanitizeLine(body?.content_focus || 'Balanced', 40),
    distractorStyle: sanitizeLine(body?.distractor_style || 'Standard', 32),
    gradeLevel: sanitizeLine(body?.grade_level || 'Auto', 40),
    providerId: sanitizeLine(body?.provider_id || body?.providerId, 24) || null,
    modelId: sanitizeLine(body?.model_id || body?.modelId, 80) || null,
    existingQuestions: Array.isArray(body?.existing_questions) ? body.existing_questions : [],
  };
}

async function getTeacherUserIdFromRequest(req: any) {
  const session = req?.teacherSession || readTeacherSession(req);
  if (!session) return 0;
  return Number((await getTeacherUserByEmail(session.email))?.id || 0);
}

async function getTeacherPackBoard(teacherUserId: number) {
  const rawPacks = (await db
      .prepare('SELECT * FROM quiz_packs WHERE teacher_id = ? ORDER BY created_at DESC, id DESC')
      .all(teacherUserId));

  const hydratedPacks = await Promise.all(rawPacks.map((pack: any) => hydratePack(pack)));
  const packIds = uniqueNumbers(hydratedPacks.map((pack: any) => pack.id));
  const sessions = packIds.length
    ? (await db
              .prepare(`SELECT * FROM sessions WHERE quiz_pack_id IN (${packIds.map(() => '?').join(', ')})`)
              .all(...packIds))
    : [];
  const sessionIds = uniqueNumbers(sessions.map((session: any) => session.id));
  const participantCounts = new Map<number, number>();
  const versionCounts = new Map<number, number>();

  if (sessionIds.length) {
    const rows = (await db
          .prepare(
            `SELECT session_id, COUNT(*) as count
         FROM participants
         WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})
         GROUP BY session_id`,
          )
          .all(...sessionIds));
    rows.forEach((row: any) => {
      participantCounts.set(Number(row.session_id), Number(row.count || 0));
    });
  }

  if (packIds.length) {
    (await db
            .prepare(
              `SELECT pack_id, COUNT(*) as count
         FROM quiz_pack_versions
         WHERE pack_id IN (${packIds.map(() => '?').join(', ')})
         GROUP BY pack_id`,
            )
            .all(...packIds))
      .forEach((row: any) => {
        versionCounts.set(Number(row.pack_id), Number(row.count || 0));
      });
  }

  const sessionsByPack = new Map<number, any[]>();
  sessions.forEach((session: any) => {
    const packId = Number(session.quiz_pack_id || 0);
    if (!sessionsByPack.has(packId)) sessionsByPack.set(packId, []);
    sessionsByPack.get(packId)?.push(session);
  });

  return hydratedPacks.map((pack: any) => {
    const packSessions = sessionsByPack.get(Number(pack.id)) || [];
    const latestSession =
      [...packSessions].sort((left: any, right: any) => {
        const leftTime = new Date(left.ended_at || left.started_at || 0).getTime();
        const rightTime = new Date(right.ended_at || right.started_at || 0).getTime();
        return rightTime - leftTime || Number(right.id) - Number(left.id);
      })[0] || null;
    const latestCompletedSession =
      packSessions
        .filter((session: any) => String(session.status || '').toUpperCase() === 'ENDED')
        .sort((left: any, right: any) => {
          const leftTime = new Date(left.ended_at || left.started_at || 0).getTime();
          const rightTime = new Date(right.ended_at || right.started_at || 0).getTime();
          return rightTime - leftTime || Number(right.id) - Number(left.id);
        })[0] || null;
    const activeSessions = packSessions.filter((session: any) => String(session.status || '').toUpperCase() !== 'ENDED');
    const latestActiveSession =
      [...activeSessions].sort((left: any, right: any) => {
        const leftTime = new Date(left.ended_at || left.started_at || 0).getTime();
        const rightTime = new Date(right.ended_at || right.started_at || 0).getTime();
        return rightTime - leftTime || Number(right.id) - Number(left.id);
      })[0] || null;

    return {
      ...pack,
      session_count: packSessions.length,
      active_session_count: activeSessions.length,
      can_delete: activeSessions.length === 0,
      last_session_id: latestSession ? Number(latestSession.id) : null,
      last_session_pin: latestSession?.pin || null,
      last_session_status: latestSession?.status || null,
      last_session_at: latestSession?.ended_at || latestSession?.started_at || null,
      last_session_players: latestSession ? Number(participantCounts.get(Number(latestSession.id)) || 0) : 0,
      last_completed_session_id: latestCompletedSession ? Number(latestCompletedSession.id) : null,
      last_completed_session_pin: latestCompletedSession?.pin || null,
      last_completed_session_status: latestCompletedSession?.status || null,
      last_completed_session_at: latestCompletedSession?.ended_at || latestCompletedSession?.started_at || null,
      last_completed_session_players: latestCompletedSession
        ? Number(participantCounts.get(Number(latestCompletedSession.id)) || 0)
        : 0,
      latest_active_session_id: latestActiveSession ? Number(latestActiveSession.id) : null,
      latest_active_session_pin: latestActiveSession?.pin || null,
      latest_active_session_status: latestActiveSession?.status || null,
      latest_active_session_at: latestActiveSession?.ended_at || latestActiveSession?.started_at || null,
      latest_active_session_players: latestActiveSession
        ? Number(participantCounts.get(Number(latestActiveSession.id)) || 0)
        : 0,
      version_count: Number(versionCounts.get(Number(pack.id)) || 0),
    };
  });
}

async function buildPackCopyTitle(teacherUserId: number, originalTitle: string) {
  const baseTitle = `${String(originalTitle || 'Untitled pack').trim()} (Copy)`;
  const existingTitles = new Set(
    (await db
            .prepare('SELECT title FROM quiz_packs WHERE teacher_id = ?')
            .all(teacherUserId))
      .map((row: any) => String(row.title || '').trim().toLowerCase()),
  );

  if (!existingTitles.has(baseTitle.toLowerCase())) {
    return baseTitle;
  }

  let counter = 2;
  while (existingTitles.has(`${baseTitle} ${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${baseTitle} ${counter}`;
}

async function buildPackRevisionTitle(teacherUserId: number, originalTitle: string) {
  const baseTitle = `${String(originalTitle || 'Untitled pack').trim()} (Edited)`;
  const existingTitles = new Set(
    (await db
            .prepare('SELECT title FROM quiz_packs WHERE teacher_id = ?')
            .all(teacherUserId))
      .map((row: any) => String(row.title || '').trim().toLowerCase()),
  );

  if (!existingTitles.has(baseTitle.toLowerCase())) {
    return baseTitle;
  }

  let counter = 2;
  while (existingTitles.has(`${baseTitle} ${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${baseTitle} ${counter}`;
}

async function preparePackWritePayload(body: any) {
  const title = sanitizeLine(body?.title, 120);
  const sourceText = sanitizeMultiline(body?.source_text, 120000);
  const incomingQuestions = Array.isArray(body?.questions) ? body.questions : [];
  const academicMeta = sanitizeAcademicMeta(body?.academic_meta || body);
  const isPublic = sanitizeBooleanFlag(body?.is_public, false);
  const generationMeta = sanitizeGenerationMeta(body?.generation_meta);
  const materialProfile = (await getOrCreateMaterialProfile(sourceText || ''));
  const sourceLanguage = sanitizeLine(body?.language || materialProfile.source_language || 'English', 24);
  const normalizedQuestions = normalizeGeneratedQuestions(
    incomingQuestions,
    materialProfile.topic_fingerprint || [],
  ).map((question: any, index: number) => sanitizeQuestionDraft(question, index, materialProfile.topic_fingerprint || []));

  return {
    title,
    sourceText,
    sourceLanguage,
    academicMeta,
    isPublic,
    generationMeta,
    materialProfile,
    normalizedQuestions,
  };
}

function insertQuestionsForPack(packId: number, questions: any[]) {
  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      quiz_pack_id,
      prompt,
      image_url,
      answers_json,
      correct_index,
      explanation,
      tags_json,
      time_limit_seconds,
      question_order,
      learning_objective,
      bloom_level
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const question of questions) {
    insertQuestion.run(
      packId,
      question.prompt,
      question.image_url || '',
      JSON.stringify(question.answers),
      question.correct_index,
      question.explanation,
      JSON.stringify(question.tags),
      question.time_limit_seconds || 20,
      question.question_order || 0,
      question.learning_objective || '',
      question.bloom_level || '',
    );
  }
}

async function createTeacherPackFromPreparedPayload(
  teacherUserId: number,
  payload: Awaited<ReturnType<typeof preparePackWritePayload>>,
  {
    sourceLabel = 'create',
    versionLabel = 'Initial version',
    titleOverride = '',
  }: {
    sourceLabel?: string;
    versionLabel?: string;
    titleOverride?: string;
  } = {},
) {
  const resolvedTitle = sanitizeLine(titleOverride || payload.title, 120);
  const info = db.prepare(`
    INSERT INTO quiz_packs (
      teacher_id,
      title,
      source_text,
      course_code,
      course_name,
      section_name,
      academic_term,
      week_label,
      learning_objectives_json,
      bloom_levels_json,
      pack_notes,
      generation_contract,
      generation_provider,
      generation_model,
      is_public,
      source_hash,
      source_excerpt,
      source_language,
      source_word_count,
      material_profile_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        teacherUserId,
        resolvedTitle,
        payload.sourceText,
        payload.academicMeta.course_code,
        payload.academicMeta.course_name,
        payload.academicMeta.section_name,
        payload.academicMeta.academic_term,
        payload.academicMeta.week_label,
        JSON.stringify(payload.academicMeta.learning_objectives),
        JSON.stringify(payload.academicMeta.bloom_levels),
        payload.academicMeta.pack_notes,
        payload.generationMeta.contract_version,
        payload.generationMeta.provider,
        payload.generationMeta.model,
        payload.isPublic ? 1 : 0,
        payload.materialProfile.source_hash,
        payload.materialProfile.source_excerpt,
        payload.sourceLanguage || payload.materialProfile.source_language,
        payload.materialProfile.word_count,
        payload.materialProfile.id,
      );

  const packId = Number(info.lastInsertRowid);
  insertQuestionsForPack(packId, payload.normalizedQuestions);
  (await syncPackDerivedData(packId, payload.sourceText || '', payload.normalizedQuestions, payload.sourceLanguage));
  (await createPackVersionSnapshot(packId, teacherUserId, versionLabel, sourceLabel));

  return {
    packId,
    title: resolvedTitle,
    questionCount: payload.normalizedQuestions.length,
    isPublic: payload.isPublic,
  };
}

async function packHasHistoricalUsage(packId: number) {
  const sessionCount = Number((await db.prepare('SELECT COUNT(*) as count FROM sessions WHERE quiz_pack_id = ?').get(packId))?.count || 0);
  if (sessionCount > 0) {
    return true;
  }

  const questionIds = uniqueNumbers(
    (await db.prepare('SELECT id FROM questions WHERE quiz_pack_id = ?').all(packId)).map((row: any) => row.id),
  );
  if (questionIds.length === 0) {
    return false;
  }

  const placeholders = questionIds.map(() => '?').join(', ');
  const answerCount = Number(
    (await db.prepare(`SELECT COUNT(*) as count FROM answers WHERE question_id IN (${placeholders})`).get(...questionIds))?.count || 0,
  );
  if (answerCount > 0) {
    return true;
  }

  const practiceCount = Number(
    (await db.prepare(`SELECT COUNT(*) as count FROM practice_attempts WHERE question_id IN (${placeholders})`).get(...questionIds))?.count || 0,
  );
  return practiceCount > 0;
}

async function getPackVersions(packId: number) {
  return (await db
      .prepare(`
      SELECT id, pack_id, teacher_id, version_number, version_label, source_label, created_at
      FROM quiz_pack_versions
      WHERE pack_id = ?
      ORDER BY version_number DESC, id DESC
    `)
      .all(packId))
    .map((row: any) => ({
      ...row,
      id: Number(row.id),
      pack_id: Number(row.pack_id),
      teacher_id: Number(row.teacher_id),
      version_number: Number(row.version_number || 0),
    }));
}

async function buildPackSnapshot(packId: number) {
  const pack = (await getHydratedPackWithQuestions(packId));
  if (!pack) return null;
  return {
    pack: {
      title: pack.title,
      source_text: pack.source_text || '',
      course_code: pack.course_code || '',
      course_name: pack.course_name || '',
      section_name: pack.section_name || '',
      academic_term: pack.academic_term || '',
      week_label: pack.week_label || '',
      learning_objectives: Array.isArray(pack.learning_objectives) ? pack.learning_objectives : [],
      bloom_levels: Array.isArray(pack.bloom_levels) ? pack.bloom_levels : [],
      pack_notes: pack.pack_notes || '',
    },
    questions: (pack.questions || []).map((question: any, index: number) => ({
      prompt: question.prompt,
      image_url: question.image_url || '',
      answers: Array.isArray(question.answers) ? question.answers : parseJsonArray(question.answers_json),
      correct_index: Number(question.correct_index || 0),
      explanation: question.explanation || '',
      tags: Array.isArray(question.tags) ? question.tags : parseJsonArray(question.tags_json),
      time_limit_seconds: Number(question.time_limit_seconds || 20),
      question_order: Number(question.question_order || index + 1),
      learning_objective: question.learning_objective || '',
      bloom_level: question.bloom_level || '',
    })),
  };
}

async function createPackVersionSnapshot(packId: number, teacherUserId: number, versionLabel = '', sourceLabel = 'manual') {
  const snapshot = (await buildPackSnapshot(packId));
  if (!snapshot) {
    throw new Error('Pack not found');
  }

  const nextVersionNumber = Number(
    (await db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM quiz_pack_versions WHERE pack_id = ?').get(packId))?.next_version || 1,
  );
  const label = sanitizeLine(versionLabel || `Version ${nextVersionNumber}`, 80);

  const info = (await db.prepare(`
    INSERT INTO quiz_pack_versions (pack_id, teacher_id, version_number, version_label, source_label, snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
      packId,
      teacherUserId,
      nextVersionNumber,
      label,
      sanitizeLine(sourceLabel, 40),
      JSON.stringify(snapshot),
    ));

  return {
    id: Number(info.lastInsertRowid),
    pack_id: packId,
    teacher_id: teacherUserId,
    version_number: nextVersionNumber,
    version_label: label,
    source_label: sanitizeLine(sourceLabel, 40),
    created_at: new Date().toISOString(),
  };
}

async function createPackFromSnapshot(
  snapshot: any,
  teacherUserId: number,
  titleOverride?: string,
  sourceLabel = 'restore',
) {
  const packMeta = sanitizeAcademicMeta(snapshot?.pack || {});
  const title = sanitizeLine(titleOverride || snapshot?.pack?.title || 'Untitled pack', 120);
  const sourceText = sanitizeMultiline(snapshot?.pack?.source_text || '', 120000);
  const fallbackTags = Array.isArray(snapshot?.pack?.learning_objectives) ? snapshot.pack.learning_objectives : [];
  const questionRows = Array.isArray(snapshot?.questions)
    ? snapshot.questions.map((question: any, index: number) => sanitizeQuestionDraft(question, index, fallbackTags))
    : [];

  if (!title || questionRows.length === 0) {
    throw new Error('Snapshot is incomplete');
  }

  const materialProfile = (await getOrCreateMaterialProfile(sourceText || ''));
  const packInfo = (await db.prepare(`
    INSERT INTO quiz_packs (
      teacher_id,
      title,
      source_text,
      course_code,
      course_name,
      section_name,
      academic_term,
      week_label,
      learning_objectives_json,
      bloom_levels_json,
      pack_notes,
      source_hash,
      source_excerpt,
      source_language,
      source_word_count,
      material_profile_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
      teacherUserId,
      title,
      sourceText,
      packMeta.course_code,
      packMeta.course_name,
      packMeta.section_name,
      packMeta.academic_term,
      packMeta.week_label,
      JSON.stringify(packMeta.learning_objectives),
      JSON.stringify(packMeta.bloom_levels),
      packMeta.pack_notes,
      materialProfile.source_hash,
      materialProfile.source_excerpt,
      materialProfile.source_language,
      materialProfile.word_count,
      materialProfile.id,
    ));

  const newPackId = Number(packInfo.lastInsertRowid);
  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      quiz_pack_id,
      prompt,
      image_url,
      answers_json,
      correct_index,
      explanation,
      tags_json,
      time_limit_seconds,
      question_order,
      learning_objective,
      bloom_level
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  questionRows.forEach((question) => {
    insertQuestion.run(
      newPackId,
      question.prompt,
      question.image_url || '',
      JSON.stringify(question.answers),
      question.correct_index,
      question.explanation,
      JSON.stringify(question.tags),
      question.time_limit_seconds,
      question.question_order,
      question.learning_objective,
      question.bloom_level,
    );
  });

  (await syncPackDerivedData(newPackId, sourceText || '', questionRows));
  (await createPackVersionSnapshot(newPackId, teacherUserId, 'Initial version', sourceLabel));

  return newPackId;
}

async function buildCrossSectionComparison(sessionId: number, teacherUserId: number) {
  const currentSession = (await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)) as any;
  if (!currentSession) return null;
  const currentPack = (await getTeacherOwnedPack(Number(currentSession.quiz_pack_id || 0), teacherUserId));
  if (!currentPack) return null;

  const courseCode = sanitizeLine(currentPack.course_code, 32);
  const relatedPackIds = uniqueNumbers(
    (
      courseCode
        ? (await db.prepare('SELECT id FROM quiz_packs WHERE teacher_id = ? AND course_code = ?').all(teacherUserId, courseCode))
        : (await db.prepare('SELECT id FROM quiz_packs WHERE id = ? AND teacher_id = ?').all(currentPack.id, teacherUserId))
    ).map((row: any) => row.id),
  );

  if (relatedPackIds.length === 0) return null;

  const rows = (await db
      .prepare(`
      SELECT
        s.id,
        s.quiz_pack_id,
        s.started_at,
        s.ended_at,
        qp.title AS pack_title,
        qp.course_code,
        qp.course_name,
        qp.section_name,
        qp.academic_term,
        qp.week_label,
        (
          SELECT COUNT(*)
          FROM participants p
          WHERE p.session_id = s.id
        ) AS participant_count,
        (
          SELECT AVG(CASE WHEN a.is_correct = 1 THEN 100.0 ELSE 0 END)
          FROM answers a
          WHERE a.session_id = s.id
        ) AS accuracy,
        (
          SELECT AVG(a.response_ms)
          FROM answers a
          WHERE a.session_id = s.id
        ) AS avg_response_ms,
        (
          SELECT SUM(a.score_awarded)
          FROM answers a
          WHERE a.session_id = s.id
        ) AS total_score
      FROM sessions s
      JOIN quiz_packs qp ON qp.id = s.quiz_pack_id
      WHERE qp.teacher_id = ?
        AND s.id IN (
          SELECT id
          FROM sessions
          WHERE quiz_pack_id IN (${relatedPackIds.map(() => '?').join(', ')})
        )
      ORDER BY COALESCE(s.ended_at, s.started_at) DESC, s.id DESC
      LIMIT 12
    `)
      .all(teacherUserId, ...relatedPackIds))
    .map((row: any) => ({
      session_id: Number(row.id),
      quiz_pack_id: Number(row.quiz_pack_id),
      pack_title: row.pack_title,
      course_code: row.course_code || '',
      course_name: row.course_name || '',
      section_name: row.section_name || 'Main',
      academic_term: row.academic_term || '',
      week_label: row.week_label || '',
      started_at: row.started_at || null,
      ended_at: row.ended_at || null,
      participant_count: Number(row.participant_count || 0),
      accuracy: Number(row.accuracy || 0),
      avg_response_ms: Number(row.avg_response_ms || 0),
      total_score: Number(row.total_score || 0),
      is_current: Number(row.id) === sessionId,
    }));

  const currentRow = rows.find((row: any) => row.is_current) || null;
  const peerRows = rows.filter((row: any) => !row.is_current);
  const averageAccuracy = peerRows.length
    ? peerRows.reduce((sum: number, row: any) => sum + Number(row.accuracy || 0), 0) / peerRows.length
    : 0;
  const averageParticipation = peerRows.length
    ? peerRows.reduce((sum: number, row: any) => sum + Number(row.participant_count || 0), 0) / peerRows.length
    : 0;

  return {
    basis: courseCode ? 'course_code' : 'pack',
    course_code: courseCode,
    course_name: currentPack.course_name || '',
    section_name: currentPack.section_name || '',
    academic_term: currentPack.academic_term || '',
    current: currentRow,
    benchmark: {
      compared_sessions: peerRows.length,
      average_accuracy: Number(averageAccuracy.toFixed(1)),
      average_participant_count: Number(averageParticipation.toFixed(1)),
      delta_accuracy: currentRow ? Number((Number(currentRow.accuracy || 0) - averageAccuracy).toFixed(1)) : 0,
      delta_participant_count: currentRow ? Number((Number(currentRow.participant_count || 0) - averageParticipation).toFixed(1)) : 0,
    },
    sessions: rows,
  };
}

async function getLogsForParticipantIds(participantIds: number[]) {
  if (participantIds.length === 0) return [];
  const placeholders = participantIds.map(() => '?').join(', ');
  return (await db
      .prepare(`SELECT * FROM student_behavior_logs WHERE participant_id IN (${placeholders})`)
      .all(...participantIds));
}

async function getSessionsForIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM sessions WHERE id IN (${placeholders})`).all(...sessionIds));
}

async function getPacksForIds(packIds: number[]) {
  if (packIds.length === 0) return [];
  const placeholders = packIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM quiz_packs WHERE id IN (${placeholders})`).all(...packIds));
}

async function getQuestionsForPackIds(packIds: number[]) {
  if (packIds.length === 0) return [];
  const placeholders = packIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM questions WHERE quiz_pack_id IN (${placeholders})`).all(...packIds));
}

async function getParticipantsForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM participants WHERE session_id IN (${placeholders})`).all(...sessionIds));
}

async function getAnswersForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM answers WHERE session_id IN (${placeholders})`).all(...sessionIds));
}

async function getBehaviorLogsForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return (await db.prepare(`SELECT * FROM student_behavior_logs WHERE session_id IN (${placeholders})`).all(...sessionIds));
}

function averageNumbers(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatTeacherOverviewDate(session: any) {
  const rawTimestamp = session?.ended_at || session?.started_at;
  const timestamp = new Date(String(rawTimestamp || '')).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function computeFallbackStressIndex(logs: any[]) {
  if (!logs.length) return 0;
  const stressValues = logs.map((log) =>
    Math.min(
      100,
      (Number(log.focus_loss_count || 0) * 14)
        + (Number(log.total_swaps || 0) * 8)
        + (Number(log.panic_swaps || 0) * 16)
        + (Number(log.same_answer_reclicks || 0) * 6)
        + (Number(log.idle_time_ms || 0) / 320)
        + (Number(log.blur_time_ms || 0) / 360)
        + (Number(log.longest_idle_streak_ms || 0) / 450),
    ),
  );
  return Number(averageNumbers(stressValues).toFixed(1));
}

type TeacherOverviewResponse = {
  summary: {
    total_players: number;
    avg_accuracy: number;
    quizzes_hosted: number;
    avg_stress: number;
  };
  recent_sessions: Array<{
    session_id: number;
    quiz_pack_id: number;
    quiz_name: string;
    date: string;
    players: number;
    avg_score: number;
    avg_accuracy: number;
    stress_index: number;
    status: string;
    pin: string | null;
    headline: string;
  }>;
  insights: Array<{ title: string; body: string }>;
};

function buildTeacherOverviewFallback(payload: {
  packs: any[];
  sessions: any[];
  participants: any[];
  answers: any[];
  questions: any[];
  behavior_logs: any[];
}): TeacherOverviewResponse {
  const packById = new Map<number, any>(
    payload.packs.map((pack: any) => [Number(pack.id || 0), pack]),
  );
  const participantsBySession = new Map<number, any[]>();
  const answersBySession = new Map<number, any[]>();
  const logsBySession = new Map<number, any[]>();

  payload.participants.forEach((participant: any) => {
    const sessionId = Number(participant.session_id || 0);
    if (!sessionId) return;
    const current = participantsBySession.get(sessionId) || [];
    current.push(participant);
    participantsBySession.set(sessionId, current);
  });

  payload.answers.forEach((answer: any) => {
    const sessionId = Number(answer.session_id || 0);
    if (!sessionId) return;
    const current = answersBySession.get(sessionId) || [];
    current.push(answer);
    answersBySession.set(sessionId, current);
  });

  payload.behavior_logs.forEach((log: any) => {
    const sessionId = Number(log.session_id || 0);
    if (!sessionId) return;
    const current = logsBySession.get(sessionId) || [];
    current.push(log);
    logsBySession.set(sessionId, current);
  });

  const recentSessions = payload.sessions
    .map((session: any) => {
      const sessionId = Number(session.id || 0);
      const quizPackId = Number(session.quiz_pack_id || 0);
      const participants = participantsBySession.get(sessionId) || [];
      const answers = answersBySession.get(sessionId) || [];
      const logs = logsBySession.get(sessionId) || [];
      const avgAccuracy = answers.length
        ? Number(
            averageNumbers(
              answers.map((answer: any) => (Number(answer.is_correct) === 1 || answer.is_correct === true ? 100 : 0)),
            ).toFixed(1),
          )
        : 0;
      const stressIndex = computeFallbackStressIndex(logs);
      const players = uniqueNumbers(participants.map((participant: any) => participant.id)).length;
      let headline = 'Open this report to inspect the response patterns in detail.';
      if (players === 0 && answers.length === 0) {
        headline = 'The room opened, but no student answers were captured yet.';
      } else if (avgAccuracy >= 80 && stressIndex < 35) {
        headline = 'Students moved through this session with strong accuracy and low pressure.';
      } else if (avgAccuracy >= 60) {
        headline = 'Most students stayed on track, with a few hesitation signals worth reviewing.';
      } else {
        headline = 'This session needs a guided recap before the next checkpoint.';
      }

      return {
        session_id: sessionId,
        quiz_pack_id: quizPackId,
        quiz_name: String(packById.get(quizPackId)?.title || `Pack ${quizPackId}`),
        date: formatTeacherOverviewDate(session),
        players,
        avg_score: answers.length
          ? Number(averageNumbers(answers.map((answer: any) => Number(answer.score_awarded || 0))).toFixed(1))
          : 0,
        avg_accuracy: avgAccuracy,
        stress_index: stressIndex,
        status: String(session.status || 'LOBBY'),
        pin: session.pin || null,
        headline,
      };
    })
    .filter((session) => session.players > 0 || session.avg_accuracy > 0 || String(session.status).toUpperCase() !== 'LOBBY')
    .sort((left, right) => {
      const leftTimestamp = new Date(String(left.date || '')).getTime() || 0;
      const rightTimestamp = new Date(String(right.date || '')).getTime() || 0;
      return rightTimestamp - leftTimestamp || Number(right.session_id) - Number(left.session_id);
    });

  const totalPlayers = recentSessions.reduce((sum, session) => sum + Number(session.players || 0), 0);
  const avgAccuracy = Number(averageNumbers(recentSessions.map((session) => Number(session.avg_accuracy || 0))).toFixed(1));
  const avgStress = Number(averageNumbers(recentSessions.map((session) => Number(session.stress_index || 0))).toFixed(1));
  const quizzesHosted = recentSessions.filter(
    (session) => Number(session.players || 0) > 0 || String(session.status || '').toUpperCase() !== 'LOBBY',
  ).length;

  const hardestSession = [...recentSessions].sort((left, right) => Number(left.avg_accuracy || 0) - Number(right.avg_accuracy || 0))[0];
  const highestStressSession = [...recentSessions].sort((left, right) => Number(right.stress_index || 0) - Number(left.stress_index || 0))[0];
  const insights: Array<{ title: string; body: string }> = [];

  if (hardestSession) {
    insights.push({
      title: 'Most challenging session',
      body: `${hardestSession.quiz_name} settled at ${Number(hardestSession.avg_accuracy || 0).toFixed(1)}% accuracy. That session is the best candidate for a guided rematch.`,
    });
  }

  if (highestStressSession && Number(highestStressSession.stress_index || 0) >= 45) {
    insights.push({
      title: 'Highest pressure session',
      body: `${highestStressSession.quiz_name} showed the strongest pressure signals (${Number(highestStressSession.stress_index || 0).toFixed(0)}%). Review pacing, distractors, and timer pressure there first.`,
    });
  }

  if (!insights.length) {
    insights.push({
      title: 'No major risk detected',
      body: 'Recent sessions look stable. Keep the same pacing and follow up with a short practice task between live games.',
    });
  }

  return {
    summary: {
      total_players: totalPlayers,
      avg_accuracy: avgAccuracy,
      quizzes_hosted: quizzesHosted,
      avg_stress: avgStress,
    },
    recent_sessions: recentSessions.slice(0, 10),
    insights,
  };
}

function isTeacherOverviewPayload(value: any): value is TeacherOverviewResponse {
  return Boolean(
    value
      && typeof value === 'object'
      && value.summary
      && typeof value.summary === 'object'
      && Array.isArray(value.recent_sessions)
      && Array.isArray(value.insights),
  );
}

function buildAnalyticsComparison(sessionAnalytics: any, overallAnalytics: any) {
  const sessionSignals = Array.isArray(sessionAnalytics?.behaviorSignals) ? sessionAnalytics.behaviorSignals : [];
  const overallSignals = new Map<string, any>(
    (Array.isArray(overallAnalytics?.behaviorSignals) ? overallAnalytics.behaviorSignals : []).map((signal: any) => [
      signal.id,
      signal,
    ]),
  );

  return {
    accuracy_delta: Number(sessionAnalytics?.stats?.accuracy || 0) - Number(overallAnalytics?.stats?.accuracy || 0),
    stress_delta:
      Number(sessionAnalytics?.risk?.stress_index || 0) - Number(overallAnalytics?.risk?.stress_index || 0),
    confidence_delta:
      Number(sessionAnalytics?.profile?.confidence_score || 0) -
      Number(overallAnalytics?.profile?.confidence_score || 0),
    focus_delta:
      Number(sessionAnalytics?.profile?.focus_score || 0) - Number(overallAnalytics?.profile?.focus_score || 0),
    behavior_signals: sessionSignals.map((signal: any) => {
      const baseline = overallSignals.get(signal.id);
      return {
        ...signal,
        overall_score: baseline?.score ?? null,
        delta: baseline ? Number(signal.score || 0) - Number(baseline.score || 0) : null,
      };
    }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueStrings(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function parseTimestampMs(value: unknown) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toUtcDayKey(timestampMs: number) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function maxIsoTimestamp(values: Array<unknown>) {
  const timestamps = values
    .map((value) => parseTimestampMs(value))
    .filter((value): value is number => value !== null);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function buildConsecutiveDayStreak(dayKeys: string[]) {
  if (!dayKeys.length) return 0;
  const sortedKeys = [...dayKeys].sort().reverse();
  let streak = 1;
  let previousDayMs = Date.parse(`${sortedKeys[0]}T00:00:00.000Z`);

  for (let index = 1; index < sortedKeys.length; index += 1) {
    const currentDayMs = Date.parse(`${sortedKeys[index]}T00:00:00.000Z`);
    if (previousDayMs - currentDayMs !== DAY_MS) {
      break;
    }
    streak += 1;
    previousDayMs = currentDayMs;
  }

  return streak;
}

function summarizeFocusTags(tags: string[]) {
  if (!tags.length) return 'your weakest concept mix';
  if (tags.length === 1) return tags[0];
  if (tags.length === 2) return `${tags[0]} and ${tags[1]}`;
  return `${tags[0]}, ${tags[1]}, and ${tags[2]}`;
}

function formatAnswerChoiceLabel(index: number) {
  return String.fromCharCode(65 + (Math.max(0, index) % 26));
}

function roundPct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function parseAnswerPathEntries(value: unknown, maxTimestampMs: number) {
  return parseJsonArray(typeof value === 'string' ? value : '')
    .map((entry) => {
      const raw = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      if (!raw) return null;
      const index = Number(raw.index);
      if (!Number.isFinite(index) || index < 0) return null;
      return {
        index: Math.floor(index),
        timestamp_ms: clampNumber(raw.timestamp_ms ?? raw.timestamp, 0, maxTimestampMs, 0),
      };
    })
    .filter((entry): entry is { index: number; timestamp_ms: number } => Boolean(entry))
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms);
}

function describeReplayBucket(bucketIndex: number, bucketCount: number, timeLimitMs: number) {
  const bucketStartMs = Math.floor((bucketIndex * timeLimitMs) / bucketCount);
  const bucketEndMs = Math.min(timeLimitMs, Math.floor(((bucketIndex + 1) * timeLimitMs) / bucketCount));
  const startSeconds = Math.floor(bucketStartMs / 1000);
  const endSeconds = Math.max(startSeconds + 1, Math.ceil(bucketEndMs / 1000));
  return `${startSeconds}-${endSeconds}s`;
}

function resolveChoiceAtBucketEnd({
  pathEntries,
  responseMs,
  bucketEndMs,
  fallbackChoiceIndex,
}: {
  pathEntries: Array<{ index: number; timestamp_ms: number }>;
  responseMs: number;
  bucketEndMs: number;
  fallbackChoiceIndex: number | null;
}) {
  const cutoffMs = Math.min(bucketEndMs, responseMs);
  let latestChoice: number | null = null;

  for (const entry of pathEntries) {
    if (entry.timestamp_ms > cutoffMs) break;
    latestChoice = entry.index;
  }

  if (latestChoice === null && fallbackChoiceIndex !== null && responseMs <= bucketEndMs) {
    return fallbackChoiceIndex;
  }

  return latestChoice;
}

function dedupeQuestionsById(questions: any[]) {
  const seen = new Set<number>();
  return questions.filter((question) => {
    const questionId = Number(question?.id || 0);
    if (!questionId || seen.has(questionId)) return false;
    seen.add(questionId);
    return true;
  });
}

function ensurePriorityQuestions({
  selectedQuestions,
  sourceQuestions,
  priorityQuestionIds,
  desiredCount,
}: {
  selectedQuestions: any[];
  sourceQuestions: any[];
  priorityQuestionIds: number[];
  desiredCount: number;
}) {
  const priorityIdSet = new Set(priorityQuestionIds.map((value) => Number(value)).filter((value) => value > 0));
  const priorityQuestions = sourceQuestions.filter((question) => priorityIdSet.has(Number(question?.id || 0)));
  return dedupeQuestionsById([...priorityQuestions, ...selectedQuestions]).slice(0, desiredCount);
}

function buildQuestionReplaySummary({
  session,
  question,
  participants,
  answers,
  behaviorLogs,
}: {
  session: any;
  question: any;
  participants: any[];
  answers: any[];
  behaviorLogs: any[];
}) {
  const participantTotal = Array.isArray(participants) ? participants.length : 0;
  const answerChoices = Array.isArray(question?.answers)
    ? question.answers
    : parseJsonArray(question?.answers_json);
  const choiceCount = Math.max(
    Array.isArray(answerChoices) ? answerChoices.length : 0,
    Number(question?.correct_index || 0) + 1,
    2,
  );
  const correctIndex = clampNumber(question?.correct_index, 0, Math.max(0, choiceCount - 1), 0);
  const timeLimitSeconds = resolveQuestionTimeLimit(question, session);
  const timeLimitMs = Math.max(10_000, timeLimitSeconds * 1000);
  const bucketCount = timeLimitMs <= 12_000 ? 6 : timeLimitMs <= 25_000 ? 8 : 10;
  const questionAnswers = (Array.isArray(answers) ? answers : []).filter(
    (answer: any) => Number(answer?.question_id || 0) === Number(question?.id || 0),
  );
  const questionLogs = (Array.isArray(behaviorLogs) ? behaviorLogs : []).filter(
    (log: any) => Number(log?.question_id || 0) === Number(question?.id || 0),
  );
  const answerByParticipant = new Map<number, any>(
    questionAnswers.map((answer: any) => [Number(answer?.participant_id || 0), answer] as const),
  );
  const logByParticipant = new Map<number, any>(
    questionLogs.map((log: any) => [Number(log?.participant_id || 0), log] as const),
  );
  const finalDistribution = Array.from({ length: choiceCount }, (_value, index) => ({
    index,
    count: 0,
    pct_of_room: 0,
    pct_of_answers: 0,
  }));
  const buckets = Array.from({ length: bucketCount }, (_value, bucketIndex) => ({
    bucket_index: bucketIndex,
    label: describeReplayBucket(bucketIndex, bucketCount, timeLimitMs),
    answer_counts: Array.from({ length: choiceCount }, (_answerValue, choiceIndex) => ({
      index: choiceIndex,
      count: 0,
      pct_of_room: 0,
    })),
    committed_count: 0,
    unanswered_count: participantTotal,
    submission_count: 0,
    switch_count: 0,
  }));

  const stableWrongStudents: any[] = [];
  const workedToCorrectStudents: any[] = [];
  const latePanicStudents: any[] = [];
  const focusDriftStudents: any[] = [];
  const assignedSpotlights = new Set<number>();

  let correctCount = 0;
  let lateCommitCount = 0;
  let panicSwapCount = 0;
  let harmfulRevisionCount = 0;
  let workedToCorrectCount = 0;
  let focusDriftCount = 0;

  const pushSpotlight = (
    collection: any[],
    participantId: number,
    payload: { participant_id: number; nickname: string; detail: string },
  ) => {
    if (!participantId || assignedSpotlights.has(participantId)) return;
    assignedSpotlights.add(participantId);
    collection.push(payload);
  };

  for (const participant of Array.isArray(participants) ? participants : []) {
    const participantId = Number(participant?.id || 0);
    const answer = answerByParticipant.get(participantId) || null;
    const log = logByParticipant.get(participantId) || null;
    const chosenIndex = answer && Number.isFinite(Number(answer?.chosen_index))
      ? clampNumber(answer?.chosen_index, 0, Math.max(0, choiceCount - 1), 0)
      : null;
    const responseMs = answer
      ? clampNumber(answer?.response_ms, 0, timeLimitMs, timeLimitMs)
      : timeLimitMs;
    const pathEntries = parseAnswerPathEntries(log?.answer_path_json, timeLimitMs);
    const pathChoiceIndexes = pathEntries.map((entry) => entry.index);
    const effectivePathChoices = pathChoiceIndexes.length > 0
      ? pathChoiceIndexes
      : chosenIndex !== null
        ? [chosenIndex]
        : [];
    const firstChoice = effectivePathChoices.length > 0 ? effectivePathChoices[0] : null;
    const touchedCorrect = effectivePathChoices.includes(correctIndex);
    const isCorrect = Boolean(answer && Number(answer?.is_correct || 0) === 1);
    const totalSwaps = Number(log?.total_swaps || 0);
    const panicSwaps = Number(log?.panic_swaps || 0);
    const focusLossCount = Number(log?.focus_loss_count || 0);
    const blurTimeMs = Number(log?.blur_time_ms || 0);
    const finalDecisionBufferMs = Number(log?.final_decision_buffer_ms || 0);
    const participantLabel = sanitizeLine(participant?.nickname || 'Student', 120);

    if (chosenIndex !== null) {
      finalDistribution[chosenIndex].count += 1;
      if (isCorrect) {
        correctCount += 1;
      }
    }

    if (answer && responseMs >= Math.round(timeLimitMs * 0.75)) {
      lateCommitCount += 1;
    }

    if (answer && (panicSwaps > 0 || (responseMs >= Math.round(timeLimitMs * 0.9) && totalSwaps > 0))) {
      panicSwapCount += 1;
    }

    if (answer && !isCorrect && touchedCorrect) {
      harmfulRevisionCount += 1;
    }

    if (answer && isCorrect && firstChoice !== null && firstChoice !== correctIndex && totalSwaps > 0) {
      workedToCorrectCount += 1;
    }

    if (focusLossCount > 0 || blurTimeMs >= 1500) {
      focusDriftCount += 1;
    }

    if (
      answer &&
      !isCorrect &&
      chosenIndex !== null &&
      totalSwaps === 0 &&
      responseMs <= Math.round(timeLimitMs * 0.65)
    ) {
      pushSpotlight(stableWrongStudents, participantId, {
        participant_id: participantId,
        nickname: participantLabel,
        detail: `Locked onto ${formatAnswerChoiceLabel(chosenIndex)} early and never moved.`,
      });
    } else if (
      answer &&
      isCorrect &&
      firstChoice !== null &&
      firstChoice !== correctIndex &&
      totalSwaps > 0
    ) {
      pushSpotlight(workedToCorrectStudents, participantId, {
        participant_id: participantId,
        nickname: participantLabel,
        detail: `Started on ${formatAnswerChoiceLabel(firstChoice)} and repaired into the right answer.`,
      });
    } else if (answer && (panicSwaps > 0 || (totalSwaps > 0 && responseMs >= Math.round(timeLimitMs * 0.85)))) {
      pushSpotlight(latePanicStudents, participantId, {
        participant_id: participantId,
        nickname: participantLabel,
        detail: 'Made late-stage changes under the clock.',
      });
    } else if (focusLossCount > 0 || blurTimeMs >= 1500) {
      pushSpotlight(focusDriftStudents, participantId, {
        participant_id: participantId,
        nickname: participantLabel,
        detail: 'Lost focus during the question window.',
      });
    }

    if (answer) {
      const submissionBucketIndex = Math.min(
        bucketCount - 1,
        Math.floor((Math.max(0, responseMs - 1) / timeLimitMs) * bucketCount),
      );
      buckets[submissionBucketIndex].submission_count += 1;
    }

    let previousPathChoice: number | null = null;
    for (const entry of pathEntries) {
      const bucketIndex = Math.min(
        bucketCount - 1,
        Math.floor((Math.max(0, entry.timestamp_ms) / timeLimitMs) * bucketCount),
      );
      if (previousPathChoice !== null && previousPathChoice !== entry.index) {
        buckets[bucketIndex].switch_count += 1;
      }
      previousPathChoice = entry.index;
    }

    buckets.forEach((bucket, bucketIndex) => {
      const bucketEndMs = Math.min(
        timeLimitMs,
        Math.floor(((bucketIndex + 1) * timeLimitMs) / bucketCount),
      );
      const resolvedChoice = resolveChoiceAtBucketEnd({
        pathEntries,
        responseMs,
        bucketEndMs,
        fallbackChoiceIndex: chosenIndex,
      });
      if (resolvedChoice === null || resolvedChoice < 0 || resolvedChoice >= choiceCount) {
        return;
      }
      bucket.answer_counts[resolvedChoice].count += 1;
      bucket.committed_count += 1;
    });
  }

  const answersReceived = questionAnswers.length;
  finalDistribution.forEach((entry) => {
    entry.pct_of_room = roundPct(entry.count, participantTotal);
    entry.pct_of_answers = roundPct(entry.count, answersReceived);
  });

  buckets.forEach((bucket) => {
    bucket.answer_counts.forEach((entry) => {
      entry.pct_of_room = roundPct(entry.count, participantTotal);
    });
    bucket.unanswered_count = Math.max(0, participantTotal - bucket.committed_count);
  });

  const sortedDistribution = [...finalDistribution].sort(
    (left, right) => right.count - left.count || left.index - right.index,
  );
  const topChoice = sortedDistribution[0] || null;
  const runnerUpChoice = sortedDistribution[1] || null;
  const topDistractor = sortedDistribution.find(
    (entry) => entry.index !== correctIndex && entry.count > 0,
  ) || null;
  const lateCommitPct = roundPct(lateCommitCount, Math.max(1, answersReceived));
  const panicSwapPct = roundPct(panicSwapCount, Math.max(1, answersReceived));
  const harmfulRevisionPct = roundPct(harmfulRevisionCount, Math.max(1, answersReceived));
  const workedToCorrectPct = roundPct(workedToCorrectCount, Math.max(1, answersReceived));
  const focusDriftPct = roundPct(focusDriftCount, Math.max(1, participantTotal));
  const accuracyPct = roundPct(correctCount, Math.max(1, participantTotal));
  const splitRoom = Boolean(
    topChoice &&
    runnerUpChoice &&
    topChoice.count > 0 &&
    runnerUpChoice.count > 0 &&
    topChoice.pct_of_room - runnerUpChoice.pct_of_room <= 12,
  );

  const signalCandidates = [
    topDistractor && topDistractor.pct_of_room >= 30
      ? {
          id: 'sticky_distractor',
          tone: 'danger',
          score: 100 + topDistractor.pct_of_room,
          label: `Distractor ${formatAnswerChoiceLabel(topDistractor.index)} stuck`,
          value: `${topDistractor.pct_of_room}%`,
          detail: `${topDistractor.pct_of_room}% of the room landed on ${formatAnswerChoiceLabel(topDistractor.index)} instead of the correct answer.`,
        }
      : null,
    lateCommitPct >= 35 || panicSwapPct >= 20
      ? {
          id: 'panic_wave',
          tone: 'warning',
          score: 85 + lateCommitPct + panicSwapPct,
          label: 'Late panic wave',
          value: `${lateCommitPct}%`,
          detail: `${lateCommitPct}% of answers arrived late and ${panicSwapPct}% included last-second switching.`,
        }
      : null,
    harmfulRevisionPct >= 15
      ? {
          id: 'confidence_wobble',
          tone: 'warning',
          score: 78 + harmfulRevisionPct,
          label: 'Students revised away',
          value: `${harmfulRevisionPct}%`,
          detail: `${harmfulRevisionPct}% touched the correct answer before finishing wrong.`,
        }
      : null,
    splitRoom
      ? {
          id: 'split_room',
          tone: 'neutral',
          score: 70 + Number(runnerUpChoice?.pct_of_room || 0),
          label: 'Split room',
          value: `${topChoice?.pct_of_room || 0}% / ${runnerUpChoice?.pct_of_room || 0}%`,
          detail: `The room split between ${formatAnswerChoiceLabel(Number(topChoice?.index || 0))} and ${formatAnswerChoiceLabel(Number(runnerUpChoice?.index || 0))}.`,
        }
      : null,
    workedToCorrectPct >= 20 && accuracyPct >= 60
      ? {
          id: 'productive_struggle',
          tone: 'success',
          score: 60 + workedToCorrectPct,
          label: 'Recovered into correct',
          value: `${workedToCorrectPct}%`,
          detail: `${workedToCorrectPct}% repaired an initial mistake and still landed correctly.`,
        }
      : null,
    focusDriftPct >= 20
      ? {
          id: 'focus_drag',
          tone: 'warning',
          score: 55 + focusDriftPct,
          label: 'Focus drift',
          value: `${focusDriftPct}%`,
          detail: `${focusDriftPct}% of the room lost focus during this question.`,
        }
      : null,
    {
      id: 'accuracy_snapshot',
      tone: accuracyPct >= 75 ? 'success' : accuracyPct >= 50 ? 'neutral' : 'warning',
      score: 40 + accuracyPct,
      label: 'Accuracy snapshot',
      value: `${accuracyPct}%`,
      detail: `${correctCount} of ${participantTotal} students finished on the correct answer.`,
    },
  ]
    .filter(Boolean)
    .sort((left: any, right: any) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 4)
    .map(({ score: _score, ...signal }: any) => signal);

  const primarySignal = signalCandidates[0] || null;
  const focusTags = uniqueStrings(
    parseJsonArray(question?.tags_json).map((tag) => sanitizeLine(tag, 40)),
  ).slice(0, 4);

  let story = {
    kicker: 'Question replay',
    headline: 'This question exposed a real reasoning pattern.',
    body: `${correctCount} of ${participantTotal} students finished correctly, and the answer trail shows more than a simple right-vs-wrong split.`,
    next_move: `Run a short rematch on ${summarizeFocusTags(focusTags)} while the misconception is still visible.`,
  };

  if (primarySignal?.id === 'sticky_distractor' && topDistractor) {
    story = {
      kicker: 'Distractor trap',
      headline: `Choice ${formatAnswerChoiceLabel(topDistractor.index)} pulled the room off course.`,
      body: `${topDistractor.pct_of_room}% of the room finished on ${formatAnswerChoiceLabel(topDistractor.index)}, while only ${accuracyPct}% landed correctly. This looked like a believable model, not random guessing.`,
      next_move: `Run a short rematch and ask why ${formatAnswerChoiceLabel(topDistractor.index)} felt right before students answer again.`,
    };
  } else if (primarySignal?.id === 'panic_wave') {
    story = {
      kicker: 'Late pressure spike',
      headline: 'A late panic wave hit this question.',
      body: `${lateCommitPct}% of answers arrived in the late window and ${panicSwapPct}% showed last-second switching. The room may understand the content better than the final timing suggests.`,
      next_move: 'Rerun the same concept with calmer pacing or an explicit early-commit prompt.',
    };
  } else if (primarySignal?.id === 'confidence_wobble') {
    story = {
      kicker: 'Confidence wobble',
      headline: 'Students saw the right idea, then moved away from it.',
      body: `${harmfulRevisionPct}% touched the correct answer path before finishing wrong. This was a trust-in-reasoning problem as much as a knowledge problem.`,
      next_move: 'Pause on the reasoning behind the correct option, then re-ask the concept immediately.',
    };
  } else if (primarySignal?.id === 'split_room' && topChoice && runnerUpChoice) {
    story = {
      kicker: 'Split room',
      headline: 'The class split between two competing explanations.',
      body: `${topChoice.pct_of_room}% finished on ${formatAnswerChoiceLabel(topChoice.index)} and ${runnerUpChoice.pct_of_room}% on ${formatAnswerChoiceLabel(runnerUpChoice.index)}. This is perfect rematch material because both sides have a real story.`,
      next_move: 'Invite both sides to justify their choice, then launch a short rematch while the comparison is still fresh.',
    };
  } else if (primarySignal?.id === 'productive_struggle') {
    story = {
      kicker: 'Productive struggle',
      headline: 'Students fought their way into the correct answer.',
      body: `${workedToCorrectPct}% started wrong and still repaired into the correct answer. The concept is teachable right now because the room is already close.`,
      next_move: 'Keep the concept but change the surface form in a short rematch to confirm the gain is real.',
    };
  } else if (accuracyPct >= 75 && panicSwapPct < 15 && harmfulRevisionPct < 10) {
    story = {
      kicker: 'Clean mastery',
      headline: 'This concept landed cleanly across the room.',
      body: `${accuracyPct}% finished correctly with little late-stage noise. The room looks ready to move from this exact surface form to a transfer question.`,
      next_move: 'Advance, or reuse the concept with a harder wrapper instead of a full reteach.',
    };
  }

  const spotlightGroups = [
    stableWrongStudents.length > 0
      ? {
          id: 'stable_wrong',
          tone: 'danger',
          title: 'Locked early on the wrong model',
          body: 'These students committed quickly and never updated their model.',
          students: stableWrongStudents.slice(0, 4),
        }
      : null,
    workedToCorrectStudents.length > 0
      ? {
          id: 'worked_to_correct',
          tone: 'success',
          title: 'Worked through it',
          body: 'These students revised their way into the correct answer.',
          students: workedToCorrectStudents.slice(0, 4),
        }
      : null,
    latePanicStudents.length > 0
      ? {
          id: 'late_panic',
          tone: 'warning',
          title: 'Late-stage pressure',
          body: 'These students changed course late under the timer.',
          students: latePanicStudents.slice(0, 4),
        }
      : null,
    focusDriftStudents.length > 0
      ? {
          id: 'focus_drift',
          tone: 'neutral',
          title: 'Focus drift',
          body: 'These students lost focus during the question window.',
          students: focusDriftStudents.slice(0, 4),
        }
      : null,
  ].filter(Boolean);

  const recommendedCount = Math.min(3, Math.max(1, choiceCount));
  const actionLabel =
    recommendedCount === 1
      ? 'Launch instant rematch'
      : `Launch ${recommendedCount}-question rematch`;

  return {
    question_id: Number(question?.id || 0),
    question_index: Number(question?.question_order || 0),
    prompt: String(question?.prompt || ''),
    participants: participantTotal,
    answers_received: answersReceived,
    accuracy_pct: accuracyPct,
    correct_count: correctCount,
    correct_index: correctIndex,
    top_choice_index: topChoice?.index ?? null,
    top_distractor_index: topDistractor?.index ?? null,
    top_distractor_pct: topDistractor?.pct_of_room ?? 0,
    late_commit_pct: lateCommitPct,
    panic_swap_pct: panicSwapPct,
    harmful_revision_pct: harmfulRevisionPct,
    worked_to_correct_pct: workedToCorrectPct,
    focus_drift_pct: focusDriftPct,
    final_distribution: finalDistribution,
    timeline: buckets,
    signals: signalCandidates,
    story,
    spotlight_groups: spotlightGroups,
    next_action: {
      cta_label: actionLabel,
      body:
        topDistractor && topDistractor.count > 0
          ? `Re-run ${summarizeFocusTags(focusTags)} and surface why distractor ${formatAnswerChoiceLabel(topDistractor.index)} felt tempting.`
          : `Re-run ${summarizeFocusTags(focusTags)} while the class still remembers this moment.`,
      recommended_count: recommendedCount,
      focus_tags: focusTags,
      priority_question_ids: [Number(question?.id || 0)],
    },
  };
}

function takeLastRows<T>(rows: T[], limit: number) {
  if (!Array.isArray(rows)) return [];
  if (rows.length <= limit) return rows;
  return rows.slice(rows.length - limit);
}

function normalizeQuestionForEngine(question: any, index = 0) {
  const answers = Array.isArray(question?.answers)
    ? question.answers.map((answer: unknown) => String(answer || '').trim()).filter(Boolean)
    : parseJsonArray(question?.answers_json).map((answer) => String(answer || '').trim()).filter(Boolean);
  const tags = Array.isArray(question?.tags)
    ? question.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean)
    : parseJsonArray(question?.tags_json).map((tag) => String(tag || '').trim()).filter(Boolean);

  return {
    ...question,
    id: Number(question?.id || 0),
    question_order: Number(question?.question_order || index + 1),
    prompt: String(question?.prompt || '').trim(),
    answers,
    answers_json: JSON.stringify(answers),
    tags,
    tags_json: JSON.stringify(tags),
    correct_index: Number(question?.correct_index || 0),
    explanation: String(question?.explanation || ''),
    image_url: String(question?.image_url || ''),
    time_limit_seconds: Number(question?.time_limit_seconds || 20),
    learning_objective: String(question?.learning_objective || ''),
    bloom_level: String(question?.bloom_level || ''),
  };
}

function buildEngineReadySessionPayload(payload: Record<string, any>): Record<string, any> {
  return {
    ...payload,
    participants: Array.isArray(payload?.participants) ? payload.participants : [],
    answers: Array.isArray(payload?.answers) ? payload.answers : [],
    behavior_logs: Array.isArray(payload?.behavior_logs) ? payload.behavior_logs : [],
    questions: (Array.isArray(payload?.questions) ? payload.questions : [])
      .map((question, index) => normalizeQuestionForEngine(question, index))
      .filter((question) => Number(question.id) > 0 && String(question.prompt || '').length > 0),
  };
}

function buildFallbackClassDashboard(payload: Record<string, any>) {
  const normalizedPayload = buildEngineReadySessionPayload(payload);
  const answersByParticipantId = new Map<number, any[]>();

  for (const answer of Array.isArray(normalizedPayload.answers) ? normalizedPayload.answers : []) {
    const participantId = Number(answer?.participant_id || 0);
    if (!participantId) continue;
    const current = answersByParticipantId.get(participantId) || [];
    current.push(answer);
    answersByParticipantId.set(participantId, current);
  }

  return {
    analytics_version: 'class_dashboard_fallback',
    session: {
      id: Number(normalizedPayload?.session?.id || 0),
      pin: String(normalizedPayload?.session?.pin || ''),
      status: String(normalizedPayload?.session?.status || 'ENDED'),
      quiz_pack_id: Number(normalizedPayload?.session?.quiz_pack_id || 0),
      pack_title: String(normalizedPayload?.pack?.title || ''),
      question_count: normalizedPayload.questions.length,
    },
    participants: (Array.isArray(normalizedPayload.participants) ? normalizedPayload.participants : []).map((participant: any) => {
      const participantId = Number(participant?.id || 0);
      const participantAnswers = answersByParticipantId.get(participantId) || [];
      const correctAnswers = participantAnswers.filter((answer: any) => Number(answer?.is_correct || 0) === 1).length;
      const totalScore = participantAnswers.reduce((sum: number, answer: any) => sum + Number(answer?.score_awarded || 0), 0);
      const accuracy = participantAnswers.length ? Math.round((correctAnswers / participantAnswers.length) * 100) : 0;

      return {
        id: participantId,
        nickname: String(participant?.nickname || 'Student'),
        total_score: totalScore,
        accuracy,
        answers_count: participantAnswers.length,
        correct_answers: correctAnswers,
        weak_tags: [],
        strong_tags: [],
        recommendation: '',
        risk_level: participantAnswers.length > 0 ? 'medium' : 'low',
        stress_index: 0,
      };
    }),
    questions: normalizedPayload.questions.map((question: any) => ({
      id: Number(question?.id || 0),
      question_id: Number(question?.id || 0),
      question_index: Number(question?.question_order || 0),
      prompt: String(question?.prompt || ''),
      question_prompt: String(question?.prompt || ''),
      tags: Array.isArray(question?.tags) ? question.tags : [],
      accuracy: 0,
      stress_index: 0,
      changed_away_from_correct_rate: 0,
      deadline_dependency_rate: 0,
    })),
    studentSpotlight: {
      attention_needed: [],
    },
    research: {
      question_diagnostics: [],
      topic_behavior_profiles: [],
    },
    tagSummary: [],
    alerts: [],
    summary_tiles: [],
  };
}

async function runClassDashboardWithFallback(payload: Record<string, any>) {
  const enginePayload = buildEngineReadySessionPayload(payload);

  try {
    return await runPythonEngine<any>('class-dashboard', enginePayload);
  } catch (error: any) {
    console.error('[class-dashboard] primary generation failed:', error);

    const reducedPayload = {
      ...enginePayload,
      questions: takeLastRows(Array.isArray(enginePayload.questions) ? enginePayload.questions : [], 250),
      answers: takeLastRows(Array.isArray(enginePayload.answers) ? enginePayload.answers : [], 500),
      behavior_logs: takeLastRows(Array.isArray(enginePayload.behavior_logs) ? enginePayload.behavior_logs : [], 600),
      participants: takeLastRows(Array.isArray(enginePayload.participants) ? enginePayload.participants : [], 120),
    };

    try {
      return await runPythonEngine<any>('class-dashboard', reducedPayload);
    } catch (retryError: any) {
      console.error('[class-dashboard] fallback generation failed:', retryError);
      return buildFallbackClassDashboard(reducedPayload);
    }
  }
}

async function runStudentDashboardWithFallback(payload: Record<string, any>) {
  try {
    return await runPythonEngine<any>('student-dashboard', payload);
  } catch (error: any) {
    const message = String(error?.message || '');
    if (!message.includes('payload is too large')) {
      throw error;
    }

    const answerQuestionIds = uniqueNumbers((Array.isArray(payload.answers) ? payload.answers : []).map((row: any) => row?.question_id));
    const packIds = uniqueNumbers([
      ...(Array.isArray(payload.packs) ? payload.packs.map((row: any) => row?.id) : []),
      ...(Array.isArray(payload.sessions) ? payload.sessions.map((row: any) => row?.quiz_pack_id) : []),
    ]);
    const reducedQuestions = takeLastRows(
      (Array.isArray(payload.questions) ? payload.questions : []).filter((question: any) => {
        const questionId = Number(question?.id || 0);
        const packId = Number(question?.quiz_pack_id || 0);
        return answerQuestionIds.includes(questionId) || packIds.includes(packId);
      }),
      320,
    );

    return runPythonEngine<any>('student-dashboard', {
      ...payload,
      mastery: takeLastRows(Array.isArray(payload.mastery) ? payload.mastery : [], 300),
      answers: takeLastRows(Array.isArray(payload.answers) ? payload.answers : [], 500),
      questions: reducedQuestions,
      behavior_logs: takeLastRows(Array.isArray(payload.behavior_logs) ? payload.behavior_logs : [], 600),
      practice_attempts: takeLastRows(Array.isArray(payload.practice_attempts) ? payload.practice_attempts : [], 200),
      sessions: takeLastRows(Array.isArray(payload.sessions) ? payload.sessions : [], 36),
      packs: takeLastRows(Array.isArray(payload.packs) ? payload.packs : [], 24),
    });
  }
}

async function runPracticeSetWithFallback(payload: Record<string, any>) {
  const sanitizeQuestions = (rows: any[]) =>
    (Array.isArray(rows) ? rows : []).map((question: any, index: number) => normalizeQuestionForEngine(question, index)).filter((question: any) => {
      const id = Number(question?.id || 0);
      const prompt = String(question?.prompt || '').trim();
      return id > 0 && prompt.length > 0;
    });

  const basePayload: Record<string, any> = {
    ...payload,
    questions: sanitizeQuestions(payload.questions),
    practice_attempts: Array.isArray(payload.practice_attempts) ? payload.practice_attempts : [],
    focus_tags: Array.isArray(payload.focus_tags) ? payload.focus_tags : [],
    priority_question_ids: Array.isArray(payload.priority_question_ids) ? payload.priority_question_ids : [],
  };

  try {
    return await runPythonEngine<any>('practice-set', basePayload);
  } catch (error: any) {
    console.error('[practice-set] primary generation failed:', error);

    const reducedPayload: Record<string, any> = {
      ...basePayload,
      questions: sanitizeQuestions(basePayload.questions).slice(0, 250),
      practice_attempts: (Array.isArray(basePayload.practice_attempts) ? basePayload.practice_attempts : []).slice(-120),
      mastery: Array.isArray(basePayload.mastery) ? basePayload.mastery.slice(0, 120) : basePayload.mastery,
    };

    try {
      return await runPythonEngine<any>('practice-set', reducedPayload);
    } catch (retryError: any) {
      console.error('[practice-set] fallback generation failed:', retryError);

      return {
        questions: reducedPayload.questions.slice(0, Math.max(1, Number(reducedPayload.count || 5))),
        strategy: {
          headline: 'Practice set fallback',
          body: 'Returning a lighter practice set because adaptive generation was unavailable for this request.',
          focus_tags: Array.isArray(reducedPayload.focus_tags) ? reducedPayload.focus_tags : [],
          priority_question_ids: Array.isArray(reducedPayload.priority_question_ids) ? reducedPayload.priority_question_ids : [],
        },
      };
    }
  }
}

function buildStudentEngagementEnvelope({
  analytics,
  answers,
  practiceAttempts,
}: {
  analytics: Record<string, any>;
  answers: any[];
  practiceAttempts: any[];
}) {
  const now = Date.now();
  const window7dStart = now - 7 * DAY_MS;
  const activityTimestamps = [...answers, ...practiceAttempts]
    .map((row) => parseTimestampMs(row?.created_at))
    .filter((value): value is number => value !== null);
  const activeDayKeys = uniqueStrings(activityTimestamps.map((timestamp) => toUtcDayKey(timestamp)));
  const activeDays7d = uniqueStrings(
    activityTimestamps
      .filter((timestamp) => timestamp >= window7dStart)
      .map((timestamp) => toUtcDayKey(timestamp)),
  ).length;
  const lastActivityAt = maxIsoTimestamp([...answers.map((row) => row?.created_at), ...practiceAttempts.map((row) => row?.created_at)]);
  const lastActivityMs = parseTimestampMs(lastActivityAt);
  const daysSinceLastActivity = lastActivityMs === null ? null : Math.max(0, Math.floor((now - lastActivityMs) / DAY_MS));
  const focusTags = uniqueStrings([
    ...(Array.isArray(analytics?.practicePlan?.focus_tags) ? analytics.practicePlan.focus_tags : []),
    ...(Array.isArray(analytics?.profile?.weak_tags) ? analytics.profile.weak_tags : []),
    ...(Array.isArray(analytics?.adaptiveTargets?.focus_tags) ? analytics.adaptiveTargets.focus_tags : []),
  ]).slice(0, 4);
  const confidenceScore = Number(analytics?.profile?.confidence_score || 0);
  const focusScore = Number(analytics?.profile?.focus_score || 0);
  const liveAnswers7d = answers.filter((row) => {
    const createdAt = parseTimestampMs(row?.created_at);
    return createdAt !== null && createdAt >= window7dStart;
  }).length;
  const practiceAttempts7d = practiceAttempts.filter((row) => {
    const createdAt = parseTimestampMs(row?.created_at);
    return createdAt !== null && createdAt >= window7dStart;
  }).length;
  const comebackStreakDays = buildConsecutiveDayStreak(activeDayKeys);

  let missionId = 'momentum';
  let missionLabel = 'Momentum Booster';
  let questionCount = 5;
  let headline = 'Keep your rhythm warm';
  let body = 'You are already in motion. A short five-question sprint will lock in the gains from your recent games.';
  let ctaLabel = 'Start Momentum Sprint';

  if (lastActivityAt === null || (daysSinceLastActivity ?? 0) >= 6) {
    missionId = 'reentry';
    missionLabel = 'Comeback Mission';
    questionCount = 3;
    headline = 'Quick comeback mission';
    body = `Take a low-friction reset with 3 short questions around ${summarizeFocusTags(focusTags)} so returning feels easy, not heavy.`;
    ctaLabel = 'Start 3-Question Reset';
  } else if (focusScore < 60 || confidenceScore < 60 || focusTags.length > 0) {
    missionId = 'targeted';
    missionLabel = 'Focus Sprint';
    questionCount = 4;
    headline = 'Targeted confidence rebuild';
    body = `Run a tight 4-question sprint on ${summarizeFocusTags(focusTags)} to stabilize your weak spots before the next live game.`;
    ctaLabel = 'Run Focus Sprint';
  }

  const weeklyGoalTarget = missionId === 'reentry' ? 2 : 3;
  const weeklyGoalProgress = Math.min(activeDays7d, weeklyGoalTarget);

  return {
    last_activity_at: lastActivityAt,
    days_since_last_activity: daysSinceLastActivity,
    active_days_7d: activeDays7d,
    live_answers_7d: liveAnswers7d,
    practice_attempts_7d: practiceAttempts7d,
    comeback_streak_days: comebackStreakDays,
    weekly_goal: {
      active_days_target: weeklyGoalTarget,
      active_days_progress: weeklyGoalProgress,
      completion_pct: Math.round((weeklyGoalProgress / Math.max(1, weeklyGoalTarget)) * 100),
    },
    comeback_mission: {
      id: missionId,
      label: missionLabel,
      headline,
      body,
      cta_label: ctaLabel,
      question_count: questionCount,
      focus_tags: focusTags,
      practice_query: {
        count: questionCount,
        focus_tags: focusTags,
        mission: missionId,
        mission_label: missionLabel,
      },
    },
  };
}

async function getOverallStudentAnalytics({
  studentUserId,
  identityKey,
  nickname,
  displayName,
}: {
  studentUserId?: number;
  identityKey?: string | null;
  nickname?: string | null;
  displayName?: string | null;
}): Promise<any> {
  const context = await buildStudentAnalyticsContext({
    studentUserId,
    identityKey,
    nickname,
    displayName,
  });
  const existingMemoryRow = await readStudentMemorySnapshotRow(context.primary_identity_key);
  const dashboard = (await runStudentDashboardWithFallback({
    nickname: context.canonical_nickname,
    mastery: context.mastery,
    answers: context.answers,
    questions: context.questions,
    behavior_logs: context.behavior_logs,
    practice_attempts: context.practice_attempts,
    sessions: context.sessions,
    packs: context.packs,
  })) as Record<string, any>;
  const engagement = buildStudentEngagementEnvelope({
    analytics: dashboard || {},
    answers: context.answers,
    practiceAttempts: context.practice_attempts,
  });
  const studentMemory = await updateStudentMemorySnapshot({
    identityKey: context.primary_identity_key,
    nickname: context.canonical_nickname,
    overallAnalytics: dashboard,
    mastery: context.mastery,
    answers: context.answers,
    practiceAttempts: context.practice_attempts,
    sessions: context.sessions,
    questions: context.questions,
    teacherNote: existingMemoryRow?.teacher_note || '',
    teacherNoteUpdatedAt: existingMemoryRow?.teacher_note_updated_at ? String(existingMemoryRow.teacher_note_updated_at) : null,
  });

  return {
    ...(dashboard || {}),
    identity_scope: {
      student_user_id: context.student_user_id,
      identity_keys: context.identity_keys,
      primary_identity_key: context.primary_identity_key,
      profile_mode: context.student_user_id ? 'longitudinal' : 'session-only',
      account_linked: Boolean(context.student_user_id),
    },
    engagement,
    comebackMission: engagement.comeback_mission,
    student_memory: studentMemory,
  };
}

async function getSessionStudentContext(sessionId: number, participantId: number) {
  const classPayload = (await getSessionPayload(sessionId));
  if (!classPayload) return null;

  const participant = classPayload.participants.find((row: any) => Number(row.id) === participantId);
  if (!participant) return null;

  const identityKey = getParticipantIdentityKey(participant);
  const studentScope = await buildStudentAnalyticsContext({
    studentUserId: Number(participant?.student_user_id || 0),
    identityKey,
    nickname: participant?.nickname,
    displayName: participant?.display_name_snapshot || participant?.nickname,
  });
  const mastery = studentScope.mastery;
  const practice_attempts = studentScope.practice_attempts;
  const answers = classPayload.answers.filter((answer: any) => Number(answer.participant_id) === participantId);
  const behavior_logs = classPayload.behavior_logs.filter((log: any) => Number(log.participant_id) === participantId);

  const sessionAnalytics = await runStudentDashboardWithFallback({
    nickname: studentScope.canonical_nickname,
    mastery,
    answers,
    questions: classPayload.questions,
    behavior_logs,
    practice_attempts,
    sessions: [classPayload.session],
    packs: classPayload.pack ? [classPayload.pack] : [],
  });
  const overallAnalytics = await getOverallStudentAnalytics({
    studentUserId: studentScope.student_user_id || undefined,
    identityKey,
    nickname: studentScope.canonical_nickname,
    displayName: participant?.display_name_snapshot || participant?.nickname,
  });

  const adaptivePreview = await runPracticeSetWithFallback({
      nickname: studentScope.canonical_nickname,
      mastery,
      questions: classPayload.questions,
      practice_attempts,
    count: Math.min(5, Math.max(1, classPayload.questions.length || 1)),
    focus_tags:
      sessionAnalytics?.adaptiveTargets?.focus_tags ||
      overallAnalytics?.adaptiveTargets?.focus_tags ||
      sessionAnalytics?.practicePlan?.focus_tags ||
      [],
    priority_question_ids:
      sessionAnalytics?.adaptiveTargets?.priority_question_ids ||
      overallAnalytics?.adaptiveTargets?.priority_question_ids ||
      [],
  });

  const classDashboard = await runClassDashboardWithFallback(classPayload);
  const studentSummary =
    classDashboard?.participants?.find((row: any) => Number(row.id) === participantId) || null;
  const studentMemory = await updateStudentMemorySnapshot({
    identityKey: studentScope.primary_identity_key,
    nickname: studentScope.canonical_nickname,
    overallAnalytics,
    sessionAnalytics,
    mastery,
    answers: studentScope.answers,
    practiceAttempts: practice_attempts as any[],
    sessions: studentScope.sessions,
    questions: studentScope.questions,
  });

  return {
    classPayload,
    participant: {
      ...participant,
      account_linked: Boolean(studentScope.student_user_id),
      profile_mode: studentScope.student_user_id ? 'longitudinal' : 'session-only',
    },
    identityKey,
    mastery,
    practice_attempts,
    sessionAnalytics,
    overallAnalytics,
    studentMemory,
    analyticsComparison: buildAnalyticsComparison(sessionAnalytics, overallAnalytics),
    adaptivePreview,
    classDashboard,
    studentSummary,
    studentScope,
  };
}

async function getClassFollowUpContext(sessionId: number) {
  const classPayload = (await getSessionPayload(sessionId));
  if (!classPayload) return null;

  const classDashboard = (await runClassDashboardWithFallback(classPayload)) as Record<string, any>;
  const packDetail = (await getHydratedPackWithQuestions(Number(classPayload.pack?.id || classPayload.session?.quiz_pack_id || 0)));
  const followUpEngine = buildFollowUpEnginePreview({
    participants: Array.isArray(classDashboard?.participants) ? classDashboard.participants : [],
    attentionQueue: Array.isArray(classDashboard?.studentSpotlight?.attention_needed) ? classDashboard.studentSpotlight.attention_needed : [],
    questionDiagnostics: Array.isArray(classDashboard?.research?.question_diagnostics) ? classDashboard.research.question_diagnostics : [],
    topicBehaviorProfiles: Array.isArray(classDashboard?.research?.topic_behavior_profiles)
      ? classDashboard.research.topic_behavior_profiles
      : Array.isArray(classDashboard?.tagSummary)
        ? classDashboard.tagSummary
        : [],
    packQuestions: Array.isArray(packDetail?.questions) ? packDetail.questions : [],
  });

  return {
    classPayload,
    classDashboard,
    packDetail,
    followUpEngine,
  };
}

function sortByNewestTimestamp<T extends Record<string, any>>(rows: T[], ...keys: string[]) {
  return [...rows].sort((left, right) => {
    const leftTimestamp = Math.max(
      ...keys.map((key) => new Date(String(left?.[key] || 0)).getTime() || 0),
    );
    const rightTimestamp = Math.max(
      ...keys.map((key) => new Date(String(right?.[key] || 0)).getTime() || 0),
    );
    return rightTimestamp - leftTimestamp;
  });
}

function buildFallbackStudentSessionHistory({
  participants,
  sessions,
  packs,
  answers,
}: {
  participants: any[];
  sessions: any[];
  packs: any[];
  answers: any[];
}) {
  const sessionById = new Map(sessions.map((session: any) => [Number(session.id), session] as const));
  const packById = new Map(packs.map((pack: any) => [Number(pack.id), pack] as const));
  const answersByParticipantId = new Map<number, any[]>();
  answers.forEach((answer: any) => {
    const participantId = Number(answer?.participant_id || 0);
    const current = answersByParticipantId.get(participantId) || [];
    current.push(answer);
    answersByParticipantId.set(participantId, current);
  });

  return sortByNewestTimestamp(participants, 'created_at').slice(0, 12).map((participant: any) => {
    const session = sessionById.get(Number(participant.session_id || 0)) || null;
    const pack = session ? packById.get(Number(session.quiz_pack_id || 0)) || null : null;
    const participantAnswers = answersByParticipantId.get(Number(participant.id || 0)) || [];
    const correctCount = participantAnswers.filter((answer: any) => Number(answer?.is_correct || 0) > 0).length;
    const accuracy = participantAnswers.length ? Math.round((correctCount / participantAnswers.length) * 100) : 0;
    return {
      session_id: Number(session?.id || participant.session_id || 0),
      participant_id: Number(participant.id || 0),
      pack_id: Number(pack?.id || session?.quiz_pack_id || 0) || null,
      pack_title: String(pack?.title || `Pack ${session?.quiz_pack_id || ''}`).trim(),
      status: String(session?.status || 'ENDED'),
      joined_at: participant.created_at || null,
      started_at: session?.started_at || participant.created_at || null,
      ended_at: session?.ended_at || null,
      accuracy_pct: accuracy,
      answer_count: participantAnswers.length,
      nickname: String(participant.display_name_snapshot || participant.nickname || 'Student'),
    };
  });
}

async function buildStudentPortalPayload(studentUserId: number) {
  const studentUser = await getStudentUserById(studentUserId);
  if (!studentUser?.id || String(studentUser.status || 'active') !== 'active') {
    return null;
  }

  try {
    await claimRosterRowsForStudentUser({
      studentUserId: Number(studentUser.id),
      email: String(studentUser.email || ''),
    });
  } catch (error: any) {
    console.error('[WARN] Student portal roster-claim fallback engaged:', error);
  }

  let classes: any[] = [];
  try {
    const loadedClasses = await buildStudentClassSummaries(studentUserId);
    classes = Array.isArray(loadedClasses) ? loadedClasses : [];
  } catch (error: any) {
    console.error('[WARN] Student portal class summary fallback engaged:', error);
  }
  let analytics: any = null;
  try {
    analytics = await getOverallStudentAnalytics({
      studentUserId,
      displayName: studentUser.display_name || studentUser.email,
      nickname: studentUser.display_name || studentUser.email,
    });
  } catch (error: any) {
    console.error('[WARN] Student portal analytics fallback engaged:', error);
  }

  let context: any = {
    packs: [],
    sessions: [],
    participants: [],
    answers: [],
  };
  try {
    context = await buildStudentAnalyticsContext({
      studentUserId,
      displayName: studentUser.display_name || studentUser.email,
      nickname: studentUser.display_name || studentUser.email,
    });
  } catch (error: any) {
    console.error('[WARN] Student portal context fallback engaged:', error);
  }
  const safePacks = Array.isArray(context?.packs) ? context.packs : [];
  const safeSessions = Array.isArray(context?.sessions) ? context.sessions : [];
  const safeParticipants = Array.isArray(context?.participants) ? context.participants : [];
  const safeAnswers = Array.isArray(context?.answers) ? context.answers : [];
  const packById = new Map<number, any>(safePacks.map((pack: any) => [Number(pack.id), pack] as const));
  const sortedSessions = sortByNewestTimestamp(safeSessions, 'started_at', 'ended_at');
  const latestSession = sortedSessions[0] || null;
  const latestPack = latestSession ? packById.get(Number(latestSession.quiz_pack_id || 0)) || null : null;
  const sessionHistory = Array.isArray(analytics?.sessionHistory) && analytics.sessionHistory.length > 0
    ? analytics.sessionHistory
    : buildFallbackStudentSessionHistory({
        participants: safeParticipants,
        sessions: safeSessions,
        packs: safePacks,
        answers: safeAnswers,
      });
  const recommendations = {
    next_step: analytics?.student_memory?.recommended_next_step || null,
    comeback_mission: analytics?.comebackMission || analytics?.engagement?.comeback_mission || null,
    weak_tags: Array.isArray(analytics?.profile?.weak_tags) ? analytics.profile.weak_tags : [],
  };
  const pendingClasses = classes.filter((classRow: any) => String(classRow?.approval_state || classRow?.invite_status || 'none') !== 'claimed');
  const activeClasses = classes.filter((classRow: any) => String(classRow?.approval_state || classRow?.invite_status || 'none') === 'claimed');

  return {
    student: {
      id: Number(studentUser.id),
      email: String(studentUser.email || ''),
      display_name: String(studentUser.display_name || studentUser.email || 'Student'),
      preferred_language: String(studentUser.preferred_language || ''),
      status: String(studentUser.status || 'active'),
      created_at: studentUser.created_at || null,
      last_login_at: studentUser.last_login_at || null,
    },
    classes,
    pending_classes: pendingClasses,
    active_classes: activeClasses,
    latest_session: latestSession
      ? {
          id: Number(latestSession.id || 0),
          status: String(latestSession.status || 'LOBBY'),
          pin: String(latestSession.pin || ''),
          quiz_pack_id: Number(latestSession.quiz_pack_id || 0),
          pack_title: String(latestPack?.title || `Pack ${latestSession.quiz_pack_id || ''}`),
          started_at: latestSession.started_at || null,
          ended_at: latestSession.ended_at || null,
        }
      : null,
    overall_analytics: analytics,
    recommendations,
    student_memory: analytics?.student_memory || null,
    session_history: sessionHistory,
    practice_defaults: analytics?.comebackMission?.practice_query || null,
  };
}

async function createFollowUpPack({
  teacherUserId,
  sourceSession,
  sourcePack,
  questions,
  title,
  packNotes,
}: {
  teacherUserId: number;
  sourceSession: any;
  sourcePack: any;
  questions: any[];
  title: string;
  packNotes: string;
}) {
  const sourceText = String(sourcePack?.source_text || '');
  const materialProfile = (await getOrCreateMaterialProfile(sourceText));

  const packInfo = (await db
        .prepare(`
      INSERT INTO quiz_packs (
        teacher_id,
        title,
        source_text,
        course_code,
        course_name,
        section_name,
        academic_term,
        week_label,
        learning_objectives_json,
        bloom_levels_json,
        pack_notes,
        source_hash,
        source_excerpt,
        source_language,
        source_word_count,
        material_profile_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
        .run(
          teacherUserId,
          title,
          sourceText,
          sourcePack?.course_code || '',
          sourcePack?.course_name || '',
          sourcePack?.section_name || '',
          sourcePack?.academic_term || '',
          sourcePack?.week_label || '',
          JSON.stringify(Array.isArray(sourcePack?.learning_objectives) ? sourcePack.learning_objectives : []),
          JSON.stringify(Array.isArray(sourcePack?.bloom_levels) ? sourcePack.bloom_levels : []),
          packNotes,
          materialProfile.source_hash,
          materialProfile.source_excerpt,
          sourcePack?.source_language || materialProfile.source_language,
          materialProfile.word_count,
          materialProfile.id,
        ));
  const packId = Number(packInfo.lastInsertRowid);

  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      quiz_pack_id,
      type,
      prompt,
      image_url,
      answers_json,
      correct_index,
      explanation,
      tags_json,
      difficulty,
      time_limit_seconds,
      question_order,
      learning_objective,
      bloom_level
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertQuestions = db.transaction((draftQuestions: any[]) => {
    draftQuestions.forEach((question, index) => {
      insertQuestion.run(
        packId,
        question.type || 'multiple_choice',
        question.prompt,
        question.image_url || '',
        question.answers_json || JSON.stringify(question.answers || []),
        question.correct_index,
        question.explanation || '',
        question.tags_json || JSON.stringify(question.tags || []),
        question.difficulty || 3,
        question.time_limit_seconds || 20,
        index + 1,
        question.learning_objective || '',
        question.bloom_level || '',
      );
    });
  });

  insertQuestions(questions);
  (await syncPackDerivedData(packId, sourceText, questions, sourcePack?.source_language || materialProfile.source_language));
  (await createPackVersionSnapshot(packId, teacherUserId, 'Follow-up baseline', 'follow-up-engine'));

  return {
    packId,
    teacherClassId: Number(sourceSession?.teacher_class_id || 0) || null,
  };
}

function deriveAdaptiveFocusTags({
  sessionAnalytics,
  overallAnalytics,
  studentSummary,
  participant,
}: {
  sessionAnalytics?: any;
  overallAnalytics?: any;
  studentSummary?: any;
  participant?: any;
}) {
  return uniqueStrings([
    ...(Array.isArray(sessionAnalytics?.adaptiveTargets?.focus_tags) ? sessionAnalytics.adaptiveTargets.focus_tags : []),
    ...(Array.isArray(overallAnalytics?.adaptiveTargets?.focus_tags) ? overallAnalytics.adaptiveTargets.focus_tags : []),
    ...(Array.isArray(sessionAnalytics?.practicePlan?.focus_tags) ? sessionAnalytics.practicePlan.focus_tags : []),
    ...(Array.isArray(studentSummary?.weak_tags) ? studentSummary.weak_tags : []),
    ...(Array.isArray(participant?.weak_tags) ? participant.weak_tags : []),
  ]).slice(0, 4);
}

function deriveAdaptivePriorityQuestionIds({
  sessionAnalytics,
  overallAnalytics,
  answers,
}: {
  sessionAnalytics?: any;
  overallAnalytics?: any;
  answers?: any[];
}) {
  return uniqueNumbers([
    ...(Array.isArray(sessionAnalytics?.adaptiveTargets?.priority_question_ids) ? sessionAnalytics.adaptiveTargets.priority_question_ids : []),
    ...(Array.isArray(overallAnalytics?.adaptiveTargets?.priority_question_ids) ? overallAnalytics.adaptiveTargets.priority_question_ids : []),
    ...((Array.isArray(answers) ? answers : [])
      .filter((answer: any) => !Number(answer?.is_correct || 0))
      .map((answer: any) => answer?.question_id)),
  ]).slice(0, 8);
}

async function createAdaptivePackForParticipant({
  teacherUserId,
  sourceSession,
  sourcePack,
  participant,
  mastery,
  practiceAttempts,
  questions,
  requestedCount,
  focusTags,
  priorityQuestionIds,
  notesExtra,
}: {
  teacherUserId: number;
  sourceSession: any;
  sourcePack: any;
  participant: any;
  mastery: any[];
  practiceAttempts: any[];
  questions: any[];
  requestedCount: number;
  focusTags: string[];
  priorityQuestionIds: number[];
  notesExtra?: string;
}) {
  const safeQuestionCount = Math.min(
    clampNumber(requestedCount, 1, 20, 5),
    Math.max(1, Array.isArray(questions) ? questions.length : 1),
  );
  const originalPackTitle = String(sourcePack?.title || `Pack ${sourceSession?.quiz_pack_id || 'adaptive'}`);
  const adaptiveTitle = `Adaptive S${Number(sourceSession?.id || 0)} (${safeQuestionCount}Q): ${String(participant?.nickname || 'Student')} - ${originalPackTitle}`;
  const existingPack = (await db
        .prepare('SELECT id FROM quiz_packs WHERE teacher_id = ? AND title = ? LIMIT 1')
        .get(teacherUserId, adaptiveTitle)) as any;

  if (existingPack?.id) {
    const questionCount = Number(
      (await db.prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_pack_id = ?').get(existingPack.id))?.count || 0,
    );
    return {
      pack_id: Number(existingPack.id),
      title: adaptiveTitle,
      question_count: questionCount,
      strategy: 'reused-existing-pack',
      focus_tags: focusTags,
      priority_question_ids: priorityQuestionIds,
      participant: {
        id: Number(participant?.id || 0),
        nickname: String(participant?.nickname || 'Student'),
      },
      teacherClassId: Number(sourceSession?.teacher_class_id || 0) || null,
      reused: true,
    };
  }

  const adaptiveGame = await runPracticeSetWithFallback({
    nickname: participant?.nickname,
    mastery,
    questions,
    practice_attempts: practiceAttempts,
    count: safeQuestionCount,
    focus_tags: focusTags,
    priority_question_ids: priorityQuestionIds,
  });

  if (!adaptiveGame?.questions?.length) {
    const error = new Error('No adaptive questions available for this student');
    (error as any).status = 400;
    throw error;
  }

  const packNotes = [
    `Adaptive path for ${String(participant?.nickname || 'Student')}`,
    focusTags.length > 0 ? `Focus tags: ${focusTags.join(', ')}` : '',
    priorityQuestionIds.length > 0 ? `Priority question IDs: ${priorityQuestionIds.join(', ')}` : '',
    adaptiveGame?.strategy ? `Strategy: ${String(adaptiveGame.strategy)}` : '',
    notesExtra || '',
    `Source session: ${Number(sourceSession?.id || 0)}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const createdPack = await createFollowUpPack({
    teacherUserId,
    sourceSession,
    sourcePack,
    questions: adaptiveGame.questions,
    title: adaptiveTitle,
    packNotes,
  });

  return {
    pack_id: createdPack.packId,
    title: adaptiveTitle,
    question_count: adaptiveGame.questions.length,
    strategy: adaptiveGame.strategy,
    focus_tags: focusTags,
    priority_question_ids: priorityQuestionIds,
    participant: {
      id: Number(participant?.id || 0),
      nickname: String(participant?.nickname || 'Student'),
    },
    teacherClassId: createdPack.teacherClassId,
    reused: false,
  };
}

async function executeFollowUpPlan({
  teacherUserId,
  sessionId,
  requestedPlanId,
  launchNow,
  titlePrefix,
  fallbackToDefault,
}: {
  teacherUserId: number;
  sessionId: number;
  requestedPlanId: string;
  launchNow: boolean;
  titlePrefix: string;
  fallbackToDefault: boolean;
}) {
  const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
  if (!ownedSession) {
    const error = new Error('Session not found');
    (error as any).status = 404;
    throw error;
  }

  const context = await getClassFollowUpContext(sessionId);
  if (!context) {
    const error = new Error('Class analytics not found');
    (error as any).status = 404;
    throw error;
  }

  const preferredPlanId = String(requestedPlanId || '').trim() as FollowUpPlan['id'];
  const defaultPlan =
    context.followUpEngine.plans.find((plan) => plan.id === 'whole_class_reset')
    || context.followUpEngine.plans[0]
    || null;
  const selectedPlan =
    context.followUpEngine.plans.find((plan) => plan.id === preferredPlanId)
    || (fallbackToDefault ? defaultPlan : null);

  if (!selectedPlan) {
    const error = new Error('Requested follow-up plan is unavailable');
    (error as any).status = 400;
    throw error;
  }

  const sourceQuestions = Array.isArray(context.classPayload.questions) && context.classPayload.questions.length > 0
    ? context.classPayload.questions
    : Array.isArray(context.packDetail?.questions)
      ? context.packDetail.questions
      : [];

  const practiceSet = await runPracticeSetWithFallback({
    questions: sourceQuestions,
    count: Math.min(selectedPlan.question_count, Math.max(1, sourceQuestions.length || 1)),
    focus_tags: selectedPlan.focus_tags,
    priority_question_ids: selectedPlan.priority_question_ids,
  });

  const followUpQuestions =
    Array.isArray(practiceSet?.questions) && practiceSet.questions.length > 0
      ? practiceSet.questions
      : sourceQuestions.filter((question: any) => selectedPlan.priority_question_ids.includes(Number(question?.id || 0)));

  if (!followUpQuestions.length) {
    const error = new Error('No follow-up questions are available for this plan');
    (error as any).status = 400;
    throw error;
  }

  const sourcePackTitle = context.packDetail?.title || context.classPayload.pack?.title || `Pack ${ownedSession.quiz_pack_id}`;
  const followUpTitle = `${titlePrefix}: ${selectedPlan.title} - ${sourcePackTitle}`;
  const packNotes = [
    `${titlePrefix} plan: ${selectedPlan.title}`,
    selectedPlan.focus_tags.length > 0 ? `Focus tags: ${selectedPlan.focus_tags.join(', ')}` : '',
    selectedPlan.priority_question_indexes.length > 0
      ? `Priority questions: ${selectedPlan.priority_question_indexes.map((index) => `Q${index}`).join(', ')}`
      : '',
    selectedPlan.target_student_names.length > 0
      ? `Target students: ${selectedPlan.target_student_names.join(', ')}`
      : `Target scope: ${selectedPlan.audience}`,
    `Source session: ${sessionId}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const createdPack = await createFollowUpPack({
    teacherUserId,
    sourceSession: ownedSession,
    sourcePack: context.packDetail || context.classPayload.pack || {},
    questions: followUpQuestions,
    title: followUpTitle,
    packNotes,
  });

  let hostedSessionPayload: { id: number; pin: string } | null = null;
  if (launchNow) {
    const pin = (await createSessionPin());
    const hostedSession = (await db
          .prepare(`
        INSERT INTO sessions (quiz_pack_id, teacher_class_id, pin, game_type, team_count, mode_config_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
          .run(
            createdPack.packId,
            createdPack.teacherClassId,
            pin,
            'classic_quiz',
            0,
            JSON.stringify(sanitizeModeConfig('classic_quiz', null)),
            'LOBBY',
          ));
    hostedSessionPayload = {
      id: Number(hostedSession.lastInsertRowid),
      pin,
    };
  }

  return {
    pack_id: createdPack.packId,
    title: followUpTitle,
    question_count: followUpQuestions.length,
    plan: selectedPlan,
    strategy: practiceSet?.strategy || null,
    session_id: hostedSessionPayload?.id || null,
    pin: hostedSessionPayload?.pin || null,
  };
}

router.post('/translate', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'ui-translate', 120, 60 * 1000)) return;

  const targetLanguage = String(req.body?.targetLanguage || req.body?.target_language || '').trim().toLowerCase();
  const texts = sanitizeTranslateTexts(req.body?.texts);

  if (!SUPPORTED_UI_LANGUAGES.has(targetLanguage)) {
    res.status(400).json({ error: 'Unsupported target language.' });
    return;
  }

  if (texts.length === 0) {
    res.json({ translations: [] });
    return;
  }

  try {
    const translations = await translateUiTexts(texts, targetLanguage as 'en' | 'he' | 'ar');
    res.json({ translations });
  } catch (error: any) {
    console.error('[translate] Failed to translate UI texts:', error);
    res.status(502).json({ error: error?.message || 'Translation failed.' });
  }
});

// --- Teacher Routes ---

router.post('/auth/register', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'auth-register', 8, 10 * 60 * 1000)) return;

  const email = normalizeTeacherEmail(String(req.body?.email || ''));
  const password = String(req.body?.password || '');
  const name = sanitizeLine(req.body?.name, 120);
  const school = sanitizeLine(req.body?.school, 120);

  const emailError = validateTeacherEmail(email);
  if (emailError) {
    return res.status(400).json({ error: emailError });
  }

  const passwordError = validateTeacherPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  if (!name.trim()) {
    return res.status(400).json({ error: 'Display name is required.' });
  }

  const existingUser = (await getTeacherUserByEmail(email));
  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });
  }

  const createdUser = (await createTeacherUser({
      email,
      password,
      name,
      school,
    }));
  const { session, token } = createTeacherSession({ email: createdUser.email, provider: 'password' });
  issueTeacherSession(req, res, token);
  res.status(201).json({ ...session, token });
});

router.get('/auth/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  void (async () => {
    const sessionData = readTeacherSession(req);
    if (!sessionData) {
      clearTeacherSession(req, res);
      res.status(401).json({ error: 'Not signed in' });
      return;
    }

    const teacherUser = await getTeacherUserByEmail(sessionData.email);
    if (!teacherUser?.id) {
      clearTeacherSession(req, res);
      res.status(401).json({ error: 'Teacher account no longer exists. Please sign in again.' });
      return;
    }

    // Re-create the token for the verified session to keep it fresh on the client.
    const { token } = createTeacherSession({ email: sessionData.email, provider: sessionData.provider });
    res.json({ ...sessionData, token });
  })().catch((error) => {
    console.error('[auth/session] Failed to restore teacher session:', error);
    clearTeacherSession(req, res);
    res.status(500).json({ error: 'Failed to restore teacher session.' });
  });
});

router.post('/auth/login', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'auth-login', 8, 10 * 60 * 1000)) return;

  const email = normalizeTeacherEmail(String(req.body?.email || ''));
  const password = String(req.body?.password || '');
  let teacherUser = (await getTeacherUserByEmail(email));

  if (teacherUser?.password_hash && verifyTeacherPassword(password, teacherUser.password_hash)) {
    const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'password' });
    issueTeacherSession(req, res, token);
    return res.json({ ...session, token });
  }

  if (!isDemoTeacherEmail(email) || !verifyDemoPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!teacherUser) {
    teacherUser = (await createTeacherUser({
      email,
      password,
      name: 'Demo Teacher',
      school: 'Quizzi Academy',
      authProvider: 'password',
    }));
  }

  const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'password' });
  issueTeacherSession(req, res, token);
  res.json({ ...session, token });
});

router.post('/auth/social', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'auth-social', 15, 10 * 60 * 1000)) return;

  const { provider, idToken } = req.body || {};
  if (provider !== 'google' || !idToken) {
    return res.status(400).json({ error: 'Invalid provider or missing token.' });
  }

  try {
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
    const email = normalizeTeacherEmail(decodedToken.email || '');
    if (!email) {
      return res.status(400).json({ error: 'Google account has no valid email address.' });
    }
    if (decodedToken.email_verified === false) {
      return res.status(400).json({ error: 'Google account email must be verified before signing in.' });
    }

    const name = sanitizeLine(decodedToken.name || '', 120);
    
    let teacherUser = (await getTeacherUserByEmail(email));
    if (!teacherUser) {
      // Auto-register the teacher if they don't exist
      teacherUser = (await createTeacherUser({
              email,
              name,
              school: '',
              authProvider: 'google',
            }));
    }

    const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'google' });
    issueTeacherSession(req, res, token);
    res.json({ ...session, token });
  } catch (error: any) {
    console.error('[ERROR] Failed to verify Google ID token:', error);
    const message = String(error?.message || '');
    if (message.toLowerCase().includes('project id')) {
      res.status(500).json({ error: 'Google sign-in is not configured correctly on the server.' });
      return;
    }
    res.status(401).json({ error: 'Failed to verify Google sign-in. Please try again.' });
  }
});

router.post('/auth/logout', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  clearTeacherSession(req, res);
  res.json({ success: true });
});

router.post('/student-auth/social', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-auth-social', 15, 10 * 60 * 1000)) return;

  const { provider, idToken, identity_key } = req.body || {};
  if (provider !== 'google' || !idToken) {
    return res.status(400).json({ error: 'Invalid provider or missing token.' });
  }

  try {
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
    const email = normalizeStudentEmail(decodedToken.email || '');
    if (!email) {
      return res.status(400).json({ error: 'Google account has no valid email address.' });
    }
    if (decodedToken.email_verified === false) {
      return res.status(400).json({ error: 'Google account email must be verified before signing in.' });
    }

    const displayName = sanitizeStudentDisplayName(decodedToken.name || '');
    const identityKey = resolveStudentIdentityKey(identity_key, displayName || email);

    let studentUser = await getStudentUserByEmail(email);
    if (!studentUser) {
      // Auto-register the student if they don't exist
      studentUser = await createStudentUser({
        email,
        password: randomUUID(), // Placeholder password for social accounts
        displayName: displayName || email,
      });
    } else {
      await updateStudentLastLogin(Number(studentUser.id));
    }

    await linkStudentIdentity({
      studentUserId: Number(studentUser.id),
      identityKey,
      source: 'social_login',
    });

    await claimRosterRowsForStudentUser({
      studentUserId: Number(studentUser.id),
      email: studentUser.email,
    });

    const { session, token } = createStudentSession({
      studentUserId: Number(studentUser.id),
      email: studentUser.email,
      displayName: studentUser.display_name || displayName,
      provider: 'google',
    });
    issueStudentSession(req, res, token);
    res.json({ ...session, token, student_user_id: Number(studentUser.id) });
  } catch (error: any) {
    console.error('[ERROR] Failed to verify Student Google ID token:', error);
    const message = String(error?.message || '');
    if (message.toLowerCase().includes('project id')) {
      res.status(500).json({ error: 'Google sign-in is not configured correctly on the server.' });
      return;
    }
    res.status(401).json({ error: 'Failed to verify Google sign-in. Please try again.' });
  }
});

router.post('/student-auth/register', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-auth-register', 10, 10 * 60 * 1000)) return;

  const email = sanitizeStudentEmailInput(req.body?.email);
  const password = String(req.body?.password || '');
  const displayName = sanitizeStudentDisplayName(req.body?.display_name ?? req.body?.displayName ?? req.body?.name);
  const identityKey = resolveStudentIdentityKey(req.body?.identity_key, displayName || email);

  const emailError = validateStudentEmail(email);
  if (emailError) {
    return res.status(400).json({ error: emailError });
  }

  const passwordError = validateStudentPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  if (!displayName) {
    return res.status(400).json({ error: 'Display name is required.' });
  }

  const existingStudent = await getStudentUserByEmail(email);
  if (existingStudent?.id) {
    return res.status(409).json({ error: 'A student account with this email already exists. Try signing in instead.' });
  }

  const createdStudent = await createStudentUser({
    email,
    password,
    displayName,
  });

  await linkStudentIdentity({
    studentUserId: Number(createdStudent.id),
    identityKey,
    source: 'claimed_device',
    makePrimary: true,
  });
  await claimRosterRowsForStudentUser({
    studentUserId: Number(createdStudent.id),
    email: createdStudent.email,
  });

  const uiLanguage = getRequestedUiLanguage(req);
  if (uiLanguage) {
    await updateStudentPreferredLanguage(Number(createdStudent.id), uiLanguage);
  }

  const { session, token } = createStudentSession({
    studentUserId: Number(createdStudent.id),
    email: createdStudent.email,
    displayName: createdStudent.display_name || displayName,
    provider: 'password',
  });
  issueStudentSession(req, res, token);
  res.status(201).json({ ...session, token, student_user_id: Number(createdStudent.id) });
});

router.post('/student-auth/login', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-auth-login', 12, 10 * 60 * 1000)) return;

  const email = sanitizeStudentEmailInput(req.body?.email);
  const password = String(req.body?.password || '');
  const identityKey = resolveStudentIdentityKey(req.body?.identity_key, email);

  const studentUser = await getStudentUserByEmail(email);
  if (!studentUser?.id || !verifyStudentPassword(password, studentUser.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (String(studentUser.status || 'active') !== 'active') {
    return res.status(403).json({ error: 'This student account is not active.' });
  }

  await updateStudentLastLogin(Number(studentUser.id));
  await linkStudentIdentity({
    studentUserId: Number(studentUser.id),
    identityKey,
    source: 'account_join',
  });
  await claimRosterRowsForStudentUser({
    studentUserId: Number(studentUser.id),
    email: studentUser.email,
  });

  const uiLanguage = getRequestedUiLanguage(req);
  if (uiLanguage) {
    await updateStudentPreferredLanguage(Number(studentUser.id), uiLanguage);
  }

  const { session, token } = createStudentSession({
    studentUserId: Number(studentUser.id),
    email: studentUser.email,
    displayName: studentUser.display_name || studentUser.email,
    provider: 'password',
  });
  issueStudentSession(req, res, token);
  res.json({ ...session, token, student_user_id: Number(studentUser.id) });
});

router.post('/student-auth/password-reset/request', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-auth-password-reset-request', 8, 10 * 60 * 1000)) return;

  const email = sanitizeStudentEmailInput(req.body?.email);
  const emailError = validateStudentEmail(email);
  if (emailError) {
    return res.status(400).json({ error: emailError });
  }

  const delivery = await createStudentPasswordResetRequest({
    email,
    locale: getRequestedUiLanguage(req),
    baseUrl: resolvePublicAppUrlFromRequest(req),
  });

  if (!delivery.ok && delivery.deliveryStatus !== 'sent') {
    return res.status(503).json({ error: 'Password reset email is temporarily unavailable. Please try again shortly.' });
  }

  res.json({
    success: true,
    message: 'If a student account exists for this email, a reset code was sent.',
    expires_in_seconds: 5 * 60,
  });
});

router.post('/student-auth/password-reset/confirm', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-auth-password-reset-confirm', 12, 10 * 60 * 1000)) return;

  const email = sanitizeStudentEmailInput(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  const identityKey = resolveStudentIdentityKey(req.body?.identity_key, email);

  const emailError = validateStudentEmail(email);
  if (emailError) {
    return res.status(400).json({ error: emailError });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  }

  const passwordError = validateStudentPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const verification = await verifyStudentPasswordResetCode({ email, code });
  if (verification.ok === false) {
    if (verification.error === 'expired') {
      return res.status(400).json({ error: 'This code has expired. Request a new code and try again.' });
    }
    if (verification.error === 'too_many_attempts') {
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code and try again.' });
    }
    return res.status(400).json({ error: 'The reset code is incorrect. Check the email and try again.' });
  }

  await updateStudentPassword(Number(verification.studentUser.id), password);
  await updateStudentLastLogin(Number(verification.studentUser.id));
  await linkStudentIdentity({
    studentUserId: Number(verification.studentUser.id),
    identityKey,
    source: 'password_reset',
  });
  await claimRosterRowsForStudentUser({
    studentUserId: Number(verification.studentUser.id),
    email: verification.studentUser.email,
  });

  const uiLanguage = getRequestedUiLanguage(req);
  if (uiLanguage) {
    await updateStudentPreferredLanguage(Number(verification.studentUser.id), uiLanguage);
  }

  const { session, token } = createStudentSession({
    studentUserId: Number(verification.studentUser.id),
    email: verification.studentUser.email,
    displayName: verification.studentUser.display_name || verification.studentUser.email,
    provider: 'password',
  });
  issueStudentSession(req, res, token);
  res.json({
    ...session,
    token,
    student_user_id: Number(verification.studentUser.id),
    reset_completed: true,
  });
});

router.get('/student-auth/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sessionData = readStudentSession(req);
    if (!sessionData) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Not signed in' });
    }

    const studentUser = await getStudentUserById(Number(sessionData.studentUserId));
    if (!studentUser?.id || String(studentUser.status || 'active') !== 'active') {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }

    const uiLanguage = getRequestedUiLanguage(req);
    if (uiLanguage) {
      await updateStudentPreferredLanguage(Number(studentUser.id), uiLanguage);
    }

    const { session, token } = createStudentSession({
      studentUserId: Number(studentUser.id),
      email: studentUser.email,
      displayName: studentUser.display_name || sessionData.displayName || studentUser.email,
      provider: sessionData.provider === 'google' ? 'google' : 'password',
    });
    issueStudentSession(req, res, token);

    const claimedClasses = await listStudentClassWorkspaces(Number(studentUser.id), studentUser.email || '');
    res.json({
      ...session,
      token,
      student_user_id: Number(studentUser.id),
      preferred_language: String(studentUser.preferred_language || ''),
      claimed_classes_count: claimedClasses.filter((classRow: any) => String(classRow?.approval_state || 'none') === 'claimed').length,
    });
  } catch (error: any) {
    console.error('[student-auth/session] Failed to restore student session:', error);
    clearStudentSession(req, res);
    res.status(500).json({ error: 'Failed to restore student session.' });
  }
});

router.post('/student-auth/logout', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  clearStudentSession(req, res);
  res.json({ success: true });
});

router.get('/discover/packs', async (_req, res) => {
  console.log('[DEBUG] GET /api/discover/packs request received');
  try {
    const packs = (await listHydratedPacks({ publicOnly: true }));
    console.log(`[DEBUG] Found ${packs.length} public packs`);
    res.json(packs);
  } catch (error) {
    console.error('[ERROR] Discover packs failed:', error);
    res.status(500).json({ error: 'Failed to load discover packs' });
  }
});

// Get all packs
router.get('/packs', async (req, res) => {
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  const packs = teacherUserId
    ? (await listHydratedPacks({ teacherUserId }))
    : (await listHydratedPacks({ publicOnly: true }));
  res.json(packs);
});

router.get('/teacher/packs', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    const session = (req as any).teacherSession || readTeacherSession(req);
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    let packs = (await getTeacherPackBoard(teacherUserId));
    
    // Fallback: If the user has literally zero packs (e.g., an existing Google account created before auto-seeding),
    // we inject the demo packs so their dashboard is never empty and they have an example out of the box.
    if (packs.length === 0 && session?.email) {
      (await seedDemoDataForTeacher(teacherUserId, session.email));
      packs = (await getTeacherPackBoard(teacherUserId));
    }
    
    res.json(packs);
  } catch (error: any) {
    console.error('[ERROR] Teacher pack board failed:', error);
    respondWithServerError(res, 'Failed to load teacher packs');
  }
});

router.get('/teacher/packs/:id', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-pack-detail', 180, 5 * 60 * 1000, teacherUserId, req.params.id)) return;

    const packId = parsePositiveInt(req.params.id);
    const pack = (await getHydratedPackWithQuestions(packId, {
      teacherUserId,
      allowPublic: false,
    }));
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    res.json(pack);
  } catch (error: any) {
    console.error('[ERROR] Teacher pack detail failed:', error);
    respondWithServerError(res, 'Failed to load teacher pack');
  }
});

router.put('/teacher/packs/:id/visibility', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-pack-visibility', 60, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const packId = parsePositiveInt(req.params.id);
    const pack = (await getTeacherOwnedPack(packId, teacherUserId));
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const isPublic = sanitizeBooleanFlag(req.body?.is_public, false);
    (await db
        .prepare(`
        UPDATE quiz_packs
        SET is_public = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND teacher_id = ?
      `)
        .run(isPublic ? 1 : 0, packId, teacherUserId));

    const updatedPack = (await getTeacherPackBoard(teacherUserId)).find((entry: any) => Number(entry.id) === packId);
    res.json(updatedPack || { id: packId, is_public: isPublic ? 1 : 0 });
  } catch (error: any) {
    console.error('[ERROR] Pack visibility update failed:', error);
    respondWithServerError(res, 'Failed to update pack visibility');
  }
});

router.get('/teacher/classes', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-classes-list', 120, 5 * 60 * 1000, teacherUserId)) return;
    res.json((await listTeacherClasses(teacherUserId, { recentSessionLimit: 5 })));
  } catch (error: any) {
    console.error('[ERROR] Teacher classes failed:', error);
    respondWithServerError(res, 'Failed to load classes');
  }
});

router.get('/teacher/classes/:id', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-class-detail', 180, 5 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      ...classBoard,
      assignment_board: await buildTeacherAssignmentBoard(classBoard),
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class detail failed:', error);
    respondWithServerError(res, 'Failed to load class');
  }
});

router.post('/teacher/classes/:id/assignments', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'teacher-class-assignment-create', 120, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) return res.status(404).json({ error: 'Class not found' });
    const packId = Number(req.body?.pack_id || classBoard.pack?.id || 0);
    if (!packId) return res.status(400).json({ error: 'Assign a pack before creating class work.' });
    const pack = await getTeacherOwnedPack(packId, teacherUserId);
    if (!pack) return res.status(400).json({ error: 'Pack not found.' });

    const title = sanitizeAssignmentTitle(req.body?.title) || `${String(classBoard.name || 'Class').trim()} assignment`;
    const instructions = sanitizeAssignmentInstructions(req.body?.instructions);
    const questionGoal = sanitizeAssignmentQuestionGoal(req.body?.question_goal, Math.max(1, Math.min(Number(pack.question_count || 0) || 5, 10)));
    const dueAt = sanitizeAssignmentDueAt(req.body?.due_at);

    const archivedActive = await db
      .prepare(`
        UPDATE teacher_class_assignments
        SET status = 'archived', archived = 1, updated_at = CURRENT_TIMESTAMP
        WHERE class_id = ?
          AND COALESCE(archived, 0) = 0
          AND LOWER(COALESCE(status, 'active')) = 'active'
      `)
      .run(classId);

    await db
      .prepare(`
        INSERT INTO teacher_class_assignments (
          class_id, pack_id, title, instructions, due_at, question_goal, status, archived, created_by, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, CURRENT_TIMESTAMP)
      `)
      .run(classId, packId, title, instructions, dueAt, questionGoal, teacherUserId);

    const refreshedClass = await getHydratedTeacherClass(classId, teacherUserId);
    res.status(201).json({
      ...(refreshedClass || classBoard),
      assignment_board: await buildTeacherAssignmentBoard(refreshedClass || classBoard),
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class assignment create failed:', error);
    respondWithServerError(res, 'Failed to create class assignment');
  }
});

router.put('/teacher/classes/:classId/assignments/:assignmentId', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'teacher-class-assignment-update', 120, 10 * 60 * 1000, teacherUserId, req.params.classId, req.params.assignmentId)) return;

    const classId = parsePositiveInt(req.params.classId);
    const assignmentId = parsePositiveInt(req.params.assignmentId);
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) return res.status(404).json({ error: 'Class not found' });
    const assignment = await getTeacherClassAssignmentById(classId, assignmentId);
    if (!assignment?.id) return res.status(404).json({ error: 'Assignment not found' });

    const title = sanitizeAssignmentTitle(req.body?.title) || String(assignment.title || '');
    const instructions = sanitizeAssignmentInstructions(req.body?.instructions ?? assignment.instructions);
    const dueAt = sanitizeAssignmentDueAt(req.body?.due_at) ?? assignment.due_at ?? null;
    const questionGoal = sanitizeAssignmentQuestionGoal(req.body?.question_goal, Number(assignment.question_goal || 0) || 5);
    const status = String(req.body?.status || assignment.status || 'active').trim().toLowerCase() === 'completed' ? 'completed' : 'active';

    await db
      .prepare(`
        UPDATE teacher_class_assignments
        SET title = ?, instructions = ?, due_at = ?, question_goal = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND class_id = ?
      `)
      .run(title, instructions, dueAt, questionGoal, status, assignmentId, classId);

    const refreshedClass = await getHydratedTeacherClass(classId, teacherUserId);
    res.json({
      ...(refreshedClass || classBoard),
      assignment_board: await buildTeacherAssignmentBoard(refreshedClass || classBoard),
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class assignment update failed:', error);
    respondWithServerError(res, 'Failed to update class assignment');
  }
});

router.delete('/teacher/classes/:classId/assignments/:assignmentId', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'teacher-class-assignment-delete', 120, 10 * 60 * 1000, teacherUserId, req.params.classId, req.params.assignmentId)) return;
    const classId = parsePositiveInt(req.params.classId);
    const assignmentId = parsePositiveInt(req.params.assignmentId);
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) return res.status(404).json({ error: 'Class not found' });

    await db
      .prepare(`
        UPDATE teacher_class_assignments
        SET archived = 1, status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND class_id = ?
      `)
      .run(assignmentId, classId);

    const refreshedClass = await getHydratedTeacherClass(classId, teacherUserId);
    res.json({
      ...(refreshedClass || classBoard),
      assignment_board: await buildTeacherAssignmentBoard(refreshedClass || classBoard),
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class assignment delete failed:', error);
    respondWithServerError(res, 'Failed to archive class assignment');
  }
});

router.get('/teacher/classes/:id/progress', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(
      req,
      res,
      'teacher-class-progress',
      180,
      5 * 60 * 1000,
      teacherUserId,
      req.params.id,
      String(req.query?.student_id || ''),
      String(req.query?.compare_student_id || ''),
    )) return;

    const classId = parsePositiveInt(req.params.id);
    const selectedStudentId = parsePositiveInt(req.query?.student_id);
    const compareStudentIdRaw = parsePositiveInt(req.query?.compare_student_id);
    const compareStudentId =
      compareStudentIdRaw && Number(compareStudentIdRaw) !== Number(selectedStudentId || 0)
        ? compareStudentIdRaw
        : null;
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const rosterRows = (await db
      .prepare(`
        SELECT
          id,
          name,
          email,
          student_user_id,
          last_seen_at,
          created_at,
          updated_at
        FROM teacher_class_students
        WHERE class_id = ?
        ORDER BY LOWER(name) ASC, id ASC
      `)
      .all(classId)) as any[];

    const classSeriesRows = (await db
      .prepare(`
        SELECT
          s.id AS session_id,
          s.pin,
          s.status,
          s.started_at,
          s.ended_at,
          COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00') AS session_at,
          COALESCE(q.title, '') AS pack_title,
          COUNT(DISTINCT p.id) AS participant_count,
          COUNT(a.id) AS answer_count,
          AVG(
            CASE
              WHEN a.id IS NOT NULL THEN CASE WHEN COALESCE(a.is_correct, 0) = 1 THEN 100.0 ELSE 0.0 END
              ELSE NULL
            END
          ) AS accuracy_pct
        FROM sessions s
        LEFT JOIN quiz_packs q ON q.id = s.quiz_pack_id
        LEFT JOIN participants p ON p.session_id = s.id
        LEFT JOIN answers a ON a.participant_id = p.id
        WHERE s.teacher_class_id = ?
        GROUP BY s.id, q.title
        ORDER BY COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00') ASC, s.id ASC
      `)
      .all(classId)) as any[];

    const classSeries = classSeriesRows.map((row: any, index: number) => ({
      session_id: Number(row.session_id || 0),
      label: `S${index + 1}`,
      pin: String(row.pin || ''),
      status: String(row.status || ''),
      started_at: row.started_at || row.ended_at || row.session_at || null,
      ended_at: row.ended_at || null,
      pack_title: String(row.pack_title || ''),
      accuracy_pct: row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct),
      participant_count: Number(row.participant_count || 0),
      answer_count: Number(row.answer_count || 0),
    }));

    const sessionLabelById = new Map<number, string>(
      classSeries.map((row) => [Number(row.session_id || 0), String(row.label || '')] as const),
    );

    const participantRows = (await db
      .prepare(`
        SELECT
          s.id AS session_id,
          s.pin,
          s.status,
          s.started_at,
          s.ended_at,
          COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00') AS session_at,
          COALESCE(q.title, '') AS pack_title,
          p.id AS participant_id,
          p.nickname,
          p.class_student_id,
          p.student_user_id,
          COUNT(a.id) AS answer_count,
          AVG(
            CASE
              WHEN a.id IS NOT NULL THEN CASE WHEN COALESCE(a.is_correct, 0) = 1 THEN 100.0 ELSE 0.0 END
              ELSE NULL
            END
          ) AS accuracy_pct
        FROM sessions s
        JOIN participants p ON p.session_id = s.id
        LEFT JOIN quiz_packs q ON q.id = s.quiz_pack_id
        LEFT JOIN answers a ON a.participant_id = p.id
        WHERE s.teacher_class_id = ?
        GROUP BY s.id, q.title, p.id
        ORDER BY COALESCE(s.started_at, s.ended_at, '1970-01-01 00:00:00') ASC, s.id ASC, p.id ASC
      `)
      .all(classId)) as any[];

    const rosterById = new Map<number, any>();
    const rosterByStudentUserId = new Map<number, any>();
    const rosterByNormalizedName = new Map<string, any>();
    const rosterNameCounts = new Map<string, number>();
    rosterRows.forEach((row: any) => {
      const rosterId = Number(row.id || 0);
      if (rosterId > 0) {
        rosterById.set(rosterId, row);
      }
      const studentUserId = Number(row.student_user_id || 0);
      if (studentUserId > 0) {
        rosterByStudentUserId.set(studentUserId, row);
      }
      const normalizedName = normalizeRosterName(row.name);
      if (normalizedName) {
        rosterNameCounts.set(normalizedName, Number(rosterNameCounts.get(normalizedName) || 0) + 1);
      }
    });
    rosterRows.forEach((row: any) => {
      const normalizedName = normalizeRosterName(row.name);
      if (normalizedName && Number(rosterNameCounts.get(normalizedName) || 0) === 1) {
        rosterByNormalizedName.set(normalizedName, row);
      }
    });

    const resolveRosterRowForParticipant = (row: any) => {
      const normalizedNickname = normalizeRosterName(row.nickname);
      return (
        (Number(row.class_student_id || 0) > 0 ? rosterById.get(Number(row.class_student_id || 0)) : null) ||
        (Number(row.student_user_id || 0) > 0 ? rosterByStudentUserId.get(Number(row.student_user_id || 0)) : null) ||
        (normalizedNickname ? rosterByNormalizedName.get(normalizedNickname) : null) ||
        null
      );
    };

    const seriesByStudentId = new Map<number, any[]>();
    participantRows.forEach((row: any) => {
      const rosterRow = resolveRosterRowForParticipant(row);
      if (!rosterRow?.id) return;

      const rosterId = Number(rosterRow.id || 0);
      const existing = seriesByStudentId.get(rosterId) || [];
      existing.push({
        session_id: Number(row.session_id || 0),
        label: sessionLabelById.get(Number(row.session_id || 0)) || `S${existing.length + 1}`,
        pin: String(row.pin || ''),
        status: String(row.status || ''),
        started_at: row.started_at || row.ended_at || row.session_at || null,
        ended_at: row.ended_at || null,
        pack_title: String(row.pack_title || ''),
        accuracy_pct: row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct),
        answer_count: Number(row.answer_count || 0),
      });
      seriesByStudentId.set(rosterId, existing);
    });

    const answerTopicRows = (await db
      .prepare(`
        SELECT
          p.nickname,
          p.class_student_id,
          p.student_user_id,
          a.is_correct,
          q.tags_json
        FROM sessions s
        JOIN participants p ON p.session_id = s.id
        JOIN answers a ON a.participant_id = p.id
        LEFT JOIN questions q ON q.id = a.question_id
        WHERE s.teacher_class_id = ?
      `)
      .all(classId)) as any[];

    const classTopicTotals = new Map<string, { correct: number; total: number }>();
    const topicTotalsByStudentId = new Map<number, Map<string, { correct: number; total: number }>>();
    const trackTagStats = (bucket: Map<string, { correct: number; total: number }>, tag: string, isCorrect: boolean) => {
      const current = bucket.get(tag) || { correct: 0, total: 0 };
      current.total += 1;
      if (isCorrect) current.correct += 1;
      bucket.set(tag, current);
    };

    answerTopicRows.forEach((row: any) => {
      const tags = uniqueStrings(parseJsonArray(row.tags_json).map((tag) => sanitizeLine(tag, 40))).slice(0, 6);
      if (!tags.length) return;
      const isCorrect = Number(row.is_correct || 0) === 1;
      tags.forEach((tag) => trackTagStats(classTopicTotals, tag, isCorrect));

      const rosterRow = resolveRosterRowForParticipant(row);
      if (!rosterRow?.id) return;
      const rosterId = Number(rosterRow.id || 0);
      const existing = topicTotalsByStudentId.get(rosterId) || new Map<string, { correct: number; total: number }>();
      tags.forEach((tag) => trackTagStats(existing, tag, isCorrect));
      topicTotalsByStudentId.set(rosterId, existing);
    });

    const resolveBestAndWeakestTag = (bucket: Map<string, { correct: number; total: number }>) => {
      const rows = [...bucket.entries()]
        .map(([tag, stats]) => ({
          tag,
          total: Number(stats.total || 0),
          accuracy: stats.total ? (Number(stats.correct || 0) / Number(stats.total || 1)) * 100 : null,
        }))
        .filter((entry) => entry.total > 0 && entry.accuracy !== null);
      if (!rows.length) {
        return {
          weakestTag: null,
          strongestTag: null,
        };
      }

      const sortedForWeakest = [...rows].sort((left, right) => {
        const answerDelta = right.total - left.total;
        if (answerDelta !== 0) return answerDelta;
        return Number(left.accuracy || 0) - Number(right.accuracy || 0);
      });
      const sortedForStrongest = [...rows].sort((left, right) => {
        const answerDelta = right.total - left.total;
        if (answerDelta !== 0) return answerDelta;
        return Number(right.accuracy || 0) - Number(left.accuracy || 0);
      });

      return {
        weakestTag: sortedForWeakest[0]?.tag || null,
        strongestTag: sortedForStrongest[0]?.tag || null,
      };
    };

    const students = rosterRows
      .map((row: any) => {
        const rosterId = Number(row.id || 0);
        const history = [...(seriesByStudentId.get(rosterId) || [])].sort((left, right) => {
          const leftTs = new Date(left.ended_at || left.started_at || 0).getTime() || 0;
          const rightTs = new Date(right.ended_at || right.started_at || 0).getTime() || 0;
          return leftTs - rightTs;
        });
        const accuracyValues = history
          .map((entry) => (entry.accuracy_pct === null || entry.accuracy_pct === undefined ? null : Number(entry.accuracy_pct)))
          .filter((value): value is number => value !== null && Number.isFinite(value));
        const latest = history[history.length - 1] || null;
        const firstAccuracy = accuracyValues.length ? Number(accuracyValues[0]) : null;
        const latestAccuracy = accuracyValues.length ? Number(accuracyValues[accuracyValues.length - 1]) : null;
        const bestAccuracy = accuracyValues.length ? Math.max(...accuracyValues) : null;
        const topicStats = resolveBestAndWeakestTag(topicTotalsByStudentId.get(rosterId) || new Map());
        const lastActivityAt = maxIsoTimestamp([
          row.last_seen_at,
          latest?.ended_at,
          latest?.started_at,
          row.updated_at,
          row.created_at,
        ]);

        return {
          id: rosterId,
          name: String(row.name || 'Student'),
          email: String(row.email || ''),
          account_linked: Boolean(Number(row.student_user_id || 0)),
          session_count: history.length,
          avg_accuracy: accuracyValues.length
            ? Math.round(accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length)
            : null,
          latest_accuracy: latestAccuracy === null ? null : Math.round(latestAccuracy),
          best_accuracy: bestAccuracy === null ? null : Math.round(bestAccuracy),
          improvement_delta:
            firstAccuracy === null || latestAccuracy === null || accuracyValues.length < 2
              ? null
              : Math.round(latestAccuracy - firstAccuracy),
          weakest_tag: topicStats.weakestTag,
          strongest_tag: topicStats.strongestTag,
          last_activity_at: lastActivityAt,
        };
      })
      .sort((left, right) => {
        const sessionDelta = Number(right.session_count || 0) - Number(left.session_count || 0);
        if (sessionDelta !== 0) return sessionDelta;
        return String(left.name || '').localeCompare(String(right.name || ''));
      });

    const selectedSeries =
      selectedStudentId && seriesByStudentId.has(selectedStudentId)
        ? [...(seriesByStudentId.get(selectedStudentId) || [])].sort((left, right) => {
            const leftTs = new Date(left.ended_at || left.started_at || 0).getTime() || 0;
            const rightTs = new Date(right.ended_at || right.started_at || 0).getTime() || 0;
            return leftTs - rightTs;
          })
        : [];
    const compareSeries =
      compareStudentId && seriesByStudentId.has(compareStudentId)
        ? [...(seriesByStudentId.get(compareStudentId) || [])].sort((left, right) => {
            const leftTs = new Date(left.ended_at || left.started_at || 0).getTime() || 0;
            const rightTs = new Date(right.ended_at || right.started_at || 0).getTime() || 0;
            return leftTs - rightTs;
          })
        : [];

    const selectedTopicStats = selectedStudentId ? topicTotalsByStudentId.get(selectedStudentId) || new Map() : new Map();
    const compareTopicStats = compareStudentId ? topicTotalsByStudentId.get(compareStudentId) || new Map() : new Map();
    const topicSummary = [...classTopicTotals.entries()]
      .map(([tag, stats]) => {
        const selectedStats = selectedTopicStats.get(tag) || { correct: 0, total: 0 };
        const compareStats = compareTopicStats.get(tag) || { correct: 0, total: 0 };
        return {
          tag,
          class_accuracy: stats.total ? Math.round((stats.correct / stats.total) * 100) : null,
          class_answers: Number(stats.total || 0),
          selected_accuracy: selectedStats.total ? Math.round((selectedStats.correct / selectedStats.total) * 100) : null,
          selected_answers: Number(selectedStats.total || 0),
          compare_accuracy: compareStats.total ? Math.round((compareStats.correct / compareStats.total) * 100) : null,
          compare_answers: Number(compareStats.total || 0),
        };
      })
      .sort((left, right) => {
        const answerDelta = Number(right.class_answers || 0) - Number(left.class_answers || 0);
        if (answerDelta !== 0) return answerDelta;
        return String(left.tag || '').localeCompare(String(right.tag || ''));
      })
      .slice(0, 8);

    res.json({
      class_id: classBoard.id,
      class_name: classBoard.name,
      class_series: classSeries,
      students,
      selected_student_id: selectedStudentId || null,
      compare_student_id: compareStudentId || null,
      selected_student_series: selectedSeries,
      compare_student_series: compareSeries,
      topic_summary: topicSummary,
      recommended_actions: [],
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class progress failed:', error);
    respondWithServerError(res, 'Failed to load class progress');
  }
});

router.get('/teacher/classes/:id/packs', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = await getTeacherUserIdFromRequest(req);
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-class-packs-detail', 180, 5 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json({
      class_id: classBoard.id,
      pack_id: classBoard.pack_id,
      pack: classBoard.pack,
      packs: Array.isArray(classBoard.packs) ? classBoard.packs : [],
      linked_pack_count: Array.isArray(classBoard.packs) ? classBoard.packs.length : 0,
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher class packs failed:', error);
    respondWithServerError(res, 'Failed to load class packs');
  }
});

router.post('/teacher/classes', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-classes-create', 60, 10 * 60 * 1000, teacherUserId)) return;

    const payload = sanitizeTeacherClassPayload(req.body);
    if (!payload.name || !payload.subject || !payload.grade) {
      return res.status(400).json({ error: 'Class name, subject, and grade are required.' });
    }

    const packId = Number(payload.pack_id || 0);
    if (packId) {
      const pack = (await getTeacherOwnedPack(packId, teacherUserId));
      if (!pack) {
        return res.status(400).json({ error: 'Assigned pack was not found.' });
      }
    }

    const studentRoster = Array.isArray(req.body?.students)
      ? req.body.students
          .map((student: any) => {
            const name = sanitizeTeacherStudentName(student?.name ?? student);
            const email = sanitizeStudentEmailInput(student?.email);
            return { name, email };
          })
          .filter((student: any) => Boolean(student.name))
          .slice(0, 120)
      : [];
    const invalidRosterEmail = studentRoster.find((student: any) => student.email && validateStudentEmail(student.email));
    if (invalidRosterEmail?.email) {
      return res.status(400).json({ error: validateStudentEmail(invalidRosterEmail.email) });
    }
    const rosterEmails = uniqueStrings(studentRoster.map((student: any) => student.email).filter(Boolean));
    const existingStudentUsers = rosterEmails.length
      ? ((await db
            .prepare(`
              SELECT id, email
              FROM student_users
              WHERE LOWER(email) IN (${buildSqlPlaceholders(rosterEmails.length)})
            `)
            .all(...rosterEmails)) as any[])
      : [];
    const linkedStudentByEmail = new Map(
      existingStudentUsers.map((student: any) => [normalizeStudentEmail(student.email), Number(student.id)] as const),
    );

    const insertTeacherClass = db.transaction((input: typeof payload, roster: Array<{ name: string; email: string }>) => {
      const info = db
        .prepare(`
          INSERT INTO teacher_classes (teacher_id, name, subject, grade, color, notes, pack_id, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `)
        .run(
          teacherUserId,
          input.name,
          input.subject,
          input.grade,
          input.color,
          input.notes,
          input.pack_id || null,
        );

      const classId = Number(info.lastInsertRowid);

      if (input.pack_id) {
        db.prepare(`
          INSERT INTO teacher_class_packs (class_id, pack_id)
          VALUES (?, ?)
        `).run(classId, input.pack_id);
      }
      const insertStudent = db.prepare(`
        INSERT INTO teacher_class_students (
          class_id,
          name,
          email,
          student_user_id,
          invite_status,
          invite_sent_at,
          invite_delivery_status,
          invite_last_error,
          claimed_at,
          last_seen_at,
          joined_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      roster.forEach((student) => {
        const linkedStudentId = student.email ? linkedStudentByEmail.get(normalizeStudentEmail(student.email)) || null : null;
        insertStudent.run(
          classId,
          student.name,
          student.email || '',
          linkedStudentId,
          student.email ? 'invited' : 'none',
          null,
          student.email ? 'none' : 'none',
          '',
          null,
          null,
        );
      });

      return classId;
    });

    const classId = insertTeacherClass(payload, studentRoster);
    const createdClass = await getHydratedTeacherClass(classId, teacherUserId);
    if (!createdClass) {
      return res.status(500).json({ error: 'Class was created, but the board could not be loaded again.' });
    }

    await sendClassInvitesForBoard({
      teacherUserId,
      classBoard: createdClass,
      baseUrl: resolvePublicAppUrlFromRequest(req),
    });

    res.status(201).json((await getHydratedTeacherClass(classId, teacherUserId)) || createdClass);
  } catch (error: any) {
    console.error('[ERROR] Create teacher class failed:', error);
    respondWithServerError(res, 'Failed to create class');
  }
});

router.put('/teacher/classes/:id', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-classes-update', 120, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const existingClass = (await getTeacherOwnedClass(classId, teacherUserId));
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const payload = sanitizeTeacherClassPayload(req.body);
    if (!payload.name || !payload.subject || !payload.grade) {
      return res.status(400).json({ error: 'Class name, subject, and grade are required.' });
    }

    const packId = Number(payload.pack_id || 0);
    if (packId) {
      const pack = (await getTeacherOwnedPack(packId, teacherUserId));
      if (!pack) {
        return res.status(400).json({ error: 'Assigned pack was not found.' });
      }
    }

    (await db
        .prepare(`
        UPDATE teacher_classes
        SET name = ?, subject = ?, grade = ?, color = ?, notes = ?, pack_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND teacher_id = ?
      `)
        .run(
          payload.name,
          payload.subject,
          payload.grade,
          payload.color,
          payload.notes,
          payload.pack_id || null,
          classId,
          teacherUserId,
        ));

    res.json((await getHydratedTeacherClass(classId, teacherUserId)));
  } catch (error: any) {
    console.error('[ERROR] Update teacher class failed:', error);
    respondWithServerError(res, 'Failed to update class');
  }
});

router.delete('/teacher/classes/:id', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-classes-delete', 60, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const existingClass = (await getTeacherOwnedClass(classId, teacherUserId));
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const activeSession = (await db
        .prepare(`
        SELECT id
        FROM sessions
        WHERE teacher_class_id = ?
          AND UPPER(COALESCE(status, '')) <> 'ENDED'
        LIMIT 1
      `)
        .get(classId)) as any;
    if (activeSession?.id) {
      return res.status(409).json({ error: 'End the active class session before removing this class.' });
    }

    (await db
        .prepare(`
        UPDATE teacher_classes
        SET archived = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND teacher_id = ?
      `)
        .run(classId, teacherUserId));

    res.json({ success: true });
  } catch (error: any) {
    console.error('[ERROR] Delete teacher class failed:', error);
    respondWithServerError(res, 'Failed to remove class');
  }
});

router.post('/teacher/classes/:id/students', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-class-student-create', 180, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const classId = parsePositiveInt(req.params.id);
    const existingClass = (await getTeacherOwnedClass(classId, teacherUserId));
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const providedStudentName = sanitizeTeacherStudentName(req.body?.name);
    const studentEmail = sanitizeStudentEmailInput(req.body?.email);
    const studentName = providedStudentName || (studentEmail ? deriveStudentNameFromEmail(studentEmail) : '');
    if (!studentName && !studentEmail) {
      return res.status(400).json({ error: 'Student name or email is required.' });
    }
    if (studentEmail) {
      const emailError = validateStudentEmail(studentEmail);
      if (emailError) {
        return res.status(400).json({ error: emailError });
      }
    }

    const linkedStudent = studentEmail ? await getStudentUserByEmail(studentEmail) : null;

    const insertResult = (await db
        .prepare(`
        INSERT INTO teacher_class_students (
          class_id,
          name,
          email,
          student_user_id,
          invite_status,
          invite_sent_at,
          invite_delivery_status,
          invite_last_error,
          claimed_at,
          last_seen_at,
          joined_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
        .run(
          classId,
          studentName,
          studentEmail || '',
          linkedStudent?.id ? Number(linkedStudent.id) : null,
          studentEmail ? 'invited' : 'none',
          null,
          studentEmail ? 'none' : 'none',
          '',
          null,
          null,
        )) as any;
    (await db
        .prepare('UPDATE teacher_classes SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND teacher_id = ?')
        .run(classId, teacherUserId));

    const addedStudentId = Number(insertResult?.lastInsertRowid || 0) || null;
    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) {
      return res.status(500).json({ error: 'Student was added, but the class could not be reloaded.' });
    }

    await sendClassInvitesForBoard({
      teacherUserId,
      classBoard,
      rosterStudentIds: addedStudentId ? [addedStudentId] : null,
      baseUrl: resolvePublicAppUrlFromRequest(req),
    });

    res.status(201).json((await getHydratedTeacherClass(classId, teacherUserId)) || classBoard);
  } catch (error: any) {
    console.error('[ERROR] Add class student failed:', error);
    respondWithServerError(res, 'Failed to add student');
  }
});

router.post('/teacher/classes/:classId/students/:studentId/resend-invite', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-class-student-resend-invite', 120, 10 * 60 * 1000, teacherUserId, req.params.classId, req.params.studentId)) return;

    const classId = parsePositiveInt(req.params.classId);
    const studentId = parsePositiveInt(req.params.studentId);
    const existingClass = await getTeacherOwnedClass(classId, teacherUserId);
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const existingStudent = await getTeacherOwnedStudent(studentId, classId, teacherUserId);
    if (!existingStudent?.id) {
      return res.status(404).json({ error: 'Student not found in this class.' });
    }

    const email = sanitizeStudentEmailInput(existingStudent.email);
    if (!email) {
      return res.status(400).json({ error: 'Add an email address before sending an invite.' });
    }

    const classBoard = await getHydratedTeacherClass(classId, teacherUserId);
    if (!classBoard) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const delivery = await sendClassInviteForRosterStudent({
      teacherUserId,
      classBoard,
      studentRow: existingStudent,
      baseUrl: resolvePublicAppUrlFromRequest(req),
    });

    res.json({
      board: (await getHydratedTeacherClass(classId, teacherUserId)) || classBoard,
      delivery,
    });
  } catch (error: any) {
    console.error('[ERROR] Resend class invite failed:', error);
    respondWithServerError(res, 'Failed to resend class invite');
  }
});

router.delete('/teacher/classes/:classId/students/:studentId', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(
      req,
      res,
      'teacher-class-student-delete',
      180,
      10 * 60 * 1000,
      teacherUserId,
      req.params.classId,
      req.params.studentId,
    )) return;

    const classId = parsePositiveInt(req.params.classId);
    const studentId = parsePositiveInt(req.params.studentId);
    const existingClass = (await getTeacherOwnedClass(classId, teacherUserId));
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }
    const student = (await getTeacherOwnedStudent(studentId, classId, teacherUserId));
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    (await db.prepare('DELETE FROM teacher_class_students WHERE id = ? AND class_id = ?').run(studentId, classId));
    (await db
        .prepare('UPDATE teacher_classes SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND teacher_id = ?')
        .run(classId, teacherUserId));

    res.json((await getHydratedTeacherClass(classId, teacherUserId)));
  } catch (error: any) {
    console.error('[ERROR] Remove class student failed:', error);
    respondWithServerError(res, 'Failed to remove student');
  }
});

router.post('/teacher/classes/:id/packs', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }

    const classId = parsePositiveInt(req.params.id);
    const packId = parsePositiveInt(req.body?.packId || req.body?.pack_id);
    if (!classId || !packId) {
      return res.status(400).json({ error: 'Class ID and Pack ID are required.' });
    }

    const existingClass = await getTeacherOwnedClass(classId, teacherUserId);
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    db.prepare(`
      INSERT OR IGNORE INTO teacher_class_packs (class_id, pack_id)
      VALUES (?, ?)
    `).run(classId, packId);

    db.prepare(`
      UPDATE teacher_classes
      SET pack_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(packId, classId);

    res.json((await getHydratedTeacherClass(classId, teacherUserId)));
  } catch (error: any) {
    console.error('[ERROR] Link pack to class failed:', error);
    respondWithServerError(res, 'Failed to add quiz to class');
  }
});

router.delete('/teacher/classes/:id/packs/:packId', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }

    const classId = parsePositiveInt(req.params.id);
    const packId = parsePositiveInt(req.params.packId);
    if (!classId || !packId) {
      return res.status(400).json({ error: 'Class ID and Pack ID are required.' });
    }

    const existingClass = await getTeacherOwnedClass(classId, teacherUserId);
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    db.prepare(`
      DELETE FROM teacher_class_packs
      WHERE class_id = ? AND pack_id = ?
    `).run(classId, packId);

    const fallbackPack = (await db.prepare(`
      SELECT pack_id
      FROM teacher_class_packs
      WHERE class_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(classId)) as any;

    if (Number(existingClass.pack_id || 0) === packId) {
      db.prepare(`
        UPDATE teacher_classes
        SET pack_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(Number(fallbackPack?.pack_id || 0) || null, classId);
    } else {
      db.prepare('UPDATE teacher_classes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(classId);
    }

    res.json((await getHydratedTeacherClass(classId, teacherUserId)));
  } catch (error: any) {
    console.error('[ERROR] Unlink pack from class failed:', error);
    respondWithServerError(res, 'Failed to remove quiz from class');
  }
});

// Get a specific pack with questions
router.get('/packs/:id', async (req, res) => {
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  const pack = (await getHydratedPackWithQuestions(Number(req.params.id), {
    teacherUserId: teacherUserId || null,
    allowPublic: true,
  }));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json(pack);
});

router.get('/teacher/question-bank', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-question-bank', 120, 5 * 60 * 1000, teacherUserId)) return;

    const query = sanitizeLine(req.query?.q, 80).toLowerCase();
    const limit = clampNumber(req.query?.limit, 4, 30, 10);
    const filters: string[] = ['qp.teacher_id = ?'];
    const params: Array<string | number> = [teacherUserId];

    if (query) {
      filters.push(`(
        LOWER(COALESCE(q.prompt, '')) LIKE ?
        OR LOWER(COALESCE(q.learning_objective, '')) LIKE ?
        OR LOWER(COALESCE(q.bloom_level, '')) LIKE ?
        OR LOWER(COALESCE(qp.title, '')) LIKE ?
        OR LOWER(COALESCE(qp.course_code, '')) LIKE ?
        OR LOWER(COALESCE(q.tags_json, '')) LIKE ?
      )`);
      const token = `%${query}%`;
      params.push(token, token, token, token, token, token);
    }

    params.push(limit);

    const rows = (await db
          .prepare(`
        SELECT
          q.id,
          q.quiz_pack_id,
          q.prompt,
          q.image_url,
          q.answers_json,
          q.correct_index,
          q.explanation,
          q.tags_json,
          q.time_limit_seconds,
          q.learning_objective,
          q.bloom_level,
          qp.title AS pack_title,
          qp.course_code,
          qp.course_name,
          qp.section_name,
          qp.academic_term,
          (
            SELECT COUNT(*)
            FROM answers a
            WHERE a.question_id = q.id
          ) AS usage_count,
          (
            SELECT AVG(CASE WHEN a.is_correct = 1 THEN 100.0 ELSE 0 END)
            FROM answers a
            WHERE a.question_id = q.id
          ) AS accuracy
        FROM questions q
        JOIN quiz_packs qp ON qp.id = q.quiz_pack_id
        WHERE ${filters.join(' AND ')}
        ORDER BY
          COALESCE((
            SELECT COUNT(*)
            FROM answers a
            WHERE a.question_id = q.id
          ), 0) DESC,
          q.id DESC
        LIMIT ?
      `)
          .all(...params));

    res.json(
      rows.map((row: any) => ({
        id: Number(row.id),
        quiz_pack_id: Number(row.quiz_pack_id),
        prompt: row.prompt,
        image_url: row.image_url || '',
        answers: parseJsonArray(row.answers_json),
        correct_index: Number(row.correct_index || 0),
        explanation: row.explanation || '',
        tags: parseJsonArray(row.tags_json),
        time_limit_seconds: Number(row.time_limit_seconds || 20),
        learning_objective: row.learning_objective || '',
        bloom_level: row.bloom_level || '',
        pack_title: row.pack_title,
        course_code: row.course_code || '',
        course_name: row.course_name || '',
        section_name: row.section_name || '',
        academic_term: row.academic_term || '',
        usage_count: Number(row.usage_count || 0),
        accuracy: Number(row.accuracy || 0),
      })),
    );
  } catch (error: any) {
    console.error('[ERROR] Question bank failed:', error);
    respondWithServerError(res, 'Failed to load question bank');
  }
});

router.get('/teacher/packs/:id/versions', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    const packId = parsePositiveInt(req.params.id);
    const pack = (await getTeacherOwnedPack(packId, teacherUserId));
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    res.json({ versions: (await getPackVersions(packId)) });
  } catch (error: any) {
    console.error('[ERROR] Pack versions failed:', error);
    respondWithServerError(res, 'Failed to load versions');
  }
});

router.post('/teacher/packs/:id/versions', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-pack-version-create', 40, 10 * 60 * 1000, teacherUserId, req.params.id)) return;
    const packId = parsePositiveInt(req.params.id);
    const pack = (await getTeacherOwnedPack(packId, teacherUserId));
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    const version = (await createPackVersionSnapshot(
          packId,
          teacherUserId,
          sanitizeLine(req.body?.version_label, 80) || '',
          'manual_snapshot',
        ));
    res.status(201).json({ version });
  } catch (error: any) {
    console.error('[ERROR] Pack snapshot failed:', error);
    respondWithServerError(res, 'Failed to create snapshot');
  }
});

router.post('/teacher/packs/:id/versions/:versionId/restore', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-pack-version-restore', 20, 10 * 60 * 1000, teacherUserId, req.params.id, req.params.versionId)) return;
    const packId = parsePositiveInt(req.params.id);
    const versionId = parsePositiveInt(req.params.versionId);
    const pack = (await getTeacherOwnedPack(packId, teacherUserId));
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    const version = (await db
          .prepare('SELECT * FROM quiz_pack_versions WHERE id = ? AND pack_id = ? AND teacher_id = ?')
          .get(versionId, packId, teacherUserId)) as any;
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const snapshot = parseJsonObject(version.snapshot_json) as any;
    if (!snapshot?.pack || !Array.isArray(snapshot?.questions)) {
      return res.status(400).json({ error: 'Snapshot is not valid' });
    }

    const restoredTitle = (await buildPackCopyTitle(
          teacherUserId,
          `${snapshot.pack.title || pack.title} (${version.version_label || `V${version.version_number}`})`,
        ));
    const restoredPackId = (await createPackFromSnapshot(snapshot, teacherUserId, restoredTitle, 'restore'));
    const restoredPack = (await getTeacherPackBoard(teacherUserId)).find((entry: any) => Number(entry.id) === restoredPackId);
    res.status(201).json(restoredPack || { id: restoredPackId, title: restoredTitle });
  } catch (error: any) {
    console.error('[ERROR] Restore pack version failed:', error);
    respondWithServerError(res, 'Failed to restore version');
  }
});

router.post('/teacher/packs/:id/duplicate', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-duplicate', 30, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

  const packId = parsePositiveInt(req.params.id);
  const pack = (await getTeacherOwnedPack(packId, teacherUserId));
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  const questions = (await db
      .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
      .all(packId)) as any[];
  const copyTitle = (await buildPackCopyTitle(teacherUserId, pack.title));

  const duplicatePackInternal = db.transaction(() => {
    const packResult = db.prepare(`
      INSERT INTO quiz_packs (
        teacher_id,
        title,
        source_text,
        course_code,
        course_name,
        section_name,
        academic_term,
        week_label,
        learning_objectives_json,
        bloom_levels_json,
        pack_notes,
        source_hash,
        source_excerpt,
        source_language,
        source_word_count,
        material_profile_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
          teacherUserId,
          copyTitle,
          pack.source_text,
          pack.course_code || '',
          pack.course_name || '',
          pack.section_name || '',
          pack.academic_term || '',
          pack.week_label || '',
          pack.learning_objectives_json || '[]',
          pack.bloom_levels_json || '[]',
          pack.pack_notes || '',
          pack.source_hash,
          pack.source_excerpt,
          pack.source_language,
          pack.source_word_count,
          pack.material_profile_id,
        );

    const newPackId = Number(packResult.lastInsertRowid);
    const insertQuestion = db.prepare(`
      INSERT INTO questions (
        quiz_pack_id,
        type,
        prompt,
        image_url,
        answers_json,
        correct_index,
        explanation,
        tags_json,
        difficulty,
        time_limit_seconds,
        question_order,
        learning_objective,
        bloom_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    questions.forEach((question: any, index: number) => {
      insertQuestion.run(
        newPackId,
        question.type || 'multiple_choice',
        question.prompt,
        question.image_url || '',
        question.answers_json,
        question.correct_index,
        question.explanation,
        question.tags_json,
        question.difficulty || 3,
        question.time_limit_seconds || 20,
        Number(question.question_order || index),
        question.learning_objective || '',
        question.bloom_level || '',
      );
    });

    return newPackId;
  });

  const newPackId = duplicatePackInternal();
  await syncPackDerivedData(newPackId, pack.source_text || '', questions.map((question: any, index: number) => ({
    prompt: question.prompt,
    image_url: question.image_url || '',
    answers: parseJsonArray(question.answers_json),
    correct_index: Number(question.correct_index || 0),
    explanation: question.explanation,
    tags: parseJsonArray(question.tags_json),
    time_limit_seconds: Number(question.time_limit_seconds || 20),
    question_order: Number(question.question_order || index),
    learning_objective: question.learning_objective || '',
    bloom_level: question.bloom_level || '',
  })));
  await createPackVersionSnapshot(newPackId, teacherUserId, 'Initial version', 'duplicate');

  const duplicatedPack = (await getTeacherPackBoard(teacherUserId)).find((entry: any) => Number(entry.id) === newPackId);
  res.status(201).json(duplicatedPack);
});

router.delete('/teacher/packs/:id', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-delete', 20, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

  const packId = parsePositiveInt(req.params.id);
  const pack = (await getTeacherOwnedPack(packId, teacherUserId));
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  const sessions = (await db.prepare('SELECT id, status FROM sessions WHERE quiz_pack_id = ?').all(packId)) as any[];
  const activeSessions = sessions.filter((session: any) => String(session.status || '').toUpperCase() !== 'ENDED');
  if (activeSessions.length > 0) {
    return res.status(409).json({ error: 'End the active live session before deleting this pack.' });
  }

  const sessionIds = uniqueNumbers(sessions.map((session: any) => session.id));
  const participantIds = sessionIds.length
    ? uniqueNumbers(
        (await db
                  .prepare(`SELECT id FROM participants WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
                  .all(...sessionIds))
          .map((row: any) => row.id),
      )
    : [];
  const questionIds = uniqueNumbers(
    (await db.prepare('SELECT id FROM questions WHERE quiz_pack_id = ?').all(packId)).map((row: any) => row.id),
  );

  const impact = {
    sessions: sessionIds.length,
    participants: participantIds.length,
    questions: questionIds.length,
    answers: sessionIds.length
      ? Number(
          (await db
                      .prepare(`SELECT COUNT(*) as count FROM answers WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
                      .get(...sessionIds))?.count || 0,
        )
      : 0,
    behavior_logs: sessionIds.length
      ? Number(
          (await db
                      .prepare(`SELECT COUNT(*) as count FROM student_behavior_logs WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
                      .get(...sessionIds))?.count || 0,
        )
      : 0,
    practice_attempts: questionIds.length
      ? Number(
          (await db
                      .prepare(`SELECT COUNT(*) as count FROM practice_attempts WHERE question_id IN (${questionIds.map(() => '?').join(', ')})`)
                      .get(...questionIds))?.count || 0,
        )
      : 0,
  };

  const deletePackCascadeResult = db.transaction(() => {
    db.prepare('DELETE FROM quiz_pack_versions WHERE pack_id = ?').run(packId);
    db
        .prepare(`
        UPDATE teacher_classes
        SET pack_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE teacher_id = ? AND pack_id = ?
      `)
        .run(teacherUserId, packId);

    if (sessionIds.length) {
      const sessionPlaceholders = sessionIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM student_behavior_logs WHERE session_id IN (${sessionPlaceholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM answers WHERE session_id IN (${sessionPlaceholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM participants WHERE session_id IN (${sessionPlaceholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM sessions WHERE id IN (${sessionPlaceholders})`).run(...sessionIds);
    }

    if (questionIds.length) {
      const questionPlaceholders = questionIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM practice_attempts WHERE question_id IN (${questionPlaceholders})`).run(...questionIds);
      db.prepare(`DELETE FROM questions WHERE id IN (${questionPlaceholders})`).run(...questionIds);
    }

    db.prepare('DELETE FROM quiz_packs WHERE id = ?').run(packId);
  });

  deletePackCascadeResult();
  res.json({
    deleted: true,
    pack_id: packId,
    title: pack.title,
    impact,
  });
});

// Extract text from files
router.post('/extract-text', requireTeacherSession, (req, res, next) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-extract-text', 20, 10 * 60 * 1000)) return;
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    let text = '';
    const mimetype = req.file.mimetype;

    if (mimetype === 'application/pdf') {
      const data = await pdf(req.file.buffer);
      text = data.text;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const data = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = data.value;
    } else if (mimetype === 'text/plain' || mimetype === 'text/markdown') {
      text = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type: ' + mimetype });
    }

    const materialProfile = text ? (await getOrCreateMaterialProfile(text)) : null;
    res.json({
      text,
      material_profile: materialProfile
        ? {
            id: Number(materialProfile.id),
            source_language: materialProfile.source_language,
            source_excerpt: materialProfile.source_excerpt,
            teaching_brief: materialProfile.teaching_brief,
            key_points: materialProfile.key_points,
            topic_fingerprint: materialProfile.topic_fingerprint,
            estimated_original_tokens: materialProfile.estimated_original_tokens,
            estimated_prompt_tokens: materialProfile.estimated_prompt_tokens,
          }
        : null,
    });
  } catch (error: any) {
    console.error('[ERROR] Extraction failed:', error);
    res.status(500).json({ error: 'Failed to extract text from file: ' + error.message });
  }
});

// Generate questions from text using the configured AI provider
router.post('/packs/generate', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-generate', 20, 10 * 60 * 1000, teacherUserId)) return;
  const generationRequest = readQuestionGenerationRequestBody(req.body);

  console.log(`[AI GEN] Request: ${generationRequest.count} questions, ${generationRequest.difficulty} difficulty, ${generationRequest.language} language, text length: ${generationRequest.sourceText?.length}`);

  if (!generationRequest.sourceText) return res.status(400).json({ error: 'Source text is required' });

  try {
    const generationKey = buildQuestionGenerationInFlightKey({
      mode: 'generate',
      ...generationRequest,
    });

    const responsePayload = await runInFlightQuestionGeneration(generationKey, async () =>
      generateQuestionsFromSource(generationRequest));

    res.json(responsePayload);
  } catch (error: any) {
    console.error('[ERROR] Generate Route Crash:', error);
    const message = String(error?.message || '').trim();
    if (/saturated|quota|resource_exhausted|rate limit|429/i.test(message)) {
      res.status(503).json({ error: 'AI generation is busy right now. Try again in a moment.' });
      return;
    }
    if (/not configured|no configured ai model providers|api key/i.test(message)) {
      res.status(503).json({ error: 'The AI provider is not configured correctly on the server yet.' });
      return;
    }
    if (/language contract|invalid json|unusable payload|parser\/runtime detail/i.test(message)) {
      res.status(502).json({
        error: 'The AI returned an unstable response. Try fewer questions, slightly shorter material, or run generation again.',
      });
      return;
    }
    respondWithServerError(res, message || 'Failed to generate questions');
  }
});

router.post('/packs/improve-questions', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-improve', 20, 10 * 60 * 1000, teacherUserId)) return;
  const generationRequest = readQuestionGenerationRequestBody(req.body);

  if (!generationRequest.sourceText) return res.status(400).json({ error: 'Source text is required' });
  if (!generationRequest.existingQuestions.length) return res.status(400).json({ error: 'existing_questions is required' });

  try {
    const generationKey = buildQuestionGenerationInFlightKey({
      mode: 'improve',
      ...generationRequest,
      count: Math.min(20, Math.max(1, parsePositiveInt(req.body?.count, generationRequest.existingQuestions.length || generationRequest.count || 5))),
    });

    const payload = await runInFlightQuestionGeneration(generationKey, async () =>
      improveQuestionsFromSource({
        ...generationRequest,
        count: Math.min(20, Math.max(1, parsePositiveInt(req.body?.count, generationRequest.existingQuestions.length || generationRequest.count || 5))),
        existingQuestions: generationRequest.existingQuestions,
      }));
    res.json(payload);
  } catch (error: any) {
    console.error('[ERROR] Improve questions route crash:', error);
    const message = String(error?.message || '').trim();
    if (/saturated|quota|resource_exhausted|rate limit|429/i.test(message)) {
      res.status(503).json({ error: 'AI generation is busy right now. Try again in a moment.' });
      return;
    }
    if (/not configured|no configured ai model providers|api key/i.test(message)) {
      res.status(503).json({ error: 'The AI provider is not configured correctly on the server yet.' });
      return;
    }
    if (/language contract|invalid json|unusable payload|parser\/runtime detail/i.test(message)) {
      res.status(502).json({
        error: 'The AI returned an unstable response while improving the questions. Try again or reduce the request size.',
      });
      return;
    }
    respondWithServerError(res, message || 'Failed to improve questions');
  }
});

// Create a new pack
router.post('/packs', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-create', 30, 10 * 60 * 1000, teacherUserId)) return;
  const payload = (await preparePackWritePayload(req.body));
  if (!payload.title) {
    return res.status(400).json({ error: 'Pack title is required' });
  }
  if (payload.normalizedQuestions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  const createdPack = (await createTeacherPackFromPreparedPayload(teacherUserId, payload, {
    sourceLabel: 'create',
    versionLabel: 'Initial version',
  }));

  res.json({
    id: createdPack.packId,
    title: createdPack.title,
    question_count: createdPack.questionCount,
    is_public: createdPack.isPublic ? 1 : 0,
  });
});

router.put('/teacher/packs/:id', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-update', 40, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

  const packId = parsePositiveInt(req.params.id);
  const pack = (await getTeacherOwnedPack(packId, teacherUserId));
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  const activeSessionCount = Number(
    (await db
          .prepare(`
        SELECT COUNT(*) as count
        FROM sessions
        WHERE quiz_pack_id = ?
          AND UPPER(COALESCE(status, '')) <> 'ENDED'
      `)
          .get(packId))?.count || 0,
  );
  if (activeSessionCount > 0) {
    return res.status(409).json({ error: 'End the active live session before editing this pack.' });
  }

  const payload = (await preparePackWritePayload(req.body));
  if (!payload.title) {
    return res.status(400).json({ error: 'Pack title is required' });
  }
  if (payload.normalizedQuestions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  if (await packHasHistoricalUsage(packId)) {
    const revisionTitle = (await buildPackRevisionTitle(teacherUserId, payload.title));
    const revisedPack = (await createTeacherPackFromPreparedPayload(teacherUserId, payload, {
      sourceLabel: 'edit_revision',
      versionLabel: 'Edited revision',
      titleOverride: revisionTitle,
    }));
    const hydratedRevision = (await getTeacherPackBoard(teacherUserId)).find((entry: any) => Number(entry.id) === revisedPack.packId);
    return res.status(201).json({
      ...(hydratedRevision || {
        id: revisedPack.packId,
        title: revisedPack.title,
        question_count: revisedPack.questionCount,
        is_public: revisedPack.isPublic ? 1 : 0,
      }),
      edit_mode: 'copy',
      source_pack_id: packId,
      saved_as_new_revision: true,
    });
  }

  const replacePackInternal = db.transaction(() => {
    db.prepare(`
      UPDATE quiz_packs
      SET
        title = ?,
        source_text = ?,
        course_code = ?,
        course_name = ?,
        section_name = ?,
        academic_term = ?,
        week_label = ?,
        learning_objectives_json = ?,
        bloom_levels_json = ?,
        pack_notes = ?,
        generation_contract = ?,
        generation_provider = ?,
        generation_model = ?,
        is_public = ?,
        source_hash = ?,
        source_excerpt = ?,
        source_language = ?,
        source_word_count = ?,
        material_profile_id = ?
      WHERE id = ? AND teacher_id = ?
    `).run(
      payload.title,
      payload.sourceText,
      payload.academicMeta.course_code,
      payload.academicMeta.course_name,
      payload.academicMeta.section_name,
      payload.academicMeta.academic_term,
      payload.academicMeta.week_label,
      JSON.stringify(payload.academicMeta.learning_objectives),
      JSON.stringify(payload.academicMeta.bloom_levels),
      payload.academicMeta.pack_notes,
      payload.generationMeta.contract_version,
      payload.generationMeta.provider,
      payload.generationMeta.model,
      payload.isPublic ? 1 : 0,
      payload.materialProfile.source_hash,
      payload.materialProfile.source_excerpt,
      payload.sourceLanguage || payload.materialProfile.source_language,
      payload.materialProfile.word_count,
      payload.materialProfile.id,
      packId,
      teacherUserId,
    );

    db.prepare('DELETE FROM questions WHERE quiz_pack_id = ?').run(packId);
    insertQuestionsForPack(packId, payload.normalizedQuestions);
  });

  replacePackInternal();
  (await syncPackDerivedData(packId, payload.sourceText || '', payload.normalizedQuestions, payload.sourceLanguage));
  (await createPackVersionSnapshot(packId, teacherUserId, 'Edited version', 'edit'));

  const updatedPack = (await getTeacherPackBoard(teacherUserId)).find((entry: any) => Number(entry.id) === packId);
  res.json({
    ...(updatedPack || {
      id: packId,
      title: payload.title,
      question_count: payload.normalizedQuestions.length,
      is_public: payload.isPublic ? 1 : 0,
    }),
    edit_mode: 'in_place',
    saved_as_new_revision: false,
  });
});

// Host a session
router.post('/sessions', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-session-create', 30, 10 * 60 * 1000, teacherUserId)) return;
  const { quiz_pack_id, teacher_class_id, game_type = 'classic_quiz', team_count = 0, mode_config = {} } = req.body;
  const packId = parsePositiveInt(quiz_pack_id);
  const teacherClassId = parsePositiveInt(teacher_class_id);
  const pack = (await getTeacherOwnedPack(packId, teacherUserId));
  if (!pack) {
    return res.status(404).json({ error: 'Quiz pack not found' });
  }
  const teacherClass = teacherClassId ? (await getTeacherOwnedClass(teacherClassId, teacherUserId)) : null;
  if (teacherClassId && !teacherClass) {
    return res.status(404).json({ error: 'Class not found' });
  }
  if (teacherClass?.pack_id && Number(teacherClass.pack_id) !== packId) {
    return res.status(400).json({ error: 'This class is assigned to a different pack. Update the class assignment first.' });
  }
  const selectedMode = getGameMode(String(game_type || 'classic_quiz').trim());
  const pin = (await createSessionPin());
  const normalizedGameType = selectedMode.id;
  const normalizedTeamCount = isTeamGame(normalizedGameType)
    ? clampNumber(team_count, 2, 8, selectedMode.defaultTeamCount || 4)
    : 0;
  const normalizedModeConfig = sanitizeModeConfig(normalizedGameType, mode_config);

  const insertSession = db.prepare(`
    INSERT INTO sessions (quiz_pack_id, teacher_class_id, pin, game_type, team_count, mode_config_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insertSession.run(
    packId,
    teacherClassId || null,
    pin,
    normalizedGameType,
    normalizedTeamCount,
    JSON.stringify(normalizedModeConfig),
    'LOBBY',
  );

  res.json({
    id: info.lastInsertRowid,
    pin,
    status: 'LOBBY',
    teacher_class_id: teacherClassId || null,
    game_type: normalizedGameType,
    team_count: normalizedTeamCount,
    mode_config: normalizedModeConfig,
  });
});

router.delete('/teacher/sessions/:id', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = await getTeacherUserIdFromRequest(req);
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-session-delete', 30, 10 * 60 * 1000, teacherUserId)) return;

    const sessionId = parsePositiveInt(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    // Verify ownership via pack
    const session = await db
      .prepare(`
        SELECT s.id, s.status, s.quiz_pack_id, qp.teacher_id
        FROM sessions s
        JOIN quiz_packs qp ON qp.id = s.quiz_pack_id
        WHERE s.id = ? AND qp.teacher_id = ?
      `)
      .get(sessionId, teacherUserId) as any;

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    const sessionStatus = String(session.status || '').toUpperCase();
    if (sessionStatus !== 'ENDED') {
      return res.status(409).json({ error: 'End the live session before deleting it.' });
    }

    // Cascade delete
    db.transaction(() => {
      db.prepare('DELETE FROM student_behavior_logs WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM answers WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM participants WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    })();

    res.json({ deleted: true, session_id: sessionId });
  } catch (error: any) {
    console.error('[ERROR] Delete session failed:', error);
    respondWithServerError(res, 'Failed to delete session');
  }
});

router.get('/teacher/sessions/:id/lms-export', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = await getTeacherUserIdFromRequest(req);
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-session-lms-export', 60, 10 * 60 * 1000, teacherUserId, req.params.id)) return;

    const sessionId = parsePositiveInt(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    const ownedSession = await getTeacherOwnedSession(sessionId, teacherUserId);
    if (!ownedSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const payload = await getSessionPayload(sessionId);
    if (!payload) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const providerId = sanitizeLine(req.query?.provider, 40);
    const exportPackage = buildLmsExport(payload, providerId || null);
    res.json(exportPackage);
  } catch (error: any) {
    console.error('[ERROR] LMS export failed:', error);
    respondWithServerError(res, 'Failed to export LMS gradebook');
  }
});

router.get('/teacher/sessions/pin/:pin', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    const pin = sanitizeSessionPin(req.params.pin);
    if (!enforceRateLimit(req, res, 'teacher-session-by-pin', 240, 5 * 60 * 1000, teacherUserId, pin)) return;

    const session = (await getTeacherOwnedSessionByPin(pin, teacherUserId));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(hydrateSessionRow(session));
  } catch (error: any) {
    console.error('[ERROR] Teacher session by pin failed:', error);
    respondWithServerError(res, 'Failed to load session');
  }
});

router.get('/teacher/sessions/pin/:pin/participants', requireTeacherSession, async (req, res) => {
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    const pin = sanitizeSessionPin(req.params.pin);
    if (!enforceRateLimit(req, res, 'teacher-session-participants-by-pin', 240, 60 * 1000, teacherUserId, pin)) return;

    const session = (await getTeacherOwnedSessionByPin(pin, teacherUserId));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const participants = (await db
        .prepare(`
      SELECT
        p.id,
        p.nickname,
        p.team_id,
        p.team_name,
        p.seat_index,
        p.created_at,
        p.student_user_id,
        p.class_student_id,
        p.join_mode,
        p.display_name_snapshot,
        CASE
          WHEN COALESCE(p.student_user_id, 0) > 0 THEN 1
          ELSE 0
        END AS account_linked,
        CASE
          WHEN COALESCE(p.student_user_id, 0) > 0 THEN 'longitudinal'
          ELSE 'session-only'
        END AS profile_mode,
        tcs.name AS class_student_name,
        tcs.email AS class_student_email,
        tcs.invite_status,
        tcs.claimed_at,
        tcs.last_seen_at,
        COALESCE(SUM(a.score_awarded), 0) AS score,
        COALESCE(SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_count,
        COUNT(a.id) AS answered_count
      FROM participants p
      LEFT JOIN teacher_class_students tcs
        ON tcs.id = p.class_student_id
      LEFT JOIN answers a
        ON a.session_id = p.session_id
       AND a.participant_id = p.id
      WHERE p.session_id = ?
      GROUP BY
        p.id,
        p.nickname,
        p.team_id,
        p.team_name,
        p.seat_index,
        p.created_at,
        p.student_user_id,
        p.class_student_id,
        p.join_mode,
        p.display_name_snapshot,
        tcs.name,
        tcs.email,
        tcs.invite_status,
        tcs.claimed_at,
        tcs.last_seen_at
      ORDER BY p.created_at ASC, p.id ASC
    `)
        .all(session.id));

    res.json({
      session_id: Number(session.id),
      participants,
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher session participants by pin failed:', error);
    respondWithServerError(res, 'Failed to load participants');
  }
});

// Get session by PIN
router.get('/sessions/:pin', async (req, res) => {
  const pin = sanitizeSessionPin(req.params.pin);
  const session = (await db.prepare('SELECT * FROM sessions WHERE pin = ?').get(pin));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(hydrateSessionRow(session));
});

router.get('/sessions/:pin/student-state', async (req, res) => {
  const pin = sanitizeSessionPin(req.params.pin);
  const authorized = await getAuthorizedParticipantForPin(req, pin);
  if (!authorized) {
    return res.status(401).json({ error: 'Participant authentication required' });
  }

  const session = authorized.session as any;
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  let questionPayload = null;
  let currentQuestionRow: any = null;
  if (['QUESTION_ACTIVE', 'QUESTION_DISCUSSION', 'QUESTION_REVOTE', 'QUESTION_REVEAL'].includes(String(session.status || ''))) {
    const question = (await db
            .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC LIMIT 1 OFFSET ?')
            .get(session.quiz_pack_id, session.current_question_index)) as any;
    if (question) {
      currentQuestionRow = question;
      questionPayload = {
        ...question,
        answers: parseJsonArray(question.answers_json),
        time_limit_seconds: resolvePhaseTimeLimit(question, session, String(session.status || '')),
      };
      delete questionPayload.answers_json;
      if (session.status === 'QUESTION_ACTIVE' || session.status === 'QUESTION_DISCUSSION' || session.status === 'QUESTION_REVOTE') {
        delete questionPayload.correct_index;
        delete questionPayload.explanation;
      }
    }
  }

  const participantId = Number(authorized.participant.id);
  const participantScoreState = await getParticipantSessionScoreState(session.id, participantId);
  const currentAnswer = currentQuestionRow
    ? (await db
          .prepare(`
        SELECT question_id, chosen_index, is_correct, score_awarded, created_at
        FROM answers
        WHERE session_id = ? AND participant_id = ? AND question_id = ?
        LIMIT 1
      `)
          .get(session.id, participantId, currentQuestionRow.id)) as any
    : null;

  res.json({
    session: hydrateSessionRow(session),
    question: questionPayload,
    participant: {
      id: participantId,
      nickname: authorized.participant.nickname,
      team_name: authorized.participant.team_name || null,
    },
    participant_state: {
      score: participantScoreState.score,
      streak: participantScoreState.streak,
      current_answer: currentAnswer
        ? {
          question_id: Number(currentAnswer.question_id),
          chosen_index: Number(currentAnswer.chosen_index),
          is_correct: Number(currentAnswer.is_correct || 0) === 1,
          score_awarded: Number(currentAnswer.score_awarded || 0),
        }
        : null,
    },
  });
});

router.get('/sessions/:pin/participants', async (req, res) => {
  const pin = sanitizeSessionPin(req.params.pin);
  if (!enforceRateLimit(req, res, 'session-participants', 120, 60 * 1000, pin)) return;
  const session = (await db.prepare('SELECT id FROM sessions WHERE pin = ?').get(pin));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participants = (await db
      .prepare(`
    SELECT
      p.id,
      p.nickname,
      p.team_id,
      p.team_name,
      p.seat_index,
      p.created_at,
      COALESCE(SUM(a.score_awarded), 0) AS score,
      COALESCE(SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_count
    FROM participants p
    LEFT JOIN answers a
      ON a.session_id = p.session_id
     AND a.participant_id = p.id
    WHERE p.session_id = ?
    GROUP BY p.id, p.nickname, p.team_id, p.team_name, p.seat_index, p.created_at
    ORDER BY p.created_at ASC, p.id ASC
  `)
      .all(session.id));

  res.json({
    session_id: session.id,
    participants,
  });
});

// Update session state
router.put('/sessions/:id/state', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-session-state', 300, 5 * 60 * 1000, teacherUserId, req.params.id)) return;
  const status = sanitizeLine(req.body?.status, 40).toUpperCase();
  const sessionId = parsePositiveInt(req.params.id);
  const session = (await getTeacherOwnedSession(sessionId, teacherUserId));
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!SESSION_STATE_SET.has(status)) {
    return res.status(400).json({ error: 'Invalid session status' });
  }

  const questionCount = Number(
    (await db.prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_pack_id = ?').get(session.quiz_pack_id))?.count || 0,
  );
  const current_question_index =
    questionCount > 0
      ? clampNumber(req.body?.current_question_index, 0, Math.max(0, questionCount - 1), 0)
      : 0;

  const update = db.prepare(`
    UPDATE sessions
    SET
      status = ?,
      current_question_index = ?,
      started_at = CASE
        WHEN ? = 'QUESTION_ACTIVE' AND started_at IS NULL THEN CURRENT_TIMESTAMP
        ELSE started_at
      END,
      ended_at = CASE
        WHEN ? = 'ENDED' THEN CURRENT_TIMESTAMP
        ELSE ended_at
      END
    WHERE id = ?
  `);
  update.run(status, current_question_index, status, status, sessionId);

  const updatedSession = (await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
  if (updatedSession) {
    const hydratedSession = hydrateSessionRow(updatedSession);
    let questionPayload = null;
    if (
      status === 'QUESTION_ACTIVE' ||
      status === 'QUESTION_DISCUSSION' ||
      status === 'QUESTION_REVOTE' ||
      status === 'QUESTION_REVEAL'
    ) {
      const question = (await db
              .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC LIMIT 1 OFFSET ?')
              .get(updatedSession.quiz_pack_id, current_question_index));
      if (question) {
        questionPayload = {
          ...question,
          answers: JSON.parse(question.answers_json),
          time_limit_seconds: resolvePhaseTimeLimit(question, updatedSession, status),
        };
        delete questionPayload.answers_json;
        if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_DISCUSSION' || status === 'QUESTION_REVOTE') {
          delete questionPayload.correct_index;
          delete questionPayload.explanation;
        }
      }
    }

    const stateChangePayload = {
      status,
      current_question_index,
      state_started_at: Date.now(), // Client-server drift is less critical than internal consistency
      question: questionPayload,
      game_type: hydratedSession?.game_type || updatedSession.game_type,
      team_count: Number(updatedSession.team_count || 0),
      mode_config: hydratedSession?.mode_config || getSessionModeConfig(updatedSession),
    };

    broadcastToSession(sessionId, 'STATE_CHANGE', stateChangePayload);

    res.json({
      success: true,
      session: hydratedSession,
      state: stateChangePayload,
    });
    return;
  }

  res.status(500).json({ error: 'Failed to update session state' });
});

// --- Student Routes ---

// Join a session
router.post('/sessions/:pin/join', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const pin = sanitizeSessionPin(req.params.pin);
  const nickname = sanitizeLine(req.body?.nickname, 24);
  const identityKey = resolveStudentIdentityKey(req.body?.identity_key, nickname);
  const studentSession = readStudentSession(req);
  const activeStudentUser =
    studentSession?.studentUserId ? await getStudentUserById(Number(studentSession.studentUserId)) : null;
  const studentUserId =
    activeStudentUser?.id && String(activeStudentUser.status || 'active') === 'active'
      ? Number(activeStudentUser.id)
      : 0;
  if (studentUserId) {
    await linkStudentIdentity({
      studentUserId,
      identityKey,
      source: 'account_join',
    });
    await claimRosterRowsForStudentUser({
      studentUserId,
      email: String(activeStudentUser.email || ''),
    });
  }
  if (!enforceRateLimit(req, res, 'student-join', 20, 5 * 60 * 1000, pin, nickname.toLowerCase())) return;

  const session = hydrateSessionRow(await db.prepare('SELECT * FROM sessions WHERE pin = ?').get(pin));

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'LOBBY') return res.status(400).json({ error: 'Session already started' });
  if (nickname.length < 2) return res.status(400).json({ error: 'Nickname must be at least 2 characters' });
  
  try {
    const joinResult = db.transaction(() => {
      const latestSession = hydrateSessionRow(db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id));
      if (!latestSession || latestSession.status === 'ENDED') {
        throw new Error('Session has ended');
      }

      let matchedClassStudent: any = null;
      if (Number(latestSession.teacher_class_id || 0) > 0 && studentUserId) {
        matchedClassStudent = findRosterRowForStudentUserInClass({
          classId: Number(latestSession.teacher_class_id || 0),
          studentUserId,
          email: String(activeStudentUser?.email || ''),
        });
        if (matchedClassStudent?.id) {
          matchedClassStudent = markRosterRowClaimed({
            rosterStudentId: Number(matchedClassStudent.id),
            studentUserId,
            touchSeenAt: true,
          });
        }
      }

      const existing = db
              .prepare('SELECT * FROM participants WHERE session_id = ? AND LOWER(nickname) = LOWER(?)')
              .get(session.id, nickname);
      
      if (existing) {
        // If identity key matches, allow re-join
        if (existing.identity_key === identityKey || (studentUserId && Number(existing.student_user_id || 0) === studentUserId)) {
          if (studentUserId) {
            db
              .prepare(`
                UPDATE participants
                SET identity_key = ?,
                    student_user_id = ?,
                    class_student_id = COALESCE(?, class_student_id),
                    join_mode = ?,
                    display_name_snapshot = ?
                WHERE id = ?
              `)
                .run(
                  identityKey,
                  studentUserId,
                  Number(matchedClassStudent?.id || 0) || null,
                  Number(existing.student_user_id || 0) > 0 ? 'account' : 'claimed_anonymous',
                  nickname,
                  Number(existing.id),
                );
          }
          const refreshedExisting = db
            .prepare('SELECT * FROM participants WHERE id = ? LIMIT 1')
            .get(Number(existing.id)) as any;
          return {
            participant_id: Number(existing.id),
            total: Number(db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id).count || 0),
            assignedTeamId: Number(refreshedExisting?.team_id || existing.team_id || 0),
            assignedTeamName: refreshedExisting?.team_name || existing.team_name,
            seatIndex: Number(refreshedExisting?.seat_index || existing.seat_index || 0),
            identityKey: getParticipantIdentityKey(refreshedExisting || existing),
            studentUserId: Number(refreshedExisting?.student_user_id || existing.student_user_id || 0) || null,
            classStudentId: Number(refreshedExisting?.class_student_id || existing.class_student_id || 0) || null,
            joinMode: String(refreshedExisting?.join_mode || existing.join_mode || (studentUserId ? 'claimed_anonymous' : 'anonymous')),
            accountLinked: Boolean(Number(refreshedExisting?.student_user_id || existing.student_user_id || 0)),
            profileMode: Number(refreshedExisting?.student_user_id || existing.student_user_id || 0) > 0 ? 'longitudinal' : 'session-only',
            classStudentName: String(matchedClassStudent?.name || ''),
            classStudentEmail: String(matchedClassStudent?.email || ''),
            inviteStatus: String(matchedClassStudent?.invite_status || 'none'),
            rejoined: true,
          };
        }
        throw new Error('Nickname taken');
      }

      const currentCount = Number(
        db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id).count || 0,
      );
      if (currentCount >= MAX_SESSION_PARTICIPANTS) {
        throw new Error('Session capacity reached');
      }

      const assignedTeamId = isTeamGame(session.game_type)
        ? (currentCount % Math.max(2, session.team_count || 4)) + 1
        : 0;
      const assignedTeamName = assignedTeamId > 0 ? buildTeamIdentity(assignedTeamId) : null;
      const seatIndex =
        assignedTeamId > 0
          ? Number(
              db
                               .prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ? AND team_id = ?')
                               .get(session.id, assignedTeamId).count || 0,
            ) + 1
          : currentCount + 1;

      const info = db
              .prepare(`
          INSERT OR IGNORE INTO participants (
            session_id,
            identity_key,
            nickname,
            student_user_id,
            class_student_id,
            join_mode,
            display_name_snapshot,
            team_id,
            team_name,
            seat_index
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
              .run(
                session.id,
                identityKey,
                nickname,
                studentUserId || null,
                Number(matchedClassStudent?.id || 0) || null,
                studentUserId ? 'account' : 'anonymous',
                nickname,
                assignedTeamId,
                assignedTeamName,
                seatIndex,
              );
      if (!Number(info.changes || 0)) {
        throw new Error('Nickname taken');
      }

      const total = Number(
        db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id).count || 0,
      );

      return {
        participant_id: Number(info.lastInsertRowid),
        total,
        assignedTeamId,
        assignedTeamName,
        seatIndex,
        identityKey,
        studentUserId: studentUserId || null,
        classStudentId: Number(matchedClassStudent?.id || 0) || null,
        joinMode: studentUserId ? 'account' : 'anonymous',
        accountLinked: Boolean(studentUserId),
        profileMode: studentUserId ? 'longitudinal' : 'session-only',
        classStudentName: String(matchedClassStudent?.name || ''),
        classStudentEmail: String(matchedClassStudent?.email || ''),
        inviteStatus: String(matchedClassStudent?.invite_status || 'none'),
        rejoined: false,
      };
    })();

    const { token: participantToken } = createParticipantAccessToken({
      participantId: joinResult.participant_id,
      sessionId: session.id,
      identityKey: joinResult.identityKey,
      nickname,
    });

    broadcastToSession(session.id, 'PARTICIPANT_JOINED', {
      nickname,
      participant_id: joinResult.participant_id,
      total_participants: joinResult.total,
      team_id: joinResult.assignedTeamId,
      team_name: joinResult.assignedTeamName,
      seat_index: joinResult.seatIndex,
      student_user_id: joinResult.studentUserId,
      class_student_id: joinResult.classStudentId,
      join_mode: joinResult.joinMode,
      account_linked: joinResult.accountLinked,
      profile_mode: joinResult.profileMode,
      display_name_snapshot: nickname,
      class_student_name: joinResult.classStudentName,
      class_student_email: joinResult.classStudentEmail,
      invite_status: joinResult.inviteStatus,
      game_type: session.game_type,
    });

    res.json({
      participant_id: joinResult.participant_id,
      session_id: session.id,
      game_type: session.game_type,
      team_id: joinResult.assignedTeamId,
      team_name: joinResult.assignedTeamName,
      seat_index: joinResult.seatIndex,
      identity_key: joinResult.identityKey,
      student_user_id: joinResult.studentUserId,
      class_student_id: joinResult.classStudentId,
      join_mode: joinResult.joinMode,
      account_linked: joinResult.accountLinked,
      profile_mode: joinResult.profileMode,
      display_name_snapshot: nickname,
      class_student_name: joinResult.classStudentName,
      class_student_email: joinResult.classStudentEmail,
      invite_status: joinResult.inviteStatus,
      participant_token: participantToken,
    });
  } catch (error: any) {
    if (error?.message === 'Nickname taken') {
      res.status(400).json({ error: 'Nickname taken' });
      return;
    }
    if (isUniqueConstraintError(error, 'participants')) {
      res.status(400).json({ error: 'Nickname taken' });
      return;
    }
    if (error?.message === 'Session capacity reached') {
      res.status(429).json({ error: 'Session is full. Ask the teacher to open another room.' });
      return;
    }
    if (error?.message === 'Session already started') {
      res.status(400).json({ error: 'Session already started' });
      return;
    }
    console.error('[ERROR] Session join failed:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// Submit answer
router.post('/sessions/:pin/answer', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const pin = sanitizeSessionPin(req.params.pin);
  const participant_id = parsePositiveInt(req.body?.participant_id);
  const question_id = parsePositiveInt(req.body?.question_id);
  if (!participant_id || !question_id) {
    return res.status(400).json({ error: 'participant_id and question_id are required.' });
  }
  if (!enforceRateLimit(req, res, 'student-answer', 30, 5 * 60 * 1000, pin, participant_id, question_id)) return;
  const response_ms = clampNumber(req.body?.response_ms, 0, 300_000, 0);
  const telemetry = sanitizeTelemetry(req.body?.telemetry);
  const confidence_level = clampNumber(req.body?.confidence_level, 1, 3, 2);

  try {
    const authorized = await getAuthorizedParticipantForPin(req, pin, participant_id);
    if (!authorized) {
      return res.status(401).json({ error: 'Participant authentication required' });
    }
    const session = authorized.session as any;

    const existingAnswer = (await db
          .prepare('SELECT score_awarded FROM answers WHERE session_id = ? AND question_id = ? AND participant_id = ?')
          .get(session.id, question_id, participant_id)) as any;
    if (existingAnswer) {
      const totalAnswers = Number(
        (await db.prepare('SELECT COUNT(*) as count FROM answers WHERE session_id = ? AND question_id = ?').get(session.id, question_id))
          .count || 0,
      );
      const totalParticipants = Number(
        (await db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id)).count || 0,
      );
      const participantScoreState = await getParticipantSessionScoreState(session.id, participant_id);
      return res.json({
        success: true,
        duplicate: true,
        score_awarded: Number(existingAnswer.score_awarded || 0),
        participant_score_total: participantScoreState.score,
        participant_streak: participantScoreState.streak,
        total_answers: totalAnswers,
        expected: totalParticipants,
      });
    }

    if (!session || !['QUESTION_ACTIVE', 'QUESTION_REVOTE'].includes(String(session.status || ''))) {
      return res.status(400).json({ error: 'Invalid session state' });
    }

    if (session.game_type === 'peer_pods' && session.status !== 'QUESTION_REVOTE') {
      return res.status(409).json({ error: 'Final answers open after the discussion round.' });
    }

    const question = (await db
          .prepare('SELECT correct_index, time_limit_seconds, tags_json, answers_json FROM questions WHERE id = ? AND quiz_pack_id = ?')
          .get(question_id, session.quiz_pack_id)) as any;
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const answers = parseJsonArray(question.answers_json);
    const chosenIndexValue = Number(req.body?.chosen_index);
    if (!Number.isFinite(chosenIndexValue) || answers.length === 0 || chosenIndexValue < 0 || chosenIndexValue >= answers.length) {
      return res.status(400).json({ error: 'Invalid answer choice' });
    }
    const chosen_index = Math.floor(chosenIndexValue);

    const participant = authorized.participant;
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const isCorrect = Number(chosen_index) === Number(question.correct_index);
    const modeConfig = getSessionModeConfig(session);
    const effectiveTimeLimitSeconds = resolveQuestionTimeLimit(question, session);
    const outcome = await runPythonEngine<{
      score_awarded: number;
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'session',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: effectiveTimeLimitSeconds,
      scoring_profile: modeConfig.scoring_profile || getGameMode(session.game_type).defaultModeConfig.scoring_profile || 'standard',
      tags: parseJsonArray(question.tags_json),
      current_mastery: (await getMasteryRows(getParticipantIdentityKey(participant))),
    });
    const adjustedScoreAwarded = Number(outcome.score_awarded || 0) + resolveConfidenceBonus(session.game_type, isCorrect, confidence_level);

    const insertTelemetry = db.prepare(`
      INSERT INTO student_behavior_logs (
        session_id, question_id, participant_id,
        tfi_ms, final_decision_buffer_ms, total_swaps, panic_swaps,
        answer_path_json, focus_loss_count, idle_time_ms, blur_time_ms,
        longest_idle_streak_ms, pointer_activity_count, keyboard_activity_count,
        touch_activity_count, same_answer_reclicks, option_dwell_json,
        submission_retry_count, reconnect_count, visibility_interruptions,
        network_degraded, device_profile
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const writeResult = db.transaction(() => {
      const concurrentAnswer = db
              .prepare('SELECT score_awarded FROM answers WHERE session_id = ? AND question_id = ? AND participant_id = ?')
              .get(session.id, question_id, participant_id) as any;
      if (concurrentAnswer) {
        return {
          duplicate: true,
          score_awarded: Number(concurrentAnswer.score_awarded || 0),
        };
      }

      const insertAnswerResult = db.prepare(`
        INSERT OR IGNORE INTO answers (session_id, question_id, participant_id, chosen_index, is_correct, response_ms, score_awarded)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        question_id,
        participant_id,
        chosen_index,
        isCorrect ? 1 : 0,
        response_ms,
        adjustedScoreAwarded,
      );
      if (!Number(insertAnswerResult.changes || 0)) {
        const persistedAnswer = db
            .prepare('SELECT score_awarded FROM answers WHERE session_id = ? AND question_id = ? AND participant_id = ?')
            .get(session.id, question_id, participant_id) as any;
        return {
          duplicate: true,
          score_awarded: Number(persistedAnswer?.score_awarded || 0),
        };
      }

      if (telemetry) {
        insertTelemetry.run(
          session.id,
          question_id,
          participant_id,
          telemetry.tfi_ms,
          telemetry.final_decision_buffer_ms,
          telemetry.total_swaps,
          telemetry.panic_swaps,
          telemetry.answer_path_json,
          telemetry.focus_loss_count,
          telemetry.idle_time_ms,
          telemetry.blur_time_ms,
          telemetry.longest_idle_streak_ms,
          telemetry.pointer_activity_count,
          telemetry.keyboard_activity_count,
          telemetry.touch_activity_count,
          telemetry.same_answer_reclicks,
          telemetry.option_dwell_json,
          telemetry.submission_retry_count,
          telemetry.reconnect_count,
          telemetry.visibility_interruptions,
          telemetry.network_degraded ? 1 : 0,
          telemetry.device_profile,
        );
      }

      return {
        duplicate: false,
        score_awarded: adjustedScoreAwarded,
      };
    })();

    if (!writeResult.duplicate && outcome.mastery_updates.length > 0) {
      applyMasteryUpdates(getParticipantIdentityKey(authorized.participant), authorized.participant.nickname, outcome.mastery_updates);
    }

    const totalAnswers = Number(
      (await db.prepare('SELECT COUNT(*) as count FROM answers WHERE session_id = ? AND question_id = ?').get(session.id, question_id))
        .count || 0,
    );
    const totalParticipants = Number(
      (await db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id)).count || 0,
    );
    const participantScoreState = await getParticipantSessionScoreState(session.id, participant_id);

    broadcastToSession(session.id, 'ANSWER_RECEIVED', {
      participant_id,
      chosen_index,
      is_correct: isCorrect ? 1 : 0,
      score_awarded: writeResult.score_awarded,
      participant_score_total: participantScoreState.score,
      total_answers: totalAnswers,
      expected: totalParticipants,
    });
    res.json({
      success: true,
      duplicate: writeResult.duplicate,
      score_awarded: writeResult.score_awarded,
      participant_score_total: participantScoreState.score,
      participant_streak: participantScoreState.streak,
      participant_id,
      chosen_index,
      is_correct: isCorrect ? 1 : 0,
      total_answers: totalAnswers,
      expected: totalParticipants,
      confidence_level,
    });
  } catch (error: any) {
    console.error('[ERROR] Session answer failed:', error);
    respondWithServerError(res, 'Failed to submit answer');
  }
});

// Broadcast student selection (pre-lock-in)
router.post('/sessions/:pin/selection', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const pin = sanitizeSessionPin(req.params.pin);
  const participant_id = parsePositiveInt(req.body?.participant_id);
  if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
  if (!enforceRateLimit(req, res, 'student-selection', 240, 60 * 1000, pin, participant_id)) return;
  const chosen_index = clampNumber(req.body?.chosen_index, 0, 12, 0);
  const authorized = await getAuthorizedParticipantForPin(req, pin, participant_id);
  if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
  const session = authorized.session as any;

  if (!session || !['QUESTION_ACTIVE', 'QUESTION_REVOTE'].includes(String(session.status || ''))) {
    return res.status(400).json({ error: 'Invalid session state' });
  }

  const participant = authorized.participant as any;
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  broadcastToSession(session.id, 'SELECTION_CHANGE', {
    participant_id,
    nickname: participant?.nickname,
    chosen_index,
  });

  res.json({ success: true });
});

// Broadcast student focus loss
router.post('/sessions/:pin/focus-loss', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const pin = sanitizeSessionPin(req.params.pin);
  const participant_id = parsePositiveInt(req.body?.participant_id);
  if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
  if (!enforceRateLimit(req, res, 'student-focus-loss', 60, 60 * 1000, pin, participant_id)) return;
  const authorized = await getAuthorizedParticipantForPin(req, pin, participant_id);
  if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
  const session = authorized.session as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participant = authorized.participant as any;
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  broadcastToSession(session.id, 'FOCUS_LOST', {
    participant_id,
    nickname: participant?.nickname,
  });

  res.json({ success: true });
});

// --- SSE Stream ---
router.get('/sessions/:pin/stream', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const pin = sanitizeSessionPin(req.params.pin);
  if (!enforceRateLimit(req, res, 'session-stream-connect', 30, 60 * 1000, pin)) return;
  const session = (await db.prepare('SELECT id FROM sessions WHERE pin = ?').get(pin)) as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const registration = registerSseClient(Number(session.id), req, res);
  if (registration.ok === false) {
    res.status(registration.status).json({ error: registration.error });
    return;
  }
});

// --- Analytics ---
router.get('/analytics/class/:sessionId', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  let sessionId = 0;
  let ownedSession: any = null;
  let payload: any = null;
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'analytics-class', 60, 5 * 60 * 1000, teacherUserId, req.params.sessionId)) return;
    sessionId = parsePositiveInt(req.params.sessionId);
    ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    payload = (await getSessionPayload(sessionId));
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    try {
      const dashboard = (await runClassDashboardWithFallback(payload)) as Record<string, any>;
      const memoryBoard = await buildClassMemorySummary(sessionId).catch((error: any) => {
        console.error('[class-analytics] memory board failed:', error);
        return null;
      });
      const packDetail = await getHydratedPackWithQuestions(Number(payload.pack?.id || ownedSession.quiz_pack_id)).catch((error: any) => {
        console.error('[class-analytics] pack detail failed:', error);
        return null;
      });
      const followUpEngine = buildFollowUpEnginePreview({
        participants: Array.isArray(dashboard?.participants) ? dashboard.participants : [],
        attentionQueue: Array.isArray(dashboard?.studentSpotlight?.attention_needed) ? dashboard.studentSpotlight.attention_needed : [],
        questionDiagnostics: Array.isArray(dashboard?.research?.question_diagnostics) ? dashboard.research.question_diagnostics : [],
        topicBehaviorProfiles: Array.isArray(dashboard?.research?.topic_behavior_profiles)
          ? dashboard.research.topic_behavior_profiles
          : Array.isArray(dashboard?.tagSummary)
            ? dashboard.tagSummary
            : [],
        packQuestions: Array.isArray(packDetail?.questions) ? packDetail.questions : [],
      });
      const questionMeta = new Map(
        (packDetail?.questions || []).map((question: any) => [
          Number(question.id),
          {
            learning_objective: question.learning_objective || '',
            bloom_level: question.bloom_level || '',
          },
        ]),
      );
      const participantMeta = new Map(
        (Array.isArray(payload.participants) ? payload.participants : []).map((participant: any) => [
          Number(participant.id),
          {
            student_user_id: Number(participant.student_user_id || 0) || null,
            class_student_id: Number(participant.class_student_id || 0) || null,
            account_linked: Boolean(Number(participant.student_user_id || 0)),
            profile_mode: Number(participant.student_user_id || 0) ? 'longitudinal' : 'session-only',
            display_name_snapshot: String(participant.display_name_snapshot || ''),
            join_mode: String(participant.join_mode || 'anonymous'),
          },
        ] as const),
      );
      const classRosterRows = Number(ownedSession.teacher_class_id || 0)
        ? ((await db
              .prepare(`
                SELECT id, invite_status, claimed_at, last_seen_at
                FROM teacher_class_students
                WHERE class_id = ?
              `)
              .all(Number(ownedSession.teacher_class_id || 0))) as any[])
        : [];
      const rosterMetaById = new Map(
        classRosterRows.map((row: any) => [
          Number(row.id),
          {
            invite_status: String(row.invite_status || 'none'),
            claimed_at: row.claimed_at || null,
            last_seen_at: row.last_seen_at || null,
          },
        ] as const),
      );
      const mapQuestionMeta = (question: any) =>
        Object.assign(
          {},
          question && typeof question === 'object' ? question : {},
          questionMeta.get(Number(question?.question_id || question?.id)) || {},
        );
      const mapParticipantMeta = (participant: any) => {
        const meta = (participantMeta.get(Number(participant?.id || 0)) || null) as Record<string, any> | null;
        const rosterMeta = meta?.class_student_id ? rosterMetaById.get(Number(meta.class_student_id || 0)) || null : null;
        return {
          ...(participant && typeof participant === 'object' ? participant : {}),
          ...(meta || {}),
          ...(rosterMeta || {}),
        };
      };
      const mapStudentCollectionEntries = (entries: any[]) =>
        Array.isArray(entries) ? entries.map((entry: any) => mapParticipantMeta(entry)) : entries;

      const responsePayload = {
        ...dashboard,
        memory_board: memoryBoard
          ? {
              ...memoryBoard,
              watchlist: mapStudentCollectionEntries(memoryBoard.watchlist),
              autopilot_queue: mapStudentCollectionEntries(memoryBoard.autopilot_queue),
            }
          : memoryBoard,
        pack: packDetail,
        follow_up_engine: followUpEngine,
        cross_section_comparison: await buildCrossSectionComparison(sessionId, teacherUserId).catch((error: any) => {
          console.error('[class-analytics] cross section comparison failed:', error);
          return null;
        }),
        participants: Array.isArray(dashboard?.participants) ? dashboard.participants.map(mapParticipantMeta) : dashboard?.participants,
        studentSpotlight: dashboard?.studentSpotlight
          ? {
              ...dashboard.studentSpotlight,
              attention_needed: mapStudentCollectionEntries(dashboard.studentSpotlight.attention_needed),
            }
          : dashboard?.studentSpotlight,
        questions: Array.isArray(dashboard?.questions) ? dashboard.questions.map(mapQuestionMeta) : dashboard?.questions,
        research: {
          ...(dashboard?.research || {}),
          question_diagnostics: Array.isArray(dashboard?.research?.question_diagnostics)
            ? dashboard.research.question_diagnostics.map(mapQuestionMeta)
            : dashboard?.research?.question_diagnostics,
        },
      };

      const uiLanguage = getRequestedUiLanguage(req);
      await translateAnalyticsFields(responsePayload, uiLanguage, [
        (root) => (Array.isArray(root?.questions) ? root.questions : []).flatMap((question: any) => [
          { holder: question, key: 'prompt' },
          { holder: question, key: 'question_prompt' },
          { holder: question, key: 'learning_objective' },
        ]),
        (root) => (Array.isArray(root?.questions) ? root.questions : []).flatMap((question: any) =>
          Array.isArray(question?.tags) ? question.tags.map((_tag: string, index: number) => ({ holder: question.tags, key: String(index) })) : []),
        (root) => (Array.isArray(root?.research?.question_diagnostics) ? root.research.question_diagnostics : []).flatMap((question: any) => [
          { holder: question, key: 'question_prompt' },
          { holder: question, key: 'recommendation' },
          { holder: question, key: 'learning_objective' },
        ]),
        (root) => (Array.isArray(root?.research?.question_diagnostics) ? root.research.question_diagnostics : []).flatMap((question: any) =>
          Array.isArray(question?.tags) ? question.tags.map((_tag: string, index: number) => ({ holder: question.tags, key: String(index) })) : []),
        (root) => (Array.isArray(root?.research?.topic_behavior_profiles) ? root.research.topic_behavior_profiles : []).map((row: any) => ({ holder: row, key: 'tag' })),
        (root) => (Array.isArray(root?.participants) ? root.participants : []).map((row: any) => ({ holder: row, key: 'recommendation' })),
      ]);

      res.json(responsePayload);
    } catch (analyticsError: any) {
      console.error('[ERROR] Class analytics response assembly failed:', analyticsError);
      const fallbackDashboard = buildFallbackClassDashboard(payload);
      res.json({
        ...fallbackDashboard,
        pack: null,
        memory_board: null,
        follow_up_engine: buildFollowUpEnginePreview({
          participants: Array.isArray(fallbackDashboard?.participants) ? fallbackDashboard.participants : [],
          attentionQueue: [],
          questionDiagnostics: [],
          topicBehaviorProfiles: [],
          packQuestions: [],
        }),
        cross_section_comparison: null,
      });
    }
  } catch (error: any) {
    console.error('[ERROR] Class analytics failed:', error);
    respondWithServerError(res, 'Failed to load class analytics');
  }
});

router.get('/analytics/class/:sessionId/questions/:questionId/replay', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'analytics-class-question-replay', 120, 5 * 60 * 1000, teacherUserId, req.params.sessionId, req.params.questionId)) return;

    const sessionId = parsePositiveInt(req.params.sessionId);
    const questionId = parsePositiveInt(req.params.questionId);
    if (!sessionId || !questionId) {
      return res.status(400).json({ error: 'sessionId and questionId are required' });
    }

    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const payload = (await getSessionPayload(sessionId));
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    const question = (Array.isArray(payload.questions) ? payload.questions : []).find(
      (row: any) => Number(row?.id || 0) === questionId,
    );
    if (!question) {
      return res.status(404).json({ error: 'Question replay not found' });
    }

    const replay = buildQuestionReplaySummary({
      session: payload.session || ownedSession,
      question,
      participants: Array.isArray(payload.participants) ? payload.participants : [],
      answers: Array.isArray(payload.answers) ? payload.answers : [],
      behaviorLogs: Array.isArray(payload.behavior_logs) ? payload.behavior_logs : [],
    });
    const availableQuestionCount = Math.max(1, Array.isArray(payload.questions) ? payload.questions.length : 1);
    const adjustedCount = Math.min(Number(replay?.next_action?.recommended_count || 3), availableQuestionCount);

    replay.next_action = {
      body: String(replay?.next_action?.body || ''),
      focus_tags: Array.isArray(replay?.next_action?.focus_tags) ? replay.next_action.focus_tags : [],
      priority_question_ids: Array.isArray(replay?.next_action?.priority_question_ids)
        ? replay.next_action.priority_question_ids
        : [],
      recommended_count: adjustedCount,
      cta_label: adjustedCount === 1 ? 'Launch instant rematch' : `Launch ${adjustedCount}-question rematch`,
    };

    res.json(replay);
  } catch (error: any) {
    console.error('[ERROR] Question replay failed:', error);
    respondWithServerError(res, 'Failed to load question replay');
  }
});

router.post('/analytics/class/:sessionId/questions/:questionId/rematch', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceTrustedOrigin(req, res)) return;
    if (!enforceRateLimit(req, res, 'analytics-class-question-rematch', 18, 10 * 60 * 1000, teacherUserId, req.params.sessionId, req.params.questionId)) return;

    const sessionId = parsePositiveInt(req.params.sessionId);
    const questionId = parsePositiveInt(req.params.questionId);
    const requestedCount = clampNumber(req.body?.count, 1, 5, 3);
    const launchNow = sanitizeBooleanFlag(req.body?.launch_now, true);
    if (!sessionId || !questionId) {
      return res.status(400).json({ error: 'sessionId and questionId are required' });
    }

    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const classPayload = (await getSessionPayload(sessionId));
    if (!classPayload) return res.status(404).json({ error: 'Session not found' });

    const sourceQuestions = Array.isArray(classPayload.questions) ? classPayload.questions : [];
    const question = sourceQuestions.find((row: any) => Number(row?.id || 0) === questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found in this session' });
    }

    const desiredCount = Math.min(requestedCount, Math.max(1, sourceQuestions.length || 1));
    const focusTags = uniqueStrings(
      parseJsonArray(question?.tags_json).map((tag) => sanitizeLine(tag, 40)),
    ).slice(0, 4);
    const practiceSet = await runPracticeSetWithFallback({
      questions: sourceQuestions,
      count: desiredCount,
      focus_tags: focusTags,
      priority_question_ids: [questionId],
    });

    const rematchQuestions = ensurePriorityQuestions({
      selectedQuestions: Array.isArray(practiceSet?.questions) ? practiceSet.questions : [],
      sourceQuestions,
      priorityQuestionIds: [questionId],
      desiredCount,
    });

    if (!rematchQuestions.length) {
      return res.status(400).json({ error: 'No rematch questions could be prepared for this prompt' });
    }

    const sourcePackTitle = String(classPayload.pack?.title || `Pack ${ownedSession.quiz_pack_id}`);
    const questionOrder = Number(question?.question_order || 0);
    const rematchTitle = `Rematch: Q${questionOrder || questionId} - ${sourcePackTitle}`;
    const packNotes = [
      `Question rematch trigger: Q${questionOrder || questionId}`,
      `Prompt: ${sanitizeLine(question?.prompt, 140)}`,
      focusTags.length > 0 ? `Focus tags: ${focusTags.join(', ')}` : '',
      `Source session: ${sessionId}`,
    ]
      .filter(Boolean)
      .join(' | ');

    const createdPack = await createFollowUpPack({
      teacherUserId,
      sourceSession: ownedSession,
      sourcePack: classPayload.pack || {},
      questions: rematchQuestions,
      title: rematchTitle,
      packNotes,
    });

    let hostedSessionPayload: { id: number; pin: string } | null = null;
    if (launchNow) {
      const pin = (await createSessionPin());
      const hostedSession = (await db
            .prepare(`
          INSERT INTO sessions (quiz_pack_id, teacher_class_id, pin, game_type, team_count, mode_config_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
            .run(
              createdPack.packId,
              createdPack.teacherClassId,
              pin,
              'classic_quiz',
              0,
              JSON.stringify(sanitizeModeConfig('classic_quiz', null)),
              'LOBBY',
            ));
      hostedSessionPayload = {
        id: Number(hostedSession.lastInsertRowid),
        pin,
      };
    }

    res.status(201).json({
      pack_id: createdPack.packId,
      title: rematchTitle,
      question_count: rematchQuestions.length,
      strategy: practiceSet?.strategy || null,
      focus_tags: focusTags,
      source_session_id: sessionId,
      source_question_id: questionId,
      session_id: hostedSessionPayload?.id || null,
      pin: hostedSessionPayload?.pin || null,
    });
  } catch (error: any) {
    console.error('[ERROR] Question rematch creation failed:', error);
    respondWithServerError(res, 'Failed to create question rematch');
  }
});

router.post('/analytics/class/:sessionId/follow-up-engine', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceTrustedOrigin(req, res)) return;
    if (!enforceRateLimit(req, res, 'follow-up-engine-create', 20, 10 * 60 * 1000, teacherUserId, req.params.sessionId)) return;

    const sessionId = parsePositiveInt(req.params.sessionId);
    const planId = String(req.body?.plan_id || '').trim() as FollowUpPlan['id'];
    const launchNow = Boolean(req.body?.launch_now);
    if (!sessionId || !planId) {
      return res.status(400).json({ error: 'sessionId and plan_id are required' });
    }
    const payload = await executeFollowUpPlan({
      teacherUserId,
      sessionId,
      requestedPlanId: planId,
      launchNow,
      titlePrefix: 'Follow-Up',
      fallbackToDefault: false,
    });
    res.json(payload);
  } catch (error: any) {
    console.error('[ERROR] Follow-up engine creation failed:', error);
    if (Number(error?.status || 0) >= 400 && Number(error?.status || 0) < 500) {
      res.status(Number(error.status)).json({ error: error.message });
      return;
    }
    respondWithServerError(res, 'Failed to create follow-up pack');
  }
});

router.post('/teacher/sessions/:sessionId/rematch-pack', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = (await getTeacherUserIdFromRequest(req));
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    if (!enforceRateLimit(req, res, 'teacher-session-rematch-pack', 20, 10 * 60 * 1000, teacherUserId, req.params.sessionId)) return;

    const sessionId = parsePositiveInt(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const launchNow = sanitizeBooleanFlag(req.body?.launch_now, false);
    const requestedPlanId = sanitizeLine(req.body?.plan_id, 60) || 'whole_class_reset';
    const payload = await executeFollowUpPlan({
      teacherUserId,
      sessionId,
      requestedPlanId,
      launchNow,
      titlePrefix: 'Rematch',
      fallbackToDefault: true,
    });

    res.status(201).json(payload);
  } catch (error: any) {
    console.error('[ERROR] Session rematch pack failed:', error);
    if (Number(error?.status || 0) >= 400 && Number(error?.status || 0) < 500) {
      res.status(Number(error.status)).json({ error: error.message });
      return;
    }
    respondWithServerError(res, 'Failed to create rematch pack');
  }
});

router.post('/analytics/class/:sessionId/personalized-games', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceTrustedOrigin(req, res)) return;
    if (!enforceRateLimit(req, res, 'personalized-games-create', 6, 15 * 60 * 1000, teacherUserId, req.params.sessionId)) return;

    const sessionId = parsePositiveInt(req.params.sessionId);
    const requestedCount = clampNumber(req.body?.count, 1, 20, 5);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });

    const classPayload = (await getSessionPayload(sessionId));
    if (!classPayload) return res.status(404).json({ error: 'Class analytics not found' });
    const requestedParticipantIds = uniqueNumbers(Array.isArray(req.body?.participant_ids) ? req.body.participant_ids : []);

    const classDashboard = (await runClassDashboardWithFallback(classPayload)) as Record<string, any>;
    const studentSummaries = new Map<number, any>(
      (Array.isArray(classDashboard?.participants) ? classDashboard.participants : []).map((row: any) => [Number(row.id), row] as const),
    );
    const answeredParticipantIds = new Set<number>(
      uniqueNumbers((Array.isArray(classPayload.answers) ? classPayload.answers : []).map((answer: any) => answer?.participant_id)),
    );
    const eligibleParticipants = (Array.isArray(classPayload.participants) ? classPayload.participants : []).filter((participant: any) => {
      const participantId = Number(participant?.id || 0);
      if (!answeredParticipantIds.has(participantId)) return false;
      if (requestedParticipantIds.length > 0 && !requestedParticipantIds.includes(participantId)) return false;
      return true;
    });

    if (!eligibleParticipants.length) {
      return res.status(400).json({
        error:
          requestedParticipantIds.length > 0
            ? 'None of the requested students were eligible for personalized games in this session'
            : 'No participating students were found in this session',
      });
    }

    const createdPacks: any[] = [];
    const failedStudents: any[] = [];

    for (const participant of eligibleParticipants) {
      try {
        const participantId = Number(participant?.id || 0);
        const identityKey = getParticipantIdentityKey(participant);
        const mastery = (await getMasteryRows(identityKey));
        const practiceAttempts = (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(identityKey)) as any[];
        const participantAnswers = (Array.isArray(classPayload.answers) ? classPayload.answers : []).filter(
          (answer: any) => Number(answer?.participant_id || 0) === participantId,
        );
        const studentSummary = studentSummaries.get(participantId) || null;
        const focusTags = deriveAdaptiveFocusTags({ studentSummary, participant });
        const priorityQuestionIds = deriveAdaptivePriorityQuestionIds({ answers: participantAnswers });
        const riskLabel = String(studentSummary?.risk_level || 'medium');
        const notesExtra = [
          studentSummary?.recommendation ? `Recommendation: ${studentSummary.recommendation}` : '',
          `Risk: ${riskLabel}`,
        ]
          .filter(Boolean)
          .join(' | ');

        const adaptivePack = await createAdaptivePackForParticipant({
          teacherUserId,
          sourceSession: ownedSession,
          sourcePack: classPayload.pack || {},
          participant,
          mastery,
          practiceAttempts,
          questions: classPayload.questions,
          requestedCount,
          focusTags,
          priorityQuestionIds,
          notesExtra,
        });

        createdPacks.push({
          ...adaptivePack,
          risk_level: riskLabel,
          recommendation: studentSummary?.recommendation || '',
        });
      } catch (error: any) {
        failedStudents.push({
          participant: {
            id: Number(participant?.id || 0),
            nickname: String(participant?.nickname || 'Student'),
          },
          error: error?.message || 'Failed to build personalized game',
        });
      }
    }

    if (!createdPacks.length) {
      return res.status(400).json({
        error: 'No personalized games could be created for this session',
        failed_students: failedStudents,
      });
    }

    res.json({
      source_session_id: sessionId,
      requested_count: requestedCount,
      requested_participants: requestedParticipantIds.length,
      processed_count: eligibleParticipants.length,
      created_count: createdPacks.filter((pack) => !pack.reused).length,
      reused_count: createdPacks.filter((pack) => pack.reused).length,
      failed_count: failedStudents.length,
      created_packs: createdPacks,
      failed_students: failedStudents,
    });
  } catch (error: any) {
    console.error('[ERROR] Personalized game batch creation failed:', error);
    respondWithServerError(res, 'Failed to create personalized games');
  }
});

router.get('/analytics/class/:sessionId/student/:participantId', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'analytics-class-student', 60, 5 * 60 * 1000, teacherUserId, req.params.sessionId, req.params.participantId)) return;
    const sessionId = parsePositiveInt(req.params.sessionId);
    const participantId = parsePositiveInt(req.params.participantId);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const ownedParticipant = (await getTeacherOwnedParticipant(participantId, teacherUserId));
    if (!ownedParticipant || Number(ownedParticipant.live_session_id) !== sessionId) {
      return res.status(404).json({ error: 'Student session analytics not found' });
    }
    const context = await getSessionStudentContext(sessionId, participantId);
    if (!context) return res.status(404).json({ error: 'Student session analytics not found' });

    const responsePayload = {
      session: {
        id: Number(context.classPayload.session.id),
        pin: context.classPayload.session.pin,
        status: context.classPayload.session.status,
      },
      pack: context.classPayload.pack,
      participant: context.participant,
      student_summary: context.studentSummary
        ? {
            ...context.studentSummary,
            account_linked: Boolean(context.studentScope?.student_user_id),
            profile_mode: context.studentScope?.student_user_id ? 'longitudinal' : 'session-only',
          }
        : null,
      class_summary: context.classDashboard?.summary || null,
      class_distributions: context.classDashboard?.distributions || null,
      analytics: context.sessionAnalytics,
      overall_analytics: context.overallAnalytics,
      student_memory: context.studentMemory,
      memory_intervention_plan: buildMemoryInterventionPlan(context),
      session_vs_overall: context.analyticsComparison,
      adaptive_game_preview: context.adaptivePreview,
    };

    const uiLanguage = getRequestedUiLanguage(req);
    await translateAnalyticsFields(responsePayload, uiLanguage, [
      (root) => (Array.isArray(root?.adaptive_game_preview?.questions) ? root.adaptive_game_preview.questions : []).flatMap((question: any) => [
        { holder: question, key: 'prompt' },
        { holder: question, key: 'learning_objective' },
      ]),
      (root) => (Array.isArray(root?.adaptive_game_preview?.questions) ? root.adaptive_game_preview.questions : []).flatMap((question: any) =>
        Array.isArray(question?.tags) ? question.tags.map((_tag: string, index: number) => ({ holder: question.tags, key: String(index) })) : []),
      (root) => (Array.isArray(root?.analytics?.questionReview) ? root.analytics.questionReview : []).flatMap((question: any) => [
        { holder: question, key: 'prompt' },
        { holder: question, key: 'recommendation' },
        { holder: question, key: 'first_choice_text' },
        { holder: question, key: 'final_choice_text' },
      ]),
      (root) => (Array.isArray(root?.analytics?.questionReview) ? root.analytics.questionReview : []).flatMap((question: any) =>
        Array.isArray(question?.tags) ? question.tags.map((_tag: string, index: number) => ({ holder: question.tags, key: String(index) })) : []),
      (root) => (Array.isArray(root?.analytics?.tagPerformance) ? root.analytics.tagPerformance : []).map((row: any) => ({ holder: row, key: 'tag' })),
      (root) => (Array.isArray(root?.student_memory?.focus_tags) ? root.student_memory.focus_tags : []).map((row: any) => ({ holder: row, key: 'tag' })),
      (root) => (Array.isArray(root?.student_memory?.recommended_next_step?.focus_tags)
        ? root.student_memory.recommended_next_step.focus_tags.map((_tag: string, index: number) => ({ holder: root.student_memory.recommended_next_step.focus_tags, key: String(index) }))
        : []),
    ]);

    res.json(responsePayload);
  } catch (error: any) {
    console.error('[ERROR] Teacher student analytics failed:', error);
    respondWithServerError(res, 'Failed to load student session analytics');
  }
});

router.post('/analytics/class/:sessionId/student/:participantId/memory-note', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    const sessionId = parsePositiveInt(req.params.sessionId);
    const participantId = parsePositiveInt(req.params.participantId);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const ownedParticipant = (await getTeacherOwnedParticipant(participantId, teacherUserId));
    if (!ownedParticipant || Number(ownedParticipant.live_session_id) !== sessionId) {
      return res.status(404).json({ error: 'Student session analytics not found' });
    }
    const context = await getSessionStudentContext(sessionId, participantId);
    if (!context) return res.status(404).json({ error: 'Student session analytics not found' });
    const snapshot = await saveStudentMemoryTeacherNote(
      context.studentScope?.primary_identity_key || context.identityKey,
      String(context.studentScope?.canonical_nickname || context.participant?.nickname || 'Student'),
      String(req.body?.note || ''),
    );
    res.json({ success: true, student_memory: snapshot });
  } catch (error: any) {
    console.error('[ERROR] Student memory note save failed:', error);
    respondWithServerError(res, 'Failed to save student memory note');
  }
});

router.post('/analytics/class/:sessionId/student/:participantId/adaptive-game', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceTrustedOrigin(req, res)) return;
    if (!enforceRateLimit(req, res, 'adaptive-game-create', 20, 10 * 60 * 1000, teacherUserId, req.params.sessionId, req.params.participantId)) return;
    const sessionId = parsePositiveInt(req.params.sessionId);
    const participantId = parsePositiveInt(req.params.participantId);
    const requestedCount = clampNumber(req.body?.count, 1, 20, 5);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const ownedParticipant = (await getTeacherOwnedParticipant(participantId, teacherUserId));
    if (!ownedParticipant || Number(ownedParticipant.live_session_id) !== sessionId) {
      return res.status(404).json({ error: 'Student session analytics not found' });
    }
    const context = await getSessionStudentContext(sessionId, participantId);
    if (!context) return res.status(404).json({ error: 'Student session analytics not found' });
    const interventionPlan = buildMemoryInterventionPlan(context);
    const focusTags = interventionPlan.focus_tags;
    const priorityQuestionIds = interventionPlan.priority_question_ids;
    const notesExtra = [
      `Intervention type: ${interventionPlan.intervention_type}`,
      interventionPlan.reasons.length > 0 ? `Reasons: ${interventionPlan.reasons.join(' | ')}` : '',
      context.studentSummary?.recommendation ? `Recommendation: ${context.studentSummary.recommendation}` : '',
      context.studentSummary?.risk_level ? `Risk: ${context.studentSummary.risk_level}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const adaptivePack = await createAdaptivePackForParticipant({
      teacherUserId,
      sourceSession: ownedSession,
      sourcePack: context.classPayload.pack || {},
      participant: context.participant,
      mastery: context.mastery,
      practiceAttempts: context.practice_attempts,
      questions: context.classPayload.questions,
      requestedCount,
      focusTags,
      priorityQuestionIds,
      notesExtra,
    });

    const pin = (await createSessionPin());
    const sessionInfo = db
          .prepare('INSERT INTO sessions (quiz_pack_id, teacher_class_id, pin, status) VALUES (?, ?, ?, ?)')
          .run(adaptivePack.pack_id, adaptivePack.teacherClassId, pin, 'LOBBY');

    res.json({
      adaptive_pack_id: adaptivePack.pack_id,
      session_id: Number(sessionInfo.lastInsertRowid),
      pin,
      title: adaptivePack.title,
      question_count: adaptivePack.question_count,
      strategy: adaptivePack.strategy,
      focus_tags: adaptivePack.focus_tags,
      reused: adaptivePack.reused,
      participant: {
        id: Number(context.participant.id),
        nickname: context.participant.nickname,
      },
      source_pack_id: Number(context.classPayload.session.quiz_pack_id),
      intervention_plan: interventionPlan,
    });
  } catch (error: any) {
    console.error('[ERROR] Adaptive game creation failed:', error);
    respondWithServerError(res, 'Failed to create adaptive game');
  }
});

router.post('/analytics/class/:sessionId/memory-autopilot', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceTrustedOrigin(req, res)) return;
    if (!enforceRateLimit(req, res, 'memory-autopilot-create', 6, 15 * 60 * 1000, teacherUserId, req.params.sessionId)) return;
    const sessionId = parsePositiveInt(req.params.sessionId);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const classPayload = await getSessionPayload(sessionId);
    if (!classPayload) return res.status(404).json({ error: 'Session not found' });
    const memoryBoard = await buildClassMemorySummary(sessionId);
    const requestedParticipantIds = uniqueNumbers(Array.isArray(req.body?.participant_ids) ? req.body.participant_ids : []);
    const autopilotIds = requestedParticipantIds.length > 0
      ? requestedParticipantIds
      : uniqueNumbers((memoryBoard?.watchlist || []).map((row: any) => row.id)).slice(0, 6);
    if (!autopilotIds.length) {
      return res.status(400).json({ error: 'No memory watchlist students are available for autopilot.' });
    }

    const createdPacks: any[] = [];
    const failedStudents: any[] = [];
    for (const participantId of autopilotIds) {
      try {
        const context = await getSessionStudentContext(sessionId, participantId);
        if (!context) {
          failedStudents.push({ participant_id: participantId, error: 'Student session analytics not found' });
          continue;
        }
        const interventionPlan = buildMemoryInterventionPlan(context);
        const adaptivePack = await createAdaptivePackForParticipant({
          teacherUserId,
          sourceSession: ownedSession,
          sourcePack: context.classPayload.pack || {},
          participant: context.participant,
          mastery: context.mastery,
          practiceAttempts: context.practice_attempts,
          questions: context.classPayload.questions,
          requestedCount: interventionPlan.recommended_count,
          focusTags: interventionPlan.focus_tags,
          priorityQuestionIds: interventionPlan.priority_question_ids,
          notesExtra: [
            `Autopilot intervention: ${interventionPlan.intervention_type}`,
            interventionPlan.reasons.length > 0 ? `Reasons: ${interventionPlan.reasons.join(' | ')}` : '',
          ].filter(Boolean).join(' | '),
        });
        createdPacks.push({
          ...adaptivePack,
          intervention_plan: interventionPlan,
        });
      } catch (error: any) {
        failedStudents.push({
          participant_id: participantId,
          error: error?.message || 'Failed to build memory autopilot pack',
        });
      }
    }

    if (!createdPacks.length) {
      return res.status(400).json({
        error: 'No memory interventions could be created',
        failed_students: failedStudents,
      });
    }

    res.json({
      source_session_id: sessionId,
      requested_participants: autopilotIds.length,
      created_count: createdPacks.filter((pack) => !pack.reused).length,
      reused_count: createdPacks.filter((pack) => pack.reused).length,
      failed_count: failedStudents.length,
      created_packs: createdPacks,
      failed_students: failedStudents,
      watchlist_size: Number(memoryBoard?.watchlist?.length || 0),
    });
  } catch (error: any) {
    console.error('[ERROR] Memory autopilot creation failed:', error);
    respondWithServerError(res, 'Failed to run memory autopilot');
  }
});

router.get('/student/me', requireStudentSession, async (req, res) => {
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me', 120, 5 * 60 * 1000, studentUserId)) return;
    const payload = await buildStudentPortalPayload(studentUserId);
    if (!payload) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }
    res.json(payload);
  } catch (error: any) {
    console.error('[ERROR] Student portal load failed:', error);
    respondWithServerError(res, 'Failed to load student portal');
  }
});

router.post('/student/me/classes/:classId/accept', requireStudentSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-class-accept', 120, 10 * 60 * 1000, studentUserId, req.params.classId)) return;

    const classId = parsePositiveInt(req.params.classId);
    const acceptedRow = await acceptRosterRowForStudentUser({
      studentUserId,
      classId,
    });
    if (!acceptedRow?.id) {
      return res.status(404).json({ error: 'Class invite not found for this student.' });
    }

    const payload = await buildStudentPortalPayload(studentUserId);
    if (!payload) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }

    const classSummary = [
      ...(Array.isArray(payload.active_classes) ? payload.active_classes : []),
      ...(Array.isArray(payload.pending_classes) ? payload.pending_classes : []),
      ...(Array.isArray(payload.classes) ? payload.classes : []),
    ].find((entry: any) => Number(entry.class_id || 0) === classId) || null;

    res.json({
      accepted: true,
      class: classSummary || null,
      classes: payload.classes,
      pending_classes: payload.pending_classes,
      active_classes: payload.active_classes,
    });
  } catch (error: any) {
    console.error('[ERROR] Student class accept failed:', error);
    respondWithServerError(res, 'Failed to accept class invite');
  }
});

router.get('/student/me/classes/:classId', requireStudentSession, async (req, res) => {
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-class-detail', 180, 5 * 60 * 1000, studentUserId, req.params.classId)) return;

    const payload = await buildStudentPortalPayload(studentUserId);
    if (!payload) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }

    const classId = parsePositiveInt(req.params.classId);
    const classSummary = [
      ...(Array.isArray(payload.active_classes) ? payload.active_classes : []),
      ...(Array.isArray(payload.pending_classes) ? payload.pending_classes : []),
      ...(Array.isArray(payload.classes) ? payload.classes : []),
    ].find((entry: any) => Number(entry.class_id || 0) === classId) || null;
    if (!classSummary) {
      return res.status(404).json({ error: 'Class not found in this student account.' });
    }

    const sessionIds = new Set(
      uniqueNumbers((Array.isArray(classSummary.recent_sessions) ? classSummary.recent_sessions : []).map((row: any) => row?.id)),
    );
    const classHistory = (Array.isArray(payload.session_history) ? payload.session_history : []).filter((row: any) =>
      sessionIds.has(Number(row?.session_id || 0)),
    );
    const classAccuracy =
      classHistory.length > 0
        ? Math.round(
            classHistory.reduce((sum: number, row: any) => sum + Number(row?.accuracy_pct || row?.accuracy || 0), 0) / classHistory.length,
          )
        : classSummary.stats?.average_accuracy === null || classSummary.stats?.average_accuracy === undefined
          ? null
          : Math.round(Number(classSummary.stats.average_accuracy || 0));
    let assignment = null;
    try {
      assignment = await buildStudentAssignmentView({
        classRow: classSummary,
        studentUserId,
      });
    } catch (assignmentError: any) {
      console.error('[WARN] Student class assignment view fallback engaged:', {
        classId,
        studentUserId,
        message: assignmentError?.message || 'Unknown assignment error',
      });
    }

    res.json({
      student: payload.student,
      class: classSummary,
      assignment,
      practice_defaults: payload.practice_defaults,
      recommendations: payload.recommendations,
      student_memory: payload.student_memory,
      session_history: classHistory,
      class_progress: {
        accuracy: classAccuracy,
        session_count: Number(classSummary.stats?.session_count || 0),
        active_session_count: Number(classSummary.stats?.active_session_count || 0),
      },
    });
  } catch (error: any) {
    console.error('[ERROR] Student class detail failed:', error);
    respondWithServerError(res, 'Failed to load student class');
  }
});

router.get('/student/me/history', requireStudentSession, async (req, res) => {
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-history', 120, 5 * 60 * 1000, studentUserId)) return;
    const payload = await buildStudentPortalPayload(studentUserId);
    if (!payload) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }
    res.json({
      student: payload.student,
      session_history: payload.session_history,
      latest_session: payload.latest_session,
    });
  } catch (error: any) {
    console.error('[ERROR] Student history load failed:', error);
    respondWithServerError(res, 'Failed to load student history');
  }
});

router.get('/student/me/recommendations', requireStudentSession, async (req, res) => {
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-recommendations', 120, 5 * 60 * 1000, studentUserId)) return;
    const payload = await buildStudentPortalPayload(studentUserId);
    if (!payload) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }
    res.json({
      student: payload.student,
      recommendations: payload.recommendations,
      student_memory: payload.student_memory,
      practice_defaults: payload.practice_defaults,
    });
  } catch (error: any) {
    console.error('[ERROR] Student recommendations load failed:', error);
    respondWithServerError(res, 'Failed to load student recommendations');
  }
});

router.get('/analytics/student/:nickname', async (req, res) => {
  try {
    const authorized = await getAuthorizedParticipantAccess(req);
    if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
    if (!enforceRateLimit(req, res, 'analytics-student', 90, 5 * 60 * 1000, authorized.participant.id)) return;
    const dashboard = await getOverallStudentAnalytics({
      identityKey: getParticipantIdentityKey(authorized.participant),
      nickname: authorized.participant.nickname,
    });

    res.json(dashboard);
  } catch (error: any) {
    console.error('[ERROR] Student analytics failed:', error);
    respondWithServerError(res, 'Failed to load student analytics');
  }
});

// --- Adaptive Practice ---
router.get('/student/me/practice', requireStudentSession, async (req, res) => {
  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-practice', 90, 5 * 60 * 1000, studentUserId)) return;

    const studentUser = await getStudentUserById(studentUserId);
    if (!studentUser?.id) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }

    const requestedCount = clampNumber(req.query?.count, 2, 8, 5);
    const requestedFocusTags = uniqueStrings(String(req.query?.focus_tags || '').split(',').map((tag) => sanitizeLine(tag, 40))).slice(0, 4);
    const requestedMissionId = sanitizeLine(req.query?.mission, 40);
    const requestedMissionLabel = sanitizeLine(req.query?.mission_label, 80);
    const overallAnalytics = await getOverallStudentAnalytics({
      studentUserId,
      displayName: studentUser.display_name || studentUser.email,
      nickname: studentUser.display_name || studentUser.email,
    });
    const studentContext = await buildStudentAnalyticsContext({
      studentUserId,
      displayName: studentUser.display_name || studentUser.email,
      nickname: studentUser.display_name || studentUser.email,
    });
    const studentMemory = overallAnalytics?.student_memory || (await readStudentMemorySnapshot(studentContext.primary_identity_key));
    const recommendedFocusTags = Array.isArray(studentMemory?.recommended_next_step?.focus_tags)
      ? studentMemory.recommended_next_step.focus_tags
      : [];
    const focusTags = requestedFocusTags.length > 0 ? requestedFocusTags : recommendedFocusTags.slice(0, 4);
    const recommendedAction = String(studentMemory?.recommended_next_step?.action || '');
    const missionId =
      requestedMissionId ||
      (recommendedAction === 'confidence_reset'
        ? 'reentry'
        : recommendedAction === 'adaptive_practice'
          ? 'targeted'
          : recommendedAction === 'keep_momentum'
            ? 'momentum'
            : '');
    const availableQuestions = studentContext.questions.length > 0
      ? studentContext.questions
      : ((await db.prepare('SELECT * FROM questions').all()) as any[]);
    const practiceSet = await runPracticeSetWithFallback({
      nickname: studentContext.canonical_nickname,
      mastery: studentContext.mastery,
      questions: availableQuestions,
      practice_attempts: studentContext.practice_attempts,
      count: requestedCount,
      focus_tags: focusTags,
    });
    const missionLabel =
      requestedMissionLabel ||
      (missionId === 'reentry'
        ? 'Comeback Mission'
        : missionId === 'targeted'
          ? 'Focus Sprint'
          : missionId === 'momentum'
            ? 'Momentum Booster'
            : 'Adaptive Practice');

    res.json({
      ...(practiceSet && typeof practiceSet === 'object' ? practiceSet : {}),
      mission: {
        id: missionId || null,
        label: missionLabel,
        question_count: requestedCount,
        focus_tags: focusTags,
      },
      memory_reason: studentMemory?.recommended_next_step?.body || null,
      memory_reasons: Array.isArray(studentMemory?.recommended_next_step?.reasons) ? studentMemory.recommended_next_step.reasons : [],
      memory_confidence: studentMemory?.trust || null,
      coaching: studentMemory?.coaching || null,
      student_memory_summary: studentMemory?.summary || null,
    });
  } catch (error: any) {
    console.error('[ERROR] Student account practice selection failed:', error);
    respondWithServerError(res, 'Failed to load adaptive practice');
  }
});

router.post('/student/me/practice/answer', requireStudentSession, async (req, res) => {
  const question_id = parsePositiveInt(req.body?.question_id);
  const chosenIndexValue = Number(req.body?.chosen_index);
  const response_ms = clampNumber(req.body?.response_ms, 0, 300_000, 0);
  if (!question_id) return res.status(400).json({ error: 'question_id is required' });
  if (!Number.isFinite(chosenIndexValue) || chosenIndexValue < 0) {
    return res.status(400).json({ error: 'chosen_index is required' });
  }
  if (!enforceTrustedOrigin(req, res)) return;

  try {
    const studentSession = readStudentSession(req);
    const studentUserId = Number(studentSession?.studentUserId || 0);
    if (!studentUserId) {
      return res.status(401).json({ error: 'Student authentication required' });
    }
    if (!enforceRateLimit(req, res, 'student-me-practice-answer', 120, 5 * 60 * 1000, studentUserId, question_id)) return;

    const studentUser = await getStudentUserById(studentUserId);
    if (!studentUser?.id) {
      clearStudentSession(req, res);
      return res.status(401).json({ error: 'Student account no longer exists. Please sign in again.' });
    }

    const studentContext = await buildStudentAnalyticsContext({
      studentUserId,
      displayName: studentUser.display_name || studentUser.email,
      nickname: studentUser.display_name || studentUser.email,
    });
    const question = (await db
      .prepare('SELECT correct_index, explanation, tags_json, time_limit_seconds, answers_json FROM questions WHERE id = ?')
      .get(question_id)) as any;
    if (!question) return res.status(404).json({ error: 'Question not found' });
    const answers = parseJsonArray(question.answers_json);
    if (Math.floor(chosenIndexValue) >= answers.length) {
      return res.status(400).json({ error: 'Invalid answer choice' });
    }
    const chosen_index = Math.floor(chosenIndexValue);
    const isCorrect = Number(chosen_index) === Number(question.correct_index);

    const outcome = await runPythonEngine<{
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'practice',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: question.time_limit_seconds,
      tags: parseJsonArray(question.tags_json),
      current_mastery: studentContext.mastery,
    });

    await db.prepare(`
      INSERT INTO practice_attempts (identity_key, nickname, question_id, is_correct, response_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      studentContext.primary_identity_key,
      studentContext.canonical_nickname,
      question_id,
      isCorrect ? 1 : 0,
      response_ms,
    );

    if (outcome.mastery_updates.length > 0) {
      applyMasteryUpdates(studentContext.primary_identity_key, studentContext.canonical_nickname, outcome.mastery_updates);
    }

    res.json({
      is_correct: isCorrect,
      correct_index: question.correct_index,
      explanation: question.explanation,
    });
  } catch (error: any) {
    console.error('[ERROR] Student account practice answer failed:', error);
    respondWithServerError(res, 'Failed to submit practice answer');
  }
});

router.get('/practice/:nickname', async (req, res) => {
  try {
    const authorized = await getAuthorizedParticipantAccess(req);
    if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
    const identityKey = getParticipantIdentityKey(authorized.participant);
    if (!enforceRateLimit(req, res, 'practice-load', 90, 5 * 60 * 1000, authorized.participant.id)) return;
    const requestedCount = clampNumber(req.query?.count, 2, 8, 5);
    const requestedFocusTags = uniqueStrings(String(req.query?.focus_tags || '').split(',').map((tag) => sanitizeLine(tag, 40))).slice(0, 4);
    const requestedMissionId = sanitizeLine(req.query?.mission, 40);
    const requestedMissionLabel = sanitizeLine(req.query?.mission_label, 80);
    const overallAnalytics = await getOverallStudentAnalytics({
      identityKey,
      nickname: authorized.participant.nickname,
    });
    const studentMemory = overallAnalytics?.student_memory || (await readStudentMemorySnapshot(identityKey));
    const recommendedFocusTags = Array.isArray(studentMemory?.recommended_next_step?.focus_tags)
      ? studentMemory.recommended_next_step.focus_tags
      : [];
    const focusTags = requestedFocusTags.length > 0 ? requestedFocusTags : recommendedFocusTags.slice(0, 4);
    const recommendedAction = String(studentMemory?.recommended_next_step?.action || '');
    const missionId =
      requestedMissionId ||
      (recommendedAction === 'confidence_reset'
        ? 'reentry'
        : recommendedAction === 'adaptive_practice'
          ? 'targeted'
          : recommendedAction === 'keep_momentum'
            ? 'momentum'
            : '');
    const practiceSet = await runPracticeSetWithFallback({
      nickname: authorized.participant.nickname,
      mastery: (await getMasteryRows(identityKey)),
      questions: (await db.prepare('SELECT * FROM questions').all()),
      practice_attempts: (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(identityKey)),
      count: requestedCount,
      focus_tags: focusTags,
    });
    const missionLabel =
      requestedMissionLabel ||
      (missionId === 'reentry'
        ? 'Comeback Mission'
        : missionId === 'targeted'
          ? 'Focus Sprint'
          : missionId === 'momentum'
            ? 'Momentum Booster'
            : 'Adaptive Practice');

    res.json({
      ...(practiceSet && typeof practiceSet === 'object' ? practiceSet : {}),
      mission: {
        id: missionId || null,
        label: missionLabel,
        question_count: requestedCount,
        focus_tags: focusTags,
      },
      memory_reason: studentMemory?.recommended_next_step?.body || null,
      memory_reasons: Array.isArray(studentMemory?.recommended_next_step?.reasons) ? studentMemory.recommended_next_step.reasons : [],
      memory_confidence: studentMemory?.trust || null,
      coaching: studentMemory?.coaching || null,
      student_memory_summary: studentMemory?.summary || null,
    });
  } catch (error: any) {
    console.error('[ERROR] Practice selection failed:', error);
    respondWithServerError(res, 'Failed to load adaptive practice');
  }
});

router.post('/practice/:nickname/answer', async (req, res) => {
  const question_id = parsePositiveInt(req.body?.question_id);
  const chosenIndexValue = Number(req.body?.chosen_index);
  const response_ms = clampNumber(req.body?.response_ms, 0, 300_000, 0);
  if (!question_id) return res.status(400).json({ error: 'question_id is required' });
  if (!Number.isFinite(chosenIndexValue) || chosenIndexValue < 0) {
    return res.status(400).json({ error: 'chosen_index is required' });
  }
  if (!enforceTrustedOrigin(req, res)) return;

  try {
    const authorized = await getAuthorizedParticipantAccess(req);
    if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
    const identityKey = getParticipantIdentityKey(authorized.participant);
    if (!enforceRateLimit(req, res, 'practice-answer', 120, 5 * 60 * 1000, authorized.participant.id, question_id)) return;

    const question = (await db
          .prepare('SELECT correct_index, explanation, tags_json, time_limit_seconds, answers_json FROM questions WHERE id = ?')
          .get(question_id)) as any;
    if (!question) return res.status(404).json({ error: 'Question not found' });
    const answers = parseJsonArray(question.answers_json);
    if (Math.floor(chosenIndexValue) >= answers.length) {
      return res.status(400).json({ error: 'Invalid answer choice' });
    }
    const chosen_index = Math.floor(chosenIndexValue);

    const isCorrect = Number(chosen_index) === Number(question.correct_index);
    const outcome = await runPythonEngine<{
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'practice',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: question.time_limit_seconds,
      tags: parseJsonArray(question.tags_json),
      current_mastery: (await getMasteryRows(identityKey)),
    });

    (await db.prepare(`
      INSERT INTO practice_attempts (identity_key, nickname, question_id, is_correct, response_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(identityKey, authorized.participant.nickname, question_id, isCorrect ? 1 : 0, response_ms));

    if (outcome.mastery_updates.length > 0) {
      applyMasteryUpdates(identityKey, authorized.participant.nickname, outcome.mastery_updates);
    }

    res.json({
      is_correct: isCorrect,
      correct_index: question.correct_index,
      explanation: question.explanation,
    });
  } catch (error: any) {
    console.error('[ERROR] Practice answer failed:', error);
    respondWithServerError(res, 'Failed to submit practice answer');
  }
});

// --- Telemetry Reporting Routes ---

// Get class telemetry heatmap data
router.get('/reports/class/:session_id', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'report-class', 60, 5 * 60 * 1000, teacherUserId, req.params.session_id)) return;
    const sessionId = parsePositiveInt(req.params.session_id);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const payload = (await getSessionPayload(sessionId));
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    const report = await runPythonEngine<unknown>('class-dashboard', payload);
    res.json(report);
  } catch (error: any) {
    console.error('[ERROR] Class report failed:', error);
    respondWithServerError(res, 'Failed to load class report');
  }
});

// Get student personal power map & behavioral stats
router.get('/reports/student/:participant_id', async (req, res) => {
  try {
    const participantId = parsePositiveInt(req.params.participant_id);
    if (!participantId) return res.status(400).json({ error: 'participant_id is required' });

    const teacherSession = readTeacherSession(req);
    let participant: any = null;

    if (teacherSession) {
      const teacherUserId = Number((await getTeacherUserByEmail(teacherSession.email))?.id || 0);
      if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
      if (!enforceRateLimit(req, res, 'report-student', 60, 5 * 60 * 1000, teacherUserId, participantId)) return;
      participant = (await getTeacherOwnedParticipant(participantId, teacherUserId));
      if (!participant) return res.status(404).json({ error: 'Participant not found' });
    } else {
      const authorized = await getAuthorizedParticipantAccess(req);
      if (!authorized || Number(authorized.participant.id) !== participantId) {
        return res.status(401).json({ error: 'Participant authentication required' });
      }
      if (!enforceRateLimit(req, res, 'report-student-self', 60, 5 * 60 * 1000, participantId)) return;
      participant = authorized.participant;
    }

    const liveSession = (await db.prepare('SELECT * FROM sessions WHERE id = ?').get(participant.session_id)) as any;
    const pack = liveSession
      ? (await db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(liveSession.quiz_pack_id))
      : null;
    const questions = liveSession
      ? (await db.prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC').all(liveSession.quiz_pack_id))
      : (await db.prepare('SELECT * FROM questions').all());

    const report = await runStudentDashboardWithFallback({
      nickname: participant.nickname,
      mastery: (await getMasteryRows(getParticipantIdentityKey(participant))),
      answers: (await db.prepare('SELECT * FROM answers WHERE participant_id = ?').all(participantId)),
      questions,
      behavior_logs: (await db.prepare('SELECT * FROM student_behavior_logs WHERE participant_id = ?').all(participantId)),
      practice_attempts: (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(getParticipantIdentityKey(participant))),
      sessions: liveSession ? [liveSession] : [],
      packs: pack ? [pack] : [],
    });

    res.json({
      ...report,
      participant,
      session: liveSession,
      pack,
    });
  } catch (error: any) {
    console.error('[ERROR] Student report failed:', error);
    respondWithServerError(res, 'Failed to load student report');
  }
});

router.get('/dashboard/teacher/overview', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'teacher-overview', 45, 5 * 60 * 1000, teacherUserId)) return;
    const packs = (await db.prepare('SELECT * FROM quiz_packs WHERE teacher_id = ?').all(teacherUserId));
    const packIds = uniqueNumbers(packs.map((pack: any) => pack.id));
    const sessions = packIds.length
      ? (await db
                  .prepare(
                    `SELECT * FROM sessions WHERE quiz_pack_id IN (${packIds.map(() => '?').join(', ')})`,
                  )
                  .all(...packIds))
      : [];
    const sessionIds = uniqueNumbers(sessions.map((row: any) => row.id));
    const overviewPayload = {
      packs,
      sessions,
      participants: (await getParticipantsForSessionIds(sessionIds)),
      answers: (await getAnswersForSessionIds(sessionIds)),
      questions: (await getQuestionsForPackIds(packIds)),
      behavior_logs: (await getBehaviorLogsForSessionIds(sessionIds)),
    };
    const fallbackOverview = buildTeacherOverviewFallback(overviewPayload);
    let overview = fallbackOverview;

    try {
      const engineOverview = await runPythonEngine<unknown>('teacher-overview', overviewPayload);
      if (isTeacherOverviewPayload(engineOverview)) {
        overview = engineOverview;
      } else {
        console.warn('[TeacherReports] Python overview returned an invalid payload. Serving JS fallback instead.');
      }
    } catch (engineError: any) {
      console.warn('[TeacherReports] Python overview failed. Serving JS fallback instead.', engineError?.message || engineError);
    }

    res.json(overview);
  } catch (error: any) {
    console.error('[ERROR] Teacher overview failed:', error);
    respondWithServerError(res, 'Failed to load teacher overview');
  }
});

export default router;
