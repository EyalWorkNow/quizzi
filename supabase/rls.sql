BEGIN;

-- Safe baseline: enable RLS everywhere and create no public policies yet.
-- Anonymous and authenticated browser clients will be denied by default
-- until you add explicit policies for the flows you want.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_generation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_behavior_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;

COMMIT;
