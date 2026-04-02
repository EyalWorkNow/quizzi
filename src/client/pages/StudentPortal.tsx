import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Flame,
  GraduationCap,
  History,
  LogOut,
  ShieldCheck,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetchJson } from '../lib/api.ts';
import { signOutStudent } from '../lib/studentAuth.ts';
import { getParticipantToken } from '../lib/studentSession.ts';
import { enterLinkedStudentLiveSession, hasStoredLiveSeatForPin } from '../lib/studentLiveSession.ts';
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
  const context = payload?.recommendations?.active_assignment_context || null;
  const classId = Number(query.class_id || context?.class_id || 0);
  const assignmentId = Number(query.assignment_id || context?.assignment_id || 0);
  if (classId > 0) params.set('class_id', String(classId));
  if (assignmentId > 0) params.set('assignment_id', String(assignmentId));
  const suffix = params.toString();
  return suffix ? `/student/me/practice?${suffix}` : '/student/me/practice';
}

function buildClassPracticePath(classRow: any, fallbackPath: string) {
  const classId = Number(classRow?.class_id || classRow?.id || 0);
  if (!classId) return fallbackPath;
  const params = new URLSearchParams();
  params.set('class_id', String(classId));
  if (classRow?.class_name || classRow?.name) {
    params.set('mission_label', String(classRow.class_name || classRow.name));
  }
  return `/student/me/practice?${params.toString()}`;
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

function StudentPortalMetricCard({
  label,
  value,
  helper,
  Icon,
}: {
  label: string;
  value: string;
  helper?: string;
  Icon: any;
}) {
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white px-4 py-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{label}</p>
        <Icon className="h-4 w-4 text-brand-orange" />
      </div>
      <p className="mt-3 text-3xl font-black text-brand-dark">{value}</p>
      {helper ? <p className="mt-2 text-sm font-bold text-brand-dark/55">{helper}</p> : null}
    </div>
  );
}

function StudentPortalDisclosureCard({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  badge,
  defaultOpen = false,
  preview,
  children,
  tone = 'white',
}: {
  icon: any;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  preview?: ReactNode;
  children: ReactNode;
  tone?: 'white' | 'warm' | 'soft' | 'dark';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toneClasses =
    tone === 'warm'
      ? 'bg-[#fff8df]'
      : tone === 'soft'
        ? 'bg-[#f5f7ff]'
        : tone === 'dark'
          ? 'bg-brand-dark text-white shadow-[7px_7px_0px_0px_#FF5A36]'
          : 'bg-white';
  const iconClasses =
    tone === 'warm'
      ? 'bg-brand-yellow text-brand-dark'
      : tone === 'soft'
        ? 'bg-[#e8ecff] text-brand-purple'
        : tone === 'dark'
          ? 'bg-white/10 text-brand-yellow'
          : 'bg-brand-bg text-brand-orange';
  const secondaryTextClass = tone === 'dark' ? 'text-white/72' : 'text-brand-dark/60';
  const badgeClasses = tone === 'dark' ? 'bg-white/10 text-white border-white/15' : 'bg-white text-brand-dark border-brand-dark';

  return (
    <section className={`rounded-[1.9rem] border-4 border-brand-dark p-5 shadow-[7px_7px_0px_0px_#1A1A1A] ${toneClasses}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-start justify-between gap-4 text-left">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border-2 border-brand-dark ${iconClasses}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            {eyebrow ? <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${secondaryTextClass}`}>{eyebrow}</p> : null}
            <h2 className="mt-1 text-2xl font-black text-current">{title}</h2>
            {subtitle ? <p className={`mt-1 text-sm font-bold ${secondaryTextClass}`}>{subtitle}</p> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {badge ? <span className={`rounded-full border-2 px-3 py-1 text-[11px] font-black uppercase ${badgeClasses}`}>{badge}</span> : null}
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full border-2 ${tone === 'dark' ? 'border-white/15 bg-white/10 text-white' : 'border-brand-dark bg-white text-brand-dark'}`}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </div>
      </button>

      {preview ? <div className="mt-4">{preview}</div> : null}
      {open ? <div className="mt-4 border-t-2 border-brand-dark/15 pt-4">{children}</div> : null}
    </section>
  );
}

function StudentClassOverviewCard({
  classRow,
  copy,
  language,
  isPending,
  practicePath,
  liveEntryClassId,
  liveEntryError,
  busyClassId,
  onAcceptClass,
  onEnterLiveClass,
  describeLiveClassCta,
}: {
  classRow: any;
  copy: any;
  language: string;
  isPending: boolean;
  practicePath: string;
  liveEntryClassId: number | null;
  liveEntryError: { classId: number | null; message: string };
  busyClassId: number | null;
  onAcceptClass: (classId: number) => void;
  onEnterLiveClass: (classRow: any) => void;
  describeLiveClassCta: (classRow: any) => { buttonLabel: string; badgeLabel: string; helperText: string; disabled: boolean };
}) {
  const [open, setOpen] = useState(false);
  const liveCta = describeLiveClassCta(classRow);
  const classId = Number(classRow?.class_id || 0);
  const title = classRow.class_name || classRow.name;
  const metaLine = [classRow.class_subject, classRow.class_grade].filter(Boolean).join(' • ');
  const packTitle = classRow.pack?.title || copy.packMissing;
  const statusLabel = isPending ? copy.waitingApproval : copy.workspaceReady;
  const summaryChips = isPending
    ? [`${copy.pendingApprovals}: ${Number(classRow.pending_approval_count || 0)}`, `${copy.studentsInClass}: ${Number(classRow.student_count || 0)}`]
    : [`${Number(classRow.stats?.session_count || 0)} ${copy.sessions}`, `${Math.round(Number(classRow.stats?.average_accuracy || 0))}% ${copy.accuracy}`];
  const classPracticePath = buildClassPracticePath(classRow, practicePath);

  return (
    <div className={`rounded-[1.6rem] border-2 border-brand-dark p-4 ${isPending ? 'bg-[#fff4cf]' : 'bg-brand-bg'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {metaLine ? <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{metaLine}</p> : null}
          <p className="mt-1 text-xl font-black text-brand-dark">{title}</p>
          <p className="mt-2 text-sm font-bold text-brand-dark/65">{packTitle}</p>
        </div>
        <span className="shrink-0 rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-[11px] font-black uppercase text-brand-dark">
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {summaryChips.map((chip) => (
          <span key={`${title}-${chip}`} className="rounded-full border border-brand-dark bg-white px-3 py-1 text-xs font-black text-brand-dark/80">
            {chip}
          </span>
        ))}
        {classRow.active_session?.pin && liveCta.badgeLabel ? (
          <span className="rounded-full border border-brand-dark bg-white px-3 py-1 text-xs font-black text-brand-dark/80">{liveCta.badgeLabel}</span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {isPending ? (
          <button
            type="button"
            onClick={() => onAcceptClass(classId)}
            disabled={busyClassId === classId}
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {busyClassId === classId ? copy.approving : copy.approveClass}
          </button>
        ) : (
          <Link to={`/student/me/classes/${classId}`} className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black text-brand-dark">
            {copy.openClass}
          </Link>
        )}

        {classRow.active_session?.pin ? (
          <button
            type="button"
            onClick={() => onEnterLiveClass(classRow)}
            disabled={liveEntryClassId === classId || liveCta.disabled}
            className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black text-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {liveEntryClassId === classId ? copy.approving : liveCta.buttonLabel}
          </button>
        ) : null}

        {!isPending ? (
          <Link to={classPracticePath} className="rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white">
            {copy.launchPractice}
          </Link>
        ) : (
          <Link to={`/student/me/classes/${classId}`} className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black text-brand-dark">
            {copy.reviewInvite}
          </Link>
        )}

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black text-brand-dark"
        >
          {language === 'he' ? (open ? 'פחות פרטים' : 'עוד פרטים') : language === 'ar' ? (open ? 'تفاصيل أقل' : 'مزيد من التفاصيل') : open ? 'Less details' : 'More details'}
        </button>
      </div>

      {open ? (
        <div className="mt-4 rounded-[1.2rem] border-2 border-brand-dark bg-white/80 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1rem] border border-brand-dark bg-white px-3 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{copy.studentsInClass}</p>
              <p className="mt-2 text-2xl font-black text-brand-dark">{Number(classRow.student_count || 0)}</p>
            </div>
            <div className="rounded-[1rem] border border-brand-dark bg-white px-3 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{copy.lastSeen}</p>
              <p className="mt-2 text-base font-black text-brand-dark">{formatRelativeTime(classRow.last_seen_at)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm font-bold text-brand-dark/70">{isPending ? copy.pendingInviteBody : liveCta.helperText || copy.classesBody}</p>
          {liveEntryError.classId === classId && liveEntryError.message ? (
            <p className="mt-3 rounded-[1rem] border-2 border-brand-dark bg-white px-4 py-3 text-sm font-bold text-brand-dark/80">
              {liveEntryError.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function StudentPortal() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyClassId, setBusyClassId] = useState<number | null>(null);
  const [liveEntryClassId, setLiveEntryClassId] = useState<number | null>(null);
  const [liveEntryError, setLiveEntryError] = useState<{ classId: number | null; message: string }>({
    classId: null,
    message: '',
  });
  const [activityTimeFilter, setActivityTimeFilter] = useState<'today' | '7d' | '30d' | 'all'>('7d');
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | 'live' | 'practice'>('all');

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
  const practiceHistory = Array.isArray(data?.practice_history) ? data.practice_history : [];
  const focusTags = Array.isArray(data?.student_memory?.focus_tags) ? data.student_memory.focus_tags : [];
  const errorPatterns = Array.isArray(data?.student_memory?.error_patterns) ? data.student_memory.error_patterns : [];
  const memoryTimeline = Array.isArray(data?.student_memory?.memory_timeline) ? data.student_memory.memory_timeline : [];
  const behaviorBaseline = data?.student_memory?.behavior_baseline || {};
  const stats = data?.overall_analytics?.stats || {};
  const engagement = data?.overall_analytics?.engagement || {};
  const masteryRows = Array.isArray(data?.overall_analytics?.mastery) ? data.overall_analytics.mastery : [];
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
  const weeklyGoal = engagement?.weekly_goal || null;
  const streakDays = Number(engagement?.comeback_streak_days || 0);
  const personalBestAccuracy = historyRows.reduce((best: number, row: any) => Math.max(best, Number(row?.accuracy_pct || row?.accuracy || 0)), 0);
  const personalBestSession = historyRows.find((row: any) => Number(row?.accuracy_pct || row?.accuracy || 0) === personalBestAccuracy) || null;
  const mission = data?.recommendations?.comeback_mission || null;
  const nextStep = data?.recommendations?.next_step || null;
  const missionTitle = mission?.headline || nextStep?.title || copy.launchPractice;
  const missionBody = mission?.body || nextStep?.body || '';
  const missionCta = mission?.cta_label || copy.launchPractice;
  const recommendedWeakTags = Array.isArray(data?.recommendations?.weak_tags) ? data.recommendations.weak_tags : [];
  const strongestTags = useMemo(
    () =>
      [...masteryRows]
        .sort((left: any, right: any) => Number(right?.score || 0) - Number(left?.score || 0))
        .slice(0, 3),
    [masteryRows],
  );
  const weakestTags = useMemo(
    () =>
      [...masteryRows]
        .sort((left: any, right: any) => Number(left?.score || 0) - Number(right?.score || 0))
        .slice(0, 3),
    [masteryRows],
  );
  const weeklyCompletion = Math.max(0, Math.min(100, Number(weeklyGoal?.completion_pct || 0)));
  const weeklyDaysLeft = Math.max(0, Number(weeklyGoal?.active_days_target || 0) - Number(weeklyGoal?.active_days_progress || 0));
  const missionChecklist = [
    {
      label: language === 'he' ? 'ימים פעילים השבוע' : language === 'ar' ? 'أيام النشاط هذا الأسبوع' : 'Active days this week',
      value: `${Number(engagement?.active_days_7d || 0)}/${Number(weeklyGoal?.active_days_target || 0) || 0}`,
      tone: 'bg-brand-yellow',
      icon: Flame,
    },
    {
      label: language === 'he' ? 'נסיונות תרגול השבוע' : language === 'ar' ? 'محاولات التدريب هذا الأسبوع' : 'Practice attempts this week',
      value: `${Number(engagement?.practice_attempts_7d || 0)}`,
      tone: 'bg-brand-purple text-white',
      icon: BrainCircuit,
    },
    {
      label: language === 'he' ? 'תשובות חיות השבוע' : language === 'ar' ? 'إجابات مباشرة هذا الأسبوع' : 'Live answers this week',
      value: `${Number(engagement?.live_answers_7d || 0)}`,
      tone: 'bg-brand-orange text-white',
      icon: Rocket,
    },
  ];
  const topFocusPreview = weakestTags.slice(0, 2);
  const focusScoreLabel = topFocusPreview.length > 0 ? `${Math.round(Number(topFocusPreview[0]?.score || 0))}%` : '--';
  const latestHistoryRow = historyRows[0] || null;
  const latestHistoryLabel = latestHistoryRow?.pack_title || (language === 'he' ? 'עדיין אין סשן אחרון' : language === 'ar' ? 'لا توجد جلسة أخيرة بعد' : 'No recent session yet');
  const latestHistoryMeta = latestHistoryRow
    ? `${Math.round(Number(latestHistoryRow?.accuracy_pct || latestHistoryRow?.accuracy || 0))}% ${copy.accuracy}`
    : copy.noHistory;
  const activeClassCount = activeClasses.length;
  const pendingInviteCount = pendingInvites.length;
  const overviewLabels = {
    he: {
      quickStats: 'תמונת מצב מהירה',
      recommendedNow: 'מומלץ עכשיו',
      recommendedSubtitle: 'שומרים על מיקוד בפעולה הבאה, ואת כל היתר פותחים רק כשצריך.',
      weeklyRhythm: 'קצב שבועי',
      weeklyRhythmSubtitle: 'התקדמות מול היעד האישי שלך, עם פירוט רק אם צריך.',
      focusSnapshot: 'אזורי מיקוד',
      focusSubtitle: 'הנושאים שכדאי לבדוק עכשיו, ואז לפרט לעומק רק לפי צורך.',
      learningDetails: 'פירוט למידה',
      recentActivity: 'פעילות אחרונה',
      recentActivitySubtitle: 'היסטוריית סשנים נשמרת סריקה ומהירה, עם הרחבה לפי דרישה.',
      achievements: 'תמונת הישגים אמיתית',
      achievementsSubtitle: 'רק מדדים והקשרים שמבוססים על הפעילות האמיתית שלך.',
      classArea: 'כיתות והזמנות',
      classAreaSubtitle: 'רואים מהר מה ממתין לך, ופותחים כל כיתה רק כשצריך.',
      focusNow: 'להתמקד עכשיו',
      strengths: 'חוזקות',
      latestSessionShort: 'הסשן האחרון',
      activeClassesShort: 'כיתות פעילות',
      pendingInvitesShort: 'ממתינות לאישור',
      unlocked: 'פתוחים',
      bestAccuracy: 'דיוק שיא',
      bestSession: 'סשן חזק',
      activityMix: 'חי + תרגול',
      masterySummary: 'תמונת שליטה',
      practiceHabit: 'הרגל תרגול',
      currentStreak: 'רצף נוכחי',
      todayPlan: 'מה לעשות היום',
      todayPlanSubtitle: 'משימה אחת ברורה, בלי להעמיס עליך יותר מדי אפשרויות.',
      questionsLeft: 'שאלות שנשארו היום',
      reviewToday: 'לחזור על זה היום',
      reviewTodaySubtitle: 'רק 2-3 נושאים שיחזירו אותך למרכז.',
      commonMistakes: 'טעויות שחוזרות',
      commonMistakesSubtitle: 'דפוסים שהמערכת כבר מזהה וצריך להיזהר מהם.',
      readiness: 'מוכנות למבחן',
      readinessSubtitle: 'ציון פשוט שמשלב דיוק, פוקוס ולחץ.',
      improvedRecently: 'מה השתפר לאחרונה',
      improvedSubtitle: 'כדי לראות גם התקדמות ולא רק חולשות.',
      weeklyGap: 'כמה נשאר ליעד',
      activityFilters: 'סינון פעילות',
      allTime: 'הכול',
      today: 'היום',
      last7: '7 ימים',
      last30: '30 ימים',
      allActivity: 'כל הפעילות',
      liveOnly: 'משחקים חיים',
      practiceOnly: 'תרגול',
      noFilteredActivity: 'אין פעילות שמתאימה לסינון שבחרת.',
      liveActivity: 'משחק חי',
      practiceActivity: 'תרגול אדפטיבי',
      trendAccuracy: 'דיוק',
      trendConfidence: 'ביטחון',
      trendStress: 'לחץ',
    },
    ar: {
      quickStats: 'لقطة سريعة',
      recommendedNow: 'الموصى به الآن',
      recommendedSubtitle: 'نحافظ على التركيز على الخطوة التالية، ونكشف الباقي فقط عند الحاجة.',
      weeklyRhythm: 'الإيقاع الأسبوعي',
      weeklyRhythmSubtitle: 'تقدمك نحو هدفك الشخصي مع تفاصيل إضافية فقط عند الحاجة.',
      focusSnapshot: 'مناطق التركيز',
      focusSubtitle: 'المواضيع التي تستحق الانتباه الآن، مع تعمق إضافي فقط عند الحاجة.',
      learningDetails: 'تفاصيل التعلم',
      recentActivity: 'النشاط الأخير',
      recentActivitySubtitle: 'يبقى سجل الجلسات سريع القراءة مع إمكانية التوسيع عند الطلب.',
      achievements: 'صورة الإنجاز الحقيقية',
      achievementsSubtitle: 'فقط مؤشرات وسياق مبنيّان على نشاطك الحقيقي.',
      classArea: 'الصفوف والدعوات',
      classAreaSubtitle: 'ترى بسرعة ما ينتظرك، وتفتح كل صف فقط عندما تحتاج.',
      focusNow: 'ركز الآن',
      strengths: 'نقاط القوة',
      latestSessionShort: 'آخر جلسة',
      activeClassesShort: 'صفوف نشطة',
      pendingInvitesShort: 'بانتظار الموافقة',
      unlocked: 'مفتوحة',
      bestAccuracy: 'أفضل دقة',
      bestSession: 'أفضل جلسة',
      activityMix: 'مباشر + تدريب',
      masterySummary: 'ملخص الإتقان',
      practiceHabit: 'عادة التدريب',
      currentStreak: 'السلسلة الحالية',
      todayPlan: 'ماذا تفعل اليوم',
      todayPlanSubtitle: 'مهمة واحدة واضحة بدون تحميلك خيارات كثيرة.',
      questionsLeft: 'الأسئلة المتبقية اليوم',
      reviewToday: 'راجع هذا اليوم',
      reviewTodaySubtitle: 'موضوعان أو ثلاثة فقط يعيدانك إلى المسار.',
      commonMistakes: 'أخطاء متكررة',
      commonMistakesSubtitle: 'أنماط تعرفها المنصة بالفعل ويستحق الانتباه إليها.',
      readiness: 'الاستعداد للاختبار',
      readinessSubtitle: 'درجة بسيطة تجمع بين الدقة والتركيز والضغط.',
      improvedRecently: 'ما الذي تحسن مؤخرًا',
      improvedSubtitle: 'لكي ترى التقدم أيضًا، وليس نقاط الضعف فقط.',
      weeklyGap: 'المتبقي للهدف',
      activityFilters: 'تصفية النشاط',
      allTime: 'الكل',
      today: 'اليوم',
      last7: '7 أيام',
      last30: '30 يومًا',
      allActivity: 'كل النشاط',
      liveOnly: 'الألعاب الحية',
      practiceOnly: 'التدريب',
      noFilteredActivity: 'لا يوجد نشاط يطابق عامل التصفية الذي اخترته.',
      liveActivity: 'لعبة حية',
      practiceActivity: 'تدريب تكيّفي',
      trendAccuracy: 'الدقة',
      trendConfidence: 'الثقة',
      trendStress: 'الضغط',
    },
    en: {
      quickStats: 'Quick glance',
      recommendedNow: 'Recommended now',
      recommendedSubtitle: 'Keep the next step in focus and reveal the rest only when needed.',
      weeklyRhythm: 'Weekly rhythm',
      weeklyRhythmSubtitle: 'Progress toward your personal goal, with details only when you need them.',
      focusSnapshot: 'Focus snapshot',
      focusSubtitle: 'See what matters now, then open the deeper learning view only if needed.',
      learningDetails: 'Learning details',
      recentActivity: 'Recent activity',
      recentActivitySubtitle: 'Session history stays scan-friendly, with expansion only on demand.',
      achievements: 'Real learning highlights',
      achievementsSubtitle: 'Only signals that come from real student activity and history.',
      classArea: 'Classes & invites',
      classAreaSubtitle: 'See what is waiting for you fast, then open each class only when needed.',
      focusNow: 'Focus now',
      strengths: 'Strengths',
      latestSessionShort: 'Latest session',
      activeClassesShort: 'Active classes',
      pendingInvitesShort: 'Pending invites',
      bestAccuracy: 'Best accuracy',
      bestSession: 'Best session',
      activityMix: 'Live + practice',
      masterySummary: 'Mastery summary',
      practiceHabit: 'Practice habit',
      currentStreak: 'Current streak',
      todayPlan: 'What to do today',
      todayPlanSubtitle: 'One clear task, without loading too many options at once.',
      questionsLeft: 'Questions left today',
      reviewToday: 'Review this today',
      reviewTodaySubtitle: 'Just 2 to 3 topics that bring you back to center.',
      commonMistakes: 'Repeated mistakes',
      commonMistakesSubtitle: 'Patterns the system already sees and wants you to watch.',
      readiness: 'Test readiness',
      readinessSubtitle: 'A simple score that blends accuracy, focus, and pressure.',
      improvedRecently: 'What improved recently',
      improvedSubtitle: 'So the page shows progress too, not only weak spots.',
      weeklyGap: 'Left to goal',
      activityFilters: 'Activity filters',
      allTime: 'All time',
      today: 'Today',
      last7: '7 days',
      last30: '30 days',
      allActivity: 'All activity',
      liveOnly: 'Live games',
      practiceOnly: 'Practice',
      noFilteredActivity: 'No activity matches the filter you selected.',
      liveActivity: 'Live game',
      practiceActivity: 'Adaptive practice',
      trendAccuracy: 'Accuracy',
      trendConfidence: 'Confidence',
      trendStress: 'Stress',
    },
  }[language];

  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);

  const activityFeed = useMemo(() => {
    const liveFeed = historyRows.map((row: any) => ({
      id: `live-${row.session_id}-${row.participant_id || row.started_at || ''}`,
      type: 'live' as const,
      title: String(row.pack_title || `Session #${row.session_id || ''}`).trim(),
      subtitle: String(row.game_type || overviewLabels.liveActivity),
      scoreLabel: `${Math.round(Number(row.accuracy_pct || row.accuracy || 0))}% ${copy.accuracy}`,
      countLabel: `${Number(row.answer_count || 0)} ${language === 'he' ? 'תשובות' : language === 'ar' ? 'إجابات' : 'answers'}`,
      unitCount: Number(row.answer_count || 0),
      startedAt: row.started_at || row.joined_at || null,
      timestamp: Date.parse(String(row.started_at || row.joined_at || '')) || 0,
    }));
    const practiceFeed = practiceHistory.map((row: any) => ({
      id: `practice-${row.id}`,
      type: 'practice' as const,
      title: String(row.pack_title || overviewLabels.practiceActivity).trim(),
      subtitle: String(row.learning_objective || row.prompt || overviewLabels.practiceActivity).trim(),
      scoreLabel: row.is_correct
        ? language === 'he'
          ? 'נכון'
          : language === 'ar'
            ? 'صحيح'
            : 'Correct'
        : language === 'he'
          ? 'לא נכון'
          : language === 'ar'
            ? 'غير صحيح'
          : 'Incorrect',
      countLabel: `${Math.round(Number(row.response_ms || 0) / 1000)}s`,
      unitCount: 1,
      startedAt: row.created_at || null,
      timestamp: Date.parse(String(row.created_at || '')) || 0,
      tags: Array.isArray(row.tags) ? row.tags : [],
    }));
    return [...liveFeed, ...practiceFeed].sort((left, right) => right.timestamp - left.timestamp);
  }, [copy.accuracy, historyRows, language, overviewLabels.liveActivity, overviewLabels.practiceActivity, practiceHistory]);

  const filteredActivityFeed = useMemo(() => {
    const now = Date.now();
    return activityFeed.filter((entry) => {
      if (activityTypeFilter !== 'all' && entry.type !== activityTypeFilter) return false;
      if (!entry.timestamp) return activityTimeFilter === 'all';
      if (activityTimeFilter === 'today') return entry.timestamp >= todayStart;
      if (activityTimeFilter === '7d') return entry.timestamp >= now - 7 * 24 * 60 * 60 * 1000;
      if (activityTimeFilter === '30d') return entry.timestamp >= now - 30 * 24 * 60 * 60 * 1000;
      return true;
    });
  }, [activityFeed, activityTimeFilter, activityTypeFilter, todayStart]);

  const todaysQuestionCount = useMemo(
    () =>
      activityFeed
        .filter((entry) => entry.timestamp >= todayStart)
        .reduce((sum, entry) => sum + Number(entry.unitCount || 0), 0),
    [activityFeed, todayStart],
  );
  const dailyQuestionTarget = Math.max(5, Math.min(12, Number(data?.practice_defaults?.count || 6) || 6));
  const questionsLeftToday = Math.max(0, dailyQuestionTarget - todaysQuestionCount);
  const readinessScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        Number(stats?.accuracy || 0) * 0.5 + Number(behaviorBaseline?.focus_score || 0) * 0.3 + (100 - Number(behaviorBaseline?.stress_index || 0)) * 0.2,
      ),
    ),
  );
  const readinessBand =
    readinessScore >= 75 ? (language === 'he' ? 'יציב' : language === 'ar' ? 'مستقر' : 'Stable') : readinessScore >= 55 ? (language === 'he' ? 'בבנייה' : language === 'ar' ? 'قيد البناء' : 'Building') : language === 'he' ? 'צריך חיזוק' : language === 'ar' ? 'يحتاج دعماً' : 'Needs support';
  const latestTimelinePoint = memoryTimeline[memoryTimeline.length - 1] || null;
  const previousTimelinePoint = memoryTimeline.length > 1 ? memoryTimeline[memoryTimeline.length - 2] : null;
  const improvementHighlights = [
    latestTimelinePoint && previousTimelinePoint && Number(latestTimelinePoint.accuracy_pct || 0) > Number(previousTimelinePoint.accuracy_pct || 0)
      ? `${overviewLabels.trendAccuracy}: +${Math.round(Number(latestTimelinePoint.accuracy_pct || 0) - Number(previousTimelinePoint.accuracy_pct || 0))}`
      : '',
    latestTimelinePoint && previousTimelinePoint && Number(latestTimelinePoint.confidence_score || 0) > Number(previousTimelinePoint.confidence_score || 0)
      ? `${overviewLabels.trendConfidence}: +${Math.round(Number(latestTimelinePoint.confidence_score || 0) - Number(previousTimelinePoint.confidence_score || 0))}`
      : '',
    latestTimelinePoint && previousTimelinePoint && Number(latestTimelinePoint.stress_index || 0) < Number(previousTimelinePoint.stress_index || 0)
      ? `${overviewLabels.trendStress}: -${Math.round(Number(previousTimelinePoint.stress_index || 0) - Number(latestTimelinePoint.stress_index || 0))}`
      : '',
  ].filter(Boolean).slice(0, 3);

  const describeLiveClassCta = (classRow: any) => {
    const activeSession = classRow?.active_session || null;
    const activePin = String(activeSession?.pin || '');
    const sessionStatus = String(activeSession?.status || '').toUpperCase();
    const hasStoredSeat = activePin ? hasStoredLiveSeatForPin(activePin) : false;
    const hasRecoverableSeat = hasStoredSeat || Boolean(activeSession?.resume_available);

    if (!activePin) {
      return {
        buttonLabel: copy.joinClass,
        badgeLabel: '',
        helperText: '',
        disabled: true,
      };
    }

    if (hasRecoverableSeat) {
      return {
        buttonLabel: copy.continueLive,
        badgeLabel: copy.continueLive,
        helperText:
          hasStoredSeat
            ? language === 'he'
              ? 'כבר יש לך מושב שמור בחדר הזה על המכשיר הזה.'
              : language === 'ar'
                ? 'لديك بالفعل مقعد محفوظ في هذه الغرفة على هذا الجهاز.'
                : 'You already have a saved seat for this room on this device.'
            : language === 'he'
              ? 'החשבון שלך כבר שויך לחדר הזה, ונשחזר את המושב שלך גם בלי זיכרון מקומי.'
              : language === 'ar'
                ? 'حسابك مرتبط بهذه الغرفة بالفعل، وسنستعيد مقعدك حتى بدون ذاكرة محلية.'
                : 'Your account is already linked to this room, so we can restore your seat even without local device memory.',
        disabled: false,
      };
    }

    if (sessionStatus === 'LOBBY') {
      return {
        buttonLabel: copy.joinClass,
        badgeLabel:
          language === 'he' ? 'לובי פתוח' : language === 'ar' ? 'ردهة مفتوحة' : 'Lobby open',
        helperText:
          language === 'he'
            ? 'החדר פתוח עכשיו להצטרפות.'
            : language === 'ar'
              ? 'الغرفة مفتوحة الآن للانضمام.'
              : 'The room is open to join right now.',
        disabled: false,
      };
    }

    return {
      buttonLabel:
        language === 'he' ? 'המתן ללובי' : language === 'ar' ? 'انتظر الردهة' : 'Wait for lobby',
      badgeLabel:
        language === 'he' ? 'המשחק כבר התחיל' : language === 'ar' ? 'اللعبة بدأت بالفعل' : 'Game underway',
      helperText:
        language === 'he'
          ? 'אם כבר הצטרפת קודם ננסה לשחזר אותך. אם לא, תצטרך להצטרף כשהלובי פתוח.'
          : language === 'ar'
            ? 'إذا كنت قد انضممت سابقًا فسنحاول استعادتك. وإلا ستحتاج للانضمام عندما تكون الردهة مفتوحة.'
            : 'If you already joined before, we will try to restore your seat. Otherwise, wait until the lobby is open.',
      disabled: true,
    };
  };

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

  const handleEnterLiveClass = async (classRow: any) => {
    const activePin = String(classRow?.active_session?.pin || '');
    if (!activePin) return;

    try {
      setLiveEntryClassId(Number(classRow?.class_id || 0));
      setLiveEntryError({ classId: null, message: '' });
      await enterLinkedStudentLiveSession({
        pin: activePin,
        nickname: data?.student?.display_name || '',
      });
      navigate(`/student/session/${activePin}/play`);
    } catch (liveError: any) {
      setLiveEntryError({
        classId: Number(classRow?.class_id || 0),
        message: String(liveError?.message || copy.loadFailed),
      });
    } finally {
      setLiveEntryClassId(null);
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
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/" className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black">
              {copy.home}
            </Link>
            <Link
              to="/student/me"
              className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${!isHistoryRoute ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}
            >
              {copy.overview}
            </Link>
            <Link
              to="/student/me/history"
              className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${isHistoryRoute ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'}`}
            >
              {copy.history}
            </Link>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black text-brand-dark"
          >
            <LogOut className="h-4 w-4" />
            {copy.signOut}
          </button>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2.5rem] border-4 border-brand-dark bg-white p-6 shadow-[9px_9px_0px_0px_#1A1A1A] md:p-7"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(90deg,rgba(255,209,59,0.18)_0%,rgba(180,136,255,0.14)_48%,rgba(255,138,91,0.18)_100%)]" />
          <div className="pointer-events-none absolute -left-10 top-10 h-40 w-40 rounded-full bg-[#fff1bc] blur-2xl" />
          <div className="pointer-events-none absolute -right-10 bottom-0 h-44 w-44 rounded-full bg-[#ebe2ff] blur-2xl" />

          <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-[#fff8df] px-4 py-2">
                <Sparkles className="h-4 w-4 text-brand-orange" />
                <span className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-dark">
                  {copy.classLinked} • {classes.length}
                </span>
              </div>

              <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.7rem)] font-black leading-[0.95] tracking-tight text-brand-dark">
                {data.student.display_name}
              </h1>
              <p className="mt-4 max-w-3xl text-base font-bold leading-7 text-brand-dark/65 md:text-lg">
                {copy.subtitle}
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <span className="rounded-full border border-brand-dark bg-white px-3.5 py-1.5 text-xs font-black text-brand-dark/80">
                  {overviewLabels.activeClassesShort}: {activeClassCount}
                </span>
                <span className="rounded-full border border-brand-dark bg-white px-3.5 py-1.5 text-xs font-black text-brand-dark/80">
                  {copy.accuracy}: {Math.round(Number(stats?.accuracy || 0))}%
                </span>
                <span className="rounded-full border border-brand-dark bg-white px-3.5 py-1.5 text-xs font-black text-brand-dark/80">
                  {copy.activeDays}: {Number(engagement?.active_days_7d || 0)}
                </span>
              </div>

              {summary ? (
                <div className="mt-6 rounded-[1.7rem] border-2 border-brand-dark bg-white/85 p-5 shadow-[4px_4px_0px_0px_#1A1A1A] backdrop-blur-sm">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.nextMove}</p>
                  <p className="mt-2 text-2xl font-black text-brand-dark">{summary.headline}</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70 md:text-base">{summary.body}</p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4">
              <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-dark p-5 text-white shadow-[6px_6px_0px_0px_#FF5A36]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-yellow">{overviewLabels.recommendedNow}</p>
                    <p className="mt-2 text-[1.85rem] font-black leading-tight">{missionTitle}</p>
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border-2 border-white/15 bg-white/10">
                    <Rocket className="h-6 w-6 text-brand-yellow" />
                  </div>
                </div>
                <p className="mt-3 text-sm font-bold leading-6 text-white/75 md:text-base">{missionBody || overviewLabels.recommendedSubtitle}</p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <Link
                    to={practicePath}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark"
                  >
                    {missionCta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  {latestSessionPath ? (
                    <Link
                      to={latestSessionPath}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-white/15 bg-white/10 px-5 py-3 font-black text-white"
                    >
                      {copy.continueLive}
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.55rem] border-2 border-brand-dark bg-[#f5f7ff] p-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.latestSessionShort}</p>
                  <p className="mt-2 text-lg font-black text-brand-dark">{latestHistoryLabel}</p>
                  <p className="mt-2 text-sm font-bold text-brand-dark/60">{latestHistoryMeta}</p>
                </div>
                <div className="rounded-[1.55rem] border-2 border-brand-dark bg-brand-bg p-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.classes}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-[1rem] border-2 border-brand-dark bg-white px-3 py-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/45">{overviewLabels.activeClassesShort}</p>
                      <p className="mt-1 text-2xl font-black text-brand-dark">{activeClassCount}</p>
                    </div>
                    <div className="rounded-[1rem] border-2 border-brand-dark bg-white px-3 py-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/45">{overviewLabels.pendingInvitesShort}</p>
                      <p className="mt-1 text-2xl font-black text-brand-dark">{pendingInviteCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <section>
          <div className="mb-3 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-brand-orange" />
            <h2 className="text-2xl font-black text-brand-dark">{overviewLabels.quickStats}</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StudentPortalMetricCard label={copy.accuracy} value={`${Math.round(Number(stats?.accuracy || 0))}%`} helper={overviewLabels.bestAccuracy} Icon={Target} />
            <StudentPortalMetricCard label={copy.sessions} value={`${Number(data?.student_memory?.history_rollup?.sessions_played || historyRows.length || 0)}`} helper={latestHistoryRow ? formatRelativeTime(latestHistoryRow.started_at || latestHistoryRow.joined_at) : copy.noHistory} Icon={History} />
            <StudentPortalMetricCard label={copy.practiceAttempts} value={`${Number(data?.student_memory?.history_rollup?.practice_attempts || 0)}`} helper={overviewLabels.focusNow} Icon={BrainCircuit} />
            <StudentPortalMetricCard label={copy.activeDays} value={`${Number(engagement?.active_days_7d || 0)}`} helper={streakDays > 0 ? `${streakDays} ${language === 'he' ? 'ימי רצף' : language === 'ar' ? 'أيام متتالية' : 'day streak'}` : overviewLabels.weeklyRhythm} Icon={CalendarClock} />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-[1.8rem] border-4 border-brand-dark bg-[#fff8df] p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.todayPlan}</p>
            <p className="mt-2 text-2xl font-black text-brand-dark">{missionTitle}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70">{overviewLabels.todayPlanSubtitle}</p>
            <div className="mt-4 rounded-[1rem] border-2 border-brand-dark bg-white px-3 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/45">{overviewLabels.questionsLeft}</p>
              <p className="mt-2 text-3xl font-black text-brand-dark">{questionsLeftToday}</p>
            </div>
          </div>

          <div className="rounded-[1.8rem] border-4 border-brand-dark bg-white p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.reviewToday}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70">{overviewLabels.reviewTodaySubtitle}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(recommendedWeakTags.length > 0 ? recommendedWeakTags : topFocusPreview.map((tag: any) => String(tag?.tag || ''))).slice(0, 3).map((tag: string) => (
                <span key={tag} className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-xs font-black text-brand-dark">
                  {tag}
                </span>
              ))}
              {recommendedWeakTags.length === 0 && topFocusPreview.length === 0 ? (
                <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-xs font-black text-brand-dark/65">
                  {copy.noHistory}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[1.8rem] border-4 border-brand-dark bg-[#f5f7ff] p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.readiness}</p>
            <p className="mt-2 text-4xl font-black text-brand-dark">{readinessScore}</p>
            <p className="mt-2 inline-flex rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black text-brand-dark">
              {readinessBand}
            </p>
            <p className="mt-3 text-sm font-bold leading-6 text-brand-dark/70">{overviewLabels.readinessSubtitle}</p>
          </div>

          <div className="rounded-[1.8rem] border-4 border-brand-dark bg-brand-dark p-5 text-white shadow-[6px_6px_0px_0px_#FF5A36]">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-yellow">{overviewLabels.improvedRecently}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-white/75">{overviewLabels.improvedSubtitle}</p>
            <div className="mt-4 space-y-2">
              {improvementHighlights.length > 0 ? improvementHighlights.map((item) => (
                <div key={item} className="rounded-[1rem] border border-white/15 bg-white/10 px-3 py-2 text-sm font-black text-white">
                  {item}
                </div>
              )) : (
                <div className="rounded-[1rem] border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white/75">
                  {language === 'he'
                    ? 'עדיין אין מספיק שינוי אחרון כדי להציג מגמה ברורה.'
                    : language === 'ar'
                      ? 'لا يوجد تغير كافٍ بعد لإظهار اتجاه واضح.'
                      : 'There is not enough recent change yet to show a clear trend.'}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.06fr)_minmax(320px,0.94fr)]">
          <div className="space-y-5">
            <StudentPortalDisclosureCard
              icon={BrainCircuit}
              eyebrow={overviewLabels.learningDetails}
              title={language === 'he' ? 'פירוט למידה אמיתי' : language === 'ar' ? 'تفاصيل تعلم حقيقية' : 'Real learning detail'}
              subtitle={language === 'he' ? 'מגמות, טעויות חוזרות וזיכרון למידה ממוקד.' : language === 'ar' ? 'اتجاهات وأخطاء متكررة وذاكرة تعلم مركزة.' : 'Trends, repeated mistakes, and focused memory signals.'}
              badge={`${memoryTimeline.length}`}
              defaultOpen={false}
              preview={
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.commonMistakes}</p>
                    <p className="mt-2 text-lg font-black text-brand-dark">{errorPatterns[0]?.label || (language === 'he' ? 'אין דפוס בולט כרגע' : language === 'ar' ? 'لا يوجد نمط بارز الآن' : 'No strong pattern right now')}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.improvedRecently}</p>
                    <p className="mt-2 text-lg font-black text-brand-dark">{improvementHighlights[0] || (language === 'he' ? 'עדיין אין מגמה ברורה' : language === 'ar' ? 'لا يوجد اتجاه واضح بعد' : 'No clear trend yet')}</p>
                  </div>
                </div>
              }
            >
              <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{language === 'he' ? 'ציר מגמה קצר' : language === 'ar' ? 'خط اتجاه قصير' : 'Short trend line'}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: overviewLabels.trendAccuracy, key: 'accuracy_pct', tone: 'bg-[#ffe2d8]' },
                      { label: overviewLabels.trendConfidence, key: 'confidence_score', tone: 'bg-[#ece4ff]' },
                      { label: overviewLabels.trendStress, key: 'stress_index', tone: 'bg-[#fff4cf]' },
                    ].map((metric) => (
                      <div key={metric.key} className="rounded-[1rem] border border-brand-dark bg-brand-bg px-3 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/45">{metric.label}</p>
                        <div className="mt-3 flex items-end gap-1">
                          {memoryTimeline.length > 0 ? memoryTimeline.map((point: any) => {
                            const value = Math.max(8, Math.min(100, Number(point?.[metric.key] || 0)));
                            return (
                              <div key={`${metric.key}-${point.id}`} className="flex-1">
                                <div className={`w-full rounded-t-md border border-brand-dark ${metric.tone}`} style={{ height: `${Math.max(18, value)}px` }} />
                              </div>
                            );
                          }) : (
                            <div className="text-sm font-bold text-brand-dark/60">{copy.noHistory}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-[#fff8df] p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.commonMistakes}</p>
                    <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70">{overviewLabels.commonMistakesSubtitle}</p>
                    <div className="mt-4 space-y-3">
                      {errorPatterns.length > 0 ? errorPatterns.map((pattern: any) => (
                        <div key={pattern.id} className="rounded-[1rem] border border-brand-dark bg-white px-3 py-3">
                          <p className="font-black text-brand-dark">{pattern.label}</p>
                          <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70">{pattern.body}</p>
                        </div>
                      )) : (
                        <div className="rounded-[1rem] border border-brand-dark bg-white px-3 py-3 text-sm font-bold text-brand-dark/65">
                          {copy.noHistory}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </StudentPortalDisclosureCard>

            <StudentPortalDisclosureCard
              icon={Target}
              eyebrow={overviewLabels.focusSnapshot}
              title={copy.focusAreas}
              subtitle={overviewLabels.focusSubtitle}
              badge={focusScoreLabel}
              defaultOpen={false}
              preview={
                <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {topFocusPreview.length > 0 ? (
                      topFocusPreview.map((tag: any) => (
                        <div key={`preview-${tag.tag}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-[#fff8df] px-4 py-4">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.focusNow}</p>
                          <p className="mt-2 text-lg font-black text-brand-dark">{String(tag.tag || '')}</p>
                          <p className="mt-2 text-2xl font-black text-brand-dark">{Math.round(Number(tag.score || tag.mastery_score || 0))}%</p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4 font-bold text-brand-dark/65 sm:col-span-2">
                        {copy.noHistory}
                      </div>
                    )}
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.masterySummary}</p>
                    <p className="mt-2 text-lg font-black text-brand-dark">{strongestTags[0]?.tag || '--'}</p>
                    <p className="mt-2 text-sm font-bold text-brand-dark/65">
                      {language === 'he'
                        ? 'הצג פירוט מלא רק אם צריך להבין לעומק איפה לחזק ואיפה כבר יציב.'
                        : language === 'ar'
                          ? 'افتح التفاصيل الكاملة فقط إذا احتجت إلى فهم أعمق لما يحتاج دعمًا وما أصبح ثابتًا.'
                          : 'Open the full detail only when you need a deeper read of what still needs support and what is already stable.'}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <p className="text-lg font-black text-brand-dark">{overviewLabels.strengths}</p>
                  </div>
                  <div className="space-y-3">
                    {strongestTags.length > 0 ? strongestTags.map((tag: any) => (
                      <div key={`strong-${tag.tag}`}>
                        <MasteryRow label={String(tag.tag || '')} score={Number(tag.score || 0)} tone="emerald" />
                      </div>
                    )) : <p className="font-medium text-brand-dark/65">{copy.noHistory}</p>}
                  </div>
                </div>
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Target className="h-5 w-5 text-brand-orange" />
                    <p className="text-lg font-black text-brand-dark">{overviewLabels.focusNow}</p>
                  </div>
                  <div className="space-y-3">
                    {weakestTags.length > 0 ? weakestTags.map((tag: any) => (
                      <div key={`weak-${tag.tag}`}>
                        <MasteryRow label={String(tag.tag || '')} score={Number(tag.score || 0)} tone="orange" />
                      </div>
                    )) : <p className="font-medium text-brand-dark/65">{copy.noHistory}</p>}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {focusTags.length > 0 ? focusTags.map((tag: any, index: number) => (
                  <div key={`${tag.tag || 'focus'}-${index}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black text-brand-dark">{String(tag.tag || '')}</p>
                      <span className="rounded-full border border-brand-dark bg-brand-bg px-3 py-1 text-[11px] font-black uppercase">
                        {String(tag.status || 'watch')}
                      </span>
                    </div>
                    <p className="mt-3 text-2xl font-black text-brand-dark">{Math.round(Number(tag.mastery_score || 0))}%</p>
                  </div>
                )) : null}
              </div>
            </StudentPortalDisclosureCard>

            <StudentPortalDisclosureCard
              icon={History}
              eyebrow={overviewLabels.recentActivity}
              title={copy.recentHistory}
              subtitle={overviewLabels.recentActivitySubtitle}
              badge={`${filteredActivityFeed.length}`}
              defaultOpen={isHistoryRoute}
              preview={
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.latestSessionShort}</p>
                    <p className="mt-2 text-lg font-black text-brand-dark">{latestHistoryLabel}</p>
                    <p className="mt-2 text-sm font-bold text-brand-dark/65">{latestHistoryMeta}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.activityFilters}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { key: 'today', label: overviewLabels.today },
                        { key: '7d', label: overviewLabels.last7 },
                        { key: '30d', label: overviewLabels.last30 },
                        { key: 'all', label: overviewLabels.allTime },
                      ].map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setActivityTimeFilter(option.key as 'today' | '7d' | '30d' | 'all')}
                          className={`rounded-full border-2 px-3 py-1 text-xs font-black ${
                            activityTimeFilter === option.key ? 'border-brand-dark bg-brand-dark text-white' : 'border-brand-dark bg-white text-brand-dark'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              }
            >
              <div className="space-y-3">
                <div className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.activityFilters}</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'all', label: overviewLabels.allActivity },
                        { key: 'live', label: overviewLabels.liveOnly },
                        { key: 'practice', label: overviewLabels.practiceOnly },
                      ].map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setActivityTypeFilter(option.key as 'all' | 'live' | 'practice')}
                          className={`rounded-full border-2 px-3 py-1.5 text-xs font-black ${
                            activityTypeFilter === option.key ? 'border-brand-dark bg-brand-yellow text-brand-dark' : 'border-brand-dark bg-brand-bg text-brand-dark'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {filteredActivityFeed.length > 0 ? filteredActivityFeed.slice(0, isHistoryRoute ? 20 : 10).map((entry: any) => (
                  <div key={entry.id} className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-black text-brand-dark">{entry.title}</p>
                          <span className={`rounded-full border border-brand-dark px-3 py-1 text-[11px] font-black ${
                            entry.type === 'practice' ? 'bg-[#ece4ff] text-brand-purple' : 'bg-white text-brand-dark'
                          }`}>
                            {entry.type === 'practice' ? overviewLabels.practiceActivity : overviewLabels.liveActivity}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-bold text-brand-dark/60">{entry.subtitle}</p>
                        <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-brand-dark/45">
                          {formatRelativeTime(entry.startedAt)}
                        </p>
                        {Array.isArray(entry.tags) && entry.tags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {entry.tags.slice(0, 3).map((tag: string) => (
                              <span key={`${entry.id}-${tag}`} className="rounded-full border border-brand-dark bg-white px-2.5 py-1 text-[11px] font-black text-brand-dark/75">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-brand-dark bg-white px-3 py-1 text-xs font-black">{entry.scoreLabel}</span>
                        <span className="rounded-full border border-brand-dark bg-white px-3 py-1 text-xs font-black">{entry.countLabel}</span>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg px-4 py-4 font-bold text-brand-dark/65">
                    {overviewLabels.noFilteredActivity}
                  </div>
                )}
              </div>
            </StudentPortalDisclosureCard>

            <StudentPortalDisclosureCard
              icon={TrendingUp}
              eyebrow={overviewLabels.achievements}
              title={language === 'he' ? 'תמונת הישגים אמיתית' : language === 'ar' ? 'صورة الإنجاز الحقيقية' : 'Real learning highlights'}
              subtitle={overviewLabels.achievementsSubtitle}
              badge={`${Math.round(personalBestAccuracy)}%`}
              tone="dark"
              defaultOpen={false}
              preview={
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.1rem] border-2 border-white/15 bg-white/10 px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.bestAccuracy}</p>
                    <p className="mt-2 text-3xl font-black">{Math.round(personalBestAccuracy)}%</p>
                  </div>
                  <div className="rounded-[1.1rem] border-2 border-white/15 bg-white/10 px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.practiceHabit}</p>
                    <p className="mt-2 text-3xl font-black">{Number(data?.student_memory?.history_rollup?.practice_attempts || 0)}</p>
                  </div>
                  <div className="rounded-[1.1rem] border-2 border-white/15 bg-white/10 px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.currentStreak}</p>
                    <p className="mt-2 text-3xl font-black">{streakDays}</p>
                  </div>
                </div>
              }
            >
              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.2rem] border-2 border-white/15 bg-white/10 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.bestAccuracy}</p>
                    <p className="mt-2 text-3xl font-black">{Math.round(personalBestAccuracy)}%</p>
                    <p className="mt-2 text-sm font-bold text-white/75">{copy.accuracy}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-white/15 bg-white/10 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.bestSession}</p>
                    <p className="mt-2 text-base font-black">{personalBestSession?.pack_title || '--'}</p>
                    <p className="mt-2 text-sm font-bold text-white/75">{latestHistoryMeta}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-white/15 bg-white/10 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.practiceHabit}</p>
                    <p className="mt-2 text-3xl font-black">{Number(data?.student_memory?.history_rollup?.practice_attempts || 0)}</p>
                    <p className="mt-2 text-sm font-bold text-white/75">{copy.practiceAttempts}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-white/15 bg-white/10 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{overviewLabels.activityMix}</p>
                    <p className="mt-2 text-3xl font-black">{Number(engagement?.live_answers_7d || 0) + Number(engagement?.practice_attempts_7d || 0)}</p>
                    <p className="mt-2 text-sm font-bold text-white/75">{overviewLabels.currentStreak}: {streakDays}</p>
                  </div>
                </div>

                <div className="rounded-[1.4rem] border-2 border-white/15 bg-white/10 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/55">{language === 'he' ? 'מה באמת קיים כאן' : language === 'ar' ? 'ما الموجود هنا فعلاً' : 'What is actually real here'}</p>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-[1rem] border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold leading-6 text-white/80">
                      {language === 'he'
                        ? 'כל המדדים כאן מחושבים ישירות מהיסטוריית הסשנים, ניסיונות התרגול והדיוק שלך.'
                        : language === 'ar'
                          ? 'كل المؤشرات هنا محسوبة مباشرة من سجل الجلسات ومحاولات التدريب والدقة لديك.'
                          : 'Every metric here is derived directly from your session history, practice attempts, and accuracy.'}
                    </div>
                    <div className="rounded-[1rem] border border-white/15 bg-white/10 px-3 py-3 text-sm font-bold leading-6 text-white/80">
                      {personalBestSession
                        ? language === 'he'
                          ? `הביצוע החזק ביותר שלך היה ב-${personalBestSession.pack_title || 'הסשן האחרון'}.`
                          : language === 'ar'
                            ? `أقوى أداء لك كان في ${personalBestSession.pack_title || 'أحدث جلسة'}.`
                            : `Your strongest run so far came in ${personalBestSession.pack_title || 'your latest session'}.`
                        : copy.noHistory}
                    </div>
                  </div>
                </div>
              </div>
            </StudentPortalDisclosureCard>
          </div>

          <div className="space-y-5">
            <StudentPortalDisclosureCard
              icon={Sparkles}
              eyebrow={overviewLabels.weeklyRhythm}
              title={language === 'he' ? (streakDays > 0 ? `${streakDays} ימי רצף` : copy.nextMove) : language === 'ar' ? (streakDays > 0 ? `${streakDays} أيام متتالية` : copy.nextMove) : streakDays > 0 ? `${streakDays} day streak` : copy.nextMove}
              subtitle={overviewLabels.weeklyRhythmSubtitle}
              badge={`${weeklyCompletion}%`}
              defaultOpen={false}
              tone="warm"
              preview={
                <div className="rounded-[1.3rem] border-2 border-brand-dark bg-white px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-brand-dark">{language === 'he' ? 'התקדמות ליעד השבועי' : language === 'ar' ? 'التقدم نحو هدف الأسبوع' : 'Progress to weekly goal'}</p>
                    <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-1 text-xs font-black">{weeklyCompletion}%</span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full border-2 border-brand-dark bg-brand-bg">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#FF5A36_0%,#FFD13B_55%,#B488FF_100%)]" style={{ width: `${weeklyCompletion}%` }} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-[1rem] border border-brand-dark bg-brand-bg px-3 py-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-brand-dark/45">{language === 'he' ? 'יעד שבועי' : language === 'ar' ? 'الهدف الأسبوعي' : 'Weekly target'}</p>
                      <p className="mt-2 text-2xl font-black text-brand-dark">{Number(weeklyGoal?.active_days_progress || 0)}/{Number(weeklyGoal?.active_days_target || 0)}</p>
                    </div>
                    <div className="rounded-[1rem] border border-brand-dark bg-white px-3 py-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-brand-dark/45">{overviewLabels.weeklyGap}</p>
                      <p className="mt-2 text-2xl font-black text-brand-dark">{weeklyDaysLeft}</p>
                      <p className="mt-1 text-sm font-bold text-brand-dark/60">
                        {language === 'he'
                          ? 'ימי פעילות כדי לעמוד ביעד'
                          : language === 'ar'
                            ? 'أيام نشاط للوصول إلى الهدف'
                            : 'active days to hit the goal'}
                      </p>
                    </div>
                  </div>
                </div>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                {missionChecklist.map((item) => (
                  <div key={item.label} className={`${item.tone} rounded-[1.2rem] border-2 border-brand-dark p-4`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.15em] opacity-70">{item.label}</p>
                      <item.icon className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-3xl font-black">{item.value}</p>
                  </div>
                ))}
              </div>
            </StudentPortalDisclosureCard>

            <StudentPortalDisclosureCard
              icon={GraduationCap}
              eyebrow={overviewLabels.classArea}
              title={copy.classes}
              subtitle={overviewLabels.classAreaSubtitle}
              badge={`${activeClassCount + pendingInviteCount}`}
              defaultOpen
              preview={
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.activeClassesShort}</p>
                    <p className="mt-2 text-3xl font-black text-brand-dark">{activeClassCount}</p>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-[#fff4cf] px-4 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/45">{overviewLabels.pendingInvitesShort}</p>
                    <p className="mt-2 text-3xl font-black text-brand-dark">{pendingInviteCount}</p>
                  </div>
                </div>
              }
            >
              <div className="space-y-5">
                {pendingInvites.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.pendingInvites}</p>
                    {pendingInvites.map((classRow: any) => (
                      <div key={`pending-${classRow.id}`}>
                        <StudentClassOverviewCard
                          classRow={classRow}
                          copy={copy}
                          language={language}
                          isPending
                          practicePath={practicePath}
                          liveEntryClassId={liveEntryClassId}
                          liveEntryError={liveEntryError}
                          busyClassId={busyClassId}
                          onAcceptClass={(classId) => void handleAcceptClass(classId)}
                          onEnterLiveClass={(row) => void handleEnterLiveClass(row)}
                          describeLiveClassCta={describeLiveClassCta}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {activeClasses.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.activeClasses}</p>
                    {activeClasses.map((classRow: any) => (
                      <div key={`active-${classRow.id}`}>
                        <StudentClassOverviewCard
                          classRow={classRow}
                          copy={copy}
                          language={language}
                          isPending={false}
                          practicePath={practicePath}
                          liveEntryClassId={liveEntryClassId}
                          liveEntryError={liveEntryError}
                          busyClassId={busyClassId}
                          onAcceptClass={(classId) => void handleAcceptClass(classId)}
                          onEnterLiveClass={(row) => void handleEnterLiveClass(row)}
                          describeLiveClassCta={describeLiveClassCta}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {activeClasses.length === 0 && pendingInvites.length === 0 ? (
                  <div className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg px-4 py-4 font-bold text-brand-dark/65">
                    {copy.noClasses}
                  </div>
                ) : null}
              </div>
            </StudentPortalDisclosureCard>

            <div className="rounded-[1.9rem] border-4 border-brand-dark bg-white p-5 shadow-[7px_7px_0px_0px_#1A1A1A]">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-brand-orange" />
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{overviewLabels.recommendedNow}</p>
                  <h2 className="mt-1 text-2xl font-black text-brand-dark">{data.recommendations?.next_step?.title || copy.nextMove}</h2>
                </div>
              </div>
              <p className="mt-3 text-sm font-bold leading-6 text-brand-dark/70">{data.recommendations?.next_step?.body || summary?.body || ''}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(data.recommendations?.weak_tags || []).slice(0, 4).map((tag: string) => (
                  <span key={tag} className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black">
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

function MasteryRow({
  label,
  score,
  tone,
}: {
  label: string;
  score: number;
  tone: 'emerald' | 'orange';
}) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(Number(score || 0))));
  const barClass =
    tone === 'emerald'
      ? 'bg-[linear-gradient(90deg,#1F9D61_0%,#7DD3A4_100%)]'
      : 'bg-[linear-gradient(90deg,#FF5A36_0%,#FFD13B_100%)]';

  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-black text-brand-dark">{label}</p>
        <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-xs font-black">
          {clampedScore}%
        </span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full border-2 border-brand-dark bg-brand-bg">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clampedScore}%` }} />
      </div>
    </div>
  );
}
