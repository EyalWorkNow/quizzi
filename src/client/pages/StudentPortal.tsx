import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
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
import AppLoadingScreen from '../components/AppLoadingScreen.tsx';
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

function formatRelativeTime(value?: string | null) {
  if (!value) return 'No activity yet';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const diffMinutes = Math.round((Date.now() - timestamp) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function StudentPortal() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyClassId, setBusyClassId] = useState<number | null>(null);

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
      classesBody: 'לכל כיתה יש עכשיו מרחב משלה: מצב אישור, pack, סשן חי ופעולות מהירות.',
      pendingInvites: 'הזמנות שממתינות לאישור',
      activeClasses: 'כיתות פעילות',
      openClass: 'פתח דף כיתה',
      reviewInvite: 'בדוק הזמנה',
      joinClass: 'הצטרף עכשיו',
      approveClass: 'אשר הצטרפות לכיתה',
      approving: 'מאשר...',
      practice: 'תרגול אדפטיבי',
      history: 'היסטוריה',
      signOut: 'התנתק',
      sessions: 'סשנים',
      practiceAttempts: 'נסיונות תרגול',
      accuracy: 'דיוק',
      activeDays: 'ימים פעילים',
      classLinked: 'משויך/ת לכיתה',
      waitingApproval: 'ממתין לאישור',
      classReady: 'מאושר',
      noClasses: 'עדיין אין כיתה משויכת לחשבון הזה.',
      noPendingClasses: 'אין כרגע הזמנות שממתינות לאישור.',
      noHistory: 'עדיין אין היסטוריית סשנים מספקת.',
      launchPractice: 'פתח תרגול ממוקד',
      latestSession: 'הסשן האחרון',
      continueLive: 'חזרה למשחק חי',
      home: 'עמוד הבית',
      pendingInviteBody: 'המורה כבר צירף אותך לכיתה. אשר/י את ההזמנה כדי לפתוח את דף הכיתה, ההתקדמות, והגישה לסשנים החיים שלה.',
      packMissing: 'עדיין אין חבילה לכיתה הזאת',
      studentsInClass: 'תלמידים בכיתה',
      pendingApprovals: 'ממתינים בכיתה',
      lastSeen: 'נראה לאחרונה',
      workspaceReady: 'סביבת כיתה פעילה',
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
      classesBody: 'لكل صف الآن مساحة خاصة به: حالة الموافقة، الحزمة، الجلسة الحية، والإجراءات السريعة.',
      pendingInvites: 'الدعوات بانتظار الموافقة',
      activeClasses: 'الصفوف النشطة',
      openClass: 'افتح صفحة الصف',
      reviewInvite: 'راجع الدعوة',
      joinClass: 'انضم الآن',
      approveClass: 'وافق على الصف',
      approving: 'جارٍ التأكيد...',
      practice: 'التدريب التكيفي',
      history: 'السجل',
      signOut: 'تسجيل الخروج',
      sessions: 'الجلسات',
      practiceAttempts: 'محاولات التدريب',
      accuracy: 'الدقة',
      activeDays: 'أيام النشاط',
      classLinked: 'مرتبط/ة بصف',
      waitingApproval: 'بانتظار الموافقة',
      classReady: 'مؤكد',
      noClasses: 'لا يوجد صف مرتبط بهذا الحساب بعد.',
      noPendingClasses: 'لا توجد دعوات صف بانتظار الموافقة الآن.',
      noHistory: 'لا يوجد سجل جلسات كافٍ بعد.',
      launchPractice: 'ابدأ تدريبًا مركزًا',
      latestSession: 'آخر جلسة',
      continueLive: 'العودة إلى اللعبة الحية',
      home: 'الصفحة الرئيسية',
      pendingInviteBody: 'المعلم أضافك بالفعل إلى هذا الصف. وافق على الدعوة لفتح صفحة الصف والتقدم والوصول إلى الجلسات الحية الخاصة به.',
      packMissing: 'لا توجد حزمة لهذا الصف بعد',
      studentsInClass: 'طلاب الصف',
      pendingApprovals: 'بانتظار الموافقة',
      lastSeen: 'آخر ظهور',
      workspaceReady: 'مساحة صف نشطة',
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
      classesBody: 'Each class now has its own workspace: approval state, pack, live room, and quick actions.',
      pendingInvites: 'Pending class invites',
      activeClasses: 'Active classes',
      openClass: 'Open class page',
      reviewInvite: 'Review invite',
      joinClass: 'Join now',
      approveClass: 'Approve class invite',
      approving: 'Approving...',
      practice: 'Adaptive practice',
      history: 'History',
      signOut: 'Sign out',
      sessions: 'Sessions',
      practiceAttempts: 'Practice attempts',
      accuracy: 'Accuracy',
      activeDays: 'Active days',
      classLinked: 'Class linked',
      waitingApproval: 'Waiting approval',
      classReady: 'Approved',
      noClasses: 'No class is linked to this account yet.',
      noPendingClasses: 'There are no pending class invites right now.',
      noHistory: 'There is not enough session history yet.',
      launchPractice: 'Open focused practice',
      latestSession: 'Latest session',
      continueLive: 'Return to live game',
      home: 'Home',
      pendingInviteBody: 'Your teacher already added you to this class. Approve the invite to unlock the class page, your progress view, and any live room attached to it.',
      packMissing: 'No pack is attached to this class yet',
      studentsInClass: 'Students in class',
      pendingApprovals: 'Pending in class',
      lastSeen: 'Last seen',
      workspaceReady: 'Active class workspace',
    },
  }[language];

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiFetchJson('/api/student/me');
      setData(payload);
    } catch (loadError: any) {
      setError(loadError?.message || copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError('');
        const payload = await apiFetchJson('/api/student/me');
        if (cancelled) return;
        setData(payload);
      } catch (loadError: any) {
        if (cancelled) return;
        setError(loadError?.message || copy.loadFailed);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [language, copy.loadFailed]);

  const summary = data?.student_memory?.summary || null;
  const historyRows = Array.isArray(data?.session_history) ? data.session_history : [];
  const focusTags = Array.isArray(data?.student_memory?.focus_tags) ? data.student_memory.focus_tags : [];
  const stats = data?.overall_analytics?.stats || {};
  const engagement = data?.overall_analytics?.engagement || {};
  const practicePath = useMemo(() => buildPracticePath(data), [data]);
  const classes = Array.isArray(data?.classes) ? data.classes : [];
  const pendingInvites = Array.isArray(data?.pending_classes)
    ? data.pending_classes
    : classes.filter((classRow: any) => String(classRow?.approval_state || classRow?.invite_status || 'none') !== 'claimed');
  const activeClasses = Array.isArray(data?.active_classes)
    ? data.active_classes
    : classes.filter((classRow: any) => String(classRow?.approval_state || classRow?.invite_status || 'none') === 'claimed');
  const hasLiveParticipant = Boolean(getParticipantToken());
  const liveSessionPin = typeof window !== 'undefined' ? window.localStorage.getItem('session_pin') || '' : '';
  const latestSessionPath =
    hasLiveParticipant && liveSessionPin ? `/student/session/${liveSessionPin}/play` : null;
  const isHistoryRoute = location.pathname.endsWith('/history');

  const handleSignOut = async () => {
    await signOutStudent();
    navigate('/student/auth', { replace: true });
  };

  const handleAcceptClass = async (classId: number) => {
    try {
      setBusyClassId(classId);
      await apiFetchJson(`/api/student/me/classes/${classId}/accept`, {
        method: 'POST',
      });
      await loadPortal();
    } catch (acceptError: any) {
      setError(acceptError?.message || copy.loadFailed);
    } finally {
      setBusyClassId(null);
    }
  };

  if (loading) {
    return (
      <AppLoadingScreen
        dir={language === 'he' ? 'rtl' : 'ltr'}
        label={copy.loading}
        caption={language === 'he' ? 'טוענים כיתות, הזמנות ותרגולים שמחכים לך.' : 'Loading your classes, invites, and ready-to-start practice.'}
      />
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
              <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-orange mb-3">{copy.classLinked} • {classes.length}</p>
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

        {pendingInvites.length > 0 ? (
          <section className="rounded-[2.2rem] border-4 border-brand-dark bg-brand-yellow p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/55">{copy.pendingInvites}</p>
                <h2 className="mt-2 text-2xl md:text-3xl font-black text-brand-dark">
                  {language === 'he'
                    ? `יש לך ${pendingInvites.length} כיתות שמחכות לאישור`
                    : language === 'ar'
                      ? `لديك ${pendingInvites.length} صفوف بانتظار الموافقة`
                      : `You have ${pendingInvites.length} classes waiting for approval`}
                </h2>
                <p className="mt-2 font-bold text-brand-dark/70">
                  {language === 'he'
                    ? 'אשר/י את ההזמנה כדי להעביר את הכיתה מיד לאזור הכיתות הפעילות שלך ולפתוח עבורך את ההתקדמות, התרגול והגישה לחדרים החיים שלה.'
                    : language === 'ar'
                      ? 'وافق على الدعوة لنقل الصف مباشرة إلى منطقة الصفوف النشطة لديك وفتح التقدم والتدريب والوصول إلى الغرف الحية.'
                      : 'Approve the invite to move the class straight into your active class area and unlock progress, practice, and live-room access.'}
                </p>
              </div>
              <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white px-5 py-4 text-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.waitingApproval}</p>
                <p className="mt-1 text-3xl font-black text-brand-dark">{pendingInvites.length}</p>
              </div>
            </div>
          </section>
        ) : null}

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
                <div>
                  <h2 className="text-3xl font-black">{copy.classes}</h2>
                  <p className="text-sm font-bold text-brand-dark/60">{copy.classesBody}</p>
                </div>
              </div>
              <div className="space-y-3">
                {pendingInvites.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{copy.pendingInvites}</p>
                    {pendingInvites.map((classRow: any) => (
                      <div key={`pending-${classRow.id}`} className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-yellow/50 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
                              {[classRow.class_subject, classRow.class_grade].filter(Boolean).join(' • ')}
                            </p>
                            <p className="mt-2 font-black text-xl text-brand-dark">{classRow.class_name || classRow.name}</p>
                          </div>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                            {copy.waitingApproval}
                          </span>
                        </div>
                        <div className="mt-4 rounded-[1.2rem] border-2 border-brand-dark bg-white/70 p-4">
                          <p className="text-sm font-black text-brand-dark">
                            {classRow.pack?.title || copy.packMissing}
                          </p>
                          <p className="mt-2 text-sm font-bold text-brand-dark/70">{copy.pendingInviteBody}</p>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                            {copy.pendingApprovals}: {Number(classRow.pending_approval_count || 0)}
                          </span>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                            {copy.studentsInClass}: {Number(classRow.student_count || 0)}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAcceptClass(Number(classRow.class_id || 0))}
                            disabled={busyClassId === Number(classRow.class_id || 0)}
                            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {busyClassId === Number(classRow.class_id || 0) ? copy.approving : copy.approveClass}
                          </button>
                          <Link
                            to={`/student/me/classes/${classRow.class_id}`}
                            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                          >
                            {copy.reviewInvite}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 font-medium text-brand-dark/70">
                    {copy.noPendingClasses}
                  </div>
                )}

                {activeClasses.length > 0 ? (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{copy.activeClasses}</p>
                    {activeClasses.map((classRow: any) => (
                      <div key={classRow.id} className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
                              {[classRow.class_subject, classRow.class_grade].filter(Boolean).join(' • ')}
                            </p>
                            <p className="mt-2 font-black text-xl text-brand-dark">{classRow.class_name || classRow.name}</p>
                          </div>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                            {copy.workspaceReady}
                          </span>
                        </div>
                        <div className="mt-4 rounded-[1.2rem] border-2 border-brand-dark bg-white p-4">
                          <p className="text-sm font-black text-brand-dark">
                            {classRow.pack?.title || copy.packMissing}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black">
                              {Number(classRow.stats?.session_count || 0)} {copy.sessions}
                            </span>
                            <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black">
                              {Math.round(Number(classRow.stats?.average_accuracy || 0))}% {copy.accuracy}
                            </span>
                            <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black">
                              {copy.studentsInClass}: {Number(classRow.student_count || 0)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-bold text-brand-dark/65">
                            {copy.lastSeen}: {formatRelativeTime(classRow.last_seen_at)}
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                            {copy.classReady}
                          </span>
                          {classRow.active_session?.pin ? (
                            <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                              {copy.joinClass}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            to={`/student/me/classes/${classRow.class_id}`}
                            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                          >
                            {copy.openClass}
                          </Link>
                          {classRow.active_session?.pin ? (
                            <Link
                              to={`/student/session/${classRow.active_session.pin}/play`}
                              className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black text-brand-dark"
                            >
                              {copy.joinClass}
                            </Link>
                          ) : null}
                          <Link
                            to={practicePath}
                            className="rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white"
                          >
                            {copy.launchPractice}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : pendingInvites.length === 0 ? (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 font-medium text-brand-dark/70">
                    {copy.noClasses}
                  </div>
                ) : null}
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
