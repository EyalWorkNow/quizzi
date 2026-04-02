import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock3,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
  Lightbulb,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import QuestionImageCard from '../components/QuestionImageCard.tsx';
import { apiFetchJson } from '../lib/api.ts';
import {
  readPreferredAppLanguage,
  resolveAppLanguageDirection,
  useOptionalAppLanguage,
} from '../lib/appLanguage.tsx';
import { formatAnswerSlotLabel } from '../../shared/liveQuestionDensity.ts';
import type { StudentAssistanceAction } from '../../shared/studentAssistance.ts';

const PRACTICE_ANSWER_TONES = [
  {
    bg: '#B488FF',
    text: '#ffffff',
    hover: '#9E70F6',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#6D49C6',
  },
  {
    bg: '#FFD13B',
    text: '#1A1A1A',
    hover: '#FFB703',
    hoverText: '#1A1A1A',
    sweep: '#FF5A36',
    shadow: '#1A1A1A',
    hoverShadow: '#B76F00',
  },
  {
    bg: '#FF8A5B',
    text: '#ffffff',
    hover: '#FF6E45',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#C44120',
  },
  {
    bg: '#FFF8EA',
    text: '#1A1A1A',
    hover: '#B488FF',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#6D49C6',
  },
] as const;

type PracticeStatus = 'LOADING' | 'READY' | 'ACTIVE' | 'FEEDBACK' | 'DONE' | 'ERROR';
type DisplayedAssistanceAction = StudentAssistanceAction | 'focus_reset';

type AssistanceEntry = {
  request_id?: string;
  request_count?: number;
  action: DisplayedAssistanceAction;
  card: {
    title: string;
    body: string;
    bullets?: string[];
    reflection_prompt?: string;
  };
  meta?: {
    fallback_used?: boolean;
    source?: string;
    provider?: string;
    model?: string;
  };
};

type AssistanceWindowCopy = {
  header: string;
  kicker: string;
  summary: string;
  bulletsTitle: string;
  reflectionTitle: string;
  rerunLabel: string;
  usageLabel: string;
};

type AssistanceWindowTheme = {
  shell: string;
  accent: string;
  accentSoft: string;
  iconWrap: string;
  summaryCard: string;
  bulletsCard: string;
  reflectionCard: string;
  rerunButton: string;
};

type PracticeCopy = Record<string, string>;
type PracticeChipTone = 'neutral' | 'warm' | 'cool' | 'violet';
type PracticeInfoChip = {
  key: string;
  label: string;
  tone?: PracticeChipTone;
};

const ACTIVE_ASSISTANCE_ACTIONS: StudentAssistanceAction[] = [
  'reframe_question',
  'extract_keywords',
  'build_checklist',
  'socratic_hint',
  'confidence_check',
  'time_nudge',
];

function buildPracticeAnswerToneStyle(index: number): CSSProperties {
  const tone = PRACTICE_ANSWER_TONES[index % PRACTICE_ANSWER_TONES.length];
  return {
    ['--student-answer-bg' as string]: tone.bg,
    ['--student-answer-text' as string]: tone.text,
    ['--student-answer-hover-bg' as string]: tone.hover,
    ['--student-answer-hover-text' as string]: tone.hoverText,
    ['--student-answer-sweep' as string]: tone.sweep,
    ['--student-answer-shadow' as string]: tone.shadow,
    ['--student-answer-hover-shadow' as string]: tone.hoverShadow,
  };
}

function parseTags(question: any) {
  try {
    if (Array.isArray(question?.tags)) return question.tags;
    const parsed = JSON.parse(question?.tags_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildLocalFocusResetCard(language: string): AssistanceEntry {
  if (language === 'he') {
    return {
      action: 'focus_reset',
      card: {
        title: 'פוקוס מחדש',
        body: 'עוצרים לשתי שניות, נושמים פעם אחת, ומחזירים את תשומת הלב לשאלה עצמה במקום ללחץ של הזמן.',
        bullets: [
          'קרא/י רק את המשימה המרכזית של השאלה.',
          'זהה/י מילה או מושג אחד שמוביל אותך.',
          'בחר/י את הצעד הבא הקטן ביותר במקום לנסות לפתור הכול בבת אחת.',
        ],
        reflection_prompt: 'מה הדבר הקטן הבא שאת/ה בודק/ת עכשיו?',
      },
      meta: {
        source: 'focus_reset',
      },
    };
  }
  if (language === 'ar') {
    return {
      action: 'focus_reset',
      card: {
        title: 'إعادة تركيز',
        body: 'توقف لثانيتين، خذ نفسًا واحدًا، ثم عد إلى السؤال نفسه بدلًا من ضغط الوقت.',
        bullets: [
          'اقرأ المهمة الأساسية فقط.',
          'حدّد كلمة أو مفهومًا يقودك.',
          'اختر الخطوة الصغيرة التالية بدل محاولة حل كل شيء دفعة واحدة.',
        ],
        reflection_prompt: 'ما هي الخطوة الصغيرة التالية الآن؟',
      },
      meta: {
        source: 'focus_reset',
      },
    };
  }
  return {
    action: 'focus_reset',
    card: {
      title: 'Focus reset',
      body: 'Pause for two seconds, take one breath, and come back to the task instead of the pressure.',
      bullets: [
        'Read only the core job of the question.',
        'Name one concept that matters most.',
        'Take the next small step instead of solving everything at once.',
      ],
      reflection_prompt: 'What is the smallest useful next check?',
    },
    meta: {
      source: 'focus_reset',
    },
  };
}

function getPracticeChipClasses(tone: PracticeChipTone = 'neutral') {
  switch (tone) {
    case 'cool':
      return 'bg-[#eef7ff] text-[#2148b8]';
    case 'violet':
      return 'bg-[#f5edff] text-[#6d49c6]';
    case 'warm':
      return 'bg-[#fff6db] text-[#a45112]';
    default:
      return 'bg-white text-brand-dark/75';
  }
}

function PracticeIntroCard(props: {
  copy: PracticeCopy;
  missionTitle: string;
  missionBody: string;
  questionCount: number;
  supportChips: PracticeInfoChip[];
  assignmentInstructions?: string | null;
  onStart: () => void;
}) {
  const { copy, missionTitle, missionBody, questionCount, supportChips, assignmentInstructions, onStart } = props;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[6px_6px_0px_0px_#1A1A1A] md:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-brand-dark">
            <BrainCircuit className="h-4 w-4" />
            {missionTitle}
          </div>
          <h1 className="text-3xl font-black text-brand-dark md:text-5xl">{copy.startCalm}</h1>
        </div>
        <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 text-center shadow-[3px_3px_0px_0px_#1A1A1A]">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50">{copy.questionOf}</p>
          <p className="mt-1 text-3xl font-black text-brand-dark">{questionCount}</p>
        </div>
      </div>

      <p className="mt-4 text-base font-bold leading-7 text-slate-700 md:text-lg">{missionBody}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600 md:text-base">{copy.startBody}</p>

      {supportChips.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {supportChips.slice(0, 4).map((chip) => (
            <span
              key={chip.key}
              className={`rounded-full border border-brand-dark px-3 py-1.5 text-xs font-black ${getPracticeChipClasses(chip.tone)}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}

      {assignmentInstructions ? (
        <div className="mt-4 rounded-[1.2rem] border border-brand-dark bg-[#fffaf1] px-4 py-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-purple" />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple">{copy.missionHelp}</p>
              <p className="mt-1 text-sm font-bold leading-6 text-brand-dark/70">{assignmentInstructions}</p>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onStart}
        className="mt-6 flex w-full items-center justify-center gap-3 rounded-[1.4rem] border-2 border-brand-dark bg-brand-dark px-6 py-4 text-lg font-black text-white shadow-[5px_5px_0px_0px_#FF5A36]"
      >
        {copy.startCalm}
        <ArrowRight className="h-5 w-5" />
      </button>
    </motion.div>
  );
}

function PracticeHeaderBar(props: {
  copy: PracticeCopy;
  missionTitle: string;
  currentIndex: number;
  totalQuestions: number;
  progressPct: number;
  onExit: () => void;
}) {
  const { copy, missionTitle, currentIndex, totalQuestions, progressPct, onExit } = props;

  return (
    <div className="shrink-0 rounded-[1.8rem] border-4 border-brand-dark bg-white px-3 py-2.5 shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2rem] sm:px-6 sm:py-3 sm:shadow-[10px_10px_0px_0px_#1A1A1A]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="game-icon-button h-10 w-10 bg-white text-slate-400 hover:bg-rose-50 hover:text-rose-500 sm:h-11 sm:w-11"
            title={copy.endEarly}
          >
            <XCircle className="h-5 w-5" />
          </button>
          <div className="inline-flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] sm:px-4 sm:text-xs">
            <BrainCircuit className="h-4 w-4" />
            <span className="truncate">{missionTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-2xl border-2 border-brand-dark bg-white px-3 py-1.5 text-sm font-black text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
            {currentIndex + 1} / {totalQuestions}
          </div>
          <div className="rounded-2xl border-2 border-brand-dark bg-brand-yellow px-3 py-1.5 text-sm font-black text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
            {Math.round(progressPct)}%
          </div>
        </div>
      </div>

      <div className="mt-3 h-3 overflow-hidden rounded-full border-2 border-brand-dark bg-[#fff7de] p-0.5">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#FFCF33_0%,#FF8A00_45%,#FF5A36_100%)] transition-all"
          style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
        />
      </div>
    </div>
  );
}

function PracticeQuestionStage(props: {
  copy: PracticeCopy;
  question: any;
  questionTags: string[];
  currentIndex: number;
}) {
  const { copy, question, questionTags, currentIndex } = props;

  return (
    <motion.div
      key={`q-${currentIndex}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative shrink-0 overflow-hidden rounded-[2rem] border-4 border-brand-dark bg-white shadow-[7px_7px_0px_0px_#1A1A1A] sm:rounded-[2.5rem] sm:shadow-[10px_10px_0px_0px_#1A1A1A]"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#FFD13B_0%,#B488FF_48%,#FF8A5B_100%)]" />
      <div className="absolute right-0 top-0 -z-10 h-24 w-24 rounded-bl-full bg-[#fff4cf]" />
      <div className="relative z-10 flex min-h-[138px] w-full flex-col justify-center p-3 text-center sm:min-h-[170px] sm:p-4 lg:min-h-[190px] lg:p-5">
        <div className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 shadow-[2px_2px_0px_0px_#1A1A1A]">
          <Target className="h-4 w-4 text-brand-orange" />
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/70">{copy.adaptiveTarget}</span>
        </div>

        <QuestionImageCard
          imageUrl={question?.image_url}
          alt={question?.prompt || 'Practice question image'}
          className="mx-auto mb-2 w-full max-w-3xl"
          imgClassName="max-h-[120px] sm:max-h-[150px]"
        />

        <h2 className="mx-auto max-w-5xl text-[clamp(1.35rem,3.3vw,2.55rem)] font-black leading-[1.04] tracking-tight text-brand-dark text-balance">
          {question?.prompt}
        </h2>

        {questionTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {questionTags.map((tag: string, index: number) => (
              <span
                key={`${tag}-${index}`}
                className="rounded-full border border-brand-dark bg-white px-2.5 py-0.5 text-[10px] font-black capitalize text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function AdaptiveActionIcon(props: {
  key?: string;
  action: StudentAssistanceAction;
  label: string;
  description: string;
  Icon: any;
  disabled: boolean;
  used: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { action, label, description, Icon, disabled, used, active, onClick } = props;

  return (
    <div key={action} className="group relative flex flex-col items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`relative flex h-11 w-11 items-center justify-center rounded-[1.15rem] border-2 border-brand-dark transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:ring-offset-2 sm:h-12 sm:w-12 ${
          used
            ? 'bg-brand-dark text-white'
            : active
              ? 'bg-brand-purple text-white'
            : disabled
              ? 'bg-slate-100 text-slate-400'
              : 'bg-brand-bg text-brand-dark hover:-translate-y-0.5'
        }`}
        aria-label={label}
        title={label}
      >
        <Icon className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
        {used ? <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-brand-dark bg-brand-yellow" /> : null}
      </button>
      <span className="mt-1 text-center text-[10px] font-black leading-4 text-brand-dark/70 md:hidden">{label}</span>
      <div className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 z-20 hidden w-48 -translate-y-1/2 rounded-[1.1rem] border-2 border-brand-dark bg-white px-3 py-2 text-center shadow-[4px_4px_0px_0px_#1A1A1A] md:group-hover:block md:group-focus-within:block">
        <div className="mb-1 text-xs font-black text-brand-dark">{label}</div>
        <div className="text-[11px] font-bold leading-5 text-slate-600">{description}</div>
        <div className="absolute left-full top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-brand-dark bg-white" />
      </div>
    </div>
  );
}

function getAssistanceWindowCopy(action: DisplayedAssistanceAction | null, language: string): AssistanceWindowCopy {
  const shared = {
    he: {
      reflectionTitle: 'שאלת חזרה',
      rerunLabel: 'נסה שוב עם אותו כלי',
      usageLabel: 'מספר שימושים',
    },
    ar: {
      reflectionTitle: 'سؤال مراجعة',
      rerunLabel: 'شغّل الأداة مرة أخرى',
      usageLabel: 'عدد الاستخدامات',
    },
    en: {
      reflectionTitle: 'Reflection prompt',
      rerunLabel: 'Run this tool again',
      usageLabel: 'Times used',
    },
  }[language === 'he' || language === 'ar' ? language : 'en'];

  if (language === 'he') {
    switch (action) {
      case 'reframe_question':
        return { header: 'פישוט השאלה', kicker: 'מה באמת מבקשים ממך כאן', summary: 'הכלי הזה מנסח מחדש את המשימה המרכזית בלי לגלות את התשובה.', bulletsTitle: 'איך לקרוא את השאלה עכשיו', ...shared };
      case 'extract_keywords':
        return { header: 'מילות מפתח', kicker: 'מה לסמן בעין לפני שבוחרים', summary: 'הכלי הזה מדגיש את המושגים, התנאים והאותות הכי חשובים בשאלה.', bulletsTitle: 'נקודות שכדאי לשים לב אליהן', ...shared };
      case 'build_checklist':
        return { header: 'Checklist לחשיבה', kicker: 'בדיקה מהירה לפני בחירה', summary: 'הכלי הזה נותן סדר קצר למה לבדוק לפני שמתחייבים על תשובה.', bulletsTitle: 'צעדי הבדיקה שלך', ...shared };
      case 'socratic_hint':
        return { header: 'רמז בטוח', kicker: 'דחיפה עדינה לכיוון החשיבה', summary: 'הכלי הזה נותן כיוון לחשיבה בלי לגלות תשובה ובלי לצמצם אפשרויות.', bulletsTitle: 'על מה לחשוב עכשיו', ...shared };
      case 'confidence_check':
        return { header: 'בדיקת ביטחון', kicker: 'האם הבחירה שלך באמת מחזיקה', summary: 'הכלי הזה עוזר לבדוק אם ההיגיון שלך עדיין נכון כשקוראים שוב את כל השאלה.', bulletsTitle: 'איך לבדוק את עצמך', ...shared };
      case 'time_nudge':
        return { header: 'איפוס קצב', kicker: 'לעצור, לנשום, ולהמשיך מדויק', summary: 'הכלי הזה מרגיע את הקצב ועוזר לחזור לצעד הבא בלי לחץ מיותר.', bulletsTitle: 'הצעדים הקטנים עכשיו', ...shared };
      case 'post_answer_wrap':
        return { header: 'תקציר אישי', kicker: 'מה לקחת לשאלה הבאה', summary: 'הכלי הזה מחלץ את העיקרון שכדאי לזכור מהשאלה הנוכחית.', bulletsTitle: 'מה לשמור בראש', ...shared };
      case 'focus_reset':
        return { header: 'פוקוס מחדש', kicker: 'חזרה רגועה לשאלה', summary: 'זה כרטיס התאוששות קצר כשיש עומס או תקיעות, כדי לחזור למשימה בצורה נקייה.', bulletsTitle: 'איך לאפס את הראש', ...shared };
      default:
        return { header: 'כלי סיוע', kicker: 'עזרה ממוקדת לשאלה', summary: 'בחר/י כלי כדי לקבל עזרה קצרה ומדויקת שמתאימה לשלב שבו את/ה נמצא/ת.', bulletsTitle: 'מה תקבל/י כאן', ...shared };
    }
  }

  if (language === 'ar') {
    switch (action) {
      case 'reframe_question':
        return { header: 'تبسيط السؤال', kicker: 'ما الذي يطلبه السؤال فعلًا', summary: 'هذه الأداة تعيد صياغة المهمة الأساسية بدون كشف الإجابة.', bulletsTitle: 'كيف تقرأ السؤال الآن', ...shared };
      case 'extract_keywords':
        return { header: 'الكلمات المفتاحية', kicker: 'ما الذي يجب أن تلاحظه قبل الاختيار', summary: 'هذه الأداة تبرز المفاهيم والشروط والإشارات الأكثر أهمية في السؤال.', bulletsTitle: 'نقاط تستحق الانتباه', ...shared };
      case 'build_checklist':
        return { header: 'قائمة فحص', kicker: 'مراجعة سريعة قبل الاختيار', summary: 'هذه الأداة ترتب لك ما يجب فحصه قبل تثبيت الإجابة.', bulletsTitle: 'خطوات الفحص', ...shared };
      case 'socratic_hint':
        return { header: 'تلميح آمن', kicker: 'دفعة صغيرة نحو طريقة التفكير', summary: 'هذه الأداة تعطي اتجاهًا للتفكير بدون كشف الإجابة أو تضييق الخيارات.', bulletsTitle: 'ما الذي تفكر فيه الآن', ...shared };
      case 'confidence_check':
        return { header: 'فحص الثقة', kicker: 'هل اختيارك ما زال ثابتًا', summary: 'هذه الأداة تساعدك على اختبار منطقك بعد قراءة السؤال كاملًا مرة أخرى.', bulletsTitle: 'كيف تراجع نفسك', ...shared };
      case 'time_nudge':
        return { header: 'إعادة ضبط الوتيرة', kicker: 'توقف وتنفس ثم تابع بدقة', summary: 'هذه الأداة تهدئ الوتيرة وتعيدك للخطوة التالية بدون ضغط زائد.', bulletsTitle: 'الخطوات الصغيرة الآن', ...shared };
      case 'post_answer_wrap':
        return { header: 'ملخص شخصي', kicker: 'ما الذي تحمله للسؤال التالي', summary: 'هذه الأداة تلتقط الفكرة التي من المهم أن تتذكرها من السؤال الحالي.', bulletsTitle: 'ما الذي تحتفظ به', ...shared };
      case 'focus_reset':
        return { header: 'إعادة تركيز', kicker: 'عودة هادئة إلى السؤال', summary: 'هذه بطاقة سريعة عند الشعور بالضغط أو التشتت لتعود للمهمة بوضوح.', bulletsTitle: 'كيف تعيد التركيز', ...shared };
      default:
        return { header: 'أداة مساعدة', kicker: 'مساعدة مركزة لهذا السؤال', summary: 'اختر أداة لتحصل على مساعدة قصيرة ودقيقة تناسب المرحلة التي أنت فيها الآن.', bulletsTitle: 'ما الذي ستجده هنا', ...shared };
    }
  }

  switch (action) {
    case 'reframe_question':
      return { header: 'Question rewrite', kicker: 'What the prompt is really asking', summary: 'This tool rewrites the core task in simpler language without giving away the answer.', bulletsTitle: 'How to read it now', ...shared };
    case 'extract_keywords':
      return { header: 'Key words', kicker: 'What to notice before you choose', summary: 'This tool surfaces the concepts, conditions, and cues that matter most in the prompt.', bulletsTitle: 'Signals to focus on', ...shared };
    case 'build_checklist':
      return { header: 'Thinking checklist', kicker: 'A quick check before you commit', summary: 'This tool gives you a short order for what to verify before locking in an answer.', bulletsTitle: 'Your check steps', ...shared };
    case 'socratic_hint':
      return { header: 'Safe hint', kicker: 'A gentle push toward the reasoning', summary: 'This tool nudges your thinking forward without revealing the answer or narrowing choices.', bulletsTitle: 'What to think through now', ...shared };
    case 'confidence_check':
      return { header: 'Confidence check', kicker: 'Does your choice still hold up', summary: 'This tool helps you pressure-test your logic against the full wording of the question.', bulletsTitle: 'How to test yourself', ...shared };
    case 'time_nudge':
      return { header: 'Pace reset', kicker: 'Pause, breathe, and continue cleanly', summary: 'This tool slows the pace down and helps you get back to the next useful step.', bulletsTitle: 'Small steps right now', ...shared };
    case 'post_answer_wrap':
      return { header: 'Personal wrap-up', kicker: 'What to carry into the next question', summary: 'This tool pulls out the learning point worth keeping from the current question.', bulletsTitle: 'Keep this in mind', ...shared };
    case 'focus_reset':
      return { header: 'Focus reset', kicker: 'A calm way back into the question', summary: 'This is a short recovery card for overload or hesitation so you can re-enter the task cleanly.', bulletsTitle: 'How to reset', ...shared };
    default:
      return { header: 'Support tool', kicker: 'Focused help for this question', summary: 'Choose a tool to get short, precise help that matches the step you are on.', bulletsTitle: 'What you will get here', ...shared };
  }
}

function getAssistanceWindowTheme(action: DisplayedAssistanceAction | null): AssistanceWindowTheme {
  switch (action) {
    case 'reframe_question':
      return {
        shell: 'bg-[#eef7ff]',
        accent: 'text-[#2148b8]',
        accentSoft: 'bg-[#dcecff]',
        iconWrap: 'bg-[#dcecff] text-[#2148b8]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#f6fbff]',
        reflectionCard: 'bg-[#dcecff]',
        rerunButton: 'bg-white text-[#2148b8]',
      };
    case 'extract_keywords':
      return {
        shell: 'bg-[#fff5d6]',
        accent: 'text-[#a45112]',
        accentSoft: 'bg-[#ffe8a6]',
        iconWrap: 'bg-[#ffe8a6] text-[#a45112]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#fff9e7]',
        reflectionCard: 'bg-[#ffe8a6]',
        rerunButton: 'bg-white text-[#8b4d13]',
      };
    case 'build_checklist':
      return {
        shell: 'bg-[#f3f1ff]',
        accent: 'text-[#6d49c6]',
        accentSoft: 'bg-[#e3dcff]',
        iconWrap: 'bg-[#e3dcff] text-[#6d49c6]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#faf8ff]',
        reflectionCard: 'bg-[#e9e3ff]',
        rerunButton: 'bg-white text-[#6d49c6]',
      };
    case 'socratic_hint':
      return {
        shell: 'bg-[#fff0ea]',
        accent: 'text-[#c45428]',
        accentSoft: 'bg-[#ffd8c8]',
        iconWrap: 'bg-[#ffd8c8] text-[#c45428]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#fff7f3]',
        reflectionCard: 'bg-[#ffe4d8]',
        rerunButton: 'bg-white text-[#c45428]',
      };
    case 'confidence_check':
      return {
        shell: 'bg-[#eef8f5]',
        accent: 'text-[#20795a]',
        accentSoft: 'bg-[#d6f1e7]',
        iconWrap: 'bg-[#d6f1e7] text-[#20795a]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#f5fcf9]',
        reflectionCard: 'bg-[#dff5ec]',
        rerunButton: 'bg-white text-[#20795a]',
      };
    case 'time_nudge':
    case 'focus_reset':
      return {
        shell: 'bg-[#f4f8ff]',
        accent: 'text-[#3759b8]',
        accentSoft: 'bg-[#dfe9ff]',
        iconWrap: 'bg-[#dfe9ff] text-[#3759b8]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#f8fbff]',
        reflectionCard: 'bg-[#e7efff]',
        rerunButton: 'bg-white text-[#3759b8]',
      };
    case 'post_answer_wrap':
      return {
        shell: 'bg-[#fff8df]',
        accent: 'text-[#8f5c00]',
        accentSoft: 'bg-[#ffe99c]',
        iconWrap: 'bg-[#ffe99c] text-[#8f5c00]',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#fffdf4]',
        reflectionCard: 'bg-[#fff0b8]',
        rerunButton: 'bg-white text-[#8f5c00]',
      };
    default:
      return {
        shell: 'bg-[#eef7ff]',
        accent: 'text-brand-purple',
        accentSoft: 'bg-[#ece4ff]',
        iconWrap: 'bg-brand-bg text-brand-dark',
        summaryCard: 'bg-white',
        bulletsCard: 'bg-[#fffaf1]',
        reflectionCard: 'bg-brand-yellow/35',
        rerunButton: 'bg-white text-brand-dark',
      };
  }
}

function AdaptiveSelectedToolWindow(props: {
  language: string;
  action: DisplayedAssistanceAction | null;
  entry: AssistanceEntry | null;
  loading: boolean;
  Icon: any;
  onRerun: (() => void) | null;
}) {
  const { language, action, entry, loading, Icon, onRerun } = props;
  const copy = getAssistanceWindowCopy(action, language);
  const theme = getAssistanceWindowTheme(action);
  const usageCount = Math.max(1, Number(entry?.request_count || 0) || 0);
  const isChecklist = action === 'build_checklist' || action === 'confidence_check';
  const isKeywords = action === 'extract_keywords';
  const isHint = action === 'socratic_hint';
  const isWrap = action === 'post_answer_wrap';
  const keywordChipLabel = language === 'he' ? 'מילת מפתח' : language === 'ar' ? 'كلمة مفتاحية' : 'Keyword';

  return (
    <div className={`rounded-[1.2rem] border border-brand-dark p-3 ${theme.shell}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${theme.accent}`} />
        <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${theme.accent}`}>{copy.header}</p>
      </div>

      <div className="rounded-xl border border-brand-dark bg-white px-3 py-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-brand-dark ${theme.iconWrap}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-brand-dark">{copy.kicker}</p>
            <p className="mt-1 text-sm font-bold leading-5 text-slate-600">{copy.summary}</p>
          </div>
        </div>

        <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-brand-dark/35 px-3 py-2 ${theme.accentSoft}`}>
          <p className="text-sm font-bold leading-5 text-brand-dark/70">
            {loading
              ? language === 'he'
                ? 'המערכת בונה עכשיו תשובה מותאמת לכלי הזה.'
                : language === 'ar'
                  ? 'النظام يبني الآن استجابة مخصصة لهذه الأداة.'
                  : 'The system is building a response tailored to this tool now.'
              : entry
                ? language === 'he'
                  ? 'החלון הזה מציג את העזרה העדכנית ביותר עבור הכלי שבחרת.'
                  : language === 'ar'
                    ? 'هذه النافذة تعرض أحدث مساعدة للأداة التي اخترتها.'
                    : 'This window shows the latest help generated for the tool you selected.'
                : language === 'he'
                  ? 'בחר/י כלי מהסרגל כדי לפתוח לו חלון עזרה ייעודי.'
                  : language === 'ar'
                    ? 'اختر أداة من الشريط لفتح نافذة مساعدة مخصصة لها.'
                    : 'Choose a tool from the rail to open its dedicated help window.'}
          </p>
          {entry ? (
            <span className="shrink-0 rounded-full border border-brand-dark bg-white px-2.5 py-1 text-[10px] font-black uppercase text-brand-dark/70">
              {copy.usageLabel}: {usageCount}
            </span>
          ) : null}
        </div>

        {entry ? (
          <div className="mt-3 space-y-3">
            <div className={`rounded-xl border border-brand-dark px-3 py-3 ${theme.summaryCard}`}>
              <h4 className="text-base font-black text-brand-dark">{entry.card.title}</h4>
              <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/75">{entry.card.body}</p>
            </div>

            {Array.isArray(entry.card.bullets) && entry.card.bullets.length > 0 ? (
              <div className={`rounded-xl border border-brand-dark px-3 py-3 ${theme.bulletsCard}`}>
                <p className={`mb-2 text-[11px] font-black uppercase tracking-[0.16em] ${theme.accent}`}>{copy.bulletsTitle}</p>
                <div className="space-y-2">
                  {entry.card.bullets.map((bullet, index) => (
                    <div key={`${entry.request_id || entry.action}-window-bullet-${index}`}>
                      {isChecklist ? (
                        <div className="flex items-start gap-3 rounded-lg border border-brand-dark bg-white px-3 py-2.5 text-sm font-bold text-brand-dark/80">
                          <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-dark ${theme.accentSoft}`}>
                            {index + 1}
                          </span>
                          <span>{bullet}</span>
                        </div>
                      ) : isKeywords ? (
                        <div className="rounded-lg border border-brand-dark bg-white px-3 py-2.5 text-sm font-bold text-brand-dark/80">
                          <span className={`mb-1 inline-flex rounded-full border border-brand-dark px-2 py-0.5 text-[10px] font-black uppercase ${theme.accentSoft}`}>{keywordChipLabel}</span>
                          <div>{bullet}</div>
                        </div>
                      ) : isHint ? (
                        <div className="rounded-lg border border-brand-dark bg-white px-3 py-2.5 text-sm font-bold text-brand-dark/80 italic">
                          {bullet}
                        </div>
                      ) : isWrap ? (
                        <div className="rounded-lg border border-brand-dark bg-white px-3 py-2.5 text-sm font-bold text-brand-dark/80">
                          <div className="flex items-start gap-2">
                            <Sparkles className={`mt-0.5 h-4 w-4 shrink-0 ${theme.accent}`} />
                            <span>{bullet}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-brand-dark bg-white px-3 py-2 text-sm font-bold text-brand-dark/80">
                          {bullet}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {entry.card.reflection_prompt ? (
              <div className={`rounded-xl border border-brand-dark px-3 py-3 ${theme.reflectionCard}`}>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/55">{copy.reflectionTitle}</p>
                <p className="mt-1 text-sm font-black text-brand-dark">{entry.card.reflection_prompt}</p>
              </div>
            ) : null}

            {onRerun ? (
              <button
                type="button"
                onClick={onRerun}
                disabled={loading}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand-dark px-3 py-2.5 text-sm font-black shadow-[3px_3px_0px_0px_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-55 ${theme.rerunButton}`}
              >
                <RotateCcw className="h-4 w-4" />
                {copy.rerunLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdaptiveSupportRail(props: {
  copy: PracticeCopy;
  language: string;
  direction: string;
  open: boolean;
  panelRef: any;
  supportChips: PracticeInfoChip[];
  setNotes: string[];
  confidenceText: string;
  onToggle: () => void;
  assistLoadingAction: DisplayedAssistanceAction | null;
  assistError: string;
  status: PracticeStatus;
  currentAssistanceEntries: AssistanceEntry[];
  actionLabels: Record<StudentAssistanceAction, string>;
  actionDescriptions: Record<StudentAssistanceAction, string>;
  actionIcons: Record<StudentAssistanceAction, any>;
  assistanceCapabilities: Record<string, boolean>;
  questionId: number;
  assistByQuestion: Record<number, Record<string, AssistanceEntry>>;
  selectedAction: DisplayedAssistanceAction | null;
  onSelectEntry: (action: DisplayedAssistanceAction) => void;
  onRequestAction: (action: StudentAssistanceAction) => void;
  disabledByLoading: boolean;
}) {
  const {
    copy,
    language,
    direction,
    open,
    panelRef,
    supportChips,
    setNotes,
    confidenceText,
    onToggle,
    assistLoadingAction,
    assistError,
    status,
    currentAssistanceEntries,
    actionLabels,
    actionDescriptions,
    actionIcons,
    assistanceCapabilities,
    questionId,
    assistByQuestion,
    selectedAction,
    onSelectEntry,
    onRequestAction,
    disabledByLoading,
  } = props;

  const badgeCount = currentAssistanceEntries.length;
  const sideRailPositionClass = 'lg:right-4';
  const sidePanelPositionClass = 'lg:right-[7.25rem]';
  const selectedEntry = selectedAction ? assistByQuestion[questionId]?.[selectedAction] : null;
  const selectedServerAction = selectedAction && selectedAction !== 'focus_reset' ? selectedAction : null;
  const SelectedIcon = selectedServerAction ? actionIcons[selectedServerAction] : Sparkles;

  return (
    <div ref={panelRef}>
      <div
        className={`fixed bottom-4 left-1/2 z-40 -translate-x-1/2 lg:bottom-auto lg:left-auto lg:translate-x-0 lg:top-1/2 lg:-translate-y-1/2 ${sideRailPositionClass}`}
      >
        <div className="flex items-center gap-1.5 rounded-[1.55rem] border-4 border-brand-dark bg-white p-1.5 shadow-[6px_6px_0px_0px_#1A1A1A] lg:flex-col lg:gap-2 lg:p-2">
          <div className="hidden lg:flex lg:flex-col lg:items-center lg:gap-1 lg:rounded-[1rem] lg:border-2 lg:border-brand-dark lg:bg-[#fff8df] lg:px-2 lg:py-1.5">
            <Sparkles className={`h-3.5 w-3.5 ${assistLoadingAction ? 'animate-pulse text-brand-orange' : 'text-brand-purple'}`} />
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-brand-dark/65">{copy.smartTools}</span>
          </div>

          <div className="flex items-center gap-1.5 lg:flex-col">
            {ACTIVE_ASSISTANCE_ACTIONS.map((action) => {
              const Icon = actionIcons[action];
              const used = Boolean(assistByQuestion[questionId]?.[action]);
              const disabled =
                !assistanceCapabilities?.[action] ||
                disabledByLoading;

              return (
                <AdaptiveActionIcon
                  key={action}
                  action={action}
                  label={actionLabels[action]}
                  description={actionDescriptions[action]}
                  Icon={Icon}
                  disabled={disabled}
                  used={used}
                  active={selectedAction === action}
                  onClick={() => onRequestAction(action)}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[1.15rem] border-2 border-brand-dark bg-brand-bg text-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A] sm:h-11 sm:w-11"
            aria-expanded={open}
            title={copy.activeHelp}
          >
            <div className="relative">
              {open ? <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5" /> : <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />}
              {badgeCount > 0 ? (
                <span className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full border border-brand-dark bg-brand-yellow px-1.5 text-[10px] font-black text-brand-dark">
                  {badgeCount}
                </span>
              ) : null}
            </div>
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed bottom-24 left-3 right-3 z-50 max-h-[min(72vh,42rem)] lg:bottom-4 lg:left-auto lg:top-4 lg:w-[20rem] lg:max-h-none ${sidePanelPositionClass}`}
          >
            <div className="flex h-full max-h-[inherit] flex-col overflow-hidden rounded-[1.6rem] border-4 border-brand-dark bg-white p-3 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="grid min-h-0 gap-3 overflow-y-auto pr-1 custom-scrollbar">
                {supportChips.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {supportChips.map((chip) => (
                      <span
                        key={chip.key}
                        className={`rounded-full border border-brand-dark px-3 py-1 text-xs font-black ${getPracticeChipClasses(chip.tone)}`}
                      >
                        {chip.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                <AdaptiveSelectedToolWindow
                  language={language}
                  action={selectedAction}
                  entry={selectedEntry || null}
                  loading={Boolean(selectedServerAction && assistLoadingAction === selectedServerAction)}
                  Icon={SelectedIcon}
                  onRerun={selectedServerAction ? () => onRequestAction(selectedServerAction) : null}
                />

                <div className="rounded-[1.2rem] border border-brand-dark bg-[#fffaf1] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4 text-brand-orange" />
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-orange">{copy.forThisSet}</p>
                  </div>
                  <div className="space-y-2">
                    {setNotes.length > 0 ? (
                      setNotes.map((note) => (
                        <div key={note} className="rounded-xl border border-brand-dark bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-700">
                          {note}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-brand-dark bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-600">
                        {copy.smartToolsHint}
                      </div>
                    )}
                    {confidenceText ? <p className="text-xs font-bold text-brand-dark/55">{confidenceText}</p> : null}
                  </div>
                </div>

                {status === 'ACTIVE' ? (
                  <div className="rounded-[1.2rem] border border-brand-dark bg-[#f7f9ff] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple">{copy.smartTools}</p>
                    <p className="mt-1 text-xs font-bold text-brand-dark/60">{copy.hoverExplains}</p>
                    {assistLoadingAction ? (
                      <span className="mt-3 inline-flex rounded-full border border-brand-dark bg-white px-3 py-1.5 text-[11px] font-black uppercase">
                        {copy.assistanceLoading}
                      </span>
                    ) : null}
                    {language === 'he' ? (
                      <p className="mt-3 text-sm font-bold text-brand-dark/60">אין הגבלה על שימוש בכלי הסיוע בשאלה הזו.</p>
                    ) : language === 'ar' ? (
                      <p className="mt-3 text-sm font-bold text-brand-dark/60">لا يوجد حد لعدد مرات استخدام أدوات المساعدة في هذا السؤال.</p>
                    ) : (
                      <p className="mt-3 text-sm font-bold text-brand-dark/60">There is no usage limit for support tools on this question.</p>
                    )}
                    {assistError ? (
                      <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-center text-sm font-bold text-rose-700">
                        {assistError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-[1.2rem] border border-brand-dark bg-[#f7f2ff] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple">{copy.recentCards}</p>
                      <p className="text-xs font-bold text-brand-dark/60">{badgeCount > 0 ? `${badgeCount} ${copy.helpCards}` : copy.noHelpYet}</p>
                    </div>
                  </div>

                  <AnimatePresence>
                    {currentAssistanceEntries.length > 0 ? (
                      <div className="space-y-3">
                        {currentAssistanceEntries.map((entry) => (
                          <motion.div
                            key={`${questionId}-${entry.action}-${entry.request_id || 'latest'}`}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={`cursor-pointer rounded-[1rem] border border-brand-dark bg-white p-3 transition-transform hover:-translate-y-0.5 ${selectedAction === entry.action ? 'ring-2 ring-brand-purple/45 ring-offset-1' : ''}`}
                            onClick={() => onSelectEntry(entry.action)}
                          >
                            <div className="mb-2 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-purple">
                                  {entry.meta?.fallback_used
                                    ? copy.assistanceFallback
                                    : actionLabels[(entry.action === 'focus_reset' ? 'time_nudge' : entry.action) as StudentAssistanceAction]}
                                </p>
                                <h4 className="mt-1 text-base font-black text-brand-dark">{entry.card.title}</h4>
                              </div>
                              <div className="rounded-full border border-brand-dark bg-[#fffaf1] px-2 py-1 text-[10px] font-black uppercase">
                                {entry.request_count ? `${entry.request_count}x` : entry.meta?.fallback_used ? 'Fallback' : entry.meta?.source || 'Assist'}
                              </div>
                            </div>
                            <p className="text-sm font-bold leading-6 text-brand-dark/70">{entry.card.body}</p>
                          </motion.div>
                        ))}
                      </div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PracticeFeedbackCard(props: {
  copy: PracticeCopy;
  feedback: any;
  answers: string[];
  error: string;
  onNext: () => void;
  hasNext: boolean;
}) {
  const { copy, feedback, answers, error, onNext, hasNext } = props;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-[2rem] border-4 border-brand-dark bg-white p-4 shadow-[7px_7px_0px_0px_#1A1A1A] sm:rounded-[2.8rem] sm:p-6 sm:shadow-[12px_12px_0px_0px_#1A1A1A]"
    >
      <div className={`mb-5 flex items-center gap-3 ${feedback?.is_correct ? 'text-emerald-600' : 'text-rose-600'}`}>
        {feedback?.is_correct ? <CheckCircle className="h-9 w-9" /> : <XCircle className="h-9 w-9" />}
        <h3 className="text-2xl font-black md:text-3xl">{feedback?.is_correct ? copy.correct : copy.incorrect}</h3>
      </div>

      {error ? (
        <div className="mb-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-left text-sm font-bold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {answers.map((answer, index) => {
          const isCorrect = index === feedback?.correct_index;
          const isChosen = index === feedback?.chosen_index;
          let classes = 'border-slate-200 bg-slate-50 text-slate-400';
          if (isCorrect) classes = 'border-emerald-500 bg-emerald-50 text-emerald-800';
          else if (isChosen && !isCorrect) classes = 'border-rose-500 bg-rose-50 text-rose-800';

          return (
            <div
              key={`feedback-${index}`}
              className={`flex items-center justify-between rounded-[1.1rem] border-2 px-4 py-3 text-base font-black ${classes}`}
            >
              <span>{answer}</span>
              {isCorrect ? <CheckCircle className="h-5 w-5" /> : null}
              {isChosen && !isCorrect ? <XCircle className="h-5 w-5" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-[1.2rem] border border-brand-dark bg-[#eef7ff] p-4">
        <div className="mb-2 flex items-center gap-2 text-[#1d3d9e]">
          <Sparkles className="h-4 w-4" />
          <p className="text-sm font-black uppercase tracking-[0.16em]">{copy.explanation}</p>
        </div>
        <p className="text-sm font-bold leading-6 text-slate-700 md:text-base">{feedback?.explanation}</p>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-5 flex w-full items-center justify-center gap-3 rounded-[1.3rem] border-2 border-brand-dark bg-brand-dark px-6 py-4 text-base font-black text-white shadow-[5px_5px_0px_0px_#FF5A36]"
      >
        {hasNext ? copy.nextQuestion : copy.finishPractice}
        <ArrowRight className="h-5 w-5" />
      </button>
    </motion.div>
  );
}

export default function StudentPractice() {
  const appLanguage = useOptionalAppLanguage();
  const language = appLanguage?.language || readPreferredAppLanguage();
  const direction = appLanguage?.direction || resolveAppLanguageDirection(language);
  const { nickname } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAccountMode = !nickname;
  const queryString = searchParams.toString();
  const requestedPracticeMode = String(searchParams.get('mode') || '').trim().toLowerCase() === 'lesson' ? 'lesson' : 'adaptive';

  const copy = {
    he: {
      adaptivePractice: 'תרגול אדפטיבי',
      loadingPrefix: 'טוען',
      loadingSuffix: '...',
      startCalm: 'התחל רגוע',
      startBody: 'לפני שמתחילים: מותר לך לבקש פירוק שאלה, מילות מפתח, checklist, רמז סוקרטי, בדיקת ביטחון וניהול זמן. המעטפת לא תגלה תשובה נכונה.',
      classContext: 'הקשר כיתתי',
      assignmentContext: 'משימה פעילה',
      missionContext: 'הקשר המשימה',
      whyThisSet: 'למה הסט הזה',
      progress: 'אות התקדמות',
      questionOf: 'שאלה',
      of: 'מתוך',
      endEarly: 'סיים מוקדם',
      exitPrompt: 'לסיים את התרגול עכשיו?',
      rulesTitle: 'מה העוזר יכול לעשות',
      rulesAllowed: 'מותר: לפרק, לנסח מחדש, להדגיש מילות מפתח, לבדוק ביטחון, לתת רמז בטוח ולהרגיע.',
      rulesBlocked: 'אסור: לגלות תשובה, לצמצם ישירות לאופציה נכונה, או לנהל צ׳אט פתוח.',
      assistanceTitle: 'מעטפת סיוע חכמה',
      assistanceLoading: 'טוען סיוע...',
      assistanceUsed: 'כבר בשימוש בשאלה הזו',
      assistanceUnavailable: 'הסיוע החכם לא זמין כרגע.',
      assistanceFallback: 'כרטיס גיבוי',
      explanation: 'הסבר',
      nextQuestion: 'לשאלה הבאה',
      finishPractice: 'סיים תרגול',
      correct: 'נכון!',
      incorrect: 'לא הפעם.',
      completeSuffix: 'הושלם',
      updated: 'ההתקדמות שלך עודכנה ונשמרה בזיכרון האדפטיבי.',
      backToDashboard: 'חזרה ללוח המחוונים',
      backToClass: 'חזרה לכיתה',
      retry: 'נסה שוב',
      notLoaded: 'התרגול לא נטען כראוי',
      interrupted: 'משהו קטע את רצף התרגול האדפטיבי.',
      loadFailed: 'טעינת סט התרגול האדפטיבי שלך נכשלה.',
      submitFailed: 'לא ניתן היה לשלוח את התשובה שלך. נסה שוב.',
      correctCount: 'נכונות',
      answered: 'נענו',
      accuracy: 'דיוק',
      practiceStrategy: 'אסטרטגיית תרגול',
      coachNote: 'הערת מאמן',
      memorySnapshot: 'זיכרון למידה',
      adaptiveTarget: 'מיקוד אדפטיבי',
      lessonStudy: 'למידה עצמאית',
      questionReframe: 'פשט לי את השאלה',
      keywords: 'מה המילים החשובות כאן',
      checklist: 'על מה לבדוק לפני תשובה',
      hint: 'צריך רמז?',
      confidence: 'בדוק אותי לפני שליחה',
      timeNudge: 'אני תקוע/ה בזמן',
      postWrap: 'תקציר אישי',
      reflectionPrompt: 'שאלת החזרה',
      actionBudgetDone: 'מיצית את פעולות הסיוע לשאלה הזו.',
      missionHelp: 'מה מותר לעוזר כאן',
      smartTools: 'כלי סיוע',
      smartToolsHint: 'רמזים, בדיקות והסברים רק כשצריך.',
      forThisSet: 'למה קיבלת את הסט הזה',
      activeHelp: 'עזרה שנפתחה',
      helpCards: 'כרטיסי עזרה',
      noHelpYet: 'עדיין לא פתחת כלי עזרה בשאלה הזו.',
      hoverExplains: 'ריחוף מסביר, לחיצה מפעילה',
      selectedTool: 'הכלי שנבחר',
      chooseTool: 'בחר/י אייקון מהסרגל כדי לקבל עזרה ממוקדת וקצרה לשאלה הזו.',
      toolWorking: 'הכלי עובד עכשיו ומכין עבורך כרטיס ברור וקצר.',
      toolReady: 'זה הכרטיס שהכלי יצר עבורך. אפשר לקרוא ולהמשיך מיד לשאלה.',
      recentCards: 'כרטיסי עזרה אחרונים',
      classChip: 'כיתה',
      assignmentChip: 'משימה',
    },
    ar: {
      adaptivePractice: 'تدريب تكيّفي',
      loadingPrefix: 'جارٍ تحميل',
      loadingSuffix: '...',
      startCalm: 'ابدأ بهدوء',
      startBody: 'قبل أن نبدأ: يمكنك طلب تبسيط السؤال، كلمات مفتاحية، checklist، hint سقراطي، فحص ثقة، وتنظيم الوقت. المساعدة لن تكشف الإجابة الصحيحة.',
      classContext: 'سياق الصف',
      assignmentContext: 'مهمة نشطة',
      missionContext: 'سياق المهمة',
      whyThisSet: 'لماذا هذه المجموعة',
      progress: 'إشارة التقدم',
      questionOf: 'السؤال',
      of: 'من',
      endEarly: 'إنهاء مبكر',
      exitPrompt: 'هل تريد إنهاء التدريب الآن؟',
      rulesTitle: 'ما الذي يمكن للمساعد فعله',
      rulesAllowed: 'مسموح: التبسيط، إعادة الصياغة، إبراز الكلمات المفتاحية، فحص الثقة، التلميح الآمن، والتهدئة.',
      rulesBlocked: 'غير مسموح: كشف الإجابة، تضييق الخيارات مباشرة، أو فتح محادثة حرة.',
      assistanceTitle: 'غلاف مساعدة ذكي',
      assistanceLoading: 'جارٍ تحميل المساعدة...',
      assistanceUsed: 'تم استخدام هذه البطاقة بالفعل لهذا السؤال',
      assistanceUnavailable: 'المساعدة الذكية غير متاحة الآن.',
      assistanceFallback: 'بطاقة احتياطية',
      explanation: 'الشرح',
      nextQuestion: 'السؤال التالي',
      finishPractice: 'إنهاء التدريب',
      correct: 'صحيح!',
      incorrect: 'ليست هذه المرة.',
      completeSuffix: 'اكتمل',
      updated: 'تم تحديث تقدمك وحفظه في الذاكرة التكيّفية.',
      backToDashboard: 'العودة إلى اللوحة',
      backToClass: 'العودة إلى الصف',
      retry: 'أعد المحاولة',
      notLoaded: 'لم يتم تحميل التدريب بشكل صحيح',
      interrupted: 'حدث ما قطع مسار التدريب التكيّفي.',
      loadFailed: 'فشل تحميل مجموعة التدريب التكيّفي.',
      submitFailed: 'تعذر إرسال إجابتك. حاول مرة أخرى.',
      correctCount: 'صحيحة',
      answered: 'تمت الإجابة',
      accuracy: 'الدقة',
      practiceStrategy: 'استراتيجية التدريب',
      coachNote: 'ملاحظة المدرب',
      memorySnapshot: 'لقطة الذاكرة',
      adaptiveTarget: 'هدف تكيّفي',
      lessonStudy: 'تعلم ذاتي',
      questionReframe: 'بسّط السؤال',
      keywords: 'ما الكلمات المهمة',
      checklist: 'ما الذي أتحقق منه قبل الإجابة',
      hint: 'أحتاج تلميحًا',
      confidence: 'افحصني قبل الإرسال',
      timeNudge: 'أنا عالق بسبب الوقت',
      postWrap: 'ملخص شخصي',
      reflectionPrompt: 'سؤال انعكاس',
      actionBudgetDone: 'استهلكت ميزانية المساعدة لهذا السؤال.',
      missionHelp: 'ما المسموح للمساعد هنا',
      smartTools: 'أدوات المساعدة',
      smartToolsHint: 'تلميحات وفحوصات وشروحات عند الحاجة فقط.',
      forThisSet: 'لماذا حصلت على هذه المجموعة',
      activeHelp: 'المساعدة المفتوحة',
      helpCards: 'بطاقات مساعدة',
      noHelpYet: 'لم تفتح أي أداة مساعدة لهذا السؤال بعد.',
      hoverExplains: 'المرور يوضح، والنقر يفعّل',
      selectedTool: 'الأداة المختارة',
      chooseTool: 'اختر أيقونة من الشريط لتحصل على مساعدة قصيرة ومركزة لهذا السؤال.',
      toolWorking: 'الأداة تعمل الآن وتحضّر لك بطاقة قصيرة وواضحة.',
      toolReady: 'هذه هي البطاقة التي أنشأتها الأداة لك. يمكنك قراءتها والمتابعة مباشرة.',
      recentCards: 'بطاقات المساعدة الأخيرة',
      classChip: 'الصف',
      assignmentChip: 'المهمة',
    },
    en: {
      adaptivePractice: 'Adaptive Practice',
      loadingPrefix: 'Loading',
      loadingSuffix: '...',
      startCalm: 'Start Calmly',
      startBody: 'Before we begin: you can ask for a simpler read, keywords, a checklist, a Socratic hint, a confidence check, and a time reset. The assistant will not reveal the correct answer.',
      classContext: 'Class context',
      assignmentContext: 'Active assignment',
      missionContext: 'Mission context',
      whyThisSet: 'Why this set',
      progress: 'Progress signal',
      questionOf: 'Question',
      of: 'of',
      endEarly: 'End early',
      exitPrompt: 'End practice now?',
      rulesTitle: 'What the assistant can do',
      rulesAllowed: 'Allowed: simplify, reframe, spotlight keywords, check confidence, give safe hints, and calm the pace.',
      rulesBlocked: 'Blocked: revealing the answer, narrowing directly to the right option, or open-ended chatting.',
      assistanceTitle: 'Smart Assistance Rail',
      assistanceLoading: 'Loading help...',
      assistanceUsed: 'Already used on this question',
      assistanceUnavailable: 'Smart assistance is unavailable right now.',
      assistanceFallback: 'Fallback card',
      explanation: 'Explanation',
      nextQuestion: 'Next Question',
      finishPractice: 'Finish Practice',
      correct: 'Correct!',
      incorrect: 'Not quite.',
      completeSuffix: 'complete',
      updated: 'Your progress was updated and saved into the adaptive memory layer.',
      backToDashboard: 'Back to Dashboard',
      backToClass: 'Back to Class',
      retry: 'Retry',
      notLoaded: 'Practice did not load cleanly',
      interrupted: 'Something interrupted the adaptive practice flow.',
      loadFailed: 'Failed to load your adaptive practice set.',
      submitFailed: 'Your answer could not be submitted. Try again.',
      correctCount: 'Correct',
      answered: 'Answered',
      accuracy: 'Accuracy',
      practiceStrategy: 'Practice strategy',
      coachNote: 'Coach note',
      memorySnapshot: 'Memory snapshot',
      adaptiveTarget: 'Adaptive target',
      lessonStudy: 'Independent study',
      questionReframe: 'Simplify the question',
      keywords: 'Important words',
      checklist: 'What should I check',
      hint: 'Need a hint?',
      confidence: 'Check me before submit',
      timeNudge: 'I am stuck on time',
      postWrap: 'Personal wrap-up',
      reflectionPrompt: 'Reflection prompt',
      actionBudgetDone: 'You have used the help budget for this question.',
      missionHelp: 'What the assistant can do here',
      smartTools: 'Smart Tools',
      smartToolsHint: 'Hints, checks, and explanations only when needed.',
      forThisSet: 'Why you got this set',
      activeHelp: 'Active help',
      helpCards: 'help cards',
      noHelpYet: 'No support tool has been opened for this question yet.',
      hoverExplains: 'Hover explains, click runs',
      selectedTool: 'Selected tool',
      chooseTool: 'Pick an icon from the rail to get short, focused help for this question.',
      toolWorking: 'This tool is working now and preparing a short, clear help card.',
      toolReady: 'This is the card the tool prepared for you. Read it and jump right back in.',
      recentCards: 'Recent help cards',
      classChip: 'Class',
      assignmentChip: 'Assignment',
    },
  }[language];

  const fallbackMission = useMemo(
    () => ({
      id: String(searchParams.get('mission') || '').trim() || null,
      label: String(searchParams.get('mission_label') || '').trim() || copy.adaptivePractice,
      question_count: Number(searchParams.get('count') || 5) || 5,
      focus_tags: String(searchParams.get('focus_tags') || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }),
    [copy.adaptivePractice, searchParams],
  );

  const practicePath = isAccountMode
    ? (queryString ? `/api/student/me/practice?${queryString}` : '/api/student/me/practice')
    : (queryString ? `/api/practice/${nickname}?${queryString}` : `/api/practice/${nickname}`);
  const practiceAnswerPath = isAccountMode
    ? '/api/student/me/practice/answer'
    : `/api/practice/${nickname}/answer`;
  const practiceAssistPath = '/api/student/me/practice/assist';
  const fallbackClassPath = isAccountMode && Number(searchParams.get('class_id') || 0) > 0 ? `/student/me/classes/${Number(searchParams.get('class_id') || 0)}` : '';
  const dashboardPath = isAccountMode ? fallbackClassPath || '/student/me' : `/student/dashboard/${nickname}`;
  const backLabel = fallbackClassPath ? copy.backToClass : copy.backToDashboard;

  const [questions, setQuestions] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<any>(null);
  const [mission, setMission] = useState<any>(null);
  const [memoryReason, setMemoryReason] = useState('');
  const [memoryReasons, setMemoryReasons] = useState<string[]>([]);
  const [memoryConfidence, setMemoryConfidence] = useState<any>(null);
  const [coaching, setCoaching] = useState<any>(null);
  const [memorySummary, setMemorySummary] = useState<any>(null);
  const [practiceContext, setPracticeContext] = useState<any>(null);
  const [assistancePolicy, setAssistancePolicy] = useState<any>(null);
  const [assistanceCapabilities, setAssistanceCapabilities] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<PracticeStatus>('LOADING');
  const [feedback, setFeedback] = useState<any>(null);
  const [startTime, setStartTime] = useState(0);
  const [error, setError] = useState('');
  const [practiceStats, setPracticeStats] = useState({ correct: 0, answered: 0 });
  const [assistError, setAssistError] = useState('');
  const [assistLoadingAction, setAssistLoadingAction] = useState<DisplayedAssistanceAction | null>(null);
  const [assistByQuestion, setAssistByQuestion] = useState<Record<number, Record<string, AssistanceEntry>>>({});
  const [postWrapRequested, setPostWrapRequested] = useState<Record<number, boolean>>({});
  const [consecutiveIncorrect, setConsecutiveIncorrect] = useState(0);
  const [pendingFocusReset, setPendingFocusReset] = useState(false);
  const [adaptivePanelOpen, setAdaptivePanelOpen] = useState(false);
  const [selectedAssistAction, setSelectedAssistAction] = useState<DisplayedAssistanceAction | null>(null);
  const adaptivePanelRef = useRef<HTMLDivElement | null>(null);

  const missionTitle = mission?.label || fallbackMission.label || (requestedPracticeMode === 'lesson' ? copy.lessonStudy : copy.adaptivePractice);
  const missionFocusTags = Array.isArray(mission?.focus_tags)
    ? mission.focus_tags
    : Array.isArray(fallbackMission.focus_tags)
      ? fallbackMission.focus_tags
      : [];
  const missionMode = String(mission?.id || fallbackMission.id || '');
  const missionBody =
    missionMode === 'reentry'
      ? language === 'he'
        ? 'סבב קצר שנועד לאפשר חזרה חלקה ובטוחה.'
        : language === 'ar'
          ? 'جولة قصيرة لتسهيل العودة بثقة.'
          : 'A short reset round built to make coming back easy.'
      : missionMode === 'targeted'
        ? language === 'he'
          ? 'ספרינט ממוקד סביב המושגים שבהם תחושת הביטחון עדיין שברירית.'
          : language === 'ar'
            ? 'دفعة مركزة حول المفاهيم التي لا تزال الثقة فيها هشة.'
            : 'A focused sprint aimed at the concepts where confidence is still fragile.'
        : missionMode === 'momentum'
          ? language === 'he'
            ? 'חיזוק קצר שנועד לשמר את ההתקדמות האחרונה.'
            : language === 'ar'
              ? 'دفعة سريعة للحفاظ على تقدمك الأخير.'
              : 'A quick booster to keep your recent gains warm.'
          : requestedPracticeMode === 'lesson'
            ? language === 'he'
              ? 'למידה עצמאית מתוך השיעור שבחרת, בקצב שלך ובלי התאמה אדפטיבית.'
              : language === 'ar'
                ? 'تعلم ذاتي من الدرس الذي اخترته، بوتيرتك وبدون تكييف تكيفي.'
                : 'A self-paced lesson round from the class material you chose.'
            : language === 'he'
              ? 'תרגול אדפטיבי שנבנה מתוך פרופיל השליטה הנוכחי שלך.'
              : language === 'ar'
                ? 'تدريب تكيّفي مبني على ملف الإتقان الحالي لديك.'
                : 'Adaptive practice built from your current mastery profile.';

  const question = questions[currentIndex];
  const questionId = Number(question?.id || 0);
  const questionTags = parseTags(question);
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  const currentAssistanceEntries: AssistanceEntry[] = questionId
    ? ((Object.values(assistByQuestion[questionId] || {}) as AssistanceEntry[]).sort(
        (left, right) => Number(right?.request_count || 0) - Number(left?.request_count || 0),
      ))
    : [];

  const actionLabels: Record<StudentAssistanceAction, string> = {
    reframe_question: copy.questionReframe,
    extract_keywords: copy.keywords,
    build_checklist: copy.checklist,
    socratic_hint: copy.hint,
    confidence_check: copy.confidence,
    time_nudge: copy.timeNudge,
    post_answer_wrap: copy.postWrap,
  };

  const actionDescriptions: Record<StudentAssistanceAction, string> = {
    reframe_question:
      language === 'he'
        ? 'מנסח את השאלה מחדש כדי להבין מה באמת מבקשים.'
        : language === 'ar'
          ? 'يعيد صياغة السؤال لتفهم ما المطلوب فعلاً.'
          : 'Reframes the question so the real task is easier to see.',
    extract_keywords:
      language === 'he'
        ? 'מדגיש את המילים והאותות שהכי חשוב לשים לב אליהם.'
        : language === 'ar'
          ? 'يبرز الكلمات والإشارات الأهم داخل السؤال.'
          : 'Highlights the words and cues that matter most.',
    build_checklist:
      language === 'he'
        ? 'נותן בדיקת חשיבה קצרה לפני בחירת תשובה.'
        : language === 'ar'
          ? 'يعطي قائمة فحص قصيرة قبل اختيار الإجابة.'
          : 'Gives you a short thinking checklist before answering.',
    socratic_hint:
      language === 'he'
        ? 'נותן רמז לחשיבה בלי לחשוף את התשובה.'
        : language === 'ar'
          ? 'يعطي تلميحًا للتفكير بدون كشف الإجابة.'
          : 'Gives a thinking hint without revealing the answer.',
    confidence_check:
      language === 'he'
        ? 'עוזר לבדוק אם הבחירה שלך באמת מחזיקה.'
        : language === 'ar'
          ? 'يساعدك على فحص ما إذا كان اختيارك ثابتًا فعلاً.'
          : 'Helps you pressure-test whether your choice really holds.',
    time_nudge:
      language === 'he'
        ? 'עוזר לעצור, לנשום, ולחזור למשימה בלי לחץ.'
        : language === 'ar'
          ? 'يساعدك على التوقف والتنفس والعودة للمهمة بهدوء.'
          : 'Helps you pause, breathe, and re-enter the task calmly.',
    post_answer_wrap:
      language === 'he'
        ? 'מסכם מה כדאי לקחת לשאלה הבאה.'
        : language === 'ar'
          ? 'يلخّص ما الذي כדאי أن تحمله للسؤال التالي.'
          : 'Wraps up what to carry into the next question.',
  };

  const actionIcons: Record<StudentAssistanceAction, any> = {
    reframe_question: BrainCircuit,
    extract_keywords: Search,
    build_checklist: Target,
    socratic_hint: Lightbulb,
    confidence_check: CheckCircle,
    time_nudge: Clock3,
    post_answer_wrap: Sparkles,
  };

  const supportChips = useMemo(() => {
    const chips: PracticeInfoChip[] = [];
    if (practiceContext?.class_name) {
      chips.push({
        key: `class-${practiceContext.class_name}`,
        label: `${copy.classChip}: ${practiceContext.class_name}`,
        tone: 'cool',
      });
    }
    if (practiceContext?.assignment_title) {
      chips.push({
        key: `assignment-${practiceContext.assignment_title}`,
        label: `${copy.assignmentChip}: ${practiceContext.assignment_title}`,
        tone: 'violet',
      });
    }
    if (practiceContext?.pack_title) {
      chips.push({
        key: `pack-${practiceContext.pack_title}`,
        label: practiceContext.pack_title,
        tone: 'warm',
      });
    }
    missionFocusTags.slice(0, 2).forEach((tag: string) => {
      chips.push({
        key: `focus-${tag}`,
        label: tag,
        tone: 'warm',
      });
    });
    return chips;
  }, [copy.assignmentChip, copy.classChip, missionFocusTags, practiceContext]);

  const adaptiveSetNotes = useMemo(() => {
    const notes = [
      memoryReason,
      ...memoryReasons.slice(0, 2),
      strategy?.headline || '',
      coaching?.student_message || '',
    ]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);

    return Array.from(new Set(notes)).slice(0, 2);
  }, [coaching, memoryReason, memoryReasons, strategy]);

  const confidenceSignalText = useMemo(() => {
    const evidenceCount = Number(memoryConfidence?.evidence_count || 0);
    if (!evidenceCount) return '';
    const band = String(memoryConfidence?.confidence_band || 'low');
    if (language === 'he') return `${band} confidence מתוך ${evidenceCount} אותות.`;
    if (language === 'ar') return `${band} confidence من ${evidenceCount} إشارات.`;
    return `${band} confidence from ${evidenceCount} signals.`;
  }, [language, memoryConfidence]);

  useEffect(() => {
    let cancelled = false;
    setStatus('LOADING');
    setError('');
    setAssistError('');
    setAssistByQuestion({});
    setPostWrapRequested({});
    setConsecutiveIncorrect(0);
    setPendingFocusReset(false);
    setCurrentIndex(0);
    setFeedback(null);
    setPracticeStats({ correct: 0, answered: 0 });

    apiFetchJson(practicePath)
      .then((data) => {
        if (cancelled) return;
        const loadedQuestions = Array.isArray(data?.questions) ? data.questions : [];
        setQuestions(loadedQuestions);
        setStrategy(data?.strategy || null);
        setMission(data?.mission || fallbackMission);
        setMemoryReason(String(data?.memory_reason || ''));
        setMemoryReasons(Array.isArray(data?.memory_reasons) ? data.memory_reasons : []);
        setMemoryConfidence(data?.memory_confidence || null);
        setCoaching(data?.coaching || null);
        setMemorySummary(data?.student_memory_summary || null);
        setPracticeContext(data?.context || null);
        setAssistancePolicy(data?.assistance_policy || null);
        setAssistanceCapabilities(data?.assistance_capabilities || {});
        const nextStatus = loadedQuestions.length > 0
          ? (requestedPracticeMode === 'lesson' ? 'ACTIVE' : 'READY')
          : 'DONE';
        setStatus(nextStatus);
        if (loadedQuestions.length > 0 && requestedPracticeMode === 'lesson') {
          setStartTime(Date.now());
        }
      })
      .catch((loadError: any) => {
        if (cancelled) return;
        setError(loadError?.message || copy.loadFailed);
        setStatus('ERROR');
      });

    return () => {
      cancelled = true;
    };
  }, [copy.loadFailed, fallbackMission, practicePath]);

  useEffect(() => {
    if (status !== 'ACTIVE' || !questionId || !isAccountMode) return;
    if ((assistByQuestion[questionId] || {}).focus_reset) return;
    const timeout = window.setTimeout(() => {
      setAssistByQuestion((current) => ({
        ...current,
        [questionId]: {
          ...(current[questionId] || {}),
          focus_reset: buildLocalFocusResetCard(language),
        },
      }));
      setSelectedAssistAction('focus_reset');
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [assistByQuestion, isAccountMode, language, questionId, status]);

  useEffect(() => {
    if (status !== 'ACTIVE' || !questionId || !pendingFocusReset) return;
    setAssistByQuestion((current) => ({
      ...current,
      [questionId]: {
        ...(current[questionId] || {}),
        focus_reset: buildLocalFocusResetCard(language),
      },
    }));
    setSelectedAssistAction('focus_reset');
    setPendingFocusReset(false);
  }, [language, pendingFocusReset, questionId, status]);

  useEffect(() => {
    setAdaptivePanelOpen(false);
    setSelectedAssistAction(null);
  }, [currentIndex, status]);

  useEffect(() => {
    if (!adaptivePanelOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!(event.target instanceof Node)) return;
      if (adaptivePanelRef.current?.contains(event.target)) return;
      setAdaptivePanelOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdaptivePanelOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [adaptivePanelOpen]);

  useEffect(() => {
    if (!isAccountMode || status !== 'FEEDBACK' || !questionId || !assistanceCapabilities?.post_answer_wrap) return;
    if (postWrapRequested[questionId] || assistByQuestion[questionId]?.post_answer_wrap) return;
    setPostWrapRequested((current) => ({ ...current, [questionId]: true }));
    void requestAssistance('post_answer_wrap', true);
  }, [assistanceCapabilities, assistByQuestion, isAccountMode, postWrapRequested, questionId, status]);

  const requestAssistance = async (action: StudentAssistanceAction, silent = false) => {
    if (!isAccountMode || !questionId || !question?.support_token) return;
    if (!assistanceCapabilities?.[action]) return;

    setAssistError('');
    setAssistLoadingAction(action);
    setSelectedAssistAction(action);
    setAdaptivePanelOpen(true);
    try {
      const payload = await apiFetchJson(practiceAssistPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          action,
          support_token: question.support_token,
          class_id: practiceContext?.class_id || null,
          assignment_id: practiceContext?.assignment_id || null,
          pack_id: practiceContext?.pack_id || null,
          mission_label: missionTitle,
          ui_language: language,
        }),
      });
      setAssistByQuestion((current) => ({
        ...current,
        [questionId]: {
          ...(current[questionId] || {}),
          [action]: {
            ...payload,
            request_id: `${action}-${Date.now()}`,
            request_count: Number(current[questionId]?.[action]?.request_count || 0) + 1,
          },
        },
      }));
    } catch (assistLoadError: any) {
      if (!silent) {
        setAssistError(assistLoadError?.message || copy.assistanceUnavailable);
      }
    } finally {
      setAssistLoadingAction((current) => (current === action ? null : current));
    }
  };

  const handleAnswer = async (index: number) => {
    if (status !== 'ACTIVE') return;
    const responseMs = Date.now() - startTime;
    setError('');
    try {
      const data = await apiFetchJson(practiceAnswerPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          chosen_index: index,
          response_ms: responseMs,
        }),
      });
      setFeedback({ ...data, chosen_index: index });
      setPracticeStats((current) => ({
        correct: current.correct + (data?.is_correct ? 1 : 0),
        answered: current.answered + 1,
      }));
      setConsecutiveIncorrect((current) => (data?.is_correct ? 0 : current + 1));
      if (!data?.is_correct && consecutiveIncorrect + 1 >= 2) {
        setPendingFocusReset(true);
      }
      setStatus('FEEDBACK');
    } catch (submitError: any) {
      console.error(submitError);
      setError(copy.submitFailed);
    }
  };

  const handleNext = () => {
    setError('');
    setAssistError('');
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setStatus('ACTIVE');
      setFeedback(null);
      setStartTime(Date.now());
    } else {
      setStatus('DONE');
    }
  };

  const handleStart = () => {
    setStatus('ACTIVE');
    setStartTime(Date.now());
  };

  const progressPct = questions.length > 0 ? ((currentIndex + (status === 'FEEDBACK' ? 1 : 0)) / questions.length) * 100 : 0;
  const railReservedSpaceClass = isAccountMode ? 'lg:pr-[8.5rem]' : '';

  const handleExit = () => {
    if (window.confirm(copy.exitPrompt)) {
      navigate(dashboardPath);
    }
  };

  if (status === 'LOADING') {
    return (
      <div
        dir={direction}
        className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#FAFBFD_52%,_#F4F8FF_100%)] px-4 py-8 md:px-6"
      >
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xl rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[6px_6px_0px_0px_#1A1A1A] md:p-8"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-dark bg-[#fff8df] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark">
                <BrainCircuit className="h-4 w-4" />
                {copy.adaptivePractice}
              </div>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.3, repeat: Infinity, ease: 'linear' }}>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-brand-dark bg-brand-bg">
                  <BrainCircuit className="h-5 w-5 text-brand-orange" />
                </div>
              </motion.div>
            </div>
            <h2 className="text-2xl font-black leading-tight text-brand-dark md:text-3xl">{`${copy.loadingPrefix} ${missionTitle}${copy.loadingSuffix}`}</h2>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600 md:text-base">{missionBody}</p>
          </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'ERROR') {
    return (
      <div
        dir={direction}
        className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#FAFBFD_52%,_#F4F8FF_100%)] px-4 py-8 md:px-6"
      >
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center justify-center">
          <div className="w-full max-w-lg rounded-[2rem] border-2 border-brand-dark bg-white p-6 text-center shadow-[6px_6px_0px_0px_#1A1A1A] md:p-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-brand-dark bg-[#fff8df]">
              <AlertTriangle className="h-6 w-6 text-brand-orange" />
            </div>
            <h2 className="text-2xl font-black text-brand-dark md:text-3xl">{copy.notLoaded}</h2>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600 md:text-base">{error || copy.interrupted}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] border-2 border-brand-dark bg-brand-dark px-5 py-3 text-sm font-black text-white shadow-[4px_4px_0px_0px_#FF5A36]"
              >
                <RotateCcw className="h-4 w-4" />
                {copy.retry}
              </button>
              <button
                type="button"
                onClick={() => navigate(dashboardPath)}
                className="rounded-[1.2rem] border-2 border-brand-dark bg-white px-5 py-3 text-sm font-black text-brand-dark"
              >
                {backLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'DONE') {
    const accuracy = practiceStats.answered > 0 ? Math.round((practiceStats.correct / practiceStats.answered) * 100) : 0;

    return (
      <div
        dir={direction}
        className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#FAFBFD_52%,_#F4F8FF_100%)] px-4 py-8 md:px-6"
      >
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-3xl rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[6px_6px_0px_0px_#1A1A1A] md:p-8"
          >
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-dark bg-[#fff8df] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark">
                  <Sparkles className="h-4 w-4 text-brand-purple" />
                  {copy.adaptivePractice}
                </div>
                <h2 className="text-3xl font-black leading-tight text-brand-dark md:text-5xl">{`${missionTitle} ${copy.completeSuffix}`}</h2>
                <p className="mt-3 text-sm font-bold leading-6 text-slate-600 md:text-base">{copy.updated}</p>
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] border-2 border-brand-dark bg-[#e8fff4]">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[1.3rem] border border-brand-dark bg-[#fff8df] px-4 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50">{copy.correctCount}</p>
                <p className="mt-2 text-3xl font-black text-brand-dark">{practiceStats.correct}</p>
              </div>
              <div className="rounded-[1.3rem] border border-brand-dark bg-[#eef7ff] px-4 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50">{copy.answered}</p>
                <p className="mt-2 text-3xl font-black text-brand-dark">{practiceStats.answered}</p>
              </div>
              <div className="rounded-[1.3rem] border border-brand-dark bg-[#f5edff] px-4 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50">{copy.accuracy}</p>
                <p className="mt-2 text-3xl font-black text-brand-dark">{accuracy}%</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate(dashboardPath)}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-[1.4rem] border-2 border-brand-dark bg-brand-dark px-6 py-4 text-base font-black text-white shadow-[5px_5px_0px_0px_#FF5A36]"
            >
              {backLabel}
              <ArrowRight className="h-5 w-5" />
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'READY') {
    return (
      <div
        dir={direction}
        className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#FAFBFD_52%,_#F4F8FF_100%)] px-4 py-6 md:px-6"
      >
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-4xl items-center justify-center">
          <PracticeIntroCard
            copy={copy}
            missionTitle={missionTitle}
            missionBody={missionBody}
            questionCount={questions.length}
            supportChips={supportChips}
            assignmentInstructions={practiceContext?.assignment_instructions || null}
            onStart={handleStart}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      dir={direction}
      className="game-viewport-shell flex h-screen overflow-hidden bg-[linear-gradient(180deg,_#FFF7E8_0%,_#FAFBFD_52%,_#F4F8FF_100%)] text-brand-dark"
    >
      <div className={`relative mx-auto flex w-full max-w-[1540px] flex-1 min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3 sm:gap-4 sm:p-6 lg:p-8 ${railReservedSpaceClass}`}>
        <PracticeHeaderBar
          copy={copy}
          missionTitle={missionTitle}
          currentIndex={currentIndex}
          totalQuestions={questions.length}
          progressPct={progressPct}
          onExit={handleExit}
        />

        {isAccountMode ? (
          <AdaptiveSupportRail
            copy={copy}
            language={language}
            direction={direction}
            open={adaptivePanelOpen}
            panelRef={adaptivePanelRef}
            supportChips={supportChips}
            setNotes={adaptiveSetNotes}
            confidenceText={confidenceSignalText}
            onToggle={() => setAdaptivePanelOpen((current) => !current)}
            assistLoadingAction={assistLoadingAction}
            assistError={assistError}
            status={status}
            currentAssistanceEntries={currentAssistanceEntries}
            actionLabels={actionLabels}
            actionDescriptions={actionDescriptions}
            actionIcons={actionIcons}
            assistanceCapabilities={assistanceCapabilities}
            questionId={questionId}
            assistByQuestion={assistByQuestion}
            selectedAction={selectedAssistAction}
            onSelectEntry={(action) => {
              setSelectedAssistAction(action);
              setAdaptivePanelOpen(true);
            }}
            onRequestAction={(action) => {
              void requestAssistance(action);
            }}
            disabledByLoading={Boolean(assistLoadingAction)}
          />
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
          <PracticeQuestionStage
            copy={copy}
            question={question}
            questionTags={questionTags}
            currentIndex={currentIndex}
          />

          {status === 'ACTIVE' ? (
            <section className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border-4 border-brand-dark bg-white shadow-[7px_7px_0px_0px_#1A1A1A] sm:rounded-[2.8rem] sm:shadow-[12px_12px_0px_0px_#1A1A1A]">
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2.5 sm:p-4 lg:p-5 custom-scrollbar">
                {error ? (
                  <div className="mb-4 rounded-[1.1rem] border-2 border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                    {error}
                  </div>
                ) : null}

                <div className="grid min-h-full grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4">
                  {answers.map((answer: string, index: number) => (
                    <motion.button
                      key={`${questionId}-${index}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.15, delay: index * 0.05 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => void handleAnswer(index)}
                      style={buildPracticeAnswerToneStyle(index)}
                      className="student-answer-button student-play-answer-tile group relative flex min-h-[88px] items-center px-3 py-2.5 text-center sm:min-h-[100px] sm:px-5 sm:py-3"
                    >
                      <div className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-brand-dark/10 bg-white/40 text-sm font-black text-brand-dark/30 transition-colors sm:mr-4 sm:h-9 sm:w-9 sm:rounded-xl sm:text-base">
                        {formatAnswerSlotLabel(index)}
                      </div>
                      <span
                        className="block flex-1 overflow-hidden break-words text-center text-base font-black leading-tight sm:text-[1.45rem]"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {answer}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <PracticeFeedbackCard
              copy={copy}
              feedback={feedback}
              answers={answers}
              error={error}
              onNext={handleNext}
              hasNext={currentIndex < questions.length - 1}
            />
          )}
        </div>
      </div>
    </div>
  );
}
