import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Check,
  ClipboardList,
  Clock3,
  GraduationCap,
  Layers3,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AppLoadingScreen from '../components/AppLoadingScreen.tsx';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import UiverseSearchField from '../components/UiverseSearchField.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import {
  clearStoredTeacherClasses,
  loadStoredTeacherClassesSnapshot,
  type TeacherClass as LegacyTeacherClass,
} from '../lib/localData.ts';
import { apiFetchJson } from '../lib/api.ts';
import {
  createClassSession,
  createTeacherClass,
  deleteTeacherClass,
  listTeacherClasses,
  TEACHER_CLASS_COLOR_OPTIONS,
  type TeacherClassCard,
  type TeacherClassColor,
  type TeacherClassPayload,
} from '../lib/teacherClasses.ts';

type FeedbackState = {
  tone: 'success' | 'error';
  message: string;
} | null;

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

function sortClassesByRecent(classes: TeacherClassCard[]) {
  return [...classes].sort((left, right) => {
    const leftDate = new Date(left.updated_at || left.created_at || 0).getTime() || 0;
    const rightDate = new Date(right.updated_at || right.created_at || 0).getTime() || 0;
    return rightDate - leftDate || right.id - left.id;
  });
}


function importLegacyColor(value: string): TeacherClassColor {
  if (TEACHER_CLASS_COLOR_OPTIONS.includes(value as TeacherClassColor)) {
    return value as TeacherClassColor;
  }
  return 'bg-brand-purple';
}

function toClassCardPayload(payload: TeacherClassCard | any): TeacherClassCard {
  return payload as TeacherClassCard;
}

export default function TeacherClasses() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<TeacherClassCard[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const classNameInputRef = useRef<HTMLInputElement | null>(null);

  const copy = {
    he: {
      title: 'כיתות',
      subtitle: 'העמוד הזה הוא עכשיו overview בלבד: חיפוש, מצב כיתה, וגישה מהירה לדף הכיתה המלא שבו מנהלים תלמידים, הזמנות, חבילות, סשנים וסטטיסטיקות.',
      refresh: 'רענון',
      newClass: 'כיתה חדשה',
      quickCreate: 'יצירה מהירה',
      quickCreateBody: 'צור/י כיתה חדשה במהירות. כל הניהול המלא יתבצע מדף הכיתה עצמו אחרי השמירה.',
      quickCreateLaunch: 'פתח יצירה מהירה',
      createModalTitle: 'יצירה מהירה לכיתה חדשה',
      createModalBody: 'שלושה צעדים קצרים, ואז הכיתה מוכנה לניהול מלא עם רוסטר, חבילות וסשנים.',
      stepIdentity: 'זהות הכיתה',
      stepSetup: 'התאמה מהירה',
      stepReview: 'סיכום ושמירה',
      stepIdentityBody: 'נגדיר את הפרטים הבסיסיים כדי ש־Quizzi ידע לארגן את הכיתה בצורה נכונה.',
      stepSetupBody: 'נבחר vibe, צבע וחבילה התחלתית אם כבר יש אחת מוכנה.',
      stepReviewBody: 'מוסיפים הקשר אחרון, רואים preview, ושומרים את סביבת העבודה החדשה.',
      continue: 'המשך',
      back: 'חזרה',
      close: 'סגירה',
      saveAndOpen: 'שמור ופתח את הכיתה',
      classNamePlaceholder: 'למשל: ח׳2 מדעים',
      subjectPlaceholder: 'למשל: מדעים',
      gradePlaceholder: 'למשל: ח׳',
      optional: 'אופציונלי',
      previewTitle: 'תצוגה מקדימה חיה',
      notesHelper: 'אפשר להשאיר הערה קצרה על הקצב, רמת הכיתה או מטרת העבודה.',
      pickAColor: 'בחר/י צבע שמסמן את האופי של הכיתה',
      pickStarterPack: 'אפשר לחבר חבילה כבר עכשיו, או להשאיר ריק ולהוסיף אחר כך.',
      classReady: 'הכיתה הזו כמעט מוכנה ליציאה לדרך.',
      searchPlaceholder: 'חפש כיתה, מקצוע, שכבה או חבילה...',
      loading: 'טוען כיתות...',
      loadFailedTitle: 'הכיתות לא נטענו כראוי.',
      retry: 'נסה שוב',
      emptyTitle: 'עדיין אין כיתות פעילות.',
      emptyBody: 'צור/י כיתה חדשה כדי להתחיל לנהל רוסטר, הזמנות, חבילות וסשנים מכיתות מסונכרנות.',
      createFirst: 'צור את הכיתה הראשונה',
      className: 'שם הכיתה',
      subject: 'מקצוע',
      grade: 'שכבה',
      assignedPack: 'חבילה משויכת',
      noPack: 'ללא חבילה כרגע',
      color: 'צבע',
      notes: 'הערות',
      notesPlaceholder: 'הקשר כיתתי, קצב, או כל דבר שצריך לזכור על הקבוצה הזאת...',
      save: 'צור כיתה',
      saving: 'יוצר...',
      reset: 'איפוס',
      activeClasses: 'כיתות פעילות',
      students: 'תלמידים ברוסטר',
      pending: 'ממתינים לאישור',
      liveRooms: 'חדרים חיים',
      assignedPacks: 'כיתות עם חבילה',
      manage: 'ניהול',
      latestReport: 'הדוח האחרון',
      host: 'פתח כיתה חיה',
      openClassPage: 'פתח דף כיתה',
      rematch: 'בנה חבילת תיקון',
      rosterLabel: 'רשימת תלמידים',
      accuracy: 'דיוק',
      sessions: 'סשנים',
      attention: 'דורשים תשומת לב',
      assignedPackLabel: 'חבילה משויכת',
      sessionState: 'מצב סשן',
      approved: 'אישרו',
      noEmail: 'ללא מייל',
      lastRun: 'ריצה אחרונה',
      noLiveRun: 'עדיין אין ריצה חיה',
      liveRoomOpen: 'מצב סשן: פתוח',
      noClassesFound: 'לא נמצאו כיתות שתואמות לחיפוש.',
      imported: 'הכיתות המקומיות הקודמות הועברו לסביבת הכיתות החדשה.',
      created: 'הכיתה נוצרה ונפתחה לניהול מפורט.',
      deleted: 'הכיתה הוסרה מלוח הכיתות.',
      assignPackFirst: 'צריך לשייך חבילה לכיתה לפני פתיחת סשן חי.',
      noReportYet: 'עדיין אין דוח לכיתה הזאת. צריך קודם סשן שהסתיים.',
      noSessionYet: 'אין עדיין סשן כיתתי שאפשר לבנות ממנו חבילת תיקון.',
      fillRequired: 'מלא/י שם כיתה, מקצוע ושכבה לפני שמירה.',
      allSubjects: 'כל המקצועות',
    },
    ar: {
      title: 'الصفوف',
      subtitle: 'هذه الصفحة أصبحت نظرة عامة فقط: بحث، حالة الصف، ووصول سريع إلى صفحة الصف الكاملة حيث تتم إدارة الطلاب والدعوات والحزم والجلسات والإحصاءات.',
      refresh: 'تحديث',
      newClass: 'صف جديد',
      quickCreate: 'إنشاء سريع',
      quickCreateBody: 'أنشئ صفًا جديدًا بسرعة. ستتم الإدارة الكاملة من صفحة الصف نفسها بعد الحفظ.',
      quickCreateLaunch: 'افتح الإنشاء السريع',
      createModalTitle: 'إنشاء سريع لصف جديد',
      createModalBody: 'ثلاث خطوات قصيرة ثم تصبح مساحة الصف جاهزة للإدارة الكاملة.',
      stepIdentity: 'هوية الصف',
      stepSetup: 'إعداد سريع',
      stepReview: 'مراجعة وحفظ',
      stepIdentityBody: 'لنحدد التفاصيل الأساسية حتى ينظم Quizzi الصف بشكل صحيح.',
      stepSetupBody: 'اختر الطابع واللون والحزمة الأولى إذا كانت جاهزة.',
      stepReviewBody: 'أضف ملاحظة أخيرة، راجع المعاينة، ثم احفظ مساحة الصف الجديدة.',
      continue: 'متابعة',
      back: 'رجوع',
      close: 'إغلاق',
      saveAndOpen: 'احفظ وافتح الصف',
      classNamePlaceholder: 'مثال: علوم 8-2',
      subjectPlaceholder: 'مثال: علوم',
      gradePlaceholder: 'مثال: الصف الثامن',
      optional: 'اختياري',
      previewTitle: 'معاينة مباشرة',
      notesHelper: 'يمكنك إضافة ملاحظة قصيرة عن الإيقاع أو مستوى الصف أو هدف العمل.',
      pickAColor: 'اختر لونًا يعبّر عن طابع الصف',
      pickStarterPack: 'يمكن ربط حزمة من الآن أو تركها فارغة وإضافتها لاحقًا.',
      classReady: 'هذا الصف أصبح قريبًا جدًا من الجاهزية.',
      searchPlaceholder: 'ابحث عن صف أو مادة أو مستوى أو حزمة...',
      loading: 'جارٍ تحميل الصفوف...',
      loadFailedTitle: 'لم يتم تحميل الصفوف بشكل سليم.',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد صفوف نشطة بعد.',
      emptyBody: 'أنشئ صفًا جديدًا لبدء إدارة القوائم والدعوات والحزم والجلسات من صفوف متزامنة.',
      createFirst: 'أنشئ أول صف',
      className: 'اسم الصف',
      subject: 'المادة',
      grade: 'المستوى',
      assignedPack: 'الحزمة المرتبطة',
      noPack: 'بدون حزمة الآن',
      color: 'اللون',
      notes: 'ملاحظات',
      notesPlaceholder: 'سياق الصف أو الإيقاع أو أي شيء يجب تذكره عن هذه المجموعة...',
      save: 'أنشئ الصف',
      saving: 'جارٍ الإنشاء...',
      reset: 'إعادة ضبط',
      activeClasses: 'الصفوف النشطة',
      students: 'الطلاب في القائمة',
      pending: 'بانتظار الموافقة',
      liveRooms: 'الغرف الحية',
      assignedPacks: 'صفوف مع حزمة',
      manage: 'إدارة',
      latestReport: 'آخر تقرير',
      host: 'افتح صفًا حيًا',
      openClassPage: 'افتح صفحة الصف',
      rematch: 'أنشئ حزمة علاج',
      rosterLabel: 'قائمة الطلاب',
      accuracy: 'الدقة',
      sessions: 'الجلسات',
      attention: 'بحاجة لانتباه',
      assignedPackLabel: 'الحزمة المرتبطة',
      sessionState: 'حالة الجلسة',
      approved: 'تمت الموافقة',
      noEmail: 'بدون بريد',
      lastRun: 'آخر تشغيل',
      noLiveRun: 'لا توجد جولة حية بعد',
      liveRoomOpen: 'حالة الجلسة: مفتوحة',
      noClassesFound: 'لم يتم العثور على صفوف تطابق البحث.',
      imported: 'تم نقل الصفوف المحلية السابقة إلى مساحة الصفوف الجديدة.',
      created: 'تم إنشاء الصف وفتحه للإدارة التفصيلية.',
      deleted: 'تمت إزالة الصف من اللوحة.',
      assignPackFirst: 'يجب ربط حزمة بالصف قبل فتح جلسة حية.',
      noReportYet: 'لا يوجد تقرير لهذا الصف بعد. تحتاج أولًا إلى جلسة منتهية.',
      noSessionYet: 'لا توجد جلسة صفية بعد لبناء حزمة علاج منها.',
      fillRequired: 'املأ اسم الصف والمادة والمستوى قبل الحفظ.',
      allSubjects: 'كل المواد',
    },
    en: {
      title: 'Classes',
      subtitle: 'This page is now overview-only: search, class state, and fast access to the full class page where students, invites, packs, sessions, and analytics are managed.',
      refresh: 'Refresh',
      newClass: 'New Class',
      quickCreate: 'Quick Create',
      quickCreateBody: 'Create a class quickly here. Full management now happens from the class page itself after save.',
      quickCreateLaunch: 'Open Quick Create',
      createModalTitle: 'Quick Create a New Class',
      createModalBody: 'Three short stops, then the class is ready for full management with roster, packs, and sessions.',
      stepIdentity: 'Class Identity',
      stepSetup: 'Quick Setup',
      stepReview: 'Review & Save',
      stepIdentityBody: 'Set the core details so Quizzi can organize the class properly from day one.',
      stepSetupBody: 'Choose the class vibe, its color, and an optional starter pack.',
      stepReviewBody: 'Add final context, review the live preview, and save the new workspace.',
      continue: 'Continue',
      back: 'Back',
      close: 'Close',
      saveAndOpen: 'Save & Open Class',
      classNamePlaceholder: 'For example: Grade 8 Science A',
      subjectPlaceholder: 'For example: Science',
      gradePlaceholder: 'For example: Grade 8',
      optional: 'Optional',
      previewTitle: 'Live Preview',
      notesHelper: 'Add a short note about pacing, level, or how you plan to use this class.',
      pickAColor: 'Pick a color that matches the class vibe',
      pickStarterPack: 'Attach a pack now, or leave it empty and decide later from the class page.',
      classReady: 'This class is almost ready to launch.',
      searchPlaceholder: 'Search classes, subjects, grades, or packs...',
      loading: 'Loading classes...',
      loadFailedTitle: 'Classes did not load cleanly.',
      retry: 'Try again',
      emptyTitle: 'There are no active classes yet.',
      emptyBody: 'Create a class to start managing rosters, invites, packs, sessions, and synced teacher-student history.',
      createFirst: 'Create the first class',
      className: 'Class Name',
      subject: 'Subject',
      grade: 'Grade',
      assignedPack: 'Assigned Pack',
      noPack: 'No pack right now',
      color: 'Color',
      notes: 'Notes',
      notesPlaceholder: 'Class context, pacing, or anything your future self should remember about this group...',
      save: 'Create Class',
      saving: 'Creating...',
      reset: 'Reset',
      activeClasses: 'Active classes',
      students: 'Rostered students',
      pending: 'Pending approvals',
      liveRooms: 'Open live rooms',
      assignedPacks: 'Classes with pack',
      manage: 'Manage',
      latestReport: 'Latest Report',
      host: 'Open Live Class',
      openClassPage: 'Open Class Page',
      rematch: 'Build Rematch Pack',
      rosterLabel: 'Student roster',
      accuracy: 'Accuracy',
      sessions: 'Sessions',
      attention: 'Need attention',
      assignedPackLabel: 'Assigned pack',
      sessionState: 'Session state',
      approved: 'Approved',
      noEmail: 'No email',
      lastRun: 'Last run',
      noLiveRun: 'No live run yet',
      liveRoomOpen: 'Session state: open',
      noClassesFound: 'No classes matched this search.',
      imported: 'Your previous local classes were imported into the live class workspace.',
      created: 'The class was created and opened for full management.',
      deleted: 'The class was removed from the class board.',
      assignPackFirst: 'Assign a pack before opening a live class.',
      noReportYet: 'This class does not have a report yet. Run a class session first.',
      noSessionYet: 'There is no completed class session to build a rematch from yet.',
      fillRequired: 'Fill class name, subject, and grade before saving.',
      allSubjects: 'All subjects',
    },
  }[language] || {
    title: 'Classes',
    subtitle: 'Overview-only class board.',
    refresh: 'Refresh',
    newClass: 'New Class',
    quickCreate: 'Quick Create',
    quickCreateBody: '',
    quickCreateLaunch: 'Open Quick Create',
    createModalTitle: 'Quick Create a New Class',
    createModalBody: '',
    stepIdentity: 'Class Identity',
    stepSetup: 'Quick Setup',
    stepReview: 'Review & Save',
    stepIdentityBody: '',
    stepSetupBody: '',
    stepReviewBody: '',
    continue: 'Continue',
    back: 'Back',
    close: 'Close',
    saveAndOpen: 'Save & Open Class',
    classNamePlaceholder: 'Class name',
    subjectPlaceholder: 'Subject',
    gradePlaceholder: 'Grade',
    optional: 'Optional',
    previewTitle: 'Live Preview',
    notesHelper: '',
    pickAColor: '',
    pickStarterPack: '',
    classReady: '',
    searchPlaceholder: 'Search classes...',
    loading: 'Loading classes...',
    loadFailedTitle: 'Classes did not load cleanly.',
    retry: 'Retry',
    emptyTitle: 'No classes yet.',
    emptyBody: 'Create a class to begin.',
    createFirst: 'Create class',
    className: 'Class Name',
    subject: 'Subject',
    grade: 'Grade',
    assignedPack: 'Assigned Pack',
    noPack: 'No pack',
    color: 'Color',
    notes: 'Notes',
    notesPlaceholder: '',
    save: 'Create Class',
    saving: 'Creating...',
    reset: 'Reset',
    activeClasses: 'Active classes',
    students: 'Students',
    pending: 'Pending approvals',
    liveRooms: 'Open live rooms',
    assignedPacks: 'Classes with pack',
    manage: 'Manage',
    latestReport: 'Latest Report',
    host: 'Open Live Class',
    openClassPage: 'Open Class Page',
    rematch: 'Build Rematch Pack',
    rosterLabel: 'Student roster',
    accuracy: 'Accuracy',
    sessions: 'Sessions',
    attention: 'Need attention',
    assignedPackLabel: 'Assigned pack',
    sessionState: 'Session state',
    approved: 'Approved',
    noEmail: 'No email',
    lastRun: 'Last run',
    noLiveRun: 'No live run yet',
    liveRoomOpen: 'Session state: open',
    noClassesFound: 'No classes found.',
    imported: 'Imported previous classes.',
    created: 'Class created.',
    deleted: 'Class deleted.',
    assignPackFirst: 'Assign a pack first.',
    noReportYet: 'No report yet.',
    noSessionYet: 'No completed session yet.',
    fillRequired: 'Fill required fields.',
    allSubjects: 'All subjects',
  };

  useEffect(() => {
    void bootstrapPage();
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!createOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen || createStep !== 0) return;

    const timeout = window.setTimeout(() => classNameInputRef.current?.focus(), 160);
    return () => window.clearTimeout(timeout);
  }, [createOpen, createStep]);

  const bootstrapPage = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const [packBoardResult, classBoardResult] = await Promise.allSettled([
        apiFetchJson('/api/teacher/packs'),
        listTeacherClasses(),
      ]);

      const nextPacks =
        packBoardResult.status === 'fulfilled' && Array.isArray(packBoardResult.value)
          ? packBoardResult.value
          : [];
      let nextClasses =
        classBoardResult.status === 'fulfilled' && Array.isArray(classBoardResult.value)
          ? classBoardResult.value.map(toClassCardPayload)
          : [];
      const classBoardError =
        classBoardResult.status === 'rejected'
          ? classBoardResult.reason?.message || 'Failed to load classes.'
          : '';
      const migrated = nextClasses.length === 0 ? await maybeMigrateLegacyClasses(nextPacks) : false;
      if (migrated) {
        nextClasses = (await listTeacherClasses()).map(toClassCardPayload);
        setFeedback({ tone: 'success', message: copy.imported });
      }

      setPacks(nextPacks);
      setClasses(sortClassesByRecent(nextClasses));
      setLoadError(classBoardError);
      if (classBoardError) {
        setFeedback({ tone: 'error', message: classBoardError });
      }
    } catch (error: any) {
      setLoadError(error?.message || 'Failed to load classes.');
      setFeedback({ tone: 'error', message: error?.message || 'Failed to load classes.' });
    } finally {
      setLoading(false);
    }
  };

  const maybeMigrateLegacyClasses = async (availablePacks: any[]) => {
    const legacyClasses = loadStoredTeacherClassesSnapshot();
    if (!legacyClasses?.length) return false;

    const packIds = new Set(availablePacks.map((pack) => Number(pack.id || 0)).filter((id) => id > 0));
    for (const legacyClass of legacyClasses) {
      await importLegacyClass(legacyClass, packIds);
    }
    clearStoredTeacherClasses();
    return true;
  };

  const importLegacyClass = async (legacyClass: LegacyTeacherClass, validPackIds: Set<number>) => {
    const packId = Number(legacyClass.packId || 0);
    await createTeacherClass({
      name: legacyClass.name || 'Imported Class',
      subject: legacyClass.subject || 'General',
      grade: legacyClass.grade || 'Mixed',
      color: importLegacyColor(legacyClass.color),
      notes: legacyClass.notes || '',
      pack_id: packId && validPackIds.has(packId) ? packId : null,
      students: Array.isArray(legacyClass.students)
        ? legacyClass.students
            .map((student) => ({ name: String(student?.name || '').trim(), email: '' }))
            .filter((student) => student.name)
        : [],
    });
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCreateOpen(false);
    setCreateStep(0);
  };

  const openCreatePanel = () => {
    setCreateOpen(true);
    setCreateStep(0);
  };

  const closeCreatePanel = () => {
    setCreateOpen(false);
  };

  const subjects = useMemo(
    () => [{ value: '', label: copy.allSubjects }, ...Array.from(new Set(classes.map((classItem) => classItem.subject))).filter(Boolean).map((subject) => ({ value: subject, label: subject }))],
    [classes, copy.allSubjects],
  );

  const filteredClasses = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return classes.filter((classItem) => {
      const searchFields = [
        classItem.name,
        classItem.subject,
        classItem.grade,
        classItem.notes,
        classItem.pack?.title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !normalizedQuery || searchFields.includes(normalizedQuery);
      const matchesSubject = !subjectFilter || classItem.subject === subjectFilter;
      return matchesSearch && matchesSubject;
    });
  }, [classes, searchQuery, subjectFilter]);

  const selectedPack = useMemo(
    () => packs.find((pack) => String(pack.id) === form.packId) || null,
    [packs, form.packId],
  );

  const quickCreateSteps = useMemo(
    () => [
      {
        id: 'identity',
        label: copy.stepIdentity,
        body: copy.stepIdentityBody,
        icon: <GraduationCap className="h-5 w-5" />,
      },
      {
        id: 'setup',
        label: copy.stepSetup,
        body: copy.stepSetupBody,
        icon: <Sparkles className="h-5 w-5" />,
      },
      {
        id: 'review',
        label: copy.stepReview,
        body: copy.stepReviewBody,
        icon: <CheckCircle2 className="h-5 w-5" />,
      },
    ],
    [copy.stepIdentity, copy.stepIdentityBody, copy.stepReview, copy.stepReviewBody, copy.stepSetup, copy.stepSetupBody],
  );

  const summaryStats = useMemo(() => {
    const totalStudents = classes.reduce((sum, classItem) => sum + Number(classItem.student_count || 0), 0);
    const pendingApprovals = classes.reduce((sum, classItem) => sum + Number(classItem.pending_approval_count || 0), 0);
    const liveRooms = classes.reduce((sum, classItem) => sum + Number(classItem.stats.active_session_count || 0), 0);
    const assignedPacks = classes.filter((classItem) => Boolean(classItem.pack?.id)).length;

    return [
      {
        id: 'classes',
        label: copy.activeClasses,
        value: classes.length,
        body:
          language === 'he'
            ? 'כיתות מסונכרנות שיכולות להחזיק רוסטר, חבילה, סשנים והיסטוריה לאורך זמן.'
            : language === 'ar'
              ? 'صفوف متزامنة يمكنها الاحتفاظ بالقائمة والحزمة والجلسات والتاريخ على المدى الطويل.'
              : 'Synced classes that can hold rosters, packs, sessions, and long-term history.',
        tone: 'bg-white',
        icon: <Layers3 className="w-5 h-5" />,
      },
      {
        id: 'students',
        label: copy.students,
        value: totalStudents,
        body:
          language === 'he'
            ? 'תלמידים שמנוהלים כרגע ברוסטרים של הכיתות שלך.'
            : language === 'ar'
              ? 'طلاب تتم إدارتهم الآن داخل قوائم صفوفك.'
              : 'Students currently managed inside your class rosters.',
        tone: 'bg-brand-yellow',
        icon: <Users className="w-5 h-5" />,
      },
      {
        id: 'pending',
        label: copy.pending,
        value: pendingApprovals,
        body:
          language === 'he'
            ? 'הזמנות שעדיין מחכות לאישור מהצד של התלמיד.'
            : language === 'ar'
              ? 'دعوات ما زالت تنتظر موافقة الطالب.'
              : 'Invites still waiting for student approval.',
        tone: 'bg-[#FFF1E8]',
        icon: <AlertTriangle className="w-5 h-5" />,
      },
      {
        id: 'packs',
        label: copy.assignedPacks,
        value: assignedPacks,
        body:
          language === 'he'
            ? 'כיתות שמוכנות לפתיחת סשן חי כי כבר משויכת להן חבילה.'
            : language === 'ar'
              ? 'صفوف جاهزة لفتح جلسة حية لأن حزمة مرتبطة بها بالفعل.'
              : 'Classes ready for live launch because a pack is already attached.',
        tone: 'bg-brand-purple text-white',
        icon: <BookOpen className="w-5 h-5" />,
      },
      {
        id: 'live',
        label: copy.liveRooms,
        value: liveRooms,
        body:
          language === 'he'
            ? 'חדרים חיים פתוחים שאפשר לחזור אליהם מיידית.'
            : language === 'ar'
              ? 'غرف حية مفتوحة يمكن العودة إليها فورًا.'
              : 'Live rooms that can be reopened immediately.',
        tone: 'bg-brand-dark text-white',
        icon: <Clock3 className="w-5 h-5" />,
      },
    ];
  }, [classes, copy.activeClasses, copy.assignedPacks, copy.liveRooms, copy.pending, copy.students, language]);

  const handleCreateClass = async () => {
    const payload = normalizePayload(form);
    if (!payload.name || !payload.subject || !payload.grade) {
      setFeedback({ tone: 'error', message: copy.fillRequired });
      return;
    }

    try {
      setBusyKey('create-class');
      const created = await createTeacherClass(payload);
      const createdCard = toClassCardPayload(created);
      setClasses((current) => sortClassesByRecent([createdCard, ...current.filter((entry) => entry.id !== createdCard.id)]));
      setFeedback({ tone: 'success', message: copy.created });
      resetForm();
      navigate(`/teacher/classes/${created.id}`);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to create class.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateStepContinue = () => {
    if (createStep === 0) {
      const payload = normalizePayload(form);
      if (!payload.name || !payload.subject || !payload.grade) {
        setFeedback({ tone: 'error', message: copy.fillRequired });
        return;
      }
    }

    setCreateStep((current) => Math.min(current + 1, quickCreateSteps.length - 1));
  };

  const handleDeleteClass = async (classItem: TeacherClassCard) => {
    if (classItem.active_session?.id || Number(classItem.stats?.active_session_count || 0) > 0) {
      setFeedback({ tone: 'error', message: 'End the active class session before removing this class.' });
      return;
    }

    try {
      setBusyKey(`delete-${classItem.id}`);
      await deleteTeacherClass(classItem.id);
      setClasses((current) => current.filter((entry) => entry.id !== classItem.id));
      setFeedback({ tone: 'success', message: copy.deleted });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to delete class.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleHostClass = async (classItem: TeacherClassCard) => {
    if (classItem.active_session?.pin) {
      navigate(`/teacher/session/${classItem.active_session.pin}/host`, {
        state: {
          sessionId: classItem.active_session.id,
          packId: classItem.pack?.id,
        },
      });
      return;
    }

    if (!classItem.pack?.id) {
      setFeedback({ tone: 'error', message: copy.assignPackFirst });
      return;
    }

    try {
      setBusyKey(`host-${classItem.id}`);
      const session = await createClassSession({
        classId: classItem.id,
        packId: classItem.pack.id,
      });
      navigate(`/teacher/session/${session.pin}/host`, {
        state: {
          sessionId: session.id,
          packId: classItem.pack.id,
        },
      });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to start the live class.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleViewReport = (classItem: TeacherClassCard) => {
    if (!classItem.latest_completed_session?.id) {
      setFeedback({ tone: 'error', message: copy.noReportYet });
      return;
    }
    navigate(`/teacher/analytics/class/${classItem.latest_completed_session.id}`);
  };

  const handleBuildRematch = async (classItem: TeacherClassCard) => {
    if (!classItem.latest_completed_session?.id) {
      setFeedback({ tone: 'error', message: copy.noSessionYet });
      return;
    }

    try {
      setBusyKey(`rematch-${classItem.id}`);
      const payload = await apiFetchJson(`/api/teacher/sessions/${classItem.latest_completed_session.id}/rematch-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: 'whole_class_reset' }),
      });
      navigate(`/teacher/pack/${payload.pack_id}/edit`);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to build a rematch pack.' });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="teacher-layout-shell">
      <TeacherSidebar />

      <main className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
        <div className="mx-auto max-w-[1380px]">
          <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">{copy.title}</h1>
              <p className="mt-2 max-w-4xl font-bold text-brand-dark/60">{copy.subtitle}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void bootstrapPage()}
                className="rounded-full border-2 border-brand-dark bg-white px-5 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                {copy.refresh}
              </button>
              <button
                onClick={openCreatePanel}
                className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-6 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <Plus className="w-5 h-5" />
                {copy.newClass}
              </button>
            </div>
          </div>

          {feedback ? (
            <div
              className={`mb-6 flex items-center gap-3 rounded-2xl border-2 border-brand-dark p-4 shadow-[2px_2px_0px_0px_#1A1A1A] ${
                feedback.tone === 'success' ? 'bg-white' : 'bg-rose-100'
              }`}
            >
              <CheckCircle2 className={`w-5 h-5 ${feedback.tone === 'success' ? 'text-emerald-500' : 'text-rose-600'}`} />
              <span className="font-bold">{feedback.message}</span>
            </div>
          ) : null}

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {summaryStats.map((stat) => (
              <div
                key={stat.id}
                className={`${stat.tone} rounded-[1.8rem] border-2 border-brand-dark p-5 shadow-[4px_4px_0px_0px_#1A1A1A]`}
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] font-black opacity-70">{stat.label}</span>
                  {stat.icon}
                </div>
                <div className="mb-2 text-3xl font-black">{stat.value}</div>
                <p className="text-sm font-bold opacity-80">{stat.body}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.45fr_0.55fr]">
            <section>
              <div className="mb-6 flex flex-col gap-4 rounded-[2rem] border-2 border-brand-dark bg-white p-5 shadow-[4px_4px_0px_0px_#1A1A1A] md:flex-row">
                <UiverseSearchField
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  shellClassName="flex-1"
                  dir={language === 'he' ? 'rtl' : 'ltr'}
                  onClear={() => setSearchQuery('')}
                />
                <select
                  value={subjectFilter}
                  onChange={(event) => setSubjectFilter(event.target.value)}
                  className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-3 font-bold focus:outline-none"
                >
                  {subjects.map((subject) => (
                    <option key={subject.value || 'all'} value={subject.value}>
                      {subject.label}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <AppLoadingScreen
                  fullScreen={false}
                  size={90}
                  label={copy.loading}
                  caption={language === 'he' ? 'טוענים כיתות, חבילות ופעילות עדכנית.' : 'Pulling in classes, packs, and the latest activity.'}
                  panelClassName="max-w-none rounded-[2rem] border-2 px-6 py-8 shadow-[4px_4px_0px_0px_#1A1A1A]"
                />
              ) : loadError && filteredClasses.length === 0 ? (
                <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-10 text-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <p className="mb-2 text-2xl font-black">{copy.loadFailedTitle}</p>
                  <p className="mb-6 font-bold text-brand-dark/60">{loadError}</p>
                  <button
                    onClick={() => void bootstrapPage()}
                    className="rounded-full border-2 border-brand-dark bg-brand-orange px-6 py-3 font-black text-white shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    {copy.retry}
                  </button>
                </div>
              ) : filteredClasses.length === 0 ? (
                <div className="rounded-[2rem] border-2 border-brand-dark bg-white p-10 text-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <p className="mb-2 text-2xl font-black">{classes.length === 0 ? copy.emptyTitle : copy.noClassesFound}</p>
                  <p className="mb-6 font-bold text-brand-dark/60">{copy.emptyBody}</p>
                  <button
                    onClick={openCreatePanel}
                    className="rounded-full border-2 border-brand-dark bg-brand-yellow px-6 py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    {copy.createFirst}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {filteredClasses.map((classItem) => (
                    <ClassCard
                      key={classItem.id}
                      language={language}
                      classItem={classItem}
                      copy={copy}
                      isBusy={
                        busyKey === `delete-${classItem.id}` ||
                        busyKey === `host-${classItem.id}` ||
                        busyKey === `rematch-${classItem.id}`
                      }
                      onManage={() => navigate(`/teacher/classes/${classItem.id}`)}
                      onDelete={() => void handleDeleteClass(classItem)}
                      onHost={() => void handleHostClass(classItem)}
                      onViewReport={() => handleViewReport(classItem)}
                      onRematch={() => void handleBuildRematch(classItem)}
                      onOpenClassPage={() => navigate(`/teacher/classes/${classItem.id}`)}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="h-fit rounded-[2.4rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A] xl:sticky xl:top-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{copy.quickCreate}</p>
                  <h2 className="mt-1 text-2xl font-black">{copy.newClass}</h2>
                </div>
                <button
                  type="button"
                  onClick={openCreatePanel}
                  className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                >
                  {copy.quickCreateLaunch}
                </button>
              </div>
              <p className="mb-5 font-bold text-brand-dark/60">{copy.quickCreateBody}</p>
              <div className="space-y-4">
                <div className="rounded-[1.8rem] border-2 border-brand-dark bg-[linear-gradient(135deg,#FFF4D0_0%,#FFE5CC_48%,#FFD4F0_100%)] p-5 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-[1rem] border-2 border-brand-dark ${form.color}`}>
                      <Sparkles className={`h-5 w-5 ${form.color === 'bg-brand-dark' ? 'text-white' : 'text-brand-dark'}`} />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/55">{copy.previewTitle}</p>
                      <p className="text-xl font-black text-brand-dark">{form.name.trim() || copy.newClass}</p>
                    </div>
                  </div>
                  <p className="font-bold text-brand-dark/70">
                    {selectedPack?.title
                      ? `${selectedPack.title} • ${form.subject || copy.subject} • ${form.grade || copy.grade}`
                      : `${form.subject || copy.subject} • ${form.grade || copy.grade}`}
                  </p>
                  <p className="mt-3 text-sm font-bold text-brand-dark/65">{copy.classReady}</p>
                </div>

                <div className="rounded-[1.8rem] border-2 border-brand-dark/10 bg-brand-bg p-5">
                  <p className="text-lg font-black text-brand-dark">
                    {language === 'he'
                      ? 'דף הכיתה הוא מרכז הניהול הראשי'
                      : language === 'ar'
                        ? 'صفحة الصف هي مركز الإدارة الرئيسي'
                        : 'The class page is now the main management workspace'}
                  </p>
                  <p className="mt-2 font-bold text-brand-dark/65">
                    {language === 'he'
                      ? 'ניהול תלמידים, שליחת הזמנות, חבילות, סשנים וסטטיסטיקות נשארים בדף הכיתה המלא אחרי היצירה.'
                      : language === 'ar'
                        ? 'إدارة الطلاب والدعوات والحزم والجلسات والإحصاءات تبقى داخل صفحة الصف الكاملة بعد الإنشاء.'
                        : 'Student management, invites, packs, sessions, and analytics stay in the full class page right after creation.'}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {createOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-brand-dark/55 backdrop-blur-sm p-3 sm:p-4"
            onClick={closeCreatePanel}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.22 }}
              className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-brand-dark/10 bg-white shadow-[0_24px_70px_rgba(26,26,26,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,#FFCD1F_0%,#FF8A3D_52%,#FF6E98_100%)]" />
              <div className="grid grid-cols-1 lg:grid-cols-[0.78fr_1.22fr]">
                <div className="relative overflow-hidden border-b border-brand-dark/10 bg-[radial-gradient(circle_at_top_left,#FFF8EA_0%,#FFF0DC_45%,#FFE4D5_72%,#FFE0F1_100%)] p-4 sm:p-5 lg:border-b-0 lg:border-r lg:border-brand-dark/10">
                  <div className="absolute right-[-50px] top-[-45px] h-28 w-28 rounded-full bg-white/45 blur-2xl" />
                  <div className="absolute bottom-[-30px] left-[-10px] h-24 w-24 rounded-full bg-brand-yellow/35 blur-2xl" />

                  <div className="relative z-10">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-dark/45">{copy.quickCreate}</p>
                        <h2 className="mt-1.5 text-2xl sm:text-[2rem] font-black leading-[0.96] tracking-tight text-brand-dark">
                          {copy.createModalTitle}
                        </h2>
                        <p className="mt-2 max-w-md text-sm font-bold text-brand-dark/65">{copy.createModalBody}</p>
                      </div>
                      <button
                        type="button"
                        onClick={closeCreatePanel}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-dark/15 bg-white/90 text-brand-dark transition hover:bg-white"
                        aria-label={copy.close}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mb-4 flex gap-1.5">
                      {quickCreateSteps.map((step, index) => (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => {
                            if (index === 0 || (index === 1 && form.name.trim() && form.subject.trim() && form.grade.trim()) || index <= createStep) {
                              setCreateStep(index);
                            }
                          }}
                          className={`flex-1 rounded-full border-2 border-brand-dark px-2 py-2 text-center transition ${
                            index === createStep
                              ? 'border-brand-dark/15 bg-white shadow-[0_10px_24px_rgba(26,26,26,0.08)]'
                              : index < createStep
                                ? 'border-brand-dark/10 bg-brand-yellow/70'
                                : 'border-brand-dark/10 bg-white/70'
                          }`}
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{index + 1}</p>
                          <p className="mt-0.5 text-[11px] font-black text-brand-dark">{step.label}</p>
                        </button>
                      ))}
                    </div>

                    <div className="rounded-[1rem] border border-brand-dark/10 bg-white/75 px-3 py-2 text-xs font-bold text-brand-dark/70 shadow-[0_8px_18px_rgba(26,26,26,0.05)]">
                      {quickCreateSteps[createStep]?.body}
                    </div>

                    <div className={`mt-4 rounded-[1.5rem] border border-brand-dark/10 p-4 shadow-[0_16px_34px_rgba(26,26,26,0.1)] ${form.color}`}>
                      <p className={`text-xs font-black uppercase tracking-[0.18em] ${form.color === 'bg-brand-dark' ? 'text-white/70' : 'text-brand-dark/60'}`}>
                        {copy.previewTitle}
                      </p>
                      <p className={`mt-1.5 text-xl font-black ${form.color === 'bg-brand-dark' ? 'text-white' : 'text-brand-dark'}`}>
                        {form.name.trim() || copy.newClass}
                      </p>
                      <div className={`mt-2 flex flex-wrap gap-1.5 text-xs font-black ${form.color === 'bg-brand-dark' ? 'text-white/85' : 'text-brand-dark/75'}`}>
                        <span>{form.subject.trim() || copy.subject}</span>
                        <span>•</span>
                        <span>{form.grade.trim() || copy.grade}</span>
                        <span>•</span>
                        <span>{selectedPack?.title || copy.noPack}</span>
                      </div>
                      {form.notes.trim() ? (
                        <p className={`mt-3 text-xs font-bold leading-relaxed ${form.color === 'bg-brand-dark' ? 'text-white/88' : 'text-brand-dark/72'}`}>
                          {form.notes.trim()}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="bg-[linear-gradient(180deg,#FFFFFF_0%,#FFFDF8_100%)] p-4 sm:p-5">
                  {createStep === 0 ? (
                    <div className="space-y-4 rounded-[1.4rem] border border-brand-dark/10 bg-white p-4 shadow-[0_14px_30px_rgba(26,26,26,0.05)]">
                      <Field
                        inputRef={classNameInputRef}
                        label={copy.className}
                        value={form.name}
                        placeholder={copy.classNamePlaceholder}
                        onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                      />
                      <Field
                        label={copy.subject}
                        value={form.subject}
                        placeholder={copy.subjectPlaceholder}
                        onChange={(value) => setForm((current) => ({ ...current, subject: value }))}
                      />
                      <Field
                        label={copy.grade}
                        value={form.grade}
                        placeholder={copy.gradePlaceholder}
                        onChange={(value) => setForm((current) => ({ ...current, grade: value }))}
                      />
                    </div>
                  ) : null}

                  {createStep === 1 ? (
                    <div className="space-y-4 rounded-[1.4rem] border border-brand-dark/10 bg-white p-4 shadow-[0_14px_30px_rgba(26,26,26,0.05)]">
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.assignedPack}</label>
                        <p className="mb-2 text-xs font-bold text-brand-dark/60">{copy.pickStarterPack}</p>
                        <select
                          value={form.packId}
                          onChange={(event) => setForm((current) => ({ ...current, packId: event.target.value }))}
                          className="w-full rounded-[1rem] border border-brand-dark/12 bg-brand-bg p-3 font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                        >
                          <option value="">{copy.noPack}</option>
                          {packs.map((pack) => (
                            <option key={pack.id} value={pack.id}>
                              {pack.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.color}</label>
                        <p className="mb-2 text-xs font-bold text-brand-dark/60">{copy.pickAColor}</p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {TEACHER_CLASS_COLOR_OPTIONS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setForm((current) => ({ ...current, color }))}
                              className={`rounded-[1rem] border border-brand-dark/12 bg-white/70 p-2 text-left shadow-[0_10px_20px_rgba(26,26,26,0.06)] transition ${
                                form.color === color ? 'ring-4 ring-brand-orange/20' : 'hover:-translate-y-0.5'
                              } ${color}`}
                            >
                              <div className={`h-9 rounded-[0.7rem] border-2 border-brand-dark/20 ${color === 'bg-white' ? 'bg-white' : color}`} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {createStep === 2 ? (
                    <div className="space-y-4 rounded-[1.4rem] border border-brand-dark/10 bg-white p-4 shadow-[0_14px_30px_rgba(26,26,26,0.05)]">
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">
                          {copy.notes} · {copy.optional}
                        </label>
                        <p className="mb-2 text-xs font-bold text-brand-dark/60">{copy.notesHelper}</p>
                        <textarea
                          value={form.notes}
                          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                          className="min-h-24 w-full rounded-[1rem] border border-brand-dark/12 bg-brand-bg p-3 font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                          placeholder={copy.notesPlaceholder}
                        />
                      </div>

                      <div className="rounded-[1.2rem] border border-brand-dark/10 bg-brand-bg p-4">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{copy.previewTitle}</p>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <PreviewStat label={copy.className} value={form.name || '—'} />
                          <PreviewStat label={copy.subject} value={form.subject || '—'} />
                          <PreviewStat label={copy.grade} value={form.grade || '—'} />
                          <PreviewStat label={copy.assignedPack} value={selectedPack?.title || copy.noPack} />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-col gap-2.5 border-t border-brand-dark/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setCreateStep((current) => Math.max(current - 1, 0))}
                        disabled={createStep === 0 || busyKey === 'create-class'}
                        className="inline-flex items-center gap-2 rounded-full border border-brand-dark/15 bg-white px-4 py-2.5 text-sm font-black shadow-[0_8px_18px_rgba(26,26,26,0.05)] disabled:opacity-40"
                      >
                        <ArrowLeft className={`h-4 w-4 ${language === 'he' || language === 'ar' ? 'rotate-180' : ''}`} />
                        {copy.back}
                      </button>
                      <button
                        type="button"
                        onClick={resetForm}
                        disabled={busyKey === 'create-class'}
                        className="rounded-full border border-brand-dark/10 bg-brand-bg px-4 py-2.5 text-sm font-black disabled:opacity-40"
                      >
                        {copy.reset}
                      </button>
                    </div>

                    {createStep < quickCreateSteps.length - 1 ? (
                      <button
                        type="button"
                        onClick={handleCreateStepContinue}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-brand-dark/10 bg-brand-yellow px-5 py-2.5 text-sm font-black shadow-[0_12px_26px_rgba(255,184,0,0.28)]"
                      >
                        {copy.continue}
                        <ArrowRight className={`h-5 w-5 ${language === 'he' || language === 'ar' ? 'rotate-180' : ''}`} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCreateClass()}
                        disabled={busyKey === 'create-class'}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-brand-dark/10 bg-brand-orange px-5 py-2.5 text-sm font-black text-white shadow-[0_14px_30px_rgba(255,122,26,0.28)] disabled:opacity-60"
                      >
                        {busyKey === 'create-class' ? copy.saving : copy.saveAndOpen}
                        <CheckCircle2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputRef,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{label}</label>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[1.2rem] border border-brand-dark/12 bg-brand-bg p-4 font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] placeholder:text-brand-dark/28"
      />
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-brand-dark/10 bg-white px-4 py-3 shadow-[0_8px_18px_rgba(26,26,26,0.04)]">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{label}</p>
      <p className="mt-1 text-base font-black text-brand-dark">{value}</p>
    </div>
  );
}

type ClassCardProps = {
  language: string;
  classItem: TeacherClassCard;
  copy: Record<string, string>;
  isBusy: boolean;
  onManage: () => void;
  onDelete: () => void;
  onHost: () => void;
  onViewReport: () => void;
  onRematch: () => void;
  onOpenClassPage: () => void;
};

const ClassCard: React.FC<ClassCardProps> = ({
  language,
  classItem,
  copy,
  isBusy,
  onManage,
  onDelete,
  onHost,
  onViewReport,
  onRematch,
  onOpenClassPage,
}) => {
  const isRtl = language === 'he' || language === 'ar';
  const [deleteArmed, setDeleteArmed] = useState(false);
  const safeStats = classItem.stats || {
    student_count: Number(classItem.student_count || 0),
    session_count: 0,
    active_session_count: 0,
    total_participant_count: 0,
    average_accuracy: null,
  };
  const hasReport = Boolean(classItem.latest_completed_session?.id);
  const hasAssignedPack = Boolean(classItem.pack?.id);
  const sessionsValue = Number(safeStats.session_count || 0);
  const accuracyValue = `${Math.round(Number(safeStats.average_accuracy || 0))}%`;
  const actionButtonBase =
    'flex min-h-[66px] min-w-0 items-center justify-center gap-2 rounded-full border-[3px] border-brand-dark px-3 sm:px-4 text-[0.76rem] sm:text-[0.92rem] font-black shadow-[6px_6px_0px_0px_#1A1A1A] transition-transform active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-40 disabled:active:translate-x-0 disabled:active:translate-y-0 disabled:active:shadow-[6px_6px_0px_0px_#1A1A1A]';

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`overflow-hidden rounded-[2.2rem] border-[4px] border-brand-dark bg-white p-4 sm:p-5 shadow-[8px_8px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : 'text-left'}`}
    >
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="shrink-0 rounded-[1.45rem] bg-[#F3ECFF] p-1.5 sm:p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onManage}
                className="inline-flex min-h-[40px] items-center justify-center rounded-full border-[3px] border-brand-dark bg-white px-4 sm:px-5 text-[0.8rem] sm:text-[0.95rem] font-black text-brand-dark transition-transform active:translate-x-[2px] active:translate-y-[2px]"
              >
                {copy.manage}
              </button>
              <button
                type="button"
                onClick={() => setDeleteArmed(true)}
                disabled={isBusy}
                aria-label="Delete class"
                className={`flex h-[40px] w-[40px] items-center justify-center rounded-full border-[3px] border-brand-dark transition-transform active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50 ${
                  deleteArmed ? 'bg-[#FF4B32] text-white' : 'bg-white text-[#FF4B32]'
                }`}
              >
                <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            </div>
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="line-clamp-2 text-right text-[1.45rem] leading-[0.92] sm:text-[2.15rem] font-black tracking-[-0.035em] text-brand-dark">
              {classItem.name}
            </h3>
          </div>
        </div>

        {deleteArmed ? (
          <div className="rounded-[1.35rem] border-[3px] border-brand-dark bg-rose-50 px-4 py-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
            <p className="text-center text-sm font-black text-brand-dark">
              {language === 'he'
                ? `למחוק את הכיתה ${classItem.name}?`
                : language === 'ar'
                  ? `هل تريد/ين حذف الصف ${classItem.name}؟`
                  : `Delete class ${classItem.name}?`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  void onDelete();
                  setDeleteArmed(false);
                }}
                disabled={isBusy}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-full border-[3px] border-brand-dark bg-[#FF4B32] px-4 py-2 font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A] disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {language === 'he' ? 'כן, למחוק' : language === 'ar' ? 'نعم، احذف' : 'Yes, delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteArmed(false)}
                disabled={isBusy}
                className="flex min-h-[48px] items-center justify-center rounded-full border-[3px] border-brand-dark bg-white px-4 py-2 font-black shadow-[4px_4px_0px_0px_#1A1A1A] disabled:opacity-50"
              >
                {language === 'he' ? 'ביטול' : language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-h-[134px] flex-col items-center justify-center rounded-[1.7rem] border-[4px] border-black/10 bg-white px-3 py-4 text-center">
            <div className="mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-[1rem] border-[2px] border-[#DCCDFE] bg-[#F2EBFF] text-[#9B63FF]">
              <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <p className="text-[0.9rem] sm:text-[1.05rem] font-black text-brand-dark">{copy.sessions}</p>
            <p className="mt-1 text-[2.15rem] leading-none sm:text-[2.9rem] font-black text-brand-dark">{sessionsValue}</p>
          </div>

          <div className="flex min-h-[134px] flex-col items-center justify-center rounded-[1.7rem] border-[4px] border-black/10 bg-white px-3 py-4 text-center">
            <div className="mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-[1rem] border-[2px] border-[#F6E5AE] bg-[#FFF2C8] text-brand-dark">
              <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <p className="text-[0.9rem] sm:text-[1.05rem] font-black text-brand-dark">{copy.accuracy}</p>
            <p className="mt-1 text-[2.15rem] leading-none sm:text-[2.9rem] font-black text-brand-dark">{accuracyValue}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-0.5">
          <button
            onClick={onHost}
            disabled={!hasAssignedPack || isBusy}
            className={`${actionButtonBase} bg-brand-purple text-white`}
          >
            <span className="min-w-0 flex-1 whitespace-normal break-words text-center leading-[1.05]">{copy.host}</span>
            <Plus className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          </button>

          <button
            onClick={onViewReport}
            disabled={!hasReport || isBusy}
            className={`${actionButtonBase} bg-white text-brand-dark`}
          >
            <span className="min-w-0 flex-1 whitespace-normal break-words text-center leading-[1.05]">{copy.latestReport}</span>
            <ClipboardList className="h-5 w-5 shrink-0 text-[#9B63FF] sm:h-6 sm:w-6" />
          </button>

          <button
            onClick={onRematch}
            disabled={!hasReport || isBusy}
            className={`${actionButtonBase} bg-white text-brand-dark`}
          >
            <span className="min-w-0 flex-1 whitespace-normal break-words text-center leading-[1.05]">{copy.rematch}</span>
            <RefreshCw className="h-5 w-5 shrink-0 text-brand-orange sm:h-6 sm:w-6" />
          </button>

          <button
            onClick={onOpenClassPage}
            disabled={isBusy}
            className={`${actionButtonBase} bg-[#FFD347] text-brand-dark`}
          >
            <span className="min-w-0 flex-1 whitespace-normal break-words text-center leading-[1.05]">{copy.openClassPage}</span>
            <ArrowRight className={`h-5 w-5 shrink-0 sm:h-6 sm:w-6 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    </motion.article>
  );
};
