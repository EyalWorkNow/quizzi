import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Users,
  UserPlus,
  XCircle,
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
  addTeacherClassStudent,
  createClassSession,
  createTeacherClass,
  deleteTeacherClass,
  deleteTeacherSession,
  listTeacherClasses,
  removeTeacherClassStudent,
  TEACHER_CLASS_COLOR_OPTIONS,
  type TeacherClassBoard,
  type TeacherClassColor,
  type TeacherClassPayload,
  updateTeacherClass,
} from '../lib/teacherClasses.ts';

type FeedbackState = {
  tone: 'success' | 'error';
  message: string;
} | null;

type ClassFormState = {
  id: number | null;
  name: string;
  subject: string;
  grade: string;
  color: TeacherClassColor;
  packId: string;
  notes: string;
};

const EMPTY_FORM: ClassFormState = {
  id: null,
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

function formatAccuracy(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'No answers yet';
  }
  return `${Math.round(value)}% accuracy`;
}

function buildFormState(classItem: TeacherClassBoard): ClassFormState {
  return {
    id: classItem.id,
    name: classItem.name,
    subject: classItem.subject,
    grade: classItem.grade,
    color: classItem.color,
    packId: classItem.pack_id ? String(classItem.pack_id) : '',
    notes: classItem.notes || '',
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

function sortClassesByRecent(classes: TeacherClassBoard[]) {
  return [...classes].sort((left, right) => {
    const leftDate = new Date(left.updated_at || left.created_at || 0).getTime() || 0;
    const rightDate = new Date(right.updated_at || right.created_at || 0).getTime() || 0;
    return rightDate - leftDate || right.id - left.id;
  });
}

export default function TeacherClasses() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<TeacherClassBoard[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [selectedClassId, setSelectedClassId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const [studentName, setStudentName] = useState('');
  const [pendingSessionDelete, setPendingSessionDelete] = useState<null | { sessionId: number; classId: number; label: string }>(null);
  const [copiedOutreachKey, setCopiedOutreachKey] = useState('');
  const copy = {
    he: {
      title: 'כיתות',
      subtitle: 'רשימות כיתה אמיתיות, שיוך חבילות בפועל וקישורים ישירים לסשנים החיים ולדוחות שכל כיתה באמת יצרה.',
      refresh: 'רענון לוח',
      newClass: 'כיתה חדשה',
      searchPlaceholder: 'חפש כיתות, תלמידים, מקצועות או חבילות משויכות...',
      loading: 'טוען כיתות...',
      loadFailedTitle: 'הכיתות לא נטענו כראוי.',
      retry: 'נסה שוב',
      emptyTitle: 'לא נמצאו כיתות שמתאימות ללוח הזה.',
      emptyBody: 'צור כיתה חדשה, או תן ל־Quizzi לשחזר לוחות מהיסטוריית סשנים חיים כשהיא מזהה פעילות קודמת בלי לוח כיתה משויך.',
      createFirst: 'צור את הכיתה הראשונה',
      builderTitle: 'בונה כיתה',
      createTitle: 'יצירת כיתה',
      editTitle: 'עריכת כיתה',
      builderBody: 'עדכן את רשומת הכיתה החיה, הסגל והחבילה המשויכת ממקום אחד.',
      className: 'שם הכיתה',
      subject: 'מקצוע',
      grade: 'שכבה',
      assignedPack: 'חבילה משויכת',
      noPack: 'עדיין אין חבילה משויכת',
      createPackFirst: 'צור קודם חבילת חידון אם אתה רוצה שהכיתה הזאת תוכל להפעיל סשן חי ישירות.',
      color: 'צבע',
      notes: 'הערות',
      notesPlaceholder: 'הערות אופציונליות לגבי קצב, קבוצות או הקשר כיתתי...',
      saving: 'שומר...',
      updateClass: 'עדכן כיתה',
      createClass: 'צור כיתה',
      reset: 'איפוס',
    },
    ar: {
      title: 'الصفوف',
      subtitle: 'قوائم صفية فعلية، وربط حزم حقيقي، وروابط مباشرة إلى الجلسات الحية والتقارير التي أنشأها كل صف بالفعل.',
      refresh: 'تحديث اللوحة',
      newClass: 'صف جديد',
      searchPlaceholder: 'ابحث عن صفوف أو طلاب أو مواد أو حزم مرتبطة...',
      loading: 'جارٍ تحميل الصفوف...',
      loadFailedTitle: 'لم يتم تحميل الصفوف بشكل سليم.',
      retry: 'أعد المحاولة',
      emptyTitle: 'لم يتم العثور على صفوف مطابقة لهذه اللوحة.',
      emptyBody: 'أنشئ صفًا جديدًا، أو اسمح لـ Quizzi بإعادة بناء اللوحات من تاريخ الجلسات الحية عندما يكتشف نشاطًا سابقًا بلا لوحة صف مرتبطة.',
      createFirst: 'أنشئ الصف الأول',
      builderTitle: 'منشئ الصف',
      createTitle: 'إنشاء صف',
      editTitle: 'تحرير صف',
      builderBody: 'حدّث سجل الصف الحي والقائمة والحزمة المرتبطة من مكان واحد.',
      className: 'اسم الصف',
      subject: 'المادة',
      grade: 'الصف',
      assignedPack: 'الحزمة المرتبطة',
      noPack: 'لا توجد حزمة مرتبطة بعد',
      createPackFirst: 'أنشئ حزمة اختبار أولًا إذا كنت تريد لهذا الصف أن يطلق جلسة حية مباشرة.',
      color: 'اللون',
      notes: 'ملاحظات',
      notesPlaceholder: 'ملاحظات اختيارية عن الإيقاع أو المجموعات أو سياق الصف...',
      saving: 'جارٍ الحفظ...',
      updateClass: 'حدّث الصف',
      createClass: 'أنشئ صفًا',
      reset: 'إعادة ضبط',
    },
    en: {
      title: 'Classes',
      subtitle: 'Real class rosters, real pack assignments, and direct links into the live sessions and reports each class actually generated.',
      refresh: 'Refresh Board',
      newClass: 'New Class',
      searchPlaceholder: 'Search classes, students, subjects or assigned packs...',
      loading: 'Loading classes...',
      loadFailedTitle: 'Classes did not load cleanly.',
      retry: 'Try again',
      emptyTitle: 'No classes matched this board.',
      emptyBody: 'Create a class, or let Quizzi rebuild boards from historical live sessions when it finds session history with no class board attached.',
      createFirst: 'Create the first class',
      builderTitle: 'Class Builder',
      createTitle: 'Create Class',
      editTitle: 'Edit Class',
      builderBody: 'Update the live class record, roster, and assigned pack from one place.',
      className: 'Class Name',
      subject: 'Subject',
      grade: 'Grade',
      assignedPack: 'Assigned Pack',
      noPack: 'No pack assigned yet',
      createPackFirst: 'Create a quiz pack first if you want this class to launch directly into live sessions.',
      color: 'Color',
      notes: 'Notes',
      notesPlaceholder: 'Optional notes for pacing, grouping, or roster context...',
      saving: 'Saving...',
      updateClass: 'Update Class',
      createClass: 'Create Class',
      reset: 'Reset',
    },
  }[language];

  useEffect(() => {
    void bootstrapPage();
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!copiedOutreachKey) return;
    const timeout = window.setTimeout(() => setCopiedOutreachKey(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [copiedOutreachKey]);

  useEffect(() => {
    if (selectedClassId === 'new' || selectedClassId === null) return;
    if (classes.some((classItem) => classItem.id === selectedClassId)) return;
    setSelectedClassId(null);
    setForm(EMPTY_FORM);
    setStudentName('');
  }, [classes, selectedClassId]);

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
          ? classBoardResult.value
          : [];
      const classBoardError =
        classBoardResult.status === 'rejected'
          ? classBoardResult.reason?.message || 'Failed to load classes.'
          : '';
      const packBoardError =
        packBoardResult.status === 'rejected'
          ? packBoardResult.reason?.message || 'Failed to load packs.'
          : '';
      const migrated = nextClasses.length === 0 ? await maybeMigrateLegacyClasses(nextPacks) : false;

      if (migrated) {
        nextClasses = await listTeacherClasses();
        setFeedback({ tone: 'success', message: 'Imported your previous local classes into the live workspace.' });
      }

      setPacks(nextPacks);
      setClasses(sortClassesByRecent(nextClasses));
      setLoadError(classBoardError);
      if (classBoardError || packBoardError) {
        setFeedback({
          tone: 'error',
          message: classBoardError || packBoardError,
        });
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
    const color = TEACHER_CLASS_COLOR_OPTIONS.includes(legacyClass.color as TeacherClassColor)
      ? (legacyClass.color as TeacherClassColor)
      : 'bg-brand-purple';
    const packId = Number(legacyClass.packId || 0);

    await createTeacherClass({
      name: legacyClass.name || 'Imported Class',
      subject: legacyClass.subject || 'General',
      grade: legacyClass.grade || 'Mixed',
      color,
      notes: legacyClass.notes || '',
      pack_id: packId && validPackIds.has(packId) ? packId : null,
      students: Array.isArray(legacyClass.students)
        ? legacyClass.students
            .map((student) => ({ name: String(student?.name || '').trim() }))
            .filter((student) => student.name)
        : [],
    });
  };

  const upsertClass = (nextClass: TeacherClassBoard) => {
    setClasses((current) => sortClassesByRecent([nextClass, ...current.filter((entry) => entry.id !== nextClass.id)]));
  };

  const removeClassFromState = (classId: number) => {
    setClasses((current) => current.filter((entry) => entry.id !== classId));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setSelectedClassId(null);
    setStudentName('');
  };

  const openNewClassBuilder = () => {
    setSelectedClassId('new');
    setForm(EMPTY_FORM);
    setStudentName('');
  };

  const openClassEditor = (classItem: TeacherClassBoard) => {
    setSelectedClassId(classItem.id);
    setForm(buildFormState(classItem));
    setStudentName('');
  };

  const selectedClass =
    selectedClassId && selectedClassId !== 'new'
      ? classes.find((classItem) => classItem.id === selectedClassId) || null
      : null;

  const subjects = useMemo(
    () => ['All', ...Array.from(new Set(classes.map((classItem) => classItem.subject))).filter(Boolean)],
    [classes],
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
        ...classItem.students.map((student) => student.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !normalizedQuery || searchFields.includes(normalizedQuery);
      const matchesSubject = subjectFilter === 'All' || classItem.subject === subjectFilter;
      return matchesSearch && matchesSubject;
    });
  }, [classes, searchQuery, subjectFilter]);

  const selectedClassOutreachQueue = useMemo(() => {
    if (!selectedClass?.retention) return [];

    return selectedClass.retention.watchlist_students.map((student) => {
      const status =
        student.status === 'never_started'
          ? 'Never started'
          : student.status === 'inactive_14d'
            ? 'Inactive 14d'
            : 'Slipping';
      const move =
        student.status === 'never_started'
          ? 'Send a low-friction first step and invite the student into one easy comeback task.'
          : student.status === 'inactive_14d'
            ? 'Reach out with a short re-entry message and a lighter success target for this week.'
            : 'Use a confidence rebuild move before the next graded checkpoint.';
      const nudge =
        student.status === 'never_started'
          ? `Hi ${student.name}, I noticed you have not really started yet. Let us begin with one short Quizzi activity so getting moving feels easy.`
          : student.status === 'inactive_14d'
            ? `Hi ${student.name}, you have been away from the class flow recently. I prepared a light comeback step so you can re-enter without overload.`
            : `Hi ${student.name}, I can see you are still in the flow, but the recent results suggest a short targeted reset will help you stabilize.`;

      return {
        ...student,
        statusLabel: status,
        move,
        nudge,
      };
    });
  }, [selectedClass]);

  const summaryStats = useMemo(() => {
    const totalStudents = classes.reduce((sum, classItem) => sum + classItem.stats.student_count, 0);
    const liveRooms = classes.reduce((sum, classItem) => sum + classItem.stats.active_session_count, 0);
    const assignedPacks = classes.filter((classItem) => classItem.pack).length;
    const studentsNeedingAttention = classes.reduce(
      (sum, classItem) => sum + Number(classItem.retention?.needs_attention_count || 0),
      0,
    );

    return [
      {
        id: 'classes',
        label: 'Active classes',
        value: classes.length,
        body: 'Live rosters that persist across sessions and reports.',
        tone: 'bg-white',
        icon: <Layers3 className="w-5 h-5" />,
      },
      {
        id: 'students',
        label: 'Students tracked',
        value: totalStudents,
        body: 'Roster members tied to your current class structure.',
        tone: 'bg-brand-yellow',
        icon: <Users className="w-5 h-5" />,
      },
      {
        id: 'packs',
        label: 'Classes with pack',
        value: assignedPacks,
        body: 'Classes that can launch directly into a live session.',
        tone: 'bg-brand-purple text-white',
        icon: <BookOpen className="w-5 h-5" />,
      },
      {
        id: 'retention',
        label: 'Watchlist students',
        value: studentsNeedingAttention,
        body: 'Roster members drifting out of the loop and likely to need a lighter re-entry move.',
        tone: 'bg-rose-100',
        icon: <AlertTriangle className="w-5 h-5" />,
      },
      {
        id: 'live',
        label: 'Open live rooms',
        value: liveRooms,
        body: 'Class sessions you can reopen without creating another room.',
        tone: 'bg-brand-orange text-white',
        icon: <Clock3 className="w-5 h-5" />,
      },
    ];
  }, [classes]);

  const handleSaveClass = async () => {
    const payload = normalizePayload(form);
    if (!payload.name || !payload.subject || !payload.grade) {
      setFeedback({ tone: 'error', message: 'Fill class name, subject, and grade before saving.' });
      return;
    }

    try {
      setBusyKey('save-class');
      const savedClass = form.id
        ? await updateTeacherClass(form.id, payload)
        : await createTeacherClass(payload);
      upsertClass(savedClass);
      openClassEditor(savedClass);
      setFeedback({
        tone: 'success',
        message: form.id ? 'Class updated successfully.' : 'Class created successfully.',
      });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to save class.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteClass = async (classItem: TeacherClassBoard) => {
    if (!window.confirm(`Remove ${classItem.name}? The roster will disappear from this board.`)) {
      return;
    }

    try {
      setBusyKey(`delete-${classItem.id}`);
      await deleteTeacherClass(classItem.id);
      removeClassFromState(classItem.id);
      if (selectedClassId === classItem.id) {
        resetForm();
      }
      setFeedback({ tone: 'success', message: 'Class removed from the active board.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to remove class.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddStudent = async () => {
    if (!selectedClass || !studentName.trim()) return;

    try {
      setBusyKey(`student-add-${selectedClass.id}`);
      const updatedClass = await addTeacherClassStudent(selectedClass.id, studentName.trim());
      upsertClass(updatedClass);
      setStudentName('');
      setFeedback({ tone: 'success', message: 'Student added to class.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to add student.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveStudent = async (classId: number, studentId: number) => {
    try {
      setBusyKey(`student-remove-${studentId}`);
      const updatedClass = await removeTeacherClassStudent(classId, studentId);
      upsertClass(updatedClass);
      setFeedback({ tone: 'success', message: 'Student removed from class.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to remove student.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleHostClass = async (classItem: TeacherClassBoard) => {
    if (classItem.latest_session && String(classItem.latest_session.status || '').toUpperCase() !== 'ENDED') {
      navigate(`/teacher/session/${classItem.latest_session.pin}/host`, {
        state: {
          sessionId: classItem.latest_session.id,
          packId: classItem.pack?.id,
        },
      });
      return;
    }

    if (!classItem.pack?.id) {
      setFeedback({ tone: 'error', message: 'Assign a pack to this class before hosting.' });
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

  const handleDeleteRecentSession = async () => {
    if (!pendingSessionDelete) return;

    try {
      setBusyKey(`session-delete-${pendingSessionDelete.sessionId}`);
      await deleteTeacherSession(pendingSessionDelete.sessionId);
      const refreshed = await listTeacherClasses();
      setClasses(sortClassesByRecent(Array.isArray(refreshed) ? refreshed : []));
      setFeedback({ tone: 'success', message: `Session ${pendingSessionDelete.label} was deleted.` });
      setPendingSessionDelete(null);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to delete session.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopyOutreach = async (studentName: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedOutreachKey(studentName);
      setFeedback({ tone: 'success', message: `Copied outreach note for ${studentName}.` });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.message || 'Failed to copy outreach note.' });
    }
  };

  const handleViewReport = (classItem: TeacherClassBoard) => {
    if (!classItem.latest_completed_session?.id) {
      setFeedback({ tone: 'error', message: 'This class does not have a report yet. Run a live session first.' });
      return;
    }
    navigate(`/teacher/analytics/class/${classItem.latest_completed_session.id}`);
  };

  const handleBuildRematch = async (classItem: TeacherClassBoard) => {
    if (!classItem.latest_completed_session?.id) {
      setFeedback({ tone: 'error', message: 'Run a class session first so Quizzi can build a rematch pack from real results.' });
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
        <div className="max-w-[1360px] mx-auto">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">{copy.title}</h1>
              <p className="text-brand-dark/60 font-bold mt-2 max-w-3xl">
                {copy.subtitle}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void bootstrapPage()}
                className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                {copy.refresh}
              </button>
              <button
                onClick={openNewClassBuilder}
                className="px-6 py-3 bg-brand-yellow text-brand-dark border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-yellow-300 transition-colors font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <Plus className="w-5 h-5" />
                {copy.newClass}
              </button>
            </div>
          </div>

          {feedback && (
            <div
              className={`mb-6 border-2 border-brand-dark rounded-2xl p-4 shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-3 ${
                feedback.tone === 'success' ? 'bg-white' : 'bg-rose-100'
              }`}
            >
              <CheckCircle2 className={`w-5 h-5 ${feedback.tone === 'success' ? 'text-emerald-500' : 'text-rose-600'}`} />
              <span className="font-bold">{feedback.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
            {summaryStats.map((stat) => (
              <div
                key={stat.id}
                className={`${stat.tone} border-2 border-brand-dark rounded-[1.8rem] p-5 shadow-[4px_4px_0px_0px_#1A1A1A]`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs uppercase tracking-[0.2em] font-black opacity-70">{stat.label}</span>
                  {stat.icon}
                </div>
                <div className="text-3xl font-black mb-2">{stat.value}</div>
                <p className="font-bold opacity-80 text-sm">{stat.body}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-8">
            <section>
              <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-5 shadow-[4px_4px_0px_0px_#1A1A1A] mb-6 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-full py-3 pl-12 pr-4 font-bold focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
                <select
                  value={subjectFilter}
                  onChange={(event) => setSubjectFilter(event.target.value)}
                  className="bg-brand-bg border-2 border-brand-dark rounded-full py-3 px-4 font-bold focus:outline-none"
                >
                  {subjects.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 shadow-[4px_4px_0px_0px_#1A1A1A] flex items-center justify-center gap-3 font-black">
                  <LoaderCircle className="w-5 h-5 animate-spin" />
                  {copy.loading}
                </div>
              ) : loadError && filteredClasses.length === 0 ? (
                <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
                  <p className="text-2xl font-black mb-2">{copy.loadFailedTitle}</p>
                  <p className="font-bold text-brand-dark/60 mb-6">{loadError}</p>
                  <button
                    onClick={() => void bootstrapPage()}
                    className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    {copy.retry}
                  </button>
                </div>
              ) : filteredClasses.length === 0 ? (
                <div className="bg-white border-2 border-brand-dark rounded-[2rem] p-10 shadow-[4px_4px_0px_0px_#1A1A1A] text-center">
                  <p className="text-2xl font-black mb-2">{copy.emptyTitle}</p>
                  <p className="font-bold text-brand-dark/60 mb-6">
                    {copy.emptyBody}
                  </p>
                  <button
                    onClick={openNewClassBuilder}
                    className="px-6 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    {copy.createFirst}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredClasses.map((classItem) => (
                    <ClassCard
                      key={classItem.id}
                      classItem={classItem}
                      isBusy={
                        busyKey === `delete-${classItem.id}`
                        || busyKey === `host-${classItem.id}`
                        || busyKey === `rematch-${classItem.id}`
                      }
                      onEdit={() => openClassEditor(classItem)}
                      onDelete={() => void handleDeleteClass(classItem)}
                      onHost={() => void handleHostClass(classItem)}
                      onViewReport={() => handleViewReport(classItem)}
                      onRematch={() => void handleBuildRematch(classItem)}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="bg-white border-2 border-brand-dark rounded-[2rem] p-6 shadow-[4px_4px_0px_0px_#1A1A1A] h-fit sticky top-6">
              <div className="flex items-center gap-3 mb-6">
                <ClipboardList className="w-6 h-6 text-brand-purple" />
                <div>
                  <h2 className="text-2xl font-black">{form.id ? copy.editTitle : selectedClassId === 'new' ? copy.createTitle : copy.builderTitle}</h2>
                  <p className="font-bold text-sm text-brand-dark/50">
                    {copy.builderBody}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <Field label={copy.className} value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                <Field label={copy.subject} value={form.subject} onChange={(value) => setForm((current) => ({ ...current, subject: value }))} />
                <Field label={copy.grade} value={form.grade} onChange={(value) => setForm((current) => ({ ...current, grade: value }))} />

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{copy.assignedPack}</label>
                  <select
                    value={form.packId}
                    onChange={(event) => setForm((current) => ({ ...current, packId: event.target.value }))}
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold"
                  >
                    <option value="">{copy.noPack}</option>
                    {packs.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.title}
                      </option>
                    ))}
                  </select>
                  {packs.length === 0 && (
                    <p className="text-xs font-bold text-brand-dark/50 mt-2">
                      {copy.createPackFirst}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{copy.color}</label>
                  <div className="flex gap-2 flex-wrap">
                    {TEACHER_CLASS_COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, color }))}
                        className={`w-10 h-10 rounded-xl border-2 border-brand-dark ${color} ${
                          form.color === color ? 'ring-4 ring-brand-orange/30' : ''
                        }`}
                        aria-label={`Pick ${color}`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{copy.notes}</label>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold min-h-28"
                    placeholder={copy.notesPlaceholder}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => void handleSaveClass()}
                  disabled={busyKey === 'save-class'}
                  className="flex-1 bg-brand-orange text-white border-2 border-brand-dark rounded-xl py-3 font-black shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
                >
                  {busyKey === 'save-class' ? copy.saving : form.id ? copy.updateClass : copy.createClass}
                </button>
                <button onClick={resetForm} className="px-4 border-2 border-brand-dark rounded-xl font-black bg-white">
                  {copy.reset}
                </button>
              </div>

              {selectedClass && (
                <>
                  <div className="mt-8 pt-6 border-t-2 border-brand-dark/10">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-lg font-black">Roster</h3>
                        <p className="text-sm font-bold text-brand-dark/50">
                          Students persist for this class and stay attached to its report history.
                        </p>
                      </div>
                      <span className="px-3 py-2 rounded-full bg-brand-bg border-2 border-brand-dark text-xs font-black">
                        {selectedClass.stats.student_count} students
                      </span>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <input
                        value={studentName}
                        onChange={(event) => setStudentName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleAddStudent();
                          }
                        }}
                        placeholder="Add student name"
                        className="flex-1 bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold"
                      />
                      <button
                        onClick={() => void handleAddStudent()}
                        disabled={busyKey === `student-add-${selectedClass.id}`}
                        className="px-4 bg-brand-yellow border-2 border-brand-dark rounded-xl font-black disabled:opacity-60"
                      >
                        Add
                      </button>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {selectedClass.students.map((student) => (
                        <div
                          key={student.id}
                          className="flex items-center justify-between bg-brand-bg rounded-xl border-2 border-brand-dark/10 px-3 py-2"
                        >
                          <div>
                            <span className="font-bold">{student.name}</span>
                            <p className="text-xs font-bold text-brand-dark/45">Joined {formatRelativeTime(student.joined_at)}</p>
                          </div>
                          <button
                            onClick={() => void handleRemoveStudent(selectedClass.id, student.id)}
                            disabled={busyKey === `student-remove-${student.id}`}
                            className="text-brand-orange disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {selectedClass.students.length === 0 && (
                        <p className="text-sm font-bold text-brand-dark/50">No students added yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t-2 border-brand-dark/10">
                    <div className="rounded-[1.5rem] border-2 border-brand-dark/10 bg-brand-bg p-4 mb-5">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <h3 className="text-lg font-black">Retention Snapshot</h3>
                          <p className="text-sm font-bold text-brand-dark/50">{selectedClass.retention.headline}</p>
                        </div>
                        <span className={`px-3 py-2 rounded-full border-2 border-brand-dark text-xs font-black ${retentionLevelTone(selectedClass.retention.level)}`}>
                          {selectedClass.retention.level.toUpperCase()} RISK
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-3 text-xs font-black uppercase tracking-[0.14em]">
                        <span className="px-3 py-2 rounded-full border border-brand-dark/15 bg-white">
                          {selectedClass.retention.active_last_7d} active 7d
                        </span>
                        <span className="px-3 py-2 rounded-full border border-brand-dark/15 bg-white">
                          {selectedClass.retention.slipping} slipping
                        </span>
                        <span className="px-3 py-2 rounded-full border border-brand-dark/15 bg-white">
                          {selectedClass.retention.inactive_14d} inactive 14d
                        </span>
                        <span className="px-3 py-2 rounded-full border border-brand-dark/15 bg-white">
                          {selectedClass.retention.never_started} never started
                        </span>
                      </div>

                      <p className="text-sm font-bold text-brand-dark/65">{selectedClass.retention.body}</p>

                      {selectedClass.retention.watchlist_students.length > 0 && (
                        <div className="space-y-2 mt-4">
                          {selectedClass.retention.watchlist_students.map((student) => (
                            <div key={`${selectedClass.id}-${student.name}`} className="rounded-xl border border-brand-dark/10 bg-white px-3 py-3">
                              <div className="flex items-center justify-between gap-3 mb-1">
                                <span className="font-black">{student.name}</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">
                                  {student.status.replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-sm font-bold text-brand-dark/60">{student.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4 mb-5">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="w-5 h-5 text-brand-orange" />
                        <div>
                          <h3 className="text-lg font-black">Dropout Risk Radar</h3>
                          <p className="text-sm font-bold text-brand-dark/50">
                            Copy a ready-made nudge or open the latest report before students drift further.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {selectedClassOutreachQueue.length > 0 ? (
                          selectedClassOutreachQueue.map((student) => (
                            <div key={`${selectedClass.id}-outreach-${student.name}`} className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg p-4">
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div>
                                  <p className="font-black">{student.name}</p>
                                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">
                                    {student.statusLabel}
                                  </p>
                                </div>
                                <span className={`px-3 py-1 rounded-full border-2 border-brand-dark text-[10px] font-black uppercase tracking-[0.18em] ${retentionStatusTone(student.status)}`}>
                                  {student.statusLabel}
                                </span>
                              </div>
                              <p className="text-sm font-bold text-brand-dark/65">{student.reason}</p>
                              <p className="text-sm font-black text-brand-dark mt-3">{student.move}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  onClick={() => void handleCopyOutreach(student.name, student.nudge)}
                                  className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                                >
                                  {copiedOutreachKey === student.name ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  {copiedOutreachKey === student.name ? 'Copied' : 'Copy nudge'}
                                </button>
                                {selectedClass.latest_completed_session && (
                                  <button
                                    onClick={() => navigate(`/teacher/analytics/class/${selectedClass.latest_completed_session?.id}`)}
                                    className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
                                  >
                                    Open latest report
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm font-bold text-brand-dark/50">
                            This class does not have a current watchlist. Outreach suggestions will appear here once drift signals accumulate.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <GraduationCap className="w-5 h-5 text-brand-purple" />
                      <h3 className="text-lg font-black">Recent Sessions</h3>
                    </div>

                    <div className="space-y-3">
                      {selectedClass.recent_sessions.map((session) => (
                        <div
                          key={session.id}
                          className="w-full text-left bg-brand-bg rounded-2xl border-2 border-brand-dark/10 p-4 hover:border-brand-dark transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <span className="font-black">Session #{session.id}</span>
                              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mt-1">
                                {session.status}
                              </p>
                            </div>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingSessionDelete({
                                  sessionId: session.id,
                                  classId: selectedClass.id,
                                  label: `#${session.id}`,
                                });
                              }}
                              disabled={busyKey === `session-delete-${session.id}`}
                              className="inline-flex items-center justify-center rounded-full border-2 border-brand-dark bg-white p-2 text-brand-dark/55 transition-colors hover:text-brand-orange disabled:opacity-50"
                              title="Delete session"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-sm font-bold text-brand-dark/70">
                            <span>{session.participant_count} players</span>
                            <span>{formatAccuracy(session.accuracy_rate)}</span>
                          </div>
                          <p className="text-xs font-bold text-brand-dark/45 mt-2">
                            {formatRelativeTime(session.ended_at || session.started_at)}
                          </p>
                          <button
                            onClick={() => navigate(`/teacher/analytics/class/${session.id}`)}
                            className="mt-3 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
                          >
                            Open analytics
                          </button>
                        </div>
                      ))}
                      {selectedClass.recent_sessions.length === 0 && (
                        <p className="text-sm font-bold text-brand-dark/50">
                          No live sessions yet. Assign a pack and launch the first class run.
                        </p>
                      )}
                    </div>

                    {pendingSessionDelete?.classId === selectedClass.id && (
                      <div className="mt-4 rounded-[1.4rem] border-2 border-brand-dark bg-white p-4 shadow-[3px_3px_0px_0px_#1A1A1A]">
                        <p className="font-black">Delete session {pendingSessionDelete.label}?</p>
                        <p className="text-sm font-bold text-brand-dark/60 mt-2">
                          This will permanently remove the session, its answers, participants, and behavior logs from the database.
                        </p>
                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() => void handleDeleteRecentSession()}
                            disabled={busyKey === `session-delete-${pendingSessionDelete.sessionId}`}
                            className="rounded-full border-2 border-brand-dark bg-brand-orange px-4 py-2 font-black text-white disabled:opacity-60"
                          >
                            {busyKey === `session-delete-${pendingSessionDelete.sessionId}` ? 'Deleting...' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => setPendingSessionDelete(null)}
                            disabled={busyKey === `session-delete-${pendingSessionDelete.sessionId}`}
                            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 font-black"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!selectedClass && selectedClassId !== 'new' && (
                <div className="mt-8 pt-6 border-t-2 border-brand-dark/10">
                  <div className="bg-brand-bg rounded-[1.5rem] border-2 border-brand-dark/10 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <UserPlus className="w-5 h-5 text-brand-orange" />
                      <span className="font-black">How this board works</span>
                    </div>
                    <p className="font-bold text-sm text-brand-dark/65">
                      Create a class, add its roster, assign one of your quiz packs, and every class-launched live session will start building report history here automatically.
                    </p>
                  </div>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-2">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-brand-bg border-2 border-brand-dark rounded-xl p-3 font-bold"
      />
    </div>
  );
}

function ClassCard({
  classItem,
  isBusy,
  onEdit,
  onDelete,
  onHost,
  onViewReport,
  onRematch,
}: {
  key?: React.Key;
  classItem: TeacherClassBoard;
  isBusy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onHost: () => void;
  onViewReport: () => void;
  onRematch: () => void;
}) {
  const isLight = classItem.color === 'bg-white' || classItem.color === 'bg-brand-yellow';
  const textColor = isLight ? 'text-brand-dark' : 'text-white';
  const secondaryText = isLight ? 'text-brand-dark/70' : 'text-white/75';
  const panelTone = isLight ? 'bg-white/50' : 'bg-white/10';
  const buttonTone = isLight ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark';
  const hasReport = Boolean(classItem.latest_completed_session?.id);
  const hasOpenLiveRoom = Boolean(
    classItem.latest_session && String(classItem.latest_session.status || '').toUpperCase() !== 'ENDED',
  );
  const hasAssignedPack = Boolean(classItem.pack?.id);
  const sessionState =
    hasOpenLiveRoom
      ? 'Live room open'
      : classItem.latest_completed_session
        ? `Last run ${formatRelativeTime(classItem.latest_completed_session.ended_at || classItem.latest_completed_session.started_at)}`
        : 'No live run yet';
  const retention = classItem.retention;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`${classItem.color} ${textColor} rounded-[2rem] p-6 border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] flex flex-col gap-4`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black">{classItem.name}</h3>
          <p className={`font-bold ${secondaryText}`}>{classItem.subject} · {classItem.grade}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="px-3 py-2 rounded-full border-2 border-current/20 font-black text-xs">
            Manage
          </button>
          <button onClick={onDelete} disabled={isBusy} className="p-2 rounded-full border-2 border-current/20 disabled:opacity-50">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className={`space-y-3 ${panelTone} rounded-2xl p-4 border border-current/10`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">Roster</span>
          <span className="font-black">{classItem.stats.student_count} students</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">Assigned Pack</span>
          <span className="font-black text-right line-clamp-1 max-w-[190px]">
            {classItem.pack?.title || 'No pack assigned'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">Report Status</span>
          <span className="font-black text-right line-clamp-1 max-w-[190px]">{sessionState}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.16em]">
        <span className="px-3 py-2 rounded-full border border-current/20">
          {classItem.stats.session_count} total runs
        </span>
        <span className="px-3 py-2 rounded-full border border-current/20">
          {formatAccuracy(classItem.stats.average_accuracy)}
        </span>
      </div>

      <div className={`space-y-3 ${panelTone} rounded-2xl p-4 border border-current/10`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">Retention Radar</span>
          <span className={`px-3 py-2 rounded-full border-2 border-brand-dark text-[10px] font-black uppercase tracking-[0.18em] ${retentionLevelTone(retention.level)}`}>
            {retention.level} risk
          </span>
        </div>
        <p className="text-sm font-black">{retention.headline}</p>
        <p className={`text-sm font-bold ${secondaryText}`}>{retention.body}</p>

        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.14em]">
          <span className="px-3 py-2 rounded-full border border-current/20">
            {retention.active_last_7d} active 7d
          </span>
          <span className="px-3 py-2 rounded-full border border-current/20">
            {retention.slipping} slipping
          </span>
          <span className="px-3 py-2 rounded-full border border-current/20">
            {retention.inactive_14d} inactive
          </span>
          <span className="px-3 py-2 rounded-full border border-current/20">
            {retention.never_started} not started
          </span>
        </div>

        {retention.watchlist_students.length > 0 && (
          <div className="space-y-2">
            {retention.watchlist_students.slice(0, 2).map((student) => (
              <div key={`${classItem.id}-${student.name}`} className="rounded-xl border border-current/15 bg-white/70 px-3 py-3 text-brand-dark">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="font-black">{student.name}</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-dark/50">
                    {student.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm font-bold text-brand-dark/65">{student.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className={`font-bold text-sm min-h-10 ${secondaryText}`}>
        {classItem.notes || 'No notes yet.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-auto">
        <button
          onClick={onViewReport}
          disabled={!hasReport || isBusy}
          className={`py-3 rounded-xl font-bold text-sm border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-50 ${buttonTone}`}
        >
          Latest Report
        </button>
        <button
          onClick={onHost}
          disabled={!hasAssignedPack || isBusy}
          className={`py-3 rounded-xl font-bold text-sm border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-50 ${
            isLight ? 'bg-brand-yellow text-brand-dark' : 'bg-brand-orange text-white'
          }`}
        >
          {hasOpenLiveRoom ? 'Open Live Room' : 'Host Class'}
        </button>
        <button
          onClick={onRematch}
          disabled={!hasReport || isBusy}
          className={`sm:col-span-2 py-3 rounded-xl font-bold text-sm border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-50 ${
            isLight ? 'bg-brand-yellow text-brand-dark' : 'bg-white text-brand-dark'
          }`}
        >
          Build Rematch Pack
        </button>
      </div>
    </motion.div>
  );
}

function retentionLevelTone(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'bg-rose-100 text-rose-700';
  if (level === 'medium') return 'bg-brand-yellow text-brand-dark';
  return 'bg-emerald-100 text-emerald-800';
}

function retentionStatusTone(status: 'never_started' | 'inactive_14d' | 'slipping') {
  if (status === 'never_started') return 'bg-rose-100 text-rose-700';
  if (status === 'inactive_14d') return 'bg-brand-orange/15 text-brand-dark';
  return 'bg-brand-yellow text-brand-dark';
}
