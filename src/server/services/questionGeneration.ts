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

type QuestionGenerationRequest = {
  sourceText: string;
  count: number;
  difficulty: string;
  language: string;
  questionFormat?: string;
  cognitiveLevel?: string;
  explanationDetail?: string;
  contentFocus?: string;
  distractorStyle?: string;
  gradeLevel?: string;
  providerId?: string | null;
  modelId?: string | null;
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

function buildPromptSignature(request: QuestionGenerationRequest) {
  const normalized = JSON.stringify({
    contract: QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
    language: resolveQuestionGenerationLanguage(request.language).id,
    difficulty: String(request.difficulty || '').trim().toLowerCase(),
    questionFormat: String(request.questionFormat || 'Multiple Choice').trim().toLowerCase(),
    cognitiveLevel: String(request.cognitiveLevel || 'Mixed').trim().toLowerCase(),
    explanationDetail: String(request.explanationDetail || 'Concise').trim().toLowerCase(),
    contentFocus: String(request.contentFocus || 'Balanced').trim().toLowerCase(),
    distractorStyle: String(request.distractorStyle || 'Standard').trim().toLowerCase(),
    gradeLevel: String(request.gradeLevel || 'Auto').trim().toLowerCase(),
    count: Number(request.count || 0),
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

export async function generateQuestionsFromSource(request: QuestionGenerationRequest) {
  const materialProfile = (await getOrCreateMaterialProfile(request.sourceText));
  const generationSource = (await buildGenerationSource(materialProfile));
  const resolved = resolveModelSelection(request.providerId, request.modelId);
  const resolvedLanguage = resolveQuestionGenerationLanguage(request.language);
  const promptSignature = buildPromptSignature(request);
  const cacheModelKey = `${resolved.model.id}:${promptSignature}`;

  const cached = (await getCachedQuestionGeneration(
      Number(materialProfile.id),
      Number(request.count),
      String(request.difficulty),
      resolvedLanguage.label,
      resolved.provider.catalog.id,
      cacheModelKey,
    ));

  if (cached?.response?.questions?.length) {
    return {
      ...cached.response,
      generation_meta: {
        ...(cached.response?.generation_meta || {}),
        cached: true,
        source_mode: generationSource.source_mode,
        estimated_original_tokens: generationSource.estimated_original_tokens,
        estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
        token_savings_pct: generationSource.token_savings_pct,
        provider: resolved.provider.catalog.id,
        provider_label: resolved.provider.catalog.label,
        model: resolved.model.id,
        model_label: resolved.model.label,
        contract_version:
          cached.response?.generation_meta?.contract_version || QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
        output_language: resolvedLanguage.label,
        output_language_code: resolvedLanguage.id,
      },
      material_profile: {
        id: Number(materialProfile.id),
        source_language: materialProfile.source_language,
        source_excerpt: materialProfile.source_excerpt,
        teaching_brief: materialProfile.teaching_brief,
        key_points: materialProfile.key_points,
        topic_fingerprint: materialProfile.topic_fingerprint,
      },
    };
  }

  let lastFailureSummary = '';
  let normalizedQuestions: any[] = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rawText = await resolved.provider.generateJson({
        modelId: resolved.model.id,
        prompt: buildQuestionGenerationSkillPrompt({
          count: request.count,
          difficulty: request.difficulty,
          language: resolvedLanguage.label,
          questionFormat: request.questionFormat || 'Multiple Choice',
          cognitiveLevel: request.cognitiveLevel || 'Mixed',
          explanationDetail: request.explanationDetail || 'Concise',
          contentFocus: request.contentFocus || 'Balanced',
          distractorStyle: request.distractorStyle || 'Standard',
          gradeLevel: request.gradeLevel || 'Auto',
          material: generationSource.material,
          sourceLanguage: materialProfile.source_language,
          topicFingerprint: materialProfile.topic_fingerprint || [],
          keyPoints: materialProfile.key_points || [],
          supportingExcerpts: materialProfile.supporting_excerpts || [],
          retryFeedback: lastFailureSummary,
        }),
      });

      const parsed = parseGeneratedPayload(rawText);
      normalizedQuestions = enforceGeneratedQuestionPreferences(
        normalizeGeneratedQuestions(parsed?.questions || [], materialProfile.topic_fingerprint || []),
        request,
        materialProfile,
      );

      const validation = validateQuestionGenerationOutput({
        questions: normalizedQuestions,
        count: request.count,
        language: resolvedLanguage.label,
        questionFormat: request.questionFormat || 'Multiple Choice',
      });

      if (validation.ok) {
        const payload = {
          questions: normalizedQuestions,
          generation_meta: {
            cached: false,
            source_mode: generationSource.source_mode,
            estimated_original_tokens: generationSource.estimated_original_tokens,
            estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
            token_savings_pct: generationSource.token_savings_pct,
            provider: resolved.provider.catalog.id,
            provider_label: resolved.provider.catalog.label,
            model: resolved.model.id,
            model_label: resolved.model.label,
            contract_version: QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
            output_language: resolvedLanguage.label,
            output_language_code: resolvedLanguage.id,
            attempts: attempt,
            language_validated: true,
          },
          material_profile: {
            id: Number(materialProfile.id),
            source_language: materialProfile.source_language,
            source_excerpt: materialProfile.source_excerpt,
            teaching_brief: materialProfile.teaching_brief,
            key_points: materialProfile.key_points,
            topic_fingerprint: materialProfile.topic_fingerprint,
          },
        };

        (await saveCachedQuestionGeneration(
              Number(materialProfile.id),
              Number(request.count),
              String(request.difficulty),
              resolvedLanguage.label,
              payload,
              resolved.provider.catalog.id,
              cacheModelKey,
            ));

        return payload;
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
    `AI generation failed to satisfy the ${resolvedLanguage.label} language contract after multiple attempts. ${lastFailureSummary}`.trim(),
  );
}

export async function improveQuestionsFromSource(
  request: QuestionGenerationRequest & { existingQuestions: any[] },
) {
  const count = Math.max(1, Math.min(Number(request.count || request.existingQuestions.length || 5), 20));
  const materialProfile = (await getOrCreateMaterialProfile(request.sourceText));
  const generationSource = (await buildGenerationSource(materialProfile));
  const resolved = resolveModelSelection(request.providerId, request.modelId);
  const resolvedLanguage = resolveQuestionGenerationLanguage(request.language);

  const existingQuestionsBlock = (Array.isArray(request.existingQuestions) ? request.existingQuestions : [])
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

  const rawText = await resolved.provider.generateJson({
    modelId: resolved.model.id,
    prompt: [
      buildQuestionGenerationSkillPrompt({
        count,
        difficulty: request.difficulty,
        language: resolvedLanguage.label,
        questionFormat: request.questionFormat || 'Multiple Choice',
        cognitiveLevel: request.cognitiveLevel || 'Mixed',
        explanationDetail: request.explanationDetail || 'Concise',
        contentFocus: request.contentFocus || 'Balanced',
        distractorStyle: request.distractorStyle || 'Standard',
        gradeLevel: request.gradeLevel || 'Auto',
        material: generationSource.material,
        sourceLanguage: materialProfile.source_language,
        topicFingerprint: materialProfile.topic_fingerprint || [],
        keyPoints: materialProfile.key_points || [],
        supportingExcerpts: materialProfile.supporting_excerpts || [],
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

  const parsed = parseGeneratedPayload(rawText);
  const normalizedQuestions = enforceGeneratedQuestionPreferences(
    normalizeGeneratedQuestions(parsed?.questions || [], materialProfile.topic_fingerprint || []),
    request,
    materialProfile,
  );

  const validation = validateQuestionGenerationOutput({
    questions: normalizedQuestions,
    count,
    language: resolvedLanguage.label,
    questionFormat: request.questionFormat || 'Multiple Choice',
  });

  if (!validation.ok) {
    throw new Error(validation.summary || 'Improved questions did not satisfy the required contract.');
  }

  return {
    questions: normalizedQuestions,
    generation_meta: {
      cached: false,
      source_mode: generationSource.source_mode,
      estimated_original_tokens: generationSource.estimated_original_tokens,
      estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
      token_savings_pct: generationSource.token_savings_pct,
      provider: resolved.provider.catalog.id,
      provider_label: resolved.provider.catalog.label,
      model: resolved.model.id,
      model_label: resolved.model.label,
      contract_version: QUIZZI_QUESTION_GENERATION_SKILL_VERSION,
      output_language: resolvedLanguage.label,
      output_language_code: resolvedLanguage.id,
      improvement_mode: true,
    },
    material_profile: {
      id: Number(materialProfile.id),
      source_language: materialProfile.source_language,
      source_excerpt: materialProfile.source_excerpt,
      teaching_brief: materialProfile.teaching_brief,
      key_points: materialProfile.key_points,
      topic_fingerprint: materialProfile.topic_fingerprint,
    },
  };
}
