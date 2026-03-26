import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Mail,
  PlayCircle,
  Save,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { apiFetchJson } from '../lib/api.ts';
import {
  addPackToClass,
  addTeacherClassStudent,
  createClassSession,
  getTeacherClass,
  removePackFromClass,
  removeTeacherClassStudent,
  resendTeacherClassStudentInvite,
  TEACHER_CLASS_COLOR_OPTIONS,
  type TeacherClassColor,
  type TeacherClassPayload,
  type TeacherClassWorkspace,
  updateTeacherClass,
} from '../lib/teacherClasses.ts';

type ClassFormState = {
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  packId: string;
  notes: string;
};

const EMPTY_FORM: ClassFormState = {
  name: '',
  subject: '',
  grade: '',
  color: 'bg-brand-purple',
  packId: '',
  notes: '',
};

function buildFormState(classBoard: TeacherClassWorkspace): ClassFormState {
  return {
    name: classBoard.name,
    subject: classBoard.subject,
    grade: classBoard.grade,
    color: classBoard.color,
    packId: classBoard.pack_id ? String(classBoard.pack_id) : '',
    notes: classBoard.notes || '',
  };
}

function normalizePayload(form: ClassFormState): TeacherClassPayload {
  return {
    name: form.name.trim(),
    subject: form.subject.trim(),
    grade: form.grade.trim(),
    color: form.color,
    notes: form.notes.trim(),
    pack_id: form.packId ? Number(form.packId) : null,
  };
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Not yet';
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

function formatAccuracy(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No accuracy yet';
  return `${Math.round(Number(value || 0))}% accuracy`;
}

export default function TeacherClassDetail() {
  const { language } = useAppLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const [classBoard, setClassBoard] = useState<TeacherClassWorkspace | null>(null);
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [copiedReminderKey, setCopiedReminderKey] = useState('');
  const [copiedClassLink, setCopiedClassLink] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState('');

  const copy = ({
    he: {
      back: 'חזרה ללוח הכיתות',
      loading: 'טוען את דף הכיתה...',
      failed: 'לא הצלחנו לטעון את דף הכיתה.',
      retry: 'נסה שוב',
      host: 'פתח כיתה חיה',
      continueLive: 'חזור לחדר החי',
      report: 'פתח אנליטיקות',
      settings: 'הגדרות הכיתה',
      settingsBody: 'זהו מרכז הניהול הראשי של הכיתה: פרטים, חבילה, רוסטר, הזמנות וסטטוס משלוח.',
      save: 'שמור שינויים',
      saving: 'שומר...',
      className: 'שם הכיתה',
      subject: 'מקצוע',
      grade: 'שכבה',
      color: 'צבע',
      pack: 'חבילה משויכת',
      noPack: 'ללא חבילה כרגע',
      notes: 'הערות',
      roster: 'תלמידים בכיתה',
      rosterBody: 'הוסף תלמיד עם מייל כדי לשלוח הזמנה אמיתית ולחבר אותו לסביבת התלמיד.',
      addStudent: 'הוסף תלמיד',
      studentName: 'שם תלמיד',
      studentEmail: 'אימייל תלמיד',
      resend: 'שלח שוב מייל',
      remove: 'הסר מהכיתה',
      inviteStatus: 'סטטוס הזמנה',
      delivery: 'משלוח',
      lastSeen: 'נראה לאחרונה',
      syncTitle: 'סנכרון מורה–תלמיד',
      syncBody: 'כאן רואים מי הוזמן, מי כבר חיבר חשבון, מי אישר את הכיתה, ומי באמת חזר לפעילות.',
      linkedAccounts: 'חשבונות מקושרים',
      approvedStudents: 'אישרו כיתה',
      pendingStudents: 'ממתינים',
      seenStudents: 'נראו בכיתה',
      invitedAt: 'הזמנה',
      claimedAt: 'אישור',
      accountState: 'חשבון',
      activityState: 'פעילות',
      followUpTitle: 'מה לעשות עכשיו',
      followUpBody: 'התור הזה הופך את סטטוסי ההזמנה לפעולות קצרות: למי לשלוח reminder, למי לשלוח שוב מייל, ועל מי אי אפשר עדיין לבנות מעקב אמין.',
      followUpEmpty: 'אין כרגע תלמידים שדורשים פעולת follow-up מיידית.',
      manualReminder: 'העתק reminder',
      copiedReminder: 'הועתק reminder לתלמיד.',
      needsEmail: 'צריך להוסיף מייל',
      pendingInviteAction: 'עדיין מחכה לאישור הכיתה',
      deliveryIssueAction: 'הזמנה לא הגיעה בצורה יציבה',
      sessionOnlyAction: 'התלמיד עדיין לא ניתן למעקב ארוך טווח',
      linkedButQuietAction: 'החשבון מחובר, אבל עדיין אין חזרה לפעילות',
      queueReason: 'למה זה חשוב עכשיו',
      noSyncRows: 'עדיין אין תלמידים בכיתה הזאת.',
      inviteSentShort: 'נשלח',
      inviteMissingShort: 'לא נשלח',
      accountLinkedShort: 'מקושר',
      accountMissingShort: 'לא קושר',
      activitySeenShort: 'נראה',
      activityMissingShort: 'עוד לא נראה',
      mailHealth: 'מצב משלוח מיילים',
      mailReady: 'מערכת המיילים מוכנה לשליחה.',
      mailMissing: 'כדי שהזמנות מייל יעבדו צריך להשלים את ההגדרות החסרות.',
      sessions: 'סשנים כיתתיים',
      noSessions: 'עדיין אין סשנים בכיתה הזאת.',
      retention: 'מצב התמדה',
      linkedPack: 'חבילת הכיתה',
      openPack: 'פתח עריכת חבילה',
      inviteSent: 'המייל נשלח מחדש.',
      addStudentFirst: 'מלא/י שם תלמיד לפני ההוספה.',
      classSaved: 'שינויי הכיתה נשמרו.',
      studentAdded: 'התלמיד נוסף לכיתה.',
      studentRemoved: 'התלמיד הוסר מהכיתה.',
      assignPackFirst: 'צריך לשייך חבילה לפני פתיחת סשן חי.',
      fillRequired: 'מלא/י שם כיתה, מקצוע ושכבה לפני שמירה.',
      configureMail: 'חסר קונפיגורציית מייל: ',
      linkedAccount: 'חשבון תלמיד מקושר',
      pendingApproval: 'ממתין לאישור',
      approved: 'אושר',
      noInvite: 'ללא הזמנה',
      classSpace: 'סביבת הכיתה',
      classSpaceBody: 'זהו ה-hub של הכיתה עצמה: סטטוס גישה לתלמידים, קישור כניסה, pack, וסשן חי אם יש.',
      approvalRate: 'שיעור אישור',
      studentEntry: 'כניסת תלמידים',
      copyClassLink: 'העתק קישור גישה לכיתה',
      copiedClassLink: 'קישור הגישה לכיתה הועתק.',
      liveState: 'מצב החדר החי',
      liveOpen: 'חדר חי פתוח',
      liveClosed: 'אין כרגע חדר חי פתוח',
      livePin: 'PIN',
      pendingAccess: 'ממתינים לגישה',
      shareHint: 'אפשר לשלוח את הקישור הזה לכל תלמידי הכיתה. אחרי כניסה עם המייל שלהם, הכיתה תופיע אצלם לאישור או ככיתה פעילה.',
      library: 'ספריית שיעורים',
      addQuiz: 'הוסף שאלון לכיתה',
      removeQuiz: 'הסר מהכיתה',
      unnamedQuiz: 'שאלון ללא שם',
      selectPack: 'בחר שאלון מהקולקציה שלך...',
      noPacksInLibrary: 'עדיין אין שאלונים בתיקיית הכיתה הזאת.',
      hostSpecific: 'הפעל שיעור זה',
    },
    ar: {
      back: 'العودة إلى لوحة الصفوف',
      loading: 'جارٍ تحميل صفحة الصف...',
      failed: 'تعذر تحميل صفحة الصف.',
      retry: 'أعد المحاولة',
      host: 'افتح صفًا حيًا',
      continueLive: 'العودة إلى الغرفة الحية',
      report: 'افتح التحليلات',
      settings: 'إعدادات الصف',
      settingsBody: 'هذا هو مركز الإدارة الرئيسي للصف: التفاصيل والحزمة والقائمة والدعوات وحالة الإرسال.',
      save: 'احفظ التغييرات',
      saving: 'جارٍ الحفظ...',
      className: 'اسم الصف',
      subject: 'المادة',
      grade: 'المستوى',
      color: 'اللون',
      pack: 'الحزمة المرتبطة',
      noPack: 'لا توجد حزمة الآن',
      notes: 'ملاحظات',
      roster: 'طلاب الصف',
      rosterBody: 'أضف طالبًا مع بريد إلكتروني لإرسال دعوة حقيقية وربطه بمساحة الطالب.',
      addStudent: 'أضف طالبًا',
      studentName: 'اسم الطالب',
      studentEmail: 'بريد الطالب',
      resend: 'أعد إرسال البريد',
      remove: 'إزالة من الصف',
      inviteStatus: 'حالة الدعوة',
      delivery: 'الإرسال',
      lastSeen: 'آخر ظهور',
      syncTitle: 'مزامنة المعلّم–الطالب',
      syncBody: 'هنا نرى من تمت دعوته، من ربط حسابه، من وافق على الصف، ومن عاد فعلًا للنشاط.',
      linkedAccounts: 'حسابات مرتبطة',
      approvedStudents: 'وافقوا على الصف',
      pendingStudents: 'بانتظار الموافقة',
      seenStudents: 'ظهروا في الصف',
      invitedAt: 'الدعوة',
      claimedAt: 'الموافقة',
      accountState: 'الحساب',
      activityState: 'النشاط',
      followUpTitle: 'ماذا نفعل الآن',
      followUpBody: 'هذا الطابور يحول حالات الدعوة إلى أفعال قصيرة: لمن نرسل تذكيرًا، لمن نعيد الإرسال، ومن لا يمكن تتبعه بشكل موثوق.',
      followUpEmpty: 'لا يوجد الآن طلاب يحتاجون إلى متابعة فورية.',
      manualReminder: 'انسخ تذكيرًا',
      copiedReminder: 'تم نسخ التذكير للطالب.',
      needsEmail: 'يجب إضافة بريد إلكتروني',
      pendingInviteAction: 'ما زال بانتظار الموافقة على الصف',
      deliveryIssueAction: 'فشل إرسال الدعوة',
      sessionOnlyAction: 'لا يزال الطالب غير قابل للمتابعة',
      linkedButQuietAction: 'الحساب مرتبط لكن لا توجد عودة للنشاط بعد',
      queueReason: 'لماذا يهم هذا',
      noSyncRows: 'لا يوجد طلاب في هذا الصف بعد.',
      inviteSentShort: 'أُرسلت',
      inviteMissingShort: 'لم تُرسل',
      accountLinkedShort: 'مرتبط',
      accountMissingShort: 'غير مرتبط',
      activitySeenShort: 'شوهد',
      activityMissingShort: 'لم يظهر بعد',
      mailHealth: 'حالة إرسال البريد',
      mailReady: 'نظام البريد جاهز للإرسال.',
      mailMissing: 'لكي تعمل دعوات البريد يجب إكمال الإعدادات الناقصة.',
      sessions: 'جلسات الصف',
      noSessions: 'لا توجد جلسات لهذا الصف بعد.',
      retention: 'حالة الاستمرارية',
      linkedPack: 'حزمة الصف',
      openPack: 'افتح تحرير الحزمة',
      inviteSent: 'تمت إعادة إرسال البريد.',
      addStudentFirst: 'أدخل اسم الطالب قبل الإضافة.',
      classSaved: 'تم حفظ تغييرات الصف.',
      studentAdded: 'تمت إضافة الطالب إلى الصف.',
      studentRemoved: 'تمت إزالة الطالب من الصف.',
      assignPackFirst: 'أضف حزمة قبل فتح جلسة حية.',
      fillRequired: 'املأ اسم الصف والمادة والمستوى قبل الحفظ.',
      configureMail: 'إعدادات البريد الناقصة: ',
      linkedAccount: 'حساب طالب مرتبط',
      pendingApproval: 'بانتظار الموافقة',
      approved: 'تمت الموافقة',
      noInvite: 'بدون دعوة',
      classSpace: 'مساحة الصف',
      classSpaceBody: 'هذا هو مركز الصف نفسه: حالة وصول الطلاب، رابط الدخول، الحزمة، والجلسة الحية إن وُجدت.',
      approvalRate: 'معدل الموافقة',
      studentEntry: 'دخول الطلاب',
      copyClassLink: 'انسخ رابط دخول الصف',
      copiedClassLink: 'تم نسخ رابط دخول الصف.',
      liveState: 'حالة الغرفة الحية',
      liveOpen: 'غرفة حية مفتوحة',
      liveClosed: 'لا توجد غرفة حية الآن',
      livePin: 'PIN',
      pendingAccess: 'بانتظار الوصول',
      shareHint: 'يمكنك إرسال هذا الرابط إلى طلاب الصف. بعد الدخول ببريدهم، سيظهر الصف للموافقة أو كصف نشط.',
      library: 'مكتبة الدروس',
      addQuiz: 'إضافة اختبار للصف',
      removeQuiz: 'إزالة من الصف',
      unnamedQuiz: 'اختبار بدون اسم',
      selectPack: 'اختر اختبارًا من مجموعتك...',
      noPacksInLibrary: 'لا توجد اختبارات في مجلد هذا الصف بعد.',
      hostSpecific: 'شغل هذا الدرس',
    },
    en: {
      back: 'Back to classes',
      loading: 'Loading class page...',
      failed: 'We could not load this class page.',
      retry: 'Retry',
      host: 'Open live class',
      continueLive: 'Return to live room',
      report: 'Open analytics',
      settings: 'Class settings',
      settingsBody: 'This is now the main class management workspace: details, pack, roster, invites, and delivery state.',
      save: 'Save changes',
      saving: 'Saving...',
      className: 'Class name',
      subject: 'Subject',
      grade: 'Grade',
      color: 'Color',
      pack: 'Assigned pack',
      noPack: 'No pack right now',
      notes: 'Notes',
      roster: 'Students in this class',
      rosterBody: 'Add a student with an email to send a real invite and sync them to student space.',
      addStudent: 'Add student',
      studentName: 'Student name',
      studentEmail: 'Student email',
      resend: 'Resend invite',
      remove: 'Remove from class',
      inviteStatus: 'Invite status',
      delivery: 'Delivery',
      lastSeen: 'Last seen',
      syncTitle: 'Teacher-student sync',
      syncBody: 'See who was invited, who already linked an account, who approved the class, and who is actually active again.',
      linkedAccounts: 'Linked accounts',
      approvedStudents: 'Approved class',
      pendingStudents: 'Still pending',
      seenStudents: 'Seen in class',
      invitedAt: 'Invite',
      claimedAt: 'Approval',
      accountState: 'Account',
      activityState: 'Activity',
      followUpTitle: 'What to do now',
      followUpBody: 'This queue turns invite state into quick moves: who needs a reminder, who needs a resend, and who still cannot be tracked reliably over time.',
      followUpEmpty: 'There are no students who need immediate follow-up right now.',
      manualReminder: 'Copy reminder',
      copiedReminder: 'Reminder copied for the student.',
      needsEmail: 'Needs an email',
      pendingInviteAction: 'Still waiting for class approval',
      deliveryIssueAction: 'The invite did not land cleanly',
      sessionOnlyAction: 'This student is still not trackable long-term',
      linkedButQuietAction: 'The account is linked, but activity has not restarted yet',
      queueReason: 'Why this matters now',
      noSyncRows: 'There are no students in this class yet.',
      inviteSentShort: 'Sent',
      inviteMissingShort: 'Not sent',
      accountLinkedShort: 'Linked',
      accountMissingShort: 'Not linked',
      activitySeenShort: 'Seen',
      activityMissingShort: 'Not seen yet',
      mailHealth: 'Mail delivery health',
      mailReady: 'Email delivery is configured and ready.',
      mailMissing: 'To send invite emails, the missing configuration still needs to be added.',
      sessions: 'Class sessions',
      noSessions: 'There are no class sessions yet.',
      retention: 'Retention pulse',
      linkedPack: 'Class pack',
      openPack: 'Open pack editor',
      inviteSent: 'Invite email sent again.',
      addStudentFirst: 'Fill student name before adding.',
      classSaved: 'Class changes saved.',
      studentAdded: 'Student added to the class.',
      studentRemoved: 'Student removed from the class.',
      assignPackFirst: 'Assign a pack before opening a live class.',
      fillRequired: 'Fill class name, subject, and grade before saving.',
      configureMail: 'Missing mail configuration: ',
      linkedAccount: 'Student account linked',
      pendingApproval: 'Waiting approval',
      approved: 'Approved',
      noInvite: 'No invite',
      classSpace: 'Class workspace',
      classSpaceBody: 'This is the hub for the class itself: student access state, entry link, pack, and any live room tied to it.',
      approvalRate: 'Approval rate',
      studentEntry: 'Student entry',
      copyClassLink: 'Copy class access link',
      copiedClassLink: 'Class access link copied.',
      liveState: 'Live room status',
      liveOpen: 'Live room open',
      liveClosed: 'No live room is open right now',
      livePin: 'PIN',
      pendingAccess: 'Pending access',
      shareHint: 'You can send this link to any student in the class. After they sign in with their email, the class will appear for approval or as an active class.',
      library: 'Lesson Library',
      addQuiz: 'Add quiz to class',
      removeQuiz: 'Remove from class',
      unnamedQuiz: 'Unnamed Quiz',
      selectPack: 'Select a quiz from your collection...',
      noPacksInLibrary: 'No quizzes in this class folder yet.',
      hostSpecific: 'Host this quiz',
    },
  } as const)[language as 'he' | 'ar' | 'en'] || {
    back: 'Back to classes',
    loading: 'Loading class page...',
    failed: 'We could not load this class page.',
    retry: 'Retry',
    host: 'Open live class',
    continueLive: 'Return to live room',
    report: 'Open analytics',
    settings: 'Class settings',
    settingsBody: 'Main class management workspace.',
    save: 'Save changes',
    saving: 'Saving...',
    className: 'Class name',
    subject: 'Subject',
    grade: 'Grade',
    color: 'Color',
    pack: 'Assigned pack',
    noPack: 'No pack right now',
    notes: 'Notes',
    roster: 'Students in this class',
    rosterBody: 'Manage synced student invites here.',
    addStudent: 'Add student',
    studentName: 'Student name',
    studentEmail: 'Student email',
    resend: 'Resend invite',
    remove: 'Remove from class',
    inviteStatus: 'Invite status',
    delivery: 'Delivery',
    lastSeen: 'Last seen',
    syncTitle: 'Teacher-student sync',
    syncBody: 'See the class sync state.',
    linkedAccounts: 'Linked accounts',
    approvedStudents: 'Approved class',
    pendingStudents: 'Still pending',
    seenStudents: 'Seen in class',
    invitedAt: 'Invite',
    claimedAt: 'Approval',
    accountState: 'Account',
    activityState: 'Activity',
    followUpTitle: 'What to do now',
    followUpBody: 'Quick follow-up queue.',
    followUpEmpty: 'No immediate follow-up needed.',
    manualReminder: 'Copy reminder',
    copiedReminder: 'Reminder copied.',
    needsEmail: 'Needs an email',
    pendingInviteAction: 'Still waiting for class approval',
    deliveryIssueAction: 'The invite did not land cleanly',
    sessionOnlyAction: 'This student is still not trackable long-term',
    linkedButQuietAction: 'The account is linked, but activity has not restarted yet',
    queueReason: 'Why this matters now',
    noSyncRows: 'There are no students in this class yet.',
    inviteSentShort: 'Sent',
    inviteMissingShort: 'Not sent',
    accountLinkedShort: 'Linked',
    accountMissingShort: 'Not linked',
    activitySeenShort: 'Seen',
    activityMissingShort: 'Not seen yet',
    mailHealth: 'Mail delivery health',
    mailReady: 'Email delivery is configured and ready.',
    mailMissing: 'Missing email configuration.',
    sessions: 'Class sessions',
    noSessions: 'There are no class sessions yet.',
    retention: 'Retention pulse',
    linkedPack: 'Class pack',
    openPack: 'Open pack editor',
    inviteSent: 'Invite email sent again.',
    addStudentFirst: 'Fill student name before adding.',
    classSaved: 'Class changes saved.',
    studentAdded: 'Student added to the class.',
    studentRemoved: 'Student removed from the class.',
    assignPackFirst: 'Assign a pack before opening a live class.',
    fillRequired: 'Fill class name, subject, and grade before saving.',
    configureMail: 'Missing mail configuration: ',
    linkedAccount: 'Student account linked',
    pendingApproval: 'Waiting approval',
    approved: 'Approved',
    noInvite: 'No invite',
    classSpace: 'Class workspace',
    classSpaceBody: 'This is the hub for the class itself.',
    approvalRate: 'Approval rate',
    studentEntry: 'Student entry',
    copyClassLink: 'Copy class access link',
    copiedClassLink: 'Class access link copied.',
    liveState: 'Live room status',
    liveOpen: 'Live room open',
    liveClosed: 'No live room is open right now',
    livePin: 'PIN',
    pendingAccess: 'Pending access',
    shareHint: 'Share this link with students in the class.',
    library: 'Lesson Library',
    addQuiz: 'Add quiz to class',
    removeQuiz: 'Remove from class',
    unnamedQuiz: 'Unnamed Quiz',
    selectPack: 'Select a quiz from your collection...',
    noPacksInLibrary: 'No quizzes in this class folder yet.',
    hostSpecific: 'Host this quiz',
  };

  const classId = useMemo(() => Number(id || 0), [id]);
  const syncSummary = useMemo(() => {
    if (!classBoard) {
      return {
        linked: 0,
        approved: 0,
        pending: 0,
        seen: 0,
      };
    }
    return {
      linked: classBoard.students.filter((student) => Boolean(student.account_linked)).length,
      approved: classBoard.students.filter((student) => String(student.invite_status || 'none') === 'claimed').length,
      pending: classBoard.students.filter((student) => String(student.invite_status || 'none') === 'invited').length,
      seen: classBoard.students.filter((student) => Boolean(student.last_seen_at)).length,
    };
  }, [classBoard]);

  const studentSyncRows = useMemo(() => {
    if (!classBoard) return [];
    const statusWeight = (student: TeacherClassWorkspace['students'][number]) => {
      if (String(student.invite_status || 'none') === 'invited') return 3;
      if (!student.account_linked && String(student.email || '').trim()) return 2;
      if (!student.last_seen_at) return 1;
      return 0;
    };
    return [...classBoard.students].sort((left, right) => {
      const weightDelta = statusWeight(right) - statusWeight(left);
      if (weightDelta !== 0) return weightDelta;
      const rightSeen = new Date(right.last_seen_at || right.updated_at || right.created_at || 0).getTime() || 0;
      const leftSeen = new Date(left.last_seen_at || left.updated_at || left.created_at || 0).getTime() || 0;
      return rightSeen - leftSeen;
    });
  }, [classBoard]);

  useEffect(() => {
    if (!copiedReminderKey) return;
    const timeout = window.setTimeout(() => setCopiedReminderKey(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [copiedReminderKey]);

  useEffect(() => {
    if (!copiedClassLink) return;
    const timeout = window.setTimeout(() => setCopiedClassLink(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copiedClassLink]);

  const followUpQueue = useMemo(() => {
    if (!classBoard) return [];
    return classBoard.students
      .map((student) => {
        const hasEmail = Boolean(String(student.email || '').trim());
        const inviteStatus = String(student.invite_status || 'none').toLowerCase();
        const deliveryStatus = String(student.invite_delivery_status || 'none').toLowerCase();
        const isLinked = Boolean(student.account_linked);
        const seen = Boolean(student.last_seen_at);

        if (!hasEmail) {
          return {
            ...student,
            priority: 4,
            action: copy.needsEmail,
            reason: copy.sessionOnlyAction,
          };
        }
        if (inviteStatus === 'invited' && ['failed', 'not_configured'].includes(deliveryStatus)) {
          return {
            ...student,
            priority: 3,
            action: copy.deliveryIssueAction,
            reason: student.invite_last_error || copy.mailMissing,
          };
        }
        if (inviteStatus === 'invited') {
          return {
            ...student,
            priority: 2,
            action: copy.pendingInviteAction,
            reason: language === 'he'
              ? 'התלמיד כבר הוזמן אבל עדיין לא אישר את הכיתה מתוך סביבת התלמיד.'
              : language === 'ar'
                ? 'تمت دعوة الطالب بالفعل لكنه لم يوافق بعد على الصف من مساحة الطالب.'
                : 'The student was invited already but has not approved the class from student space yet.',
          };
        }
        if (isLinked && !seen) {
          return {
            ...student,
            priority: 1,
            action: copy.linkedButQuietAction,
            reason: language === 'he'
              ? 'החשבון כבר משויך, אבל עוד אין כניסה או פעילות שמוכיחה שהכיתה חזרה לחיים עבורו.'
              : language === 'ar'
                ? 'الحساب مرتبط بالفعل، لكن لا توجد بعد جلسة أو نشاط يثبت أن الصف عاد للحياة بالنسبة له.'
                : 'The account is already linked, but there is still no session or activity proving the class is alive for this learner.',
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((left: any, right: any) => Number(right.priority || 0) - Number(left.priority || 0));
  }, [classBoard, copy.deliveryIssueAction, copy.linkedButQuietAction, copy.mailMissing, copy.needsEmail, copy.pendingInviteAction, copy.sessionOnlyAction, language]);

  const buildStudentInviteLink = useCallback((studentEmailValue: string) => {
    const base =
      typeof window !== 'undefined'
        ? window.location.origin
        : '';
    const params = new URLSearchParams();
    params.set('mode', 'register');
    params.set('email', studentEmailValue);
    params.set('class_id', String(classBoard?.id || ''));
    params.set('class_name', String(classBoard?.name || ''));
    return `${base}/student/auth?${params.toString()}`;
  }, [classBoard?.id, classBoard?.name]);

  const buildGenericClassStudentLink = useCallback(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams();
    params.set('mode', 'register');
    params.set('class_id', String(classBoard?.id || ''));
    params.set('class_name', String(classBoard?.name || ''));
    return `${base}/student/auth?${params.toString()}`;
  }, [classBoard?.id, classBoard?.name]);

  const handleCopyReminder = useCallback(async (student: TeacherClassWorkspace['students'][number]) => {
    const email = String(student.email || '').trim();
    if (!email || !classBoard) return;
    const link = buildStudentInviteLink(email);
    const message =
      language === 'he'
        ? `היי ${student.name}, צירפתי אותך לכיתה "${classBoard.name}". כדי לפתוח את הכיתה אצלך, להיכנס לסביבת תלמיד ולאשר את ההזמנה, צריך להיכנס עם אותו המייל: ${email}\n\nקישור ישיר: ${link}`
        : language === 'ar'
          ? `مرحبًا ${student.name}، تمت إضافتك إلى الصف "${classBoard.name}". لفتح الصف في مساحة الطالب والموافقة على الدعوة، ادخل بنفس البريد: ${email}\n\nالرابط المباشر: ${link}`
          : `Hi ${student.name}, you were added to "${classBoard.name}". To open the class in student space and approve the invite, sign in with the same email: ${email}\n\nDirect link: ${link}`;
    try {
      await navigator.clipboard.writeText(message);
      setCopiedReminderKey(String(student.id));
      setFeedback(copy.copiedReminder);
    } catch (copyError: any) {
      setFeedback(copyError?.message || 'Failed to copy reminder.');
    }
  }, [buildStudentInviteLink, classBoard, copy.copiedReminder, language]);

  const handleCopyClassLink = useCallback(async () => {
    if (!classBoard) return;
    try {
      await navigator.clipboard.writeText(buildGenericClassStudentLink());
      setCopiedClassLink(true);
      setFeedback(copy.copiedClassLink);
    } catch (copyError: any) {
      setFeedback(copyError?.message || 'Failed to copy class link.');
    }
  }, [buildGenericClassStudentLink, classBoard, copy.copiedClassLink]);

  const loadClass = useCallback(async () => {
    if (!classId) return;
    try {
      setLoading(true);
      setError('');
      const [classPayload, packPayload] = await Promise.all([
        getTeacherClass(classId),
        apiFetchJson('/api/teacher/packs').catch(() => []),
      ]);
      setClassBoard(classPayload);
      setForm(buildFormState(classPayload));
      setPacks(Array.isArray(packPayload) ? packPayload : []);
    } catch (loadError: any) {
      setError(loadError?.message || copy.failed);
    } finally {
      setLoading(false);
    }
  }, [classId, copy.failed]);

  useEffect(() => {
    void loadClass();
  }, [loadClass]);

  const handleSaveClass = async () => {
    if (!classBoard) return;
    const payload = normalizePayload(form);
    if (!payload.name || !payload.subject || !payload.grade) {
      setFeedback(copy.fillRequired);
      return;
    }
    try {
      setBusyKey('save-class');
      const refreshed = await updateTeacherClass(classBoard.id, payload);
      setClassBoard(refreshed);
      setForm(buildFormState(refreshed));
      setFeedback(copy.classSaved);
    } catch (saveError: any) {
      setFeedback(saveError?.message || 'Failed to save class.');
    } finally {
      setBusyKey('');
    }
  };

  const handleAddPack = async () => {
    if (!classBoard || !selectedPackId) return;
    try {
      setBusyKey('add-pack');
      const refreshed = await addPackToClass(classBoard.id, Number(selectedPackId));
      setClassBoard(refreshed);
      setSelectedPackId('');
      setFeedback('Quiz added to class library.');
    } catch (err: any) {
      setFeedback(err?.message || 'Failed to add quiz.');
    } finally {
      setBusyKey('');
    }
  };

  const handleUnlinkPack = async (packId: number, packTitle: string) => {
    if (!classBoard) return;
    if (!window.confirm(`Remove "${packTitle}" from ${classBoard.name}'s library?`)) return;
    try {
      setBusyKey(`remove-pack-${packId}`);
      const refreshed = await removePackFromClass(classBoard.id, packId);
      setClassBoard(refreshed);
      setFeedback('Quiz removed from class.');
    } catch (err: any) {
      setFeedback(err?.message || 'Failed to remove quiz.');
    } finally {
      setBusyKey('');
    }
  };

  const handleAddStudent = async () => {
    if (!classBoard) return;
    if (!studentName.trim()) {
      setFeedback(copy.addStudentFirst);
      return;
    }
    try {
      setBusyKey('add-student');
      const refreshed = await addTeacherClassStudent(classBoard.id, studentName.trim(), studentEmail.trim());
      setClassBoard(refreshed);
      setStudentName('');
      setStudentEmail('');
      setFeedback(copy.studentAdded);
    } catch (addError: any) {
      setFeedback(addError?.message || 'Failed to add student.');
    } finally {
      setBusyKey('');
    }
  };

  const handleHost = async (packId?: number) => {
    if (!classBoard) return;
    
    // If hosting an active session, just jump in
    if (classBoard.active_session?.pin) {
      navigate(`/teacher/session/${classBoard.active_session.pin}/host`, {
        state: {
          sessionId: classBoard.active_session.id,
          packId: classBoard.active_session.quiz_pack_id,
        },
      });
      return;
    }

    const targetPackId = packId || classBoard.pack?.id || (classBoard.packs.length === 1 ? classBoard.packs[0].id : null);
    
    if (!targetPackId) {
      setFeedback(copy.assignPackFirst);
      return;
    }
    try {
      setBusyKey('host');
      const session = await createClassSession({
        classId: classBoard.id,
        packId: targetPackId,
      });
      navigate(`/teacher/session/${session.pin}/host`, {
        state: {
          sessionId: session.id,
          packId: targetPackId,
        },
      });
    } catch (hostError: any) {
      setFeedback(hostError?.message || 'Failed to open the live class.');
    } finally {
      setBusyKey('');
    }
  };

  const handleResendInvite = async (studentId: number) => {
    if (!classBoard) return;
    try {
      setBusyKey(`invite-${studentId}`);
      const refreshed = await resendTeacherClassStudentInvite(classBoard.id, studentId);
      setClassBoard(refreshed);
      const updatedStudent = refreshed.students.find((student) => Number(student.id) === Number(studentId)) || null;
      if (updatedStudent?.invite_delivery_status === 'sent') {
        setFeedback(copy.inviteSent);
      } else if (updatedStudent?.invite_delivery_status === 'not_configured') {
        setFeedback(
          `${copy.mailMissing} ${updatedStudent?.invite_last_error || refreshed.mail_health?.missing?.join(', ') || 'EMAIL_PASS'}`,
        );
      } else {
        setFeedback(updatedStudent?.invite_last_error || 'Failed to resend the invite.');
      }
    } catch (inviteError: any) {
      setFeedback(inviteError?.message || 'Failed to resend the invite.');
    } finally {
      setBusyKey('');
    }
  };

  const handleRemoveStudent = async (studentId: number, studentNameValue: string) => {
    if (!classBoard) return;
    if (!window.confirm(`Remove ${studentNameValue} from ${classBoard.name}?`)) {
      return;
    }
    try {
      setBusyKey(`remove-${studentId}`);
      const refreshed = await removeTeacherClassStudent(classBoard.id, studentId);
      setClassBoard(refreshed);
      setFeedback(copy.studentRemoved);
    } catch (removeError: any) {
      setFeedback(removeError?.message || 'Failed to remove the student.');
    } finally {
      setBusyKey('');
    }
  };

  const formatInviteStatus = (status: string) => {
    const normalized = String(status || 'none').toLowerCase();
    if (normalized === 'claimed') return copy.approved;
    if (normalized === 'invited') return copy.pendingApproval;
    return copy.noInvite;
  };

  const formatDelivery = (status: string) => {
    const normalized = String(status || 'none').toLowerCase();
    if (language === 'he') {
      if (normalized === 'sent') return 'מייל נשלח';
      if (normalized === 'failed') return 'שגיאת שליחה';
      if (normalized === 'not_configured') return 'לא מוגדר';
      if (normalized === 'claimed') return 'אושר בפועל';
      return 'לא נשלח';
    }
    if (language === 'ar') {
      if (normalized === 'sent') return 'تم الإرسال';
      if (normalized === 'failed') return 'فشل الإرسال';
      if (normalized === 'not_configured') return 'غير مهيأ';
      if (normalized === 'claimed') return 'تمت الموافقة';
      return 'لم يُرسل';
    }
    if (normalized === 'sent') return 'Sent';
    if (normalized === 'failed') return 'Failed';
    if (normalized === 'not_configured') return 'Not configured';
    if (normalized === 'claimed') return 'Claimed';
    return 'Not sent';
  };

  if (loading) {
    return (
      <div className="teacher-layout-shell">
        <TeacherSidebar />
        <main className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
          <div className="mx-auto max-w-6xl rounded-[2rem] border-2 border-brand-dark bg-white p-10 text-center font-black shadow-[4px_4px_0px_0px_#1A1A1A]">
            {copy.loading}
          </div>
        </main>
      </div>
    );
  }

  if (!classBoard) {
    return (
      <div className="teacher-layout-shell">
        <TeacherSidebar />
        <main className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
          <div className="mx-auto max-w-3xl rounded-[2rem] border-2 border-brand-dark bg-white p-10 shadow-[4px_4px_0px_0px_#1A1A1A]">
            <p className="mb-3 text-3xl font-black">{copy.failed}</p>
            <p className="mb-6 font-bold text-brand-dark/60">{error}</p>
            <button
              onClick={() => void loadClass()}
              className="rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black"
            >
              {copy.retry}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const hasOpenLiveRoom = Boolean(classBoard.active_session?.id);
  const classStats = classBoard.stats || {
    student_count: Number(classBoard.student_count || 0),
    session_count: 0,
    active_session_count: 0,
    total_participant_count: 0,
    average_accuracy: null,
  };
  const classPack = classBoard.pack || null;
  const classRetention = classBoard.retention || {
    level: 'low' as const,
    headline:
      language === 'he'
        ? 'עדיין אין מספיק נתוני התמדה לכיתה הזאת.'
        : language === 'ar'
          ? 'لا توجد بعد بيانات كافية عن استمرارية هذا الصف.'
          : 'There is not enough class retention data yet.',
    body:
      language === 'he'
        ? 'ברגע שהתלמידים יתחילו לשחק ולתרגל דרך הכיתה, יופיע כאן מצב ההתמדה שלהם.'
        : language === 'ar'
          ? 'بمجرد أن يبدأ الطلاب اللعب والتدريب من خلال الصف، ستظهر هنا صورة الاستمرارية لديهم.'
          : 'Once students start playing and practicing through this class, their retention picture will appear here.',
    active_last_7d: 0,
    slipping: 0,
    inactive_14d: 0,
    never_started: 0,
    started_count: 0,
    needs_attention_count: 0,
    watchlist_students: [],
  };
  const recentSessions = Array.isArray(classBoard.recent_sessions) ? classBoard.recent_sessions : [];
  const mailHealth = classBoard.mail_health || {
    configured: false,
    mode: 'none' as const,
    from_address: 'eyalatiyawork@gmail.com',
    missing: ['EMAIL_PASS'],
    hint:
      language === 'he'
        ? 'השלים/י EMAIL_PASS או הגדרות SMTP מלאות כדי לאפשר שליחת הזמנות.'
        : language === 'ar'
          ? 'أكمل EMAIL_PASS أو إعدادات SMTP كاملة لتفعيل إرسال الدعوات.'
          : 'Add EMAIL_PASS or full SMTP credentials to enable invite delivery.',
  };

  return (
    <div className="teacher-layout-shell">
      <TeacherSidebar />

      <main className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/teacher/classes"
              className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ArrowLeft className="h-4 w-4" />
              {copy.back}
            </Link>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleHost}
                disabled={busyKey === 'host'}
                className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
              >
                {hasOpenLiveRoom ? copy.continueLive : copy.host}
              </button>
              {classBoard.latest_completed_session?.id ? (
                <button
                  onClick={() => navigate(`/teacher/analytics/class/${classBoard.latest_completed_session?.id}`)}
                  className="rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 font-black text-white shadow-[2px_2px_0px_0px_#FF5A36]"
                >
                  {copy.report}
                </button>
              ) : null}
            </div>
          </div>

          {feedback ? (
            <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white px-5 py-4 font-bold shadow-[3px_3px_0px_0px_#1A1A1A]">
              {feedback}
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A] xl:col-span-2">
              <div className="mb-3 flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-brand-orange" />
                <div>
                  <h2 className="text-2xl font-black">{copy.classSpace}</h2>
                  <p className="text-sm font-bold text-brand-dark/55">{copy.classSpaceBody}</p>
                </div>
              </div>
              <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.studentEntry}</p>
                <p className="mt-2 break-all font-bold text-brand-dark/70">{buildGenericClassStudentLink()}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCopyClassLink()}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black"
                  >
                    <Copy className="h-4 w-4" />
                    {copy.copyClassLink}
                  </button>
                  <span className="text-sm font-bold text-brand-dark/60">
                    {copiedClassLink ? copy.copiedClassLink : copy.shareHint}
                  </span>
                </div>
              </div>
            </div>

            <MetricTile label={copy.approvalRate} value={`${classBoard.student_count ? Math.round((syncSummary.approved / classBoard.student_count) * 100) : 0}%`} />
            <MetricTile label={copy.pendingAccess} value={String(syncSummary.pending)} />
            <MetricTile
              label={copy.liveState}
              value={hasOpenLiveRoom ? copy.liveOpen : copy.liveClosed}
              meta={hasOpenLiveRoom ? `${copy.livePin}: ${classBoard.active_session?.pin || ''}` : null}
            />
          </section>

          <section className={`${classBoard.color} rounded-[2.5rem] border-2 border-brand-dark p-8 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] opacity-70">
                  {classBoard.subject} • {classBoard.grade}
                </p>
                <h1 className="text-4xl font-black md:text-5xl">{classBoard.name}</h1>
                <p className="mt-3 max-w-3xl text-base font-bold opacity-80">
                  {classBoard.notes ||
                    (language === 'he'
                      ? 'הדף הזה מרכז את כל ניהול הכיתה: הגדרות, pack, תלמידים, הזמנות, בריאות משלוח וסשנים.'
                      : language === 'ar'
                        ? 'هذه الصفحة تجمع كل إدارة الصف: الإعدادات والحزمة والطلاب والدعوات وصحة الإرسال والجلسات.'
                        : 'This page centralizes class settings, pack assignment, students, invites, mail health, and sessions.')}
                </p>
              </div>
              <div className="min-w-[300px] rounded-[1.8rem] border-2 border-brand-dark bg-white/80 p-5">
                <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.settings}</p>
                <div className="space-y-3 font-black text-brand-dark">
                  <div className="flex items-center justify-between gap-3"><span>{copy.roster}</span><span>{classBoard.student_count}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>{copy.sessions}</span><span>{classStats.session_count}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>{copy.inviteStatus}</span><span>{classBoard.pending_approval_count}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>{copy.report}</span><span>{formatAccuracy(classStats.average_accuracy)}</span></div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Save className="h-6 w-6 text-brand-purple" />
                  <div>
                    <h2 className="text-2xl font-black">{copy.settings}</h2>
                    <p className="text-sm font-bold text-brand-dark/55">{copy.settingsBody}</p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={copy.className} value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                  <Field label={copy.subject} value={form.subject} onChange={(value) => setForm((current) => ({ ...current, subject: value }))} />
                  <Field label={copy.grade} value={form.grade} onChange={(value) => setForm((current) => ({ ...current, grade: value }))} />
                  <Field label={copy.grade} value={form.grade} onChange={(value) => setForm((current) => ({ ...current, grade: value }))} />
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.color}</label>
                  <div className="flex flex-wrap gap-2">
                    {TEACHER_CLASS_COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, color }))}
                        className={`h-10 w-10 rounded-xl border-2 border-brand-dark ${color} ${
                          form.color === color ? 'ring-4 ring-brand-orange/30' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.notes}</label>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="min-h-28 w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                  />
                </div>
                <button
                  onClick={() => void handleSaveClass()}
                  disabled={busyKey === 'save-class'}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl border-2 border-brand-dark bg-brand-orange px-5 py-3 font-black text-white shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {busyKey === 'save-class' ? copy.saving : copy.save}
                </button>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Users className="h-6 w-6 text-brand-orange" />
                  <div>
                    <h2 className="text-2xl font-black">{copy.roster}</h2>
                    <p className="text-sm font-bold text-brand-dark/55">{copy.rosterBody}</p>
                  </div>
                </div>

                <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={studentName}
                    onChange={(event) => setStudentName(event.target.value)}
                    placeholder={copy.studentName}
                    className="rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                  />
                  <input
                    value={studentEmail}
                    onChange={(event) => setStudentEmail(event.target.value)}
                    placeholder={copy.studentEmail}
                    className="rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                  />
                  <button
                    onClick={() => void handleAddStudent()}
                    disabled={busyKey === 'add-student'}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-brand-dark bg-brand-yellow px-4 font-black disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4" />
                    {copy.addStudent}
                  </button>
                </div>

                <div className="space-y-3">
                  {classBoard.students.map((student) => (
                    <div key={student.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xl font-black">{student.name}</p>
                          {student.email ? <p className="font-bold text-brand-dark/65">{student.email}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                            {copy.inviteStatus}: {formatInviteStatus(student.invite_status)}
                          </span>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                            {copy.delivery}: {formatDelivery(student.invite_delivery_status)}
                          </span>
                          {student.account_linked ? (
                            <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                              {copy.linkedAccount}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold text-brand-dark/70">
                        <span>{copy.lastSeen}: {formatRelativeTime(student.last_seen_at)}</span>
                        {student.invite_sent_at ? <span>Invite {formatRelativeTime(student.invite_sent_at)}</span> : null}
                        {student.invite_last_error ? <span>{student.invite_last_error}</span> : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {student.email ? (
                          <button
                            onClick={() => void handleResendInvite(student.id)}
                            disabled={busyKey === `invite-${student.id}`}
                            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
                          >
                            <Mail className="h-4 w-4" />
                            {copy.resend}
                          </button>
                        ) : null}
                        <button
                          onClick={() => void handleRemoveStudent(student.id, student.name)}
                          disabled={busyKey === `remove-${student.id}`}
                          className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-rose-100 px-4 py-2 text-sm font-black disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          {copy.remove}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <PlayCircle className="h-6 w-6 text-brand-orange" />
                  <h2 className="text-2xl font-black">{copy.sessions}</h2>
                </div>
                <div className="space-y-3">
                  {recentSessions.length > 0 ? (
                    recentSessions.map((session) => (
                      <div key={session.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xl font-black">Session #{session.id}</p>
                            <p className="font-bold text-brand-dark/65">{session.status} • {formatRelativeTime(session.ended_at || session.started_at)}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-black uppercase">
                            <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{session.participant_count} players</span>
                            <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{formatAccuracy(session.accuracy_rate)}</span>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => navigate(`/teacher/analytics/class/${session.id}`)}
                            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                          >
                            {copy.report}
                          </button>
                          {String(session.status || '').toUpperCase() !== 'ENDED' ? (
                            <button
                              onClick={() => navigate(`/teacher/session/${session.pin}/host`, { state: { sessionId: session.id, packId: session.quiz_pack_id } })}
                              className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
                            >
                              {copy.continueLive}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="font-bold text-brand-dark/60">{copy.noSessions}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-brand-orange" />
                  <h2 className="text-2xl font-black">{copy.mailHealth}</h2>
                </div>
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="text-xl font-black">
                    {mailHealth.configured ? copy.mailReady : copy.mailMissing}
                  </p>
                  <p className="mt-2 font-bold text-brand-dark/65">
                    {mailHealth.configured
                      ? `${mailHealth.mode.toUpperCase()} • ${mailHealth.from_address}`
                      : `${copy.configureMail}${mailHealth.missing.join(', ') || 'EMAIL_PASS'}`}
                  </p>
                  {mailHealth.hint ? (
                    <p className="mt-3 text-sm font-bold text-brand-dark/60">{mailHealth.hint}</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Mail className="h-6 w-6 text-brand-orange" />
                  <div>
                    <h2 className="text-2xl font-black">{copy.followUpTitle}</h2>
                    <p className="text-sm font-bold text-brand-dark/55">{copy.followUpBody}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {followUpQueue.length > 0 ? (
                    followUpQueue.map((student: any) => (
                      <div key={`followup-${student.id}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-black">{student.name}</p>
                            {student.email ? <p className="font-bold text-brand-dark/60">{student.email}</p> : null}
                          </div>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                            {student.action}
                          </span>
                        </div>
                        <div className="mt-3 rounded-xl border border-brand-dark/10 bg-white px-3 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/40">{copy.queueReason}</p>
                          <p className="mt-1 text-sm font-bold text-brand-dark/65">{student.reason}</p>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {student.email ? (
                            <button
                              onClick={() => void handleResendInvite(student.id)}
                              disabled={busyKey === `invite-${student.id}`}
                              className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
                            >
                              <Mail className="h-4 w-4" />
                              {copy.resend}
                            </button>
                          ) : null}
                          {student.email ? (
                            <button
                              onClick={() => void handleCopyReminder(student)}
                              className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
                            >
                              <Copy className="h-4 w-4" />
                              {copiedReminderKey === String(student.id) ? copy.copiedReminder : copy.manualReminder}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="font-bold text-brand-dark/60">{copy.followUpEmpty}</p>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-brand-purple" />
                  <div>
                    <h2 className="text-2xl font-black">{copy.syncTitle}</h2>
                    <p className="text-sm font-bold text-brand-dark/55">{copy.syncBody}</p>
                  </div>
                </div>

                <div className="mb-5 grid grid-cols-2 gap-3">
                  {[
                    { label: copy.linkedAccounts, value: syncSummary.linked },
                    { label: copy.approvedStudents, value: syncSummary.approved },
                    { label: copy.pendingStudents, value: syncSummary.pending },
                    { label: copy.seenStudents, value: syncSummary.seen },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{item.label}</p>
                      <p className="mt-2 text-3xl font-black text-brand-dark">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  {studentSyncRows.length > 0 ? (
                    studentSyncRows.map((student) => (
                      <div key={`sync-${student.id}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-black">{student.name}</p>
                            {student.email ? <p className="font-bold text-brand-dark/60">{student.email}</p> : null}
                          </div>
                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                            {formatInviteStatus(student.invite_status)}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <SyncEvent
                            label={copy.invitedAt}
                            state={student.invite_sent_at ? copy.inviteSentShort : copy.inviteMissingShort}
                            meta={student.invite_sent_at ? formatRelativeTime(student.invite_sent_at) : formatDelivery(student.invite_delivery_status)}
                          />
                          <SyncEvent
                            label={copy.accountState}
                            state={student.account_linked ? copy.accountLinkedShort : copy.accountMissingShort}
                            meta={student.account_linked ? copy.linkedAccount : formatInviteStatus(student.invite_status)}
                          />
                          <SyncEvent
                            label={copy.claimedAt}
                            state={String(student.invite_status || 'none') === 'claimed' ? copy.approved : copy.pendingApproval}
                            meta={student.claimed_at ? formatRelativeTime(student.claimed_at) : copy.pendingApproval}
                          />
                          <SyncEvent
                            label={copy.activityState}
                            state={student.last_seen_at ? copy.activitySeenShort : copy.activityMissingShort}
                            meta={student.last_seen_at ? formatRelativeTime(student.last_seen_at) : copy.noInvite}
                          />
                        </div>
                        {student.email && String(student.invite_status || 'none') === 'invited' ? (
                          <button
                            onClick={() => void handleResendInvite(student.id)}
                            disabled={busyKey === `invite-${student.id}`}
                            className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
                          >
                            <Mail className="h-4 w-4" />
                            {copy.resend}
                          </button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="font-bold text-brand-dark/60">{copy.noSyncRows}</p>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-6 w-6 text-brand-purple" />
                    <div>
                      <h2 className="text-2xl font-black">{copy.library}</h2>
                      <p className="text-sm font-bold text-brand-dark/55">{copy.noPacksInLibrary}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={selectedPackId}
                      onChange={(e) => setSelectedPackId(e.target.value)}
                      className="rounded-xl border-2 border-brand-dark bg-brand-bg px-4 py-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
                    >
                      <option value="">{copy.selectPack}</option>
                      {packs
                        .filter((p) => !(classBoard.packs || []).some((cp) => cp.id === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => void handleAddPack()}
                      disabled={!selectedPackId || busyKey === 'add-pack'}
                      className="rounded-xl border-2 border-brand-dark bg-brand-yellow px-5 py-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-50"
                    >
                      {copy.addQuiz}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(classBoard.packs || []).length > 0 ? (
                    (classBoard.packs || []).map((pack) => (
                      <div key={`pack-${pack.id}`} className="flex flex-col rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5 shadow-[3px_3px_0px_0px_#1A1A1A]">
                        <div className="mb-4 flex-1">
                          <h3 className="text-xl font-black leading-tight text-brand-dark">
                            {pack.title || copy.unnamedQuiz}
                          </h3>
                          <p className="mt-1 font-bold text-brand-dark/55">
                            {pack.question_count} {(pack.question_count === 1) ? 'question' : 'questions'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-4 border-t-2 border-brand-dark/5">
                          <button
                            onClick={() => void handleHost(pack.id)}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-brand-orange px-4 py-2 text-sm font-black text-white"
                          >
                            <PlayCircle className="h-4 w-4" />
                            {copy.hostSpecific}
                          </button>
                          <button
                            onClick={() => void handleUnlinkPack(pack.id, pack.title)}
                            className="inline-flex items-center justify-center rounded-full border-2 border-brand-dark bg-white p-2"
                            title={copy.removeQuiz}
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full rounded-2xl border-2 border-dashed border-brand-dark/20 py-12 text-center font-bold text-brand-dark/40">
                      {copy.noPacksInLibrary}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Sparkles className="h-6 w-6 text-brand-orange" />
                  <h2 className="text-2xl font-black">{copy.retention}</h2>
                </div>
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="text-xl font-black">{classRetention.headline}</p>
                  <p className="mt-2 font-bold text-brand-dark/65">{classRetention.body}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-black uppercase">
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.active_last_7d} active 7d</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.slipping} slipping</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.inactive_14d} inactive</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.never_started} not started</span>
                  </div>
                  {classRetention.watchlist_students.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {classRetention.watchlist_students.map((student) => (
                        <div key={`${classBoard.id}-${student.name}`} className="rounded-xl border border-brand-dark/10 bg-white px-3 py-3">
                          <p className="font-black">{student.name}</p>
                          <p className="mt-1 text-sm font-bold text-brand-dark/65">{student.reason}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Clock3 className="h-6 w-6 text-brand-orange" />
                  <h2 className="text-2xl font-black">{copy.notes}</h2>
                </div>
                <p className="whitespace-pre-wrap font-bold text-brand-dark/70">{classBoard.notes || 'No class notes yet.'}</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
      />
    </div>
  );
}

function SyncEvent({
  label,
  state,
  meta,
}: {
  label: string;
  state: string;
  meta: string;
}) {
  return (
    <div className="rounded-[1rem] border border-brand-dark/10 bg-white px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/40">{label}</p>
      <p className="mt-1 text-sm font-black text-brand-dark">{state}</p>
      <p className="mt-1 text-sm font-bold text-brand-dark/55">{meta}</p>
    </div>
  );
}

function MetricTile({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string | null;
}) {
  return (
    <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A]">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{label}</p>
      <p className="mt-3 text-2xl font-black leading-tight text-brand-dark">{value}</p>
      {meta ? <p className="mt-2 text-sm font-bold text-brand-dark/60">{meta}</p> : null}
    </div>
  );
}
