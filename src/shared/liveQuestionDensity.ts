export type LiveQuestionDensity = {
  answerCount: number;
  maxAnswerLength: number;
  promptLength: number;
  density: 'comfortable' | 'dense' | 'ultra';
  isDense: boolean;
  isUltraDense: boolean;
  preferredColumns: 1 | 2 | 3;
  prefersCompactMeta: boolean;
};

type Input = {
  prompt?: string | null;
  explanation?: string | null;
  answers?: Array<string | null | undefined> | null;
  hasImage?: boolean;
};

export function getLiveQuestionDensity({
  prompt,
  explanation,
  answers,
  hasImage = false,
}: Input): LiveQuestionDensity {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedExplanation = String(explanation || '').trim();
  const normalizedAnswers = Array.isArray(answers)
    ? answers.map((answer) => String(answer || '').trim()).filter(Boolean)
    : [];

  const answerCount = normalizedAnswers.length;
  const promptLength = normalizedPrompt.length;
  const explanationLength = normalizedExplanation.length;
  const maxAnswerLength = normalizedAnswers.reduce((longest, answer) => Math.max(longest, answer.length), 0);

  const answerCountPressure = answerCount >= 6 ? 3 : answerCount >= 5 ? 2 : answerCount >= 4 ? 1 : 0;
  const answerLengthPressure = maxAnswerLength >= 40 ? 3 : maxAnswerLength >= 25 ? 2 : maxAnswerLength >= 15 ? 1 : 0;
  const promptPressure = promptLength >= 150 ? 2 : promptLength >= 95 ? 1 : 0;
  const explanationPressure = explanationLength >= 200 ? 3 : explanationLength >= 100 ? 1 : 0;
  const imagePressure = hasImage ? 1 : 0;
  
  const densityScore = answerCountPressure + answerLengthPressure + promptPressure + explanationPressure + imagePressure;

  const density =
    densityScore >= 6 || answerCount >= 7 || (answerCount >= 5 && maxAnswerLength >= 20) || explanationLength > 150
      ? 'ultra'
      : densityScore >= 3
        ? 'dense'
        : 'comfortable';

  const preferredColumns: 1 | 2 | 3 =
    answerCount >= 5 || answerCount === 3
      ? 3
      : answerCount >= 2
        ? 2
        : 1;

  return {
    answerCount,
    maxAnswerLength,
    promptLength,
    density,
    isDense: density !== 'comfortable',
    isUltraDense: density === 'ultra',
    preferredColumns,
    prefersCompactMeta: density !== 'comfortable' || answerCount >= 5,
  };
}
export function formatAnswerSlotLabel(index: number) {
  return String.fromCharCode(65 + (index % 26));
}
