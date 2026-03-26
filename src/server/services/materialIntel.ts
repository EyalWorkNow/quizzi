import { createHash } from 'crypto';
import db from '../db/index.js';

const PROMPT_VERSION = 'compressed-v3';

function buildPromptVersionKey(providerKey?: string | null, modelKey?: string | null) {
  const provider = String(providerKey || 'gemini').trim() || 'gemini';
  const model = String(modelKey || 'default').trim() || 'default';
  return `${PROMPT_VERSION}:${provider}:${model}`;
}

const EN_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'because', 'been', 'before', 'being', 'between',
  'both', 'can', 'could', 'during', 'each', 'from', 'have', 'into', 'more', 'most', 'other', 'over',
  'same', 'should', 'some', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'under', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

const HE_STOPWORDS = new Set([
  'אבל', 'אחרי', 'איך', 'אין', 'אלה', 'אם', 'אנחנו', 'אני', 'אפשר', 'את', 'אתה', 'אתם', 'אתן', 'גם',
  'האם', 'הוא', 'היא', 'הם', 'הן', 'הרבה', 'הזה', 'הזאת', 'היה', 'היו', 'היום', 'וכל', 'ולא', 'ומה',
  'ומי', 'זה', 'זאת', 'זהו', 'זוהי', 'חלק', 'כך', 'כבר', 'כל', 'כלל', 'כמו', 'כן', 'לא', 'להיות',
  'לזה', 'לכן', 'מאוד', 'מה', 'מול', 'מי', 'מן', 'ממש', 'משום', 'נתון', 'על', 'עוד', 'רק', 'של',
  'שם', 'תהיה', 'תוך',
]);

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clipText(value: string, maxLength: number) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(String(value || '').length / 4));
}

export function normalizeSourceText(sourceText: string) {
  return String(sourceText || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectSourceLanguage(text: string) {
  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  return hebrewChars > latinChars ? 'Hebrew' : 'English';
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(text: string) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24);
}

function normalizeToken(token: string) {
  return token
    .toLowerCase()
    .replace(/^[^a-z\u0590-\u05FF]+|[^a-z\u0590-\u05FF]+$/gi, '')
    .trim();
}

function tokenize(text: string, language: string) {
  const matches =
    language === 'Hebrew'
      ? text.match(/[א-ת][א-ת"'־-]{1,}/g)
      : text.match(/[A-Za-z][A-Za-z'-]{2,}/g);

  const stopwords = language === 'Hebrew' ? HE_STOPWORDS : EN_STOPWORDS;

  return (matches || [])
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

function sentenceScore(sentence: string, keywords: string[]) {
  const lower = sentence.toLowerCase();
  return keywords.reduce((score, keyword, index) => {
    if (!keyword) return score;
    return score + (lower.includes(keyword.toLowerCase()) ? Math.max(1, keywords.length - index) : 0);
  }, 0);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(value);
  }

  return output;
}

function extractTopicFingerprint(text: string, language: string, limit = 8) {
  const tokens = tokenize(text, language);
  const counts = new Map<string, number>();

  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function buildSupportingExcerpts(paragraphs: string[], keywords: string[]) {
  return paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: sentenceScore(paragraph, keywords) + (index === 0 ? 1.5 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((entry) => clipText(entry.paragraph, 360));
}

export function buildMaterialProfileDraft(sourceText: string) {
  const normalizedText = normalizeSourceText(sourceText);
  const sourceLanguage = detectSourceLanguage(normalizedText);
  const paragraphs = splitParagraphs(normalizedText);
  const sentences = splitSentences(normalizedText);
  const topicFingerprint = extractTopicFingerprint(normalizedText, sourceLanguage, 10);

  const rankedSentences = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: sentenceScore(sentence, topicFingerprint) + (index < 2 ? 1.25 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const summarySentences = uniqueStrings(
    rankedSentences
      .slice(0, 4)
      .sort((left, right) => left.index - right.index)
      .map((entry) => clipText(entry.sentence, 220)),
  ).slice(0, 3);

  const supportingExcerpts = buildSupportingExcerpts(paragraphs, topicFingerprint);
  const keyPoints = uniqueStrings(
    [
      ...summarySentences,
      ...supportingExcerpts.map((excerpt) => excerpt.split(/(?<=[.!?。！？])\s+/)[0] || excerpt),
    ].map((item) => clipText(item, 200)),
  ).slice(0, 4);

  const sourceExcerpt = clipText(paragraphs[0] || normalizedText, 320);

  const teachingBrief = [
    `Summary: ${summarySentences.join(' ') || sourceExcerpt}`,
    keyPoints.length > 0 ? `Key points:\n${keyPoints.map((point) => `- ${point}`).join('\n')}` : '',
    topicFingerprint.length > 0 ? `Key concepts: ${topicFingerprint.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const compactPromptSource = [
    `Language: ${sourceLanguage}`,
    teachingBrief,
    supportingExcerpts.length > 0
      ? `Supporting excerpts:\n${supportingExcerpts.map((excerpt, index) => `${index + 1}. ${excerpt}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    source_hash: createHash('sha256').update(normalizedText).digest('hex'),
    normalized_text: normalizedText,
    source_excerpt: sourceExcerpt,
    teaching_brief: teachingBrief,
    source_language: sourceLanguage,
    word_count: normalizedText ? normalizedText.split(/\s+/).length : 0,
    char_count: normalizedText.length,
    paragraph_count: paragraphs.length,
    key_points: keyPoints,
    topic_fingerprint: topicFingerprint,
    supporting_excerpts: supportingExcerpts,
    estimated_original_tokens: estimateTokens(normalizedText),
    estimated_prompt_tokens: estimateTokens(compactPromptSource),
    compact_prompt_source: compactPromptSource,
  };
}

function parseMaterialProfile(row: any) {
  if (!row) return null;
  return {
    ...row,
    word_count: Number(row.word_count || 0),
    char_count: Number(row.char_count || 0),
    paragraph_count: Number(row.paragraph_count || 0),
    estimated_original_tokens: Number(row.estimated_original_tokens || 0),
    estimated_prompt_tokens: Number(row.estimated_prompt_tokens || 0),
    key_points: parseJsonArray(row.key_points_json),
    topic_fingerprint: parseJsonArray(row.topic_fingerprint_json),
    supporting_excerpts: parseJsonArray(row.supporting_excerpts_json),
  };
}

export async function getOrCreateMaterialProfile(sourceText: string) {
  const draft = buildMaterialProfileDraft(sourceText);
  const existing = (await db.prepare('SELECT * FROM material_profiles WHERE source_hash = ?').get(draft.source_hash));

  if (existing) {
    return parseMaterialProfile(existing);
  }

  (await db.prepare(`
    INSERT INTO material_profiles (
      source_hash,
      normalized_text,
      source_excerpt,
      teaching_brief,
      source_language,
      word_count,
      char_count,
      paragraph_count,
      key_points_json,
      topic_fingerprint_json,
      supporting_excerpts_json,
      estimated_original_tokens,
      estimated_prompt_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        draft.source_hash,
        draft.normalized_text,
        draft.source_excerpt,
        draft.teaching_brief,
        draft.source_language,
        draft.word_count,
        draft.char_count,
        draft.paragraph_count,
        JSON.stringify(draft.key_points),
        JSON.stringify(draft.topic_fingerprint),
        JSON.stringify(draft.supporting_excerpts),
        draft.estimated_original_tokens,
        draft.estimated_prompt_tokens,
      ));

  return parseMaterialProfile((await db.prepare('SELECT * FROM material_profiles WHERE source_hash = ?').get(draft.source_hash)));
}

export function buildGenerationSource(profile: any) {
  const draft = buildMaterialProfileDraft(profile?.normalized_text || '');
  const rawSource = String(profile?.normalized_text || draft.normalized_text || '');
  const compactPromptSource = draft.compact_prompt_source;
  const useCompressedSource = rawSource.length > 2600;
  const material = useCompressedSource ? compactPromptSource : rawSource;
  const estimatedOriginalTokens = estimateTokens(rawSource);
  const estimatedPromptTokens = estimateTokens(material);

  return {
    material,
    source_mode: useCompressedSource ? 'compressed' : 'raw',
    estimated_original_tokens: estimatedOriginalTokens,
    estimated_prompt_tokens: estimatedPromptTokens,
    token_savings_pct:
      estimatedOriginalTokens > 0
        ? Math.max(0, Math.round(((estimatedOriginalTokens - estimatedPromptTokens) / estimatedOriginalTokens) * 100))
        : 0,
  };
}

export async function getCachedQuestionGeneration(
  materialProfileId: number,
  questionCount: number,
  difficulty: string,
  outputLanguage: string,
  providerKey?: string | null,
  modelKey?: string | null,
) {
  const row = (await db.prepare(`
    SELECT *
    FROM question_generation_cache
    WHERE material_profile_id = ?
      AND question_count = ?
      AND difficulty = ?
      AND output_language = ?
      AND prompt_version = ?
  `).get(materialProfileId, questionCount, difficulty, outputLanguage, buildPromptVersionKey(providerKey, modelKey)));

  if (!row) return null;

  return {
    ...row,
    response: JSON.parse(row.response_json),
  };
}

export async function saveCachedQuestionGeneration(
  materialProfileId: number,
  questionCount: number,
  difficulty: string,
  outputLanguage: string,
  response: unknown,
  providerKey?: string | null,
  modelKey?: string | null,
) {
  (await db.prepare(`
    INSERT INTO question_generation_cache (
      material_profile_id,
      difficulty,
      output_language,
      question_count,
      prompt_version,
      response_json
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(material_profile_id, difficulty, output_language, question_count, prompt_version)
    DO UPDATE SET
      response_json = excluded.response_json,
      created_at = CURRENT_TIMESTAMP
  `).run(
        materialProfileId,
        difficulty,
        outputLanguage,
        questionCount,
        buildPromptVersionKey(providerKey, modelKey),
        JSON.stringify(response),
      ));
}

export function normalizeGeneratedQuestions(questions: any[], fallbackTags: string[] = []) {
  const safeFallbackTags = fallbackTags.length > 0 ? fallbackTags.slice(0, 3) : ['general'];
  const maxAnswers = 8;

  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => {
      const answers = Array.isArray(question?.answers)
        ? question.answers.map((answer: any) => String(answer || '').trim()).filter(Boolean).slice(0, maxAnswers)
        : [];
      const tags = Array.isArray(question?.tags)
        ? question.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean)
        : [];

      return {
        prompt: String(question?.prompt || '').trim(),
        answers,
        correct_index: Math.max(0, Math.min(answers.length - 1, Number(question?.correct_index || 0))),
        explanation: String(question?.explanation || '').trim(),
        image_url: String(question?.image_url || question?.imageUrl || '').trim(),
        tags: (tags.length > 0 ? tags : safeFallbackTags).slice(0, 4),
        time_limit_seconds: Math.max(10, Number(question?.time_limit_seconds || 20)),
        question_order: index + 1,
        learning_objective: String(question?.learning_objective || '').trim(),
        bloom_level: String(question?.bloom_level || '').trim(),
      };
    })
    .filter((question) => question.prompt && question.answers.length >= 2);
}

function deriveTopTagsFromQuestions(questions: any[]) {
  return Array.from(
    new Set(
      questions.flatMap((question) =>
        (
          Array.isArray(question?.tags)
            ? question.tags
            : parseJsonArray(question?.tags_json)
        )
          .map((tag: any) => String(tag || '').trim())
          .filter(Boolean),
      ),
    ),
  ).slice(0, 6);
}

async function topTagsFromDatabase(packId: number) {
  const rows = (await db.prepare('SELECT tags_json FROM questions WHERE quiz_pack_id = ?').all(packId));
  return Array.from(
    new Set(
      rows.flatMap((row: any) =>
        parseJsonArray(row.tags_json)
          .map((tag: any) => String(tag || '').trim())
          .filter(Boolean),
      ),
    ),
  ).slice(0, 6);
}

export async function syncPackDerivedData(packId: number, sourceText: string, questions?: any[], overrideLanguage?: string) {
  const profile = (await getOrCreateMaterialProfile(sourceText || ''));
  const topTags = questions ? deriveTopTagsFromQuestions(questions) : (await topTagsFromDatabase(packId));
  const questionCount =
    Array.isArray(questions) && questions.length > 0
      ? questions.length
      : Number(
          (await db.prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_pack_id = ?').get(packId))?.count || 0,
        );

  (await db.prepare(`
    UPDATE quiz_packs
    SET
      material_profile_id = ?,
      source_hash = ?,
      source_excerpt = ?,
      source_language = ?,
      source_word_count = ?,
      top_tags_json = ?,
      question_count_cache = ?
    WHERE id = ?
  `).run(
        profile.id,
        profile.source_hash,
        profile.source_excerpt,
        overrideLanguage || profile.source_language,
        profile.word_count,
        JSON.stringify(topTags),
        questionCount,
        packId,
      ));

  return {
    profile,
    top_tags: topTags,
    question_count: questionCount,
  };
}

export async function hydratePack(pack: any) {
  if (!pack) return null;

  if (!pack.material_profile_id || !pack.source_excerpt || !pack.source_language || !pack.top_tags_json) {
    (await syncPackDerivedData(pack.id, pack.source_text || ''));
    pack = (await db.prepare('SELECT * FROM quiz_packs WHERE id = ?').get(pack.id));
  }

  const profile = pack.material_profile_id
    ? parseMaterialProfile((await db.prepare('SELECT * FROM material_profiles WHERE id = ?').get(pack.material_profile_id)))
    : null;

  const topTags = parseJsonArray(pack.top_tags_json);
  const learningObjectives = parseJsonArray(pack.learning_objectives_json);
  const bloomLevels = parseJsonArray(pack.bloom_levels_json);
  const questionCount = Number(pack.question_count_cache || 0);
  const estimatedOriginalTokens = Number(profile?.estimated_original_tokens || estimateTokens(pack.source_text || ''));
  const estimatedPromptTokens = Number(profile?.estimated_prompt_tokens || estimatedOriginalTokens);

  return {
    ...pack,
    top_tags: topTags.length > 0 ? topTags : profile?.topic_fingerprint?.slice(0, 4) || ['General'],
    question_count: questionCount,
    source_excerpt: pack.source_excerpt || profile?.source_excerpt || clipText(pack.source_text || '', 320),
    source_language: pack.source_language || profile?.source_language || detectSourceLanguage(pack.source_text || ''),
    source_word_count: Number(pack.source_word_count || profile?.word_count || 0),
    course_code: pack.course_code || '',
    course_name: pack.course_name || '',
    section_name: pack.section_name || '',
    academic_term: pack.academic_term || '',
    week_label: pack.week_label || '',
    learning_objectives: learningObjectives,
    bloom_levels: bloomLevels,
    pack_notes: pack.pack_notes || '',
    teaching_brief: profile?.teaching_brief || '',
    topic_fingerprint: profile?.topic_fingerprint || [],
    key_points: profile?.key_points || [],
    supporting_excerpts: profile?.supporting_excerpts || [],
    estimated_original_tokens: estimatedOriginalTokens,
    estimated_prompt_tokens: estimatedPromptTokens,
    token_savings_pct:
      estimatedOriginalTokens > 0
        ? Math.max(0, Math.round(((estimatedOriginalTokens - estimatedPromptTokens) / estimatedOriginalTokens) * 100))
        : 0,
  };
}

export async function listHydratedPacks({
  teacherUserId,
  publicOnly = false,
}: {
  teacherUserId?: number | null;
  publicOnly?: boolean;
} = {}) {
  const normalizedTeacherUserId = Number(teacherUserId || 0);
  let rows: any[] = [];

  if (normalizedTeacherUserId > 0) {
    rows = (await db
        .prepare('SELECT * FROM quiz_packs WHERE teacher_id = ? ORDER BY created_at DESC, id DESC')
        .all(normalizedTeacherUserId)) as any[];
  } else if (publicOnly) {
    rows = (await db
        .prepare('SELECT * FROM quiz_packs WHERE is_public = 1 ORDER BY created_at DESC, id DESC')
        .all()) as any[];
  }

  return Promise.all(rows.map((pack: any) => hydratePack(pack)));
}

export async function getHydratedPackWithQuestions(
  packId: number,
  {
    teacherUserId,
    allowPublic = false,
  }: {
    teacherUserId?: number | null;
    allowPublic?: boolean;
  } = {},
) {
  const normalizedTeacherUserId = Number(teacherUserId || 0);
  const filters = ['id = ?'];
  const params: Array<number> = [packId];

  if (normalizedTeacherUserId > 0) {
    filters.push(allowPublic ? '(teacher_id = ? OR is_public = 1)' : 'teacher_id = ?');
    params.push(normalizedTeacherUserId);
  } else if (allowPublic) {
    filters.push('is_public = 1');
  }

  const pack = (await db.prepare(`SELECT * FROM quiz_packs WHERE ${filters.join(' AND ')}`).get(...params));
  if (!pack) return null;

  const hydratedPack = (await hydratePack(pack));
  const questions = (await db
      .prepare('SELECT * FROM questions WHERE quiz_pack_id = ? ORDER BY question_order ASC, id ASC')
      .all(packId))
    .map((question: any) => ({
      ...question,
      tags: parseJsonArray(question.tags_json),
      answers: parseJsonArray(question.answers_json),
      image_url: question.image_url || '',
      learning_objective: question.learning_objective || '',
      bloom_level: question.bloom_level || '',
    }));

  return {
    ...hydratedPack,
    questions,
  };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
