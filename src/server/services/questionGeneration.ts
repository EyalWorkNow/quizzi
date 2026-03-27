import { createHash } from 'crypto';
import {
  buildGenerationSource,
  getCachedQuestionGeneration,
  getOrCreateMaterialProfile,
  normalizeGeneratedQuestions,
  saveCachedQuestionGeneration,
} from './materialIntel.js';
import { resolveModelSelection } from './modelProviders.js';
import {
  buildQuestionGenerationSkillPrompt,
  QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
  resolveQuestionGenerationLanguage,
  validateQuestionGenerationOutput,
} from './questionGenerationSkill.js';
import {
  buildQuestionGenerationConfigSnapshot,
  normalizeQuestionGenerationConfig,
  type QuestionGenerationMode,
} from '../../shared/questionGeneration.js';

export type QuestionGenerationRequest = ReturnType<typeof normalizeQuestionGenerationConfig> & {
  sourceText: string;
};

export type QuestionImprovementRequest = QuestionGenerationRequest & {
  existingQuestions: any[];
};

type MaterialProfileLike = {
  id?: number;
  source_language?: string;
  source_excerpt?: string;
  teaching_brief?: string;
  key_points?: string[];
  topic_fingerprint?: string[];
  supporting_excerpts?: string[];
};

function parseGeneratedPayload(rawText: string) {
  const cleanJson = String(rawText || '')
    .replace(/```(?:json)?\s*|\s*```/g, '')
    .trim();

  return JSON.parse(cleanJson || '{}');
}

function normalizeQuestionGenerationRequest(input: Partial<QuestionGenerationRequest> & { sourceText: string }) {
  const config = normalizeQuestionGenerationConfig(input);
  return {
    ...config,
    sourceText: String(input.sourceText || '').trim(),
  };
}

function buildPromptSignature(request: QuestionGenerationRequest) {
  const normalized = JSON.stringify({
    contract: QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
    language: resolveQuestionGenerationLanguage(request.language).id,
    ...buildQuestionGenerationConfigSnapshot(request),
  });

  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function normalizeLabel(value: string, fallback: string) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function resolveBloomLevel(language: string, cognitiveLevel: string) {
  const normalizedLanguage = String(language || '').trim().toLowerCase();
  const normalizedCognitiveLevel = String(cognitiveLevel || '').trim().toLowerCase();

  const maps =
    normalizedLanguage === 'hebrew' || normalizedLanguage === 'he' || normalizedLanguage === 'עברית'
      ? {
          foundational: 'מבינים',
          mixed: 'מיישמים',
          higher: 'מנתחים',
        }
      : {
          foundational: 'Understand',
          mixed: 'Apply',
          higher: 'Analyze',
        };

  if (normalizedCognitiveLevel === 'foundational') return maps.foundational;
  if (normalizedCognitiveLevel === 'higher order') return maps.higher;
  return maps.mixed;
}

function resolveTimeLimitSeconds(questionFormat: string, difficulty: string) {
  const normalizedFormat = String(questionFormat || '').trim().toLowerCase();
  const normalizedDifficulty = String(difficulty || '').trim().toLowerCase();

  const base = normalizedFormat === 'true/false' ? 15 : normalizedFormat === 'mixed' ? 18 : 20;
  if (normalizedDifficulty === 'easy') return base;
  if (normalizedDifficulty === 'hard') return base + 8;
  return base + 4;
}

function buildLearningObjective(question: any, materialProfile: MaterialProfileLike) {
  const tags = Array.isArray(question?.tags) ? question.tags.map((tag: any) => String(tag || '').trim()).filter(Boolean) : [];
  const topic = tags[0] || materialProfile.topic_fingerprint?.[0] || 'the key idea';
  return `Understand ${topic}`;
}

function enforceGeneratedQuestionPreferences(
  questions: any[],
  request: QuestionGenerationRequest,
  materialProfile: MaterialProfileLike,
) {
  const fallbackBloomLevel = resolveBloomLevel(request.language, request.cognitiveLevel || 'Mixed');
  const fallbackTimeLimit = resolveTimeLimitSeconds(request.questionFormat || 'Multiple Choice', request.difficulty);
  const fallbackTags = (materialProfile.topic_fingerprint || []).slice(0, 3);

  return questions.map((question, index) => ({
    ...question,
    tags:
      (Array.isArray(question?.tags) ? question.tags : [])
        .map((tag: any) => String(tag || '').trim())
        .filter(Boolean)
        .slice(0, 4).length > 0
        ? (Array.isArray(question?.tags) ? question.tags : [])
            .map((tag: any) => String(tag || '').trim())
            .filter(Boolean)
            .slice(0, 4)
        : fallbackTags,
    learning_objective: normalizeLabel(question?.learning_objective, buildLearningObjective(question, materialProfile)),
    bloom_level: normalizeLabel(question?.bloom_level, fallbackBloomLevel),
    time_limit_seconds: Math.max(10, Number(question?.time_limit_seconds || fallbackTimeLimit)),
    question_order: index + 1,
  }));
}

function buildExistingQuestionsBlock(existingQuestions: any[]) {
  return (Array.isArray(existingQuestions) ? existingQuestions : [])
    .slice(0, 20)
    .map((question: any, index: number) => ({
      index: index + 1,
      prompt: String(question?.prompt || '').trim(),
      answers: Array.isArray(question?.answers) ? question.answers.slice(0, 6) : [],
      correct_index: Number(question?.correct_index || 0),
      explanation: String(question?.explanation || '').trim(),
      tags: Array.isArray(question?.tags) ? question.tags.slice(0, 4) : [],
      learning_objective: String(question?.learning_objective || '').trim(),
      bloom_level: String(question?.bloom_level || '').trim(),
    }));
}

function buildExistingQuestionsSignature(existingQuestions: any[]) {
  return createHash('sha1').update(JSON.stringify(buildExistingQuestionsBlock(existingQuestions))).digest('hex').slice(0, 12);
}

export function buildQuestionGenerationInFlightKey(input: {
  mode: QuestionGenerationMode;
  sourceText: string;
  count?: number;
  difficulty?: string;
  language?: string;
  questionFormat?: string;
  cognitiveLevel?: string;
  explanationDetail?: string;
  contentFocus?: string;
  distractorStyle?: string;
  gradeLevel?: string;
  providerId?: string | null;
  modelId?: string | null;
  existingQuestions?: any[];
}) {
  const request = normalizeQuestionGenerationRequest({
    sourceText: input.sourceText,
    count: input.count,
    difficulty: input.difficulty,
    language: input.language,
    questionFormat: input.questionFormat,
    cognitiveLevel: input.cognitiveLevel,
    explanationDetail: input.explanationDetail,
    contentFocus: input.contentFocus,
    distractorStyle: input.distractorStyle,
    gradeLevel: input.gradeLevel,
    providerId: input.providerId,
    modelId: input.modelId,
  });

  const normalizedPayload = JSON.stringify({
    mode: input.mode,
    source_hash: createHash('sha1').update(request.sourceText).digest('hex'),
    ...buildQuestionGenerationConfigSnapshot(request),
    existing_questions_hash: input.mode === 'improve' ? buildExistingQuestionsSignature(input.existingQuestions || []) : '',
  });

  return createHash('sha1').update(normalizedPayload).digest('hex');
}

type QuestionGenerationContext = {
  request: QuestionGenerationRequest;
  materialProfile: any;
  generationSource: ReturnType<typeof buildGenerationSource>;
  resolved: ReturnType<typeof resolveModelSelection>;
  resolvedLanguage: ReturnType<typeof resolveQuestionGenerationLanguage>;
  cacheModelKey: string;
};

async function createQuestionGenerationContext(input: Partial<QuestionGenerationRequest> & { sourceText: string }) {
  const request = normalizeQuestionGenerationRequest(input);
  const materialProfile = await getOrCreateMaterialProfile(request.sourceText);
  const generationSource = await buildGenerationSource(materialProfile);
  const resolved = resolveModelSelection(request.providerId, request.modelId);
  const resolvedLanguage = resolveQuestionGenerationLanguage(request.language);
  const promptSignature = buildPromptSignature(request);

  return {
    request,
    materialProfile,
    generationSource,
    resolved,
    resolvedLanguage,
    cacheModelKey: `${resolved.model.id}:${promptSignature}`,
  } satisfies QuestionGenerationContext;
}

function buildQuestionGenerationResult(
  context: QuestionGenerationContext,
  normalizedQuestions: any[],
  meta: Record<string, unknown> = {},
) {
  return {
    questions: normalizedQuestions,
    generation_meta: {
      cached: false,
      source_mode: context.generationSource.source_mode,
      estimated_original_tokens: context.generationSource.estimated_original_tokens,
      estimated_prompt_tokens: context.generationSource.estimated_prompt_tokens,
      token_savings_pct: context.generationSource.token_savings_pct,
      provider: context.resolved.provider.catalog.id,
      provider_label: context.resolved.provider.catalog.label,
      model: context.resolved.model.id,
      model_label: context.resolved.model.label,
      contract_version: QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
      output_language: context.resolvedLanguage.label,
      output_language_code: context.resolvedLanguage.id,
      request_profile: buildQuestionGenerationConfigSnapshot(context.request),
      ...meta,
    },
    material_profile: {
      id: Number(context.materialProfile.id),
      source_language: context.materialProfile.source_language,
      source_excerpt: context.materialProfile.source_excerpt,
      teaching_brief: context.materialProfile.teaching_brief,
      key_points: context.materialProfile.key_points,
      topic_fingerprint: context.materialProfile.topic_fingerprint,
    },
  };
}

async function executeValidatedQuestionGeneration(input: {
  context: QuestionGenerationContext;
  promptFactory: (retryFeedback: string) => string;
}) {
  let lastFailureSummary = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rawText = await input.context.resolved.provider.generateJson({
        modelId: input.context.resolved.model.id,
        prompt: input.promptFactory(lastFailureSummary),
      });

      const parsed = parseGeneratedPayload(rawText);
      const normalizedQuestions = enforceGeneratedQuestionPreferences(
        normalizeGeneratedQuestions(parsed?.questions || [], input.context.materialProfile.topic_fingerprint || []),
        input.context.request,
        input.context.materialProfile,
      );

      const validation = validateQuestionGenerationOutput({
        questions: normalizedQuestions,
        count: input.context.request.count,
        language: input.context.resolvedLanguage.label,
        questionFormat: input.context.request.questionFormat,
      });

      if (validation.ok) {
        return {
          attempts: attempt,
          normalizedQuestions,
        };
      }

      lastFailureSummary = validation.summary || `Attempt ${attempt} did not satisfy the requested language and format contract.`;
    } catch (error: any) {
      lastFailureSummary = [
        `Attempt ${attempt} returned invalid JSON or an unusable payload.`,
        `Parser/runtime detail: ${String(error?.message || error || 'Unknown parsing error').slice(0, 240)}`,
      ].join('\n');
    }
  }

  throw new Error(
    `AI generation failed to satisfy the ${input.context.resolvedLanguage.label} language contract after multiple attempts. ${lastFailureSummary}`.trim(),
  );
}

export async function generateQuestionsFromSource(request: QuestionGenerationRequest) {
  const context = await createQuestionGenerationContext(request);

  const cached = (await getCachedQuestionGeneration(
      Number(context.materialProfile.id),
      Number(context.request.count),
      String(context.request.difficulty),
      context.resolvedLanguage.label,
      context.resolved.provider.catalog.id,
      context.cacheModelKey,
    ));

  if (cached?.response?.questions?.length) {
    return {
      ...cached.response,
      generation_meta: {
        ...(cached.response?.generation_meta || {}),
        cached: true,
        source_mode: context.generationSource.source_mode,
        estimated_original_tokens: context.generationSource.estimated_original_tokens,
        estimated_prompt_tokens: context.generationSource.estimated_prompt_tokens,
        token_savings_pct: context.generationSource.token_savings_pct,
        provider: context.resolved.provider.catalog.id,
        provider_label: context.resolved.provider.catalog.label,
        model: context.resolved.model.id,
        model_label: context.resolved.model.label,
        contract_version:
          cached.response?.generation_meta?.contract_version || QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
        output_language: context.resolvedLanguage.label,
        output_language_code: context.resolvedLanguage.id,
        request_profile: buildQuestionGenerationConfigSnapshot(context.request),
      },
      material_profile: {
        id: Number(context.materialProfile.id),
        source_language: context.materialProfile.source_language,
        source_excerpt: context.materialProfile.source_excerpt,
        teaching_brief: context.materialProfile.teaching_brief,
        key_points: context.materialProfile.key_points,
        topic_fingerprint: context.materialProfile.topic_fingerprint,
      },
    };
  }
  const execution = await executeValidatedQuestionGeneration({
    context,
    promptFactory: (retryFeedback) =>
      buildQuestionGenerationSkillPrompt({
        count: context.request.count,
        difficulty: context.request.difficulty,
        language: context.resolvedLanguage.label,
        questionFormat: context.request.questionFormat,
        cognitiveLevel: context.request.cognitiveLevel,
        explanationDetail: context.request.explanationDetail,
        contentFocus: context.request.contentFocus,
        distractorStyle: context.request.distractorStyle,
        gradeLevel: context.request.gradeLevel,
        material: context.generationSource.material,
        sourceLanguage: context.materialProfile.source_language,
        topicFingerprint: context.materialProfile.topic_fingerprint || [],
        keyPoints: context.materialProfile.key_points || [],
        supportingExcerpts: context.materialProfile.supporting_excerpts || [],
        retryFeedback,
      }),
  });

  const payload = buildQuestionGenerationResult(context, execution.normalizedQuestions, {
    attempts: execution.attempts,
    language_validated: true,
  });

  await saveCachedQuestionGeneration(
    Number(context.materialProfile.id),
    Number(context.request.count),
    String(context.request.difficulty),
    context.resolvedLanguage.label,
    payload,
    context.resolved.provider.catalog.id,
    context.cacheModelKey,
  );

  return payload;
}

export async function improveQuestionsFromSource(
  request: QuestionImprovementRequest,
) {
  const context = await createQuestionGenerationContext({
    ...request,
    count: Math.max(1, Math.min(Number(request.count || request.existingQuestions.length || 5), 20)),
  });
  const existingQuestionsBlock = buildExistingQuestionsBlock(request.existingQuestions);

  const execution = await executeValidatedQuestionGeneration({
    context,
    promptFactory: (retryFeedback) =>
      [
        buildQuestionGenerationSkillPrompt({
          count: context.request.count,
          difficulty: context.request.difficulty,
          language: context.resolvedLanguage.label,
          questionFormat: context.request.questionFormat,
          cognitiveLevel: context.request.cognitiveLevel,
          explanationDetail: context.request.explanationDetail,
          contentFocus: context.request.contentFocus,
          distractorStyle: context.request.distractorStyle,
          gradeLevel: context.request.gradeLevel,
          material: context.generationSource.material,
          sourceLanguage: context.materialProfile.source_language,
          topicFingerprint: context.materialProfile.topic_fingerprint || [],
          keyPoints: context.materialProfile.key_points || [],
          supportingExcerpts: context.materialProfile.supporting_excerpts || [],
          retryFeedback,
        }),
        '',
        'Improvement Mode:',
        '- Improve the existing questions instead of inventing a completely unrelated set.',
        '- Keep coverage aligned to the original weak spots, concepts, and likely classroom misconceptions.',
        '- Rewrite unclear prompts, strengthen distractors, fix ambiguity, and keep the best underlying teaching intent.',
        '- Return the improved set in the same JSON schema.',
        '',
        `Existing Questions to Improve:\n${JSON.stringify(existingQuestionsBlock, null, 2)}`,
      ].join('\n'),
  });

  return buildQuestionGenerationResult(context, execution.normalizedQuestions, {
    attempts: execution.attempts,
    improvement_mode: true,
    language_validated: true,
    existing_questions_count: existingQuestionsBlock.length,
  });
}
