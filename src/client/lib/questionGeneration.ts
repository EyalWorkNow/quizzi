import {
  DEFAULT_QUESTION_GENERATION_CONFIG,
  normalizeQuestionGenerationConfig,
  QUESTION_GENERATION_PRESETS,
  type QuestionGenerationConfig,
  type QuestionGenerationMode,
  type QuestionGenerationPreset,
} from '../../shared/questionGeneration.ts';

export {
  DEFAULT_QUESTION_GENERATION_CONFIG,
  QUESTION_GENERATION_PRESETS,
  type QuestionGenerationConfig,
  type QuestionGenerationMode,
  type QuestionGenerationPreset,
};

export function resolveQuestionGenerationPreset(presetId: string) {
  return QUESTION_GENERATION_PRESETS.find((preset) => preset.id === presetId) || null;
}

export function buildQuestionGenerationApiPayload(input: {
  sourceText: string;
  config: Partial<QuestionGenerationConfig>;
  mode?: QuestionGenerationMode;
  existingQuestions?: any[];
}) {
  const normalized = normalizeQuestionGenerationConfig(input.config);
  const mode = input.mode || 'generate';

  return {
    source_text: String(input.sourceText || ''),
    count: normalized.count,
    difficulty: normalized.difficulty,
    language: normalized.language,
    question_format: normalized.questionFormat,
    cognitive_level: normalized.cognitiveLevel,
    explanation_detail: normalized.explanationDetail,
    content_focus: normalized.contentFocus,
    distractor_style: normalized.distractorStyle,
    grade_level: normalized.gradeLevel,
    ...(normalized.providerId ? { provider_id: normalized.providerId } : {}),
    ...(normalized.modelId ? { model_id: normalized.modelId } : {}),
    ...(mode === 'improve' ? { existing_questions: Array.isArray(input.existingQuestions) ? input.existingQuestions : [] } : {}),
  };
}
