import { Router } from 'express';
import { handleContactSubmission } from '../api/contact.js';
import { randomInt } from 'crypto';
import db from '../db/index.js';
import { seedDemoDataForTeacher } from '../db/seeding.js';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import admin from 'firebase-admin';
import { runPythonEngine } from '../services/pythonEngine.js';
import { translateUiTexts } from '../services/uiTranslation.js';
import { broadcastToSession, registerSseClient } from '../services/sseHub.js';
import { buildRateLimitKey, checkRateLimit, isTrustedOrigin } from '../services/requestGuards.js';
import { createBoundedTaskGate, defaultTaskConcurrency, envTaskConcurrency } from '../services/taskGate.js';
import { GAME_MODES, getGameMode, getTeamGameModeIds, type GameModeConfig } from '../../shared/gameModes.js';
import { buildFollowUpEnginePreview, type FollowUpPlan } from '../../shared/followUpEngine.js';
import {
  createParticipantAccessToken,
  readParticipantAccessToken,
  resolveStudentIdentityKey,
} from '../services/studentIdentity.js';

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'quizzi-4dece',
  });
}

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
  createTeacherUser,
  getTeacherUserByEmail,
  validateTeacherEmail,
  validateTeacherPassword,
  verifyTeacherPassword,
} from '../services/teacherUsers.js';
import {
  getHydratedTeacherClass,
  getTeacherOwnedClass,
  getTeacherOwnedStudent,
  listTeacherClasses,
  sanitizeTeacherClassColor,
} from '../services/teacherClasses.js';
import {
  buildGenerationSource,
  getCachedQuestionGeneration,
  getHydratedPackWithQuestions,
  getOrCreateMaterialProfile,
  hydratePack,
  listHydratedPacks,
  normalizeGeneratedQuestions,
  saveCachedQuestionGeneration,
  syncPackDerivedData,
} from '../services/materialIntel.js';
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

if (!process.env.GEMINI_API_KEY) {
  console.error('⚠️  [CRITICAL] GEMINI_API_KEY is NOT set! AI question generation will fail.');
  console.error('    → Set it in Render Dashboard: Environment → Add Environment Variable');
  console.error('    → Key: GEMINI_API_KEY   Value: your Google AI Studio API key');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MISSING_KEY' });
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
    raw.scoring_profile === 'coverage'
  ) {
    modeConfig.scoring_profile = raw.scoring_profile;
  }

  return modeConfig;
}

function getSessionModeConfig(session: any): GameModeConfig {
  return sanitizeModeConfig(String(session?.game_type || 'classic_quiz'), parseJsonObject(session?.mode_config_json));
}

function resolveQuestionTimeLimit(question: any, session: any) {
  const baseSeconds = clampNumber(question?.time_limit_seconds, 8, 90, 20);
  const modeConfig = getSessionModeConfig(session);
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

async function getMasteryRows(identityKey: string) {
  return (await db.prepare('SELECT tag, score FROM mastery WHERE identity_key = ?').all(identityKey));
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
    const activeSessions = packSessions.filter((session: any) => String(session.status || '').toUpperCase() !== 'ENDED');

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

async function getOverallStudentAnalytics({
  identityKey,
  nickname,
}: {
  identityKey: string;
  nickname: string;
}) {
  const participants = (await getParticipantsForIdentityKey(identityKey));
  const participantIds = uniqueNumbers(participants.map((row: any) => row.id));
  const sessionIds = uniqueNumbers(participants.map((row: any) => row.session_id));
  const sessions = (await getSessionsForIds(sessionIds));
  const packs = (await getPacksForIds(uniqueNumbers(sessions.map((row: any) => row.quiz_pack_id))));

  return runPythonEngine<any>('student-dashboard', {
    nickname,
    mastery: (await getMasteryRows(identityKey)),
    answers: (await db
          .prepare(`
        SELECT a.*
        FROM answers a
        JOIN participants p ON a.participant_id = p.id
        WHERE p.identity_key = ?
      `)
          .all(identityKey)),
    questions: (await db.prepare('SELECT * FROM questions').all()),
    behavior_logs: (await getLogsForParticipantIds(participantIds)),
    practice_attempts: (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(identityKey)),
    sessions,
    packs,
  });
}

async function getSessionStudentContext(sessionId: number, participantId: number) {
  const classPayload = (await getSessionPayload(sessionId));
  if (!classPayload) return null;

  const participant = classPayload.participants.find((row: any) => Number(row.id) === participantId);
  if (!participant) return null;

  const identityKey = getParticipantIdentityKey(participant);
  const mastery = (await getMasteryRows(identityKey));
  const practice_attempts = (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(identityKey));
  const answers = classPayload.answers.filter((answer: any) => Number(answer.participant_id) === participantId);
  const behavior_logs = classPayload.behavior_logs.filter((log: any) => Number(log.participant_id) === participantId);

  const sessionAnalytics = await runPythonEngine<any>('student-dashboard', {
    nickname: participant.nickname,
    mastery,
    answers,
    questions: classPayload.questions,
    behavior_logs,
    practice_attempts,
    sessions: [classPayload.session],
    packs: classPayload.pack ? [classPayload.pack] : [],
  });
  const overallAnalytics = await getOverallStudentAnalytics({
    identityKey,
    nickname: participant.nickname,
  });

  const adaptivePreview = await runPythonEngine<any>('practice-set', {
    nickname: participant.nickname,
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

  const classDashboard = await runPythonEngine<any>('class-dashboard', classPayload);
  const studentSummary =
    classDashboard?.participants?.find((row: any) => Number(row.id) === participantId) || null;

  return {
    classPayload,
    participant,
    identityKey,
    mastery,
    practice_attempts,
    sessionAnalytics,
    overallAnalytics,
    analyticsComparison: buildAnalyticsComparison(sessionAnalytics, overallAnalytics),
    adaptivePreview,
    classDashboard,
    studentSummary,
  };
}

async function getClassFollowUpContext(sessionId: number) {
  const classPayload = (await getSessionPayload(sessionId));
  if (!classPayload) return null;

  const classDashboard = (await runPythonEngine<any>('class-dashboard', classPayload)) as Record<string, any>;
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

router.post('/translate', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'ui-translate', 120, 60 * 1000)) return;

  const targetLanguage = String(req.body?.targetLanguage || '').trim().toLowerCase();
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
  const sessionData = readTeacherSession(req);
  if (!sessionData) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  // Re-create the token for the verified session to keep it fresh on the client
  const { token } = createTeacherSession({ email: sessionData.email, provider: sessionData.provider });
  res.json({ ...sessionData, token });
});

router.post('/auth/login', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'auth-login', 8, 10 * 60 * 1000)) return;

  const email = normalizeTeacherEmail(String(req.body?.email || ''));
  const password = String(req.body?.password || '');
  const teacherUser = (await getTeacherUserByEmail(email));

  if (teacherUser?.password_hash && verifyTeacherPassword(password, teacherUser.password_hash)) {
    const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'password' });
    issueTeacherSession(req, res, token);
    return res.json({ ...session, token });
  }

  if (!isDemoTeacherEmail(email) || !verifyDemoPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const { session, token } = createTeacherSession({ email, provider: 'password' });
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
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = normalizeTeacherEmail(decodedToken.email || '');
    if (!email) {
      return res.status(400).json({ error: 'Google account has no valid email address.' });
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
    res.status(401).json({ error: 'Failed to verify Google sign-in. Please try again.' });
  }
});

router.post('/auth/logout', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  clearTeacherSession(req, res);
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

    const studentNames = Array.isArray(req.body?.students)
      ? req.body.students
          .map((student: any) => sanitizeTeacherStudentName(student?.name ?? student))
          .filter(Boolean)
          .slice(0, 120)
      : [];

    const createTeacherClass = db.transaction((input: typeof payload, roster: string[]) => {
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
      const insertStudent = db.prepare(`
        INSERT INTO teacher_class_students (class_id, name, joined_at, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      roster.forEach((studentName) => {
        insertStudent.run(classId, studentName);
      });

      return classId;
    });

    const classId = createTeacherClass(payload, studentNames);
    res.status(201).json((await getHydratedTeacherClass(classId, teacherUserId)));
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

    const studentName = sanitizeTeacherStudentName(req.body?.name);
    if (!studentName) {
      return res.status(400).json({ error: 'Student name is required.' });
    }

    (await db
        .prepare(`
        INSERT INTO teacher_class_students (class_id, name, joined_at, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
        .run(classId, studentName));
    (await db
        .prepare('UPDATE teacher_classes SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND teacher_id = ?')
        .run(classId, teacherUserId));

    res.status(201).json((await getHydratedTeacherClass(classId, teacherUserId)));
  } catch (error: any) {
    console.error('[ERROR] Add class student failed:', error);
    respondWithServerError(res, 'Failed to add student');
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

// Generate questions from text using Gemini
router.post('/packs/generate', requireTeacherSession, async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const teacherUserId = (await getTeacherUserIdFromRequest(req));
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }
  if (!enforceRateLimit(req, res, 'teacher-pack-generate', 20, 10 * 60 * 1000, teacherUserId)) return;
  const source_text = sanitizeMultiline(req.body?.source_text, 120000);
  const count = Math.min(20, Math.max(3, parsePositiveInt(req.body?.count, 5)));
  const difficulty = sanitizeLine(req.body?.difficulty || 'Medium', 24);
  const language = sanitizeLine(req.body?.language || 'English', 24);
  const questionFormat = sanitizeLine(req.body?.question_format || 'Multiple Choice', 32);
  const cognitiveLevel = sanitizeLine(req.body?.cognitive_level || 'Mixed', 32);
  const explanationDetail = sanitizeLine(req.body?.explanation_detail || 'Concise', 32);

  console.log(`[AI GEN] Request: ${count} questions, ${difficulty} difficulty, ${language} language, text length: ${source_text?.length}`);

  if (!source_text) return res.status(400).json({ error: 'Source text is required' });

  try {
    const materialProfile = (await getOrCreateMaterialProfile(source_text));
    const generationSource = (await buildGenerationSource(materialProfile));
    const cached = (await getCachedQuestionGeneration(
          Number(materialProfile.id),
          Number(count),
          String(difficulty),
          String(language),
        ));

    if (cached?.response?.questions?.length) {
      return res.json({
        ...cached.response,
        generation_meta: {
          cached: true,
          source_mode: generationSource.source_mode,
          estimated_original_tokens: generationSource.estimated_original_tokens,
          estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
          token_savings_pct: generationSource.token_savings_pct,
        },
        material_profile: {
          id: Number(materialProfile.id),
          source_language: materialProfile.source_language,
          source_excerpt: materialProfile.source_excerpt,
          teaching_brief: materialProfile.teaching_brief,
          key_points: materialProfile.key_points,
          topic_fingerprint: materialProfile.topic_fingerprint,
        },
      });
    }

    const generationKey = [
      Number(materialProfile.id),
      count,
      difficulty.toLowerCase(),
      language.toLowerCase(),
      questionFormat.toLowerCase(),
      cognitiveLevel.toLowerCase(),
      explanationDetail.toLowerCase(),
    ].join(':');

    const responsePayload = await runInFlightQuestionGeneration(generationKey, async () => {
      const isHebrew = language.toLowerCase() === 'hebrew';
      const langInstruction = isHebrew
        ? "CRITICAL: ALL output text (prompt, answers, explanation, tags) MUST be in HEBREW (עברית). This is an absolute requirement. Do not use English for anything."
        : "The output MUST be in English.";

      const prompt = `Task: Generate exactly ${count} multiple-choice questions from the provided educational material.
Difficulty Level: ${difficulty}
Output Language: ${language}
Question Format: ${questionFormat}
Cognitive Depth: ${cognitiveLevel}
Explanation Style: ${explanationDetail}
${langInstruction}

Constraint: Return ONLY a raw JSON object matching the schema below. No markdown formatting, no preamble.
If "True/False" is selected, generate questions with only two "answers" (True and False).
If "Higher Order" is selected, focus on analysis, evaluation, and complex application rather than simple facts.
Use the compact course brief and supporting excerpts below as the authoritative source. Prefer high-signal concepts, chronology, causal links, definitions, and tricky confusions from the material.

Schema:
{
  "questions": [
    {
      "prompt": "The question text",
      "answers": ["Choice A", "Choice B", "Choice C", "Choice D"],
      "correct_index": 0,
      "explanation": "Why the answer is correct",
      "tags": ["topic"],
      "time_limit_seconds": 20
    }
  ]
}

Educational Material:
${generationSource.material}`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });
      } catch (modelError: any) {
        console.error('[CRITICAL] Gemini Model Error:', modelError);
        throw new Error(`AI Model failed: ${modelError.message}`);
      }

      const text = response.text;
      console.log('[DEBUG] Gemini Raw Response Received');

      try {
        const cleanJson = text?.replace(/```json\n?|\n?```/g, '').trim() || '{}';
        const data = JSON.parse(cleanJson);
        const normalizedQuestions = normalizeGeneratedQuestions(
          data?.questions || [],
          materialProfile.topic_fingerprint || [],
        );
        const payload = {
          questions: normalizedQuestions,
          generation_meta: {
            cached: false,
            source_mode: generationSource.source_mode,
            estimated_original_tokens: generationSource.estimated_original_tokens,
            estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
            token_savings_pct: generationSource.token_savings_pct,
          },
          material_profile: {
            id: Number(materialProfile.id),
            source_language: materialProfile.source_language,
            source_excerpt: materialProfile.source_excerpt,
            teaching_brief: materialProfile.teaching_brief,
            key_points: materialProfile.key_points,
            topic_fingerprint: materialProfile.topic_fingerprint,
          },
        };
        (await saveCachedQuestionGeneration(
                    Number(materialProfile.id),
                    Number(count),
                    String(difficulty),
                    String(language),
                    payload,
                  ));
        return payload;
      } catch (parseError: any) {
        console.error('[ERROR] Failed to parse Gemini response:', text);
        throw new Error('Failed to parse AI response');
      }
    });

    res.json(responsePayload);
  } catch (error: any) {
    console.error('[ERROR] Generate Route Crash:', error);
    if (/saturated/i.test(String(error?.message || ''))) {
      res.status(503).json({ error: 'AI generation is busy. Try again shortly.' });
      return;
    }
    respondWithServerError(res, 'Failed to generate questions');
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
  const title = sanitizeLine(req.body?.title, 120);
  const source_text = sanitizeMultiline(req.body?.source_text, 120000);
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const language = sanitizeLine(req.body?.language || 'English', 24);
  const academicMeta = sanitizeAcademicMeta(req.body?.academic_meta || req.body);
  const isPublic = sanitizeBooleanFlag(req.body?.is_public, false);
  if (!title) {
    return res.status(400).json({ error: 'Pack title is required' });
  }
  if (questions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  const materialProfile = (await getOrCreateMaterialProfile(source_text || ''));
  const normalizedQuestions = normalizeGeneratedQuestions(
    Array.isArray(questions) ? questions : [],
    materialProfile.topic_fingerprint || [],
  ).map((question: any, index: number) => sanitizeQuestionDraft(question, index, materialProfile.topic_fingerprint || []));

  const insertPack = db.prepare(`
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
      is_public,
      source_hash,
      source_excerpt,
      source_language,
      source_word_count,
      material_profile_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insertPack.run(
    teacherUserId,
    title,
    source_text,
    academicMeta.course_code,
    academicMeta.course_name,
    academicMeta.section_name,
    academicMeta.academic_term,
    academicMeta.week_label,
    JSON.stringify(academicMeta.learning_objectives),
    JSON.stringify(academicMeta.bloom_levels),
    academicMeta.pack_notes,
    isPublic ? 1 : 0,
    materialProfile.source_hash,
    materialProfile.source_excerpt,
    language || materialProfile.source_language,
    materialProfile.word_count,
    materialProfile.id,
  );
  const packId = info.lastInsertRowid;

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

  const insertMany = db.transaction((qs: any[]) => {
    for (const q of qs) {
      insertQuestion.run(
        packId,
        q.prompt,
        q.image_url || '',
        JSON.stringify(q.answers),
        q.correct_index,
        q.explanation,
        JSON.stringify(q.tags),
        q.time_limit_seconds || 20,
        q.question_order || 0,
        q.learning_objective || '',
        q.bloom_level || '',
      );
    }
  });

  insertMany(normalizedQuestions);
  (await syncPackDerivedData(Number(packId), source_text || '', normalizedQuestions, language));
  (await createPackVersionSnapshot(Number(packId), teacherUserId, 'Initial version', 'create'));

  res.json({ id: packId, title, question_count: normalizedQuestions.length, is_public: isPublic ? 1 : 0 });
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
        .prepare('SELECT id, nickname, team_id, team_name, seat_index, created_at FROM participants WHERE session_id = ? ORDER BY created_at ASC, id ASC')
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

router.get('/sessions/:pin/participants', async (req, res) => {
  const pin = sanitizeSessionPin(req.params.pin);
  if (!enforceRateLimit(req, res, 'session-participants', 120, 60 * 1000, pin)) return;
  const session = (await db.prepare('SELECT id FROM sessions WHERE pin = ?').get(pin));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participants = (await db
      .prepare('SELECT id, nickname, team_id, team_name, seat_index, created_at FROM participants WHERE session_id = ? ORDER BY created_at ASC, id ASC')
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
  if (!enforceRateLimit(req, res, 'student-join', 20, 5 * 60 * 1000, pin, nickname.toLowerCase())) return;

  const session = hydrateSessionRow(await db.prepare('SELECT * FROM sessions WHERE pin = ?').get(pin));

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'LOBBY') return res.status(400).json({ error: 'Session already started' });
  if (nickname.length < 2) return res.status(400).json({ error: 'Nickname must be at least 2 characters' });

  try {
    const joinResult = db.transaction(() => {
      const latestSession = hydrateSessionRow(db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id));
      if (!latestSession || latestSession.status !== 'LOBBY') {
        throw new Error('Session already started');
      }

      const existing = db
              .prepare('SELECT id FROM participants WHERE session_id = ? AND LOWER(nickname) = LOWER(?)')
              .get(session.id, nickname);
      if (existing) {
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
          INSERT OR IGNORE INTO participants (session_id, identity_key, nickname, team_id, team_name, seat_index)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
              .run(session.id, identityKey, nickname, assignedTeamId, assignedTeamName, seatIndex);
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

    if (!session || !['QUESTION_ACTIVE', 'QUESTION_REVOTE'].includes(String(session.status || ''))) {
      return res.status(400).json({ error: 'Invalid session state' });
    }

    if (session.game_type === 'peer_pods' && session.status !== 'QUESTION_REVOTE') {
      return res.status(409).json({ error: 'Final answers open after the discussion round.' });
    }

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
      return res.json({
        success: true,
        duplicate: true,
        score_awarded: Number(existingAnswer.score_awarded || 0),
        total_answers: totalAnswers,
        expected: totalParticipants,
      });
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
    const effectiveTimeLimitSeconds = resolveQuestionTimeLimit(question, session);
    const outcome = await runPythonEngine<{
      score_awarded: number;
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'session',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: effectiveTimeLimitSeconds,
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
        touch_activity_count, same_answer_reclicks, option_dwell_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    broadcastToSession(session.id, 'ANSWER_RECEIVED', {
      total_answers: totalAnswers,
      expected: totalParticipants,
    });
    res.json({
      success: true,
      duplicate: writeResult.duplicate,
      score_awarded: writeResult.score_awarded,
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
  try {
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'analytics-class', 60, 5 * 60 * 1000, teacherUserId, req.params.sessionId)) return;
    const sessionId = parsePositiveInt(req.params.sessionId);
    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });
    const payload = (await getSessionPayload(sessionId));
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    const dashboard = (await runPythonEngine<any>('class-dashboard', payload)) as Record<string, any>;
    const packDetail = (await getHydratedPackWithQuestions(Number(payload.pack?.id || ownedSession.quiz_pack_id)));
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
    const mapQuestionMeta = (question: any) =>
      Object.assign(
        {},
        question && typeof question === 'object' ? question : {},
        questionMeta.get(Number(question?.question_id || question?.id)) || {},
      );

    res.json({
      ...dashboard,
      pack: packDetail,
      follow_up_engine: followUpEngine,
      cross_section_comparison: (await buildCrossSectionComparison(sessionId, teacherUserId)),
      questions: Array.isArray(dashboard?.questions) ? dashboard.questions.map(mapQuestionMeta) : dashboard?.questions,
      research: {
        ...(dashboard?.research || {}),
        question_diagnostics: Array.isArray(dashboard?.research?.question_diagnostics)
          ? dashboard.research.question_diagnostics.map(mapQuestionMeta)
          : dashboard?.research?.question_diagnostics,
      },
    });
  } catch (error: any) {
    console.error('[ERROR] Class analytics failed:', error);
    respondWithServerError(res, 'Failed to load class analytics');
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

    const ownedSession = (await getTeacherOwnedSession(sessionId, teacherUserId));
    if (!ownedSession) return res.status(404).json({ error: 'Session not found' });

    const context = await getClassFollowUpContext(sessionId);
    if (!context) return res.status(404).json({ error: 'Class analytics not found' });

    const selectedPlan = context.followUpEngine.plans.find((plan) => plan.id === planId);
    if (!selectedPlan) {
      return res.status(400).json({ error: 'Requested follow-up plan is unavailable' });
    }

    const sourceQuestions = Array.isArray(context.classPayload.questions) && context.classPayload.questions.length > 0
      ? context.classPayload.questions
      : Array.isArray(context.packDetail?.questions)
        ? context.packDetail.questions
        : [];

    const practiceSet = await runPythonEngine<any>('practice-set', {
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
      return res.status(400).json({ error: 'No follow-up questions are available for this plan' });
    }

    const sourcePackTitle = context.packDetail?.title || context.classPayload.pack?.title || `Pack ${ownedSession.quiz_pack_id}`;
    const followUpTitle = `Follow-Up: ${selectedPlan.title} - ${sourcePackTitle}`;
    const packNotes = [
      `Follow-up plan: ${selectedPlan.title}`,
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

    res.json({
      pack_id: createdPack.packId,
      title: followUpTitle,
      question_count: followUpQuestions.length,
      plan: selectedPlan,
      strategy: practiceSet?.strategy || null,
      session_id: hostedSessionPayload?.id || null,
      pin: hostedSessionPayload?.pin || null,
    });
  } catch (error: any) {
    console.error('[ERROR] Follow-up engine creation failed:', error);
    respondWithServerError(res, 'Failed to create follow-up pack');
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

    res.json({
      session: {
        id: Number(context.classPayload.session.id),
        pin: context.classPayload.session.pin,
        status: context.classPayload.session.status,
      },
      pack: context.classPayload.pack,
      participant: context.participant,
      student_summary: context.studentSummary,
      class_summary: context.classDashboard?.summary || null,
      class_distributions: context.classDashboard?.distributions || null,
      analytics: context.sessionAnalytics,
      overall_analytics: context.overallAnalytics,
      session_vs_overall: context.analyticsComparison,
      adaptive_game_preview: context.adaptivePreview,
    });
  } catch (error: any) {
    console.error('[ERROR] Teacher student analytics failed:', error);
    respondWithServerError(res, 'Failed to load student session analytics');
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

    const adaptiveGame = await runPythonEngine<any>('practice-set', {
      nickname: context.participant.nickname,
      mastery: context.mastery,
      questions: context.classPayload.questions,
      practice_attempts: context.practice_attempts,
      count: Math.min(requestedCount, Math.max(1, context.classPayload.questions.length || 1)),
      focus_tags:
        context.sessionAnalytics?.adaptiveTargets?.focus_tags ||
        context.overallAnalytics?.adaptiveTargets?.focus_tags ||
        context.sessionAnalytics?.practicePlan?.focus_tags ||
        [],
      priority_question_ids:
        context.sessionAnalytics?.adaptiveTargets?.priority_question_ids ||
        context.overallAnalytics?.adaptiveTargets?.priority_question_ids ||
        [],
    });

    if (!adaptiveGame?.questions?.length) {
      return res.status(400).json({ error: 'No adaptive questions available for this student' });
    }

    const originalPackTitle = context.classPayload.pack?.title || `Pack ${context.classPayload.session.quiz_pack_id}`;
    const adaptiveTitle = `Adaptive: ${context.participant.nickname} - ${originalPackTitle}`;
    const adaptiveProfile = (await getOrCreateMaterialProfile(context.classPayload.pack?.source_text || ''));
    const packInfo = (await db
          .prepare(`
        INSERT INTO quiz_packs (
          teacher_id,
          title,
          source_text,
          source_hash,
          source_excerpt,
          source_language,
          source_word_count,
          material_profile_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
          .run(
            teacherUserId,
            adaptiveTitle,
            context.classPayload.pack?.source_text || '',
            adaptiveProfile.source_hash,
            adaptiveProfile.source_excerpt,
            adaptiveProfile.source_language,
            adaptiveProfile.word_count,
            adaptiveProfile.id,
          ));
    const adaptivePackId = Number(packInfo.lastInsertRowid);

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
        question_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertQuestions = db.transaction((questions: any[]) => {
      questions.forEach((question, index) => {
        insertQuestion.run(
          adaptivePackId,
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
        );
      });
    });
    insertQuestions(adaptiveGame.questions);
    await syncPackDerivedData(adaptivePackId, context.classPayload.pack?.source_text || '', adaptiveGame.questions);

    const pin = (await createSessionPin());
    const sessionInfo = db
          .prepare('INSERT INTO sessions (quiz_pack_id, pin, status) VALUES (?, ?, ?)')
          .run(adaptivePackId, pin, 'LOBBY');

    res.json({
      adaptive_pack_id: adaptivePackId,
      session_id: Number(sessionInfo.lastInsertRowid),
      pin,
      title: adaptiveTitle,
      question_count: adaptiveGame.questions.length,
      strategy: adaptiveGame.strategy,
      participant: {
        id: Number(context.participant.id),
        nickname: context.participant.nickname,
      },
      source_pack_id: Number(context.classPayload.session.quiz_pack_id),
    });
  } catch (error: any) {
    console.error('[ERROR] Adaptive game creation failed:', error);
    respondWithServerError(res, 'Failed to create adaptive game');
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
router.get('/practice/:nickname', async (req, res) => {
  try {
    const authorized = await getAuthorizedParticipantAccess(req);
    if (!authorized) return res.status(401).json({ error: 'Participant authentication required' });
    const identityKey = getParticipantIdentityKey(authorized.participant);
    if (!enforceRateLimit(req, res, 'practice-load', 90, 5 * 60 * 1000, authorized.participant.id)) return;
    const practiceSet = await runPythonEngine<unknown>('practice-set', {
      nickname: authorized.participant.nickname,
      mastery: (await getMasteryRows(identityKey)),
      questions: (await db.prepare('SELECT * FROM questions').all()),
      practice_attempts: (await db.prepare('SELECT * FROM practice_attempts WHERE identity_key = ?').all(identityKey)),
      count: 5,
    });

    res.json(practiceSet);
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
    const session = readTeacherSession(req);
    if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
    const teacherUserId = Number((await getTeacherUserByEmail(session.email))?.id || 0);
    if (!teacherUserId) return res.status(401).json({ error: 'Teacher authentication required' });
    if (!enforceRateLimit(req, res, 'report-student', 60, 5 * 60 * 1000, teacherUserId, req.params.participant_id)) return;
    const participantId = parsePositiveInt(req.params.participant_id);
    const participant = (await getTeacherOwnedParticipant(participantId, teacherUserId));
    if (!participant) return res.status(404).json({ error: 'Participant not found' });
    const liveSession = (await db.prepare('SELECT * FROM sessions WHERE id = ?').get(participant.session_id)) as any;
    const pack = liveSession
      ? (await db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(liveSession.quiz_pack_id))
      : null;
    const questions = liveSession
      ? (await db.prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC').all(liveSession.quiz_pack_id))
      : (await db.prepare('SELECT * FROM questions').all());

    const report = await runPythonEngine<any>('student-dashboard', {
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

    const overview = await runPythonEngine<unknown>('teacher-overview', {
      packs,
      sessions,
      participants: (await getParticipantsForSessionIds(sessionIds)),
      answers: (await getAnswersForSessionIds(sessionIds)),
      questions: (await getQuestionsForPackIds(packIds)),
      behavior_logs: (await getBehaviorLogsForSessionIds(sessionIds)),
    });

    res.json(overview);
  } catch (error: any) {
    console.error('[ERROR] Teacher overview failed:', error);
    respondWithServerError(res, 'Failed to load teacher overview');
  }
});

export default router;
