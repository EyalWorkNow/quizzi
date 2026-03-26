import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock3,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
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

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Not run yet';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
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
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const createPanelRef = useRef<HTMLDivElement | null>(null);
  const classNameInputRef = useRef<HTMLInputElement | null>(null);

  const copy = {
    he: {
      title: 'כיתות',
      subtitle: 'העמוד הזה הוא עכשיו overview בלבד: חיפוש, מצב כיתה, וגישה מהירה לדף הכיתה המלא שבו מנהלים תלמידים, הזמנות, חבילות, סשנים וסטטיסטיקות.',
      refresh: 'רענון',
      newClass: 'כיתה חדשה',
      quickCreate: 'יצירה מהירה',
      quickCreateBody: 'צור/י כיתה חדשה במהירות. כל הניהול המלא יתבצע מדף הכיתה עצמו אחרי השמירה.',
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
  };

  const scrollToCreatePanel = () => {
    window.requestAnimationFrame(() => {
      createPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        classNameInputRef.current?.focus();
      }, 180);
    });
  };

  const openCreatePanel = () => {
    setCreateOpen(true);
    scrollToCreatePanel();
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

  const handleDeleteClass = async (classItem: TeacherClassCard) => {
    if (!window.confirm(`Remove ${classItem.name}?`)) {
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
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-dark/40" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="w-full rounded-full border-2 border-brand-dark bg-brand-bg py-3 pl-12 pr-4 font-bold focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
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
                <div className="flex items-center justify-center gap-3 rounded-[2rem] border-2 border-brand-dark bg-white p-10 font-black shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  {copy.loading}
                </div>
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

            <aside
              ref={createPanelRef}
              className="h-fit rounded-[2.4rem] border-2 border-brand-dark bg-white p-6 shadow-[4px_4px_0px_0px_#1A1A1A] xl:sticky xl:top-6"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{copy.quickCreate}</p>
                  <h2 className="mt-1 text-2xl font-black">{copy.newClass}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen((current) => !current)}
                  className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                >
                  {createOpen ? copy.reset : copy.quickCreate}
                </button>
              </div>
              <p className="mb-5 font-bold text-brand-dark/60">{copy.quickCreateBody}</p>

              {createOpen ? (
                <div className="space-y-4">
                  <Field
                    inputRef={classNameInputRef}
                    label={copy.className}
                    value={form.name}
                    onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                  />
                  <Field label={copy.subject} value={form.subject} onChange={(value) => setForm((current) => ({ ...current, subject: value }))} />
                  <Field label={copy.grade} value={form.grade} onChange={(value) => setForm((current) => ({ ...current, grade: value }))} />

                  <div>
                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.assignedPack}</label>
                    <select
                      value={form.packId}
                      onChange={(event) => setForm((current) => ({ ...current, packId: event.target.value }))}
                      className="w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
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
                    <div className="flex flex-wrap gap-2">
                      {TEACHER_CLASS_COLOR_OPTIONS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, color }))}
                          className={`h-10 w-10 rounded-xl border-2 border-brand-dark ${color} ${
                            form.color === color ? 'ring-4 ring-brand-orange/30' : ''
                          }`}
                          aria-label={`Pick ${color}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{copy.notes}</label>
                    <textarea
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      className="min-h-28 w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
                      placeholder={copy.notesPlaceholder}
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => void handleCreateClass()}
                      disabled={busyKey === 'create-class'}
                      className="flex-1 rounded-xl border-2 border-brand-dark bg-brand-orange py-3 font-black text-white shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                    >
                      {busyKey === 'create-class' ? copy.saving : copy.save}
                    </button>
                    <button
                      onClick={resetForm}
                      className="rounded-xl border-2 border-brand-dark bg-white px-4 font-black"
                    >
                      {copy.reset}
                    </button>
                  </div>
                </div>
              ) : (
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
                      ? 'ניהול תלמידים, שליחת הזמנות, pack, סשנים, mail health וסטטיסטיקות נשארים בדף הכיתה המלא.'
                      : language === 'ar'
                        ? 'إدارة الطلاب وإرسال الدعوات والحزمة والجلسات وصحة البريد والإحصاءات تبقى داخل صفحة الصف الكاملة.'
                        : 'Student management, invites, pack assignment, sessions, mail health, and analytics now live in the full class page.'}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{label}</label>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border-2 border-brand-dark bg-brand-bg p-3 font-bold"
      />
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
  const safeStats = classItem.stats || {
    student_count: Number(classItem.student_count || 0),
    session_count: 0,
    active_session_count: 0,
    total_participant_count: 0,
    average_accuracy: null,
  };
  const safeInviteSummary = classItem.invite_summary || {
    approved_count: 0,
    pending_count: 0,
    session_only_count: 0,
    linked_count: 0,
  };
  const safeRetention = classItem.retention || {
    level: 'low' as const,
    headline:
      language === 'he'
        ? 'נראה יציב'
        : language === 'ar'
          ? 'يبدو مستقرًا'
          : 'Looks stable',
    body:
      language === 'he'
        ? 'עדיין אין מספיק נתונים כדי לבנות תמונת שימור מלאה לכיתה הזו.'
        : language === 'ar'
          ? 'لا توجد بيانات كافية بعد لبناء صورة احتفاظ كاملة لهذا الصف.'
          : 'There is not enough data yet to build a full retention read for this class.',
    active_last_7d: 0,
    slipping: 0,
    inactive_14d: 0,
    never_started: 0,
    started_count: 0,
    needs_attention_count: 0,
    watchlist_students: [],
  };
  const hasReport = Boolean(classItem.latest_completed_session?.id);
  const hasAssignedPack = Boolean(classItem.pack?.id);
  const hasOpenLiveRoom = Boolean(classItem.active_session?.id);
  const sessionState = hasOpenLiveRoom
    ? copy.liveRoomOpen
    : classItem.latest_completed_session
      ? `${copy.lastRun} ${formatRelativeTime(classItem.latest_completed_session.ended_at || classItem.latest_completed_session.started_at)}`
      : copy.noLiveRun;

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`overflow-hidden rounded-[2rem] sm:rounded-[2.7rem] border-[3px] border-brand-dark bg-white shadow-[6px_6px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : 'text-left'}`}
    >
      {/* Lavender Header Area */}
      <div className="bg-[#F3ECFA] px-4 pb-5 pt-4 sm:px-5 sm:pb-6 sm:pt-4">
        <div className={`mb-3 flex items-start justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div className={`min-w-0 flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div className="h-3 w-3 rounded-full bg-brand-orange shadow-[0_0_10px_rgba(255,107,0,0.45)]" />
            <span className="truncate text-[8px] sm:text-[9px] font-black uppercase tracking-[0.14em] sm:tracking-[0.18em] text-brand-dark/40">{copy.rosterLabel}</span>
          </div>
          <div className={`flex shrink-0 items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <button
              type="button"
              onClick={onManage}
              className="rounded-[1.1rem] sm:rounded-[1.45rem] border-[3px] border-brand-dark bg-white px-4 sm:px-5 py-2 text-[11px] sm:text-[13px] font-black whitespace-nowrap shadow-[4px_4px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              {copy.manage}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isBusy}
              className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-brand-dark bg-white text-brand-orange shadow-[4px_4px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-50"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        <h3 className="mt-4 line-clamp-2 min-h-[3.6rem] text-center text-[1.65rem] leading-[0.98] sm:min-h-[4rem] sm:text-[2rem] font-black tracking-tight text-brand-dark">
          {classItem.name}
        </h3>
        
        <div className={`mt-5 flex items-center justify-center gap-2 overflow-hidden ${isRtl ? 'flex-row-reverse' : ''}`}>
          <span className="max-w-[40%] truncate rounded-xl border-2 border-brand-dark/10 bg-white px-3 py-2 text-[12px] sm:text-[14px] font-black text-brand-dark/60 shadow-sm">{classItem.subject || 'General'}</span>
          <span className="max-w-[40%] truncate rounded-xl border-2 border-brand-dark/10 bg-white px-3 py-2 text-[12px] sm:text-[14px] font-black text-brand-dark/60 shadow-sm">{classItem.grade || 'Mixed'}</span>
          <span className="shrink-0 text-lg sm:text-xl font-light text-brand-dark/15 ml-1">/</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="space-y-4 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
        {/* Row 1 Metrics: Sessions & Accuracy */}
        <div className="grid grid-cols-2 gap-4">
          {/* Accuracy Card */}
          <div className="flex min-h-[132px] flex-col justify-between rounded-[1.5rem] sm:rounded-[1.9rem] border-[3px] border-brand-dark/10 bg-white p-4">
            <div className={`flex items-start justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <div className="rounded-xl bg-brand-yellow/20 p-2.5 text-brand-dark border-2 border-brand-dark/5">
                <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <p className="text-[9px] font-black uppercase tracking-[0.08em] text-brand-dark/40">{copy.accuracy}</p>
            </div>
            <div className={`${isRtl ? 'text-left' : 'text-right'}`}>
              <p className="text-[2.1rem] sm:text-[2.6rem] font-black text-brand-dark">{Math.round(safeStats.average_accuracy || 0)}%</p>
              <p className="mt-1 text-[13px] sm:text-[15px] font-black text-brand-dark tracking-tight">{copy.accuracy}</p>
            </div>
          </div>

          {/* Sessions Card */}
          <div className="flex min-h-[132px] flex-col justify-between rounded-[1.5rem] sm:rounded-[1.9rem] border-[3px] border-brand-dark/10 bg-white p-4">
            <div className={`flex items-start justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <div className="rounded-xl bg-brand-purple/10 p-2.5 text-brand-purple border-2 border-brand-dark/5">
                <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <p className="text-[9px] font-black uppercase tracking-[0.08em] text-brand-dark/40">{copy.sessions}</p>
            </div>
            <p className="text-right text-[2.1rem] sm:text-[2.6rem] font-black text-brand-dark">{safeStats.session_count || 0}</p>
          </div>
        </div>

        {/* Big Attention Card */}
        <div className={`flex items-center justify-between gap-3 rounded-[1.5rem] sm:rounded-[1.9rem] border-[3px] border-brand-dark/10 bg-white px-4 sm:px-6 py-4 sm:py-5 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <p className="shrink-0 text-[2rem] sm:text-[2.6rem] font-black text-brand-dark">
            {safeRetention.needs_attention_count}
          </p>
          <div className={`min-w-0 flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div className="rounded-2xl border-2 border-brand-dark/5 bg-brand-orange/10 p-3 text-brand-orange">
              <AlertTriangle className="h-5 w-5 sm:h-7 sm:w-7" />
            </div>
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.08em] text-brand-dark/40">{copy.attention}</p>
          </div>
        </div>

        {/* Status Breakdown Section */}
        <div className="grid grid-cols-2 gap-4 pt-1">
          {/* Pack Assignment Card */}
          <div className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[1.6rem] sm:rounded-[2rem] border-[3px] border-brand-dark bg-white p-4">
            <div>
               <div className={`mb-3 flex min-w-0 items-center justify-between gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                  <p className="truncate text-[9px] font-black uppercase tracking-[0.08em] text-brand-dark/40">{copy.assignedPackLabel}</p>
                  <BookOpen className="h-5 w-5 text-brand-purple/30" />
               </div>
               <p className="line-clamp-3 min-h-[6rem] text-[1.4rem] sm:text-[1.75rem] font-black text-brand-dark leading-[1.02]">
                 {classItem.pack?.title || copy.noPack}
               </p>
            </div>
            
            <div className={`flex min-w-0 items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
               <div className={`flex ${isRtl ? 'flex-row-reverse -space-x-2.5 space-x-reverse' : '-space-x-2.5'}`}>
                  <span className="z-30 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand-yellow font-black text-xs shadow-md">
                    {safeInviteSummary.approved_count}
                  </span>
                  <span className="z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 font-black text-xs text-brand-dark/40 shadow-sm">
                    {safeInviteSummary.pending_count}
                  </span>
                  <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-50 font-black text-xs text-brand-dark/20 shadow-sm">
                    {safeInviteSummary.session_only_count}
                  </span>
               </div>
               <p className="truncate text-[8px] font-black uppercase text-brand-dark/30">
                 {safeInviteSummary.approved_count}/{classItem.student_count} {copy.approved}
               </p>
            </div>
          </div>

          {/* Session State Card */}
          <div className="flex min-h-[220px] flex-col rounded-[1.6rem] sm:rounded-[2rem] border-[3px] border-brand-dark bg-white p-4">
             <div className={`mb-3 flex min-w-0 items-center gap-1.5 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <div className={`h-3 w-3 rounded-full border-2 border-white shadow-sm ${hasOpenLiveRoom ? 'animate-pulse bg-emerald-500' : 'bg-brand-dark/15'}`} />
                <p className="truncate text-[9px] font-black uppercase tracking-[0.08em] text-brand-dark/40">{copy.sessionState}</p>
             </div>
             <div className="flex-1 flex flex-col justify-center">
                <div className="mb-3">
                  <p className="line-clamp-2 min-h-[3rem] text-[1.45rem] sm:text-[1.8rem] font-black text-brand-dark leading-[1.02]">
                    {hasOpenLiveRoom ? copy.liveRoomOpen : copy.lastRun}
                  </p>
                  {!hasOpenLiveRoom && classItem.latest_completed_session && (
                    <p className="mt-2 text-[1.1rem] sm:text-[1.3rem] font-black text-brand-dark">{formatRelativeTime(classItem.latest_completed_session.ended_at)}</p>
                  )}
                </div>
                <span className="inline-flex max-w-full self-start truncate rounded-full bg-[#E8F8F1] border-2 border-brand-dark/5 px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-[#10B981]">
                  {language === 'he' ? 'השתתפות בריאה' : language === 'ar' ? 'مشاركة مستقرة' : 'Participation looks healthy'}
                </span>
             </div>
             <div className={`mt-4 line-clamp-2 border-brand-purple/20 italic text-[11px] sm:text-[13px] font-black text-brand-dark/30 leading-snug ${isRtl ? 'border-r-4 pr-3' : 'border-l-4 pl-3'}`}>
               {language === 'he' ? 'השתתפות נראית בריאה' : language === 'ar' ? 'المشاركة تبدو مستقرة' : 'Participation looks healthy'}
             </div>
          </div>
        </div>

        {/* Action Button Grid - 2x2 Matrix */}
        <div className="grid grid-cols-2 gap-4 pt-3">
          {/* WHITE: Reports */}
          <button
            onClick={onViewReport}
            disabled={!hasReport || isBusy}
            className="flex min-h-[72px] items-center justify-center gap-3 rounded-[1.4rem] sm:rounded-[1.8rem] border-[3px] border-brand-dark bg-white px-4 text-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-40"
          >
            <ClipboardList className="h-6 w-6 shrink-0 text-brand-purple" />
            <span className="truncate text-center text-[12px] sm:text-[14px] font-black tracking-tight">{copy.latestReport}</span>
          </button>

          {/* PURPLE: Host */}
          <button
            onClick={onHost}
            disabled={!hasAssignedPack || isBusy}
            className="flex min-h-[72px] items-center justify-center gap-3 rounded-[1.4rem] sm:rounded-[1.8rem] border-[3px] border-brand-dark bg-brand-purple px-4 text-white shadow-[6px_6px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-40"
          >
            <Plus className="h-6 w-6 sm:h-8 sm:w-8 shrink-0" />
            <span className="truncate text-center text-[12px] sm:text-[14px] font-black tracking-tight">{copy.host}</span>
          </button>

          {/* YELLOW: Open Page */}
          <button
            onClick={onOpenClassPage}
            disabled={isBusy}
            className="flex min-h-[72px] items-center justify-center gap-3 rounded-[1.4rem] sm:rounded-[1.8rem] border-[3px] border-brand-dark bg-[#FFD646] px-4 text-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-40"
          >
            <ArrowRight className={`h-6 w-6 shrink-0 ${isRtl ? 'rotate-180' : ''}`} />
            <span className="truncate text-center text-[12px] sm:text-[14px] font-black tracking-tight">{copy.openClassPage}</span>
          </button>

          {/* WHITE: Rematch */}
          <button
            onClick={onRematch}
            disabled={!hasReport || isBusy}
            className="flex min-h-[72px] items-center justify-center gap-3 rounded-[1.4rem] sm:rounded-[1.8rem] border-[3px] border-brand-dark bg-white px-4 text-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] transition-all active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-40"
          >
            <RefreshCw className="h-6 w-6 shrink-0 text-brand-orange" />
            <span className="truncate text-center text-[12px] sm:text-[14px] font-black tracking-tight">{copy.rematch}</span>
          </button>
        </div>
      </div>
    </motion.article>
  );
};


function retentionLevelTone(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'border-rose-200 bg-rose-50 text-rose-600';
  if (level === 'medium') return 'border-brand-yellow/30 bg-brand-yellow/10 text-brand-dark/75';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}
