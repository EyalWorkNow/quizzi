import type { Pool, PoolClient } from 'pg';

type PostgresQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export const POSTGRES_TABLE_ORDER = [
  'users',
  'quiz_packs',
  'teacher_classes',
  'teacher_class_students',
  'questions',
  'quiz_pack_versions',
  'material_profiles',
  'question_generation_cache',
  'sessions',
  'participants',
  'answers',
  'student_behavior_logs',
  'mastery',
  'practice_attempts',
] as const;

const POSTGRES_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      first_name TEXT,
      last_name TEXT,
      school TEXT,
      auth_provider TEXT DEFAULT 'password',
      updated_at TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS quiz_packs (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER,
      is_public INTEGER DEFAULT 0,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source_hash TEXT,
      source_excerpt TEXT,
      source_language TEXT DEFAULT 'English',
      source_word_count INTEGER DEFAULT 0,
      material_profile_id INTEGER,
      top_tags_json TEXT DEFAULT '[]',
      question_count_cache INTEGER DEFAULT 0,
      default_game_mode TEXT DEFAULT 'classic_quiz',
      enabled_game_modes_json TEXT DEFAULT '[]',
      question_blueprints_json TEXT DEFAULT '[]',
      generation_contract TEXT DEFAULT 'manual_v1'
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      quiz_pack_id INTEGER,
      type TEXT DEFAULT 'multiple_choice',
      prompt TEXT,
      image_url TEXT DEFAULT '',
      answers_json TEXT,
      correct_index INTEGER,
      explanation TEXT,
      tags_json TEXT,
      difficulty INTEGER DEFAULT 3,
      time_limit_seconds INTEGER DEFAULT 20,
      question_order INTEGER DEFAULT 0,
      learning_objective TEXT DEFAULT '',
      bloom_level TEXT DEFAULT ''
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS quiz_pack_versions (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER,
      teacher_id INTEGER,
      version_number INTEGER DEFAULT 1,
      version_label TEXT DEFAULT '',
      source_label TEXT DEFAULT '',
      snapshot_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS material_profiles (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS question_generation_cache (
      id SERIAL PRIMARY KEY,
      material_profile_id INTEGER,
      difficulty TEXT,
      output_language TEXT,
      question_count INTEGER,
      prompt_version TEXT,
      response_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_profile_id, difficulty, output_language, question_count, prompt_version)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS teacher_classes (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER NOT NULL,
      name TEXT,
      subject TEXT,
      grade TEXT,
      color TEXT DEFAULT 'bg-brand-purple',
      notes TEXT DEFAULT '',
      pack_id INTEGER,
      archived INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS teacher_class_students (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL,
      name TEXT,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      quiz_pack_id INTEGER,
      teacher_class_id INTEGER,
      pin TEXT UNIQUE,
      game_type TEXT DEFAULT 'classic_quiz',
      team_count INTEGER DEFAULT 0,
      mode_config_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'LOBBY',
      current_question_index INTEGER DEFAULT 0,
      started_at TIMESTAMP,
      ended_at TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS participants (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      identity_key TEXT,
      nickname TEXT,
      team_id INTEGER DEFAULT 0,
      team_name TEXT,
      seat_index INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS answers (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      chosen_index INTEGER,
      is_correct BOOLEAN,
      response_ms INTEGER,
      score_awarded INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS student_behavior_logs (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      tfi_ms INTEGER,
      final_decision_buffer_ms INTEGER,
      total_swaps INTEGER DEFAULT 0,
      panic_swaps INTEGER DEFAULT 0,
      answer_path_json TEXT,
      focus_loss_count INTEGER DEFAULT 0,
      idle_time_ms INTEGER DEFAULT 0,
      blur_time_ms INTEGER DEFAULT 0,
      longest_idle_streak_ms INTEGER DEFAULT 0,
      pointer_activity_count INTEGER DEFAULT 0,
      keyboard_activity_count INTEGER DEFAULT 0,
      touch_activity_count INTEGER DEFAULT 0,
      same_answer_reclicks INTEGER DEFAULT 0,
      option_dwell_json TEXT DEFAULT '{}',
      option_hover_counts_json TEXT DEFAULT '{}',
      outside_answer_pointer_moves INTEGER DEFAULT 0,
      rapid_pointer_jumps INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS default_game_mode TEXT DEFAULT 'classic_quiz'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS enabled_game_modes_json TEXT DEFAULT '[]'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS question_blueprints_json TEXT DEFAULT '[]'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS generation_contract TEXT DEFAULT 'manual_v1'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS course_code TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS course_name TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS section_name TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS academic_term TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS week_label TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS learning_objectives_json TEXT DEFAULT '[]'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS bloom_levels_json TEXT DEFAULT '[]'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS pack_notes TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS generation_provider TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS generation_model TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS lms_provider TEXT DEFAULT 'generic_csv'`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS lms_assignment_label TEXT DEFAULT ''`,
  `ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS is_public INTEGER DEFAULT 0`,
  `ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS color TEXT DEFAULT 'bg-brand-purple'`,
  `ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
  `ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS pack_id INTEGER`,
  `ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS archived INTEGER DEFAULT 0`,
  `ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS learning_objective TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS bloom_level TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS teacher_class_id INTEGER`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS identity_key TEXT`,
  `ALTER TABLE mastery ALTER COLUMN score TYPE DOUBLE PRECISION USING score::double precision`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS option_hover_counts_json TEXT DEFAULT '{}'`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS outside_answer_pointer_moves INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS rapid_pointer_jumps INTEGER DEFAULT 0`,
  `
    CREATE TABLE IF NOT EXISTS mastery (
      id SERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL,
      nickname TEXT,
      tag TEXT,
      score DOUBLE PRECISION DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(identity_key, tag)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS practice_attempts (
      id SERIAL PRIMARY KEY,
      identity_key TEXT,
      nickname TEXT,
      question_id INTEGER,
      is_correct BOOLEAN,
      response_ms INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE practice_attempts ADD COLUMN IF NOT EXISTS identity_key TEXT`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_pin ON sessions(pin)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_pack_status ON sessions(quiz_pack_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_participants_nickname_session ON participants(nickname, session_id)',
  'CREATE INDEX IF NOT EXISTS idx_participants_identity_key ON participants(identity_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_answers_participant_session ON answers(participant_id, session_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_unique_submission ON answers(session_id, question_id, participant_id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_pack_order ON questions(quiz_pack_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_behavior_participant_session ON student_behavior_logs(participant_id, session_id)',
  'CREATE INDEX IF NOT EXISTS idx_mastery_nickname ON mastery(nickname)',
  'CREATE INDEX IF NOT EXISTS idx_mastery_identity_key ON mastery(identity_key)',
  'CREATE INDEX IF NOT EXISTS idx_practice_attempts_nickname_question ON practice_attempts(nickname, question_id)',
  'CREATE INDEX IF NOT EXISTS idx_practice_attempts_identity_created ON practice_attempts(identity_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_generation_cache_lookup ON question_generation_cache(material_profile_id, difficulty, output_language, question_count)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_profile ON quiz_packs(material_profile_id)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_source_hash ON quiz_packs(source_hash)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_course_code ON quiz_packs(course_code)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_classes_teacher_archived ON teacher_classes(teacher_id, archived)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_classes_pack ON teacher_classes(pack_id)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_class_students_class ON teacher_class_students(class_id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_pack_question_order ON questions(quiz_pack_id, question_order, id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_learning_objective ON questions(learning_objective)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_game_type ON sessions(game_type)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_teacher_class ON sessions(teacher_class_id, status)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_session_nickname_unique ON participants(session_id, LOWER(nickname))',
  'CREATE INDEX IF NOT EXISTS idx_participants_session_team ON participants(session_id, team_id)',
  'CREATE INDEX IF NOT EXISTS idx_pack_versions_pack ON quiz_pack_versions(pack_id, version_number DESC)',
] as const;

const POSTGRES_DATA_REPAIR_STATEMENTS = [
  `
    UPDATE questions
    SET question_order = id
    WHERE question_order IS NULL OR question_order = 0
  `,
  `
    UPDATE quiz_packs
    SET source_excerpt = SUBSTRING(COALESCE(source_text, '') FROM 1 FOR 320)
    WHERE source_excerpt IS NULL OR source_excerpt = ''
  `,
  `
    UPDATE quiz_packs
    SET source_word_count = cardinality(regexp_split_to_array(trim(COALESCE(source_text, '')), E'\\s+'))
    WHERE source_text IS NOT NULL
      AND trim(source_text) <> ''
      AND (source_word_count IS NULL OR source_word_count = 0)
  `,
  `
    UPDATE quiz_packs
    SET question_count_cache = question_totals.count
    FROM (
      SELECT quiz_pack_id, COUNT(*)::INTEGER AS count
      FROM questions
      GROUP BY quiz_pack_id
    ) AS question_totals
    WHERE question_totals.quiz_pack_id = quiz_packs.id
      AND (quiz_packs.question_count_cache IS NULL OR quiz_packs.question_count_cache = 0)
  `,
  `
    UPDATE users
    SET auth_provider = 'password'
    WHERE auth_provider IS NULL OR auth_provider = ''
  `,
  `
    UPDATE users
    SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL
  `,
  `
    UPDATE teacher_classes
    SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL
  `,
  `
    UPDATE teacher_class_students
    SET joined_at = COALESCE(joined_at, created_at, CURRENT_TIMESTAMP),
        updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
    WHERE joined_at IS NULL OR updated_at IS NULL
  `,
] as const;

export async function applyPostgresSchema(client: PostgresQueryable) {
  for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
    await client.query(statement);
  }

  for (const statement of POSTGRES_DATA_REPAIR_STATEMENTS) {
    await client.query(statement);
  }
}

export async function truncatePostgresTables(client: PostgresQueryable) {
  const tableList = [...POSTGRES_TABLE_ORDER].reverse().map(quoteIdentifier).join(', ');
  await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY`);
}

export async function resetPostgresSequences(client: PostgresQueryable) {
  for (const table of POSTGRES_TABLE_ORDER) {
    const maxResult = await client.query<{ max_id: number | null }>(
      `SELECT MAX(id)::INTEGER AS max_id FROM ${quoteIdentifier(table)}`,
    );
    const maxId = Number(maxResult.rows[0]?.max_id || 0);

    if (maxId > 0) {
      await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
      continue;
    }

    await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), 1, false)`, [table]);
  }
}

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
