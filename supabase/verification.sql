SELECT current_database() AS database_name;

SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

SELECT 'users' AS table_name, COUNT(*)::INTEGER AS row_count FROM users
UNION ALL
SELECT 'quiz_packs', COUNT(*)::INTEGER FROM quiz_packs
UNION ALL
SELECT 'questions', COUNT(*)::INTEGER FROM questions
UNION ALL
SELECT 'material_profiles', COUNT(*)::INTEGER FROM material_profiles
UNION ALL
SELECT 'question_generation_cache', COUNT(*)::INTEGER FROM question_generation_cache
UNION ALL
SELECT 'sessions', COUNT(*)::INTEGER FROM sessions
UNION ALL
SELECT 'participants', COUNT(*)::INTEGER FROM participants
UNION ALL
SELECT 'answers', COUNT(*)::INTEGER FROM answers
UNION ALL
SELECT 'student_behavior_logs', COUNT(*)::INTEGER FROM student_behavior_logs
UNION ALL
SELECT 'mastery', COUNT(*)::INTEGER FROM mastery
UNION ALL
SELECT 'practice_attempts', COUNT(*)::INTEGER FROM practice_attempts
ORDER BY table_name;

SELECT id, title, question_count_cache, created_at
FROM quiz_packs
ORDER BY id DESC
LIMIT 10;
