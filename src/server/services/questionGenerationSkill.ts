type SupportedQuestionOutputLanguage = 'en' | 'he';

type ResolvedQuestionGenerationLanguage = {
  id: SupportedQuestionOutputLanguage;
  label: string;
  nativeLabel: string;
  direction: 'ltr' | 'rtl';
  skillName: string;
  bloomLevels: string[];
  trueFalseAnswers: [string, string];
  contract: string[];
};

type QuestionGenerationSkillPromptInput = {
  count: number;
  difficulty: string;
  language: string;
  questionFormat: string;
  cognitiveLevel: string;
  explanationDetail: string;
  material: string;
  retryFeedback?: string;
};

type QuestionGenerationValidationInput = {
  questions: any[];
  count: number;
  language: string;
  questionFormat: string;
};

export type QuestionGenerationValidationResult = {
  ok: boolean;
  issues: string[];
  summary: string;
};

export const QUIZZI_QUESTION_GENERATION_SKILL_VERSION = 'quizzi-packsmith-v1';

const HEBREW_CHARACTERS = /[\u0590-\u05FF]/;
const LATIN_WORDS = /[A-Za-z]{2,}/g;
const COMMON_ALLOWED_LATIN_TOKENS = new Set([
  'AI',
  'API',
  'DNA',
  'RNA',
  'ATP',
  'PH',
  'URL',
  'HTML',
  'CSS',
  'SQL',
  'CPU',
  'RAM',
  'USB',
  'HTTP',
  'HTTPS',
  'PDF',
  'SMS',
  'TV',
  'IQ',
]);

const LANGUAGE_SKILLS: Record<SupportedQuestionOutputLanguage, ResolvedQuestionGenerationLanguage> = {
  en: {
    id: 'en',
    label: 'English',
    nativeLabel: 'English',
    direction: 'ltr',
    skillName: 'Quizzi English Packsmith',
    bloomLevels: ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'],
    trueFalseAnswers: ['True', 'False'],
    contract: [
      'Write every learner-visible field in fluent English.',
      'Do not switch to Hebrew.',
      'Use clean classroom phrasing and concise distractors.',
      'If you mention a non-English proper noun, keep the rest of the field in English.',
    ],
  },
  he: {
    id: 'he',
    label: 'Hebrew',
    nativeLabel: 'עברית',
    direction: 'rtl',
    skillName: 'Quizzi Hebrew Packsmith',
    bloomLevels: ['זוכרים', 'מבינים', 'מיישמים', 'מנתחים', 'מעריכים', 'יוצרים'],
    trueFalseAnswers: ['נכון', 'לא נכון'],
    contract: [
      'Write every learner-visible field in natural modern Hebrew.',
      'Do not answer in English unless a short acronym or canonical proper noun is unavoidable.',
      'Do not transliterate Hebrew into Latin letters.',
      'Translate source concepts into classroom Hebrew whenever possible.',
      'Tags, explanations, learning objectives, and Bloom labels must also be in Hebrew.',
    ],
  },
};

function normalizeTextToken(value: string) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedLatinToken(word: string) {
  const lettersOnly = String(word || '').replace(/[^A-Za-z]/g, '');
  if (!lettersOnly) return true;
  if (COMMON_ALLOWED_LATIN_TOKENS.has(lettersOnly.toUpperCase())) return true;
  if (/^[A-Z0-9]+$/.test(String(word || '')) && lettersOnly.length <= 8) return true;
  return lettersOnly.length <= 3;
}

function looksNonHebrew(text: string) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (HEBREW_CHARACTERS.test(value)) {
    const latinTokens = value.match(LATIN_WORDS) || [];
    return latinTokens.some((token) => !isAllowedLatinToken(token));
  }

  const latinTokens = value.match(LATIN_WORDS) || [];
  if (!latinTokens.length) return false;
  return latinTokens.some((token) => !isAllowedLatinToken(token));
}

function looksNonEnglish(text: string) {
  const value = String(text || '').trim();
  if (!value) return false;
  return HEBREW_CHARACTERS.test(value);
}

function buildQuestionFormatInstruction(questionFormat: string, languageSkill: ResolvedQuestionGenerationLanguage) {
  const normalizedFormat = normalizeTextToken(questionFormat);
  if (normalizedFormat === 'true/false') {
    return [
      'Generate only true/false questions.',
      `Every "answers" array must contain exactly two entries: "${languageSkill.trueFalseAnswers[0]}" and "${languageSkill.trueFalseAnswers[1]}".`,
    ].join(' ');
  }

  if (normalizedFormat === 'mixed') {
    return [
      'Generate a balanced mix of standard multiple-choice items and true/false items.',
      'A multiple-choice item must contain exactly 4 answer choices.',
      `A true/false item must contain exactly 2 answer choices: "${languageSkill.trueFalseAnswers[0]}" and "${languageSkill.trueFalseAnswers[1]}".`,
    ].join(' ');
  }

  return 'Generate standard multiple-choice questions only. Every "answers" array must contain exactly 4 answer choices.';
}

function buildCognitiveInstruction(cognitiveLevel: string) {
  const normalizedLevel = normalizeTextToken(cognitiveLevel);
  if (normalizedLevel === 'higher order') {
    return 'Prioritize analysis, evaluation, comparison, interpretation, and transfer over recall-only facts.';
  }
  if (normalizedLevel === 'foundational') {
    return 'Prioritize definitions, sequences, classifications, and anchor concepts before advanced inference.';
  }
  return 'Blend recall, understanding, and application so the set feels varied but still faithful to the source material.';
}

function buildExplanationInstruction(explanationDetail: string) {
  const normalizedDetail = normalizeTextToken(explanationDetail);
  if (normalizedDetail === 'detailed') {
    return 'Each explanation should be 2-3 sentences, specific, and directly justify why the correct option is right and the others are not.';
  }
  if (normalizedDetail === 'minimal') {
    return 'Each explanation should be one short sentence with only the essential reason.';
  }
  return 'Each explanation should be concise, concrete, and easy for a student to understand quickly.';
}

function buildRetryInstruction(retryFeedback?: string) {
  const normalizedFeedback = String(retryFeedback || '').trim();
  if (!normalizedFeedback) return '';
  return `Retry correction from the previous attempt:
${normalizedFeedback}
Fix every listed issue before responding.`;
}

function buildBloomInstruction(languageSkill: ResolvedQuestionGenerationLanguage) {
  return `If you include "bloom_level", it must be exactly one of: ${languageSkill.bloomLevels.join(' | ')}.`;
}

export function resolveQuestionGenerationLanguage(language: string) {
  const normalized = normalizeTextToken(language);
  if (normalized === 'he' || normalized === 'hebrew' || normalized === 'עברית') {
    return LANGUAGE_SKILLS.he;
  }
  return LANGUAGE_SKILLS.en;
}

export function buildQuestionGenerationSkillPrompt(input: QuestionGenerationSkillPromptInput) {
  const languageSkill = resolveQuestionGenerationLanguage(input.language);

  return `You are ${languageSkill.skillName}, a specialized generation skill for Quizzi classroom quiz packs.
Skill Version: ${QUIZZI_QUESTION_GENERATION_SKILL_VERSION}

Mission:
- Generate exactly ${input.count} questions from the provided educational material.
- Return ONLY one raw JSON object.
- Do not include markdown fences, commentary, or extra keys.

Generation Settings:
- Difficulty: ${input.difficulty}
- Output language: ${languageSkill.label} (${languageSkill.nativeLabel})
- Question format: ${input.questionFormat}
- Cognitive depth: ${input.cognitiveLevel}
- Explanation style: ${input.explanationDetail}

Language Contract:
${languageSkill.contract.map((rule) => `- ${rule}`).join('\n')}

Question Rules:
- The set must contain exactly ${input.count} questions after validation.
- Keep each question anchored to the provided source material.
- Use plausible distractors instead of joke answers.
- Avoid duplicated questions, duplicated explanations, and repeated distractor patterns.
- ${buildQuestionFormatInstruction(input.questionFormat, languageSkill)}
- ${buildCognitiveInstruction(input.cognitiveLevel)}
- ${buildExplanationInstruction(input.explanationDetail)}
- ${buildBloomInstruction(languageSkill)}

Schema:
{
  "questions": [
    {
      "prompt": "Question text",
      "answers": ["Choice A", "Choice B", "Choice C", "Choice D"],
      "correct_index": 0,
      "explanation": "Why the answer is correct",
      "tags": ["topic"],
      "time_limit_seconds": 20,
      "learning_objective": "Optional short learning outcome",
      "bloom_level": "${languageSkill.bloomLevels[1]}"
    }
  ]
}

${buildRetryInstruction(input.retryFeedback)}

Educational Material:
${input.material}`;
}

export function validateQuestionGenerationOutput({
  questions,
  count,
  language,
  questionFormat,
}: QuestionGenerationValidationInput): QuestionGenerationValidationResult {
  const issues: string[] = [];
  const languageSkill = resolveQuestionGenerationLanguage(language);
  const normalizedFormat = normalizeTextToken(questionFormat);
  const normalizedQuestions = Array.isArray(questions) ? questions : [];

  if (normalizedQuestions.length !== count) {
    issues.push(`Expected exactly ${count} valid questions but received ${normalizedQuestions.length}.`);
  }

  normalizedQuestions.forEach((question, index) => {
    const questionLabel = `Q${index + 1}`;
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    const visibleFields: Array<[string, string]> = [
      [`${questionLabel}.prompt`, String(question?.prompt || '')],
      [`${questionLabel}.explanation`, String(question?.explanation || '')],
      [`${questionLabel}.learning_objective`, String(question?.learning_objective || '')],
      [`${questionLabel}.bloom_level`, String(question?.bloom_level || '')],
      ...answers.map((answer: any, answerIndex: number) => [`${questionLabel}.answers[${answerIndex}]`, String(answer || '')]),
      ...(Array.isArray(question?.tags) ? question.tags : []).map((tag: any, tagIndex: number) => [`${questionLabel}.tags[${tagIndex}]`, String(tag || '')]),
    ];

    for (const [fieldPath, fieldValue] of visibleFields) {
      const value = String(fieldValue || '').trim();
      if (!value) continue;

      if (languageSkill.id === 'he' && looksNonHebrew(value)) {
        issues.push(`${fieldPath} is not fully in Hebrew: "${value.slice(0, 80)}"`);
      }

      if (languageSkill.id === 'en' && looksNonEnglish(value)) {
        issues.push(`${fieldPath} contains Hebrew text while English was requested: "${value.slice(0, 80)}"`);
      }
    }

    if (normalizedFormat === 'multiple choice' && answers.length !== 4) {
      issues.push(`${questionLabel} must contain exactly 4 answer choices for Multiple Choice mode.`);
    }

    if (normalizedFormat === 'true/false' && answers.length !== 2) {
      issues.push(`${questionLabel} must contain exactly 2 answer choices for True/False mode.`);
    }

    if (normalizedFormat === 'mixed' && ![2, 4].includes(answers.length)) {
      issues.push(`${questionLabel} must contain either 2 or 4 answer choices for Mixed mode.`);
    }

    if (typeof question?.correct_index !== 'number' || question.correct_index < 0 || question.correct_index >= answers.length) {
      issues.push(`${questionLabel} has an invalid correct_index.`);
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    summary: issues.slice(0, 8).join('\n'),
  };
}
