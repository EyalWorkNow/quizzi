import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetchJson } from './api.ts';

export type AppLanguage = 'en' | 'he';

const APP_LANGUAGE_KEY = 'quizzi.app.language';
const TEACHER_SETTINGS_KEY = 'quizzi.teacher.settings';
const TRANSLATION_CACHE_PREFIX = 'quizzi.translation.v3.cache';

const HEBREW_CHARACTERS = /[\u0590-\u05FF]/;
const BRAND_EXACT_VALUES = new Set(['Quiz', 'zi', 'Quizzi']);
const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const TRANSLATION_SEPARATOR = '[[QZ_SEP_42]]';

type TranslationRecord = {
  original: string;
  translated?: string;
};

type AppLanguageContextValue = {
  language: AppLanguage;
  direction: 'ltr' | 'rtl';
  setLanguage: (language: AppLanguage) => void;
};

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

const RUNTIME_TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  en: {
    'יצירת חידון': 'Create Quiz',
    'החידונים שלי': 'My Quizzes',
    'גילוי': 'Discover',
    'דוחות': 'Reports',
    'כיתות': 'Classes',
    'הגדרות': 'Settings',
    'מרכז עזרה': 'Help Center',
    'התנתקות': 'Log out',
    'שמור שינויים': 'Save Changes',
    'פרופיל': 'Profile',
    'התראות': 'Notifications',
    'אבטחה': 'Security',
    'מראה': 'Appearance',
    'פרטי הפרופיל אינם מלאים.': 'Profile details are incomplete.',
    'יש למלא את כל שדות האבטחה כדי לעדכן את העדפת הסיסמה.': 'Fill all security fields to update the password preference.',
    'הסיסמה החדשה ושדה האימות אינם תואמים.': 'New password and confirmation do not match.',
    'ההגדרות נשמרו מקומית.': 'Settings saved locally.',
    'פרטי פרופיל': 'Profile Information',
    'החלפת אווטאר': 'Change Avatar',
    'שם פרטי': 'First Name',
    'שם משפחה': 'Last Name',
    'כתובת דוא"ל': 'Email Address',
    'בית ספר / ארגון': 'School / Organization',
    'העדפות התראות': 'Notification Preferences',
    'עדכוני מייל על פיצרים חדשים': 'Email updates on new features',
    'דוחות שבועיים על ביצועי הכיתה': 'Weekly class performance reports',
    'התראות על הצטרפות תלמידים': 'Student join alerts',
    'מיילים שיווקיים וקידומיים': 'Marketing and promotional emails',
    'הגדרות אבטחה': 'Security Settings',
    'בגרסת הדמו הזו ההעדפה נשמרת מקומית. כדי לאכוף שינויי סיסמה צריך לחבר מנגנון הזדהות אמיתי.': 'This demo saves the preference locally. Connect a real auth backend to enforce password changes.',
    'סיסמה נוכחית': 'Current Password',
    'סיסמה חדשה': 'New Password',
    'אימות סיסמה חדשה': 'Confirm New Password',
    'מראה ושפה': 'Appearance',
    'ערכת העיצוב ושפת הממשק נשמרות מקומית עבור סביבת המורה שלך.': 'Theme and interface language are stored locally for your teacher workspace.',
    'ערכת עיצוב': 'Theme',
    'העדפת ערכת העיצוב נשמרת, וניתן לחבר אותה בהמשך למתג גלובלי.': 'Theme preference is stored and can be wired into a global theme switch later.',
    'בהיר': 'Light',
    'כהה': 'Dark',
    'שפת ממשק': 'Interface Language',
    'בחר אם מסך ההגדרות של המורה יוצג באנגלית או בעברית.': 'Choose whether this teacher settings interface is shown in English or Hebrew.',
    'אנגלית': 'English',
    'עברית': 'Hebrew',
    'בודק גישת מורה...': 'Checking teacher access...',
  },
  he: {
    'Are you sure you want to leave the game?': 'האם אתה בטוח שברצונך לצאת מהמשחק?',
    'Are you sure you want to end the game early?': 'האם אתה בטוח שברצונך לסיים את המשחק מוקדם?',
    'Are you sure you want to end practice early?': 'האם אתה בטוח שברצונך לסיים את התרגול מוקדם?',
    'Failed to extract text from file': 'נכשל חילוץ הטקסט מהקובץ',
    'Failed to create adaptive game': 'נכשל יצירת המשחק האדפטיבי',
    'Failed to join': 'ההצטרפות נכשלה',
    'Pick an evidence-backed format fast. Every option still runs on the same 4-answer question model you already generate.': 'בחר פורמט מוכח במהירות. כל אפשרות עדיין פועלת על אותו מודל של שאלות אמריקאיות שאתה כבר מייצר.',
    'Quick picks for this pack': 'המלצות מהירות לחבילה זו',
    'Recommended now': 'מומלץ עכשיו',
    'High evidence': 'בסיס מחקרי חזק',
    'Field-tested': 'נבדק בשטח',
    'Selected format': 'הפורמט הנבחר',
    'Best for': 'הכי מתאים עבור',
    'Why it works': 'למה זה עובד',
    'Team Count': 'כמות קבוצות',
    'Teams': 'קבוצות',
    'Launch Setup': 'הגדרות הפעלה',
    'Evidence-backed': 'מבוסס ראיות',
    'Flexible format': 'פורמט גמיש',
    'Launch Format': 'פורמט הפעלה'
    ,
    'Reports': 'דוחות',
    'Refresh': 'רענון',
    'Recent Sessions': 'סשנים אחרונים',
    'Total Players': 'סך שחקנים',
    'Avg Accuracy': 'דיוק ממוצע',
    'Quizzes Hosted': 'חידונים שהורצו',
    'Avg Stress': 'לחץ ממוצע',
    'Across hosted sessions': 'בכלל הסשנים שהורצו',
    'Across tracked answers': 'על פני כל התשובות שנמדדו',
    'Sessions with activity': 'סשנים עם פעילות',
    'Behavior pressure index': 'מדד עומס התנהגותי',
    'Engine Insight': 'תובנת מנוע',
    'Quiz Name': 'שם החידון',
    'Date': 'תאריך',
    'Players': 'שחקנים',
    'Accuracy': 'דיוק',
    'Stress': 'לחץ',
    'Action': 'פעולה',
    'View': 'לצפייה',
    'Loading live reports...': 'טוען דוחות חיים...',
    'Deterministic performance summaries generated from answers and behavior telemetry.': 'סיכומי ביצועים דטרמיניסטיים המבוססים על תשובות וטלמטריית התנהגות.',
    'Deterministic summaries built from answers, timing, and behavior telemetry across your live sessions.': 'סיכומים דטרמיניסטיים המבוססים על תשובות, תזמון וטלמטריית התנהגות מכל הסשנים החיים שלך.',
    'Each row is derived from stored answers, timings and focus events.': 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    'Each row is derived from stored answers, timings, and focus events.': 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    'No completed sessions yet.': 'עדיין אין סשנים שהושלמו.',
    'Explore': 'גלה',
    'Discover': 'גלה',
    'For Teachers': 'למורים',
    'Contact Us': 'צור קשר',
    'Home': 'בית',
    'Discover High-Signal Packs': 'חבילות איכות לחקר מהיר',
    'Browse Filters': 'מסנני עיון',
    'Sort by': 'מיין לפי',
    'Concept clusters': 'אשכולות מושגים',
    'All concepts': 'כל המושגים',
    'Pack Atlas': 'אטלס החבילות',
    'Pack Intel': 'מודיעין חבילה',
    'Teaching Brief': 'תקציר הוראה',
    'Key points': 'נקודות מפתח',
    'Concept fingerprint': 'טביעת אצבע מושגית',
    'Open In Studio': 'פתח בסטודיו',
    'Open pack intel': 'פתח מודיעין חבילה',
    'Open Pack Intel': 'פתח מודיעין חבילה',
    'Teacher Access': 'כניסת מורה',
    'Create Similar': 'צור דומה',
    'Build New Pack': 'בנה חבילה חדשה',
    'Live Packs': 'חבילות פעילות',
    'Questions': 'שאלות',
    'Avg Token Save': 'חיסכון ממוצע בטוקנים',
    'Languages': 'שפות',
    'Featured Pack': 'חבילה נבחרת',
    'Token Save': 'חיסכון בטוקנים',
    'Words': 'מילים',
    'Language': 'שפה',
    'No packs matched this filter.': 'לא נמצאו חבילות לפי הסינון הזה.',
    'Try another concept, broader search, or reset the filters.': 'נסה מושג אחר, חיפוש רחב יותר, או אפס את המסננים.',
    'Discover is currently unavailable.': 'עמוד הגילוי אינו זמין כרגע.',
    'Newest': 'החדשים ביותר',
    'Most Questions': 'הכי הרבה שאלות',
    'Lean Prompt': 'פרומפט רזה',
    'Student Drill-Down': 'ניתוח עומק לתלמיד',
    'Fallback data loaded': 'נטענו נתוני גיבוי',
    'Loading personal dashboard...': 'טוען לוח אישי...',
    'Student dashboard unavailable': 'לוח התלמיד אינו זמין',
    'Back to Class Analytics': 'חזרה לניתוח הכיתה',
    'Session-Specific Read': 'קריאת סשן ממוקדת',
    'Game Accuracy': 'דיוק במשחק',
    'Confidence': 'ביטחון',
    'Focus': 'ריכוז',
    'Game Vs Overall Baseline': 'המשחק מול קו הבסיס הכללי',
    'Accuracy Delta': 'פער דיוק',
    'Stress Delta': 'פער לחץ',
    'Confidence Delta': 'פער ביטחון',
    'Focus Delta': 'פער ריכוז',
    'Overall': 'כללי',
    'Teacher Recommendation': 'המלצת מורה',
    'Weakest Tags': 'תגיות חלשות',
    'Strongest Tags': 'תגיות חזקות',
    'Teacher Moves': 'מהלכי הוראה',
    'Decision Intelligence': 'אינטליגנציית החלטה',
    'Separate content knowledge from hesitation, revision quality, and last-second dependency.': 'הפרד בין שליטה בחומר לבין היסוס, איכות תיקון ותלות בשנייה האחרונה.',
    '1st Choice': 'בחירה ראשונה',
    'Recovered': 'התאושש',
    'Wrong Revision': 'תיקון מזיק',
    'Commit Latency': 'זמן לנעילה',
    'Deadline Dep.': 'תלות בדדליין',
    'Stability': 'יציבות',
    'Verified Correct': 'נכון מאומת',
    'Stayed Wrong': 'נשאר שגוי',
    'Recovery And Fatigue': 'התאוששות ועייפות',
    'Behavior Architecture': 'ארכיטקטורת התנהגות',
    "How this game's behavior compares to the student's longer-term baseline.": 'כך מתנהגות הבחירות במשחק הזה מול קו הבסיס ארוך-הטווח של התלמיד.',
    'Session Flow': 'זרימת הסשן',
    'Momentum': 'מומנטום',
    'Swaps': 'החלפות',
    'Panic Swaps': 'החלפות בלחץ',
    'Focus Loss': 'איבוד פוקוס',
    'Avg Idle': 'חוסר פעילות ממוצע',
    'Cross-Session Trajectory': 'מסלול בין סשנים',
    'No session history yet': 'עדיין אין היסטוריית סשנים',
    'Adaptive Game Studio': 'סטודיו למשחק אדפטיבי',
    'Strategy': 'אסטרטגיה',
    'Build And Host Now': 'בנה והפעל עכשיו',
    'Question-By-Question Lab': 'מעבדת שאלה-אחר-שאלה',
    'Attention Queue': 'תור תשומת לב',
    'Reteach this concept': 'ללמד מחדש את המושג',
    'Stabilize this concept': 'לייצב את המושג',
    'Pace': 'קצב',
    'Revision': 'תיקון',
    'Commit': 'נעילה',
    'Right': 'נכון',
    'Wrong': 'שגוי',
    'Yes': 'כן',
    'No': 'לא',
    'High': 'גבוה',
    'Normal': 'רגיל',
    'Choice Journey': 'מסלול בחירה',
    'First choice:': 'בחירה ראשונה:',
    'Final choice:': 'בחירה סופית:',
    'Started correct': 'התחיל נכון',
    'Started wrong': 'התחיל שגוי',
    'Verified': 'אומת',
    'No extra intervention signal was generated for this student.': 'לא נוצר כרגע אות התערבות נוסף עבור התלמיד הזה.',
    'No per-question chart data is available yet.': 'עדיין אין נתוני גרף לפי שאלה.',
    'No session history is available yet.': 'עדיין אין היסטוריית סשנים.',
    'No revision-category chart is available for this run.': 'אין עדיין גרף קטגוריות תיקון לסשן הזה.',
    'No question status data is available yet.': 'עדיין אין נתוני סטטוס לשאלות.',
    'No mastery chart is available yet.': 'עדיין אין גרף שליטה זמין.',
    'Volatility': 'תנודתיות',
    'Response': 'זמן תגובה',
    'Highest stress': 'הלחץ הגבוה ביותר',
    'Most volatile': 'התנודתיות הגבוהה ביותר',
    'Slowest response': 'התגובה האיטית ביותר',
    'Score': 'ציון',
    'Stable': 'יציב',
    'Shaky': 'מהוסס',
    'Missed': 'שגוי',
    'of questions': 'מהשאלות',
    'Input mix': 'תמהיל קלט',
    'Commit styles': 'סגנונות נעילה',
    'Pace distribution': 'התפלגות קצב',
    'Commit style distribution': 'התפלגות סגנונות נעילה',
    'Signal Distribution': 'התפלגות אותות',
    'Accuracy bands': 'טווחי דיוק',
    'Stress bands': 'טווחי לחץ',
    'Risk bands': 'טווחי סיכון',
    'Choice distribution': 'התפלגות בחירות',
    'Distractor Heatmap': 'מפת חום למסיחים',
    'Top distractor': 'המסיח המרכזי',
    'Secondary distractor': 'מסיח משני',
    'Correct answer': 'התשובה הנכונה',
    'Back to Reports': 'חזרה לדוחות'
  },
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function readStoredLanguage(): AppLanguage {
  if (!isBrowser()) return 'en';

  const direct = window.localStorage.getItem(APP_LANGUAGE_KEY);
  if (direct === 'he') return 'he';
  if (direct === 'en') return 'en';

  try {
    const raw = window.localStorage.getItem(TEACHER_SETTINGS_KEY);
    if (!raw) return 'en';
    const parsed = JSON.parse(raw) as { appearance?: { language?: string } };
    return parsed?.appearance?.language === 'he' ? 'he' : 'en';
  } catch {
    return 'en';
  }
}

function writeStoredLanguage(language: AppLanguage) {
  if (!isBrowser()) return;
  window.localStorage.setItem(APP_LANGUAGE_KEY, language);

  try {
    const raw = window.localStorage.getItem(TEACHER_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, any>) : {};
    parsed.appearance = {
      ...(parsed.appearance || {}),
      language,
    };
    window.localStorage.setItem(TEACHER_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed local storage state and keep the dedicated app key correct.
  }
}

function loadCache(language: AppLanguage) {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(`${TRANSLATION_CACHE_PREFIX}.${language}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCache(language: AppLanguage, cache: Record<string, string>) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(`${TRANSLATION_CACHE_PREFIX}.${language}`, JSON.stringify(cache));
  } catch {
    // Best effort cache only.
  }
}

function shouldIgnoreValue(value: string, language: AppLanguage) {
  const text = normalizeWhitespace(value);
  if (!text) return true;
  if (BRAND_EXACT_VALUES.has(text)) return true;
  if (/^[\d\s.,:%/()+\-–—#]+$/.test(text)) return true;
  if (/^(EN|HE)$/.test(text)) return true;
  if (/^(https?:\/\/|www\.)/i.test(text)) return true;
  if (language === 'he' && HEBREW_CHARACTERS.test(text)) return true;
  if (language === 'en' && !HEBREW_CHARACTERS.test(text)) return true;
  return false;
}

function chunkTexts(texts: string[]) {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const text of texts) {
    const candidateSize = currentSize + text.length + TRANSLATION_SEPARATOR.length;
    if (current.length > 0 && (candidateSize > 900 || current.length >= 8)) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(text);
    currentSize += text.length + TRANSLATION_SEPARATOR.length;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function translateBatch(texts: string[], language: AppLanguage) {
  if (texts.length === 0) return [];
  const payload = await apiFetchJson<{ translations?: string[] }>('/api/translate', {
    method: 'POST',
    body: JSON.stringify({
      targetLanguage: language,
      texts,
    }),
  });
  return Array.isArray(payload.translations) ? payload.translations : texts;
}

function getTextTag(node: Node | null) {
  return node instanceof Element ? node.tagName : '';
}

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [language, setLanguageState] = useState<AppLanguage>(() => readStoredLanguage());
  const translationCacheRef = useRef<Record<string, string>>(loadCache(readStoredLanguage()));
  const textRecordsRef = useRef(new WeakMap<Text, TranslationRecord>());
  const attributeRecordsRef = useRef(new WeakMap<Element, Map<string, TranslationRecord>>());
  const trackedTextNodesRef = useRef(new Set<Text>());
  const trackedElementsRef = useRef(new Set<Element>());
  const scanScheduledRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);

  const direction = language === 'he' ? 'rtl' : 'ltr';

  const setLanguage = (nextLanguage: AppLanguage) => {
    writeStoredLanguage(nextLanguage);
    translationCacheRef.current = loadCache(nextLanguage);
    setLanguageState(nextLanguage);
  };

  const ensureTextRecord = (node: Text) => {
    const currentValue = node.nodeValue || '';
    const existing = textRecordsRef.current.get(node);
    if (!existing) {
      const record: TranslationRecord = { original: currentValue };
      textRecordsRef.current.set(node, record);
      trackedTextNodesRef.current.add(node);
      return record;
    }

    if (currentValue !== existing.original && currentValue !== existing.translated) {
      existing.original = currentValue;
      existing.translated = undefined;
    }

    return existing;
  };

  const ensureAttributeRecord = (element: Element, attributeName: string) => {
    const currentValue = element.getAttribute(attributeName) || '';
    let records = attributeRecordsRef.current.get(element);
    if (!records) {
      records = new Map();
      attributeRecordsRef.current.set(element, records);
      trackedElementsRef.current.add(element);
    }

    const existing = records.get(attributeName);
    if (!existing) {
      const record: TranslationRecord = { original: currentValue };
      records.set(attributeName, record);
      return record;
    }

    if (currentValue !== existing.original && currentValue !== existing.translated) {
      existing.original = currentValue;
      existing.translated = undefined;
    }

    return existing;
  };

  const scanAndTranslate = async () => {
    scanScheduledRef.current = false;
    if (!isBrowser()) return;

    // Optimization: If switching to English and we're already basically in English,
    // we still need to scan once to revert any translated nodes, but subsequent scans can be lighter.
    // However, the current logic already handles this via records.
    // Let's add a check to see if we really need to scan.
    if (language === 'en' && Object.keys(translationCacheRef.current).length === 0) {
      // If cache is empty and language is English, there's likely nothing to revert.
      // But we should still allow the first scan.
    }

    const pendingTextNodes = new Map<string, Text[]>();
    const pendingAttributes = new Map<string, Array<{ element: Element; attributeName: string }>>();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-no-translate="true"]')) return NodeFilter.FILTER_REJECT;
        const tagName = getTextTag(parent).toUpperCase();
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        const value = node.nodeValue || '';
        return shouldIgnoreValue(value, language) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const record = ensureTextRecord(node);
      const normalized = normalizeWhitespace(record.original);
      if (!normalized) continue;
      if (shouldIgnoreValue(record.original, language)) {
        record.translated = undefined;
        if (node.nodeValue !== record.original) {
          node.nodeValue = record.original;
        }
        continue;
      }
      if (record.translated && node.nodeValue === record.translated) continue;
      if (!pendingTextNodes.has(normalized)) {
        pendingTextNodes.set(normalized, []);
      }
      pendingTextNodes.get(normalized)!.push(node);
    }

    document.body.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label], [alt]').forEach((element) => {
      if (element.closest('[data-no-translate="true"]')) return;
      ATTRIBUTE_NAMES.forEach((attributeName) => {
        if (!element.hasAttribute(attributeName)) return;
        const record = ensureAttributeRecord(element, attributeName);
        const normalized = normalizeWhitespace(record.original);
        if (!normalized) return;
        if (shouldIgnoreValue(record.original, language)) {
          record.translated = undefined;
          if (element.getAttribute(attributeName) !== record.original) {
            element.setAttribute(attributeName, record.original);
          }
          return;
        }
        if (record.translated && element.getAttribute(attributeName) === record.translated) return;
        if (!pendingAttributes.has(normalized)) {
          pendingAttributes.set(normalized, []);
        }
        pendingAttributes.get(normalized)!.push({ element, attributeName });
      });
    });

    const uniqueTexts = Array.from(new Set([...pendingTextNodes.keys(), ...pendingAttributes.keys()]));
    const unresolved = uniqueTexts.filter((text) => !translationCacheRef.current[text] && !RUNTIME_TRANSLATIONS[language][text]);

    for (const batch of chunkTexts(unresolved)) {
      try {
        const translatedBatch = await translateBatch(batch, language);
        batch.forEach((text, index) => {
          translationCacheRef.current[text] = translatedBatch[index] || text;
        });
      } catch {
        // Do not cache the original text on API failure. This prevents "cache poisoning"
        // where temporary network or rate limit issues cause English text to be permanently
        // saved as "Hebrew" translations in local storage.
        console.warn('Translation batch failed. Skipping cache injection to retry later.');
      }
    }

    if (unresolved.length > 0) {
      saveCache(language, translationCacheRef.current);
    }

    pendingTextNodes.forEach((nodes, original) => {
      const translated = RUNTIME_TRANSLATIONS[language][original] || translationCacheRef.current[original] || original;
      nodes.forEach((node) => {
        if (!node.isConnected) return;
        const record = ensureTextRecord(node);
        record.original = record.original || original;
        record.translated = translated;
        if (node.nodeValue !== translated) {
          node.nodeValue = translated;
        }
      });
    });

    pendingAttributes.forEach((entries, original) => {
      const translated = RUNTIME_TRANSLATIONS[language][original] || translationCacheRef.current[original] || original;
      entries.forEach(({ element, attributeName }) => {
        if (!element.isConnected) return;
        const record = ensureAttributeRecord(element, attributeName);
        record.original = record.original || original;
        record.translated = translated;
        if (element.getAttribute(attributeName) !== translated) {
          element.setAttribute(attributeName, translated);
        }
      });
    });
  };

  const scheduleScan = () => {
    if (!isBrowser() || scanScheduledRef.current) return;
    scanScheduledRef.current = true;
    
    // Debounce to prevent multiple scans within a short window
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        void scanAndTranslate();
      });
    }, 40);
  };

  useEffect(() => {
    if (!isBrowser()) return;
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    document.body.dir = direction;
    translationCacheRef.current = loadCache(language);

    observerRef.current?.disconnect();
    observerRef.current = new MutationObserver(() => {
      scheduleScan();
    });
    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTE_NAMES as unknown as string[],
    });

    scheduleScan();

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [direction, language]);

  useEffect(() => {
    scheduleScan();
  }, [language, location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!isBrowser()) return;
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);

    window.alert = (message?: string) => {
      if (typeof message !== 'string' || language === 'en') {
        nativeAlert(message);
        return;
      }
      nativeAlert(RUNTIME_TRANSLATIONS[language][message] || message);
    };

    window.confirm = (message?: string) => {
      if (typeof message !== 'string' || language === 'en') {
        return nativeConfirm(message);
      }
      return nativeConfirm(RUNTIME_TRANSLATIONS[language][message] || message);
    };

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
    };
  }, [language]);

  const value = useMemo<AppLanguageContextValue>(() => ({
    language,
    direction,
    setLanguage,
  }), [direction, language]);

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error('useAppLanguage must be used within AppLanguageProvider');
  }
  return context;
}
