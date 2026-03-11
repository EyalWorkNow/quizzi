import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'quizzi.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

function columnExists(table: string, column: string) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row: any) => row.name === column);
}

function ensureColumn(table: string, column: string, definition: string) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Initialize schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quiz_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER,
      title TEXT,
      source_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_pack_id INTEGER,
      type TEXT DEFAULT 'multiple_choice',
      prompt TEXT,
      answers_json TEXT,
      correct_index INTEGER,
      explanation TEXT,
      tags_json TEXT,
      difficulty INTEGER DEFAULT 3,
      time_limit_seconds INTEGER DEFAULT 20
    );

    CREATE TABLE IF NOT EXISTS material_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_hash TEXT UNIQUE,
      normalized_text TEXT,
      source_excerpt TEXT,
      teaching_brief TEXT,
      source_language TEXT,
      word_count INTEGER DEFAULT 0,
      char_count INTEGER DEFAULT 0,
      paragraph_count INTEGER DEFAULT 0,
      key_points_json TEXT DEFAULT '[]',
      topic_fingerprint_json TEXT DEFAULT '[]',
      supporting_excerpts_json TEXT DEFAULT '[]',
      estimated_original_tokens INTEGER DEFAULT 0,
      estimated_prompt_tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS question_generation_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_profile_id INTEGER,
      difficulty TEXT,
      output_language TEXT,
      question_count INTEGER,
      prompt_version TEXT,
      response_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_profile_id, difficulty, output_language, question_count, prompt_version)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_pack_id INTEGER,
      pin TEXT UNIQUE,
      game_type TEXT DEFAULT 'classic_quiz',
      team_count INTEGER DEFAULT 0,
      mode_config_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'LOBBY',
      current_question_index INTEGER DEFAULT 0,
      started_at DATETIME,
      ended_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      nickname TEXT,
      team_id INTEGER DEFAULT 0,
      team_name TEXT,
      seat_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      chosen_index INTEGER,
      is_correct BOOLEAN,
      response_ms INTEGER,
      score_awarded INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_behavior_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      tfi_ms INTEGER,
      final_decision_buffer_ms INTEGER,
      total_swaps INTEGER DEFAULT 0,
      panic_swaps INTEGER DEFAULT 0,
      answer_path_json TEXT, -- [{ index: number, timestamp: number }]
      focus_loss_count INTEGER DEFAULT 0,
      idle_time_ms INTEGER DEFAULT 0,
      blur_time_ms INTEGER DEFAULT 0,
      longest_idle_streak_ms INTEGER DEFAULT 0,
      pointer_activity_count INTEGER DEFAULT 0,
      keyboard_activity_count INTEGER DEFAULT 0,
      touch_activity_count INTEGER DEFAULT 0,
      same_answer_reclicks INTEGER DEFAULT 0,
      option_dwell_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mastery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT,
      tag TEXT,
      score INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(nickname, tag)
    );

    CREATE TABLE IF NOT EXISTS practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT,
      question_id INTEGER,
      is_correct BOOLEAN,
      response_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_pin ON sessions(pin);
    CREATE INDEX IF NOT EXISTS idx_sessions_pack_status ON sessions(quiz_pack_id, status);
    CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
    CREATE INDEX IF NOT EXISTS idx_participants_nickname_session ON participants(nickname, session_id);
    CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_answers_participant_session ON answers(participant_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_questions_pack_order ON questions(quiz_pack_id, id);
    CREATE INDEX IF NOT EXISTS idx_behavior_participant_session ON student_behavior_logs(participant_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_mastery_nickname ON mastery(nickname);
    CREATE INDEX IF NOT EXISTS idx_practice_attempts_nickname_question ON practice_attempts(nickname, question_id);
    CREATE INDEX IF NOT EXISTS idx_material_profiles_hash ON material_profiles(source_hash);
    CREATE INDEX IF NOT EXISTS idx_generation_cache_lookup ON question_generation_cache(material_profile_id, difficulty, output_language, question_count);
  `);

  ensureColumn('quiz_packs', 'source_hash', 'TEXT');
  ensureColumn('users', 'first_name', 'TEXT');
  ensureColumn('users', 'last_name', 'TEXT');
  ensureColumn('users', 'school', 'TEXT');
  ensureColumn('users', 'auth_provider', "TEXT DEFAULT 'password'");
  ensureColumn('users', 'updated_at', 'DATETIME');
  ensureColumn('quiz_packs', 'source_excerpt', 'TEXT');
  ensureColumn('quiz_packs', 'source_language', "TEXT DEFAULT 'English'");
  ensureColumn('quiz_packs', 'source_word_count', 'INTEGER DEFAULT 0');
  ensureColumn('quiz_packs', 'material_profile_id', 'INTEGER');
  ensureColumn('quiz_packs', 'top_tags_json', "TEXT DEFAULT '[]'");
  ensureColumn('quiz_packs', 'question_count_cache', 'INTEGER DEFAULT 0');
  ensureColumn('questions', 'question_order', 'INTEGER DEFAULT 0');
  ensureColumn('sessions', 'game_type', "TEXT DEFAULT 'classic_quiz'");
  ensureColumn('sessions', 'team_count', 'INTEGER DEFAULT 0');
  ensureColumn('sessions', 'mode_config_json', "TEXT DEFAULT '{}'");
  ensureColumn('participants', 'team_id', 'INTEGER DEFAULT 0');
  ensureColumn('participants', 'team_name', 'TEXT');
  ensureColumn('participants', 'seat_index', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'blur_time_ms', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'longest_idle_streak_ms', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'pointer_activity_count', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'keyboard_activity_count', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'touch_activity_count', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'same_answer_reclicks', 'INTEGER DEFAULT 0');
  ensureColumn('student_behavior_logs', 'option_dwell_json', "TEXT DEFAULT '{}'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quiz_packs_profile ON quiz_packs(material_profile_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_packs_source_hash ON quiz_packs(source_hash);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_questions_pack_question_order ON questions(quiz_pack_id, question_order, id);
    CREATE INDEX IF NOT EXISTS idx_sessions_game_type ON sessions(game_type);
    CREATE INDEX IF NOT EXISTS idx_participants_session_team ON participants(session_id, team_id);
  `);

  db.exec(`
    UPDATE questions
    SET question_order = id
    WHERE question_order IS NULL OR question_order = 0;

    UPDATE quiz_packs
    SET source_excerpt = SUBSTR(COALESCE(source_text, ''), 1, 320)
    WHERE source_excerpt IS NULL OR source_excerpt = '';

    UPDATE quiz_packs
    SET source_word_count = (
      LENGTH(TRIM(COALESCE(source_text, ''))) - LENGTH(REPLACE(TRIM(COALESCE(source_text, '')), ' ', '')) + 1
    )
    WHERE source_text IS NOT NULL
      AND TRIM(source_text) <> ''
      AND (source_word_count IS NULL OR source_word_count = 0);

    UPDATE quiz_packs
    SET question_count_cache = (
      SELECT COUNT(*)
      FROM questions
      WHERE questions.quiz_pack_id = quiz_packs.id
    )
    WHERE question_count_cache IS NULL OR question_count_cache = 0;

    UPDATE users
    SET auth_provider = 'password'
    WHERE auth_provider IS NULL OR auth_provider = '';

    UPDATE users
    SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL;
  `);
}

export function seedDemoData() {
  // Check if demo data exists
  const packExists = db.prepare('SELECT id FROM quiz_packs WHERE title = ?').get('Demo: Biology 101');
  if (packExists) return;

  const insertTeacher = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  const resTeacher = insertTeacher.run('demo@quizzi.app', 'hashed_demo_pw');
  const teacherId = resTeacher.lastInsertRowid;

  const insertPack = db.prepare('INSERT INTO quiz_packs (teacher_id, title, source_text, source_excerpt, source_language, source_word_count) VALUES (?, ?, ?, ?, ?, ?)');
  const demoSourceText = 'Photosynthesis is the process by which plants use sunlight, water, and carbon dioxide to create oxygen and energy in the form of sugar.';
  const resPack = insertPack.run(
    teacherId,
    'Demo: Biology 101',
    demoSourceText,
    demoSourceText.slice(0, 320),
    'English',
    demoSourceText.split(/\s+/).length,
  );
  const packId = resPack.lastInsertRowid;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (quiz_pack_id, prompt, answers_json, correct_index, explanation, tags_json, time_limit_seconds, question_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertQuestion.run(
    packId,
    'What is the primary energy source for photosynthesis?',
    JSON.stringify(['Water', 'Soil', 'Sunlight', 'Oxygen']),
    2,
    'Plants use sunlight to convert water and carbon dioxide into energy.',
    JSON.stringify(['photosynthesis', 'energy']),
    20,
    1
  );

  insertQuestion.run(
    packId,
    'Which gas do plants absorb during photosynthesis?',
    JSON.stringify(['Oxygen', 'Carbon Dioxide', 'Nitrogen', 'Hydrogen']),
    1,
    'Plants take in carbon dioxide from the air.',
    JSON.stringify(['photosynthesis', 'gases']),
    20,
    2
  );

  insertQuestion.run(
    packId,
    'What do plants produce as a byproduct of photosynthesis?',
    JSON.stringify(['Carbon Dioxide', 'Water', 'Oxygen', 'Soil']),
    2,
    'Oxygen is released into the air as a byproduct.',
    JSON.stringify(['photosynthesis', 'gases']),
    20,
    3
  );

  db.prepare(`
    UPDATE quiz_packs
    SET
      top_tags_json = ?,
      question_count_cache = 3
    WHERE id = ?
  `).run(JSON.stringify(['photosynthesis', 'gases', 'energy']), packId);
}

function showcaseTeacherId() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@quizzi.app') as any;
  if (existing?.id) return Number(existing.id);

  const inserted = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('demo@quizzi.app', 'hashed_demo_pw');
  return Number(inserted.lastInsertRowid);
}

function numericClamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

type ShowcaseQuestion = {
  prompt: string;
  answers: string[];
  correctIndex: number;
  explanation: string;
  tags: string[];
  difficulty: number;
  timeLimitSeconds: number;
};

type ShowcaseStudentProfile = {
  nickname: string;
  mastery: number;
  speed: number;
  stability: number;
  focus: number;
  pressure: number;
  strengths: string[];
  weaknesses: string[];
};

function buildShowcaseAnswerPath({
  answerCount,
  chosenIndex,
  totalSwaps,
  panicSwaps,
  responseMs,
  tfiMs,
  finalBufferMs,
  seed,
}: {
  answerCount: number;
  chosenIndex: number;
  totalSwaps: number;
  panicSwaps: number;
  responseMs: number;
  tfiMs: number;
  finalBufferMs: number;
  seed: number;
}) {
  const safeAnswerCount = Math.max(2, answerCount);
  const events: Array<{ index: number; timestamp_ms: number }> = [];
  let currentIndex = (chosenIndex + 1 + (seed % (safeAnswerCount - 1))) % safeAnswerCount;
  events.push({
    index: currentIndex,
    timestamp_ms: numericClamp(tfiMs, 120, Math.max(120, responseMs - finalBufferMs - 160)),
  });

  for (let swapIndex = 0; swapIndex < totalSwaps; swapIndex += 1) {
    const isLast = swapIndex === totalSwaps - 1;
    const isPanic = swapIndex >= totalSwaps - panicSwaps;
    currentIndex = isLast
      ? chosenIndex
      : (currentIndex + 1 + ((seed + swapIndex) % (safeAnswerCount - 1))) % safeAnswerCount;

    const calmTimestamp = tfiMs + Math.round(((swapIndex + 1) / (totalSwaps + 1)) * Math.max(300, responseMs - finalBufferMs - tfiMs));
    const panicTimestamp = responseMs - finalBufferMs + 110 + swapIndex * 70;
    events.push({
      index: currentIndex,
      timestamp_ms: numericClamp(
        isPanic ? panicTimestamp : calmTimestamp,
        events[events.length - 1].timestamp_ms + 80,
        Math.max(events[events.length - 1].timestamp_ms + 80, responseMs - 40),
      ),
    });
  }

  if (events[events.length - 1]?.index !== chosenIndex) {
    events.push({
      index: chosenIndex,
      timestamp_ms: numericClamp(responseMs - finalBufferMs, tfiMs + 120, responseMs - 40),
    });
  }

  return events
    .map((event, index) => ({
      index: event.index,
      timestamp_ms: numericClamp(
        index === events.length - 1 ? responseMs - finalBufferMs : event.timestamp_ms,
        0,
        responseMs - 40,
      ),
    }))
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms);
}

export function seedAnalyticsShowcase() {
  const packTitle = 'Showcase: Statistical Reasoning Live Game';
  const existingPack = db.prepare('SELECT id FROM quiz_packs WHERE title = ?').get(packTitle) as any;
  if (existingPack?.id) {
    const existingSession = db
      .prepare(`
        SELECT id, pin
        FROM sessions
        WHERE quiz_pack_id = ?
          AND status = 'ENDED'
        ORDER BY ended_at DESC, id DESC
        LIMIT 1
      `)
      .get(existingPack.id) as any;

    return {
      packId: Number(existingPack.id),
      sessionId: Number(existingSession?.id || 0),
      pin: String(existingSession?.pin || ''),
      title: packTitle,
    };
  }

  const teacherId = showcaseTeacherId();
  const sourceText = [
    'Statistical reasoning in higher education depends on recognizing the difference between descriptive summaries, evidence thresholds, and causal claims.',
    'Students should distinguish mean, median, standard deviation, correlation, p-values, confidence intervals, and the role of random assignment in experimental design.',
    'The strongest learners can interpret evidence under time pressure without overreacting to distractors, while struggling learners often confuse inference with description.',
  ].join(' ');

  const questions: ShowcaseQuestion[] = [
    {
      prompt: 'Which measure of central tendency is most resistant to extreme outliers?',
      answers: ['Mean', 'Median', 'Standard deviation', 'Correlation'],
      correctIndex: 1,
      explanation: 'The median depends on order rather than magnitude, so one extreme score shifts it much less than the mean.',
      tags: ['descriptive-statistics', 'robust-measures'],
      difficulty: 2,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'A p-value below .05 is typically used to suggest what?',
      answers: ['The effect is large', 'The null model is less compatible with the data', 'The result is definitely causal', 'The sample was random'],
      correctIndex: 1,
      explanation: 'A small p-value does not prove causality or effect size; it indicates the observed data would be less expected under the null model.',
      tags: ['hypothesis-testing', 'p-values'],
      difficulty: 4,
      timeLimitSeconds: 24,
    },
    {
      prompt: 'Random assignment primarily helps the researcher reduce which threat?',
      answers: ['Measurement error', 'Confounding between groups', 'Missing data', 'Ceiling effects'],
      correctIndex: 1,
      explanation: 'Random assignment balances unknown influences across conditions, making confounding less likely.',
      tags: ['experimental-design', 'causal-inference'],
      difficulty: 3,
      timeLimitSeconds: 22,
    },
    {
      prompt: 'A correlation of r = .78 supports which interpretation?',
      answers: ['A strong positive relationship', 'A strong causal effect', 'A weak positive relationship', 'A negative relationship'],
      correctIndex: 0,
      explanation: 'Correlation size indicates association strength and direction, not causality.',
      tags: ['correlation', 'effect-interpretation'],
      difficulty: 2,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'Type I error means that the researcher has:',
      answers: ['Missed a true effect', 'Rejected a true null hypothesis', 'Chosen the wrong dependent variable', 'Used too large a sample'],
      correctIndex: 1,
      explanation: 'Type I error is a false positive: rejecting the null when it is actually true.',
      tags: ['hypothesis-testing', 'error-types'],
      difficulty: 5,
      timeLimitSeconds: 24,
    },
    {
      prompt: 'If standard deviation is large, the scores are generally:',
      answers: ['Clustered tightly around the mean', 'Spread far from the mean', 'All statistically significant', 'Normally distributed'],
      correctIndex: 1,
      explanation: 'Large standard deviation reflects greater spread around the mean.',
      tags: ['descriptive-statistics', 'variability'],
      difficulty: 2,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'Which variable is manipulated by the researcher in an experiment?',
      answers: ['Dependent variable', 'Control variable', 'Independent variable', 'Outcome variance'],
      correctIndex: 2,
      explanation: 'The independent variable is the factor deliberately changed across conditions.',
      tags: ['experimental-design', 'variables'],
      difficulty: 3,
      timeLimitSeconds: 20,
    },
    {
      prompt: 'A 95% confidence interval most directly gives the researcher:',
      answers: ['A guarantee about the next sample', 'A range of plausible parameter values under the model', 'The exact probability the null is true', 'Proof of replication'],
      correctIndex: 1,
      explanation: 'Confidence intervals summarize a range of parameter values that remain plausible given the sample and model assumptions.',
      tags: ['confidence-intervals', 'estimation'],
      difficulty: 4,
      timeLimitSeconds: 24,
    },
  ];

  const profiles: ShowcaseStudentProfile[] = [
    { nickname: 'Maya', mastery: 0.93, speed: 0.82, stability: 0.92, focus: 0.95, pressure: 0.12, strengths: ['hypothesis-testing', 'confidence-intervals'], weaknesses: [] },
    { nickname: 'Noam', mastery: 0.88, speed: 0.74, stability: 0.83, focus: 0.88, pressure: 0.2, strengths: ['experimental-design', 'causal-inference'], weaknesses: ['confidence-intervals'] },
    { nickname: 'Lior', mastery: 0.84, speed: 0.68, stability: 0.8, focus: 0.82, pressure: 0.28, strengths: ['descriptive-statistics', 'variability'], weaknesses: ['p-values'] },
    { nickname: 'Tamar', mastery: 0.8, speed: 0.58, stability: 0.77, focus: 0.9, pressure: 0.22, strengths: ['robust-measures'], weaknesses: ['error-types'] },
    { nickname: 'Yael', mastery: 0.78, speed: 0.72, stability: 0.66, focus: 0.72, pressure: 0.35, strengths: ['correlation'], weaknesses: ['confidence-intervals'] },
    { nickname: 'Omer', mastery: 0.74, speed: 0.86, stability: 0.5, focus: 0.7, pressure: 0.4, strengths: ['experimental-design'], weaknesses: ['p-values', 'error-types'] },
    { nickname: 'Dana', mastery: 0.71, speed: 0.64, stability: 0.7, focus: 0.8, pressure: 0.3, strengths: ['descriptive-statistics'], weaknesses: ['causal-inference'] },
    { nickname: 'Eyal', mastery: 0.68, speed: 0.78, stability: 0.54, focus: 0.58, pressure: 0.44, strengths: ['variables'], weaknesses: ['confidence-intervals', 'p-values'] },
    { nickname: 'Shira', mastery: 0.66, speed: 0.55, stability: 0.74, focus: 0.86, pressure: 0.29, strengths: ['descriptive-statistics'], weaknesses: ['experimental-design'] },
    { nickname: 'Amit', mastery: 0.63, speed: 0.71, stability: 0.48, focus: 0.63, pressure: 0.5, strengths: ['correlation'], weaknesses: ['hypothesis-testing'] },
    { nickname: 'Neta', mastery: 0.61, speed: 0.52, stability: 0.69, focus: 0.77, pressure: 0.34, strengths: ['variability'], weaknesses: ['confidence-intervals'] },
    { nickname: 'Gal', mastery: 0.57, speed: 0.76, stability: 0.42, focus: 0.52, pressure: 0.56, strengths: ['variables'], weaknesses: ['p-values', 'error-types'] },
    { nickname: 'Roni', mastery: 0.55, speed: 0.49, stability: 0.63, focus: 0.69, pressure: 0.46, strengths: ['robust-measures'], weaknesses: ['causal-inference', 'p-values'] },
    { nickname: 'Yuval', mastery: 0.51, speed: 0.59, stability: 0.46, focus: 0.57, pressure: 0.58, strengths: ['correlation'], weaknesses: ['confidence-intervals', 'error-types'] },
    { nickname: 'Alma', mastery: 0.47, speed: 0.44, stability: 0.38, focus: 0.48, pressure: 0.66, strengths: ['descriptive-statistics'], weaknesses: ['hypothesis-testing', 'causal-inference'] },
  ];

  const packInsert = db.prepare(`
    INSERT INTO quiz_packs (
      teacher_id,
      title,
      source_text,
      source_hash,
      source_excerpt,
      source_language,
      source_word_count,
      top_tags_json,
      question_count_cache
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const packResult = packInsert.run(
    teacherId,
    packTitle,
    sourceText,
    'showcase-statistical-reasoning-live-game-v1',
    sourceText.slice(0, 320),
    'English',
    sourceText.split(/\s+/).length,
    JSON.stringify(['hypothesis-testing', 'experimental-design', 'descriptive-statistics', 'confidence-intervals']),
    questions.length,
  );
  const packId = Number(packResult.lastInsertRowid);

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

  questions.forEach((question, index) => {
    insertQuestion.run(
      packId,
      'multiple_choice',
      question.prompt,
      JSON.stringify(question.answers),
      question.correctIndex,
      question.explanation,
      JSON.stringify(question.tags),
      question.difficulty,
      question.timeLimitSeconds,
      index + 1,
    );
  });

  const questionRows = db
    .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
    .all(packId) as any[];

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      quiz_pack_id,
      pin,
      status,
      current_question_index,
      started_at,
      ended_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertParticipant = db.prepare(`
    INSERT INTO participants (session_id, nickname, created_at)
    VALUES (?, ?, ?)
  `);
  const insertAnswer = db.prepare(`
    INSERT INTO answers (
      session_id,
      question_id,
      participant_id,
      chosen_index,
      is_correct,
      response_ms,
      score_awarded,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBehaviorLog = db.prepare(`
    INSERT INTO student_behavior_logs (
      session_id,
      question_id,
      participant_id,
      tfi_ms,
      final_decision_buffer_ms,
      total_swaps,
      panic_swaps,
      answer_path_json,
      focus_loss_count,
      idle_time_ms,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertMastery = db.prepare(`
    INSERT INTO mastery (nickname, tag, score)
    VALUES (?, ?, ?)
    ON CONFLICT(nickname, tag) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP
  `);
  const insertPracticeAttempt = db.prepare(`
    INSERT INTO practice_attempts (nickname, question_id, is_correct, response_ms, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const baseTagScores: Record<string, number> = {
    'descriptive-statistics': 70,
    'robust-measures': 66,
    'hypothesis-testing': 62,
    'p-values': 58,
    'experimental-design': 68,
    'causal-inference': 60,
    'correlation': 67,
    'effect-interpretation': 64,
    'error-types': 56,
    'variability': 64,
    'variables': 65,
    'confidence-intervals': 54,
    estimation: 57,
  };

  const createSessionRun = db.transaction((config: {
    pin: string;
    startedAt: string;
    endedAt: string;
    abilityShift: number;
  }) => {
    const sessionResult = insertSession.run(
      packId,
      config.pin,
      'ENDED',
      questionRows.length - 1,
      config.startedAt,
      config.endedAt,
    );
    const sessionId = Number(sessionResult.lastInsertRowid);

    profiles.forEach((profile, studentIndex) => {
      const participantResult = insertParticipant.run(
        sessionId,
        profile.nickname,
        config.startedAt,
      );
      const participantId = Number(participantResult.lastInsertRowid);

      questionRows.forEach((question, questionIndex) => {
        const tags = JSON.parse(question.tags_json || '[]') as string[];
        const answers = JSON.parse(question.answers_json || '[]') as string[];
        const difficulty = Number(question.difficulty || 3) / 5;
        const timeLimitMs = Number(question.time_limit_seconds || 20) * 1000;
        const tagShift = tags.reduce((accumulator, tag) => {
          if (profile.strengths.includes(tag)) return accumulator + 0.1;
          if (profile.weaknesses.includes(tag)) return accumulator - 0.18;
          return accumulator;
        }, 0);

        const variation = ((((studentIndex + 3) * 17 + (questionIndex + 5) * 11) % 13) - 6) * 0.018;
        const abilitySignal =
          profile.mastery +
          config.abilityShift +
          tagShift +
          variation -
          difficulty * 0.23 -
          profile.pressure * 0.16;
        const isCorrect = abilitySignal >= 0.5;

        const paceRatio = numericClamp(
          0.3 +
            (1 - profile.speed) * 0.38 +
            difficulty * 0.18 +
            profile.pressure * 0.08 +
            (isCorrect ? -0.03 : 0.07) +
            Math.abs(variation) * 0.4,
          0.18,
          0.93,
        );
        const responseMs = Math.round(timeLimitMs * paceRatio);
        const tfiRatio = numericClamp(
          0.1 +
            (1 - profile.mastery) * 0.16 +
            difficulty * 0.15 +
            profile.pressure * 0.08 +
            (isCorrect ? 0 : 0.05),
          0.05,
          0.55,
        );
        const tfiMs = Math.round(timeLimitMs * tfiRatio);
        const totalSwaps = numericClamp(
          Math.round((1 - profile.stability) * 3 + difficulty * 2 + profile.pressure * 1.6 + (isCorrect ? 0 : 1)),
          0,
          5,
        );
        const panicSwaps = numericClamp(
          Math.min(totalSwaps, Math.round(profile.pressure * 2 + (paceRatio > 0.78 ? 1 : 0) + (isCorrect ? 0 : 1))),
          0,
          3,
        );
        const focusLossCount = numericClamp(
          Math.round((1 - profile.focus) * 2.4 + (questionIndex >= 4 ? 0.4 : 0) + (profile.pressure > 0.5 ? 0.5 : 0)),
          0,
          3,
        );
        const idleTimeMs = Math.round(
          numericClamp(
            (1 - profile.focus) * 1800 +
              difficulty * 900 +
              Math.max(0, totalSwaps - 1) * 260,
            80,
            4200,
          ),
        );
        const finalDecisionBufferMs = Math.round(
          numericClamp(
            (1 - profile.pressure) * 2400 +
              profile.stability * 900 -
              panicSwaps * 220 -
              Math.max(0, totalSwaps - 1) * 120,
            180,
            Math.max(220, responseMs * 0.55),
          ),
        );

        const chosenIndex = isCorrect
          ? Number(question.correct_index)
          : (Number(question.correct_index) + 1 + ((studentIndex + questionIndex) % Math.max(1, answers.length - 1))) % answers.length;
        const answerPath = buildShowcaseAnswerPath({
          answerCount: answers.length,
          chosenIndex,
          totalSwaps,
          panicSwaps,
          responseMs,
          tfiMs,
          finalBufferMs: finalDecisionBufferMs,
          seed: (studentIndex + 1) * 13 + (questionIndex + 1) * 7,
        });
        const speedFactor = numericClamp(1 - responseMs / timeLimitMs, 0, 1);
        const scoreAwarded = isCorrect ? 1000 + Math.round(speedFactor * 1000) : 0;
        const answerTimestamp = new Date(
          new Date(config.startedAt).getTime() + (questionIndex * 115000) + studentIndex * 8000 + responseMs,
        )
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        insertAnswer.run(
          sessionId,
          Number(question.id),
          participantId,
          chosenIndex,
          isCorrect ? 1 : 0,
          responseMs,
          scoreAwarded,
          answerTimestamp,
        );
        insertBehaviorLog.run(
          sessionId,
          Number(question.id),
          participantId,
          tfiMs,
          finalDecisionBufferMs,
          totalSwaps,
          panicSwaps,
          JSON.stringify(answerPath),
          focusLossCount,
          idleTimeMs,
          answerTimestamp,
        );
      });
    });

    return sessionId;
  });

  const historicalSessionId = createSessionRun({
    pin: '761451',
    startedAt: '2026-02-26 09:00:00',
    endedAt: '2026-02-26 09:18:00',
    abilityShift: -0.08,
  });
  const mainSessionId = createSessionRun({
    pin: '761452',
    startedAt: '2026-03-10 10:00:00',
    endedAt: '2026-03-10 10:20:00',
    abilityShift: 0.03,
  });

  profiles.forEach((profile, studentIndex) => {
    Object.entries(baseTagScores).forEach(([tag, baseScore], tagIndex) => {
      const strengthBoost = profile.strengths.includes(tag) ? 12 : 0;
      const weaknessPenalty = profile.weaknesses.includes(tag) ? -18 : 0;
      const score = Math.round(
        numericClamp(
          baseScore +
            (profile.mastery - 0.6) * 35 +
            strengthBoost +
            weaknessPenalty +
            ((studentIndex + tagIndex) % 4) * 2,
          18,
          96,
        ),
      );
      upsertMastery.run(profile.nickname, tag, score);
    });

    questionRows.forEach((question, questionIndex) => {
      const attempts = 1 + ((studentIndex + questionIndex) % 2);
      for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
        const tags = JSON.parse(question.tags_json || '[]') as string[];
        const tagPenalty = tags.some((tag) => profile.weaknesses.includes(tag)) ? -0.12 : 0;
        const tagBonus = tags.some((tag) => profile.strengths.includes(tag)) ? 0.08 : 0;
        const practiceSignal = profile.mastery + tagBonus + tagPenalty + attemptIndex * 0.05 - Number(question.difficulty || 3) / 18;
        const isCorrect = practiceSignal >= 0.5;
        const responseMs = Math.round(
          numericClamp(
            (Number(question.time_limit_seconds || 20) * 1000) *
              (0.32 + (1 - profile.speed) * 0.3 + attemptIndex * 0.04),
            2200,
            19000,
          ),
        );
        const createdAt = new Date(Date.UTC(2026, 1, 18 + questionIndex, 12, (studentIndex * 3 + attemptIndex) % 60))
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');

        insertPracticeAttempt.run(
          profile.nickname,
          Number(question.id),
          isCorrect ? 1 : 0,
          responseMs,
          createdAt,
        );
      }
    });
  });

  return {
    packId,
    sessionId: mainSessionId,
    historicalSessionId,
    pin: '761452',
    title: packTitle,
  };
}

export default db;
