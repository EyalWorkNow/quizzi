import type { Pool, PoolClient } from 'pg';

type PostgresQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export const POSTGRES_TABLE_ORDER = [
  'users',
  'student_users',
  'student_password_reset_codes',
  'student_identity_links',
  'quiz_packs',
  'teacher_class_assignments',
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
  'student_behavior_events',
  'concept_attempt_history',
  'analytics_labels',
  'mastery',
  'practice_attempts',
  'student_memory_snapshots',
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
    CREATE TABLE IF NOT EXISTS student_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      first_name TEXT,
      last_name TEXT,
      avatar_url TEXT DEFAULT '',
      preferred_language TEXT DEFAULT 'en',
      status TEXT DEFAULT 'active',
      email_verified_at TIMESTAMP,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS student_identity_links (
      id SERIAL PRIMARY KEY,
      student_user_id INTEGER NOT NULL,
      identity_key TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'claimed_device',
      is_primary INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS student_password_reset_codes (
      id SERIAL PRIMARY KEY,
      student_user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 0,
      expires_at TIMESTAMP NOT NULL,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE IF NOT EXISTS teacher_class_assignments (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL,
      pack_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT DEFAULT '',
      due_at TIMESTAMP,
      question_goal INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      archived INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      bloom_level TEXT DEFAULT '',
      concept_id TEXT DEFAULT '',
      stem_length_chars INTEGER DEFAULT 0,
      prompt_complexity_score INTEGER DEFAULT 0,
      reading_difficulty TEXT DEFAULT '',
      media_type TEXT DEFAULT 'text',
      distractor_profile_json TEXT DEFAULT '{}',
      question_position_policy TEXT DEFAULT 'fixed_pack_order'
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
      email TEXT DEFAULT '',
      student_user_id INTEGER,
      invite_status TEXT DEFAULT 'none',
      invite_sent_at TIMESTAMP,
      invite_delivery_status TEXT DEFAULT 'none',
      invite_last_error TEXT DEFAULT '',
      claimed_at TIMESTAMP,
      last_seen_at TIMESTAMP,
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
      student_user_id INTEGER,
      class_student_id INTEGER,
      join_mode TEXT DEFAULT 'anonymous',
      display_name_snapshot TEXT DEFAULT '',
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
      submission_retry_count INTEGER DEFAULT 0,
      reconnect_count INTEGER DEFAULT 0,
      visibility_interruptions INTEGER DEFAULT 0,
      network_degraded BOOLEAN DEFAULT FALSE,
      device_profile TEXT DEFAULT '',
      analytics_version TEXT DEFAULT 'telemetry_v2',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS student_behavior_events (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      event_type TEXT NOT NULL,
      event_ts_ms INTEGER DEFAULT 0,
      event_seq INTEGER DEFAULT 0,
      option_index INTEGER,
      payload_json TEXT DEFAULT '{}',
      network_latency_ms INTEGER DEFAULT 0,
      client_render_delay_ms INTEGER DEFAULT 0,
      device_profile TEXT DEFAULT '',
      analytics_version TEXT DEFAULT 'telemetry_v2',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS concept_attempt_history (
      id SERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      session_id INTEGER,
      question_id INTEGER,
      is_correct BOOLEAN DEFAULT FALSE,
      response_ms INTEGER DEFAULT 0,
      stress_index DOUBLE PRECISION DEFAULT 0,
      engagement_score DOUBLE PRECISION DEFAULT 0,
      prior_mastery DOUBLE PRECISION DEFAULT 0,
      attempt_number INTEGER DEFAULT 1,
      days_since_last_seen DOUBLE PRECISION DEFAULT 0,
      rolling_accuracy_5 DOUBLE PRECISION DEFAULT 0,
      rolling_stress_5 DOUBLE PRECISION DEFAULT 0,
      rolling_engagement_5 DOUBLE PRECISION DEFAULT 0,
      retention_24h DOUBLE PRECISION DEFAULT 0,
      retention_7d DOUBLE PRECISION DEFAULT 0,
      analytics_version TEXT DEFAULT 'telemetry_v2',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS analytics_labels (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      identity_key TEXT,
      label_type TEXT NOT NULL,
      label_value TEXT NOT NULL,
      source TEXT DEFAULT 'system',
      metadata_json TEXT DEFAULT '{}',
      labeled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS display_name TEXT`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS first_name TEXT`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS last_name TEXT`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en'`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE student_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS student_user_id INTEGER`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS invite_status TEXT DEFAULT 'none'`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS invite_delivery_status TEXT DEFAULT 'none'`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS invite_last_error TEXT DEFAULT ''`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP`,
  `ALTER TABLE teacher_class_students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT ''`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS due_at TIMESTAMP`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS question_goal INTEGER DEFAULT 0`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS archived INTEGER DEFAULT 0`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS created_by INTEGER`,
  `ALTER TABLE teacher_class_assignments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS learning_objective TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS bloom_level TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS concept_id TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS stem_length_chars INTEGER DEFAULT 0`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS prompt_complexity_score INTEGER DEFAULT 0`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS reading_difficulty TEXT DEFAULT ''`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'text'`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS distractor_profile_json TEXT DEFAULT '{}'`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_position_policy TEXT DEFAULT 'fixed_pack_order'`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS teacher_class_id INTEGER`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS identity_key TEXT`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS student_user_id INTEGER`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS class_student_id INTEGER`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS join_mode TEXT DEFAULT 'anonymous'`,
  `ALTER TABLE participants ADD COLUMN IF NOT EXISTS display_name_snapshot TEXT DEFAULT ''`,
  `ALTER TABLE mastery ADD COLUMN IF NOT EXISTS identity_key TEXT`,
  `ALTER TABLE mastery ADD COLUMN IF NOT EXISTS nickname TEXT`,
  `ALTER TABLE mastery ADD COLUMN IF NOT EXISTS tag TEXT`,
  `ALTER TABLE mastery ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION DEFAULT 0`,
  `ALTER TABLE mastery ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `
    DO $$
    DECLARE legacy_constraint_name TEXT;
    BEGIN
      SELECT con.conname
      INTO legacy_constraint_name
      FROM pg_constraint con
      WHERE con.conrelid = 'mastery'::regclass
        AND con.contype = 'u'
        AND (
          SELECT array_agg(att.attname::text ORDER BY key_columns.ordinality)
          FROM unnest(con.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = key_columns.attnum
        ) = ARRAY['nickname', 'tag'];

      IF legacy_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE mastery DROP CONSTRAINT %I', legacy_constraint_name);
      END IF;
    END $$;
  `,
  `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'mastery'
          AND column_name = 'score'
          AND data_type <> 'double precision'
      ) THEN
        ALTER TABLE mastery ALTER COLUMN score TYPE DOUBLE PRECISION USING score::double precision;
      END IF;
    END $$;
  `,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS option_hover_counts_json TEXT DEFAULT '{}'`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS outside_answer_pointer_moves INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS rapid_pointer_jumps INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS submission_retry_count INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS reconnect_count INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS visibility_interruptions INTEGER DEFAULT 0`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS network_degraded BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS device_profile TEXT DEFAULT ''`,
  `ALTER TABLE student_behavior_logs ADD COLUMN IF NOT EXISTS analytics_version TEXT DEFAULT 'telemetry_v2'`,
  `
    CREATE TABLE IF NOT EXISTS student_behavior_events (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      event_type TEXT NOT NULL,
      event_ts_ms INTEGER DEFAULT 0,
      event_seq INTEGER DEFAULT 0,
      option_index INTEGER,
      payload_json TEXT DEFAULT '{}',
      network_latency_ms INTEGER DEFAULT 0,
      client_render_delay_ms INTEGER DEFAULT 0,
      device_profile TEXT DEFAULT '',
      analytics_version TEXT DEFAULT 'telemetry_v2',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS concept_attempt_history (
      id SERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      session_id INTEGER,
      question_id INTEGER,
      is_correct BOOLEAN DEFAULT FALSE,
      response_ms INTEGER DEFAULT 0,
      stress_index DOUBLE PRECISION DEFAULT 0,
      engagement_score DOUBLE PRECISION DEFAULT 0,
      prior_mastery DOUBLE PRECISION DEFAULT 0,
      attempt_number INTEGER DEFAULT 1,
      days_since_last_seen DOUBLE PRECISION DEFAULT 0,
      rolling_accuracy_5 DOUBLE PRECISION DEFAULT 0,
      rolling_stress_5 DOUBLE PRECISION DEFAULT 0,
      rolling_engagement_5 DOUBLE PRECISION DEFAULT 0,
      retention_24h DOUBLE PRECISION DEFAULT 0,
      retention_7d DOUBLE PRECISION DEFAULT 0,
      analytics_version TEXT DEFAULT 'telemetry_v2',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS analytics_labels (
      id SERIAL PRIMARY KEY,
      session_id INTEGER,
      question_id INTEGER,
      participant_id INTEGER,
      identity_key TEXT,
      label_type TEXT NOT NULL,
      label_value TEXT NOT NULL,
      source TEXT DEFAULT 'system',
      metadata_json TEXT DEFAULT '{}',
      labeled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
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
  `
    CREATE TABLE IF NOT EXISTS student_memory_snapshots (
      id SERIAL PRIMARY KEY,
      identity_key TEXT NOT NULL UNIQUE,
      nickname TEXT,
      snapshot_json TEXT NOT NULL,
      source_summary_json TEXT DEFAULT '{}',
      teacher_note TEXT DEFAULT '',
      teacher_note_updated_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE practice_attempts ADD COLUMN IF NOT EXISTS identity_key TEXT`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS nickname TEXT`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS snapshot_json TEXT DEFAULT '{}'`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS source_summary_json TEXT DEFAULT '{}'`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS teacher_note TEXT DEFAULT ''`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS teacher_note_updated_at TIMESTAMP`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE student_memory_snapshots ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_pin ON sessions(pin)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_pack_status ON sessions(quiz_pack_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_student_users_email ON student_users(email)',
  'CREATE INDEX IF NOT EXISTS idx_student_password_reset_user ON student_password_reset_codes(student_user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_student_password_reset_email ON student_password_reset_codes(email, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_student_identity_links_student ON student_identity_links(student_user_id, is_primary, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_student_identity_links_identity ON student_identity_links(identity_key)',
  'CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_participants_nickname_session ON participants(nickname, session_id)',
  'CREATE INDEX IF NOT EXISTS idx_participants_identity_key ON participants(identity_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_participants_student_user_id ON participants(student_user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_answers_participant_session ON answers(participant_id, session_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_unique_submission ON answers(session_id, question_id, participant_id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_pack_order ON questions(quiz_pack_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_questions_concept_id ON questions(concept_id)',
  'CREATE INDEX IF NOT EXISTS idx_behavior_participant_session ON student_behavior_logs(participant_id, session_id)',
  'CREATE INDEX IF NOT EXISTS idx_behavior_events_participant_session ON student_behavior_events(participant_id, session_id, question_id, event_seq)',
  'CREATE INDEX IF NOT EXISTS idx_behavior_events_type_session ON student_behavior_events(event_type, session_id)',
  'CREATE INDEX IF NOT EXISTS idx_mastery_nickname ON mastery(nickname)',
  'CREATE INDEX IF NOT EXISTS idx_mastery_identity_key ON mastery(identity_key)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_mastery_identity_tag_unique ON mastery(identity_key, tag)',
  'CREATE INDEX IF NOT EXISTS idx_practice_attempts_nickname_question ON practice_attempts(nickname, question_id)',
  'CREATE INDEX IF NOT EXISTS idx_practice_attempts_identity_created ON practice_attempts(identity_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_student_memory_identity_key ON student_memory_snapshots(identity_key)',
  'CREATE INDEX IF NOT EXISTS idx_concept_attempt_history_identity_concept ON concept_attempt_history(identity_key, concept_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_analytics_labels_lookup ON analytics_labels(identity_key, label_type, labeled_at)',
  'CREATE INDEX IF NOT EXISTS idx_generation_cache_lookup ON question_generation_cache(material_profile_id, difficulty, output_language, question_count)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_profile ON quiz_packs(material_profile_id)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_source_hash ON quiz_packs(source_hash)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_packs_course_code ON quiz_packs(course_code)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_classes_teacher_archived ON teacher_classes(teacher_id, archived)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_classes_pack ON teacher_classes(pack_id)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_class_students_class ON teacher_class_students(class_id)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_class_students_email ON teacher_class_students(email)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_class_students_student_user ON teacher_class_students(student_user_id, class_id)',
  'CREATE INDEX IF NOT EXISTS idx_teacher_class_assignments_class ON teacher_class_assignments(class_id, archived, status, due_at)',
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
    UPDATE teacher_class_students
    SET invite_status = COALESCE(
      NULLIF(invite_status, ''),
      CASE
        WHEN claimed_at IS NOT NULL THEN 'claimed'
        WHEN COALESCE(email, '') <> '' THEN 'invited'
        ELSE 'none'
      END
    )
  `,
  `
    UPDATE teacher_class_students
    SET invite_delivery_status = COALESCE(
      NULLIF(invite_delivery_status, ''),
      CASE
        WHEN claimed_at IS NOT NULL THEN 'claimed'
        ELSE 'none'
      END
    )
  `,
  `
    UPDATE teacher_class_students
    SET invite_last_error = COALESCE(invite_last_error, '')
  `,
  `
    UPDATE participants
    SET join_mode = COALESCE(NULLIF(join_mode, ''), CASE WHEN student_user_id IS NOT NULL AND student_user_id > 0 THEN 'account' ELSE 'anonymous' END),
        display_name_snapshot = COALESCE(NULLIF(display_name_snapshot, ''), nickname, '')
  `,
  `
    UPDATE questions
    SET question_order = id
    WHERE question_order IS NULL OR question_order = 0
  `,
  `
    UPDATE questions
    SET concept_id = LOWER(REPLACE(REPLACE(COALESCE(NULLIF(learning_objective, ''), split_part(COALESCE(tags_json, '[]'), ',', 1), 'q-' || id::text), ' ', '-'), '--', '-'))
    WHERE concept_id IS NULL OR concept_id = ''
  `,
  `
    UPDATE questions
    SET stem_length_chars = LENGTH(COALESCE(prompt, ''))
    WHERE stem_length_chars IS NULL OR stem_length_chars = 0
  `,
  `
    UPDATE questions
    SET media_type = CASE WHEN COALESCE(image_url, '') <> '' THEN 'image' ELSE 'text' END
    WHERE media_type IS NULL OR media_type = ''
  `,
  `
    UPDATE questions
    SET reading_difficulty = CASE
      WHEN LENGTH(COALESCE(prompt, '')) >= 220 THEN 'advanced'
      WHEN LENGTH(COALESCE(prompt, '')) >= 120 THEN 'moderate'
      ELSE 'basic'
    END
    WHERE reading_difficulty IS NULL OR reading_difficulty = ''
  `,
  `
    UPDATE questions
    SET prompt_complexity_score = LEAST(
      100,
      GREATEST(
        0,
        FLOOR(LENGTH(COALESCE(prompt, '')) / 3.0)
        + CASE WHEN COALESCE(image_url, '') <> '' THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(bloom_level, '') <> '' THEN 8 ELSE 0 END
      )
    )
    WHERE prompt_complexity_score IS NULL OR prompt_complexity_score = 0
  `,
  `
    UPDATE questions
    SET distractor_profile_json = json_build_object(
      'answer_count', json_array_length(COALESCE(answers_json, '[]')::json),
      'tag_count', json_array_length(COALESCE(tags_json, '[]')::json),
      'has_image', CASE WHEN COALESCE(image_url, '') <> '' THEN true ELSE false END
    )::text
    WHERE distractor_profile_json IS NULL OR distractor_profile_json = ''
  `,
  `
    UPDATE questions
    SET question_position_policy = 'fixed_pack_order'
    WHERE question_position_policy IS NULL OR question_position_policy = ''
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
