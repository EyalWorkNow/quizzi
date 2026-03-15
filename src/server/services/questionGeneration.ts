import {
  buildGenerationSource,
  getCachedQuestionGeneration,
  getOrCreateMaterialProfile,
  normalizeGeneratedQuestions,
  saveCachedQuestionGeneration,
} from './materialIntel.js';
import { resolveModelSelection } from './modelProviders.js';

type QuestionGenerationRequest = {
  sourceText: string;
  count: number;
  difficulty: string;
  language: string;
  providerId?: string | null;
  modelId?: string | null;
};

function buildQuestionGenerationPrompt({
  count,
  difficulty,
  language,
  material,
}: {
  count: number;
  difficulty: string;
  language: string;
  material: string;
}) {
  const isHebrew = language.toLowerCase() === 'hebrew';
  const langInstruction = isHebrew
    ? 'CRITICAL: ALL output text (prompt, answers, explanation, tags, learning_objective) MUST be in HEBREW (עברית).'
    : 'The output MUST be in English.';

  return `Task: Generate exactly ${count} multiple-choice questions from the provided educational material.
Difficulty Level: ${difficulty}
Output Language: ${language}
${langInstruction}

Constraint: Return ONLY a raw JSON object matching the schema below. No markdown formatting, no preamble.
Use the compact course brief and supporting excerpts below as the authoritative source. Prefer high-signal concepts, chronology, causal links, definitions, and tricky confusions from the material.
Every question must include exactly 4 answer choices with 1 correct answer and 3 plausible distractors.

Schema:
{
  "questions": [
    {
      "prompt": "The question text",
      "answers": ["Choice A", "Choice B", "Choice C", "Choice D"],
      "correct_index": 0,
      "explanation": "Why the answer is correct",
      "tags": ["topic"],
      "time_limit_seconds": 20,
      "learning_objective": "Optional short learning outcome",
      "bloom_level": "Remember | Understand | Apply | Analyze | Evaluate | Create"
    }
  ]
}

Educational Material:
${material}`;
}

function parseGeneratedPayload(rawText: string) {
  const cleanJson = String(rawText || '')
    .replace(/```json\s*|\s*```/g, '')
    .trim();

  return JSON.parse(cleanJson || '{}');
}

export async function generateQuestionsFromSource(request: QuestionGenerationRequest) {
  const materialProfile = getOrCreateMaterialProfile(request.sourceText);
  const generationSource = buildGenerationSource(materialProfile);
  const resolved = resolveModelSelection(request.providerId, request.modelId);

  const cached = getCachedQuestionGeneration(
    Number(materialProfile.id),
    Number(request.count),
    String(request.difficulty),
    String(request.language),
    resolved.provider.id,
    resolved.model.id,
  );

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
        provider: resolved.provider.id,
        provider_label: resolved.provider.label,
        model: resolved.model.id,
        model_label: resolved.model.label,
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

  const rawText = await resolved.provider.generateJson({
    modelId: resolved.model.id,
    prompt: buildQuestionGenerationPrompt({
      count: request.count,
      difficulty: request.difficulty,
      language: request.language,
      material: generationSource.material,
    }),
  });

  const parsed = parseGeneratedPayload(rawText);
  const normalizedQuestions = normalizeGeneratedQuestions(
    parsed?.questions || [],
    materialProfile.topic_fingerprint || [],
  );

  const payload = {
    questions: normalizedQuestions,
    generation_meta: {
      cached: false,
      source_mode: generationSource.source_mode,
      estimated_original_tokens: generationSource.estimated_original_tokens,
      estimated_prompt_tokens: generationSource.estimated_prompt_tokens,
      token_savings_pct: generationSource.token_savings_pct,
      provider: resolved.provider.id,
      provider_label: resolved.provider.label,
      model: resolved.model.id,
      model_label: resolved.model.label,
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

  saveCachedQuestionGeneration(
    Number(materialProfile.id),
    Number(request.count),
    String(request.difficulty),
    String(request.language),
    payload,
    resolved.provider.id,
    resolved.model.id,
  );

  return payload;
}
