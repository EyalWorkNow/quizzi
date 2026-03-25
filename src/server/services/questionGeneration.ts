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
  providerId?: string | null;
  modelId?: string | null;
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
    count: Number(request.count || 0),
  });

  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
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
          material: generationSource.material,
          retryFeedback: lastFailureSummary,
        }),
      });

      const parsed = parseGeneratedPayload(rawText);
      normalizedQuestions = normalizeGeneratedQuestions(
        parsed?.questions || [],
        materialProfile.topic_fingerprint || [],
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
