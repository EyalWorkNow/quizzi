export type QuestionGenerationMode = 'generate' | 'improve';

export type QuestionGenerationConfig = {
  count: number;
  difficulty: string;
  language: string;
  questionFormat: string;
  cognitiveLevel: string;
  explanationDetail: string;
  contentFocus: string;
  distractorStyle: string;
  gradeLevel: string;
  providerId: string | null;
  modelId: string | null;
};

export type QuestionGenerationPreset = {
  id: string;
  label: string;
  difficulty: string;
  questionFormat: string;
  cognitiveLevel: string;
  explanationDetail: string;
  contentFocus: string;
  distractorStyle: string;
  questionCount: number;
};

export const DEFAULT_QUESTION_GENERATION_CONFIG: QuestionGenerationConfig = {
  count: 5,
  difficulty: 'Medium',
  language: 'English',
  questionFormat: 'Multiple Choice',
  cognitiveLevel: 'Mixed',
  explanationDetail: 'Concise',
  contentFocus: 'Balanced',
  distractorStyle: 'Standard',
  gradeLevel: 'Auto',
  providerId: null,
  modelId: null,
};

export const QUESTION_GENERATION_PRESETS: QuestionGenerationPreset[] = [
  {
    id: 'quick-test',
    label: 'Quick Test',
    difficulty: 'Medium',
    questionFormat: 'Multiple Choice',
    cognitiveLevel: 'Mixed',
    explanationDetail: 'Concise',
    contentFocus: 'Core Concepts',
    distractorStyle: 'Standard',
    questionCount: 5,
  },
  {
    id: 'bagrut-review',
    label: 'Bagrut Review',
    difficulty: 'Hard',
    questionFormat: 'Multiple Choice',
    cognitiveLevel: 'Higher Order',
    explanationDetail: 'Detailed',
    contentFocus: 'Cause & Effect',
    distractorStyle: 'Challenging',
    questionCount: 10,
  },
  {
    id: 'misconception-check',
    label: 'Misconception Check',
    difficulty: 'Medium',
    questionFormat: 'Mixed',
    cognitiveLevel: 'Mixed',
    explanationDetail: 'Concise',
    contentFocus: 'Misconceptions',
    distractorStyle: 'Diagnostic',
    questionCount: 5,
  },
  {
    id: 'calm-practice',
    label: 'Calm Practice',
    difficulty: 'Easy',
    questionFormat: 'Multiple Choice',
    cognitiveLevel: 'Foundational',
    explanationDetail: 'Concise',
    contentFocus: 'Balanced',
    distractorStyle: 'Standard',
    questionCount: 5,
  },
];

function normalizeLabel(value: unknown, fallback: string) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function normalizeQuestionGenerationConfig(input: Partial<QuestionGenerationConfig> = {}): QuestionGenerationConfig {
  return {
    count: Math.max(1, Math.min(20, Number(input.count || DEFAULT_QUESTION_GENERATION_CONFIG.count || 5))),
    difficulty: normalizeLabel(input.difficulty, DEFAULT_QUESTION_GENERATION_CONFIG.difficulty),
    language: normalizeLabel(input.language, DEFAULT_QUESTION_GENERATION_CONFIG.language),
    questionFormat: normalizeLabel(input.questionFormat, DEFAULT_QUESTION_GENERATION_CONFIG.questionFormat),
    cognitiveLevel: normalizeLabel(input.cognitiveLevel, DEFAULT_QUESTION_GENERATION_CONFIG.cognitiveLevel),
    explanationDetail: normalizeLabel(input.explanationDetail, DEFAULT_QUESTION_GENERATION_CONFIG.explanationDetail),
    contentFocus: normalizeLabel(input.contentFocus, DEFAULT_QUESTION_GENERATION_CONFIG.contentFocus),
    distractorStyle: normalizeLabel(input.distractorStyle, DEFAULT_QUESTION_GENERATION_CONFIG.distractorStyle),
    gradeLevel: normalizeLabel(input.gradeLevel, DEFAULT_QUESTION_GENERATION_CONFIG.gradeLevel),
    providerId: String(input.providerId || '').trim() || null,
    modelId: String(input.modelId || '').trim() || null,
  };
}

export function buildQuestionGenerationConfigSnapshot(input: Partial<QuestionGenerationConfig> = {}) {
  const normalized = normalizeQuestionGenerationConfig(input);
  return {
    count: normalized.count,
    difficulty: normalized.difficulty.toLowerCase(),
    language: normalized.language.toLowerCase(),
    question_format: normalized.questionFormat.toLowerCase(),
    cognitive_level: normalized.cognitiveLevel.toLowerCase(),
    explanation_detail: normalized.explanationDetail.toLowerCase(),
    content_focus: normalized.contentFocus.toLowerCase(),
    distractor_style: normalized.distractorStyle.toLowerCase(),
    grade_level: normalized.gradeLevel.toLowerCase(),
    provider_id: String(normalized.providerId || 'default-provider').toLowerCase(),
    model_id: String(normalized.modelId || 'default-model').toLowerCase(),
  };
}
