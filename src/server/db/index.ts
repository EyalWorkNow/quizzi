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

// Hard-initialize tables before exporting the db instance to routes
try {
  (await initDb());
} catch (err) {
  console.error('[db] CRITICAL initialization error:', err);
}

async function columnExists(table: string, column: string) {
  return (await db
      .prepare(`PRAGMA table_info(${table})`)
      .all())
    .some((row: any) => row.name === column);
}

async function ensureColumn(table: string, column: string, definition: string) {
  if (!(await columnExists(table, column))) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Initialize schema
export async function initDb() {
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
      course_code TEXT DEFAULT '',
      course_name TEXT DEFAULT '',
      section_name TEXT DEFAULT '',
      academic_term TEXT DEFAULT '',
      week_label TEXT DEFAULT '',
      learning_objectives_json TEXT DEFAULT '[]',
      bloom_levels_json TEXT DEFAULT '[]',
      pack_notes TEXT DEFAULT '',
      generation_provider TEXT DEFAULT '',
      generation_model TEXT DEFAULT '',
      lms_provider TEXT DEFAULT 'generic_csv',
      lms_assignment_label TEXT DEFAULT '',
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
      time_limit_seconds INTEGER DEFAULT 20,
      learning_objective TEXT DEFAULT '',
      bloom_level TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS quiz_pack_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER,
      teacher_id INTEGER,
      version_number INTEGER DEFAULT 1,
      version_label TEXT DEFAULT '',
      source_label TEXT DEFAULT '',
      snapshot_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_participants_session_nickname_lookup ON participants(session_id, nickname);
    CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_answers_participant_session ON answers(participant_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_answers_session_question_participant ON answers(session_id, question_id, participant_id);
    CREATE INDEX IF NOT EXISTS idx_questions_pack_order ON questions(quiz_pack_id, id);
    CREATE INDEX IF NOT EXISTS idx_behavior_participant_session ON student_behavior_logs(participant_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_behavior_session_question_participant ON student_behavior_logs(session_id, question_id, participant_id);
    CREATE INDEX IF NOT EXISTS idx_mastery_nickname ON mastery(nickname);
    CREATE INDEX IF NOT EXISTS idx_practice_attempts_nickname_question ON practice_attempts(nickname, question_id);
    CREATE INDEX IF NOT EXISTS idx_practice_attempts_nickname_created ON practice_attempts(nickname, created_at);
    CREATE INDEX IF NOT EXISTS idx_material_profiles_hash ON material_profiles(source_hash);
    CREATE INDEX IF NOT EXISTS idx_generation_cache_lookup ON question_generation_cache(material_profile_id, difficulty, output_language, question_count);
  `);

  (await ensureColumn('quiz_packs', 'source_hash', 'TEXT'));
  (await ensureColumn('users', 'first_name', 'TEXT'));
  (await ensureColumn('users', 'last_name', 'TEXT'));
  (await ensureColumn('users', 'school', 'TEXT'));
  (await ensureColumn('users', 'auth_provider', "TEXT DEFAULT 'password'"));
  (await ensureColumn('users', 'updated_at', 'DATETIME'));
  (await ensureColumn('quiz_packs', 'source_excerpt', 'TEXT'));
  (await ensureColumn('quiz_packs', 'source_language', "TEXT DEFAULT 'English'"));
  (await ensureColumn('quiz_packs', 'source_word_count', 'INTEGER DEFAULT 0'));
  (await ensureColumn('quiz_packs', 'material_profile_id', 'INTEGER'));
  (await ensureColumn('quiz_packs', 'top_tags_json', "TEXT DEFAULT '[]'"));
  (await ensureColumn('quiz_packs', 'question_count_cache', 'INTEGER DEFAULT 0'));
  (await ensureColumn('quiz_packs', 'course_code', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'course_name', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'section_name', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'academic_term', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'week_label', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'learning_objectives_json', "TEXT DEFAULT '[]'"));
  (await ensureColumn('quiz_packs', 'bloom_levels_json', "TEXT DEFAULT '[]'"));
  (await ensureColumn('quiz_packs', 'pack_notes', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'generation_provider', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'generation_model', "TEXT DEFAULT ''"));
  (await ensureColumn('quiz_packs', 'lms_provider', "TEXT DEFAULT 'generic_csv'"));
  (await ensureColumn('quiz_packs', 'lms_assignment_label', "TEXT DEFAULT ''"));
  (await ensureColumn('questions', 'question_order', 'INTEGER DEFAULT 0'));
  (await ensureColumn('questions', 'learning_objective', "TEXT DEFAULT ''"));
  (await ensureColumn('questions', 'bloom_level', "TEXT DEFAULT ''"));
  (await ensureColumn('sessions', 'game_type', "TEXT DEFAULT 'classic_quiz'"));
  (await ensureColumn('sessions', 'team_count', 'INTEGER DEFAULT 0'));
  (await ensureColumn('sessions', 'mode_config_json', "TEXT DEFAULT '{}'"));
  (await ensureColumn('participants', 'team_id', 'INTEGER DEFAULT 0'));
  (await ensureColumn('participants', 'team_name', 'TEXT'));
  (await ensureColumn('participants', 'seat_index', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'blur_time_ms', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'longest_idle_streak_ms', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'pointer_activity_count', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'keyboard_activity_count', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'touch_activity_count', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'same_answer_reclicks', 'INTEGER DEFAULT 0'));
  (await ensureColumn('student_behavior_logs', 'option_dwell_json', "TEXT DEFAULT '{}'"));

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quiz_packs_profile ON quiz_packs(material_profile_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_packs_source_hash ON quiz_packs(source_hash);
    CREATE INDEX IF NOT EXISTS idx_quiz_packs_course_code ON quiz_packs(course_code);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_questions_pack_question_order ON questions(quiz_pack_id, question_order, id);
    CREATE INDEX IF NOT EXISTS idx_questions_learning_objective ON questions(learning_objective);
    CREATE INDEX IF NOT EXISTS idx_sessions_game_type ON sessions(game_type);
    CREATE INDEX IF NOT EXISTS idx_participants_session_team ON participants(session_id, team_id);
    CREATE INDEX IF NOT EXISTS idx_pack_versions_pack ON quiz_pack_versions(pack_id, version_number DESC);
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

export default db;
