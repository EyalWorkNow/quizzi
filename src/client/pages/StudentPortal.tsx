import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  GraduationCap,
  History,
  LogOut,
  Rocket,
  Sparkles,
  Target,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetchJson } from '../lib/api.ts';
import { signOutStudent } from '../lib/studentAuth.ts';
import { getParticipantToken } from '../lib/studentSession.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';

function buildPracticePath(payload: any) {
  const query = payload?.practice_defaults || payload?.recommendations?.comeback_mission?.practice_query || null;
  if (!query) return '/student/me/practice';
  const params = new URLSearchParams();
  if (Number(query.count || query.question_count || 0) > 0) {
    params.set('count', String(Number(query.count || query.question_count || 0)));
  }
  if (Array.isArray(query.focus_tags) && query.focus_tags.length > 0) {
    params.set('focus_tags', query.focus_tags.join(','));
  }
  if (query.mission) params.set('mission', String(query.mission));
  if (query.mission_label) params.set('mission_label', String(query.mission_label));
  const suffix = params.toString();
  return suffix ? `/student/me/practice?${suffix}` : '/student/me/practice';
}

export default function StudentPortal() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const copy = {
    he: {
      loading: 'טוען את סביבת התלמיד...',
      loadFailed: 'טעינת סביבת התלמיד נכשלה.',
      retry: 'נסה שוב',
      title: 'סביבת התלמיד',
      subtitle: 'כל ההתקדמות, הסשנים והתרגול האדפטיבי במקום אחד.',
      overview: 'סקירה',
      nextMove: 'המהלך הבא שלך',
      focusAreas: 'אזורי מיקוד',
      recentHistory: 'היסטוריית סשנים',
      classes: 'כיתות משויכות',
      practice: 'תרגול אדפטיבי',
      history: 'היסטוריה',
      signOut: 'התנתק',
      sessions: 'סשנים',
      practiceAttempts: 'נסיונות תרגול',
      accuracy: 'דיוק',
      activeDays: 'ימים פעילים',
      classLinked: 'משויך/ת לכיתה',
      noClasses: 'עדיין אין כיתה משויכת לחשבון הזה.',
      noHistory: 'עדיין אין היסטוריית סשנים מספקת.',
      launchPractice: 'פתח תרגול ממוקד',
      latestSession: 'הסשן האחרון',
      continueLive: 'חזרה למשחק חי',
      home: 'עמוד הבית',
    },
    ar: {
      loading: 'جارٍ تحميل مساحة الطالب...',
      loadFailed: 'فشل تحميل مساحة الطالب.',
      retry: 'أعد المحاولة',
      title: 'مساحة الطالب',
      subtitle: 'كل التقدم والجلسات والتدريب التكيفي في مكان واحد.',
      overview: 'نظرة عامة',
      nextMove: 'الخطوة التالية',
      focusAreas: 'مناطق التركيز',
      recentHistory: 'سجل الجلسات',
      classes: 'الصفوف المرتبطة',
      practice: 'التدريب التكيفي',
      history: 'السجل',
      signOut: 'تسجيل الخروج',
      sessions: 'الجلسات',
      practiceAttempts: 'محاولات التدريب',
      accuracy: 'الدقة',
      activeDays: 'أيام النشاط',
      classLinked: 'مرتبط/ة بصف',
      noClasses: 'لا يوجد صف مرتبط بهذا الحساب بعد.',
      noHistory: 'لا يوجد سجل جلسات كافٍ بعد.',
      launchPractice: 'ابدأ تدريبًا مركزًا',
      latestSession: 'آخر جلسة',
      continueLive: 'العودة إلى اللعبة الحية',
      home: 'الصفحة الرئيسية',
    },
    en: {
      loading: 'Loading your student space...',
      loadFailed: 'Failed to load student space.',
      retry: 'Retry',
      title: 'Student Space',
      subtitle: 'All your progress, sessions, and adaptive practice in one place.',
      overview: 'Overview',
      nextMove: 'Your next move',
      focusAreas: 'Focus areas',
      recentHistory: 'Recent session history',
      classes: 'Linked classes',
      practice: 'Adaptive practice',
      history: 'History',
      signOut: 'Sign out',
      sessions: 'Sessions',
      practiceAttempts: 'Practice attempts',
      accuracy: 'Accuracy',
      activeDays: 'Active days',
      classLinked: 'Class linked',
      noClasses: 'No class is linked to this account yet.',
      noHistory: 'There is not enough session history yet.',
      launchPractice: 'Open focused practice',
      latestSession: 'Latest session',
      continueLive: 'Return to live game',
      home: 'Home',
    },
  }[language];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    apiFetchJson('/api/student/me')
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
      })
      .catch((loadError: any) => {
        if (cancelled) return;
        setError(loadError?.message || copy.loadFailed);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  const summary = data?.student_memory?.summary || null;
  const historyRows = Array.isArray(data?.session_history) ? data.session_history : [];
  const focusTags = Array.isArray(data?.student_memory?.focus_tags) ? data.student_memory.focus_tags : [];
  const stats = data?.overall_analytics?.stats || {};
  const engagement = data?.overall_analytics?.engagement || {};
  const practicePath = useMemo(() => buildPracticePath(data), [data]);
  const hasLiveParticipant = Boolean(getParticipantToken());
  const liveSessionPin = typeof window !== 'undefined' ? window.localStorage.getItem('session_pin') || '' : '';
  const latestSessionPath =
    hasLiveParticipant && liveSessionPin ? `/student/session/${liveSessionPin}/play` : null;
  const isHistoryRoute = location.pathname.endsWith('/history');

  const handleSignOut = async () => {
    await signOutStudent();
    navigate('/student/auth', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center text-brand-dark">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">{copy.loading}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="max-w-xl rounded-[2.4rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[10px_10px_0px_0px_#1A1A1A]">
          <p className="text-3xl font-black text-brand-dark mb-3">{copy.loadFailed}</p>
          <p className="font-bold text-brand-dark/65 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border-2 border-brand-dark bg-brand-dark px-6 py-3 text-white font-black"
          >
            {copy.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#F9F4EC_42%,_#EEF4FB_100%)] px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black">
              {copy.home}
            </Link>
            <Link to="/student/me" className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${!isHistoryRoute ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}>
              {copy.overview}
            </Link>
            <Link to="/student/me/history" className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${isHistoryRoute ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}>
              {copy.history}
            </Link>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black text-brand-dark"
          >
            <LogOut className="w-4 h-4" />
            {copy.signOut}
          </button>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2.8rem] border-4 border-brand-dark bg-white p-8 shadow-[10px_10px_0px_0px_#1A1A1A]"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-orange mb-3">{copy.classLinked} • {data.classes.length}</p>
              <h1 className="text-4xl md:text-5xl font-black text-brand-dark">{data.student.display_name}</h1>
              <p className="mt-3 text-lg font-bold text-brand-dark/65">{copy.subtitle}</p>
              {summary ? (
                <div className="mt-6 rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{copy.nextMove}</p>
                  <p className="text-2xl font-black text-brand-dark">{summary.headline}</p>
                  <p className="mt-2 font-medium text-brand-dark/70">{summary.body}</p>
                </div>
              ) : null}
            </div>

            <div className="w-full max-w-md space-y-4">
              <div className="rounded-[1.9rem] border-2 border-brand-dark bg-brand-dark p-5 text-white shadow-[6px_6px_0px_0px_#FF5A36]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{copy.practice}</p>
                    <p className="text-2xl font-black">{data.recommendations?.next_step?.title || data.recommendations?.comeback_mission?.headline || copy.launchPractice}</p>
                  </div>
                  <Rocket className="w-6 h-6 text-brand-yellow" />
                </div>
                <p className="mt-3 font-medium text-white/75">{data.recommendations?.next_step?.body || data.recommendations?.comeback_mission?.body || ''}</p>
                <Link
                  to={practicePath}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark"
                >
                  {copy.launchPractice}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {latestSessionPath ? (
                <Link
                  to={latestSessionPath}
                  className="block rounded-[1.7rem] border-2 border-brand-dark bg-brand-yellow p-5 text-brand-dark shadow-[5px_5px_0px_0px_#1A1A1A]"
                >
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/55 mb-2">{copy.latestSession}</p>
                  <p className="text-xl font-black">{data.latest_session?.pack_title || copy.continueLive}</p>
                  <p className="mt-2 font-medium text-brand-dark/70">{copy.continueLive}</p>
                </Link>
              ) : null}
            </div>
          </div>
        </motion.section>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: copy.accuracy, value: `${Math.round(Number(stats?.accuracy || 0))}%`, icon: Target },
                { label: copy.sessions, value: `${Number(data?.student_memory?.history_rollup?.sessions_played || historyRows.length || 0)}`, icon: History },
                { label: copy.practiceAttempts, value: `${Number(data?.student_memory?.history_rollup?.practice_attempts || 0)}`, icon: BrainCircuit },
                { label: copy.activeDays, value: `${Number(engagement?.active_days_7d || 0)}`, icon: CalendarClock },
              ].map((card) => (
                <div key={card.label} className="rounded-[1.8rem] border-4 border-brand-dark bg-white p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-dark/45">{card.label}</p>
                    <card.icon className="w-5 h-5 text-brand-orange" />
                  </div>
                  <p className="mt-4 text-4xl font-black text-brand-dark">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="flex items-center gap-3 mb-5">
                <Sparkles className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.focusAreas}</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {focusTags.length > 0 ? focusTags.map((tag: any) => (
                  <div key={tag.tag} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black text-lg">{String(tag.tag || '')}</p>
                      <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                        {String(tag.status || 'watch')}
                      </span>
                    </div>
                    <p className="mt-3 text-3xl font-black text-brand-dark">{Math.round(Number(tag.mastery_score || 0))}%</p>
                  </div>
                )) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 font-medium text-brand-dark/70">
                    {copy.noHistory}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="flex items-center gap-3 mb-5">
                <History className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.recentHistory}</h2>
              </div>
              <div className="space-y-3">
                {historyRows.length > 0 ? historyRows.slice(0, isHistoryRoute ? 20 : 8).map((row: any, index: number) => (
                  <div key={`${row.session_id}-${index}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-lg">{row.pack_title || `Session #${row.session_id}`}</p>
                        <p className="font-medium text-brand-dark/65">{row.started_at || row.joined_at || ''}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                          {Math.round(Number(row.accuracy_pct || row.accuracy || 0))}% {copy.accuracy}
                        </span>
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                          #{row.session_id}
                        </span>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 font-medium text-brand-dark/70">
                    {copy.noHistory}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="flex items-center gap-3 mb-5">
                <GraduationCap className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.classes}</h2>
              </div>
              <div className="space-y-3">
                {data.classes.length > 0 ? data.classes.map((classRow: any) => (
                  <div key={classRow.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="font-black text-lg">{classRow.class_name || classRow.name}</p>
                    <p className="font-medium text-brand-dark/65">{[classRow.class_subject, classRow.class_grade].filter(Boolean).join(' • ')}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                        {classRow.invite_status}
                      </span>
                      {classRow.email ? (
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                          {classRow.email}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 font-medium text-brand-dark/70">
                    {copy.noClasses}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-brand-dark p-6 text-white shadow-[8px_8px_0px_0px_#FF5A36]">
              <div className="flex items-center gap-3 mb-4">
                <BookOpen className="w-6 h-6 text-brand-yellow" />
                <h2 className="text-2xl font-black">{data.recommendations?.next_step?.title || copy.nextMove}</h2>
              </div>
              <p className="font-medium text-white/75">{data.recommendations?.next_step?.body || summary?.body || ''}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(data.recommendations?.weak_tags || []).slice(0, 4).map((tag: string) => (
                  <span key={tag} className="rounded-full border-2 border-white/25 bg-white/10 px-3 py-1 text-xs font-black">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
