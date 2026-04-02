import { timingSafeEqual } from 'crypto';
import type { AiModelSelection } from '../../shared/integrations.js';
import {
  DEFAULT_STUDENT_ASSISTANCE_POLICY,
  STUDENT_ASSISTANCE_ACTIONS,
  getStudentAssistanceCapabilities,
  hasStudentAssistancePolicyOverrides,
  mergeStudentAssistancePolicy,
  normalizeStudentAssistancePolicy,
  type StudentAssistanceAction,
  type StudentAssistanceCapabilities,
  type StudentAssistanceCard,
  type StudentAssistancePolicy,
  type StudentAssistancePolicyInput,
  type StudentAssistanceResult,
} from '../../shared/studentAssistance.js';
import { buildScopedHmac } from './authSecrets.js';
import { generateJsonWithModelSelection } from './modelProviders.js';

const SUPPORT_TOKEN_SCOPE = 'student-practice-support-token';
const SUPPORT_TOKEN_TTL_MS = 1000 * 60 * 90;

const ACTION_LIMITS: Record<
  StudentAssistanceAction,
  { titleMax: number; bodyMax: number; bulletMax: number; bulletCount: number; reflectionMax: number }
> = {
  reframe_question: { titleMax: 56, bodyMax: 320, bulletMax: 100, bulletCount: 3, reflectionMax: 140 },
  extract_keywords: { titleMax: 56, bodyMax: 220, bulletMax: 90, bulletCount: 4, reflectionMax: 120 },
  build_checklist: { titleMax: 56, bodyMax: 220, bulletMax: 90, bulletCount: 4, reflectionMax: 120 },
  socratic_hint: { titleMax: 56, bodyMax: 260, bulletMax: 90, bulletCount: 3, reflectionMax: 120 },
  confidence_check: { titleMax: 56, bodyMax: 220, bulletMax: 90, bulletCount: 3, reflectionMax: 120 },
  time_nudge: { titleMax: 56, bodyMax: 220, bulletMax: 90, bulletCount: 3, reflectionMax: 120 },
  post_answer_wrap: { titleMax: 56, bodyMax: 340, bulletMax: 100, bulletCount: 3, reflectionMax: 140 },
};

const ACTION_TITLES: Record<'en' | 'he' | 'ar', Record<StudentAssistanceAction, string>> = {
  en: {
    reframe_question: 'A clearer read',
    extract_keywords: 'What matters here',
    build_checklist: 'Check before you answer',
    socratic_hint: 'Think one step deeper',
    confidence_check: 'Pressure-test your choice',
    time_nudge: 'Reset the pace',
    post_answer_wrap: 'Carry this forward',
  },
  he: {
    reframe_question: 'ניסוח פשוט יותר',
    extract_keywords: 'המילים החשובות כאן',
    build_checklist: 'מה לבדוק לפני תשובה',
    socratic_hint: 'רמז לחשיבה',
    confidence_check: 'בדיקת ביטחון',
    time_nudge: 'איפוס קצב',
    post_answer_wrap: 'מה לקחת הלאה',
  },
  ar: {
    reframe_question: 'صياغة أبسط',
    extract_keywords: 'الكلمات المهمة هنا',
    build_checklist: 'ما الذي أفحصه قبل الإجابة',
    socratic_hint: 'تلميح للتفكير',
    confidence_check: 'فحص الثقة',
    time_nudge: 'إعادة ضبط الوتيرة',
    post_answer_wrap: 'ما الذي أحمله معي',
  },
};

export type StudentAssistanceSupportSession = {
  student_user_id: number;
  question_id: number;
  class_id: number | null;
  assignment_id: number | null;
  pack_id: number | null;
  issued_at: string;
  expires_at: string;
};

function safeLine(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeBullets(value: unknown, maxLength: number, maxCount: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => safeLine(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxCount);
}

function safeLower(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUiLanguage(value: unknown): 'en' | 'he' | 'ar' {
  const normalized = safeLower(value);
  return normalized === 'he' || normalized === 'ar' ? normalized : 'en';
}

function supportsUiScript(value: unknown, uiLanguage: 'en' | 'he' | 'ar') {
  const text = safeLine(value, 120);
  if (!text) return false;
  if (uiLanguage === 'he') return /[\u0590-\u05FF]/.test(text);
  if (uiLanguage === 'ar') return /[\u0600-\u06FF]/.test(text);
  return true;
}

function getLocalizedActionTitle(action: StudentAssistanceAction, uiLanguage: 'en' | 'he' | 'ar') {
  return ACTION_TITLES[uiLanguage][action] || ACTION_TITLES.en[action];
}

function getLanguageInstruction(uiLanguage: 'en' | 'he' | 'ar') {
  if (uiLanguage === 'he') return 'Respond entirely in Hebrew.';
  if (uiLanguage === 'ar') return 'Respond entirely in Arabic.';
  return 'Respond entirely in English.';
}

function buildSupportTokenSignature(payload: string) {
  return buildScopedHmac(SUPPORT_TOKEN_SCOPE, payload);
}

export function isStudentAssistanceEnabled() {
  const normalized = String(process.env.QUIZZI_AI_GUIDANCE_ENABLED || '').trim().toLowerCase();
  if (!normalized) return true;
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

export function parseStudentAssistancePolicyJson(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object') {
    return normalizeStudentAssistancePolicy(value as StudentAssistancePolicyInput);
  }
  try {
    const parsed = JSON.parse(String(value || ''));
    return normalizeStudentAssistancePolicy(parsed as StudentAssistancePolicyInput);
  } catch {
    return null;
  }
}

export function serializeStudentAssistancePolicy(policy: StudentAssistancePolicyInput) {
  return JSON.stringify(normalizeStudentAssistancePolicy(policy));
}

export function resolveStudentAssistancePolicy(options: {
  classPolicy?: StudentAssistancePolicyInput;
  assignmentPolicy?: StudentAssistancePolicyInput;
  enabledBySystem?: boolean;
}): StudentAssistancePolicy {
  const classPolicy = hasStudentAssistancePolicyOverrides(options.classPolicy)
    ? normalizeStudentAssistancePolicy(options.classPolicy)
    : DEFAULT_STUDENT_ASSISTANCE_POLICY;
  const merged = hasStudentAssistancePolicyOverrides(options.assignmentPolicy)
    ? mergeStudentAssistancePolicy(classPolicy, options.assignmentPolicy)
    : classPolicy;
  if (options.enabledBySystem === false) {
    return {
      ...merged,
      enabled: false,
    };
  }
  return normalizeStudentAssistancePolicy(merged);
}

export function resolveStudentAssistanceCapabilities(options: {
  classPolicy?: StudentAssistancePolicyInput;
  assignmentPolicy?: StudentAssistancePolicyInput;
  enabledBySystem?: boolean;
}): StudentAssistanceCapabilities {
  return getStudentAssistanceCapabilities(resolveStudentAssistancePolicy(options));
}

export function createStudentAssistanceSupportToken(input: {
  studentUserId: number;
  questionId: number;
  classId?: number | null;
  assignmentId?: number | null;
  packId?: number | null;
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SUPPORT_TOKEN_TTL_MS);
  const session: StudentAssistanceSupportSession = {
    student_user_id: Math.max(0, Math.floor(Number(input.studentUserId) || 0)),
    question_id: Math.max(0, Math.floor(Number(input.questionId) || 0)),
    class_id: Math.max(0, Math.floor(Number(input.classId) || 0)) || null,
    assignment_id: Math.max(0, Math.floor(Number(input.assignmentId) || 0)) || null,
    pack_id: Math.max(0, Math.floor(Number(input.packId) || 0)) || null,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  const payload = JSON.stringify(session);
  const signature = buildSupportTokenSignature(payload);
  return {
    session,
    token: `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`,
  };
}

export function readStudentAssistanceSupportToken(token: string) {
  const raw = String(token || '').trim();
  if (!raw || !raw.includes('.')) return null;
  const [encodedPayload, signature] = raw.split('.', 2);
  if (!encodedPayload || !signature) return null;

  let payload = '';
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expectedSignature = buildSupportTokenSignature(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as StudentAssistanceSupportSession;
    const studentUserId = Math.max(0, Math.floor(Number(parsed?.student_user_id || 0)));
    const questionId = Math.max(0, Math.floor(Number(parsed?.question_id || 0)));
    const expiresAt = new Date(String(parsed?.expires_at || ''));
    if (!studentUserId || !questionId || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      student_user_id: studentUserId,
      question_id: questionId,
      class_id: Math.max(0, Math.floor(Number(parsed?.class_id || 0))) || null,
      assignment_id: Math.max(0, Math.floor(Number(parsed?.assignment_id || 0))) || null,
      pack_id: Math.max(0, Math.floor(Number(parsed?.pack_id || 0))) || null,
      issued_at: String(parsed?.issued_at || ''),
      expires_at: expiresAt.toISOString(),
    } satisfies StudentAssistanceSupportSession;
  } catch {
    return null;
  }
}

function getStudentAssistanceSelection(): AiModelSelection {
  return {
    provider_id: (safeLine(
      process.env.QUIZZI_STUDENT_ASSISTANCE_PROVIDER || process.env.QUIZZI_DEFAULT_MODEL_PROVIDER || 'openai',
      24,
    ) || 'openai') as AiModelSelection['provider_id'],
    model_id: safeLine(
      process.env.QUIZZI_STUDENT_ASSISTANCE_MODEL || process.env.QUIZZI_DEFAULT_MODEL_ID || 'MiniMax-M2',
      120,
    ) || 'MiniMax-M2',
  };
}

function buildDeterministicBullets(
  question: {
  tags?: string[];
  learningObjective?: string;
  bloomLevel?: string;
  },
  uiLanguage: 'en' | 'he' | 'ar',
) {
  const learningObjective = safeLine(question.learningObjective, 90);
  const bloomLevel = safeLine(question.bloomLevel, 48);
  const tags = Array.isArray(question.tags) ? question.tags.slice(0, 2).map((tag) => safeLine(tag, 40)).filter(Boolean) : [];

  let bullets: string[] = [];
  if (uiLanguage === 'he') {
    bullets = [
      learningObjective ? `חזור/י למטרה: ${learningObjective}.` : '',
      bloomLevel ? `רמת החשיבה כאן: ${bloomLevel}.` : '',
      ...tags.map((tag) => `שמור/י מול העיניים את המושג "${tag}".`),
    ];
  } else if (uiLanguage === 'ar') {
    bullets = [
      learningObjective ? `ارجع إلى الهدف: ${learningObjective}.` : '',
      bloomLevel ? `مستوى التفكير هنا: ${bloomLevel}.` : '',
      ...tags.map((tag) => `أبقِ مفهوم "${tag}" حاضرًا أمامك.`),
    ];
  } else {
    bullets = [
      learningObjective ? `Anchor yourself on the goal: ${learningObjective}.` : '',
      bloomLevel ? `Match the thinking level: ${bloomLevel}.` : '',
      ...tags.map((tag) => `Keep the concept "${tag}" in view.`),
    ];
  }

  bullets = bullets.filter(Boolean);
  return bullets.slice(0, 3);
}

function buildFallbackCard(input: {
  action: StudentAssistanceAction;
  question: {
    prompt: string;
    tags?: string[];
    learningObjective?: string;
    bloomLevel?: string;
    explanation?: string;
  };
  missionLabel?: string | null;
  weakTags?: string[];
  lastAttempt?: { is_correct?: boolean | null };
  uiLanguage?: 'en' | 'he' | 'ar';
}): StudentAssistanceCard {
  const uiLanguage = normalizeUiLanguage(input.uiLanguage);
  const conceptBullets = buildDeterministicBullets(input.question, uiLanguage);
  const missionLabel = safeLine(input.missionLabel, 80);
  const weakTag = safeLine((Array.isArray(input.weakTags) ? input.weakTags[0] : '') || input.question.tags?.[0] || '', 40);
  const localizedWeakTag = supportsUiScript(weakTag, uiLanguage) ? weakTag : '';
  const localizedExplanation = supportsUiScript(input.question.explanation, uiLanguage)
    ? safeLine(input.question.explanation, 100)
    : '';

  if (uiLanguage === 'he') {
    switch (input.action) {
      case 'reframe_question':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'קודם מבררים מה בדיוק צריך להחליט, להשוות או לזכור, ורק אחר כך מסתכלים על האפשרויות.',
          bullets: conceptBullets.length ? conceptBullets : ['נסח/י במילים שלך מה המשימה של השאלה.'],
          reflection_prompt: 'מה בדיוק השאלה מבקשת ממך לעשות?',
        };
      case 'extract_keywords':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'חפש/י את המילים שמסמנות את המושג, התנאי או הקשר שעליו השאלה יושבת.',
          bullets: conceptBullets.length ? conceptBullets : ['סמן/י שתי מילים שמשנות הכי הרבה את משמעות השאלה.'],
          reflection_prompt: 'איזו מילה כאן משנה הכי הרבה את הכיוון?',
        };
      case 'build_checklist':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'לפני שבוחרים תשובה, בודקים שהבחירה מתאימה לכל חלקי השאלה ולא רק למילה שנשמעת מוכרת.',
          bullets: ['קרא/י שוב את גוף השאלה.', 'בדוק/י שכל תנאי בשאלה נשמר.', 'שאל/י את עצמך מה היה גורם לבחירה שלך ליפול.'],
          reflection_prompt: 'איזה תנאי עוד צריך לבדוק לפני החלטה?',
        };
      case 'socratic_hint':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: localizedWeakTag
            ? `חשוב/י על הכלל או הדפוס שמאחורי "${localizedWeakTag}" לפני הבחירה.`
            : 'חשוב/י על ההגדרה, הסיבה או הכלל המרכזי שהשאלה רומזת אליו.',
          bullets: conceptBullets.slice(0, 2),
          reflection_prompt: 'איזה עיקרון מהחומר עוזר להכריע כאן?',
        };
      case 'confidence_check':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'נסה/י לנמק לעצמך למה הבחירה שלך מתאימה, ואז בדוק/י אם היא עדיין מחזיקה כשקוראים שוב את כל השאלה.',
          bullets: ['אמור/י במשפט אחד למה זו הבחירה שלך.', 'קרא/י שוב את כל הניסוח.', 'שאל/י מה היה מפריך את הבחירה הזאת.'],
          reflection_prompt: 'מה הראיה הכי חזקה שלך כרגע?',
        };
      case 'time_nudge':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: missionLabel ? `זה עדיין צעד קצר בתוך ${missionLabel}. נשימה אחת, פישוט המשימה, ואז התקדמות רגועה.` : 'עוצרים לנשימה אחת, מפשטים את המשימה, וממשיכים בלי להיבהל מהזמן.',
          bullets: ['נשימה אחת.', 'שם/י למושג המרכזי.', 'בחר/י את ההתאמה החזקה ביותר, לא את הראשונה שקופצת.'],
          reflection_prompt: 'מה הצעד הקטן הבא שאת/ה עושה עכשיו?',
        };
      case 'post_answer_wrap':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: input.lastAttempt?.is_correct ? 'שמור/י על מה שעבד כאן כדי שיהיה קל לחזור עליו בשאלה הבאה.' : 'קח/י מההסבר את הכלל המרכזי, כדי לזהות את אותו דפוס מוקדם יותר בפעם הבאה.',
          bullets: [
            localizedExplanation ? `רעיון מפתח: ${localizedExplanation}` : 'נסח/י במשפט קצר את הרעיון המרכזי מההסבר.',
            localizedWeakTag ? `המשך/י לחזק את "${localizedWeakTag}".` : 'שים/י לב איזה מושג חזר כאן וחזק/י אותו שוב.',
          ].filter(Boolean),
          reflection_prompt: 'מה תבדוק/י מוקדם יותר בשאלה הבאה?',
        };
    }
  }

  if (uiLanguage === 'ar') {
    switch (input.action) {
      case 'reframe_question':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'ابدأ بتحديد ما الذي يُطلب منك أن تقرره أو تقارنه أو تتذكره قبل النظر إلى الخيارات.',
          bullets: conceptBullets.length ? conceptBullets : ['أعد صياغة مهمة السؤال بكلماتك.'],
          reflection_prompt: 'ما المهمة الدقيقة التي يطلبها السؤال؟',
        };
      case 'extract_keywords':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'ابحث عن الكلمات التي تشير إلى المفهوم أو الشرط أو العلاقة التي يقوم عليها السؤال.',
          bullets: conceptBullets.length ? conceptBullets : ['حدّد كلمتين تغيّران معنى السؤال أكثر من غيرهما.'],
          reflection_prompt: 'أي كلمة هنا تغيّر الاتجاه أكثر؟',
        };
      case 'build_checklist':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'قبل اختيار الإجابة، تأكد أن اختيارك يطابق كل أجزاء السؤال وليس كلمة مألوفة فقط.',
          bullets: ['أعد قراءة متن السؤال.', 'تحقق من كل شرط.', 'اسأل نفسك ما الذي قد يجعل اختيارك ينهار.'],
          reflection_prompt: 'ما الشرط الذي ما زال يحتاج إلى فحص؟',
        };
      case 'socratic_hint':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: localizedWeakTag
            ? `فكّر في القاعدة أو النمط وراء "${localizedWeakTag}" قبل أن تختار.`
            : 'فكّر في التعريف أو السبب أو القاعدة الأساسية التي يشير إليها السؤال.',
          bullets: conceptBullets.slice(0, 2),
          reflection_prompt: 'أي مبدأ من الدرس يساعدك هنا؟',
        };
      case 'confidence_check':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: 'اشرح لنفسك لماذا يناسب اختيارك السؤال، ثم أعد قراءة الصياغة كلها لترى إن كان ما زال ثابتًا.',
          bullets: ['قل سببك في جملة واحدة.', 'أعد قراءة السؤال كاملًا.', 'اسأل ما الذي قد يُثبت أن اختيارك غير صحيح.'],
          reflection_prompt: 'ما أقوى دليل لديك الآن؟',
        };
      case 'time_nudge':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: missionLabel ? `هذه ما تزال خطوة قصيرة داخل ${missionLabel}. خذ نفسًا واحدًا، بسّط المهمة، ثم تحرّك بهدوء.` : 'خذ نفسًا واحدًا، بسّط المهمة، ثم تابع دون أن يسمح لك الوقت بإرباكك.',
          bullets: ['نفس واحد.', 'سمّ المفهوم الأساسي.', 'اختر الأنسب الأقوى لا الأسرع.'],
          reflection_prompt: 'ما الخطوة الصغيرة التالية الآن؟',
        };
      case 'post_answer_wrap':
        return {
          title: getLocalizedActionTitle(input.action, uiLanguage),
          body: input.lastAttempt?.is_correct ? 'احتفظ بخطوة التفكير التي نجحت هنا لتكررها في السؤال التالي.' : 'خذ من الشرح القاعدة الأساسية حتى تتعرف إلى النمط نفسه أسرع في المرة القادمة.',
          bullets: [
            localizedExplanation ? `فكرة أساسية: ${localizedExplanation}` : 'حوّل الشرح إلى جملة واحدة قصيرة من فهمك.',
            localizedWeakTag ? `استمر في تقوية "${localizedWeakTag}".` : 'لاحظ أي مفهوم ظهر هنا وارجع إليه مرة أخرى.',
          ].filter(Boolean),
          reflection_prompt: 'ما الذي ستفحصه أبكر في السؤال التالي؟',
        };
    }
  }

  switch (input.action) {
    case 'reframe_question':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: 'Focus on what the prompt is asking you to decide, compare, or recall before looking for the most tempting wording.',
        bullets: conceptBullets.length ? conceptBullets : ['Underline the decision the question is asking for.'],
        reflection_prompt: 'What is the exact task here in 5 to 8 words?',
      };
    case 'extract_keywords':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: 'Look for terms that signal the concept, condition, or relationship the question depends on.',
        bullets: conceptBullets.length ? conceptBullets : ['Mark the concept words before choosing an answer.'],
        reflection_prompt: 'Which 2 words in the prompt change the meaning the most?',
      };
    case 'build_checklist':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: 'Before you lock in, make sure your choice matches the full prompt and not just one familiar phrase.',
        bullets: [
          'Check the question stem before the answers.',
          'Test whether your choice fits every condition.',
          'If you are unsure, remove choices that clearly miss the concept.',
        ],
        reflection_prompt: 'Which condition in the prompt still needs checking?',
      };
    case 'socratic_hint':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: weakTag
          ? `Think about the rule or pattern behind "${weakTag}" before you choose.`
          : 'Think about the core rule, cause, or definition that the prompt is pointing toward.',
        bullets: conceptBullets.slice(0, 2),
        reflection_prompt: 'What principle from class would help you decide here?',
      };
    case 'confidence_check':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: 'Try to explain why your answer fits the prompt, then check whether the wording still works if you read the whole question again.',
        bullets: [
          'State your reason in one sentence.',
          'Re-read the full stem once.',
          'Ask what would make your choice fail.',
        ],
        reflection_prompt: 'What is your evidence for this choice?',
      };
    case 'time_nudge':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: missionLabel
          ? `This is still a short step inside ${missionLabel}. Breathe once, simplify the task, and move with intention.`
          : 'Take one breath, simplify the task, and move with intention instead of rushing.',
        bullets: ['Pause for one breath.', 'Name the concept.', 'Pick the strongest fit, not the fastest guess.'],
        reflection_prompt: 'What is the smallest next step you can do right now?',
      };
    case 'post_answer_wrap':
      return {
        title: getLocalizedActionTitle(input.action, uiLanguage),
        body: input.lastAttempt?.is_correct
          ? 'Hold on to the reasoning move that helped here, so it is easier to repeat on the next question.'
          : 'Use the explanation to update the rule in your head, then look for the same pattern the next time it appears.',
        bullets: [
          input.question.explanation
            ? `Key takeaway: ${safeLine(input.question.explanation, 100)}`
            : 'Turn the explanation into one short takeaway sentence.',
          weakTag ? `Keep practicing the "${weakTag}" pattern.` : 'Notice which concept showed up here.',
        ].filter(Boolean),
        reflection_prompt: 'What will you check earlier on the next question?',
      };
  }
}

function buildPrompt(input: {
  action: StudentAssistanceAction;
  question: {
    prompt: string;
    answers: string[];
    tags?: string[];
    learningObjective?: string;
    bloomLevel?: string;
    explanation?: string;
  };
  missionLabel?: string | null;
  className?: string | null;
  assignmentTitle?: string | null;
  weakTags?: string[];
  coachingMessage?: string | null;
  memorySummary?: string | null;
  lastAttempt?: { is_correct?: boolean | null; chosen_index?: number | null };
  uiLanguage?: 'en' | 'he' | 'ar';
}) {
  const actionGuide: Record<StudentAssistanceAction, string> = {
    reframe_question: 'Rewrite the task in simpler words without narrowing to an answer.',
    extract_keywords: 'Highlight the most important words or concepts without pointing to an option.',
    build_checklist: 'Give a short thinking checklist before answering.',
    socratic_hint: 'Give one exam-safe hint that nudges the student toward the right reasoning, never the answer.',
    confidence_check: 'Help the student test their reasoning before submitting.',
    time_nudge: 'Calm the student, simplify the next step, and manage time pressure.',
    post_answer_wrap: 'Give a short wrap-up after the answer that reinforces the learning point without revealing chain-of-thought.',
  };

  return [
    'You are an exam-safe learning assistant inside Quizzi.',
    getLanguageInstruction(normalizeUiLanguage(input.uiLanguage)),
    'Never reveal the correct answer, the answer text, the option letter/index, or eliminate options directly.',
    'Never mention chain-of-thought, hidden reasoning, or internal analysis.',
    'Return valid JSON only with keys: title, body, bullets, reflection_prompt.',
    'Keep the answer short, practical, calm, and student-facing.',
    'The title must be descriptive and plain, never motivational, never gamified, and never generic.',
    'Avoid phrases like "momentum booster", "next win", "streak", "great job", or hype language.',
    `Task: ${actionGuide[input.action]}`,
    input.className ? `Class context: ${safeLine(input.className, 80)}` : '',
    input.assignmentTitle ? `Assignment context: ${safeLine(input.assignmentTitle, 120)}` : '',
    input.missionLabel ? `Mission: ${safeLine(input.missionLabel, 80)}` : '',
    input.weakTags?.length ? `Weak tags: ${input.weakTags.map((tag) => safeLine(tag, 32)).filter(Boolean).join(', ')}` : '',
    input.coachingMessage ? `Coaching tone: ${safeLine(input.coachingMessage, 160)}` : '',
    input.memorySummary ? `Student memory summary: ${safeLine(input.memorySummary, 180)}` : '',
    `Question prompt: ${safeLine(input.question.prompt, 800)}`,
    `Answer choices for context only, do not quote or reference directly: ${input.question.answers.map((answer) => safeLine(answer, 120)).join(' | ')}`,
    input.question.learningObjective ? `Learning objective: ${safeLine(input.question.learningObjective, 160)}` : '',
    input.question.bloomLevel ? `Bloom level: ${safeLine(input.question.bloomLevel, 48)}` : '',
    input.question.tags?.length ? `Question tags: ${input.question.tags.map((tag) => safeLine(tag, 32)).filter(Boolean).join(', ')}` : '',
    input.question.explanation ? `Teacher explanation: ${safeLine(input.question.explanation, 220)}` : '',
    input.lastAttempt?.is_correct === true ? 'Latest result: the student answered correctly.' : '',
    input.lastAttempt?.is_correct === false ? 'Latest result: the student answered incorrectly.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function sanitizeModelCard(action: StudentAssistanceAction, raw: any, uiLanguage: 'en' | 'he' | 'ar'): StudentAssistanceCard | null {
  const limits = ACTION_LIMITS[action];
  const card: StudentAssistanceCard = {
    title: getLocalizedActionTitle(action, uiLanguage),
    body: safeLine(raw?.body, limits.bodyMax),
    bullets: safeBullets(raw?.bullets, limits.bulletMax, limits.bulletCount),
    reflection_prompt: safeLine(raw?.reflection_prompt, limits.reflectionMax),
  };
  if (!card.body) return null;
  if (!card.reflection_prompt) {
    card.reflection_prompt =
      uiLanguage === 'he'
        ? 'מה תבדוק/י עכשיו?'
        : uiLanguage === 'ar'
          ? 'ما الذي ستفحصه الآن؟'
          : 'What will you check next?';
  }
  return card;
}

function containsForbiddenReveal(card: StudentAssistanceCard, question: { answers: string[]; correctIndex: number }) {
  const fullText = [card.title, card.body, card.reflection_prompt, ...card.bullets]
    .join(' ')
    .toLowerCase();
  const correctAnswer = safeLower(question.answers?.[question.correctIndex] || '');
  if (correctAnswer && correctAnswer.length >= 3 && fullText.includes(correctAnswer)) {
    return true;
  }

  if (/(?:correct answer|answer is|pick|choose|go with|option|choice|letter)\s*(?:is|:|=)?\s*[a-h]\b/i.test(fullText)) {
    return true;
  }
  if (/(?:eliminate|rule out|cross out)\s+(?:option|choice)?\s*[a-h]\b/i.test(fullText)) {
    return true;
  }
  if (/(momentum booster|next win|keep that streak|great job|streak warm)/i.test(fullText)) {
    return true;
  }
  return false;
}

export async function generateStudentAssistance(input: {
  action: StudentAssistanceAction;
  question: {
    id: number;
    prompt: string;
    answers: string[];
    correctIndex: number;
    tags?: string[];
    learningObjective?: string;
    bloomLevel?: string;
    explanation?: string;
  };
  missionLabel?: string | null;
  className?: string | null;
  assignmentTitle?: string | null;
  weakTags?: string[];
  coachingMessage?: string | null;
  memorySummary?: string | null;
  lastAttempt?: { is_correct?: boolean | null; chosen_index?: number | null };
  uiLanguage?: 'en' | 'he' | 'ar';
}): Promise<StudentAssistanceResult> {
  const uiLanguage = normalizeUiLanguage(input.uiLanguage);
  const fallbackCard = buildFallbackCard({
    action: input.action,
    question: input.question,
    missionLabel: input.missionLabel,
    weakTags: input.weakTags,
    lastAttempt: input.lastAttempt,
    uiLanguage,
  });
  const fallbackMeta = {
    source: 'fallback' as const,
    fallback_used: true,
    provider: 'deterministic',
    model: 'exam_safe_v1',
  };

  if (!isStudentAssistanceEnabled()) {
    return {
      action: input.action,
      card: fallbackCard,
      meta: fallbackMeta,
    };
  }

  try {
    const selection = getStudentAssistanceSelection();
    const generated = await generateJsonWithModelSelection({
      providerId: selection.provider_id,
      modelId: selection.model_id,
      prompt: buildPrompt({ ...input, uiLanguage }),
    });

    let parsed: any = null;
    try {
      parsed = JSON.parse(String(generated.rawText || '{}'));
    } catch {
      parsed = null;
    }

    const card = sanitizeModelCard(input.action, parsed, uiLanguage);
    if (!card || containsForbiddenReveal(card, input.question)) {
      return {
        action: input.action,
        card: fallbackCard,
        meta: {
          source: 'fallback',
          fallback_used: true,
          provider: generated.provider.id,
          model: generated.model.id,
        },
      };
    }

    return {
      action: input.action,
      card,
      meta: {
        source: 'model',
        fallback_used: false,
        provider: generated.provider.id,
        model: generated.model.id,
      },
    };
  } catch {
    return {
      action: input.action,
      card: fallbackCard,
      meta: fallbackMeta,
    };
  }
}

export function buildStudentAssistanceSummary(labels: any[]) {
  const safeLabels = Array.isArray(labels) ? labels : [];
  const requestRows = safeLabels.filter((label) => safeLower(label?.label_type) === 'ai_assist_request');
  const servedRows = safeLabels.filter((label) => safeLower(label?.label_type) === 'ai_assist_served');
  const fallbackRows = safeLabels.filter((label) => safeLower(label?.label_type) === 'ai_assist_fallback');
  const blockedRows = safeLabels.filter((label) => safeLower(label?.label_type) === 'ai_assist_blocked');
  const focusResetRows = safeLabels.filter((label) => safeLower(label?.label_type) === 'ai_focus_reset_used');

  const byAction = new Map<StudentAssistanceAction, { requests: number; served: number; fallbacks: number }>();
  for (const action of STUDENT_ASSISTANCE_ACTIONS) {
    byAction.set(action, { requests: 0, served: 0, fallbacks: 0 });
  }

  const apply = (rows: any[], key: 'requests' | 'served' | 'fallbacks') => {
    rows.forEach((row) => {
      let metadata: any = {};
      try {
        metadata = typeof row?.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row?.metadata_json || {};
      } catch {
        metadata = {};
      }
      const action = safeLine(metadata?.action, 40) as StudentAssistanceAction;
      if (!byAction.has(action)) return;
      const current = byAction.get(action)!;
      current[key] += 1;
      byAction.set(action, current);
    });
  };

  apply(requestRows, 'requests');
  apply(servedRows, 'served');
  apply(fallbackRows, 'fallbacks');

  return {
    total_requests: requestRows.length,
    total_served: servedRows.length,
    total_fallbacks: fallbackRows.length,
    total_blocked: blockedRows.length,
    focus_reset_used: focusResetRows.length,
    actions: Array.from(byAction.entries())
      .map(([action, counts]) => ({
        action,
        label: ACTION_TITLES.en[action],
        ...counts,
      }))
      .filter((row) => row.requests > 0 || row.served > 0 || row.fallbacks > 0),
  };
}
