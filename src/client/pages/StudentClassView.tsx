import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Lock,
  PlayCircle,
  Rocket,
  Sparkles,
  Target,
} from 'lucide-react';
import { apiFetchJson } from '../lib/api.ts';
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

function formatDeliveryLabel(status: string, language: string) {
  const normalized = String(status || 'none').trim().toLowerCase();
  if (language === 'he') {
    if (normalized === 'sent') return 'מייל נשלח';
    if (normalized === 'failed') return 'שגיאת שליחה';
    if (normalized === 'not_configured') return 'מייל לא מוגדר';
    if (normalized === 'claimed') return 'אושר בפועל';
    return 'לא נשלח';
  }
  if (language === 'ar') {
    if (normalized === 'sent') return 'تم الإرسال';
    if (normalized === 'failed') return 'فشل الإرسال';
    if (normalized === 'not_configured') return 'البريد غير مهيأ';
    if (normalized === 'claimed') return 'تمت الموافقة';
    return 'لم يُرسل';
  }
  if (normalized === 'sent') return 'Invite sent';
  if (normalized === 'failed') return 'Send failed';
  if (normalized === 'not_configured') return 'Mail not configured';
  if (normalized === 'claimed') return 'Approved';
  return 'Not sent';
}

export default function StudentClassView() {
  const { language } = useAppLanguage();
  const { classId } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);

  const copy = ({
    he: {
      back: 'חזרה לסביבת התלמיד',
      loading: 'טוען את דף הכיתה...',
      failed: 'לא הצלחנו לטעון את דף הכיתה.',
      retry: 'נסה שוב',
      joinLive: 'הצטרף לסשן החי',
      practice: 'תרגול ממוקד',
      approve: 'אשר את הכיתה',
      approving: 'מאשר...',
      latestRuns: 'היסטוריית כיתה',
      yourRuns: 'ההתקדמות שלך בכיתה',
      assignedPack: 'החבילה של הכיתה',
      nextMove: 'המהלך הבא שלך',
      notes: 'מה חשוב לדעת',
      pendingTitle: 'הכיתה מחכה לאישור שלך',
      pendingBody: 'המורה כבר הוסיף אותך לכיתה הזו. אחרי אישור, הכיתה תופיע אצלך כסביבה פעילה עם התקדמות, תרגול וגישה לחדרים חיים.',
      readyLabel: 'כיתה פעילה',
      pendingLabel: 'ממתין לאישור',
      liveOpen: 'סשן חי פתוח',
      liveClosed: 'כרגע אין סשן חי פתוח',
      focusNow: 'מיקוד נוכחי',
      unlockTitle: 'מה נפתח אחרי אישור',
      unlockStepInvite: 'הכיתה תופיע אצלך ככיתה פעילה',
      unlockStepLive: 'תקבל גישה ישירה לחדרים חיים של הכיתה',
      unlockStepPractice: 'תקבל תרגול ממוקד לאותו חומר',
      unlockStepHistory: 'תוכל לראות את ההתקדמות שלך בהקשר של הכיתה',
      delivery: 'משלוח הזמנה',
      approvalFlow: 'מסלול אישור',
      accountLinked: 'החשבון שלך כבר משויך להזמנה',
      accountNotLinked: 'הזמנה קיימת, אבל עדיין אין שיוך פעילות יציב',
      classPulse: 'דופק הכיתה',
      myPath: 'המסלול שלך בכיתה',
      noClassSessions: 'עדיין אין סשנים בכיתה הזאת.',
      noStudentHistory: 'ההיסטוריה האישית שלך תופיע כאן אחרי שתשחק או תתרגל דרך הכיתה הזו.',
      accuracy: 'דיוק',
      sessions: 'סשנים',
      liveRooms: 'חדרים חיים',
      packQuestions: 'שאלות בחבילה',
      lockedUntilApproval: 'הפעולות הכיתתיות ייפתחו מיד אחרי אישור הכיתה.',
      readyForClass: 'הכיתה הזאת כבר פתוחה עבורך. אפשר להיכנס, לתרגל, ולעקוב אחרי ההתקדמות שלך.',
      enterPractice: 'פתח תרגול כיתתי',
      classMission: 'משימת הכיתה הקרובה',
      classMissionFallback: 'השלב הבא הוא חיזוק קצר על אותו חומר כדי לייצב שליטה לפני ההפעלה הבאה.',
      classSnapshot: 'תמונת מצב',
      packReady: 'חבילה מחוברת',
      packMissing: 'עדיין אין חבילה מחוברת',
      classWorkspace: 'סביבת הכיתה שלך',
      classWorkspaceBody: 'כל מה שקשור דווקא לכיתה הזו: חדר חי, pack, היסטוריה כיתתית, ופעולת התלמיד הבאה.',
      workspaceReady: 'זמין עכשיו',
      workspaceLocked: 'ייפתח אחרי אישור',
      historyReady: 'הכיתה כבר מייצרת היסטוריה',
      historyMissing: 'אין עדיין היסטוריית כיתה',
      sessionStarted: 'התחיל',
      sessionEnded: 'הסתיים',
      inviteSent: 'הזמנה',
      approvedAt: 'אישור',
      lastSeen: 'נראה לאחרונה',
      openPracticeHint: 'תרגול אדפטיבי על אותו חומר יעזור לך להגיע מוכן יותר לסשן הבא.',
    },
    ar: {
      back: 'العودة إلى مساحة الطالب',
      loading: 'جارٍ تحميل صفحة الصف...',
      failed: 'تعذر تحميل صفحة الصف.',
      retry: 'أعد المحاولة',
      joinLive: 'انضم إلى الجلسة الحية',
      practice: 'تدريب مركز',
      approve: 'وافق على الصف',
      approving: 'جارٍ التأكيد...',
      latestRuns: 'سجل الصف',
      yourRuns: 'تقدمك في الصف',
      assignedPack: 'حزمة الصف',
      nextMove: 'خطوتك التالية',
      notes: 'ما المهم الآن',
      pendingTitle: 'هذا الصف بانتظار موافقتك',
      pendingBody: 'أضافك المعلم بالفعل إلى هذا الصف. بعد الموافقة سيظهر عندك كصف نشط مع التقدم والتدريب والوصول إلى الغرف الحية.',
      readyLabel: 'صف نشط',
      pendingLabel: 'بانتظار الموافقة',
      liveOpen: 'جلسة حية مفتوحة',
      liveClosed: 'لا توجد جلسة حية مفتوحة الآن',
      focusNow: 'التركيز الآن',
      unlockTitle: 'ما الذي يُفتح بعد الموافقة',
      unlockStepInvite: 'سيظهر الصف عندك كصف نشط',
      unlockStepLive: 'ستحصل على وصول مباشر إلى الغرف الحية الخاصة بالصف',
      unlockStepPractice: 'ستحصل على تدريب مركز على نفس المادة',
      unlockStepHistory: 'سترى تقدمك داخل سياق هذا الصف',
      delivery: 'إرسال الدعوة',
      approvalFlow: 'مسار الموافقة',
      accountLinked: 'حسابك مرتبط بالفعل بهذه الدعوة',
      accountNotLinked: 'الدعوة موجودة، لكن مزامنة النشاط لم تستقر بعد',
      classPulse: 'نبض الصف',
      myPath: 'مسارك في الصف',
      noClassSessions: 'لا توجد جلسات لهذا الصف بعد.',
      noStudentHistory: 'سيظهر تاريخك الشخصي هنا بعد أن تلعب أو تتدرب من خلال هذا الصف.',
      accuracy: 'الدقة',
      sessions: 'الجلسات',
      liveRooms: 'الغرف الحية',
      packQuestions: 'أسئلة الحزمة',
      lockedUntilApproval: 'إجراءات الصف تُفتح فورًا بعد الموافقة.',
      readyForClass: 'هذا الصف مفتوح لك الآن. يمكنك الدخول والتدرب ومتابعة تقدمك.',
      enterPractice: 'افتح تدريب الصف',
      classMission: 'مهمة الصف التالية',
      classMissionFallback: 'الخطوة التالية هي تقوية قصيرة على نفس المادة لتثبيت الإتقان قبل الجلسة القادمة.',
      classSnapshot: 'لقطة الحالة',
      packReady: 'الحزمة مرتبطة',
      packMissing: 'لا توجد حزمة مرتبطة بعد',
      classWorkspace: 'مساحة صفك',
      classWorkspaceBody: 'كل ما يخص هذا الصف تحديدًا: غرفة حية، حزمة، سجل الصف، وخطوتك التالية داخله.',
      workspaceReady: 'متاح الآن',
      workspaceLocked: 'يفتح بعد الموافقة',
      historyReady: 'الصف بدأ يبني تاريخًا',
      historyMissing: 'لا يوجد سجل صف بعد',
      sessionStarted: 'بدأ',
      sessionEnded: 'انتهى',
      inviteSent: 'الدعوة',
      approvedAt: 'الموافقة',
      lastSeen: 'آخر ظهور',
      openPracticeHint: 'التدريب التكيفي على نفس المادة سيساعدك على الوصول أكثر جاهزية إلى الجلسة التالية.',
    },
    en: {
      back: 'Back to student space',
      loading: 'Loading class page...',
      failed: 'We could not load this class page.',
      retry: 'Retry',
      joinLive: 'Join live session',
      practice: 'Focused practice',
      approve: 'Approve this class',
      approving: 'Approving...',
      latestRuns: 'Class history',
      yourRuns: 'Your progress in this class',
      assignedPack: 'Assigned pack',
      nextMove: 'Your next move',
      notes: 'What matters now',
      pendingTitle: 'This class is waiting for your approval',
      pendingBody: 'Your teacher already added you to this class. Once you approve it, the class will move into your active student space with progress, practice, and live-room access.',
      readyLabel: 'Active class',
      pendingLabel: 'Waiting approval',
      liveOpen: 'Live session open',
      liveClosed: 'No live session is open right now',
      focusNow: 'Focus now',
      unlockTitle: 'What unlocks after approval',
      unlockStepInvite: 'The class moves into your active student space',
      unlockStepLive: 'You get direct access to class live rooms',
      unlockStepPractice: 'You unlock practice tuned to the same material',
      unlockStepHistory: 'You can track your progress in the context of this class',
      delivery: 'Invite delivery',
      approvalFlow: 'Approval flow',
      accountLinked: 'Your account is already linked to this invite',
      accountNotLinked: 'The invite exists, but activity sync is not stable yet',
      classPulse: 'Class pulse',
      myPath: 'Your path in this class',
      noClassSessions: 'There are no class sessions yet.',
      noStudentHistory: 'Your personal class history will appear here after you play or practice through this class flow.',
      accuracy: 'Accuracy',
      sessions: 'Sessions',
      liveRooms: 'Live rooms',
      packQuestions: 'Pack questions',
      lockedUntilApproval: 'Class actions unlock as soon as you approve this class.',
      readyForClass: 'This class is already open for you. You can enter, practice, and track your progress.',
      enterPractice: 'Open class practice',
      classMission: 'Next class mission',
      classMissionFallback: 'Your next step is a short same-material reset so you feel more stable before the next class run.',
      classSnapshot: 'Snapshot',
      packReady: 'Pack connected',
      packMissing: 'No pack connected yet',
      classWorkspace: 'Your class workspace',
      classWorkspaceBody: 'Everything specific to this class: live room, pack, class history, and your next action inside it.',
      workspaceReady: 'Available now',
      workspaceLocked: 'Unlocks after approval',
      historyReady: 'This class is already generating history',
      historyMissing: 'This class has no history yet',
      sessionStarted: 'Started',
      sessionEnded: 'Ended',
      inviteSent: 'Invite',
      approvedAt: 'Approval',
      lastSeen: 'Last seen',
      openPracticeHint: 'Adaptive practice on the same material will help you show up steadier for the next class session.',
    },
  } as const)[language as 'he' | 'ar' | 'en'] || {
    back: 'Back to student space',
    loading: 'Loading class page...',
    failed: 'We could not load this class page.',
    retry: 'Retry',
    joinLive: 'Join live session',
    practice: 'Focused practice',
    approve: 'Approve this class',
    approving: 'Approving...',
    latestRuns: 'Class history',
    yourRuns: 'Your progress in this class',
    assignedPack: 'Assigned pack',
    nextMove: 'Your next move',
    notes: 'What matters now',
    pendingTitle: 'This class is waiting for your approval',
    pendingBody: 'Approve the class to unlock the class workspace.',
    readyLabel: 'Active class',
    pendingLabel: 'Waiting approval',
    liveOpen: 'Live session open',
    liveClosed: 'No live session is open right now',
    focusNow: 'Focus now',
    unlockTitle: 'What unlocks after approval',
    unlockStepInvite: 'The class moves into your active student space',
    unlockStepLive: 'You get direct access to class live rooms',
    unlockStepPractice: 'You unlock practice tuned to the same material',
    unlockStepHistory: 'You can track your progress in the context of this class',
    delivery: 'Invite delivery',
    approvalFlow: 'Approval flow',
    accountLinked: 'Your account is already linked to this invite',
    accountNotLinked: 'The invite exists, but activity sync is not stable yet',
    classPulse: 'Class pulse',
    myPath: 'Your path in this class',
    noClassSessions: 'There are no class sessions yet.',
    noStudentHistory: 'Your personal class history will appear here after you play or practice through this class flow.',
    accuracy: 'Accuracy',
    sessions: 'Sessions',
    liveRooms: 'Live rooms',
    packQuestions: 'Pack questions',
    lockedUntilApproval: 'Class actions unlock as soon as you approve this class.',
    readyForClass: 'This class is already open for you.',
    enterPractice: 'Open class practice',
    classMission: 'Next class mission',
    classMissionFallback: 'Short same-material reset.',
    classSnapshot: 'Snapshot',
    packReady: 'Pack connected',
    packMissing: 'No pack connected yet',
    classWorkspace: 'Your class workspace',
    classWorkspaceBody: 'Everything specific to this class.',
    workspaceReady: 'Available now',
    workspaceLocked: 'Unlocks after approval',
    historyReady: 'This class is already generating history',
    historyMissing: 'This class has no history yet',
    sessionStarted: 'Started',
    sessionEnded: 'Ended',
    inviteSent: 'Invite',
    approvedAt: 'Approval',
    lastSeen: 'Last seen',
    openPracticeHint: 'Adaptive practice will help before the next class session.',
  };

  const loadClass = useCallback(async () => {
    let payload: any;
    try {
      setLoading(true);
      setError('');
      try {
        payload = await apiFetchJson(`/api/student/me/classes/${classId}`);
      } catch (classError: any) {
        const message = String(classError?.message || '');
        if (!message.includes('API route not found')) {
          throw classError;
        }
        const portalPayload = await apiFetchJson('/api/student/me');
        const allClasses = [
          ...(Array.isArray(portalPayload?.active_classes) ? portalPayload.active_classes : []),
          ...(Array.isArray(portalPayload?.pending_classes) ? portalPayload.pending_classes : []),
          ...(Array.isArray(portalPayload?.classes) ? portalPayload.classes : []),
        ];
        const matchedClass = allClasses.find((entry: any) => Number(entry?.class_id || 0) === Number(classId || 0)) || null;
        if (!matchedClass) {
          throw classError;
        }
        payload = {
          student: portalPayload.student,
          class: matchedClass,
          practice_defaults: portalPayload.practice_defaults,
          recommendations: portalPayload.recommendations,
          student_memory: portalPayload.student_memory,
          session_history: Array.isArray(portalPayload.session_history) ? portalPayload.session_history : [],
          class_progress: {
            accuracy: matchedClass?.stats?.average_accuracy ?? null,
            session_count: Number(matchedClass?.stats?.session_count || 0),
            active_session_count: Number(matchedClass?.stats?.active_session_count || 0),
          },
        };
      }
      setData(payload);
    } catch (loadError: any) {
      setError(loadError?.message || copy.failed);
    } finally {
      setLoading(false);
    }
  }, [classId, copy.failed]);

  useEffect(() => {
    void loadClass();
  }, [loadClass]);

  const practicePath = useMemo(() => buildPracticePath(data), [data]);
  const classRow = data?.class || null;
  const isClaimed = String(classRow?.approval_state || classRow?.invite_status || 'none') === 'claimed';
  const activeSession = classRow?.active_session || null;
  const hasLiveRoom = Boolean(isClaimed && activeSession?.pin);
  const classHistory = Array.isArray(classRow?.recent_sessions) ? classRow.recent_sessions : [];
  const personalHistory = Array.isArray(data?.session_history) ? data.session_history : [];
  const weakTags = Array.isArray(data?.recommendations?.weak_tags) ? data.recommendations.weak_tags.slice(0, 4) : [];
  const practiceHeadline = data?.recommendations?.next_step?.title || data?.student_memory?.summary?.headline || copy.practice;
  const practiceBody =
    data?.recommendations?.next_step?.body ||
    data?.student_memory?.summary?.body ||
    copy.classMissionFallback;

  const unlockSteps = [
    {
      id: 'invite',
      done: Boolean(classRow?.invite_sent_at) || String(classRow?.invite_delivery_status || 'none') === 'claimed',
      title: copy.unlockStepInvite,
      meta: classRow?.invite_sent_at ? `${copy.inviteSent}: ${formatRelativeTime(classRow.invite_sent_at)}` : formatDeliveryLabel(classRow?.invite_delivery_status || 'none', language),
    },
    {
      id: 'account',
      done: Boolean(classRow?.linked_account),
      title: copy.unlockStepPractice,
      meta: classRow?.linked_account ? copy.accountLinked : copy.accountNotLinked,
    },
    {
      id: 'approval',
      done: isClaimed,
      title: copy.unlockStepHistory,
      meta: classRow?.claimed_at ? `${copy.approvedAt}: ${formatRelativeTime(classRow.claimed_at)}` : copy.pendingLabel,
    },
    {
      id: 'active',
      done: Boolean(classRow?.last_seen_at),
      title: copy.unlockStepLive,
      meta: classRow?.last_seen_at ? `${copy.lastSeen}: ${formatRelativeTime(classRow.last_seen_at)}` : copy.lockedUntilApproval,
    },
  ];

  const handleAccept = async () => {
    if (!classId) return;
    try {
      setAccepting(true);
      await apiFetchJson(`/api/student/me/classes/${classId}/accept`, {
        method: 'POST',
      });
      await loadClass();
    } catch (acceptError: any) {
      setError(acceptError?.message || copy.failed);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="rounded-[2rem] border-2 border-brand-dark bg-white px-8 py-6 font-black shadow-[4px_4px_0px_0px_#1A1A1A]">
          {copy.loading}
        </div>
      </div>
    );
  }

  if (!data?.class) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="max-w-xl rounded-[2rem] border-2 border-brand-dark bg-white p-8 text-center shadow-[4px_4px_0px_0px_#1A1A1A]">
          <p className="mb-3 text-3xl font-black">{copy.failed}</p>
          <p className="mb-6 font-bold text-brand-dark/65">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black"
          >
            {copy.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#FFF7E8_0%,_#F9F4EC_42%,_#EEF4FB_100%)] px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/student/me" className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 font-black">
            <ArrowLeft className="w-4 h-4" />
            {copy.back}
          </Link>
          <div className="flex flex-wrap gap-3">
            {!isClaimed ? (
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={accepting}
                className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {accepting ? copy.approving : copy.approve}
              </button>
            ) : null}
            {hasLiveRoom ? (
              <Link to={`/student/session/${activeSession.pin}/play`} className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black">
                {copy.joinLive}
              </Link>
            ) : null}
            {isClaimed ? (
              <Link to={practicePath} className="rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white">
                {copy.enterPractice}
              </Link>
            ) : null}
          </div>
        </div>

        <section className="rounded-[2.6rem] border-4 border-brand-dark bg-white p-8 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-brand-orange">
                {classRow.class_subject} • {classRow.class_grade}
              </p>
              <h1 className="text-4xl font-black text-brand-dark md:text-5xl">{classRow.class_name}</h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill tone={isClaimed ? 'ready' : 'pending'}>
                  {isClaimed ? copy.readyLabel : copy.pendingLabel}
                </StatusPill>
                <StatusPill tone={hasLiveRoom ? 'live' : 'neutral'}>
                  {hasLiveRoom ? copy.liveOpen : copy.liveClosed}
                </StatusPill>
                <StatusPill tone={classRow.pack ? 'ready' : 'neutral'}>
                  {classRow.pack ? copy.packReady : copy.packMissing}
                </StatusPill>
              </div>
              <p className="mt-4 text-lg font-bold text-brand-dark/65">
                {isClaimed
                  ? classRow.class_notes || copy.readyForClass
                  : copy.pendingBody}
              </p>
            </div>

            <div className="w-full max-w-md rounded-[1.9rem] border-2 border-brand-dark bg-brand-dark p-5 text-white shadow-[6px_6px_0px_0px_#FF5A36]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-yellow">
                    {isClaimed ? copy.classMission : copy.pendingLabel}
                  </p>
                  <p className="text-2xl font-black">
                    {isClaimed ? practiceHeadline : copy.pendingTitle}
                  </p>
                </div>
                {isClaimed ? <Rocket className="h-6 w-6 text-brand-yellow" /> : <Lock className="h-6 w-6 text-brand-yellow" />}
              </div>
              <p className="mt-3 font-medium text-white/75">
                {isClaimed ? practiceBody : copy.pendingBody}
              </p>
              {isClaimed ? (
                <Link
                  to={practicePath}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark"
                >
                  {copy.enterPractice}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={accepting}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {accepting ? copy.approving : copy.approve}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
          <div className="mb-5 flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-brand-orange" />
            <div>
              <h2 className="text-3xl font-black">{copy.classWorkspace}</h2>
              <p className="text-sm font-bold text-brand-dark/60">{copy.classWorkspaceBody}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkspaceCard
              label={copy.joinLive}
              value={hasLiveRoom ? copy.liveOpen : copy.liveClosed}
              meta={
                hasLiveRoom
                  ? `${copy.liveRooms}: ${Number(data.class_progress?.active_session_count || 0)}`
                  : isClaimed
                    ? copy.liveClosed
                    : copy.workspaceLocked
              }
              tone={hasLiveRoom ? 'ready' : isClaimed ? 'neutral' : 'locked'}
              badge={hasLiveRoom ? copy.workspaceReady : isClaimed ? copy.readyLabel : copy.workspaceLocked}
              action={
                hasLiveRoom ? (
                  <Link
                    to={`/student/session/${activeSession.pin}/play`}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black text-brand-dark"
                  >
                    {copy.joinLive}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null
              }
            />
            <WorkspaceCard
              label={copy.enterPractice}
              value={isClaimed ? practiceHeadline : copy.pendingLabel}
              meta={isClaimed ? practiceBody : copy.workspaceLocked}
              tone={isClaimed ? 'ready' : 'locked'}
              badge={isClaimed ? copy.workspaceReady : copy.workspaceLocked}
              action={
                isClaimed ? (
                  <Link
                    to={practicePath}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white"
                  >
                    {copy.enterPractice}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null
              }
            />
            <WorkspaceCard
              label={copy.latestRuns}
              value={classHistory.length > 0 ? `${classHistory.length} ${copy.sessions}` : copy.historyMissing}
              meta={
                classHistory.length > 0
                  ? formatRelativeTime(classHistory[0]?.ended_at || classHistory[0]?.started_at)
                  : copy.noClassSessions
              }
              tone={classHistory.length > 0 ? 'neutral' : 'locked'}
              badge={classHistory.length > 0 ? copy.workspaceReady : copy.workspaceLocked}
            />
            <WorkspaceCard
              label={copy.assignedPack}
              value={classRow.pack?.title || copy.packMissing}
              meta={
                classRow.pack
                  ? `${Number(classRow.pack?.question_count || 0)} ${copy.packQuestions}`
                  : copy.workspaceLocked
              }
              tone={classRow.pack ? 'neutral' : 'locked'}
              badge={classRow.pack ? copy.workspaceReady : copy.workspaceLocked}
            />
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: copy.accuracy,
              value:
                data.class_progress?.accuracy === null || data.class_progress?.accuracy === undefined
                  ? 'No data'
                  : `${Math.round(Number(data.class_progress?.accuracy || 0))}%`,
              icon: Target,
            },
            { label: copy.sessions, value: `${Number(data.class_progress?.session_count || 0)}`, icon: CalendarClock },
            { label: copy.liveRooms, value: `${Number(data.class_progress?.active_session_count || 0)}`, icon: PlayCircle },
            { label: copy.packQuestions, value: `${Number(classRow.pack?.question_count || 0)}`, icon: BrainCircuit },
          ].map((card) => (
            <div key={card.label} className="rounded-[1.8rem] border-4 border-brand-dark bg-white p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-dark/45">{card.label}</p>
                <card.icon className="h-5 w-5 text-brand-orange" />
              </div>
              <p className="mt-4 text-4xl font-black text-brand-dark">{card.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-brand-orange" />
                <div>
                  <h2 className="text-3xl font-black">{copy.approvalFlow}</h2>
                  <p className="text-sm font-bold text-brand-dark/60">{isClaimed ? copy.readyForClass : copy.lockedUntilApproval}</p>
                </div>
              </div>
              <div className="space-y-3">
                {unlockSteps.map((step, index) => (
                  <div key={step.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-dark font-black ${
                          step.done ? 'bg-brand-yellow text-brand-dark' : 'bg-white text-brand-dark/45'
                        }`}>
                          {step.done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                        </div>
                        <div>
                          <p className="font-black text-brand-dark">{step.title}</p>
                          <p className="text-sm font-bold text-brand-dark/55">{step.meta}</p>
                        </div>
                      </div>
                      <StatusPill tone={step.done ? 'ready' : 'neutral'}>
                        {step.done ? copy.readyLabel : copy.pendingLabel}
                      </StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <BookOpen className="h-6 w-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.assignedPack}</h2>
              </div>
              {classRow.pack ? (
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="text-2xl font-black">{classRow.pack.title}</p>
                  <p className="mt-2 font-bold text-brand-dark/65">{classRow.pack.question_count} questions</p>
                  <p className="mt-4 text-sm font-bold text-brand-dark/60">{copy.openPracticeHint}</p>
                </div>
              ) : (
                <p className="font-bold text-brand-dark/60">{copy.packMissing}</p>
              )}
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <Clock3 className="h-6 w-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.classSnapshot}</h2>
              </div>
              <div className="space-y-3 font-bold text-brand-dark/70">
                <p>{copy.delivery}: {formatDeliveryLabel(classRow.invite_delivery_status, language)}</p>
                <p>{copy.inviteSent}: {classRow.invite_sent_at ? formatRelativeTime(classRow.invite_sent_at) : formatDeliveryLabel(classRow.invite_delivery_status, language)}</p>
                <p>{copy.approvedAt}: {classRow.claimed_at ? formatRelativeTime(classRow.claimed_at) : copy.pendingLabel}</p>
                <p>{copy.lastSeen}: {formatRelativeTime(classRow.last_seen_at)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <Rocket className="h-6 w-6 text-brand-orange" />
                <div>
                  <h2 className="text-3xl font-black">{copy.nextMove}</h2>
                  <p className="text-sm font-bold text-brand-dark/60">{copy.focusNow}</p>
                </div>
              </div>
              <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5">
                <p className="text-2xl font-black text-brand-dark">{practiceHeadline}</p>
                <p className="mt-3 font-medium text-brand-dark/70">{practiceBody}</p>
                {weakTags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {weakTags.map((tag: string) => (
                      <span key={tag} className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {isClaimed ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {hasLiveRoom ? (
                      <Link
                        to={`/student/session/${activeSession.pin}/play`}
                        className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black text-brand-dark"
                      >
                        {copy.joinLive}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                    <Link
                      to={practicePath}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white"
                    >
                      {copy.enterPractice}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <CalendarClock className="h-6 w-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.latestRuns}</h2>
              </div>
              <div className="space-y-3">
                {classHistory.length > 0 ? classHistory.map((session: any) => (
                  <div key={session.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-lg">Session #{session.id}</p>
                        <p className="font-medium text-brand-dark/65">
                          {String(session.status || '').toUpperCase() === 'ENDED'
                            ? `${copy.sessionEnded}: ${formatRelativeTime(session.ended_at || session.started_at)}`
                            : `${copy.sessionStarted}: ${formatRelativeTime(session.started_at)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                          {session.participant_count} players
                        </span>
                        {isClaimed && String(session.status || '').toUpperCase() !== 'ENDED' && session.pin ? (
                          <Link to={`/student/session/${session.pin}/play`} className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-1 text-xs font-black">
                            {copy.joinLive}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">{copy.noClassSessions}</p>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <div className="mb-5 flex items-center gap-3">
                <Target className="h-6 w-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{copy.myPath}</h2>
              </div>
              <div className="space-y-3">
                {personalHistory.length > 0 ? personalHistory.map((row: any, index: number) => (
                  <div key={`${row.session_id}-${index}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-lg">{row.pack_title || `Session #${row.session_id}`}</p>
                        <p className="font-medium text-brand-dark/65">{formatRelativeTime(row.ended_at || row.started_at || row.joined_at)}</p>
                      </div>
                      <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                        {Math.round(Number(row.accuracy_pct || row.accuracy || 0))}% {copy.accuracy}
                      </span>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">{copy.noStudentHistory}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'ready' | 'pending' | 'live' | 'neutral';
}) {
  const className =
    tone === 'ready'
      ? 'bg-emerald-100 text-emerald-800'
      : tone === 'pending'
        ? 'bg-brand-yellow text-brand-dark'
        : tone === 'live'
          ? 'bg-brand-dark text-white'
          : 'bg-white text-brand-dark';

  return (
    <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${className}`}>
      {children}
    </span>
  );
}

function WorkspaceCard({
  label,
  value,
  meta,
  tone,
  badge,
  action,
}: {
  label: string;
  value: string;
  meta: string;
  tone: 'ready' | 'neutral' | 'locked';
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{label}</p>
        <span
          className={`rounded-full border-2 border-brand-dark px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
            tone === 'ready'
              ? 'bg-emerald-100 text-emerald-800'
              : tone === 'locked'
                ? 'bg-white text-brand-dark/50'
                : 'bg-brand-yellow text-brand-dark'
          }`}
        >
          {badge}
        </span>
      </div>
      <p className="mt-4 text-2xl font-black leading-tight text-brand-dark">{value}</p>
      <p className="mt-3 text-sm font-bold text-brand-dark/60">{meta}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
