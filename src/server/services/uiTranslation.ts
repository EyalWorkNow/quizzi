type SupportedLanguage = 'en' | 'he';

const TRANSLATION_SEPARATOR = '[[QZ_SEP_42]]';
const translationCache = new Map<string, string>();

function buildCacheKey(language: SupportedLanguage, text: string) {
  return `${language}::${text}`;
}

async function requestTranslation(texts: string[], targetLanguage: SupportedLanguage) {
  const joined = texts.join(TRANSLATION_SEPARATOR);
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', targetLanguage);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', joined);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'quizzi-ui-translation/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Translation provider returned ${response.status}`);
  }

  const payload = await response.json();
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part: any) => String(part?.[0] || '')).join('')
    : joined;
  const parts = translated.split(TRANSLATION_SEPARATOR);
  return parts.length === texts.length ? parts : texts;
}

export async function translateUiTexts(texts: string[], targetLanguage: SupportedLanguage) {
  const cleaned = texts.map((text) => String(text || '').trim());
  const results = [...cleaned];
  const missingIndexes: number[] = [];
  const missingTexts: string[] = [];

  cleaned.forEach((text, index) => {
    if (!text) return;
    const cached = translationCache.get(buildCacheKey(targetLanguage, text));
    if (cached) {
      results[index] = cached;
      return;
    }
    missingIndexes.push(index);
    missingTexts.push(text);
  });

  if (missingTexts.length > 0) {
    const translatedMissing = await requestTranslation(missingTexts, targetLanguage);
    translatedMissing.forEach((translated, offset) => {
      const index = missingIndexes[offset];
      const source = missingTexts[offset];
      const resolved = String(translated || source);
      translationCache.set(buildCacheKey(targetLanguage, source), resolved);
      results[index] = resolved;
    });
  }

  return results;
}

