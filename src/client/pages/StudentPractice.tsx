import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, XCircle, ArrowRight, BrainCircuit, RotateCcw, Sparkles, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiFetchJson } from '../lib/api.ts';
import QuestionImageCard from '../components/QuestionImageCard.tsx';
import { formatAnswerSlotLabel } from '../../shared/liveQuestionDensity.ts';
import {
  readPreferredAppLanguage,
  resolveAppLanguageDirection,
  useOptionalAppLanguage,
} from '../lib/appLanguage.tsx';

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

export default function StudentPractice() {
  const appLanguage = useOptionalAppLanguage();
  const language = appLanguage?.language || readPreferredAppLanguage();
  const direction = appLanguage?.direction || resolveAppLanguageDirection(language);
  const { nickname } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [questions, setQuestions] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<any>(null);
  const [mission, setMission] = useState<any>(null);
  const [memoryReason, setMemoryReason] = useState('');
  const [memoryReasons, setMemoryReasons] = useState<string[]>([]);
  const [memoryConfidence, setMemoryConfidence] = useState<any>(null);
  const [coaching, setCoaching] = useState<any>(null);
  const [memorySummary, setMemorySummary] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<'LOADING' | 'ACTIVE' | 'FEEDBACK' | 'DONE' | 'ERROR'>('LOADING');
  const [feedback, setFeedback] = useState<any>(null);
  const [startTime, setStartTime] = useState(0);
  const [error, setError] = useState('');
  const [practiceStats, setPracticeStats] = useState({ correct: 0, answered: 0 });
  const copy = {
    he: {
      adaptivePractice: 'תרגול אדפטיבי',
      reentryBody: 'סבב קצר שנועד לאפשר חזרה חלקה ובטוחה.',
      targetedBody: 'ספרינט ממוקד סביב המושגים שבהם תחושת הביטחון עדיין שברירית.',
      momentumBody: 'חיזוק קצר שנועד לשמר את ההתקדמות האחרונה.',
      defaultBody: 'תרגול אדפטיבי שנבנה מתוך פרופיל השליטה הנוכחי שלך.',
      loadFailed: 'טעינת סט התרגול האדפטיבי שלך נכשלה.',
      submitFailed: 'לא ניתן היה לשלוח את התשובה שלך. נסה שוב.',
      loadingPrefix: 'טוען',
      loadingSuffix: '...',
      notLoaded: 'התרגול לא נטען כראוי',
      interrupted: 'משהו קטע את רצף התרגול האדפטיבי.',
      retry: 'נסה שוב',
      backToDashboard: 'חזרה ללוח המחוונים',
      completeSuffix: 'הושלם',
      updated: 'ציוני השליטה שלך עודכנו ואות ההתקדמות שלך רוענן.',
      correct: 'נכונות',
      answered: 'נענו',
      accuracy: 'דיוק',
    },
    ar: {
      adaptivePractice: 'تدريب تكيّفي',
      reentryBody: 'جولة قصيرة لتسهيل العودة بثقة.',
      targetedBody: 'دفعة مركزة حول المفاهيم التي لا تزال الثقة فيها هشة.',
      momentumBody: 'دفعة سريعة للحفاظ على تقدمك الأخير.',
      defaultBody: 'تدريب تكيّفي مبني على ملف الإتقان الحالي لديك.',
      loadFailed: 'فشل تحميل مجموعة التدريب التكيّفي.',
      submitFailed: 'تعذر إرسال إجابتك. حاول مرة أخرى.',
      loadingPrefix: 'جارٍ تحميل',
      loadingSuffix: '...',
      notLoaded: 'لم يتم تحميل التدريب بشكل سليم',
      interrupted: 'حدث ما قطع مسار التدريب التكيّفي.',
      retry: 'أعد المحاولة',
      backToDashboard: 'العودة إلى لوحة المتابعة',
      completeSuffix: 'اكتمل',
      updated: 'تم تحديث درجات الإتقان لديك وتحديث مؤشر التقدم.',
      correct: 'صحيحة',
      answered: 'تمت الإجابة',
      accuracy: 'الدقة',
    },
    en: {
      adaptivePractice: 'Adaptive Practice',
      reentryBody: 'A short reset round built to make coming back easy.',
      targetedBody: 'A focused sprint aimed at the concepts where confidence is still fragile.',
      momentumBody: 'A quick booster to keep your recent gains warm.',
      defaultBody: 'Adaptive practice built from your current mastery profile.',
      loadFailed: 'Failed to load your adaptive practice set.',
      submitFailed: 'Your answer could not be submitted. Try again.',
      loadingPrefix: 'Loading',
      loadingSuffix: '...',
      notLoaded: 'Practice did not load cleanly',
      interrupted: 'Something interrupted the adaptive practice flow.',
      retry: 'Retry',
      backToDashboard: 'Back to Dashboard',
      completeSuffix: 'complete',
      updated: 'Your mastery scores have been updated and your progress signal has been refreshed.',
      correct: 'Correct',
      answered: 'Answered',
      accuracy: 'Accuracy',
    },
  }[language];
  const queryString = searchParams.toString();
  const isAccountMode = !nickname;
  const practicePath = isAccountMode
    ? (queryString ? `/api/student/me/practice?${queryString}` : '/api/student/me/practice')
    : (queryString ? `/api/practice/${nickname}?${queryString}` : `/api/practice/${nickname}`);
  const practiceAnswerPath = isAccountMode
    ? '/api/student/me/practice/answer'
    : `/api/practice/${nickname}/answer`;
  const dashboardPath = isAccountMode ? '/student/me' : `/student/dashboard/${nickname}`;
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
    [queryString, searchParams],
  );
  const missionTitle = mission?.label || fallbackMission.label || copy.adaptivePractice;
  const missionFocusTags = Array.isArray(mission?.focus_tags)
    ? mission.focus_tags
    : Array.isArray(fallbackMission.focus_tags)
      ? fallbackMission.focus_tags
      : [];
  const missionMode = String(mission?.id || fallbackMission.id || '');
  const missionBody =
    missionMode === 'reentry'
      ? copy.reentryBody
      : missionMode === 'targeted'
        ? copy.targetedBody
        : missionMode === 'momentum'
          ? copy.momentumBody
          : copy.defaultBody;

  useEffect(() => {
    let cancelled = false;
    setStatus('LOADING');
    setError('');
    apiFetchJson(practicePath)
      .then(data => {
        if (cancelled) return;
        setQuestions(data.questions || []);
        setStrategy(data.strategy || null);
        setMission(data.mission || fallbackMission);
        setMemoryReason(String(data.memory_reason || ''));
        setMemoryReasons(Array.isArray(data.memory_reasons) ? data.memory_reasons : []);
        setMemoryConfidence(data.memory_confidence || null);
        setCoaching(data.coaching || null);
        setMemorySummary(data.student_memory_summary || null);
        setStatus((data.questions || []).length > 0 ? 'ACTIVE' : 'DONE');
        setStartTime(Date.now());
      })
      .catch((loadError: any) => {
        if (cancelled) return;
        setError(loadError?.message || copy.loadFailed);
        setStatus('ERROR');
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackMission, practicePath, queryString]);

  const handleAnswer = async (index: number) => {
    if (status !== 'ACTIVE') return;
    
    const responseMs = Date.now() - startTime;
    const question = questions[currentIndex];
    setError('');
    
    try {
      const data = await apiFetchJson(practiceAnswerPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          chosen_index: index,
          response_ms: responseMs
        })
      });
      setFeedback({ ...data, chosen_index: index });
      setPracticeStats((current) => ({
        correct: current.correct + (data?.is_correct ? 1 : 0),
        answered: current.answered + 1,
      }));
      setStatus('FEEDBACK');
    } catch (err) {
      console.error(err);
      setError(copy.submitFailed);
    }
  };

  const handleNext = () => {
    setError('');
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setStatus('ACTIVE');
      setFeedback(null);
      setStartTime(Date.now());
    } else {
      setStatus('DONE');
    }
  };

  if (status === 'LOADING') {
    return (
      <div dir={direction} className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1bf,_#fff_45%,_#fff7e8_100%)] px-4 py-8 md:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center">
          <div className="w-full max-w-2xl rounded-[3rem] border-4 border-brand-dark bg-white p-8 shadow-[12px_12px_0px_0px_#1A1A1A] md:p-12">
            <div className="mb-8 flex items-center justify-between gap-4">
              <div className="rounded-[2rem] border-4 border-brand-dark bg-brand-yellow px-5 py-3 text-sm font-black uppercase tracking-[0.24em] text-brand-dark">
                Adaptive Practice
              </div>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}>
                <div className="flex h-20 w-20 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-orange shadow-[6px_6px_0px_0px_#1A1A1A]">
                  <BrainCircuit className="h-10 w-10 text-white" />
                </div>
              </motion.div>
            </div>
            <h2 className="mb-4 text-4xl font-black text-brand-dark md:text-5xl">{`${copy.loadingPrefix} ${missionTitle}${copy.loadingSuffix}`}</h2>
            <p className="text-lg font-bold leading-8 text-slate-600">{missionBody}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ERROR') {
    return (
      <div dir={direction} className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[2.6rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[10px_10px_0px_0px_#1A1A1A]">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-yellow">
            <AlertTriangle className="w-10 h-10 text-brand-dark" />
          </div>
          <h2 className="text-4xl font-black text-slate-900 mb-3">{copy.notLoaded}</h2>
          <p className="text-lg font-bold text-slate-600 mb-8">{error || copy.interrupted}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-4 rounded-2xl border-2 border-brand-dark bg-brand-dark text-white font-black flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_#FF5A36]"
            >
              <RotateCcw className="w-4 h-4" />
              {copy.retry}
            </button>
            <button
              onClick={() => navigate(dashboardPath)}
              className="px-6 py-4 rounded-2xl border-2 border-brand-dark bg-white font-black"
            >
              {copy.backToDashboard}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'DONE') {
    const accuracy = practiceStats.answered > 0 ? Math.round((practiceStats.correct / practiceStats.answered) * 100) : 0;
    return (
      <div dir={direction} className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff0c7,_#ffffff_45%,_#ffe8f1_100%)] px-4 py-8 md:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.32 }}
            className="w-full max-w-3xl rounded-[3rem] border-4 border-brand-dark bg-white p-8 shadow-[14px_14px_0px_0px_#1A1A1A] md:p-12"
          >
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-4 inline-flex items-center gap-3 rounded-full border-4 border-brand-dark bg-brand-yellow px-5 py-3 text-sm font-black uppercase tracking-[0.22em] text-brand-dark">
                  <Sparkles className="h-5 w-5" />
                  Practice Complete
                </div>
                <h2 className="mb-3 text-4xl font-black leading-tight text-brand-dark md:text-6xl">{`${missionTitle} ${copy.completeSuffix}`}</h2>
                <p className="max-w-2xl text-lg font-bold leading-8 text-slate-600">{copy.updated}</p>
              </div>
              <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-mint shadow-[6px_6px_0px_0px_#1A1A1A]">
                <CheckCircle className="h-12 w-12 text-brand-dark" />
              </div>
            </div>

            <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-[2rem] border-4 border-brand-dark bg-[#fff8df] p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">{copy.correct}</p>
                <p className="text-4xl font-black text-brand-dark">{practiceStats.correct}</p>
              </div>
              <div className="rounded-[2rem] border-4 border-brand-dark bg-[#eef7ff] p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">{copy.answered}</p>
                <p className="text-4xl font-black text-brand-dark">{practiceStats.answered}</p>
              </div>
              <div className="rounded-[2rem] border-4 border-brand-dark bg-[#f8edff] p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">{copy.accuracy}</p>
                <p className="text-4xl font-black text-brand-dark">{accuracy}%</p>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(dashboardPath)}
              className="flex w-full items-center justify-center gap-3 rounded-[2rem] border-4 border-brand-dark bg-brand-dark px-8 py-5 text-2xl font-black text-white shadow-[8px_8px_0px_0px_#FF5A36] transition-all hover:translate-y-[2px] hover:shadow-[6px_6px_0px_0px_#FF5A36]"
            >
              {copy.backToDashboard}
              <ArrowRight className="h-6 w-6" />
            </motion.button>
          </motion.div>
        </div>
      </div>
    );
  }

  const question = questions[currentIndex];
  const progressPct = questions.length > 0 ? ((currentIndex + (status === 'FEEDBACK' ? 1 : 0)) / questions.length) * 100 : 0;
  const safeTags = (() => {
    try {
      return Array.isArray(question?.tags) ? question.tags : JSON.parse(question?.tags_json || '[]');
    } catch {
      return [];
    }
  })();

  return (
    <div dir={direction} className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1bf,_#fff_38%,_#fff8ef_100%)] p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <div className="mb-6 flex flex-col gap-4 rounded-[2.5rem] border-4 border-brand-dark bg-white p-5 shadow-[10px_10px_0px_0px_#1A1A1A] md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if(window.confirm('Are you sure you want to end practice early?')) {
                  navigate(dashboardPath);
                }
              }}
              className="rounded-full border-4 border-brand-dark bg-white p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
              title="Exit Practice"
            >
              <XCircle className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-3 text-xl font-black text-brand-dark md:text-2xl">
              <div className="rounded-[1.35rem] border-4 border-brand-dark bg-brand-yellow p-2.5 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <BrainCircuit className="h-6 w-6" />
              </div>
              {missionTitle}
            </div>
          </div>
          <div className="inline-flex items-center rounded-full border-4 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-brand-dark/70 md:text-base">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        <div className="mb-6 rounded-[2rem] border-4 border-brand-dark bg-white p-4 shadow-[8px_8px_0px_0px_#1A1A1A]">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Progress Signal</span>
            <span className="text-lg font-black text-brand-dark">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-6 overflow-hidden rounded-full border-4 border-brand-dark bg-[#fff7de] p-1">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#FFCF33_0%,#FF8A00_45%,#FF5A36_100%)] transition-all"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="rounded-[2.5rem] border-4 border-brand-dark bg-white p-6 shadow-[10px_10px_0px_0px_#1A1A1A]">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.24em] text-brand-orange">Mission Context</p>
            <h3 className="mb-3 text-3xl font-black text-brand-dark">{missionTitle}</h3>
            <p className="mb-5 text-lg font-bold leading-8 text-slate-600">{missionBody}</p>
          {(memoryReason || memoryReasons.length > 0 || memoryConfidence) && (
            <div className="mb-4 rounded-[2rem] border-4 border-brand-dark bg-[#f5edff] p-4 shadow-[6px_6px_0px_0px_#1A1A1A]">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-purple">Why this set</p>
              {memoryReason && <p className="text-slate-700 font-semibold mb-3">{memoryReason}</p>}
              {memoryReasons.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {memoryReasons.map((reason: string) => (
                    <span key={reason} className="rounded-xl border-2 border-brand-dark bg-white px-3 py-2 text-sm font-bold text-slate-600">
                      {reason}
                    </span>
                  ))}
                </div>
              )}
              {memoryConfidence && (
                <p className="text-sm font-bold text-slate-500">
                  Memory trust: {String(memoryConfidence.confidence_band || 'low')} confidence from {Number(memoryConfidence.evidence_count || 0)} signals.
                </p>
              )}
            </div>
          )}
          {missionFocusTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {missionFocusTags.map((tag: string) => (
                <span key={`mission-${tag}`} className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black capitalize text-brand-dark/75">
                  {tag}
                </span>
              ))}
            </div>
          )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {strategy && (
              <div className="rounded-[2.3rem] border-4 border-brand-dark bg-[#eef7ff] p-5 shadow-[8px_8px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[#2f67ff]">Practice Strategy</p>
                <h3 className="mb-2 text-2xl font-black text-brand-dark">{strategy.headline}</h3>
                <p className="text-base font-bold leading-7 text-slate-600">{strategy.body}</p>
              </div>
            )}

            {coaching && (
              <div className="rounded-[2.3rem] border-4 border-brand-dark bg-[#e8fff4] p-5 shadow-[8px_8px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-600">Coach Note</p>
                <p className="mb-2 text-xl font-black text-brand-dark">{coaching.student_message}</p>
                <p className="text-sm font-bold leading-6 text-slate-600">{coaching.celebration}</p>
              </div>
            )}
            {memorySummary && (
              <div className="rounded-[2.3rem] border-4 border-brand-dark bg-[#fff8df] p-5 shadow-[8px_8px_0px_0px_#1A1A1A]">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">Memory Snapshot</p>
                <p className="mb-2 text-xl font-black text-brand-dark">{memorySummary.headline}</p>
                <p className="text-sm font-bold leading-6 text-slate-600">{memorySummary.body}</p>
              </div>
            )}
          </div>
        </div>

        <motion.div 
          key={`q-${currentIndex}`}
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="relative mb-8 flex flex-1 flex-col justify-center overflow-hidden rounded-[3rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[12px_12px_0px_0px_#1A1A1A] md:p-10"
        >
          <div className="absolute right-0 top-0 -z-10 h-40 w-40 rounded-bl-full bg-[#fff1bf]"></div>
          <div className="mx-auto mb-5 inline-flex items-center gap-3 rounded-full border-4 border-brand-dark bg-brand-bg px-4 py-2 shadow-[4px_4px_0px_0px_#1A1A1A]">
            <Target className="w-4 h-4 text-brand-orange" />
            <span className="text-sm font-black uppercase tracking-[0.16em] text-brand-dark/70">Adaptive target</span>
          </div>
          <QuestionImageCard
            imageUrl={question?.image_url}
            alt={question?.prompt || 'Practice question image'}
            className="w-full max-w-2xl mx-auto mb-6"
            imgClassName="max-h-[260px]"
          />
          <h2 className="mb-6 text-4xl font-black leading-tight text-brand-dark md:text-5xl">{question?.prompt}</h2>
          {safeTags.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {safeTags.map((tag: string, i: number) => (
                <span key={i} className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black capitalize text-slate-600">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </motion.div>
        
        {status === 'ACTIVE' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {question?.answers?.map((ans: string, i: number) => (
              <motion.button
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                key={i}
                onClick={() => handleAnswer(i)}
                style={buildPracticeAnswerToneStyle(i)}
                className="student-answer-button student-play-answer-tile group relative flex min-h-[140px] items-center px-6 py-5 text-left sm:px-8"
              >
                <div className="mr-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white/40 text-lg font-black text-brand-dark/30 transition-colors">
                  {formatAnswerSlotLabel(i)}
                </div>
                <span className="block flex-1 break-words text-2xl font-black leading-tight sm:text-3xl">
                  {ans}
                </span>
              </motion.button>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="rounded-[3rem] border-4 border-brand-dark bg-white p-8 shadow-[12px_12px_0px_0px_#1A1A1A] md:p-10"
          >
            <div className={`flex items-center gap-4 mb-8 ${feedback?.is_correct ? 'text-emerald-500' : 'text-rose-500'}`}>
              {feedback?.is_correct ? <CheckCircle className="w-12 h-12" /> : <XCircle className="w-12 h-12" />}
              <h3 className="text-4xl font-black tracking-tight">
                {feedback?.is_correct ? 'Correct!' : 'Not quite.'}
              </h3>
            </div>

            {error && (
              <div className="mb-6 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-left font-bold text-rose-700">
                {error}
              </div>
            )}
            
            <div className="space-y-4 mb-10">
              {question?.answers?.map((ans: string, i: number) => {
                const isCorrect = i === feedback?.correct_index;
                const isChosen = i === feedback?.chosen_index;
                let borderClass = 'border-slate-200 bg-slate-50 text-slate-400';
                if (isCorrect) borderClass = 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold shadow-sm';
                else if (isChosen && !isCorrect) borderClass = 'border-rose-500 bg-rose-50 text-rose-800 font-bold';
                
                return (
                  <div key={i} className={`rounded-[1.6rem] border-4 p-5 text-xl flex items-center justify-between ${borderClass}`}>
                    <span>{ans}</span>
                    {isCorrect && <CheckCircle className="w-8 h-8 text-emerald-500" />}
                    {isChosen && !isCorrect && <XCircle className="w-8 h-8 text-rose-500" />}
                  </div>
                );
              })}
            </div>

            <div className="relative mb-10 overflow-hidden rounded-[2.3rem] border-4 border-brand-dark bg-[#eef7ff] p-8 shadow-[6px_6px_0px_0px_#1A1A1A]">
              <div className="absolute left-0 top-0 h-full w-3 bg-[#2f67ff]"></div>
              <h4 className="mb-3 flex items-center gap-2 text-xl font-black text-[#1d3d9e]">
                <Sparkles className="h-5 w-5 text-[#2f67ff]" />
                Explanation
              </h4>
              <p className="text-lg font-bold leading-relaxed text-slate-700">{feedback?.explanation}</p>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleNext}
              className="flex w-full items-center justify-center gap-3 rounded-[2rem] border-4 border-brand-dark bg-brand-dark px-8 py-5 text-2xl font-black text-white shadow-[8px_8px_0px_0px_#FF5A36] transition-all hover:translate-y-[2px] hover:shadow-[6px_6px_0px_0px_#FF5A36] active:translate-y-1"
            >
              {currentIndex < questions.length - 1 ? 'Next Question' : 'Finish Practice'}
              <ArrowRight className="w-6 h-6" />
            </motion.button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
