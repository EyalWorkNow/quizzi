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
import { enterLinkedStudentLiveSession, hasStoredLiveSeatForPin } from '../lib/studentLiveSession.ts';
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
  const classId = Number(query.class_id || payload?.class?.class_id || payload?.class?.id || 0);
  const assignmentId = Number(query.assignment_id || payload?.assignment?.id || 0);
  if (classId > 0) params.set('class_id', String(classId));
  if (assignmentId > 0) params.set('assignment_id', String(assignmentId));
  const suffix = params.toString();
  return suffix ? `/student/me/practice?${suffix}` : '/student/me/practice';
}

function buildAssignmentPracticePath(payload: any, assignment: any, mode: 'adaptive' | 'lesson' = 'adaptive') {
  const query = payload?.practice_defaults || payload?.recommendations?.comeback_mission?.practice_query || {};
  const params = new URLSearchParams();
  const count = Number(
    mode === 'lesson'
      ? Math.min(Number(assignment?.question_goal || 10) || 10, 50)
      : (assignment?.question_goal || query.count || query.question_count || 0),
  );
  if (count > 0) {
    params.set('count', String(count));
  }
  if (Array.isArray(query.focus_tags) && query.focus_tags.length > 0) {
    params.set('focus_tags', query.focus_tags.join(','));
  }
  params.set('mission', String(mode === 'lesson' ? 'lesson_study' : (query.mission || 'class_focus')));
  params.set('mode', mode);
  if (assignment?.title) params.set('mission_label', String(assignment.title));
  const classId = Number(payload?.class?.class_id || payload?.class?.id || assignment?.class_id || query.class_id || 0);
  const assignmentId = Number(assignment?.id || query.assignment_id || 0);
  if (classId > 0) params.set('class_id', String(classId));
  if (assignmentId > 0) params.set('assignment_id', String(assignmentId));
  const suffix = params.toString();
  return suffix ? `/student/me/practice?${suffix}` : '/student/me/practice';
}

function buildPackPracticePath(payload: any, pack: any, mode: 'adaptive' | 'lesson' = 'adaptive') {
  const query = payload?.practice_defaults || payload?.recommendations?.comeback_mission?.practice_query || {};
  const params = new URLSearchParams();
  const count = Number(
    mode === 'lesson'
      ? Math.min(Number(pack?.question_count || 10) || 10, 50)
      : (query.count || query.question_count || 5),
  );
  if (count > 0) params.set('count', String(count));
  if (Array.isArray(query.focus_tags) && query.focus_tags.length > 0) {
    params.set('focus_tags', query.focus_tags.join(','));
  }
  params.set('mission', String(mode === 'lesson' ? 'lesson_study' : (query.mission || 'class_focus')));
  params.set('mode', mode);
  if (pack?.title) params.set('mission_label', String(pack.title));
  const classId = Number(payload?.class?.class_id || payload?.class?.id || 0);
  const packId = Number(pack?.id || 0);
  if (classId > 0) params.set('class_id', String(classId));
  if (packId > 0) params.set('pack_id', String(packId));
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

function formatDueDateTime(value?: string | null, language = 'en') {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
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
  const [enteringLive, setEnteringLive] = useState(false);
  const [liveEntryError, setLiveEntryError] = useState('');

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
      sharedLessons: 'שיעורים ומשימות פתוחים',
      sharedLessonsBody: 'אפשר לבחור שיעור מסוים שהמורה שיתף איתך ולתרגל אותו בזמן הפנוי שלך.',
      practiceThisLesson: 'תרגל את השיעור הזה',
      studyThisLesson: 'למד את השיעור הזה',
      lessonAvailable: 'זמין לתרגול',
      lessonCardMeta: 'חומר ממוקד ששויך אליך מתוך הכיתה הזאת.',
      allLessonsFallback: 'עדיין אין שיעורים פתוחים לבחירה בכיתה הזאת.',
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
      sharedLessons: 'دروس ومهام متاحة',
      sharedLessonsBody: 'يمكنك اختيار درس محدد شاركه المعلم معك والتدرب عليه في وقت فراغك.',
      practiceThisLesson: 'تدرّب على هذا الدرس',
      studyThisLesson: 'ادرس هذا الدرس',
      lessonAvailable: 'متاح للتدريب',
      lessonCardMeta: 'مادة مركزة تمت مشاركتها معك من هذا الصف.',
      allLessonsFallback: 'لا توجد دروس متاحة للاختيار في هذا الصف بعد.',
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
      sharedLessons: 'Shared lessons',
      sharedLessonsBody: 'Choose a specific lesson your teacher shared with you and practice it in your free time.',
      practiceThisLesson: 'Practice this lesson',
      studyThisLesson: 'Study this lesson',
      lessonAvailable: 'Ready to practice',
      lessonCardMeta: 'Focused material shared with you from this class.',
      allLessonsFallback: 'No class lessons are available to choose yet.',
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
    sharedLessons: 'Shared lessons',
    sharedLessonsBody: 'Choose a specific lesson your teacher shared with you and practice it in your free time.',
    practiceThisLesson: 'Practice this lesson',
    studyThisLesson: 'Study this lesson',
    lessonAvailable: 'Ready to practice',
    lessonCardMeta: 'Focused material shared with you from this class.',
    allLessonsFallback: 'No class lessons are available to choose yet.',
  };

  const loadClass = useCallback(async () => {
    let payload: any;
    try {
      setLoading(true);
      setError('');
      try {
        payload = await apiFetchJson(`/api/student/me/classes/${classId}`);
      } catch (classError: any) {
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
          assignment: null,
          assignments: [],
          class_progress: {
            accuracy: matchedClass?.stats?.average_accuracy ?? null,
            session_count: Number(matchedClass?.stats?.session_count || 0),
            active_session_count: Number(matchedClass?.stats?.active_session_count || 0),
          },
        };
        console.warn('[StudentClassView] Falling back to student portal payload for class view:', {
          classId,
          message: String(classError?.message || 'Unknown class detail error'),
        });
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
  const hasLiveRoom = Boolean(activeSession?.pin);
  const liveSessionStatus = String(activeSession?.status || '').toUpperCase();
  const describeLiveAction = (sessionPin?: string | null, sessionStatus?: string | null, resumeAvailable = false) => {
    const normalizedPin = String(sessionPin || '').trim();
    const normalizedStatus = String(sessionStatus || '').toUpperCase();
    const hasStoredSeat = normalizedPin ? hasStoredLiveSeatForPin(normalizedPin) : false;
    const hasRecoverableSeat = hasStoredSeat || resumeAvailable;

    if (hasRecoverableSeat) {
      return {
        hasStoredSeat,
        hasRecoverableSeat: true,
        disabled: false,
        label: language === 'he' ? 'חזרה למשחק חי' : language === 'ar' ? 'العودة إلى اللعبة الحية' : 'Return to live game',
      };
    }

    if (normalizedStatus === 'LOBBY') {
      return {
        hasStoredSeat: false,
        hasRecoverableSeat: false,
        disabled: false,
        label: copy.joinLive,
      };
    }

    return {
      hasStoredSeat: false,
      hasRecoverableSeat: false,
      disabled: true,
      label: language === 'he' ? 'המתן ללובי' : language === 'ar' ? 'انتظر الردهة' : 'Wait for lobby',
    };
  };
  const liveAction = describeLiveAction(
    String(activeSession?.pin || ''),
    liveSessionStatus,
    Boolean(activeSession?.resume_available),
  );
  const hasStoredSeatForLiveRoom = liveAction.hasStoredSeat;
  const hasRecoverableSeatForLiveRoom = liveAction.hasRecoverableSeat;
  const canEnterLiveRoom = !liveAction.disabled;
  const classHistory = Array.isArray(classRow?.recent_sessions) ? classRow.recent_sessions : [];
  const personalHistory = Array.isArray(data?.session_history) ? data.session_history : [];
  const classPacks = Array.isArray(classRow?.packs) ? classRow.packs : classRow?.pack ? [classRow.pack] : [];
  const weakTags = Array.isArray(data?.recommendations?.weak_tags) ? data.recommendations.weak_tags.slice(0, 4) : [];
  const assignment = data?.assignment || null;
  const assignments = Array.isArray(data?.assignments) ? data.assignments : assignment ? [assignment] : [];
  const availableLessons = assignments.filter((row: any) => Number(row?.id || 0) > 0);
  const practiceHeadline = data?.recommendations?.next_step?.title || data?.student_memory?.summary?.headline || copy.practice;
  const practiceBody =
    data?.recommendations?.next_step?.body ||
    data?.student_memory?.summary?.body ||
    copy.classMissionFallback;
  const liveBadgeLabel =
    !hasLiveRoom
      ? copy.liveClosed
      : hasRecoverableSeatForLiveRoom
        ? (language === 'he' ? 'חזרה לחדר החי' : language === 'ar' ? 'عودة إلى الغرفة الحية' : 'Return to live room')
        : liveSessionStatus === 'LOBBY'
          ? copy.liveOpen
          : (language === 'he' ? 'המשחק כבר התחיל' : language === 'ar' ? 'اللعبة بدأت بالفعل' : 'Game underway');
  const liveButtonLabel = liveAction.label;
  const liveHelperText =
    !hasLiveRoom
      ? copy.liveClosed
      : hasRecoverableSeatForLiveRoom
        ? hasStoredSeatForLiveRoom
          ? (language === 'he'
            ? 'כבר יש לך מושב שמור בסשן הזה על המכשיר הזה.'
            : language === 'ar'
              ? 'لديك بالفعل مقعد محفوظ في هذه الجلسة على هذا الجهاز.'
              : 'You already have a saved seat in this session on this device.')
          : (language === 'he'
            ? 'החשבון שלך כבר שויך לסשן הזה, ולכן אפשר לשחזר את המושב גם בלי זיכרון מקומי.'
            : language === 'ar'
              ? 'حسابك مرتبط بهذه الجلسة بالفعل، لذلك يمكن استعادة المقعد حتى بدون ذاكرة محلية.'
              : 'Your account is already linked to this session, so we can restore the seat even without local device memory.')
        : liveSessionStatus === 'LOBBY'
          ? (language === 'he'
            ? 'הלובי פתוח עכשיו ואפשר להיכנס ישירות.'
            : language === 'ar'
              ? 'الردهة مفتوحة الآن ويمكنك الدخول مباشرة.'
              : 'The lobby is open and you can enter directly.')
          : (language === 'he'
            ? 'אם כבר נכנסת קודם ננסה לשחזר אותך. אם לא, תצטרך לחכות לפתיחת הלובי.'
            : language === 'ar'
              ? 'إذا دخلت سابقًا فسنحاول استعادتك. وإلا ستحتاج إلى انتظار فتح الردهة.'
              : 'If you already joined before, we will try to restore you. Otherwise, wait for the lobby to reopen.');
  const classSummary = `${classRow?.class_subject || ''}${classRow?.class_subject && classRow?.class_grade ? ' • ' : ''}${classRow?.class_grade || ''}`.trim();
  const completionPct = Math.max(6, Math.min(100, Number(assignment?.progress?.completion_pct || 0)));

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

  const handleEnterLive = async (sessionPin?: string | null) => {
    const targetPin = String(sessionPin || activeSession?.pin || '').trim();
    if (!targetPin) return;

    try {
      setEnteringLive(true);
      setLiveEntryError('');
      await enterLinkedStudentLiveSession({
        pin: targetPin,
        nickname: data?.student?.display_name || '',
      });
      window.location.assign(`/student/session/${targetPin}/play`);
    } catch (liveError: any) {
      setLiveEntryError(String(liveError?.message || copy.failed));
    } finally {
      setEnteringLive(false);
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
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,_rgba(180,136,255,0.22),_transparent_30%),radial-gradient(circle_at_top_left,_rgba(255,209,59,0.3),_transparent_32%),linear-gradient(180deg,_#FFF8E9_0%,_#FDF4EA_38%,_#EEF4FB_100%)] px-4 py-4 sm:px-6 sm:py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/student/me" className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white/90 px-4 py-2 font-black shadow-[0_6px_0_0_#1A1A1A] transition-transform duration-200 hover:-translate-y-0.5">
            <ArrowLeft className="w-4 h-4" />
            {copy.back}
          </Link>
          <div className="flex flex-wrap gap-3">
            {!isClaimed ? (
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={accepting}
                className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white shadow-[0_6px_0_0_#FF5A36] disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {accepting ? copy.approving : copy.approve}
              </button>
            ) : null}
            {hasLiveRoom ? (
              <button
                type="button"
                onClick={() => void handleEnterLive(String(activeSession?.pin || ''))}
                disabled={enteringLive || !canEnterLiveRoom}
                className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black shadow-[0_6px_0_0_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enteringLive ? copy.approving : liveButtonLabel}
              </button>
            ) : null}
            {isClaimed ? (
              <Link to={practicePath} className="rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white shadow-[0_6px_0_0_#B488FF]">
                {copy.enterPractice}
              </Link>
            ) : null}
          </div>
        </div>

        <section className="relative isolate overflow-hidden rounded-[2.8rem] border-4 border-brand-dark bg-white px-6 py-7 shadow-[12px_12px_0px_0px_#1A1A1A] sm:px-8 sm:py-8">
          <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(135deg,_rgba(255,209,59,0.24)_0%,_rgba(255,90,54,0.18)_38%,_rgba(180,136,255,0.16)_100%)]" />
          <div className="absolute -left-16 top-20 h-44 w-44 rounded-full bg-brand-yellow/20 blur-2xl" />
          <div className="absolute -right-10 bottom-0 h-52 w-52 rounded-full bg-brand-purple/20 blur-2xl" />
          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch">
            <div className="flex-1">
              <div className="inline-flex rounded-full border-2 border-brand-dark bg-white/90 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-brand-orange shadow-[0_4px_0_0_#1A1A1A]">
                {classSummary || copy.classWorkspace}
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[0.95] text-brand-dark sm:text-5xl xl:text-6xl">{classRow.class_name}</h1>
              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone={isClaimed ? 'ready' : 'pending'}>{isClaimed ? copy.readyLabel : copy.pendingLabel}</StatusPill>
                <StatusPill tone={hasLiveRoom ? 'live' : 'neutral'}>{liveBadgeLabel}</StatusPill>
                <StatusPill tone={classRow.pack ? 'ready' : 'neutral'}>{classRow.pack ? copy.packReady : copy.packMissing}</StatusPill>
              </div>
              <p className="mt-5 max-w-3xl text-base font-bold leading-7 text-brand-dark/70 sm:text-lg">
                {isClaimed ? classRow.class_notes || copy.readyForClass : copy.pendingBody}
              </p>
              {hasLiveRoom ? <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-brand-dark/55">{liveHelperText}</p> : null}

              <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <HeroStatCard
                  label={copy.accuracy}
                  value={data.class_progress?.accuracy === null || data.class_progress?.accuracy === undefined ? '--' : `${Math.round(Number(data.class_progress?.accuracy || 0))}%`}
                  icon={<Target className="h-4 w-4" />}
                  accent="orange"
                />
                <HeroStatCard label={copy.sessions} value={`${Number(data.class_progress?.session_count || 0)}`} icon={<CalendarClock className="h-4 w-4" />} accent="yellow" />
                <HeroStatCard label={copy.liveRooms} value={`${Number(data.class_progress?.active_session_count || 0)}`} icon={<PlayCircle className="h-4 w-4" />} accent="purple" />
                <HeroStatCard label={copy.packQuestions} value={`${Number(classRow.pack?.question_count || 0)}`} icon={<BrainCircuit className="h-4 w-4" />} accent="dark" />
              </div>
            </div>

            <div className="w-full xl:max-w-[360px]">
              <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-dark p-5 text-white shadow-[8px_8px_0px_0px_#FF5A36]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-yellow">
                      {isClaimed ? copy.classMission : copy.pendingLabel}
                    </p>
                    <p className="text-2xl font-black leading-tight">{isClaimed ? practiceHeadline : copy.pendingTitle}</p>
                  </div>
                  {isClaimed ? <Rocket className="h-6 w-6 text-brand-yellow" /> : <Lock className="h-6 w-6 text-brand-yellow" />}
                </div>
                <p className="mt-3 font-medium leading-7 text-white/78">{isClaimed ? practiceBody : copy.pendingBody}</p>
                {isClaimed ? (
                  <Link to={practicePath} className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark shadow-[0_4px_0_0_#FFFFFF]">
                    {copy.enterPractice}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={accepting}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark shadow-[0_4px_0_0_#FFFFFF] disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {accepting ? copy.approving : copy.approve}
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MiniInsightCard title={copy.classWorkspace} body={isClaimed ? copy.workspaceReady : copy.workspaceLocked} tone={isClaimed ? 'light' : 'soft'} />
                <MiniInsightCard title={copy.latestRuns} body={classHistory.length > 0 ? formatRelativeTime(classHistory[0]?.ended_at || classHistory[0]?.started_at) : copy.noClassSessions} tone="accent" />
              </div>
            </div>
          </div>
        </section>

        {assignment ? (
          <section className="overflow-hidden rounded-[2.2rem] border-4 border-brand-dark bg-white shadow-[10px_10px_0px_0px_#1A1A1A]">
            <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="bg-[linear-gradient(135deg,_rgba(180,136,255,0.18),_rgba(255,255,255,0.95)_58%)] p-6 sm:p-7">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-brand-purple">
                  {language === 'he' ? 'משימה כיתתית' : language === 'ar' ? 'مهمة صفية' : 'Class assignment'}
                </p>
                <h2 className="text-3xl font-black text-brand-dark md:text-4xl">{assignment.title}</h2>
                <p className="mt-3 max-w-2xl font-bold leading-7 text-brand-dark/65">
                  {assignment.instructions || (
                    language === 'he'
                      ? 'המורה שלח משימה ממוקדת על אותו חומר. סיימו את היעד כדי להגיע מוכנים יותר לסשן הבא.'
                      : language === 'ar'
                        ? 'أرسل المعلم مهمة مركزة على نفس المادة. أكمل الهدف للوصول أكثر جاهزية للجلسة القادمة.'
                        : 'Your teacher sent a focused assignment on the same material. Finish the goal to show up steadier for the next class run.'
                  )}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <StatusPill tone={assignment.progress?.status === 'completed' ? 'ready' : assignment.progress?.status === 'overdue' ? 'live' : 'neutral'}>
                    {language === 'he'
                      ? assignment.progress?.status === 'completed' ? 'הושלם' : assignment.progress?.status === 'overdue' ? 'באיחור' : assignment.progress?.status === 'in_progress' ? 'בתהליך' : 'עוד לא התחיל'
                      : language === 'ar'
                        ? assignment.progress?.status === 'completed' ? 'اكتمل' : assignment.progress?.status === 'overdue' ? 'متأخر' : assignment.progress?.status === 'in_progress' ? 'قيد التنفيذ' : 'لم يبدأ'
                        : assignment.progress?.status === 'completed' ? 'Completed' : assignment.progress?.status === 'overdue' ? 'Overdue' : assignment.progress?.status === 'in_progress' ? 'In progress' : 'Not started'}
                  </StatusPill>
                  <StatusPill tone="neutral">{language === 'he' ? 'דדליין' : language === 'ar' ? 'الموعد النهائي' : 'Due'}: {formatDueDateTime(assignment.due_at, language)}</StatusPill>
                  <StatusPill tone="ready">{language === 'he' ? 'יעד' : language === 'ar' ? 'الهدف' : 'Goal'}: {assignment.question_goal}</StatusPill>
                </div>
              </div>

              <div className="bg-brand-dark p-6 text-white sm:p-7">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow">
                  {language === 'he' ? 'התקדמות אישית' : language === 'ar' ? 'تقدمك الشخصي' : 'Your progress'}
                </p>
                <p className="mt-4 text-4xl font-black">{Math.round(Number(assignment.progress?.completion_pct || 0))}%</p>
                <p className="mt-1 font-bold text-white/70">
                  {language === 'he' ? 'מהמשימה הושלם עד עכשיו' : language === 'ar' ? 'تم إنجازه حتى الآن من المهمة' : 'Completed so far'}
                </p>
                <div className="mt-5 h-5 overflow-hidden rounded-full border-2 border-white/90 bg-white/20">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,_#FFD13B_0%,_#FF5A36_48%,_#B488FF_100%)]" style={{ width: `${completionPct}%` }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <WorkspaceCard
                    label={language === 'he' ? 'שאלות שהושלמו' : language === 'ar' ? 'الأسئلة المنجزة' : 'Questions done'}
                    value={`${Number(assignment.progress?.attempted_questions || 0)}/${Number(assignment.question_goal || 0)}`}
                    meta={language === 'he' ? 'מתוך יעד המשימה' : language === 'ar' ? 'من هدف المهمة' : 'Toward the assignment goal'}
                    tone="neutral"
                    badge={language === 'he' ? 'בתנועה' : language === 'ar' ? 'قيد الحركة' : 'Moving'}
                    inverse
                  />
                  <WorkspaceCard
                    label={copy.accuracy}
                    value={assignment.progress?.accuracy_pct !== null && assignment.progress?.accuracy_pct !== undefined ? `${Math.round(Number(assignment.progress.accuracy_pct))}%` : '--'}
                    meta={`${copy.lastSeen}: ${formatRelativeTime(assignment.progress?.last_activity_at)}`}
                    tone="neutral"
                    badge={language === 'he' ? 'חי' : language === 'ar' ? 'نشط' : 'Live'}
                    inverse
                  />
                </div>
                <Link to={practicePath} className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black text-brand-dark shadow-[0_4px_0_0_#FFFFFF]">
                  {copy.enterPractice}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        <SectionShell
          icon={<BookOpen className="h-6 w-6 text-brand-purple" />}
          eyebrow={copy.sharedLessons}
          title={copy.sharedLessons}
          body={copy.sharedLessonsBody}
          action={<StatusPill tone={isClaimed ? 'ready' : 'pending'}>{isClaimed ? copy.lessonAvailable : copy.pendingLabel}</StatusPill>}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {availableLessons.length > 0 ? availableLessons.map((lesson: any) => {
              const lessonPracticePath = buildAssignmentPracticePath(data, lesson, 'adaptive');
              const lessonStudyPath = buildAssignmentPracticePath(data, lesson, 'lesson');
              const lessonStatus =
                lesson.progress?.status === 'completed'
                  ? (language === 'he' ? 'הושלם' : language === 'ar' ? 'اكتمل' : 'Completed')
                  : lesson.progress?.status === 'overdue'
                    ? (language === 'he' ? 'באיחור' : language === 'ar' ? 'متأخر' : 'Overdue')
                    : lesson.progress?.status === 'in_progress'
                      ? (language === 'he' ? 'בתהליך' : language === 'ar' ? 'قيد التنفيذ' : 'In progress')
                      : language === 'he'
                        ? 'עוד לא התחיל'
                        : language === 'ar'
                          ? 'لم يبدأ'
                          : 'Not started';

              return (
                <div key={`lesson-${lesson.id}`} className="group rounded-[1.8rem] border-2 border-brand-dark bg-[linear-gradient(180deg,_rgba(255,255,255,1)_0%,_rgba(255,248,233,0.92)_100%)] p-5 shadow-[0_8px_0_0_#1A1A1A] transition-transform duration-200 hover:-translate-y-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xl font-black text-brand-dark">{lesson.title}</p>
                      <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/65">{lesson.instructions || copy.lessonCardMeta}</p>
                    </div>
                    <StatusPill tone={lesson.progress?.status === 'completed' ? 'ready' : lesson.progress?.status === 'overdue' ? 'live' : 'neutral'}>{lessonStatus}</StatusPill>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <StatusPill tone="neutral">{language === 'he' ? 'יעד' : language === 'ar' ? 'الهدف' : 'Goal'}: {lesson.question_goal}</StatusPill>
                    <StatusPill tone="neutral">{copy.accuracy}: {lesson.progress?.accuracy_pct !== null && lesson.progress?.accuracy_pct !== undefined ? `${Math.round(Number(lesson.progress.accuracy_pct))}%` : '--'}</StatusPill>
                    <StatusPill tone="neutral">{language === 'he' ? 'התקדמות' : language === 'ar' ? 'التقدم' : 'Progress'}: {Number(lesson.progress?.attempted_questions || 0)}/{Number(lesson.question_goal || 0)}</StatusPill>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link to={lessonStudyPath} className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-4 py-2 font-black shadow-[0_4px_0_0_#1A1A1A] ${isClaimed ? 'bg-white text-brand-dark' : 'pointer-events-none bg-white text-brand-dark/45'}`}>
                      {copy.studyThisLesson}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link to={lessonPracticePath} className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-4 py-2 font-black shadow-[0_4px_0_0_#B488FF] ${isClaimed ? 'bg-brand-dark text-white' : 'pointer-events-none bg-white text-brand-dark/45'}`}>
                      {copy.practiceThisLesson}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <span className="rounded-full border border-brand-dark bg-white px-3 py-2 text-xs font-black text-brand-dark/70">
                      {lesson.pack_title || classRow?.pack?.title || copy.assignedPack}
                    </span>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5 font-bold text-brand-dark/65 lg:col-span-2">
                {copy.allLessonsFallback}
              </div>
            )}
          </div>
        </SectionShell>

        <SectionShell icon={<Sparkles className="h-6 w-6 text-brand-orange" />} eyebrow={copy.classWorkspace} title={copy.classWorkspace} body={copy.classWorkspaceBody}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkspaceCard
              label={copy.joinLive}
              value={hasLiveRoom ? copy.liveOpen : copy.liveClosed}
              meta={hasLiveRoom ? liveHelperText : isClaimed ? copy.liveClosed : copy.workspaceLocked}
              tone={hasLiveRoom ? 'ready' : isClaimed ? 'neutral' : 'locked'}
              badge={hasLiveRoom ? copy.workspaceReady : isClaimed ? copy.readyLabel : copy.workspaceLocked}
              action={hasLiveRoom ? (
                <button
                  type="button"
                  onClick={() => void handleEnterLive(String(activeSession?.pin || ''))}
                  disabled={enteringLive || !canEnterLiveRoom}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black text-brand-dark shadow-[0_4px_0_0_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {enteringLive ? copy.approving : liveButtonLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            />
            <WorkspaceCard
              label={copy.enterPractice}
              value={isClaimed ? practiceHeadline : copy.pendingLabel}
              meta={isClaimed ? practiceBody : copy.workspaceLocked}
              tone={isClaimed ? 'ready' : 'locked'}
              badge={isClaimed ? copy.workspaceReady : copy.workspaceLocked}
              action={isClaimed ? (
                <Link to={practicePath} className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white shadow-[0_4px_0_0_#B488FF]">
                  {copy.enterPractice}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            />
            <WorkspaceCard
              label={copy.latestRuns}
              value={classHistory.length > 0 ? `${classHistory.length} ${copy.sessions}` : copy.historyMissing}
              meta={classHistory.length > 0 ? formatRelativeTime(classHistory[0]?.ended_at || classHistory[0]?.started_at) : copy.noClassSessions}
              tone={classHistory.length > 0 ? 'neutral' : 'locked'}
              badge={classHistory.length > 0 ? copy.workspaceReady : copy.workspaceLocked}
            />
            <WorkspaceCard
              label={copy.assignedPack}
              value={classRow.pack?.title || copy.packMissing}
              meta={classRow.pack ? `${Number(classRow.pack?.question_count || 0)} ${copy.packQuestions}` : copy.workspaceLocked}
              tone={classRow.pack ? 'neutral' : 'locked'}
              badge={classRow.pack ? copy.workspaceReady : copy.workspaceLocked}
            />
          </div>
        </SectionShell>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: copy.accuracy,
              value: data.class_progress?.accuracy === null || data.class_progress?.accuracy === undefined ? '--' : `${Math.round(Number(data.class_progress?.accuracy || 0))}%`,
              icon: Target,
            },
            { label: copy.sessions, value: `${Number(data.class_progress?.session_count || 0)}`, icon: CalendarClock },
            { label: copy.liveRooms, value: `${Number(data.class_progress?.active_session_count || 0)}`, icon: PlayCircle },
            { label: copy.packQuestions, value: `${Number(classRow.pack?.question_count || 0)}`, icon: BrainCircuit },
          ].map((card, index) => {
            const gradients = [
              'bg-[linear-gradient(135deg,_rgba(255,90,54,0.22),_rgba(255,255,255,1))]',
              'bg-[linear-gradient(135deg,_rgba(255,209,59,0.28),_rgba(255,255,255,1))]',
              'bg-[linear-gradient(135deg,_rgba(180,136,255,0.24),_rgba(255,255,255,1))]',
              'bg-[linear-gradient(135deg,_rgba(26,26,26,0.08),_rgba(255,255,255,1))]',
            ];

            return (
              <div key={card.label} className={`rounded-[1.9rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A] ${gradients[index % gradients.length]}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-dark/45">{card.label}</p>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-dark bg-white">
                    <card.icon className="h-5 w-5 text-brand-orange" />
                  </span>
                </div>
                <p className="mt-4 text-4xl font-black text-brand-dark">{card.value}</p>
              </div>
            );
          })}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="space-y-6">
            <SectionShell compact icon={<Sparkles className="h-6 w-6 text-brand-orange" />} eyebrow={copy.approvalFlow} title={copy.approvalFlow} body={isClaimed ? copy.readyForClass : copy.lockedUntilApproval}>
              <div className="space-y-3">
                {unlockSteps.map((step, index) => (
                  <div key={step.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-[linear-gradient(180deg,_#FFFFFF_0%,_#FFF8E9_100%)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-dark font-black ${step.done ? 'bg-brand-yellow text-brand-dark' : 'bg-white text-brand-dark/45'}`}>
                          {step.done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                        </div>
                        <div>
                          <p className="font-black text-brand-dark">{step.title}</p>
                          <p className="text-sm font-bold text-brand-dark/55">{step.meta}</p>
                        </div>
                      </div>
                      <StatusPill tone={step.done ? 'ready' : 'neutral'}>{step.done ? copy.readyLabel : copy.pendingLabel}</StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            </SectionShell>

            <SectionShell compact icon={<BookOpen className="h-6 w-6 text-brand-orange" />} eyebrow={copy.assignedPack} title={copy.assignedPack}>
              {classRow.pack ? (
                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-[linear-gradient(135deg,_rgba(255,209,59,0.22),_rgba(255,255,255,0.94)_60%)] p-5">
                  <p className="text-2xl font-black">{classRow.pack.title}</p>
                  <p className="mt-2 font-bold text-brand-dark/65">{classRow.pack.question_count} questions</p>
                  <p className="mt-4 text-sm font-bold text-brand-dark/60">{copy.openPracticeHint}</p>
                </div>
              ) : (
                <p className="font-bold text-brand-dark/60">{copy.packMissing}</p>
              )}
            </SectionShell>

            <SectionShell compact icon={<BrainCircuit className="h-6 w-6 text-brand-orange" />} eyebrow={copy.sharedLessons} title={copy.sharedLessons} body={copy.sharedLessonsBody}>
              <div className="space-y-3">
                {classPacks.length > 0 ? classPacks.map((pack: any) => (
                  <div key={`class-pack-${pack.id}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-[linear-gradient(180deg,_#FFFFFF_0%,_#F7F2FF_100%)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-black text-brand-dark">{pack.title}</p>
                        <p className="mt-2 text-sm font-bold text-brand-dark/60">
                          {Number(pack.question_count || 0)} {copy.packQuestions} • {copy.lessonCardMeta}
                        </p>
                      </div>
                      <StatusPill tone={isClaimed ? 'ready' : 'pending'}>{isClaimed ? copy.lessonAvailable : copy.pendingLabel}</StatusPill>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link to={buildPackPracticePath(data, pack, 'lesson')} className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-4 py-2 font-black shadow-[0_4px_0_0_#1A1A1A] ${isClaimed ? 'bg-white text-brand-dark' : 'pointer-events-none bg-white text-brand-dark/45'}`}>
                        {copy.studyThisLesson}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link to={buildPackPracticePath(data, pack, 'adaptive')} className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-4 py-2 font-black shadow-[0_4px_0_0_#B488FF] ${isClaimed ? 'bg-brand-dark text-white' : 'pointer-events-none bg-white text-brand-dark/45'}`}>
                        {copy.practiceThisLesson}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">{copy.allLessonsFallback}</p>
                )}
              </div>
            </SectionShell>

            <SectionShell compact icon={<Clock3 className="h-6 w-6 text-brand-orange" />} eyebrow={copy.classSnapshot} title={copy.classSnapshot}>
              <div className="space-y-3 font-bold text-brand-dark/70">
                <p>{copy.delivery}: {formatDeliveryLabel(classRow.invite_delivery_status, language)}</p>
                <p>{copy.inviteSent}: {classRow.invite_sent_at ? formatRelativeTime(classRow.invite_sent_at) : formatDeliveryLabel(classRow.invite_delivery_status, language)}</p>
                <p>{copy.approvedAt}: {classRow.claimed_at ? formatRelativeTime(classRow.claimed_at) : copy.pendingLabel}</p>
                <p>{copy.lastSeen}: {formatRelativeTime(classRow.last_seen_at)}</p>
              </div>
            </SectionShell>
          </div>

          <div className="space-y-6">
            <SectionShell compact icon={<Rocket className="h-6 w-6 text-brand-orange" />} eyebrow={copy.nextMove} title={copy.nextMove} body={copy.focusNow}>
              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-[linear-gradient(135deg,_rgba(255,209,59,0.18),_rgba(255,255,255,1)_38%,_rgba(180,136,255,0.15)_100%)] p-5">
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
                      <button
                        type="button"
                        onClick={() => void handleEnterLive(String(activeSession?.pin || ''))}
                        disabled={enteringLive || !canEnterLiveRoom}
                        className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black text-brand-dark shadow-[0_4px_0_0_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enteringLive ? copy.approving : liveButtonLabel}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    ) : null}
                    <Link to={practicePath} className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white shadow-[0_4px_0_0_#B488FF]">
                      {copy.enterPractice}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </SectionShell>

            <SectionShell compact icon={<CalendarClock className="h-6 w-6 text-brand-orange" />} eyebrow={copy.latestRuns} title={copy.latestRuns}>
              <div className="space-y-3">
                {classHistory.length > 0 ? classHistory.map((session: any) => (
                  <div key={session.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-[linear-gradient(180deg,_#FFFFFF_0%,_#FFF8E9_100%)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">Session #{session.id}</p>
                        <p className="font-medium text-brand-dark/65">
                          {String(session.status || '').toUpperCase() === 'ENDED'
                            ? `${copy.sessionEnded}: ${formatRelativeTime(session.ended_at || session.started_at)}`
                            : `${copy.sessionStarted}: ${formatRelativeTime(session.started_at)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">{session.participant_count} players</span>
                        {String(session.status || '').toUpperCase() !== 'ENDED' && session.pin ? (
                          (() => {
                            const sessionLiveAction = describeLiveAction(String(session.pin || ''), String(session.status || ''), Boolean(session.resume_available));
                            return (
                              <button
                                type="button"
                                onClick={() => void handleEnterLive(String(session.pin || ''))}
                                disabled={enteringLive || sessionLiveAction.disabled}
                                className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-1 text-xs font-black shadow-[0_4px_0_0_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {enteringLive ? copy.approving : sessionLiveAction.label}
                              </button>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">{copy.noClassSessions}</p>
                )}
              </div>
            </SectionShell>
            {liveEntryError ? <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4 font-bold text-brand-dark/75 shadow-[0_6px_0_0_#1A1A1A]">{liveEntryError}</div> : null}

            <SectionShell compact icon={<Target className="h-6 w-6 text-brand-orange" />} eyebrow={copy.myPath} title={copy.myPath}>
              <div className="space-y-3">
                {personalHistory.length > 0 ? personalHistory.map((row: any, index: number) => (
                  <div key={`${row.session_id}-${index}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-[linear-gradient(180deg,_#FFFFFF_0%,_#EEF4FB_100%)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">{row.pack_title || `Session #${row.session_id}`}</p>
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
            </SectionShell>
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
  inverse = false,
}: {
  label: string;
  value: string;
  meta: string;
  tone: 'ready' | 'neutral' | 'locked';
  badge: string;
  action?: ReactNode;
  inverse?: boolean;
}) {
  return (
    <div className={`rounded-[1.6rem] border-2 border-brand-dark p-5 ${inverse ? 'bg-white/10 text-white' : 'bg-brand-bg text-brand-dark'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-xs font-black uppercase tracking-[0.18em] ${inverse ? 'text-white/60' : 'text-brand-dark/45'}`}>{label}</p>
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
      <p className={`mt-4 text-2xl font-black leading-tight ${inverse ? 'text-white' : 'text-brand-dark'}`}>{value}</p>
      <p className={`mt-3 text-sm font-bold ${inverse ? 'text-white/70' : 'text-brand-dark/60'}`}>{meta}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function SectionShell({
  icon,
  eyebrow,
  title,
  body,
  action,
  compact = false,
  children,
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-[2rem] border-4 border-brand-dark bg-white shadow-[8px_8px_0px_0px_#1A1A1A] ${compact ? 'p-6' : 'p-6 sm:p-7'}`}>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          {icon ? <div className="mt-1">{icon}</div> : null}
          <div>
            {eyebrow ? <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-purple">{eyebrow}</p> : null}
            <h2 className="mt-1 text-3xl font-black text-brand-dark md:text-4xl">{title}</h2>
            {body ? <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-brand-dark/60">{body}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function HeroStatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  accent: 'orange' | 'yellow' | 'purple' | 'dark';
}) {
  const accentClass =
    accent === 'orange'
      ? 'bg-[linear-gradient(135deg,_rgba(255,90,54,0.2),_rgba(255,255,255,0.96))]'
      : accent === 'yellow'
        ? 'bg-[linear-gradient(135deg,_rgba(255,209,59,0.34),_rgba(255,255,255,0.96))]'
        : accent === 'purple'
          ? 'bg-[linear-gradient(135deg,_rgba(180,136,255,0.26),_rgba(255,255,255,0.96))]'
          : 'bg-[linear-gradient(135deg,_rgba(26,26,26,0.1),_rgba(255,255,255,0.96))]';

  return (
    <div className={`rounded-[1.55rem] border-2 border-brand-dark p-4 shadow-[0_6px_0_0_#1A1A1A] ${accentClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-dark/55">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-brand-dark bg-white">
          {icon}
        </span>
      </div>
      <p className="mt-4 text-3xl font-black text-brand-dark">{value}</p>
    </div>
  );
}

function MiniInsightCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: 'light' | 'soft' | 'accent';
}) {
  const className =
    tone === 'accent'
      ? 'bg-[linear-gradient(135deg,_rgba(180,136,255,0.22),_rgba(255,255,255,0.98))]'
      : tone === 'soft'
        ? 'bg-[linear-gradient(135deg,_rgba(26,26,26,0.06),_rgba(255,255,255,0.98))]'
        : 'bg-[linear-gradient(135deg,_rgba(255,209,59,0.22),_rgba(255,255,255,0.98))]';

  return (
    <div className={`rounded-[1.5rem] border-2 border-brand-dark p-4 shadow-[0_6px_0_0_#1A1A1A] ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/55">{title}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/70">{body}</p>
    </div>
  );
}
