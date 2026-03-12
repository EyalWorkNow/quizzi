import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(process.cwd(), 'quizzi.db');
let db: Database.Database;

try {
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    // Vercel Serverless has a read-only filesystem.
    if (fs.existsSync(dbPath)) {
      db = new Database(dbPath, { readonly: true });
    } else {
      db = new Database(':memory:');
    }
  } else {
    db = new Database(dbPath);
    // Enable WAL mode for better concurrency (local)
    db.pragma('journal_mode = WAL');
  }
} catch (error) {
  console.warn('SQLite init failed (e.g., read-only filesystem). Falling back to in-memory DB.', error);
  db = new Database(':memory:');
}

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
  seductiveIndex?: number;
  alternateDistractorIndex?: number;
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

function buildShowcaseOptionDwell({
  answerCount,
  chosenIndex,
  correctIndex,
  responseMs,
  totalSwaps,
  seed,
}: {
  answerCount: number;
  chosenIndex: number;
  correctIndex: number;
  responseMs: number;
  totalSwaps: number;
  seed: number;
}) {
  return Object.fromEntries(
    Array.from({ length: Math.max(2, answerCount) }, (_, index) => {
      const base =
        120 +
        ((seed + index * 17) % 150) +
        (index === chosenIndex ? responseMs * (0.2 + totalSwaps * 0.025) : 0) +
        (index === correctIndex ? responseMs * (chosenIndex === correctIndex ? 0.08 : 0.14) : 0) +
        (index !== chosenIndex && index !== correctIndex ? responseMs * 0.05 : 0);
      return [String(index), Math.round(base)];
    }),
  );
}

export function seedAnalyticsShowcase() {
  const packTitle = 'spain pain';
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
    'Spain sits on the Iberian Peninsula and combines layered geography, strong regional identities, and a twentieth-century political history that students often confuse under pressure.',
    'Common confusions include mixing up Madrid and Barcelona, reversing the Mediterranean and Atlantic coastlines, blending Catalonia with the Basque Country, and mistiming the Spanish Civil War.',
    'A good quiz on Spain should reveal whether students truly know the map, the monarchy, and the history, or whether they are leaning on seductive half-memories and last-second guesses.',
  ].join(' ');

  const questions: ShowcaseQuestion[] = [
    {
      prompt: 'What is the capital city of Spain?',
      answers: ['Barcelona', 'Madrid', 'Seville', 'Valencia'],
      correctIndex: 1,
      seductiveIndex: 0,
      alternateDistractorIndex: 2,
      explanation: 'Madrid is the capital of Spain. Barcelona is the largest city many students remember first, which makes it a classic distractor.',
      tags: ['geography-core', 'cities'],
      difficulty: 2,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'Which sea borders Spain to the east?',
      answers: ['Atlantic Ocean', 'Mediterranean Sea', 'Cantabrian Sea', 'North Sea'],
      correctIndex: 1,
      seductiveIndex: 0,
      explanation: 'Spain faces the Mediterranean to the east. Students often overgeneralize that Spain is mainly Atlantic because of its west-facing coastline.',
      tags: ['physical-geography', 'geography-core'],
      difficulty: 3,
      timeLimitSeconds: 20,
    },
    {
      prompt: 'Which mountain range forms the natural border between Spain and France?',
      answers: ['The Alps', 'The Pyrenees', 'The Apennines', 'The Sierra Nevada'],
      correctIndex: 1,
      seductiveIndex: 0,
      explanation: 'The Pyrenees separate Spain from France. The Alps are a common Europe-wide distractor that captures students who know the map only vaguely.',
      tags: ['physical-geography'],
      difficulty: 3,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'Barcelona is located in which autonomous community?',
      answers: ['Andalusia', 'Catalonia', 'The Basque Country', 'Madrid'],
      correctIndex: 1,
      seductiveIndex: 2,
      alternateDistractorIndex: 0,
      explanation: 'Barcelona is in Catalonia. Students often confuse Catalonia and the Basque Country because both are strongly associated with regional identity politics.',
      tags: ['regions', 'cities', 'language-culture'],
      difficulty: 4,
      timeLimitSeconds: 22,
    },
    {
      prompt: 'In which year did the Spanish Civil War begin?',
      answers: ['1931', '1936', '1939', '1945'],
      correctIndex: 1,
      seductiveIndex: 2,
      alternateDistractorIndex: 0,
      explanation: 'The war began in 1936 and ended in 1939. Students who remember only the end of the war often choose 1939.',
      tags: ['history'],
      difficulty: 5,
      timeLimitSeconds: 24,
    },
    {
      prompt: 'Who ruled Spain as dictator after the Civil War?',
      answers: ['Francisco Franco', 'Felipe VI', 'Adolfo Suarez', 'Juan Carlos I'],
      correctIndex: 0,
      seductiveIndex: 1,
      alternateDistractorIndex: 3,
      explanation: 'Franco ruled Spain after the Civil War. Felipe VI and Juan Carlos I are monarchs from a much later period, which makes them seductive but wrong answers.',
      tags: ['history', 'monarchy-politics'],
      difficulty: 5,
      timeLimitSeconds: 24,
    },
    {
      prompt: 'What is the current official currency of Spain?',
      answers: ['Peseta', 'Euro', 'Franc', 'Escudo'],
      correctIndex: 1,
      seductiveIndex: 0,
      explanation: 'Spain uses the euro. The peseta is a strong distractor because it was the pre-euro currency and still sticks in memory.',
      tags: ['economy-eu'],
      difficulty: 2,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'Which language is co-official in Catalonia alongside Spanish?',
      answers: ['Basque', 'Galician', 'Catalan', 'Portuguese'],
      correctIndex: 2,
      seductiveIndex: 0,
      alternateDistractorIndex: 1,
      explanation: 'Catalan is co-official in Catalonia. Basque and Galician are also real regional languages in Spain, which makes them powerful misconceptions.',
      tags: ['language-culture', 'regions'],
      difficulty: 4,
      timeLimitSeconds: 20,
    },
    {
      prompt: 'The Guggenheim Museum is in which Spanish city?',
      answers: ['Madrid', 'Bilbao', 'Valencia', 'Malaga'],
      correctIndex: 1,
      seductiveIndex: 0,
      alternateDistractorIndex: 2,
      explanation: 'The Guggenheim Museum is in Bilbao. Students often guess Madrid because it is the capital and the most familiar city name.',
      tags: ['cities', 'regions'],
      difficulty: 3,
      timeLimitSeconds: 18,
    },
    {
      prompt: 'What body of water separates Spain from Morocco?',
      answers: ['Bay of Biscay', 'English Channel', 'Strait of Gibraltar', 'Suez Canal'],
      correctIndex: 2,
      seductiveIndex: 0,
      explanation: 'Spain and Morocco are separated by the Strait of Gibraltar. Students who only remember “Spain touches the Atlantic” are often pulled toward the Bay of Biscay.',
      tags: ['physical-geography', 'geography-core'],
      difficulty: 4,
      timeLimitSeconds: 22,
    },
  ];

  const profiles: ShowcaseStudentProfile[] = [
    { nickname: 'Maya', mastery: 0.94, speed: 0.84, stability: 0.92, focus: 0.96, pressure: 0.12, strengths: ['history', 'monarchy-politics'], weaknesses: [] },
    { nickname: 'Noam', mastery: 0.9, speed: 0.76, stability: 0.86, focus: 0.9, pressure: 0.18, strengths: ['geography-core', 'physical-geography'], weaknesses: ['language-culture'] },
    { nickname: 'Lior', mastery: 0.87, speed: 0.7, stability: 0.82, focus: 0.84, pressure: 0.24, strengths: ['cities', 'regions'], weaknesses: ['history'] },
    { nickname: 'Tamar', mastery: 0.84, speed: 0.64, stability: 0.8, focus: 0.9, pressure: 0.22, strengths: ['language-culture'], weaknesses: ['economy-eu'] },
    { nickname: 'Yael', mastery: 0.81, speed: 0.72, stability: 0.68, focus: 0.76, pressure: 0.34, strengths: ['physical-geography'], weaknesses: ['monarchy-politics'] },
    { nickname: 'Omer', mastery: 0.79, speed: 0.86, stability: 0.54, focus: 0.72, pressure: 0.42, strengths: ['geography-core'], weaknesses: ['history', 'economy-eu'] },
    { nickname: 'Dana', mastery: 0.76, speed: 0.66, stability: 0.72, focus: 0.82, pressure: 0.28, strengths: ['cities'], weaknesses: ['language-culture'] },
    { nickname: 'Eyal', mastery: 0.72, speed: 0.8, stability: 0.56, focus: 0.58, pressure: 0.48, strengths: ['monarchy-politics'], weaknesses: ['regions', 'history'] },
    { nickname: 'Shira', mastery: 0.69, speed: 0.58, stability: 0.74, focus: 0.86, pressure: 0.31, strengths: ['language-culture'], weaknesses: ['physical-geography'] },
    { nickname: 'Amit', mastery: 0.67, speed: 0.73, stability: 0.5, focus: 0.64, pressure: 0.52, strengths: ['cities'], weaknesses: ['history'] },
    { nickname: 'Neta', mastery: 0.65, speed: 0.54, stability: 0.68, focus: 0.78, pressure: 0.36, strengths: ['economy-eu'], weaknesses: ['regions'] },
    { nickname: 'Gal', mastery: 0.62, speed: 0.78, stability: 0.44, focus: 0.54, pressure: 0.58, strengths: ['geography-core'], weaknesses: ['history', 'language-culture'] },
    { nickname: 'Roni', mastery: 0.59, speed: 0.5, stability: 0.64, focus: 0.7, pressure: 0.44, strengths: ['physical-geography'], weaknesses: ['economy-eu', 'monarchy-politics'] },
    { nickname: 'Yuval', mastery: 0.56, speed: 0.61, stability: 0.48, focus: 0.59, pressure: 0.6, strengths: ['regions'], weaknesses: ['history', 'economy-eu'] },
    { nickname: 'Alma', mastery: 0.53, speed: 0.46, stability: 0.4, focus: 0.5, pressure: 0.68, strengths: ['cities'], weaknesses: ['history', 'geography-core'] },
    { nickname: 'Ido', mastery: 0.75, speed: 0.69, stability: 0.62, focus: 0.73, pressure: 0.39, strengths: ['history'], weaknesses: ['physical-geography'] },
    { nickname: 'Hila', mastery: 0.7, speed: 0.62, stability: 0.58, focus: 0.67, pressure: 0.47, strengths: ['language-culture'], weaknesses: ['geography-core', 'cities'] },
    { nickname: 'Tom', mastery: 0.64, speed: 0.83, stability: 0.41, focus: 0.55, pressure: 0.62, strengths: ['economy-eu'], weaknesses: ['history', 'regions'] },
    { nickname: 'Or', mastery: 0.6, speed: 0.57, stability: 0.52, focus: 0.6, pressure: 0.54, strengths: ['physical-geography'], weaknesses: ['language-culture', 'cities'] },
    { nickname: 'Adi', mastery: 0.58, speed: 0.48, stability: 0.43, focus: 0.52, pressure: 0.64, strengths: ['regions'], weaknesses: ['economy-eu', 'monarchy-politics'] },
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
    'showcase-spain-pain-v2',
    sourceText.slice(0, 320),
    'English',
    sourceText.split(/\s+/).length,
    JSON.stringify(['history', 'geography-core', 'regions', 'language-culture', 'physical-geography']),
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
  const showcaseQuestionMetaById = new Map<number, ShowcaseQuestion>();
  questionRows.forEach((row, index) => {
    const metadata = questions[index];
    if (metadata) {
      showcaseQuestionMetaById.set(Number(row.id), metadata);
    }
  });

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
      blur_time_ms,
      longest_idle_streak_ms,
      pointer_activity_count,
      keyboard_activity_count,
      touch_activity_count,
      same_answer_reclicks,
      option_dwell_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    'geography-core': 67,
    cities: 65,
    'physical-geography': 63,
    regions: 58,
    history: 57,
    'monarchy-politics': 54,
    'economy-eu': 61,
    'language-culture': 59,
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
        const questionMeta = showcaseQuestionMetaById.get(Number(question.id));
        const tags = JSON.parse(question.tags_json || '[]') as string[];
        const answers = JSON.parse(question.answers_json || '[]') as string[];
        const difficulty = Number(question.difficulty || 3) / 5;
        const timeLimitMs = Number(question.time_limit_seconds || 20) * 1000;
        const fatiguePenalty = Math.max(0, questionIndex - 5) * (0.015 + profile.pressure * 0.02);
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
          profile.pressure * 0.16 -
          fatiguePenalty;
        const isCorrect = abilitySignal >= 0.51;

        const paceRatio = numericClamp(
          0.3 +
            (1 - profile.speed) * 0.38 +
            difficulty * 0.18 +
            profile.pressure * 0.08 +
            fatiguePenalty * 0.8 +
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
          Math.round((1 - profile.stability) * 3 + difficulty * 2 + profile.pressure * 1.6 + fatiguePenalty * 8 + (isCorrect ? 0 : 1)),
          0,
          5,
        );
        const panicSwaps = numericClamp(
          Math.min(totalSwaps, Math.round(profile.pressure * 2 + (paceRatio > 0.78 ? 1 : 0) + (isCorrect ? 0 : 1))),
          0,
          3,
        );
        const focusLossCount = numericClamp(
          Math.round((1 - profile.focus) * 2.4 + (questionIndex >= 4 ? 0.4 : 0) + fatiguePenalty * 10 + (profile.pressure > 0.5 ? 0.5 : 0)),
          0,
          3,
        );
        const idleTimeMs = Math.round(
          numericClamp(
            (1 - profile.focus) * 1800 +
              difficulty * 900 +
              fatiguePenalty * 2600 +
              Math.max(0, totalSwaps - 1) * 260,
            80,
            4200,
          ),
        );
        const blurTimeMs = Math.round(
          numericClamp(
            focusLossCount * 420 +
              (1 - profile.focus) * 900 +
              fatiguePenalty * 1800,
            0,
            4200,
          ),
        );
        const longestIdleStreakMs = Math.round(
          numericClamp(
            idleTimeMs * (0.42 + profile.pressure * 0.28 + (questionIndex >= 6 ? 0.12 : 0)),
            120,
            3100,
          ),
        );
        const pointerActivityCount = Math.round(
          numericClamp(
            8 + profile.speed * 8 + totalSwaps * 2 + focusLossCount + questionIndex * 0.6,
            4,
            28,
          ),
        );
        const keyboardActivityCount = Math.round(
          numericClamp(
            profile.stability < 0.55 ? 1 + ((studentIndex + questionIndex) % 3) : (studentIndex + questionIndex) % 2,
            0,
            5,
          ),
        );
        const touchActivityCount = Math.round(
          numericClamp((studentIndex + questionIndex) % 5 === 0 ? 1 : 0, 0, 2),
        );
        const sameAnswerReclicks = Math.round(
          numericClamp(
            isCorrect && totalSwaps === 0
              ? (profile.stability < 0.7 ? 1 : 0)
              : Math.max(0, totalSwaps - 1),
            0,
            3,
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

        let chosenIndex = Number(question.correct_index);
        if (!isCorrect) {
          const weaknessHit = tags.some((tag) => profile.weaknesses.includes(tag));
          if ((weaknessHit || profile.pressure > 0.44 || questionIndex >= 6) && typeof questionMeta?.seductiveIndex === 'number') {
            chosenIndex = Number(questionMeta.seductiveIndex);
          } else if ((studentIndex + questionIndex) % 3 === 0 && typeof questionMeta?.alternateDistractorIndex === 'number') {
            chosenIndex = Number(questionMeta.alternateDistractorIndex);
          } else {
            chosenIndex = (Number(question.correct_index) + 1 + ((studentIndex + questionIndex) % Math.max(1, answers.length - 1))) % answers.length;
          }
        }
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
        const optionDwell = buildShowcaseOptionDwell({
          answerCount: answers.length,
          chosenIndex,
          correctIndex: Number(question.correct_index),
          responseMs,
          totalSwaps,
          seed: (studentIndex + 2) * 19 + (questionIndex + 1) * 11,
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
          blurTimeMs,
          longestIdleStreakMs,
          pointerActivityCount,
          keyboardActivityCount,
          touchActivityCount,
          sameAnswerReclicks,
          JSON.stringify(optionDwell),
          answerTimestamp,
        );
      });
    });

    return sessionId;
  });

  const historicalSessionId = createSessionRun({
    pin: '382641',
    startedAt: '2026-03-06 10:05:00',
    endedAt: '2026-03-06 10:26:00',
    abilityShift: -0.04,
  });
  const mainSessionId = createSessionRun({
    pin: '382642',
    startedAt: '2026-03-11 09:40:00',
    endedAt: '2026-03-11 10:03:00',
    abilityShift: 0.05,
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
    pin: '382642',
    title: packTitle,
  };
}

export default db;
