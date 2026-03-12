import { Router } from 'express';
import { randomBytes } from 'crypto';
import db from '../db/index.js';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import admin from 'firebase-admin';
import { runPythonEngine } from '../services/pythonEngine.js';

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
    fileSize: 8 * 1024 * 1024,
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const TEAM_GAME_TYPES = new Set(['team_relay', 'peer_pods', 'mastery_matrix']);
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

// SSE Clients Map: sessionId -> array of response objects
const sseClients = new Map<number, any[]>();
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function broadcastToSession(sessionId: number, event: string, data: any) {
  const clients = sseClients.get(sessionId);
  if (clients) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => client.write(payload));
  }
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getClientFingerprint(req: any) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown');
}

function enforceRateLimit(req: any, res: any, key: string, limit: number, windowMs: number) {
  const bucketKey = `${key}:${getClientFingerprint(req)}`;
  const now = Date.now();
  const current = rateLimitBuckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests, slow down and try again shortly.' });
    return false;
  }
  current.count += 1;
  return true;
}

function enforceTrustedOrigin(req: any, res: any) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;

  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!forwardedHost) return true;

  const expectedOrigin = `${forwardedProto}://${forwardedHost}`;
  if (origin !== expectedOrigin) {
    res.status(403).json({ error: 'Origin mismatch' });
    return false;
  }

  return true;
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

function parsePositiveInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

function hydrateSessionRow(session: any) {
  if (!session) return null;
  return {
    ...session,
    id: Number(session.id),
    quiz_pack_id: Number(session.quiz_pack_id),
    current_question_index: Number(session.current_question_index || 0),
    team_count: Number(session.team_count || 0),
    mode_config: parseJsonObject(session.mode_config_json),
  };
}

function buildTeamIdentity(teamId: number) {
  const index = Math.max(0, teamId - 1);
  return `Team ${TEAM_NAME_BANK[index] || `#${teamId}`}`;
}

function isTeamGame(gameType: string | null | undefined) {
  return TEAM_GAME_TYPES.has(String(gameType || '').trim());
}

function getMasteryRows(nickname: string) {
  return db.prepare('SELECT tag, score FROM mastery WHERE nickname = ?').all(nickname);
}

const upsertMastery = db.prepare(`
  INSERT INTO mastery (nickname, tag, score) VALUES (?, ?, ?)
  ON CONFLICT(nickname, tag) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP
`);

const applyMasteryUpdates = db.transaction((nickname: string, updates: Array<{ tag: string; score: number }>) => {
  for (const update of updates) {
    upsertMastery.run(nickname, update.tag, update.score);
  }
});

function getSessionPayload(sessionId: number) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const pack = db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(session.quiz_pack_id);
  const participants = db.prepare('SELECT * FROM participants WHERE session_id = ?').all(sessionId);
  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
    .all(session.quiz_pack_id);
  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(sessionId);
  const behavior_logs = db.prepare('SELECT * FROM student_behavior_logs WHERE session_id = ?').all(sessionId);

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

function getTeacherUserIdFromRequest(req: any) {
  const session = req?.teacherSession || readTeacherSession(req);
  if (!session) return 0;
  return Number(getTeacherUserByEmail(session.email)?.id || 1);
}

function getTeacherPackBoard(teacherUserId: number) {
  const rawPacks = db
    .prepare('SELECT * FROM quiz_packs WHERE teacher_id = ? ORDER BY created_at DESC, id DESC')
    .all(teacherUserId);

  const hydratedPacks = rawPacks.map((pack: any) => hydratePack(pack));
  const packIds = uniqueNumbers(hydratedPacks.map((pack: any) => pack.id));
  const sessions = packIds.length
    ? db
        .prepare(`SELECT * FROM sessions WHERE quiz_pack_id IN (${packIds.map(() => '?').join(', ')})`)
        .all(...packIds)
    : [];
  const sessionIds = uniqueNumbers(sessions.map((session: any) => session.id));
  const participantCounts = new Map<number, number>();

  if (sessionIds.length) {
    const rows = db
      .prepare(
        `SELECT session_id, COUNT(*) as count
         FROM participants
         WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})
         GROUP BY session_id`,
      )
      .all(...sessionIds);
    rows.forEach((row: any) => {
      participantCounts.set(Number(row.session_id), Number(row.count || 0));
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
    };
  });
}

function buildPackCopyTitle(teacherUserId: number, originalTitle: string) {
  const baseTitle = `${String(originalTitle || 'Untitled pack').trim()} (Copy)`;
  const existingTitles = new Set(
    db
      .prepare('SELECT title FROM quiz_packs WHERE teacher_id = ?')
      .all(teacherUserId)
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

function getParticipantsForNickname(nickname: string) {
  return db.prepare('SELECT * FROM participants WHERE nickname = ?').all(nickname);
}

function getLogsForParticipantIds(participantIds: number[]) {
  if (participantIds.length === 0) return [];
  const placeholders = participantIds.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM student_behavior_logs WHERE participant_id IN (${placeholders})`)
    .all(...participantIds);
}

function getSessionsForIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM sessions WHERE id IN (${placeholders})`).all(...sessionIds);
}

function getPacksForIds(packIds: number[]) {
  if (packIds.length === 0) return [];
  const placeholders = packIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM quiz_packs WHERE id IN (${placeholders})`).all(...packIds);
}

function getQuestionsForPackIds(packIds: number[]) {
  if (packIds.length === 0) return [];
  const placeholders = packIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM questions WHERE quiz_pack_id IN (${placeholders})`).all(...packIds);
}

function getParticipantsForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM participants WHERE session_id IN (${placeholders})`).all(...sessionIds);
}

function getAnswersForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM answers WHERE session_id IN (${placeholders})`).all(...sessionIds);
}

function getBehaviorLogsForSessionIds(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM student_behavior_logs WHERE session_id IN (${placeholders})`).all(...sessionIds);
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

async function getOverallStudentAnalytics(nickname: string) {
  const participants = getParticipantsForNickname(nickname);
  const participantIds = uniqueNumbers(participants.map((row: any) => row.id));
  const sessionIds = uniqueNumbers(participants.map((row: any) => row.session_id));
  const sessions = getSessionsForIds(sessionIds);
  const packs = getPacksForIds(uniqueNumbers(sessions.map((row: any) => row.quiz_pack_id)));

  return runPythonEngine<any>('student-dashboard', {
    nickname,
    mastery: getMasteryRows(nickname),
    answers: db
      .prepare(`
        SELECT a.*
        FROM answers a
        JOIN participants p ON a.participant_id = p.id
        WHERE p.nickname = ?
      `)
      .all(nickname),
    questions: db.prepare('SELECT * FROM questions').all(),
    behavior_logs: getLogsForParticipantIds(participantIds),
    practice_attempts: db.prepare('SELECT * FROM practice_attempts WHERE nickname = ?').all(nickname),
    sessions,
    packs,
  });
}

async function getSessionStudentContext(sessionId: number, participantId: number) {
  const classPayload = getSessionPayload(sessionId);
  if (!classPayload) return null;

  const participant = classPayload.participants.find((row: any) => Number(row.id) === participantId);
  if (!participant) return null;

  const mastery = getMasteryRows(participant.nickname);
  const practice_attempts = db.prepare('SELECT * FROM practice_attempts WHERE nickname = ?').all(participant.nickname);
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
  const overallAnalytics = await getOverallStudentAnalytics(participant.nickname);

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

// --- Teacher Routes ---

router.post('/auth/register', (req, res) => {
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

  const existingUser = getTeacherUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });
  }

  const createdUser = createTeacherUser({
    email,
    password,
    name,
    school,
  });
  const { session, token } = createTeacherSession({ email: createdUser.email, provider: 'password' });
  issueTeacherSession(req, res, token);
  res.status(201).json(session);
});

router.get('/auth/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = readTeacherSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  res.json(session);
});

router.post('/auth/login', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'auth-login', 8, 10 * 60 * 1000)) return;

  const email = normalizeTeacherEmail(String(req.body?.email || ''));
  const password = String(req.body?.password || '');
  const teacherUser = getTeacherUserByEmail(email);

  if (teacherUser?.password_hash && verifyTeacherPassword(password, teacherUser.password_hash)) {
    const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'password' });
    issueTeacherSession(req, res, token);
    return res.json(session);
  }

  if (!isDemoTeacherEmail(email) || !verifyDemoPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const { session, token } = createTeacherSession({ email, provider: 'password' });
  issueTeacherSession(req, res, token);
  res.json(session);
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
    
    let teacherUser = getTeacherUserByEmail(email);
    if (!teacherUser) {
      // Auto-register the teacher if they don't exist
      teacherUser = createTeacherUser({
        email,
        password: randomBytes(32).toString('hex'), // Secure unguessable random password
        name,
        school: '',
      });
    }

    const { session, token } = createTeacherSession({ email: teacherUser.email, provider: 'google' });
    issueTeacherSession(req, res, token);
    res.json(session);
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

// Get all packs
router.get('/packs', (req, res) => {
  res.json(listHydratedPacks());
});

router.get('/teacher/packs', requireTeacherSession, (req, res) => {
  try {
    const teacherUserId = getTeacherUserIdFromRequest(req);
    if (!teacherUserId) {
      return res.status(401).json({ error: 'Teacher authentication required' });
    }
    res.json(getTeacherPackBoard(teacherUserId));
  } catch (error: any) {
    console.error('[ERROR] Teacher pack board failed:', error);
    res.status(500).json({ error: error.message || 'Failed to load teacher packs' });
  }
});

// Get a specific pack with questions
router.get('/packs/:id', (req, res) => {
  const pack = getHydratedPackWithQuestions(Number(req.params.id));
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json(pack);
});

router.post('/teacher/packs/:id/duplicate', requireTeacherSession, (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-pack-duplicate', 30, 10 * 60 * 1000)) return;

  const teacherUserId = getTeacherUserIdFromRequest(req);
  const packId = parsePositiveInt(req.params.id);
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }

  const pack = db.prepare('SELECT * FROM quiz_packs WHERE id = ? AND teacher_id = ?').get(packId, teacherUserId) as any;
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
    .all(packId) as any[];
  const copyTitle = buildPackCopyTitle(teacherUserId, pack.title);

  const duplicatePack = db.transaction(() => {
    const packResult = db.prepare(`
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
    `).run(
      teacherUserId,
      copyTitle,
      pack.source_text,
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
        answers_json,
        correct_index,
        explanation,
        tags_json,
        difficulty,
        time_limit_seconds,
        question_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    questions.forEach((question: any, index: number) => {
      insertQuestion.run(
        newPackId,
        question.type || 'multiple_choice',
        question.prompt,
        question.answers_json,
        question.correct_index,
        question.explanation,
        question.tags_json,
        question.difficulty || 3,
        question.time_limit_seconds || 20,
        Number(question.question_order || index),
      );
    });

    syncPackDerivedData(newPackId, pack.source_text || '', questions.map((question: any, index: number) => ({
      prompt: question.prompt,
      answers: parseJsonArray(question.answers_json),
      correct_index: Number(question.correct_index || 0),
      explanation: question.explanation,
      tags: parseJsonArray(question.tags_json),
      time_limit_seconds: Number(question.time_limit_seconds || 20),
      question_order: Number(question.question_order || index),
    })));

    return getTeacherPackBoard(teacherUserId).find((entry: any) => Number(entry.id) === newPackId);
  });

  const duplicatedPack = duplicatePack();
  res.status(201).json(duplicatedPack);
});

router.delete('/teacher/packs/:id', requireTeacherSession, (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-pack-delete', 20, 10 * 60 * 1000)) return;

  const teacherUserId = getTeacherUserIdFromRequest(req);
  const packId = parsePositiveInt(req.params.id);
  if (!teacherUserId) {
    return res.status(401).json({ error: 'Teacher authentication required' });
  }

  const pack = db.prepare('SELECT * FROM quiz_packs WHERE id = ? AND teacher_id = ?').get(packId, teacherUserId) as any;
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  const sessions = db.prepare('SELECT id, status FROM sessions WHERE quiz_pack_id = ?').all(packId) as any[];
  const activeSessions = sessions.filter((session: any) => String(session.status || '').toUpperCase() !== 'ENDED');
  if (activeSessions.length > 0) {
    return res.status(409).json({ error: 'End the active live session before deleting this pack.' });
  }

  const sessionIds = uniqueNumbers(sessions.map((session: any) => session.id));
  const participantIds = sessionIds.length
    ? uniqueNumbers(
        db
          .prepare(`SELECT id FROM participants WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
          .all(...sessionIds)
          .map((row: any) => row.id),
      )
    : [];
  const questionIds = uniqueNumbers(
    db.prepare('SELECT id FROM questions WHERE quiz_pack_id = ?').all(packId).map((row: any) => row.id),
  );

  const impact = {
    sessions: sessionIds.length,
    participants: participantIds.length,
    questions: questionIds.length,
    answers: sessionIds.length
      ? Number(
          db
            .prepare(`SELECT COUNT(*) as count FROM answers WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
            .get(...sessionIds)?.count || 0,
        )
      : 0,
    behavior_logs: sessionIds.length
      ? Number(
          db
            .prepare(`SELECT COUNT(*) as count FROM student_behavior_logs WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`)
            .get(...sessionIds)?.count || 0,
        )
      : 0,
    practice_attempts: questionIds.length
      ? Number(
          db
            .prepare(`SELECT COUNT(*) as count FROM practice_attempts WHERE question_id IN (${questionIds.map(() => '?').join(', ')})`)
            .get(...questionIds)?.count || 0,
        )
      : 0,
  };

  const deletePackCascade = db.transaction(() => {
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

  deletePackCascade();
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

    const materialProfile = text ? getOrCreateMaterialProfile(text) : null;
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
  if (!enforceRateLimit(req, res, 'teacher-pack-generate', 20, 10 * 60 * 1000)) return;
  const source_text = sanitizeMultiline(req.body?.source_text, 120000);
  const count = Math.min(20, Math.max(3, parsePositiveInt(req.body?.count, 5)));
  const difficulty = sanitizeLine(req.body?.difficulty || 'Medium', 24);
  const language = sanitizeLine(req.body?.language || 'English', 24);

  console.log(`[AI GEN] Request: ${count} questions, ${difficulty} difficulty, ${language} language, text length: ${source_text?.length}`);

  if (!source_text) return res.status(400).json({ error: 'Source text is required' });

  try {
    const materialProfile = getOrCreateMaterialProfile(source_text);
    const generationSource = buildGenerationSource(materialProfile);
    const cached = getCachedQuestionGeneration(
      Number(materialProfile.id),
      Number(count),
      String(difficulty),
      String(language),
    );

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

    const isHebrew = language.toLowerCase() === 'hebrew';
    const langInstruction = isHebrew
      ? "CRITICAL: ALL output text (prompt, answers, explanation, tags) MUST be in HEBREW (עברית). This is an absolute requirement. Do not use English for anything."
      : "The output MUST be in English.";

    const prompt = `Task: Generate exactly ${count} multiple-choice questions from the provided educational material.
Difficulty Level: ${difficulty}
Output Language: ${language}
${langInstruction}

Constraint: Return ONLY a raw JSON object matching the schema below. No markdown formatting, no preamble.
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

    // Using the unified SDK (GoogleGenAI)
    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });
    } catch (modelError: any) {
      console.error('[CRITICAL] Gemini Model Error:', modelError);
      return res.status(500).json({ error: 'AI Model failed: ' + modelError.message });
    }

    const text = response.text;
    console.log('[DEBUG] Gemini Raw Response Received');

    try {
      // Clean possible markdown wrapping
      const cleanJson = text?.replace(/```json\n?|\n?```/g, '').trim() || '{}';
      const data = JSON.parse(cleanJson);
      const normalizedQuestions = normalizeGeneratedQuestions(
        data?.questions || [],
        materialProfile.topic_fingerprint || [],
      );
      const responsePayload = {
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
      saveCachedQuestionGeneration(
        Number(materialProfile.id),
        Number(count),
        String(difficulty),
        String(language),
        responsePayload,
      );
      res.json(responsePayload);
    } catch (parseError: any) {
      console.error('[ERROR] Failed to parse Gemini response:', text);
      res.status(500).json({ error: 'Failed to parse AI response', raw: text });
    }
  } catch (error: any) {
    console.error('[ERROR] Generate Route Crash:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new pack
router.post('/packs', requireTeacherSession, (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-pack-create', 30, 10 * 60 * 1000)) return;
  const teacherSession = readTeacherSession(req);
  const teacherUserId = Number((teacherSession && getTeacherUserByEmail(teacherSession.email)?.id) || 1);
  const title = sanitizeLine(req.body?.title, 120);
  const source_text = sanitizeMultiline(req.body?.source_text, 120000);
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!title) {
    return res.status(400).json({ error: 'Pack title is required' });
  }
  if (questions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  const materialProfile = getOrCreateMaterialProfile(source_text || '');
  const normalizedQuestions = normalizeGeneratedQuestions(
    Array.isArray(questions) ? questions : [],
    materialProfile.topic_fingerprint || [],
  );

  const insertPack = db.prepare(`
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
  `);
  const info = insertPack.run(
    teacherUserId,
    title,
    source_text,
    materialProfile.source_hash,
    materialProfile.source_excerpt,
    materialProfile.source_language,
    materialProfile.word_count,
    materialProfile.id,
  ); // Hardcoded teacher 1
  const packId = info.lastInsertRowid;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      quiz_pack_id,
      prompt,
      answers_json,
      correct_index,
      explanation,
      tags_json,
      time_limit_seconds,
      question_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((qs: any[]) => {
    for (const q of qs) {
      insertQuestion.run(
        packId,
        q.prompt,
        JSON.stringify(q.answers),
        q.correct_index,
        q.explanation,
        JSON.stringify(q.tags),
        q.time_limit_seconds || 20,
        q.question_order || 0,
      );
    }
  });

  insertMany(normalizedQuestions);
  syncPackDerivedData(Number(packId), source_text || '', normalizedQuestions);

  res.json({ id: packId, title, question_count: normalizedQuestions.length });
});

// Host a session
router.post('/sessions', requireTeacherSession, (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-session-create', 30, 10 * 60 * 1000)) return;
  const { quiz_pack_id, game_type = 'classic_quiz', team_count = 0, mode_config = {} } = req.body;
  const packId = parsePositiveInt(quiz_pack_id);
  const packExists = db.prepare('SELECT id FROM quiz_packs WHERE id = ?').get(packId);
  if (!packExists) {
    return res.status(404).json({ error: 'Quiz pack not found' });
  }
  const pin = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN
  const normalizedGameType = String(game_type || 'classic_quiz').trim() || 'classic_quiz';
  const normalizedTeamCount = isTeamGame(normalizedGameType) ? Math.max(2, Number(team_count) || 4) : 0;

  const insertSession = db.prepare(`
    INSERT INTO sessions (quiz_pack_id, pin, game_type, team_count, mode_config_json, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = insertSession.run(
    packId,
    pin,
    normalizedGameType,
    normalizedTeamCount,
    JSON.stringify(mode_config || {}),
    'LOBBY',
  );

  res.json({
    id: info.lastInsertRowid,
    pin,
    status: 'LOBBY',
    game_type: normalizedGameType,
    team_count: normalizedTeamCount,
    mode_config: mode_config || {},
  });
});

// Get session by PIN
router.get('/sessions/:pin', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE pin = ?').get(req.params.pin);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(hydrateSessionRow(session));
});

router.get('/sessions/:pin/participants', (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE pin = ?').get(req.params.pin);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participants = db
    .prepare('SELECT id, nickname, team_id, team_name, seat_index, created_at FROM participants WHERE session_id = ? ORDER BY created_at ASC, id ASC')
    .all(session.id);

  res.json({
    session_id: session.id,
    participants,
  });
});

// Update session state
router.put('/sessions/:id/state', requireTeacherSession, (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'teacher-session-state', 300, 5 * 60 * 1000)) return;
  const { status, current_question_index } = req.body;
  const sessionId = Number(req.params.id);

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

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (session) {
    let questionPayload = null;
    if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVEAL') {
      const question = db
        .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC LIMIT 1 OFFSET ?')
        .get(session.quiz_pack_id, current_question_index);
      if (question) {
        questionPayload = { ...question, answers: JSON.parse(question.answers_json) };
        delete questionPayload.answers_json;
        if (status === 'QUESTION_ACTIVE') {
          delete questionPayload.correct_index; // Hide from clients during active
          delete questionPayload.explanation;
        }
      }
    }

    broadcastToSession(sessionId, 'STATE_CHANGE', {
      status,
      current_question_index,
      question: questionPayload,
      game_type: session.game_type,
      team_count: Number(session.team_count || 0),
    });
  }

  res.json({ success: true });
});

// --- Student Routes ---

// Join a session
router.post('/sessions/:pin/join', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  if (!enforceRateLimit(req, res, 'student-join', 20, 5 * 60 * 1000)) return;

  const nickname = sanitizeLine(req.body?.nickname, 24);
  const session = hydrateSessionRow(db.prepare('SELECT * FROM sessions WHERE pin = ?').get(req.params.pin));

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'LOBBY') return res.status(400).json({ error: 'Session already started' });
  if (nickname.length < 2) return res.status(400).json({ error: 'Nickname must be at least 2 characters' });

  // Check if nickname exists
  const existing = db.prepare('SELECT id FROM participants WHERE session_id = ? AND nickname = ?').get(session.id, nickname);
  if (existing) return res.status(400).json({ error: 'Nickname taken' });

  const currentCount = Number(
    db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id).count || 0,
  );
  const assignedTeamId = isTeamGame(session.game_type) ? (currentCount % Math.max(2, session.team_count || 4)) + 1 : 0;
  const assignedTeamName = assignedTeamId > 0 ? buildTeamIdentity(assignedTeamId) : null;
  const seatIndex =
    assignedTeamId > 0
      ? Number(
          db
            .prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ? AND team_id = ?')
            .get(session.id, assignedTeamId).count || 0,
        ) + 1
      : currentCount + 1;

  const insert = db.prepare(`
    INSERT INTO participants (session_id, nickname, team_id, team_name, seat_index)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = insert.run(session.id, nickname, assignedTeamId, assignedTeamName, seatIndex);

  const total = db.prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?').get(session.id).count;

  broadcastToSession(session.id, 'PARTICIPANT_JOINED', {
    nickname,
    participant_id: Number(info.lastInsertRowid),
    total_participants: total,
    team_id: assignedTeamId,
    team_name: assignedTeamName,
    game_type: session.game_type,
  });

  res.json({
    participant_id: info.lastInsertRowid,
    session_id: session.id,
    game_type: session.game_type,
    team_id: assignedTeamId,
    team_name: assignedTeamName,
    seat_index: seatIndex,
  });
});

// Submit answer
router.post('/sessions/:pin/answer', async (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const participant_id = parsePositiveInt(req.body?.participant_id);
  const question_id = parsePositiveInt(req.body?.question_id);
  const chosen_index = Math.max(0, Number(req.body?.chosen_index) || 0);
  const response_ms = Math.max(0, Number(req.body?.response_ms) || 0);
  const telemetry = req.body?.telemetry || {};

  try {
    const session = db.prepare('SELECT id, status FROM sessions WHERE pin = ?').get(req.params.pin);

    if (!session || session.status !== 'QUESTION_ACTIVE') {
      return res.status(400).json({ error: 'Invalid session state' });
    }

    const question = db
      .prepare('SELECT correct_index, time_limit_seconds, tags_json FROM questions WHERE id = ?')
      .get(question_id);
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const participant = db
      .prepare('SELECT nickname FROM participants WHERE id = ? AND session_id = ?')
      .get(participant_id, session.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const isCorrect = Number(chosen_index) === Number(question.correct_index);
    const outcome = await runPythonEngine<{
      score_awarded: number;
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'session',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: question.time_limit_seconds,
      tags: parseJsonArray(question.tags_json),
      current_mastery: getMasteryRows(participant.nickname),
    });

    const insertAnswer = db.prepare(`
      INSERT INTO answers (session_id, question_id, participant_id, chosen_index, is_correct, response_ms, score_awarded)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertAnswer.run(
      session.id,
      question_id,
      participant_id,
      chosen_index,
      isCorrect ? 1 : 0,
      response_ms,
      outcome.score_awarded,
    );

    if (telemetry) {
      const insertTelemetry = db.prepare(`
        INSERT INTO student_behavior_logs (
          session_id, question_id, participant_id,
          tfi_ms, final_decision_buffer_ms, total_swaps, panic_swaps,
          answer_path_json, focus_loss_count, idle_time_ms, blur_time_ms,
          longest_idle_streak_ms, pointer_activity_count, keyboard_activity_count,
          touch_activity_count, same_answer_reclicks, option_dwell_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertTelemetry.run(
        session.id,
        question_id,
        participant_id,
        telemetry.tfi_ms || 0,
        telemetry.final_decision_buffer_ms || 0,
        telemetry.total_swaps || 0,
        telemetry.panic_swaps || 0,
        telemetry.answer_path_json || '[]',
        telemetry.focus_loss_count || 0,
        telemetry.idle_time_ms || 0,
        telemetry.blur_time_ms || 0,
        telemetry.longest_idle_streak_ms || 0,
        telemetry.pointer_activity_count || 0,
        telemetry.keyboard_activity_count || 0,
        telemetry.touch_activity_count || 0,
        telemetry.same_answer_reclicks || 0,
        telemetry.option_dwell_json || '{}',
      );
    }

    if (outcome.mastery_updates.length > 0) {
      applyMasteryUpdates(participant.nickname, outcome.mastery_updates);
    }

    const totalAnswers = db
      .prepare('SELECT COUNT(*) as count FROM answers WHERE session_id = ? AND question_id = ?')
      .get(session.id, question_id).count;
    const totalParticipants = db
      .prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?')
      .get(session.id).count;

    broadcastToSession(session.id, 'ANSWER_RECEIVED', {
      total_answers: totalAnswers,
      expected: totalParticipants,
    });
    res.json({
      success: true,
      score_awarded: outcome.score_awarded,
      total_answers: Number(totalAnswers || 0),
      expected: Number(totalParticipants || 0),
    });
  } catch (error: any) {
    console.error('[ERROR] Session answer failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Broadcast student selection (pre-lock-in)
router.post('/sessions/:pin/selection', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const participant_id = parsePositiveInt(req.body?.participant_id);
  const chosen_index = Math.max(0, Number(req.body?.chosen_index) || 0);
  const session = db.prepare('SELECT id, status FROM sessions WHERE pin = ?').get(req.params.pin);

  if (!session || session.status !== 'QUESTION_ACTIVE') {
    return res.status(400).json({ error: 'Invalid session state' });
  }

  const participant = db.prepare('SELECT nickname FROM participants WHERE id = ?').get(participant_id);

  broadcastToSession(session.id, 'SELECTION_CHANGE', {
    participant_id,
    nickname: participant?.nickname,
    chosen_index
  });

  res.json({ success: true });
});

// Broadcast student focus loss
router.post('/sessions/:pin/focus-loss', (req, res) => {
  if (!enforceTrustedOrigin(req, res)) return;
  const participant_id = parsePositiveInt(req.body?.participant_id);
  const session = db.prepare('SELECT id FROM sessions WHERE pin = ?').get(req.params.pin);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participant = db.prepare('SELECT nickname FROM participants WHERE id = ?').get(participant_id);

  broadcastToSession(session.id, 'FOCUS_LOST', {
    participant_id,
    nickname: participant?.nickname
  });

  res.json({ success: true });
});

// --- SSE Stream ---
router.get('/sessions/:pin/stream', (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE pin = ?').get(req.params.pin);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = session.id;
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, []);
  }
  sseClients.get(sessionId)!.push(res);

  req.on('close', () => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      sseClients.set(sessionId, clients.filter(c => c !== res));
    }
  });
});

// --- Analytics ---
router.get('/analytics/class/:sessionId', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const sessionId = Number(req.params.sessionId);
    const payload = getSessionPayload(sessionId);
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    const dashboard = await runPythonEngine<unknown>('class-dashboard', payload);
    res.json(dashboard);
  } catch (error: any) {
    console.error('[ERROR] Class analytics failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/class/:sessionId/student/:participantId', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const sessionId = Number(req.params.sessionId);
    const participantId = Number(req.params.participantId);
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
    res.status(500).json({ error: error.message });
  }
});

router.post('/analytics/class/:sessionId/student/:participantId/adaptive-game', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const sessionId = Number(req.params.sessionId);
    const participantId = Number(req.params.participantId);
    const requestedCount = Math.max(1, Number(req.body?.count) || 5);
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
    const adaptiveProfile = getOrCreateMaterialProfile(context.classPayload.pack?.source_text || '');
    const teacherUserId = Number(getTeacherUserByEmail(session.email)?.id || 1);
    const packInfo = db
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
      );
    const adaptivePackId = Number(packInfo.lastInsertRowid);

    const insertQuestion = db.prepare(`
      INSERT INTO questions (
        quiz_pack_id,
        type,
        prompt,
        answers_json,
        correct_index,
        explanation,
        tags_json,
        difficulty,
        time_limit_seconds,
        question_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertQuestions = db.transaction((questions: any[]) => {
      questions.forEach((question, index) => {
        insertQuestion.run(
          adaptivePackId,
          question.type || 'multiple_choice',
          question.prompt,
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
    syncPackDerivedData(adaptivePackId, context.classPayload.pack?.source_text || '', adaptiveGame.questions);

    const pin = Math.floor(100000 + Math.random() * 900000).toString();
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/student/:nickname', async (req, res) => {
  try {
    const nickname = req.params.nickname;
    const dashboard = await getOverallStudentAnalytics(nickname);

    res.json(dashboard);
  } catch (error: any) {
    console.error('[ERROR] Student analytics failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Adaptive Practice ---
router.get('/practice/:nickname', async (req, res) => {
  try {
    const nickname = req.params.nickname;
    const practiceSet = await runPythonEngine<unknown>('practice-set', {
      nickname,
      mastery: getMasteryRows(nickname),
      questions: db.prepare('SELECT * FROM questions').all(),
      practice_attempts: db.prepare('SELECT * FROM practice_attempts WHERE nickname = ?').all(nickname),
      count: 5,
    });

    res.json(practiceSet);
  } catch (error: any) {
    console.error('[ERROR] Practice selection failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/practice/:nickname/answer', async (req, res) => {
  const { question_id, chosen_index, response_ms } = req.body;
  const nickname = req.params.nickname;

  try {
    const question = db
      .prepare('SELECT correct_index, explanation, tags_json, time_limit_seconds FROM questions WHERE id = ?')
      .get(question_id);
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const isCorrect = Number(chosen_index) === Number(question.correct_index);
    const outcome = await runPythonEngine<{
      mastery_updates: Array<{ tag: string; score: number }>;
    }>('answer-outcome', {
      mode: 'practice',
      is_correct: isCorrect,
      response_ms,
      time_limit_seconds: question.time_limit_seconds,
      tags: parseJsonArray(question.tags_json),
      current_mastery: getMasteryRows(nickname),
    });

    db.prepare(`
      INSERT INTO practice_attempts (nickname, question_id, is_correct, response_ms)
      VALUES (?, ?, ?, ?)
    `).run(nickname, question_id, isCorrect ? 1 : 0, response_ms);

    if (outcome.mastery_updates.length > 0) {
      applyMasteryUpdates(nickname, outcome.mastery_updates);
    }

    res.json({
      is_correct: isCorrect,
      correct_index: question.correct_index,
      explanation: question.explanation,
    });
  } catch (error: any) {
    console.error('[ERROR] Practice answer failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Telemetry Reporting Routes ---

// Get class telemetry heatmap data
router.get('/reports/class/:session_id', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const sessionId = Number(req.params.session_id);
    const payload = getSessionPayload(sessionId);
    if (!payload) return res.status(404).json({ error: 'Session not found' });

    const report = await runPythonEngine<unknown>('class-dashboard', payload);
    res.json(report);
  } catch (error: any) {
    console.error('[ERROR] Class report failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get student personal power map & behavioral stats
router.get('/reports/student/:participant_id', async (req, res) => {
  try {
    const participantId = Number(req.params.participant_id);
    const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(participant.session_id);
    const pack = session
      ? db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(session.quiz_pack_id)
      : null;
    const questions = session
      ? db.prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC').all(session.quiz_pack_id)
      : db.prepare('SELECT * FROM questions').all();

    const report = await runPythonEngine<any>('student-dashboard', {
      nickname: participant.nickname,
      mastery: getMasteryRows(participant.nickname),
      answers: db.prepare('SELECT * FROM answers WHERE participant_id = ?').all(participantId),
      questions,
      behavior_logs: db.prepare('SELECT * FROM student_behavior_logs WHERE participant_id = ?').all(participantId),
      practice_attempts: db.prepare('SELECT * FROM practice_attempts WHERE nickname = ?').all(participant.nickname),
      sessions: session ? [session] : [],
      packs: pack ? [pack] : [],
    });

    res.json({
      ...report,
      participant,
      session,
      pack,
    });
  } catch (error: any) {
    console.error('[ERROR] Student report failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/dashboard/teacher/overview', async (req, res) => {
  const session = readTeacherSession(req);
  if (!session) return res.status(401).json({ error: 'Teacher authentication required' });
  try {
    const teacherUserId = Number(getTeacherUserByEmail(session.email)?.id || 1);
    const packs = db.prepare('SELECT * FROM quiz_packs WHERE teacher_id = ?').all(teacherUserId);
    const packIds = uniqueNumbers(packs.map((pack: any) => pack.id));
    const sessions = packIds.length
      ? db
          .prepare(
            `SELECT * FROM sessions WHERE quiz_pack_id IN (${packIds.map(() => '?').join(', ')})`,
          )
          .all(...packIds)
      : [];
    const sessionIds = uniqueNumbers(sessions.map((row: any) => row.id));

    const overview = await runPythonEngine<unknown>('teacher-overview', {
      packs,
      sessions,
      participants: getParticipantsForSessionIds(sessionIds),
      answers: getAnswersForSessionIds(sessionIds),
      questions: getQuestionsForPackIds(packIds),
      behavior_logs: getBehaviorLogsForSessionIds(sessionIds),
    });

    res.json(overview);
  } catch (error: any) {
    console.error('[ERROR] Teacher overview failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
