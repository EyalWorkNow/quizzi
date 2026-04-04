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
  Search,
  Sparkles,
  TrendingUp,
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
  createTeacherClassAssignment,
  createClassSession,
  deleteTeacherClassAssignment,
  getTeacherClass,
  getTeacherClassProgress,
  removePackFromClass,
  removeTeacherClassStudent,
  resendTeacherClassStudentInvite,
  TEACHER_CLASS_COLOR_OPTIONS,
  type TeacherClassAssignment,
  type TeacherClassProgressBoard,
  type TeacherClassColor,
  type TeacherClassPayload,
  type TeacherClassWorkspace,
  updateTeacherClassAssignment,
  updateTeacherClass,
} from '../lib/teacherClasses.ts';
import {
  DEFAULT_STUDENT_ASSISTANCE_POLICY,
  normalizeStudentAssistancePolicy,
  type StudentAssistancePolicy,
} from '../../shared/studentAssistance.ts';

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

type ProgressWindow = 'all' | '5' | '10' | '20';
type ProgressStudentSort = 'activity' | 'recent' | 'improvement' | 'name';

function formatShortDate(value?: string | null, language = 'en') {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : language === 'ar' ? 'ar' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function averageAccuracy(rows: Array<{ accuracy_pct: number | null | undefined }>) {
  const values = rows
    .map((row) => (row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function accuracyDelta(rows: Array<{ accuracy_pct: number | null | undefined }>) {
  const values = rows
    .map((row) => (row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length < 2) return null;
  return Math.round(values[values.length - 1] - values[0]);
}

function formatSignedDelta(delta: number | null | undefined) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '--';
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : ''}${Math.round(delta)}`;
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

const STUDENT_ASSISTANCE_TOGGLES: Array<{
  key: keyof Pick<
    StudentAssistancePolicy,
    | 'allow_question_reframe'
    | 'allow_keywords'
    | 'allow_checklist'
    | 'allow_hint'
    | 'allow_confidence_check'
    | 'allow_time_nudge'
    | 'allow_post_answer_explanation'
  >;
  label: string;
}> = [
  { key: 'allow_question_reframe', label: 'Question reframe' },
  { key: 'allow_keywords', label: 'Keywords' },
  { key: 'allow_checklist', label: 'Checklist' },
  { key: 'allow_hint', label: 'Hint' },
  { key: 'allow_confidence_check', label: 'Confidence check' },
  { key: 'allow_time_nudge', label: 'Time nudge' },
  { key: 'allow_post_answer_explanation', label: 'Post-answer wrap' },
];

function cloneAssistancePolicy(value?: Partial<StudentAssistancePolicy> | null) {
  return normalizeStudentAssistancePolicy(value || DEFAULT_STUDENT_ASSISTANCE_POLICY);
}

function AssistancePolicyEditor({
  title,
  subtitle,
  language,
  policy,
  onChange,
}: {
  title: string;
  subtitle: string;
  language: 'en' | 'he' | 'ar';
  policy: StudentAssistancePolicy;
  onChange: (next: StudentAssistancePolicy) => void;
}) {
  const assistanceCopy = {
    he: {
      sectionTitle: 'סיוע חכם לתלמידים',
      sectionSubtitle: 'עזרה בטוחה למבחן בתוך תרגול מותאם.',
      on: 'פועל',
      off: 'כבוי',
      toggles: {
        allow_question_reframe: 'ניסוח מחדש של השאלה',
        allow_keywords: 'מילות מפתח',
        allow_checklist: 'רשימת בדיקה',
        allow_hint: 'רמז',
        allow_confidence_check: 'בדיקת ביטחון',
        allow_time_nudge: 'תזכורת זמן',
        allow_post_answer_explanation: 'סיכום אחרי תשובה',
      },
      hintLimit: 'מקסימום רמזים / שאלה',
      hintLimitHelp: 'השתמש/י ב-`0` כדי לאפשר רמזים ללא הגבלה.',
      actionLimit: 'מקסימום פעולות / שאלה',
      actionLimitHelp: 'השתמש/י ב-`0` כדי לאפשר פעולות סיוע ללא הגבלה.',
    },
    ar: {
      sectionTitle: 'المساعدة الذكية للطلاب',
      sectionSubtitle: 'مساعدة آمنة للاختبار داخل التدرّب التكيفي.',
      on: 'مفعّل',
      off: 'متوقف',
      toggles: {
        allow_question_reframe: 'إعادة صياغة السؤال',
        allow_keywords: 'كلمات مفتاحية',
        allow_checklist: 'قائمة تحقق',
        allow_hint: 'تلميح',
        allow_confidence_check: 'فحص الثقة',
        allow_time_nudge: 'تنبيه وقت',
        allow_post_answer_explanation: 'ملخص بعد الإجابة',
      },
      hintLimit: 'الحد الأقصى للتلميحات / سؤال',
      hintLimitHelp: 'استخدم `0` للسماح بتلميحات غير محدودة.',
      actionLimit: 'الحد الأقصى للإجراءات / سؤال',
      actionLimitHelp: 'استخدم `0` للسماح بإجراءات دعم غير محدودة.',
    },
    en: {
      sectionTitle: 'Student Smart Assistance',
      sectionSubtitle: 'Exam-safe help inside adaptive practice.',
      on: 'On',
      off: 'Off',
      toggles: {
        allow_question_reframe: 'Question reframe',
        allow_keywords: 'Keywords',
        allow_checklist: 'Checklist',
        allow_hint: 'Hint',
        allow_confidence_check: 'Confidence check',
        allow_time_nudge: 'Time nudge',
        allow_post_answer_explanation: 'Post-answer wrap',
      },
      hintLimit: 'Hint max / question',
      hintLimitHelp: 'Use `0` for unlimited hints.',
      actionLimit: 'Total actions / question',
      actionLimitHelp: 'Use `0` for unlimited support actions.',
    },
  }[language];

  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
      <div className="mb-4">
        <p className="text-sm font-black text-brand-dark">{title}</p>
        <p className="text-sm font-bold text-brand-dark/60">{subtitle}</p>
      </div>
      <div className="mb-4 flex items-center justify-between rounded-[1rem] border-2 border-brand-dark bg-white px-4 py-3">
        <div>
          <p className="font-black text-brand-dark">{assistanceCopy.sectionTitle}</p>
          <p className="text-sm font-bold text-brand-dark/60">{assistanceCopy.sectionSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...policy, enabled: !policy.enabled })}
          className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${
            policy.enabled ? 'bg-brand-purple text-white' : 'bg-white text-brand-dark'
          }`}
        >
          {policy.enabled ? assistanceCopy.on : assistanceCopy.off}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {STUDENT_ASSISTANCE_TOGGLES.map((toggle) => (
          <label
            key={toggle.key}
            className="flex items-center justify-between rounded-[1rem] border-2 border-brand-dark bg-white px-4 py-3"
          >
            <span className="font-black text-brand-dark">{assistanceCopy.toggles[toggle.key]}</span>
            <input
              type="checkbox"
              checked={Boolean(policy[toggle.key])}
              onChange={(event) => onChange({ ...policy, [toggle.key]: event.target.checked })}
              className="h-5 w-5 accent-brand-purple"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{assistanceCopy.hintLimit}</label>
          <input
            type="number"
            min="0"
            max="20"
            value={policy.max_hint_requests_per_question}
            onChange={(event) =>
              onChange({
                ...policy,
                max_hint_requests_per_question: Math.max(0, Math.min(20, Number(event.target.value || 0) || 0)),
              })
            }
            className="w-full rounded-xl border-2 border-brand-dark bg-white p-3 font-bold"
          />
          <p className="mt-2 text-xs font-bold text-brand-dark/55">{assistanceCopy.hintLimitHelp}</p>
        </div>
        <div>
          <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{assistanceCopy.actionLimit}</label>
          <input
            type="number"
            min="0"
            max="50"
            value={policy.max_total_actions_per_question}
            onChange={(event) =>
              onChange({
                ...policy,
                max_total_actions_per_question: Math.max(0, Math.min(50, Number(event.target.value || 0) || 0)),
              })
            }
            className="w-full rounded-xl border-2 border-brand-dark bg-white p-3 font-bold"
          />
          <p className="mt-2 text-xs font-bold text-brand-dark/55">{assistanceCopy.actionLimitHelp}</p>
        </div>
      </div>
    </div>
  );
}

export default function TeacherClassDetail() {
  const { language } = useAppLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const [classBoard, setClassBoard] = useState<TeacherClassWorkspace | null>(null);
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [progressLoading, setProgressLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [progressError, setProgressError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [copiedReminderKey, setCopiedReminderKey] = useState('');
  const [copiedClassLink, setCopiedClassLink] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState('');
  const [selectedRosterStudentIds, setSelectedRosterStudentIds] = useState<number[]>([]);
  const [progressBoard, setProgressBoard] = useState<TeacherClassProgressBoard | null>(null);
  const [progressStudentSearch, setProgressStudentSearch] = useState('');
  const [selectedProgressStudentId, setSelectedProgressStudentId] = useState<number | null>(null);
  const [compareProgressStudentId, setCompareProgressStudentId] = useState<number | null>(null);
  const [progressWindow, setProgressWindow] = useState<ProgressWindow>('all');
  const [progressStudentSort, setProgressStudentSort] = useState<ProgressStudentSort>('activity');
  const [progressTrackedOnly, setProgressTrackedOnly] = useState(true);
  const [compareStudentAgainstClass, setCompareStudentAgainstClass] = useState(true);
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [assignmentInstructions, setAssignmentInstructions] = useState('');
  const [assignmentDueAt, setAssignmentDueAt] = useState('');
  const [assignmentQuestionGoal, setAssignmentQuestionGoal] = useState('5');
  const [classAssistancePolicy, setClassAssistancePolicy] = useState<StudentAssistancePolicy>(DEFAULT_STUDENT_ASSISTANCE_POLICY);
  const [assignmentAssistancePolicy, setAssignmentAssistancePolicy] = useState<StudentAssistancePolicy>(DEFAULT_STUDENT_ASSISTANCE_POLICY);

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
      retentionActive7d: 'פעילים ב-7 הימים האחרונים',
      retentionSlipping: 'בסיכון להיעלמות',
      retentionInactive: 'לא פעילים',
      retentionNotStarted: 'עוד לא התחילו',
      linkedPack: 'חבילת הכיתה',
      openPack: 'פתח עריכת חבילה',
      inviteSent: 'המייל נשלח מחדש.',
      addStudentFirst: 'מלא/י שם תלמיד או אימייל לפני ההוספה.',
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
      noNotes: 'עדיין אין הערות לכיתה הזאת.',
      shareHint: 'אפשר לשלוח את הקישור הזה לכל תלמידי הכיתה. אחרי כניסה עם המייל שלהם, הכיתה תופיע אצלם לאישור או ככיתה פעילה.',
      library: 'ספריית שיעורים',
      addQuiz: 'הוסף שאלון לכיתה',
      removeQuiz: 'הסר מהכיתה',
      unnamedQuiz: 'שאלון ללא שם',
      selectPack: 'בחר שאלון מהקולקציה שלך...',
      noPacksInLibrary: 'עדיין אין שאלונים בתיקיית הכיתה הזאת.',
      hostSpecific: 'הפעל שיעור זה',
      progressTitle: 'התקדמות לאורך זמן',
      progressBody: 'כאן רואים גם את מגמת הכיתה כולה וגם את ההתקדמות של תלמיד מסוים לאורך סשנים רבים.',
      classTrendTitle: 'מגמת כיתה',
      classTrendBody: 'דיוק והשתתפות across all class sessions.',
      studentTrendTitle: 'מגמת תלמיד',
      studentTrendBody: 'בחר/י תלמיד כדי לראות איך הדיוק וההיקף שלו משתנים מסשן לסשן.',
      searchStudent: 'חפש תלמיד לפי שם או מייל...',
      chooseStudent: 'בחר/י תלמיד מהרשימה כדי לראות את ההתקדמות האישית שלו.',
      noStudentMatches: 'לא נמצאו תלמידים שתואמים לחיפוש.',
      noProgressYet: 'עדיין אין מספיק היסטוריה כיתתית כדי לצייר מגמת התקדמות.',
      participation: 'השתתפות',
      responses: 'תשובות',
      gamesTracked: 'משחקים במעקב',
      lastActive: 'פעילות אחרונה',
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
      retentionActive7d: 'نشطون خلال 7 أيام',
      retentionSlipping: 'مهددون بالانقطاع',
      retentionInactive: 'غير نشطين',
      retentionNotStarted: 'لم يبدأوا بعد',
      linkedPack: 'حزمة الصف',
      openPack: 'افتح تحرير الحزمة',
      inviteSent: 'تمت إعادة إرسال البريد.',
      addStudentFirst: 'أدخل اسم الطالب أو بريده قبل الإضافة.',
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
      noNotes: 'لا توجد ملاحظات لهذا الصف بعد.',
      shareHint: 'يمكنك إرسال هذا الرابط إلى طلاب الصف. بعد الدخول ببريدهم، سيظهر الصف للموافقة أو كصف نشط.',
      library: 'مكتبة الدروس',
      addQuiz: 'إضافة اختبار للصف',
      removeQuiz: 'إزالة من الصف',
      unnamedQuiz: 'اختبار بدون اسم',
      selectPack: 'اختر اختبارًا من مجموعتك...',
      noPacksInLibrary: 'لا توجد اختبارات في مجلد هذا الصف بعد.',
      hostSpecific: 'شغل هذا الدرس',
      progressTitle: 'التقدم عبر الزمن',
      progressBody: 'هنا ترى اتجاه الصف كله، ويمكنك أيضًا اختيار طالب محدد لرؤية تطوره عبر جلسات كثيرة.',
      classTrendTitle: 'اتجاه الصف',
      classTrendBody: 'الدقة والمشاركة عبر جميع جلسات الصف.',
      studentTrendTitle: 'اتجاه الطالب',
      studentTrendBody: 'اختر/ي طالبًا لرؤية كيف تتغير دقته وحضوره من جلسة إلى أخرى.',
      searchStudent: 'ابحث/ي عن طالب بالاسم أو البريد...',
      chooseStudent: 'اختر/ي طالبًا من القائمة لرؤية تقدمه الشخصي.',
      noStudentMatches: 'لم يتم العثور على طلاب يطابقون البحث.',
      noProgressYet: 'لا توجد بعد بيانات صفية كافية لرسم اتجاه التقدم.',
      participation: 'المشاركة',
      responses: 'الإجابات',
      gamesTracked: 'الألعاب المتتبعة',
      lastActive: 'آخر نشاط',
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
      retentionActive7d: 'active 7d',
      retentionSlipping: 'slipping',
      retentionInactive: 'inactive',
      retentionNotStarted: 'not started',
      linkedPack: 'Class pack',
      openPack: 'Open pack editor',
      inviteSent: 'Invite email sent again.',
      addStudentFirst: 'Add a student name or email before creating the row.',
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
      noNotes: 'No class notes yet.',
      shareHint: 'You can send this link to any student in the class. After they sign in with their email, the class will appear for approval or as an active class.',
      library: 'Lesson Library',
      addQuiz: 'Add quiz to class',
      removeQuiz: 'Remove from class',
      unnamedQuiz: 'Unnamed Quiz',
      selectPack: 'Select a quiz from your collection...',
      noPacksInLibrary: 'No quizzes in this class folder yet.',
      hostSpecific: 'Host this quiz',
      progressTitle: 'Progress Over Time',
      progressBody: 'See the class trend as a whole, then search for a student to inspect their long-term trajectory across many games.',
      classTrendTitle: 'Class Trend',
      classTrendBody: 'Accuracy and participation across all class sessions.',
      studentTrendTitle: 'Student Trend',
      studentTrendBody: 'Choose a student to inspect how accuracy and activity change from one session to the next.',
      searchStudent: 'Search by student name or email...',
      chooseStudent: 'Choose a student from the list to open their personal timeline.',
      noStudentMatches: 'No students matched this search.',
      noProgressYet: 'There is not enough class history yet to draw a progress trend.',
      participation: 'Participation',
      responses: 'Responses',
      gamesTracked: 'Games tracked',
      lastActive: 'Last active',
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
    addStudentFirst: 'Add a student name or email before creating the row.',
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
    progressTitle: 'Progress Over Time',
    progressBody: 'Track the class and a selected student over time.',
    classTrendTitle: 'Class Trend',
    classTrendBody: 'Class-wide accuracy and participation over time.',
    studentTrendTitle: 'Student Trend',
    studentTrendBody: 'Choose a student to inspect their progress.',
    searchStudent: 'Search for a student...',
    chooseStudent: 'Choose a student to inspect their timeline.',
    noStudentMatches: 'No students matched this search.',
    noProgressYet: 'Not enough progress history yet.',
    participation: 'Participation',
    responses: 'Responses',
    gamesTracked: 'Games tracked',
    lastActive: 'Last active',
  };

  const classId = useMemo(() => Number(id || 0), [id]);
  const progressLabels = {
    range:
      language === 'he' ? 'טווח' : language === 'ar' ? 'النطاق' : 'Range',
    all:
      language === 'he' ? 'הכול' : language === 'ar' ? 'الكل' : 'All',
    last5:
      language === 'he' ? '5 אחרונים' : language === 'ar' ? 'آخر 5' : 'Last 5',
    last10:
      language === 'he' ? '10 אחרונים' : language === 'ar' ? 'آخر 10' : 'Last 10',
    last20:
      language === 'he' ? '20 אחרונים' : language === 'ar' ? 'آخر 20' : 'Last 20',
    sort:
      language === 'he' ? 'מיין תלמידים' : language === 'ar' ? 'ترتيب الطلاب' : 'Sort students',
    trackedOnly:
      language === 'he' ? 'רק עם היסטוריה' : language === 'ar' ? 'فقط مع سجل' : 'Tracked only',
    compareToClass:
      language === 'he' ? 'השווה לכיתה' : language === 'ar' ? 'قارن مع الصف' : 'Compare to class',
    compareStudent:
      language === 'he' ? 'השוואת תלמיד' : language === 'ar' ? 'مقارنة طالب' : 'Compare student',
    setCompare:
      language === 'he' ? 'השווה' : language === 'ar' ? 'قارن' : 'Compare',
    clearCompare:
      language === 'he' ? 'נקה השוואה' : language === 'ar' ? 'إزالة المقارنة' : 'Clear compare',
    comparingAgainst:
      language === 'he' ? 'משווה מול' : language === 'ar' ? 'يقارن مع' : 'Comparing against',
    topImprover:
      language === 'he' ? 'משתפר מוביל' : language === 'ar' ? 'الأكثر تحسنًا' : 'Top improver',
    needsAttention:
      language === 'he' ? 'דורש תשומת לב' : language === 'ar' ? 'يحتاج انتباهًا' : 'Needs attention',
    momentum:
      language === 'he' ? 'מומנטום כיתתי' : language === 'ar' ? 'زخم الصف' : 'Class momentum',
    latestAccuracy:
      language === 'he' ? 'דיוק אחרון' : language === 'ar' ? 'آخر دقة' : 'Latest accuracy',
    averageAccuracy:
      language === 'he' ? 'דיוק ממוצע' : language === 'ar' ? 'متوسط الدقة' : 'Average accuracy',
    bestAccuracy:
      language === 'he' ? 'שיא דיוק' : language === 'ar' ? 'أفضل دقة' : 'Best accuracy',
    trendDelta:
      language === 'he' ? 'שינוי מגמה' : language === 'ar' ? 'تغير الاتجاه' : 'Trend delta',
    activeStudents:
      language === 'he' ? 'תלמידים במעקב' : language === 'ar' ? 'طلاب متتبعون' : 'Tracked students',
    sessionLog:
      language === 'he' ? 'יומן סשנים' : language === 'ar' ? 'سجل الجلسات' : 'Session log',
    noStudentHistory:
      language === 'he'
        ? 'לתלמיד הזה עדיין אין מספיק היסטוריה אישית להצגה.'
        : language === 'ar'
          ? 'لا يوجد بعد لهذا الطالب سجل شخصي كافٍ للعرض.'
          : 'This student does not have enough personal history yet.',
    clearSearch:
      language === 'he' ? 'נקה חיפוש' : language === 'ar' ? 'مسح البحث' : 'Clear search',
    recentSessions:
      language === 'he' ? 'הסשנים האחרונים' : language === 'ar' ? 'أحدث الجلسات' : 'Recent sessions',
    sessionsWithData:
      language === 'he' ? 'סשנים עם נתונים' : language === 'ar' ? 'جلسات مع بيانات' : 'Sessions with data',
    topicFocus:
      language === 'he' ? 'ביצועים לפי נושא' : language === 'ar' ? 'الأداء حسب الموضوع' : 'Performance by topic',
    topicFocusBody:
      language === 'he'
        ? 'איפה הכיתה חזקה, איפה היא נחלשת, ואיך התלמיד הנבחר נראה מול התמונה הרחבה.'
        : language === 'ar'
          ? 'أين الصف قوي، أين يضعف، وكيف يبدو الطالب المختار مقارنة بالصورة العامة.'
          : 'See where the class is strong, where it struggles, and how the selected learner compares.',
    classColumn:
      language === 'he' ? 'כיתה' : language === 'ar' ? 'الصف' : 'Class',
    selectedColumn:
      language === 'he' ? 'תלמיד נבחר' : language === 'ar' ? 'الطالب المختار' : 'Selected student',
    compareColumn:
      language === 'he' ? 'תלמיד להשוואה' : language === 'ar' ? 'طالب المقارنة' : 'Compare student',
    noTopicData:
      language === 'he' ? 'עדיין אין מספיק תשובות מתויגות כדי להציג מפת נושאים.' : language === 'ar' ? 'لا توجد بعد إجابات موسومة كافية لعرض خريطة الموضوعات.' : 'There is not enough tagged answer data yet.',
    actionPlan:
      language === 'he' ? 'המלצות פעולה למורה' : language === 'ar' ? 'خطوات مقترحة للمعلم' : 'Teacher action plan',
    actionPlanBody:
      language === 'he'
        ? 'שלוש פעולות מיידיות על בסיס מגמה, נושאים חלשים והשוואה בין תלמידים.'
        : language === 'ar'
          ? 'ثلاث خطوات فورية مبنية على الاتجاه، والموضوعات الضعيفة، والمقارنة بين الطلاب.'
          : 'Three immediate moves based on trend, weak topics, and student comparison.',
    practiceMore:
      language === 'he' ? 'לחזק' : language === 'ar' ? 'تعزيز' : 'Reinforce',
    challengeMore:
      language === 'he' ? 'לאתגר' : language === 'ar' ? 'تحدي' : 'Challenge',
    monitor:
      language === 'he' ? 'לעקוב' : language === 'ar' ? 'متابعة' : 'Monitor',
    sortActivity:
      language === 'he' ? 'הכי פעילים' : language === 'ar' ? 'الأكثر نشاطًا' : 'Most active',
    sortRecent:
      language === 'he' ? 'דיוק אחרון' : language === 'ar' ? 'آخر دقة' : 'Latest accuracy',
    sortImprovement:
      language === 'he' ? 'השיפור הגדול ביותר' : language === 'ar' ? 'أكبر تحسن' : 'Biggest improvement',
    sortName:
      language === 'he' ? 'שם א-ת' : language === 'ar' ? 'الاسم' : 'Name A-Z',
    improving:
      language === 'he' ? 'בעלייה' : language === 'ar' ? 'في تحسن' : 'Improving',
    declining:
      language === 'he' ? 'בירידה' : language === 'ar' ? 'في تراجع' : 'Declining',
    stable:
      language === 'he' ? 'יציב' : language === 'ar' ? 'مستقر' : 'Stable',
    fromStart:
      language === 'he' ? 'מההתחלה עד עכשיו' : language === 'ar' ? 'من البداية حتى الآن' : 'From first to latest',
    classBenchmark:
      language === 'he' ? 'קו כיתתי' : language === 'ar' ? 'خط الصف' : 'Class benchmark',
  };
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

  useEffect(() => {
    const activeAssignment = classBoard?.assignment_board?.active_assignment || null;
    if (!activeAssignment) {
      setAssignmentTitle('');
      setAssignmentInstructions('');
      setAssignmentDueAt('');
      setAssignmentQuestionGoal('5');
      setAssignmentAssistancePolicy(cloneAssistancePolicy(classBoard?.student_assistance_policy));
      return;
    }
    setAssignmentTitle(String(activeAssignment.title || ''));
    setAssignmentInstructions(String(activeAssignment.instructions || ''));
    setAssignmentDueAt(activeAssignment.due_at ? String(activeAssignment.due_at).slice(0, 16) : '');
    setAssignmentQuestionGoal(String(activeAssignment.question_goal || 5));
    setAssignmentAssistancePolicy(cloneAssistancePolicy(activeAssignment.student_assistance_policy));
  }, [classBoard?.assignment_board?.active_assignment?.id]);

  useEffect(() => {
    setClassAssistancePolicy(cloneAssistancePolicy(classBoard?.student_assistance_policy));
  }, [classBoard?.id, classBoard?.updated_at]);

  useEffect(() => {
    setSelectedRosterStudentIds([]);
  }, [classBoard?.id]);

  const loadProgress = useCallback(async (studentId?: number | null, compareStudentId?: number | null) => {
    if (!classId) return;
    try {
      setProgressLoading(true);
      setProgressError('');
      const payload = await getTeacherClassProgress(classId, studentId, compareStudentId);
      setProgressBoard(payload);
    } catch (loadError: any) {
      setProgressError(loadError?.message || 'Failed to load class progress.');
    } finally {
      setProgressLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void loadProgress(selectedProgressStudentId, compareProgressStudentId);
  }, [compareProgressStudentId, loadProgress, selectedProgressStudentId]);

  useEffect(() => {
    if (selectedProgressStudentId) return;
    const defaultStudent = progressBoard?.students?.find((student) => Number(student.session_count || 0) > 0) || null;
    if (defaultStudent?.id) {
      setSelectedProgressStudentId(Number(defaultStudent.id));
    }
  }, [progressBoard, selectedProgressStudentId]);

  useEffect(() => {
    if (!compareProgressStudentId || Number(compareProgressStudentId) !== Number(selectedProgressStudentId || 0)) return;
    setCompareProgressStudentId(null);
  }, [compareProgressStudentId, selectedProgressStudentId]);

  const handleSaveClass = async () => {
    if (!classBoard) return;
    const payload = {
      ...normalizePayload(form),
      student_assistance_policy: classAssistancePolicy,
    };
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
    if (!studentName.trim() && !studentEmail.trim()) {
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
      let resolvedBoard = classBoard;
      if (Number(classBoard.pack?.id || 0) !== Number(targetPackId)) {
        resolvedBoard = await addPackToClass(classBoard.id, Number(targetPackId));
        setClassBoard(resolvedBoard);
      }
      const session = await createClassSession({
        classId: resolvedBoard.id,
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
      const { board, delivery } = await resendTeacherClassStudentInvite(classBoard.id, studentId);
      const refreshed = board;
      setClassBoard(refreshed);
      const updatedStudent = refreshed.students.find((student) => Number(student.id) === Number(studentId)) || null;
      const deliveryState = String(delivery?.deliveryStatus || updatedStudent?.invite_delivery_status || 'none').toLowerCase();
      if (deliveryState === 'sent') {
        setFeedback(copy.inviteSent);
      } else if (deliveryState === 'not_configured') {
        setFeedback(
          `${copy.mailMissing} ${delivery?.error || updatedStudent?.invite_last_error || refreshed.mail_health?.missing?.join(', ') || 'EMAIL_PASS'}`,
        );
      } else {
        setFeedback(delivery?.error || updatedStudent?.invite_last_error || 'Failed to resend the invite.');
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
      setClassBoard({
        ...refreshed,
        students: refreshed.students.filter((student) => Number(student.id) !== Number(studentId)),
      });
      setFeedback(copy.studentRemoved);
    } catch (removeError: any) {
      setFeedback(removeError?.message || 'Failed to remove the student.');
    } finally {
      setBusyKey('');
    }
  };

  const toggleRosterStudentSelection = (studentId: number) => {
    setSelectedRosterStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((value) => value !== studentId)
        : [...current, studentId],
    );
  };

  const handleSelectAllRosterStudents = () => {
    if (!classBoard) return;
    setSelectedRosterStudentIds((current) =>
      current.length === classBoard.students.length ? [] : classBoard.students.map((student) => Number(student.id)),
    );
  };

  const handleBulkRemoveStudents = async () => {
    if (!classBoard || !selectedRosterStudentIds.length) return;
    if (!window.confirm(`Remove ${selectedRosterStudentIds.length} students from ${classBoard.name}?`)) {
      return;
    }
    try {
      setBusyKey('bulk-remove-students');
      let refreshedBoard = classBoard;
      for (const studentId of selectedRosterStudentIds) {
        refreshedBoard = await removeTeacherClassStudent(classBoard.id, studentId);
      }
      setClassBoard({
        ...refreshedBoard,
        students: refreshedBoard.students.filter((student) => !selectedRosterStudentIds.includes(Number(student.id))),
      });
      setSelectedRosterStudentIds([]);
      setFeedback(language === 'he' ? 'התלמידים הוסרו מהכיתה.' : language === 'ar' ? 'تمت إزالة الطلاب من الصف.' : 'Selected students were removed.');
    } catch (removeError: any) {
      setFeedback(removeError?.message || 'Failed to remove selected students.');
    } finally {
      setBusyKey('');
    }
  };

  const handleResendAllPendingInvites = async () => {
    if (!classBoard) return;
    const pendingStudents = classBoard.students.filter((student) => {
      const hasEmail = Boolean(String(student.email || '').trim());
      const inviteState = String(student.invite_status || 'none').toLowerCase();
      return hasEmail && inviteState !== 'claimed';
    });
    if (!pendingStudents.length) {
      setFeedback(language === 'he' ? 'אין כרגע תלמידים עם הזמנה ממתינה.' : language === 'ar' ? 'لا يوجد طلاب لديهم دعوة معلقة الآن.' : 'There are no pending invites right now.');
      return;
    }
    try {
      setBusyKey('bulk-resend-invites');
      let refreshedBoard = classBoard;
      for (const student of pendingStudents) {
        const payload = await resendTeacherClassStudentInvite(classBoard.id, Number(student.id));
        refreshedBoard = payload.board;
      }
      setClassBoard(refreshedBoard);
      setFeedback(language === 'he' ? 'נשלחו מחדש כל ההזמנות הממתינות.' : language === 'ar' ? 'تمت إعادة إرسال كل الدعوات المعلقة.' : 'Resent all pending invites.');
    } catch (inviteError: any) {
      setFeedback(inviteError?.message || 'Failed to resend pending invites.');
    } finally {
      setBusyKey('');
    }
  };

  const handleExportRosterCsv = async () => {
    if (!classBoard) return;
    const rows = [
      ['Name', 'Email', 'Invite Status', 'Delivery', 'Last Seen'],
      ...classBoard.students.map((student) => [
        String(student.name || ''),
        String(student.email || ''),
        formatInviteStatus(student.invite_status),
        formatDelivery(student.invite_delivery_status),
        formatRelativeTime(student.last_seen_at),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(classBoard.name || 'class').trim().replace(/\s+/g, '-').toLowerCase()}-roster.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setFeedback(language === 'he' ? 'רשימת התלמידים יוצאה ל-CSV.' : language === 'ar' ? 'تم تصدير قائمة الطلاب إلى CSV.' : 'Exported class roster to CSV.');
    } catch (exportError: any) {
      setFeedback(exportError?.message || 'Failed to export class roster.');
    }
  };

  const handleSaveAssignment = async () => {
    if (!classBoard) return;
    if (!classBoard.pack?.id) {
      setFeedback(language === 'he' ? 'צריך לשייך חבילה לפני יצירת משימה.' : language === 'ar' ? 'يجب ربط حزمة قبل إنشاء المهمة.' : 'Assign a pack before creating an assignment.');
      return;
    }
    if (!assignmentTitle.trim()) {
      setFeedback(language === 'he' ? 'צריך כותרת למשימה.' : language === 'ar' ? 'يجب إدخال عنوان للمهمة.' : 'Assignment title is required.');
      return;
    }
    try {
      setBusyKey('save-assignment');
      const activeAssignment = classBoard.assignment_board?.active_assignment || null;
      const payload = {
        title: assignmentTitle,
        instructions: assignmentInstructions,
        due_at: assignmentDueAt ? new Date(assignmentDueAt).toISOString() : null,
        question_goal: Number(assignmentQuestionGoal || 0) || 5,
        pack_id: Number(classBoard.pack.id),
        student_assistance_policy: assignmentAssistancePolicy,
      };
      const refreshed = activeAssignment?.id
        ? await updateTeacherClassAssignment(classBoard.id, Number(activeAssignment.id), payload)
        : await createTeacherClassAssignment(classBoard.id, payload);
      setClassBoard(refreshed);
      setFeedback(language === 'he' ? 'המשימה נשמרה לכיתה.' : language === 'ar' ? 'تم حفظ المهمة لهذا الصف.' : 'Assignment saved for this class.');
    } catch (assignmentError: any) {
      setFeedback(assignmentError?.message || 'Failed to save assignment.');
    } finally {
      setBusyKey('');
    }
  };

  const handleArchiveAssignment = async (assignment: TeacherClassAssignment) => {
    if (!classBoard) return;
    try {
      setBusyKey('archive-assignment');
      const refreshed = await deleteTeacherClassAssignment(classBoard.id, Number(assignment.id));
      setClassBoard(refreshed);
      setFeedback(language === 'he' ? 'המשימה הועברה לארכיון.' : language === 'ar' ? 'تمت أرشفة المهمة.' : 'Assignment archived.');
    } catch (assignmentError: any) {
      setFeedback(assignmentError?.message || 'Failed to archive assignment.');
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
  const translatedRetentionHeadline =
    language === 'he'
      ? classRetention.level === 'high'
        ? `${classRetention.needs_attention_count} תלמידים צריכים החזרה למסלול`
        : classRetention.level === 'medium'
          ? 'המומנטום של הכיתה מתחיל להיחלש'
          : 'רמת ההשתתפות נראית בריאה'
      : language === 'ar'
        ? classRetention.level === 'high'
          ? `${classRetention.needs_attention_count} طلاب يحتاجون إلى إعادة إدماج`
          : classRetention.level === 'medium'
            ? 'زخم الصف بدأ يضعف'
            : 'مستوى المشاركة يبدو جيدًا'
        : classRetention.headline;
  const translatedRetentionBody =
    language === 'he'
      ? classRetention.level === 'high'
        ? 'כדאי לשלוח משימת חזרה קצרה, תרגול ממוקד או פנייה ישירה לפני שהתלמידים האלה נעלמים מהמעגל.'
        : classRetention.level === 'medium'
          ? 'יש כמה תלמידים שמתחילים להתרחק. משימת המשך קצרה או בדיקת בית קלה יכולה להחזיר אותם.'
          : 'רוב חברי הכיתה עדיין פעילים. שמרו על הקצב עם תרגול קצר בין הסשנים החיים.'
      : language === 'ar'
        ? classRetention.level === 'high'
          ? 'استخدم مراجعة قصيرة أو تدريبًا مركزًا أو تواصلًا مباشرًا قبل أن يخرج هؤلاء الطلاب من الحلقة.'
          : classRetention.level === 'medium'
            ? 'هناك بعض الطلاب الذين بدأوا يبتعدون. مهمة متابعة قصيرة أو واجب خفيف قد يعيدهم.'
            : 'معظم أعضاء الصف ما زالوا نشطين. حافظوا على الإيقاع بتدريب قصير بين الجلسات الحية.'
        : classRetention.body;
  const translatedRetentionWatchlist = classRetention.watchlist_students.map((student) => {
    if (language === 'en') return student;

    const translatedReason =
      language === 'he'
        ? student.status === 'never_started'
          ? 'התלמיד/ה הזה עדיין לא השתתף/ה בסשן חי של Quizzi.'
          : student.status === 'inactive_14d'
            ? 'לא נרשמה פעילות חיה או תרגול בתקופה האחרונה, וכדאי להחזיר את התלמיד/ה למסלול.'
            : 'נראה שהמומנטום של התלמיד/ה דועך וכדאי לבצע מעקב קצר.'
        : student.status === 'never_started'
          ? 'هذا الطالب لم ينضم بعد إلى جلسة Quizzi مباشرة.'
          : student.status === 'inactive_14d'
            ? 'لا يوجد نشاط مباشر أو تدريبي مؤخرًا، ويستحسن إعادة هذا الطالب إلى المسار.'
            : 'يبدو أن الزخم عند هذا الطالب يتراجع ويحتاج إلى متابعة قصيرة.';

    return {
      ...student,
      reason: translatedReason,
    };
  });
  const recentSessions = Array.isArray(classBoard.recent_sessions) ? classBoard.recent_sessions : [];
  const classProgressSeries = Array.isArray(progressBoard?.class_series) ? progressBoard.class_series : [];
  const progressStudents = Array.isArray(progressBoard?.students) ? progressBoard.students : [];
  const selectedStudentProgressSeries = Array.isArray(progressBoard?.selected_student_series)
    ? progressBoard.selected_student_series
    : [];
  const compareStudentProgressSeries = Array.isArray(progressBoard?.compare_student_series)
    ? progressBoard.compare_student_series
    : [];
  const topicSummary = Array.isArray(progressBoard?.topic_summary) ? progressBoard.topic_summary : [];
  const progressWindowSize = progressWindow === 'all' ? null : Number(progressWindow);
  const classProgressWindowSeries = progressWindowSize ? classProgressSeries.slice(-progressWindowSize) : classProgressSeries;
  const trackedProgressStudents = progressTrackedOnly
    ? progressStudents.filter((student) => Number(student.session_count || 0) > 0)
    : progressStudents;
  const sortedProgressStudents = [...trackedProgressStudents].sort((left, right) => {
    if (progressStudentSort === 'recent') {
      return Number(right.latest_accuracy ?? -1) - Number(left.latest_accuracy ?? -1);
    }
    if (progressStudentSort === 'improvement') {
      return Number(right.improvement_delta ?? -999) - Number(left.improvement_delta ?? -999);
    }
    if (progressStudentSort === 'name') {
      return String(left.name || '').localeCompare(String(right.name || ''));
    }
    const sessionDelta = Number(right.session_count || 0) - Number(left.session_count || 0);
    if (sessionDelta !== 0) return sessionDelta;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
  const filteredProgressStudents = sortedProgressStudents.filter((student) => {
    const query = progressStudentSearch.trim().toLowerCase();
    if (!query) return true;
    return `${student.name} ${student.email}`.toLowerCase().includes(query);
  });
  const selectedProgressStudent =
    progressStudents.find((student) => Number(student.id) === Number(selectedProgressStudentId || 0)) || null;
  const compareProgressStudent =
    progressStudents.find((student) => Number(student.id) === Number(compareProgressStudentId || 0)) || null;
  const selectedStudentWindowSeries = progressWindowSize
    ? selectedStudentProgressSeries.slice(-progressWindowSize)
    : selectedStudentProgressSeries;
  const compareStudentWindowSeries = progressWindowSize
    ? compareStudentProgressSeries.slice(-progressWindowSize)
    : compareStudentProgressSeries;
  const classAccuracyAverage = averageAccuracy(classProgressWindowSeries);
  const classLatestAccuracy = averageAccuracy(classProgressWindowSeries.slice(-1));
  const classTrendDelta = accuracyDelta(classProgressWindowSeries);
  const selectedStudentAverageAccuracy = averageAccuracy(selectedStudentWindowSeries);
  const selectedStudentLatestAccuracy = averageAccuracy(selectedStudentWindowSeries.slice(-1));
  const selectedStudentTrendDelta = accuracyDelta(selectedStudentWindowSeries);
  const compareStudentAverageAccuracy = averageAccuracy(compareStudentWindowSeries);
  const compareStudentLatestAccuracy = averageAccuracy(compareStudentWindowSeries.slice(-1));
  const compareStudentTrendDelta = accuracyDelta(compareStudentWindowSeries);
  const selectedStudentAccuracyValues = selectedStudentWindowSeries
    .map((row) => (row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const selectedStudentBestAccuracy = selectedProgressStudent?.best_accuracy ?? (
    selectedStudentAccuracyValues.length ? Math.max(...selectedStudentAccuracyValues) : null
  );
  const progressSummaryStudents = progressStudents.filter((student) => Number(student.session_count || 0) > 0);
  const topImproverStudent = [...progressSummaryStudents]
    .filter((student) => Number.isFinite(Number(student.improvement_delta)))
    .sort((left, right) => Number(right.improvement_delta ?? -999) - Number(left.improvement_delta ?? -999))[0] || null;
  const needsAttentionStudent = [...progressSummaryStudents]
    .sort((left, right) => {
      const accuracyDelta = Number(left.latest_accuracy ?? 999) - Number(right.latest_accuracy ?? 999);
      if (accuracyDelta !== 0) return accuracyDelta;
      return Number(left.improvement_delta ?? 999) - Number(right.improvement_delta ?? 999);
    })[0] || null;
  const classMomentumLabel =
    classTrendDelta === null
      ? progressLabels.stable
      : classTrendDelta > 4
        ? progressLabels.improving
        : classTrendDelta < -4
          ? progressLabels.declining
          : progressLabels.stable;
  const classPeakParticipation = Math.max(...classProgressWindowSeries.map((row) => Number(row.participant_count || 0)), 0);
  const selectedStudentClassCompareRows = selectedStudentWindowSeries.map((row) => {
    const classMatch = classProgressSeries.find((entry) => Number(entry.session_id) === Number(row.session_id)) || null;
    return {
      ...row,
      accuracy_pct: classMatch?.accuracy_pct ?? null,
    };
  });
  const selectedStudentCompareRows = selectedStudentWindowSeries.map((row) => {
    const compareMatch = compareStudentWindowSeries.find((entry) => Number(entry.session_id) === Number(row.session_id)) || null;
    return {
      ...row,
      accuracy_pct: compareMatch?.accuracy_pct ?? null,
    };
  });
  const selectedStudentSessionLog = [...selectedStudentWindowSeries].reverse();
  const topicRows = topicSummary.slice(0, 6);
  const assignmentBoard = classBoard.assignment_board || { active_assignment: null, assignments: [] };
  const activeAssignment = assignmentBoard.active_assignment || null;
  const archivedAssignments = assignmentBoard.assignments.filter((assignment) => Number(assignment.id) !== Number(activeAssignment?.id || 0));
  const weakestClassTopic = [...topicSummary]
    .filter((row) => Number(row.class_answers || 0) > 0 && row.class_accuracy !== null)
    .sort((left, right) => {
      const accuracyDelta = Number(left.class_accuracy ?? 999) - Number(right.class_accuracy ?? 999);
      if (accuracyDelta !== 0) return accuracyDelta;
      return Number(right.class_answers || 0) - Number(left.class_answers || 0);
    })[0] || null;
  const teacherActionCards = [
    weakestClassTopic?.class_accuracy !== null && weakestClassTopic?.class_answers > 0
      ? {
          key: 'class-focus',
          tone: 'yellow' as const,
          badge: progressLabels.practiceMore,
          title:
            language === 'he'
              ? `לחזק את ${weakestClassTopic.tag}`
              : language === 'ar'
                ? `تعزيز ${weakestClassTopic.tag}`
                : `Reinforce ${weakestClassTopic.tag}`,
          body:
            language === 'he'
              ? `בכיתה הדיוק בנושא הזה עומד על ${weakestClassTopic.class_accuracy ?? '--'}% לאורך ${weakestClassTopic.class_answers} תשובות. זה הנושא הכי נכון להתערבות הקרובה.`
              : language === 'ar'
                ? `دقة الصف في هذا الموضوع هي ${weakestClassTopic.class_accuracy ?? '--'}% عبر ${weakestClassTopic.class_answers} إجابات. هذا أفضل موضوع للتدخل القريب.`
                : `Class accuracy on this topic is ${weakestClassTopic.class_accuracy ?? '--'}% across ${weakestClassTopic.class_answers} answers. This is the clearest next intervention area.`,
        }
      : null,
    needsAttentionStudent
      ? {
          key: 'student-support',
          tone: 'rose' as const,
          badge: progressLabels.monitor,
          title:
            language === 'he'
              ? `לעקוב אחרי ${needsAttentionStudent.name}`
              : language === 'ar'
                ? `متابعة ${needsAttentionStudent.name}`
                : `Monitor ${needsAttentionStudent.name}`,
          body:
            language === 'he'
              ? `${needsAttentionStudent.name} נמצא כרגע על ${needsAttentionStudent.latest_accuracy ?? '--'}% עם שינוי של ${formatSignedDelta(needsAttentionStudent.improvement_delta)}. ${needsAttentionStudent.weakest_tag ? `כדאי לבדוק במיוחד את ${needsAttentionStudent.weakest_tag}.` : 'כדאי לבדוק איפה נוצר הפער.'}`
              : language === 'ar'
                ? `${needsAttentionStudent.name} يقف الآن عند ${needsAttentionStudent.latest_accuracy ?? '--'}% مع تغير ${formatSignedDelta(needsAttentionStudent.improvement_delta)}. ${needsAttentionStudent.weakest_tag ? `من الجيد التركيز على ${needsAttentionStudent.weakest_tag}.` : 'يستحق فحص موضع الفجوة.'}`
                : `${needsAttentionStudent.name} is currently at ${needsAttentionStudent.latest_accuracy ?? '--'}% with a ${formatSignedDelta(needsAttentionStudent.improvement_delta)} trend. ${needsAttentionStudent.weakest_tag ? `Focus on ${needsAttentionStudent.weakest_tag}.` : 'Review where the drop is happening.'}`,
        }
      : null,
    topImproverStudent
      ? {
          key: 'student-challenge',
          tone: 'mint' as const,
          badge: progressLabels.challengeMore,
          title:
            language === 'he'
              ? `לאתגר את ${topImproverStudent.name}`
              : language === 'ar'
                ? `تحدي ${topImproverStudent.name}`
                : `Challenge ${topImproverStudent.name}`,
          body:
            language === 'he'
              ? `${topImproverStudent.name} במגמת עלייה של ${formatSignedDelta(topImproverStudent.improvement_delta)}. ${topImproverStudent.strongest_tag ? `נראה חזק במיוחד ב-${topImproverStudent.strongest_tag}.` : 'נראה מוכן לרמה הבאה.'}`
              : language === 'ar'
                ? `${topImproverStudent.name} في تحسن بمقدار ${formatSignedDelta(topImproverStudent.improvement_delta)}. ${topImproverStudent.strongest_tag ? `يبدو قويًا خصوصًا في ${topImproverStudent.strongest_tag}.` : 'يبدو جاهزًا للمستوى التالي.'}`
                : `${topImproverStudent.name} is improving by ${formatSignedDelta(topImproverStudent.improvement_delta)}. ${topImproverStudent.strongest_tag ? `Strongest area: ${topImproverStudent.strongest_tag}.` : 'Looks ready for the next level.'}`,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; tone: 'yellow' | 'mint' | 'rose'; badge: string; title: string; body: string }>;
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

          <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(180px,0.42fr)_minmax(180px,0.42fr)]">
            <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A] xl:min-h-[250px]">
              <div className="mb-4 flex items-start gap-3">
                <Sparkles className="h-6 w-6 text-brand-orange" />
                <div>
                  <h2 className="text-2xl font-black">{copy.classSpace}</h2>
                  <p className="mt-1 text-sm font-bold leading-6 text-brand-dark/55">{copy.classSpaceBody}</p>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.studentEntry}</p>
                  <div className="mt-3 rounded-[1rem] border-2 border-brand-dark/15 bg-white px-4 py-4 shadow-[2px_2px_0px_0px_#1A1A1A]">
                    <p className="break-all font-mono text-sm font-black leading-7 text-brand-dark/70">
                      {buildGenericClassStudentLink()}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCopyClassLink()}
                    className="inline-flex min-h-[58px] items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    <Copy className="h-4 w-4" />
                    {copy.copyClassLink}
                  </button>
                  <div className="rounded-[1.2rem] border border-brand-dark/15 bg-white px-4 py-3 text-sm font-bold leading-6 text-brand-dark/60">
                    {copiedClassLink ? copy.copiedClassLink : copy.shareHint}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-1">
              <MetricTile label={copy.approvalRate} value={`${classBoard.student_count ? Math.round((syncSummary.approved / classBoard.student_count) * 100) : 0}%`} />
              <MetricTile label={copy.pendingAccess} value={String(syncSummary.pending)} />
              <MetricTile
                label={copy.liveState}
                value={hasOpenLiveRoom ? copy.liveOpen : copy.liveClosed}
                meta={hasOpenLiveRoom ? `${copy.livePin}: ${classBoard.active_session?.pin || ''}` : null}
              />
            </div>
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
              <div className="min-w-0 rounded-[1.8rem] border-2 border-brand-dark bg-white/80 p-5 lg:min-w-[300px]">
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

          <section className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
            <div className="mb-5 flex items-center gap-3">
              <TrendingUp className="h-6 w-6 text-brand-orange" />
              <div>
                <h2 className="text-2xl font-black">{copy.progressTitle}</h2>
                <p className="text-sm font-bold text-brand-dark/55">{copy.progressBody}</p>
              </div>
            </div>

            {progressLoading ? (
              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 font-bold text-brand-dark/70">
                {language === 'he' ? 'טוען היסטוריית התקדמות...' : language === 'ar' ? 'جارٍ تحميل سجل التقدم...' : 'Loading progress history...'}
              </div>
            ) : progressError ? (
              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-rose-50 p-5 font-bold text-brand-dark">
                {progressError}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,auto)]">
                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{progressLabels.range}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { value: 'all', label: progressLabels.all },
                        { value: '5', label: progressLabels.last5 },
                        { value: '10', label: progressLabels.last10 },
                        { value: '20', label: progressLabels.last20 },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setProgressWindow(option.value as ProgressWindow)}
                          className={`rounded-full border-2 border-brand-dark px-4 py-2 text-sm font-black ${
                            progressWindow === option.value ? 'bg-brand-yellow' : 'bg-white'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
                      <label className="block">
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{progressLabels.sort}</span>
                        <select
                          value={progressStudentSort}
                          onChange={(event) => setProgressStudentSort(event.target.value as ProgressStudentSort)}
                          className="w-full rounded-full border-2 border-brand-dark bg-white px-4 py-3 font-black outline-none"
                        >
                          <option value="activity">{progressLabels.sortActivity}</option>
                          <option value="recent">{progressLabels.sortRecent}</option>
                          <option value="improvement">{progressLabels.sortImprovement}</option>
                          <option value="name">{progressLabels.sortName}</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => setProgressTrackedOnly((current) => !current)}
                        className={`rounded-full border-2 border-brand-dark px-4 py-3 text-sm font-black ${
                          progressTrackedOnly ? 'bg-brand-yellow' : 'bg-white'
                        }`}
                      >
                        {progressLabels.trackedOnly}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (compareProgressStudentId) {
                            setCompareProgressStudentId(null);
                            return;
                          }
                          setCompareStudentAgainstClass((current) => !current);
                        }}
                        disabled={!selectedProgressStudent && !compareProgressStudentId}
                        className={`rounded-full border-2 border-brand-dark px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50 ${
                          compareProgressStudentId || compareStudentAgainstClass ? 'bg-brand-yellow' : 'bg-white'
                        }`}
                      >
                        {compareProgressStudentId ? progressLabels.clearCompare : progressLabels.compareToClass}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label={copy.gamesTracked}
                    value={String(classProgressWindowSeries.length)}
                    meta={progressLabels.sessionsWithData}
                  />
                  <MetricTile
                    label={progressLabels.averageAccuracy}
                    value={classAccuracyAverage !== null ? `${classAccuracyAverage}%` : '--'}
                    meta={progressLabels.fromStart}
                  />
                  <MetricTile
                    label={progressLabels.trendDelta}
                    value={formatSignedDelta(classTrendDelta)}
                    meta={classMomentumLabel}
                  />
                  <MetricTile
                    label={progressLabels.activeStudents}
                    value={String(progressSummaryStudents.length)}
                    meta={`${copy.participation}: ${classPeakParticipation}`}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <ProgressInsightCard
                    title={progressLabels.momentum}
                    value={classMomentumLabel}
                    meta={`${progressLabels.trendDelta}: ${formatSignedDelta(classTrendDelta)} • ${progressLabels.latestAccuracy}: ${classLatestAccuracy !== null ? `${classLatestAccuracy}%` : '--'}`}
                    tone={classTrendDelta !== null && classTrendDelta < 0 ? 'rose' : 'yellow'}
                  />
                  <ProgressInsightCard
                    title={progressLabels.topImprover}
                    value={topImproverStudent?.name || '--'}
                    meta={topImproverStudent
                      ? `${progressLabels.trendDelta}: ${formatSignedDelta(topImproverStudent.improvement_delta)} • ${progressLabels.latestAccuracy}: ${topImproverStudent.latest_accuracy !== null ? `${topImproverStudent.latest_accuracy}%` : '--'}`
                      : copy.noProgressYet}
                    tone="mint"
                  />
                  <ProgressInsightCard
                    title={progressLabels.needsAttention}
                    value={needsAttentionStudent?.name || '--'}
                    meta={needsAttentionStudent
                      ? `${progressLabels.latestAccuracy}: ${needsAttentionStudent.latest_accuracy !== null ? `${needsAttentionStudent.latest_accuracy}%` : '--'} • ${progressLabels.trendDelta}: ${formatSignedDelta(needsAttentionStudent.improvement_delta)}`
                      : copy.noProgressYet}
                    tone="rose"
                  />
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="mb-4">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{progressLabels.topicFocus}</p>
                      <p className="mt-1 text-sm font-bold text-brand-dark/60">{progressLabels.topicFocusBody}</p>
                    </div>
                    {topicRows.length > 0 ? (
                      <div className="space-y-4">
                        {topicRows.map((row) => (
                          <div key={`topic-row-${row.tag}`}>
                            <TopicComparisonRow
                              tag={row.tag}
                              answersLabel={copy.responses}
                              classLabel={progressLabels.classColumn}
                              selectedLabel={selectedProgressStudent?.name || progressLabels.selectedColumn}
                              compareLabel={compareProgressStudent?.name || progressLabels.compareColumn}
                              classAccuracy={row.class_accuracy}
                              classAnswers={row.class_answers}
                              selectedAccuracy={row.selected_accuracy}
                              selectedAnswers={row.selected_answers}
                              compareAccuracy={row.compare_accuracy}
                              compareAnswers={row.compare_answers}
                              showCompare={Boolean(compareProgressStudent)}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="font-bold text-brand-dark/60">{progressLabels.noTopicData}</p>
                    )}
                  </div>

                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="mb-4">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{progressLabels.actionPlan}</p>
                      <p className="mt-1 text-sm font-bold text-brand-dark/60">{progressLabels.actionPlanBody}</p>
                    </div>
                    <div className="space-y-3">
                      {teacherActionCards.map((action) => (
                        <div key={action.key}>
                          <ProgressInsightCard
                            title={action.badge}
                            value={action.title}
                            meta={action.body}
                            tone={action.tone}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="mb-4">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.classTrendTitle}</p>
                      <p className="mt-1 text-sm font-bold text-brand-dark/60">{copy.classTrendBody}</p>
                    </div>
                    {classProgressWindowSeries.length > 0 ? (
                      <>
                        <TimelineProgressChart
                          rows={classProgressWindowSeries}
                          primaryLabel={language === 'he' ? 'דיוק כיתתי' : language === 'ar' ? 'دقة الصف' : 'Class accuracy'}
                          secondaryLabel={copy.participation}
                          secondaryKey="participant_count"
                        />
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <MetricTile label={copy.gamesTracked} value={String(classProgressWindowSeries.length)} />
                          <MetricTile
                            label={progressLabels.averageAccuracy}
                            value={classAccuracyAverage !== null ? `${classAccuracyAverage}%` : '--'}
                          />
                          <MetricTile
                            label={copy.participation}
                            value={String(classPeakParticipation)}
                            meta={language === 'he' ? 'שיא משתתפים' : language === 'ar' ? 'ذروة المشاركين' : 'Peak participants'}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="font-bold text-brand-dark/60">{copy.noProgressYet}</p>
                    )}
                  </div>

                  <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.studentTrendTitle}</p>
                        <p className="mt-1 text-sm font-bold text-brand-dark/60">{copy.studentTrendBody}</p>
                      </div>
                      {progressStudentSearch ? (
                        <button
                          type="button"
                          onClick={() => setProgressStudentSearch('')}
                          className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black"
                        >
                          {progressLabels.clearSearch}
                        </button>
                      ) : null}
                    </div>
                    <div className="relative mb-4">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-dark/40" />
                      <input
                        value={progressStudentSearch}
                        onChange={(event) => setProgressStudentSearch(event.target.value)}
                        placeholder={copy.searchStudent}
                        className="w-full rounded-full border-2 border-brand-dark bg-white py-3 pl-11 pr-4 font-bold focus:outline-none"
                      />
                    </div>
                    <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {filteredProgressStudents.length > 0 ? (
                        filteredProgressStudents.map((student) => {
                          const selected = Number(student.id) === Number(selectedProgressStudentId || 0);
                          return (
                            <div
                              key={student.id}
                              className={`w-full rounded-[1.3rem] border-2 border-brand-dark px-4 py-3 text-left shadow-[3px_3px_0px_0px_#1A1A1A] ${
                                selected ? 'bg-brand-yellow' : 'bg-white'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-black">{student.name}</p>
                                  <p className="truncate text-sm font-bold text-brand-dark/60">{student.email || copy.noInvite}</p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  <span className="shrink-0 rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                                    {student.session_count}
                                  </span>
                                  <TrendDeltaPill delta={student.improvement_delta ?? null} />
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 text-xs font-black text-brand-dark/55 sm:grid-cols-3">
                                <span>{copy.gamesTracked}: {student.session_count}</span>
                                <span>{progressLabels.averageAccuracy}: {student.avg_accuracy !== null ? `${student.avg_accuracy}%` : '--'}</span>
                                <span>{progressLabels.latestAccuracy}: {student.latest_accuracy !== null ? `${student.latest_accuracy}%` : '--'}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedProgressStudentId(Number(student.id));
                                  }}
                                  className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-[11px] font-black uppercase"
                                >
                                  {progressLabels.selectedColumn}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCompareProgressStudentId((current) => Number(current || 0) === Number(student.id) ? null : Number(student.id));
                                  }}
                                  disabled={Number(student.id) === Number(selectedProgressStudentId || 0)}
                                  className={`rounded-full border-2 border-brand-dark px-3 py-2 text-[11px] font-black uppercase disabled:cursor-not-allowed disabled:opacity-50 ${
                                    Number(compareProgressStudentId || 0) === Number(student.id) ? 'bg-brand-orange text-white' : 'bg-white'
                                  }`}
                                >
                                  {Number(compareProgressStudentId || 0) === Number(student.id) ? progressLabels.clearCompare : progressLabels.setCompare}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="font-bold text-brand-dark/60">{copy.noStudentMatches}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{copy.studentTrendTitle}</p>
                      <h3 className="text-2xl font-black">
                        {selectedProgressStudent ? selectedProgressStudent.name : copy.chooseStudent}
                      </h3>
                      {selectedProgressStudent ? (
                        <p className="text-sm font-bold text-brand-dark/60">
                          {copy.gamesTracked}: {selectedProgressStudent.session_count} • {copy.lastActive}: {formatRelativeTime(selectedProgressStudent.last_activity_at)}
                        </p>
                      ) : (
                        <p className="text-sm font-bold text-brand-dark/60">{copy.studentTrendBody}</p>
                      )}
                    </div>
                    {selectedProgressStudent ? (
                      <div className="flex flex-wrap gap-2">
                        <TrendDeltaPill delta={selectedProgressStudent.improvement_delta ?? selectedStudentTrendDelta} />
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black uppercase">
                          {compareProgressStudent
                            ? `${progressLabels.comparingAgainst}: ${compareProgressStudent.name}`
                            : `${progressLabels.classBenchmark}: ${compareStudentAgainstClass ? 'ON' : 'OFF'}`}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {selectedProgressStudent ? (
                    <>
                      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricTile
                          label={progressLabels.averageAccuracy}
                          value={selectedStudentAverageAccuracy !== null ? `${selectedStudentAverageAccuracy}%` : '--'}
                        />
                        <MetricTile
                          label={progressLabels.latestAccuracy}
                          value={selectedStudentLatestAccuracy !== null ? `${selectedStudentLatestAccuracy}%` : '--'}
                        />
                        <MetricTile
                          label={progressLabels.bestAccuracy}
                          value={selectedStudentBestAccuracy !== null && Number.isFinite(selectedStudentBestAccuracy) ? `${Math.round(selectedStudentBestAccuracy)}%` : '--'}
                        />
                        <MetricTile
                          label={progressLabels.trendDelta}
                          value={formatSignedDelta(selectedProgressStudent.improvement_delta ?? selectedStudentTrendDelta)}
                        />
                      </div>

                      {compareProgressStudent ? (
                        <div className="mb-5 grid gap-3 md:grid-cols-3">
                          <MetricTile
                            label={`${progressLabels.compareStudent}: ${compareProgressStudent.name}`}
                            value={compareStudentAverageAccuracy !== null ? `${compareStudentAverageAccuracy}%` : '--'}
                            meta={progressLabels.averageAccuracy}
                          />
                          <MetricTile
                            label={progressLabels.latestAccuracy}
                            value={compareStudentLatestAccuracy !== null ? `${compareStudentLatestAccuracy}%` : '--'}
                          />
                          <MetricTile
                            label={progressLabels.trendDelta}
                            value={formatSignedDelta(compareProgressStudent.improvement_delta ?? compareStudentTrendDelta)}
                          />
                        </div>
                      ) : null}

                      {selectedStudentWindowSeries.length > 0 ? (
                        <>
                          <TimelineProgressChart
                            rows={selectedStudentWindowSeries}
                            primaryLabel={language === 'he' ? 'דיוק תלמיד' : language === 'ar' ? 'دقة الطالب' : 'Student accuracy'}
                            secondaryLabel={copy.responses}
                            secondaryKey="answer_count"
                            compareRows={
                              compareProgressStudent
                                ? selectedStudentCompareRows
                                : compareStudentAgainstClass
                                  ? selectedStudentClassCompareRows
                                  : undefined
                            }
                            compareLabel={compareProgressStudent ? compareProgressStudent.name : progressLabels.classBenchmark}
                          />

                          <div className="mt-5 rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{progressLabels.sessionLog}</p>
                              <p className="text-sm font-bold text-brand-dark/55">{progressLabels.recentSessions}</p>
                            </div>
                            <div className="space-y-3">
                              {selectedStudentSessionLog.slice(0, 6).map((row) => {
                                const classMatch = classProgressSeries.find((entry) => Number(entry.session_id) === Number(row.session_id)) || null;
                                const classAccuracy = classMatch?.accuracy_pct ?? null;
                                const compareMatch = compareStudentWindowSeries.find((entry) => Number(entry.session_id) === Number(row.session_id)) || null;
                                const versusClass =
                                  classAccuracy === null || row.accuracy_pct === null
                                    ? null
                                    : Math.round(Number(row.accuracy_pct) - Number(classAccuracy));
                                const versusCompare =
                                  compareMatch?.accuracy_pct === null || compareMatch?.accuracy_pct === undefined || row.accuracy_pct === null
                                    ? null
                                    : Math.round(Number(row.accuracy_pct) - Number(compareMatch.accuracy_pct));
                                return (
                                  <div key={`student-session-log-${row.session_id}`} className="rounded-[1rem] border border-brand-dark/10 bg-brand-bg px-4 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-black">{row.pack_title || row.label}</p>
                                        <p className="text-xs font-bold text-brand-dark/55">
                                          {formatShortDate(row.ended_at || row.started_at, language)} • {row.label}
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2 text-xs font-black uppercase">
                                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                          {row.accuracy_pct !== null ? `${Math.round(Number(row.accuracy_pct))}%` : '--'}
                                        </span>
                                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                          {copy.responses}: {Number(row.answer_count || 0)}
                                        </span>
                                        {versusClass !== null ? (
                                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                            {progressLabels.classBenchmark}: {formatSignedDelta(versusClass)}
                                          </span>
                                        ) : null}
                                        {compareProgressStudent && versusCompare !== null ? (
                                          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                            {compareProgressStudent.name}: {formatSignedDelta(versusCompare)}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="font-bold text-brand-dark/60">{progressLabels.noStudentHistory}</p>
                      )}
                    </>
                  ) : (
                    <p className="font-bold text-brand-dark/60">{copy.chooseStudent}</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="min-w-0 space-y-6">
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
                <div className="mt-4">
                  <AssistancePolicyEditor
                    title={language === 'he' ? 'סיוע חכם ברמת הכיתה' : language === 'ar' ? 'المساعدة الذكية على مستوى الصف' : 'Class smart assistance'}
                    subtitle={
                      language === 'he'
                        ? 'זו ברירת המחדל לכל תרגול מותאם ומשימה של הכיתה.'
                        : language === 'ar'
                          ? 'هذا هو الإعداد الافتراضي لكل تدريب متكيف ومهمة في الصف.'
                          : 'This is the default policy for adaptive practice and assignment work in the class.'
                    }
                    language={language}
                    policy={classAssistancePolicy}
                    onChange={setClassAssistancePolicy}
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
                  <CheckCircle2 className="h-6 w-6 text-brand-purple" />
                  <div>
                    <h2 className="text-2xl font-black">
                      {language === 'he' ? 'מצב משימה' : language === 'ar' ? 'وضع المهمة' : 'Assignment mode'}
                    </h2>
                    <p className="text-sm font-bold text-brand-dark/55">
                      {language === 'he'
                        ? 'שלח לכיתה משימה פעילה עם דדליין ברור וראה מי התחיל, מי סיים, ומי צריך דחיפה.'
                        : language === 'ar'
                          ? 'أرسل للصف مهمة نشطة مع موعد نهائي واضح وراقب من بدأ ومن أنهى ومن يحتاج دفعة.'
                          : 'Send the class a focused assignment with a deadline and track who started, finished, or needs a nudge.'}
                    </p>
                  </div>
                </div>

                {!classBoard.pack?.id ? (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5 font-bold text-brand-dark/70">
                    {language === 'he'
                      ? 'לפני יצירת משימה צריך לחבר pack לכיתה. ברגע שתשייך שאלון, תוכל להגדיר משימה פעילה לתלמידים.'
                      : language === 'ar'
                        ? 'قبل إنشاء مهمة يجب ربط حزمة بالصف. بعد اختيار الاختبار ستتمكن من إنشاء مهمة نشطة للطلاب.'
                        : 'Connect a pack to this class first. Once a quiz is linked, you can publish an active assignment for students.'}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field
                        label={language === 'he' ? 'כותרת משימה' : language === 'ar' ? 'عنوان المهمة' : 'Assignment title'}
                        value={assignmentTitle}
                        onChange={setAssignmentTitle}
                      />
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">
                          {language === 'he' ? 'דדליין' : language === 'ar' ? 'الموعد النهائي' : 'Due date'}
                        </label>
                        <input
                          type="datetime-local"
                          value={assignmentDueAt}
                          onChange={(event) => setAssignmentDueAt(event.target.value)}
                          className="w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">
                          {language === 'he' ? 'הוראות לתלמיד' : language === 'ar' ? 'تعليمات للطالب' : 'Student instructions'}
                        </label>
                        <textarea
                          value={assignmentInstructions}
                          onChange={(event) => setAssignmentInstructions(event.target.value)}
                          className="min-h-28 w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                          placeholder={
                            language === 'he'
                              ? 'לדוגמה: תענו על 8 שאלות לפני מחר ותתרכזו באותו חומר שתרגלנו בכיתה.'
                              : language === 'ar'
                                ? 'مثال: أجيبوا عن 8 أسئلة قبل الغد وركزوا على نفس المادة التي تدربنا عليها في الصف.'
                                : 'Example: answer 8 questions before tomorrow and stay focused on the material we covered in class.'
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">
                          {language === 'he' ? 'יעד שאלות' : language === 'ar' ? 'هدف الأسئلة' : 'Question goal'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={assignmentQuestionGoal}
                          onChange={(event) => setAssignmentQuestionGoal(event.target.value)}
                          className="w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                        />
                        <p className="mt-2 text-sm font-bold text-brand-dark/55">
                          {language === 'he'
                            ? `המשימה תתבסס על ${classBoard.pack.title}`
                            : language === 'ar'
                              ? `المهمة ستعتمد على ${classBoard.pack.title}`
                              : `Assignment will use ${classBoard.pack.title}`}
                        </p>
                      </div>
                    </div>

                    <AssistancePolicyEditor
                      title={language === 'he' ? 'סיוע חכם למשימה' : language === 'ar' ? 'المساعدة الذكية للمهمة' : 'Assignment smart assistance'}
                      subtitle={
                        language === 'he'
                          ? 'הגדרה ייעודית למשימה הפעילה. מה שמוגדר כאן יגבר על ברירת המחדל של הכיתה.'
                          : language === 'ar'
                            ? 'إعداد خاص للمهمة النشطة. ما يتم ضبطه هنا يتغلب على إعداد الصف الافتراضي.'
                            : 'Override for the active assignment. These settings win over the class default.'
                      }
                      language={language}
                      policy={assignmentAssistancePolicy}
                      onChange={setAssignmentAssistancePolicy}
                    />

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSaveAssignment()}
                        disabled={busyKey === 'save-assignment'}
                        className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-dark bg-brand-purple px-5 py-3 font-black text-white shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        {busyKey === 'save-assignment'
                          ? language === 'he' ? 'שומר...' : language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'
                          : activeAssignment
                            ? language === 'he' ? 'עדכן משימה' : language === 'ar' ? 'تحديث المهمة' : 'Update assignment'
                            : language === 'he' ? 'צור משימה' : language === 'ar' ? 'إنشاء مهمة' : 'Create assignment'}
                      </button>
                      {activeAssignment ? (
                        <button
                          type="button"
                          onClick={() => void handleArchiveAssignment(activeAssignment)}
                          disabled={busyKey === 'archive-assignment'}
                          className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-dark bg-white px-5 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          {language === 'he' ? 'סיים וארכב' : language === 'ar' ? 'إنهاء وأرشفة' : 'End and archive'}
                        </button>
                      ) : null}
                    </div>

                    {activeAssignment ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-4">
                          <MetricTile
                            label={language === 'he' ? 'הוקצו' : language === 'ar' ? 'تم الإسناد' : 'Assigned'}
                            value={String(activeAssignment.summary.assigned_count || 0)}
                          />
                          <MetricTile
                            label={language === 'he' ? 'התחילו' : language === 'ar' ? 'بدأوا' : 'Started'}
                            value={String(activeAssignment.summary.started_count || 0)}
                          />
                          <MetricTile
                            label={language === 'he' ? 'סיימו' : language === 'ar' ? 'أنهوا' : 'Completed'}
                            value={String(activeAssignment.summary.completed_count || 0)}
                          />
                          <MetricTile
                            label={language === 'he' ? 'איחרו' : language === 'ar' ? 'متأخرون' : 'Overdue'}
                            value={String(activeAssignment.summary.overdue_count || 0)}
                          />
                        </div>

                        <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
                                {language === 'he' ? 'משימה פעילה' : language === 'ar' ? 'مهمة نشطة' : 'Active assignment'}
                              </p>
                              <h3 className="mt-2 text-2xl font-black text-brand-dark">{activeAssignment.title}</h3>
                              <p className="mt-2 max-w-3xl font-bold text-brand-dark/65">
                                {activeAssignment.instructions || (
                                  language === 'he'
                                    ? 'אין עדיין הוראות נוספות. התלמידים פשוט יקבלו תרגול על אותו שאלון.'
                                    : language === 'ar'
                                      ? 'لا توجد تعليمات إضافية بعد. سيتلقى الطلاب تدريبًا على نفس الاختبار.'
                                      : 'No extra instructions yet. Students will simply receive practice on the same pack.'
                                )}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs font-black uppercase">
                              <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2">
                                {language === 'he' ? 'יעד' : language === 'ar' ? 'الهدف' : 'Goal'}: {activeAssignment.question_goal}
                              </span>
                              <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2">
                                {language === 'he' ? 'דדליין' : language === 'ar' ? 'الموعد' : 'Due'}: {formatDueDateTime(activeAssignment.due_at, language)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-5">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
                                {language === 'he' ? 'התקדמות תלמידים' : language === 'ar' ? 'تقدم الطلاب' : 'Student progress'}
                              </p>
                              <p className="text-sm font-bold text-brand-dark/60">
                                {language === 'he'
                                  ? 'מבט מהיר על מי כבר בתנועה, מי קרוב לסיום, ומי עוד לא התחיל.'
                                  : language === 'ar'
                                    ? 'نظرة سريعة على من بدأ ومن اقترب من النهاية ومن لم يبدأ بعد.'
                                    : 'A quick view of who started, who is close to done, and who has not moved yet.'}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            {activeAssignment.roster_progress.length > 0 ? (
                              activeAssignment.roster_progress.map((student) => (
                                <div key={`assignment-progress-${student.student_id}`} className="rounded-[1.1rem] border-2 border-brand-dark bg-brand-bg p-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-lg font-black text-brand-dark">{student.name}</p>
                                      <p className="text-sm font-bold text-brand-dark/60">
                                        {student.email || (language === 'he' ? 'ללא אימייל' : language === 'ar' ? 'بدون بريد' : 'No email')}
                                      </p>
                                    </div>
                                    <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black uppercase ${
                                      student.status === 'completed'
                                        ? 'bg-[#E8FFF4]'
                                        : student.status === 'overdue'
                                          ? 'bg-[#FFE5E5]'
                                          : student.status === 'in_progress'
                                            ? 'bg-[#FFF5CC]'
                                            : 'bg-white'
                                    }`}>
                                      {student.status.replace('_', ' ')}
                                    </span>
                                  </div>
                                  <div className="mt-4 h-4 overflow-hidden rounded-full border-2 border-brand-dark bg-white">
                                    <div
                                      className={`h-full ${
                                        student.status === 'completed'
                                          ? 'bg-brand-purple'
                                          : student.status === 'overdue'
                                            ? 'bg-brand-orange'
                                            : 'bg-brand-yellow'
                                      }`}
                                      style={{ width: `${Math.max(6, Math.min(100, Number(student.completion_pct || 0)))}%` }}
                                    />
                                  </div>
                                  <div className="mt-3 grid gap-2 text-xs font-black uppercase text-brand-dark/65 sm:grid-cols-4">
                                    <span>{language === 'he' ? 'הושלמו' : language === 'ar' ? 'أُنجز' : 'Done'}: {student.attempted_questions}/{student.question_goal}</span>
                                    <span>{language === 'he' ? 'ניסיונות' : language === 'ar' ? 'المحاولات' : 'Attempts'}: {student.attempt_count}</span>
                                    <span>{language === 'he' ? 'דיוק' : language === 'ar' ? 'الدقة' : 'Accuracy'}: {student.accuracy_pct !== null ? `${Math.round(Number(student.accuracy_pct))}%` : '--'}</span>
                                    <span>{copy.lastSeen}: {formatRelativeTime(student.last_activity_at)}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="font-bold text-brand-dark/60">
                                {language === 'he'
                                  ? 'עדיין אין נתוני התקדמות למשימה הזו.'
                                  : language === 'ar'
                                    ? 'لا توجد بيانات تقدم لهذه المهمة بعد.'
                                    : 'No progress data for this assignment yet.'}
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {archivedAssignments.length > 0 ? (
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-5">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
                          {language === 'he' ? 'משימות קודמות' : language === 'ar' ? 'مهام سابقة' : 'Past assignments'}
                        </p>
                        <div className="mt-3 space-y-3">
                          {archivedAssignments.slice(0, 3).map((assignment) => (
                            <div key={`archived-assignment-${assignment.id}`} className="rounded-[1rem] border border-brand-dark/10 bg-brand-bg px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="font-black text-brand-dark">{assignment.title}</p>
                                  <p className="text-sm font-bold text-brand-dark/60">
                                    {formatDueDateTime(assignment.due_at, language)} • {assignment.pack_title}
                                  </p>
                                </div>
                                <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black uppercase">
                                  {assignment.summary.completed_count}/{assignment.summary.assigned_count}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Users className="h-6 w-6 text-brand-orange" />
                  <div>
                    <h2 className="text-2xl font-black">{copy.roster}</h2>
                    <p className="text-sm font-bold text-brand-dark/55">{copy.rosterBody}</p>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleResendAllPendingInvites()}
                    disabled={busyKey === 'bulk-resend-invites'}
                    className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
                  >
                    {language === 'he' ? 'שלח שוב לכל הממתינים' : language === 'ar' ? 'أعد الإرسال للمعلقين' : 'Resend all pending'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportRosterCsv()}
                    className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black"
                  >
                    {language === 'he' ? 'ייצא CSV' : language === 'ar' ? 'تصدير CSV' : 'Export CSV'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectAllRosterStudents}
                    className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
                  >
                    {selectedRosterStudentIds.length === classBoard.students.length && classBoard.students.length > 0
                      ? (language === 'he' ? 'נקה בחירה' : language === 'ar' ? 'إلغاء التحديد' : 'Clear selection')
                      : (language === 'he' ? 'בחר את כולם' : language === 'ar' ? 'اختر الكل' : 'Select all')}
                  </button>
                  {selectedRosterStudentIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleBulkRemoveStudents()}
                      disabled={busyKey === 'bulk-remove-students'}
                      className="rounded-full border-2 border-brand-dark bg-rose-100 px-4 py-2 text-sm font-black disabled:opacity-60"
                    >
                      {language === 'he' ? `הסר ${selectedRosterStudentIds.length}` : language === 'ar' ? `إزالة ${selectedRosterStudentIds.length}` : `Remove ${selectedRosterStudentIds.length}`}
                    </button>
                  ) : null}
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
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedRosterStudentIds.includes(Number(student.id))}
                            onChange={() => toggleRosterStudentSelection(Number(student.id))}
                            className="mt-1 h-5 w-5 rounded border-2 border-brand-dark"
                          />
                          <div>
                          <p className="text-xl font-black">{student.name}</p>
                          {student.email ? <p className="font-bold text-brand-dark/65">{student.email}</p> : null}
                          </div>
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
                            type="button"
                            onClick={() => void handleResendInvite(student.id)}
                            disabled={busyKey === `invite-${student.id}`}
                            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
                          >
                            <Mail className="h-4 w-4" />
                            {copy.resend}
                          </button>
                        ) : null}
                        <button
                          type="button"
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

            <div className="min-w-0 space-y-6">
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
                              type="button"
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
                            type="button"
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

              <div className="overflow-hidden rounded-[2.2rem] border-2 border-brand-dark bg-white shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="border-b-2 border-brand-dark/10 bg-[linear-gradient(135deg,#F3ECFF_0%,#FFF7D1_100%)] p-6">
                  <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] 2xl:items-end">
                    <div className="min-w-0">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] border-2 border-brand-dark bg-white text-brand-purple shadow-[2px_2px_0px_0px_#1A1A1A]">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        <div className="rounded-full border border-brand-dark/15 bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/50">
                          {language === 'he' ? 'מרכז שיעורים' : language === 'ar' ? 'مركز الدروس' : 'Lesson hub'}
                        </div>
                      </div>
                      <h2 className="text-3xl font-black tracking-tight text-brand-dark">{copy.library}</h2>
                      <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-brand-dark/65">
                        {language === 'he'
                          ? 'ספרייה נקייה וברורה להפעלת שיעורים מהירים מתוך הכיתה, עם כרטיסים מאוזנים וטקסט שנשאר בשליטה.'
                          : language === 'ar'
                            ? 'مكتبة مرتبة وواضحة لتشغيل الدروس بسرعة من داخل الصف، ببطاقات متوازنة ونص يبقى تحت السيطرة.'
                            : 'A cleaner lesson library for launching class-ready quizzes quickly, with balanced cards and controlled text flow.'}
                      </p>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="rounded-[1.6rem] border-2 border-brand-dark bg-white/90 p-3 shadow-[2px_2px_0px_0px_#1A1A1A]">
                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.14em] text-brand-dark/45">
                          {copy.selectPack}
                        </label>
                        <select
                          value={selectedPackId}
                          onChange={(e) => setSelectedPackId(e.target.value)}
                          className="w-full min-w-0 rounded-[1rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 font-black outline-none"
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
                      </div>

                      <button
                        onClick={() => void handleAddPack()}
                        disabled={!selectedPackId || busyKey === 'add-pack'}
                        className="inline-flex min-h-[58px] items-center justify-center rounded-[1.3rem] border-2 border-brand-dark bg-brand-yellow px-5 py-3 text-sm font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-50 lg:min-h-[78px] lg:rounded-[1.6rem]"
                      >
                        {copy.addQuiz}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6">
                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <div className="rounded-full border border-brand-dark/15 bg-brand-bg px-4 py-2 text-sm font-black text-brand-dark/65">
                    {language === 'he' ? `${(classBoard.packs || []).length} שיעורים מחוברים` : language === 'ar' ? `${(classBoard.packs || []).length} دروس مرتبطة` : `${(classBoard.packs || []).length} linked lessons`}
                  </div>
                  <div className="rounded-full border border-brand-dark/15 bg-white px-4 py-2 text-sm font-bold text-brand-dark/50">
                    {language === 'he'
                      ? 'כל כרטיס מוכן להפעלה ישירה מתוך הכיתה'
                      : language === 'ar'
                        ? 'كل بطاقة جاهزة للتشغيل المباشر من الصف'
                        : 'Each card is ready for direct launch from class'}
                  </div>
                </div>

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                  {(classBoard.packs || []).length > 0 ? (
                    (classBoard.packs || []).map((pack) => (
                      <div
                        key={`pack-${pack.id}`}
                        className="group flex min-h-[228px] min-w-0 flex-col justify-between rounded-[1.85rem] border-2 border-brand-dark bg-[linear-gradient(180deg,#FFFFFF_0%,#FAF7FF_62%,#FFF6D8_100%)] p-4 shadow-[3px_3px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-1 sm:p-5"
                      >
                        <div className="min-w-0">
                          <div className="mb-4 flex items-start justify-between gap-2">
                            <div className="min-w-0 rounded-full border border-brand-dark/10 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-brand-dark/45 sm:text-[11px]">
                              {language === 'he' ? 'שיעור פעיל' : language === 'ar' ? 'درس نشط' : 'Ready lesson'}
                            </div>
                            <div className="flex h-9 min-w-[56px] shrink-0 items-center justify-center rounded-[0.9rem] border-2 border-brand-dark bg-white px-2 text-xs font-black text-brand-dark/65 shadow-[2px_2px_0px_0px_#1A1A1A] sm:h-10 sm:min-w-[64px] sm:text-sm">
                              {pack.question_count}
                            </div>
                          </div>

                          <h3 className="line-clamp-3 min-h-[4.2rem] break-words text-[1.05rem] font-black leading-[1.16] text-brand-dark sm:min-h-[4.7rem] sm:text-[1.22rem] lg:text-[1.28rem]">
                            {pack.title || copy.unnamedQuiz}
                          </h3>
                          <p className="mt-3 text-[13px] font-bold leading-5 text-brand-dark/55 sm:text-sm sm:leading-6">
                            {language === 'he'
                              ? `${pack.question_count} שאלות מוכנות להפעלה מיידית מתוך דף הכיתה.`
                              : language === 'ar'
                                ? `${pack.question_count} أسئلة جاهزة للتشغيل الفوري من صفحة الصف.`
                                : `${pack.question_count} questions ready for immediate launch from the class page.`}
                          </p>
                        </div>

                        <div className="mt-5 border-t-2 border-brand-dark/5 pt-4">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <button
                              onClick={() => void handleHost(pack.id)}
                              className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[1.15rem] border-2 border-brand-dark bg-brand-orange px-3 py-3 text-[13px] font-black text-white shadow-[2px_2px_0px_0px_#1A1A1A] sm:rounded-[1.3rem] sm:px-4 sm:text-sm"
                            >
                              <PlayCircle className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 truncate text-center">{copy.hostSpecific}</span>
                            </button>
                            <button
                              onClick={() => void handleUnlinkPack(pack.id, pack.title)}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-white shadow-[2px_2px_0px_0px_#1A1A1A] sm:h-11 sm:w-11"
                              title={copy.removeQuiz}
                            >
                              <Trash2 className="h-4 w-4 text-rose-500" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full rounded-[1.8rem] border-2 border-dashed border-brand-dark/20 bg-brand-bg/60 px-6 py-14 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border-2 border-brand-dark/10 bg-white text-brand-purple">
                        <BookOpen className="h-6 w-6" />
                      </div>
                      <p className="mt-4 text-lg font-black text-brand-dark">{copy.noPacksInLibrary}</p>
                      <p className="mt-2 text-sm font-bold text-brand-dark/45">
                        {language === 'he'
                          ? 'בחר שאלון מהקולקציה למעלה כדי להתחיל לבנות ספריית שיעורים לכיתה הזו.'
                          : language === 'ar'
                            ? 'اختر اختبارًا من المجموعة أعلاه لبدء بناء مكتبة الدروس لهذا الصف.'
                            : 'Choose a quiz from the selector above to start building this class library.'}
                      </p>
                    </div>
                  )}
                </div>
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <div className="mb-5 flex items-center gap-3">
                  <Sparkles className="h-6 w-6 text-brand-orange" />
                  <h2 className="text-2xl font-black">{copy.retention}</h2>
                </div>
                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="text-xl font-black">{translatedRetentionHeadline}</p>
                  <p className="mt-2 font-bold text-brand-dark/65">{translatedRetentionBody}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-black uppercase">
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.active_last_7d} {copy.retentionActive7d}</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.slipping} {copy.retentionSlipping}</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.inactive_14d} {copy.retentionInactive}</span>
                    <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">{classRetention.never_started} {copy.retentionNotStarted}</span>
                  </div>
                  {translatedRetentionWatchlist.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {translatedRetentionWatchlist.map((student) => (
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
                <p className="whitespace-pre-wrap font-bold text-brand-dark/70">{classBoard.notes || copy.noNotes}</p>
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
    <div className="flex min-h-[122px] flex-col justify-between rounded-[2rem] border-2 border-brand-dark bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A]">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{label}</p>
      <div className="mt-3">
        <p className="text-2xl font-black leading-tight text-brand-dark">{value}</p>
        {meta ? <p className="mt-2 text-sm font-bold leading-6 text-brand-dark/60">{meta}</p> : null}
      </div>
    </div>
  );
}

function ProgressInsightCard({
  title,
  value,
  meta,
  tone,
}: {
  title: string;
  value: string;
  meta: string;
  tone: 'yellow' | 'mint' | 'rose';
}) {
  const toneClass =
    tone === 'mint'
      ? 'bg-[#E8FFF4]'
      : tone === 'rose'
        ? 'bg-[#FFE5E5]'
        : 'bg-[#FFF5CC]';

  return (
    <div className={`rounded-[1.6rem] border-2 border-brand-dark p-4 shadow-[3px_3px_0px_0px_#1A1A1A] ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">{title}</p>
      <p className="mt-3 text-2xl font-black text-brand-dark">{value}</p>
      <p className="mt-2 text-sm font-bold text-brand-dark/60">{meta}</p>
    </div>
  );
}

function TrendDeltaPill({ delta }: { delta: number | null | undefined }) {
  const tone =
    delta === null || delta === undefined || !Number.isFinite(delta)
      ? 'bg-white'
      : delta > 0
        ? 'bg-[#E8FFF4]'
        : delta < 0
          ? 'bg-[#FFE5E5]'
          : 'bg-[#FFF5CC]';

  return (
    <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black uppercase ${tone}`}>
      {formatSignedDelta(delta)}
    </span>
  );
}

function TimelineProgressChart({
  rows,
  primaryLabel,
  secondaryLabel,
  secondaryKey,
  compareRows,
  compareLabel,
}: {
  rows: Array<{
    session_id: number;
    label: string;
    accuracy_pct: number | null;
    participant_count?: number;
    answer_count?: number;
    started_at?: string | null;
    ended_at?: string | null;
    pack_title?: string;
  }>;
  primaryLabel: string;
  secondaryLabel: string;
  secondaryKey: 'participant_count' | 'answer_count';
  compareRows?: Array<{
    session_id: number;
    label: string;
    accuracy_pct: number | null;
  }>;
  compareLabel?: string;
}) {
  if (!rows.length) {
    return null;
  }

  const width = Math.max(840, 120 + (rows.length - 1) * 72);
  const height = 250;
  const padding = 32;
  const graphHeight = height - padding * 2 - 20;
  const step = rows.length === 1 ? 0 : (width - padding * 2) / (rows.length - 1);
  const secondaryMax = Math.max(...rows.map((row) => Number(row[secondaryKey] || 0)), 1);
  const labelEvery = rows.length > 12 ? Math.ceil(rows.length / 12) : 1;

  const buildPoints = (dataset: Array<{ accuracy_pct: number | null | undefined }>) => dataset
    .flatMap((row, index) => {
      const accuracy = row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct);
      if (accuracy === null || !Number.isFinite(accuracy)) return [];
      const x = padding + step * index;
      const y = padding + ((100 - Math.max(0, Math.min(100, accuracy))) / 100) * graphHeight;
      return `${x},${y}`;
    })
    .join(' ');

  const accuracyPoints = buildPoints(rows);
  const comparePoints = compareRows?.length ? buildPoints(compareRows) : '';

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <LegendPill label={primaryLabel} tone="purple" />
        <LegendPill label={secondaryLabel} tone="orange" />
        {compareRows?.length && compareLabel ? <LegendPill label={compareLabel} tone="dark" /> : null}
      </div>
      <div className="chart-scroll-shell">
        <svg dir="ltr" viewBox={`0 0 ${width} ${height}`} className="h-[200px] min-w-[360px] w-full sm:h-[230px]">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padding + ((100 - tick) / 100) * graphHeight;
            return (
              <g key={`progress-tick-${tick}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.12" strokeWidth="1" />
                <text x={6} y={y + 4} fontSize="11" fontWeight="800" fill="#1A1A1A">
                  {tick}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = padding + step * index;
            const secondaryValue = Number(row[secondaryKey] || 0);
            const barHeight = (secondaryValue / secondaryMax) * (graphHeight * 0.48);
            const y = height - padding - barHeight;
            return (
              <g key={`progress-bar-${row.session_id || index}`}>
                <rect
                  x={x - 12}
                  y={y}
                  width="24"
                  height={Math.max(10, barHeight)}
                  rx="10"
                  fill="#FF5A36"
                  fillOpacity="0.78"
                  stroke="#1A1A1A"
                  strokeWidth="2"
                />
                <title>{`${row.pack_title || row.label} • ${row.label} • ${secondaryLabel}: ${secondaryValue} • ${primaryLabel}: ${row.accuracy_pct !== null ? `${Math.round(Number(row.accuracy_pct))}%` : '--'}`}</title>
                {index % labelEvery === 0 || index === rows.length - 1 ? (
                  <text x={x} y={height - 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">
                    {row.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          <polyline fill="none" stroke="#8B5CF6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={accuracyPoints} />
          {comparePoints ? (
            <polyline
              fill="none"
              stroke="#1A1A1A"
              strokeOpacity="0.55"
              strokeWidth="3"
              strokeDasharray="8 6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={comparePoints}
            />
          ) : null}

          {rows.map((row, index) => {
            const accuracy = row.accuracy_pct === null || row.accuracy_pct === undefined ? null : Number(row.accuracy_pct);
            if (accuracy === null || !Number.isFinite(accuracy)) return null;
            const x = padding + step * index;
            const y = padding + ((100 - Math.max(0, Math.min(100, accuracy))) / 100) * graphHeight;
            return (
              <circle
                key={`progress-dot-${row.session_id || index}`}
                cx={x}
                cy={y}
                r="4.5"
                fill="#8B5CF6"
                stroke="#1A1A1A"
                strokeWidth="2"
              >
                <title>{`${row.pack_title || row.label} • ${primaryLabel}: ${row.accuracy_pct !== null ? `${Math.round(Number(row.accuracy_pct))}%` : '--'}`}</title>
              </circle>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function TopicComparisonRow({
  tag,
  answersLabel,
  classLabel,
  selectedLabel,
  compareLabel,
  classAccuracy,
  classAnswers,
  selectedAccuracy,
  selectedAnswers,
  compareAccuracy,
  compareAnswers,
  showCompare,
}: {
  tag: string;
  answersLabel: string;
  classLabel: string;
  selectedLabel: string;
  compareLabel: string;
  classAccuracy: number | null;
  classAnswers: number;
  selectedAccuracy: number | null;
  selectedAnswers: number;
  compareAccuracy: number | null;
  compareAnswers: number;
  showCompare: boolean;
}) {
  const rows = [
    { label: classLabel, accuracy: classAccuracy, answers: classAnswers, tone: 'bg-[#EAEAEA]' },
    { label: selectedLabel, accuracy: selectedAccuracy, answers: selectedAnswers, tone: 'bg-[#F3ECFF]' },
    ...(showCompare ? [{ label: compareLabel, accuracy: compareAccuracy, answers: compareAnswers, tone: 'bg-[#FFE5DE]' }] : []),
  ];

  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-black">{tag}</p>
        <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-[11px] font-black uppercase">
          {classAnswers} {answersLabel}
        </span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const width = row.accuracy === null || row.accuracy === undefined ? 0 : Math.max(4, Math.min(100, Number(row.accuracy)));
          return (
            <div key={`${tag}-${row.label}`}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs font-black uppercase text-brand-dark/60">
                <span>{row.label}</span>
                <span>{row.accuracy !== null && row.accuracy !== undefined ? `${Math.round(Number(row.accuracy))}%` : '--'} • {row.answers}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full border-2 border-brand-dark bg-white">
                <div className={`h-full ${row.tone}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegendPill({ label, tone }: { label: string; tone: 'purple' | 'orange' | 'dark' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-3 py-2 text-xs font-black uppercase tracking-[0.16em] ${
        tone === 'purple'
          ? 'bg-[#F3ECFF] text-brand-dark'
          : tone === 'orange'
            ? 'bg-[#FFE5DE] text-brand-dark'
            : 'bg-[#EAEAEA] text-brand-dark'
      }`}
    >
      <span
        className={`h-3 w-3 rounded-full border border-brand-dark ${
          tone === 'purple' ? 'bg-[#8B5CF6]' : tone === 'orange' ? 'bg-[#FF5A36]' : 'bg-[#1A1A1A]'
        }`}
      />
      {label}
    </span>
  );
}
