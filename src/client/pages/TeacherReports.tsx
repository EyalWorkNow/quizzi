import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpLeft,
  ArrowUpRight,
  BrainCircuit,
  Download,
  RefreshCw,
  Trash2,
  AlertTriangle,
  FileSpreadsheet,
  Clock3,
  Gauge,
  TrendingUp,
  TrendingDown,
  Users,
} from 'lucide-react';
import TeacherSidebar from '../components/TeacherSidebar.tsx';
import { apiFetchJson } from '../lib/api.ts';
import { useTeacherLanguage } from '../lib/teacherLanguage.ts';
import { listTeacherClasses, type TeacherClassCard } from '../lib/teacherClasses.ts';

const REPORTS_COPY = {
  en: {
    title: 'Reports',
    subtitle: 'Deterministic summaries built from answers, timing, and behavior telemetry across your live sessions.',
    refresh: 'Refresh',
    loading: 'Loading live reports...',
    retry: 'Try Again',
    loadFailedTitle: 'Reports did not load cleanly.',
    loadFailedBody: 'We could not reach your report data right now. Try again in a moment.',
    insightLabel: 'Engine Insight',
    sessionsTitle: 'Recent Sessions',
    sessionsSubtitle: 'Each row is derived from stored answers, timings, and focus events.',
    noSessions: 'No completed sessions yet.',
    view: 'View',
    delete: 'Delete',
    confirmDeleteTitle: 'Delete this session?',
    confirmDeleteBody: 'This will permanently remove all answers, participants, and behavior logs for this session. This cannot be undone.',
    confirmDeleteAction: 'Yes, delete',
    cancelAction: 'Cancel',
    deleteError: 'Failed to delete session. Try again.',
    stats: {
      players: { title: 'Total Players', caption: 'Across hosted sessions' },
      accuracy: { title: 'Avg Accuracy', caption: 'Across tracked answers' },
      quizzes: { title: 'Quizzes Hosted', caption: 'Sessions with activity' },
      stress: { title: 'Avg Stress', caption: 'Behavior pressure index' },
    },
    table: {
      quizName: 'Quiz Name',
      date: 'Date',
      players: 'Players',
      accuracy: 'Accuracy',
      stress: 'Stress',
      action: 'Action',
    },
    timelineTitle: 'Class Timeline',
    timelineSubtitle: 'Read the sequence of your recent runs, not just the last one.',
    exportTitle: 'Gradebook Export Center',
    exportSubtitle: 'Download a clean LMS-ready gradebook for any completed session.',
    exportSessionLabel: 'Session',
    exportProviderLabel: 'Format',
    exportButton: 'Download gradebook',
    exportReady: 'Gradebook ready',
    exportNotes: 'Import notes',
    timelineRisk: 'Needs reteach',
    timelineWatch: 'Watch closely',
    timelineStrong: 'Strong run',
    exportError: 'Failed to export the gradebook. Try again.',
  },
  he: {
    title: 'דוחות',
    subtitle: 'סיכומים דטרמיניסטיים המבוססים על תשובות, תזמון וטלמטריית התנהגות מכל הסשנים החיים שלך.',
    refresh: 'רענון',
    loading: 'טוען דוחות חיים...',
    retry: 'נסה שוב',
    loadFailedTitle: 'הדוחות לא נטענו כראוי.',
    loadFailedBody: 'לא הצלחנו להגיע לנתוני הדוחות כרגע. נסה שוב בעוד רגע.',
    insightLabel: 'תובנת מנוע',
    sessionsTitle: 'סשנים אחרונים',
    sessionsSubtitle: 'כל שורה נגזרת מתשובות שמורות, זמני תגובה ואירועי פוקוס.',
    noSessions: 'עדיין אין סשנים שהושלמו.',
    view: 'לצפייה',
    delete: 'מחיקה',
    confirmDeleteTitle: 'למחוק את הסשן הזה?',
    confirmDeleteBody: 'פעולה זו תמחק לצמיתות את כל התשובות, המשתתפים ויומני ההתנהגות של הסשן הזה. לא ניתן לבטל.',
    confirmDeleteAction: 'כן, מחק',
    cancelAction: 'ביטול',
    deleteError: 'מחיקת הסשן נכשלה. נסה שוב.',
    stats: {
      players: { title: 'סך שחקנים', caption: 'בכלל הסשנים שהורצו' },
      accuracy: { title: 'דיוק ממוצע', caption: 'על פני כל התשובות שנמדדו' },
      quizzes: { title: 'חידונים שהורצו', caption: 'סשנים עם פעילות' },
      stress: { title: 'לחץ ממוצע', caption: 'מדד עומס התנהגותי' },
    },
    table: {
      quizName: 'שם החידון',
      date: 'תאריך',
      players: 'שחקנים',
      accuracy: 'דיוק',
      stress: 'לחץ',
      action: 'פעולה',
    },
    timelineTitle: 'ציר זמן כיתתי',
    timelineSubtitle: 'קריאת רצף הסשנים האחרונים, לא רק הסשן האחרון.',
    exportTitle: 'מרכז ייצוא לציונים',
    exportSubtitle: 'הורד קובץ ציונים נקי ומוכן ל־LMS לכל סשן שהושלם.',
    exportSessionLabel: 'סשן',
    exportProviderLabel: 'פורמט',
    exportButton: 'הורד גיליון ציונים',
    exportReady: 'קובץ הציונים מוכן',
    exportNotes: 'הערות לייבוא',
    timelineRisk: 'דורש הוראה מחדש',
    timelineWatch: 'דורש מעקב',
    timelineStrong: 'ריצה חזקה',
    exportError: 'ייצוא גיליון הציונים נכשל. נסה שוב.',
  },
  ar: {
    title: 'التقارير',
    subtitle: 'ملخصات حتمية مبنية على الإجابات والتوقيت وقياسات السلوك عبر الجلسات الحية.',
    refresh: 'تحديث',
    loading: 'جار تحميل التقارير الحية...',
    retry: 'حاول مرة أخرى',
    loadFailedTitle: 'لم يتم تحميل التقارير بشكل سليم.',
    loadFailedBody: 'تعذر الوصول إلى بيانات التقارير الآن. حاول مرة أخرى بعد قليل.',
    insightLabel: 'رؤية المحرك',
    sessionsTitle: 'الجلسات الأخيرة',
    sessionsSubtitle: 'كل صف مشتق من الإجابات المخزنة وأزمنة الاستجابة وأحداث التركيز.',
    noSessions: 'لا توجد جلسات مكتملة بعد.',
    view: 'عرض',
    delete: 'حذف',
    confirmDeleteTitle: 'حذف هذه الجلسة؟',
    confirmDeleteBody: 'سيؤدي هذا إلى حذف جميع الإجابات والمشاركين وسجلات السلوك لهذه الجلسة نهائيًا. لا يمكن التراجع.',
    confirmDeleteAction: 'نعم، احذف',
    cancelAction: 'إلغاء',
    deleteError: 'فشل حذف الجلسة. حاول مرة أخرى.',
    stats: {
      players: { title: 'إجمالي اللاعبين', caption: 'عبر الجلسات المستضافة' },
      accuracy: { title: 'متوسط الدقة', caption: 'عبر الإجابات المتعقبة' },
      quizzes: { title: 'الاختبارات المستضافة', caption: 'جلسات فيها نشاط' },
      stress: { title: 'متوسط الضغط', caption: 'مؤشر الضغط السلوكي' },
    },
    table: {
      quizName: 'اسم الاختبار',
      date: 'التاريخ',
      players: 'اللاعبون',
      accuracy: 'الدقة',
      stress: 'الضغط',
      action: 'إجراء',
    },
    timelineTitle: 'الخط الزمني للفصل',
    timelineSubtitle: 'اقرأ تسلسل الجلسات الأخيرة، وليس آخر جلسة فقط.',
    exportTitle: 'مركز تصدير الدرجات',
    exportSubtitle: 'نزّل ملف درجات جاهز للـ LMS لأي جلسة مكتملة.',
    exportSessionLabel: 'الجلسة',
    exportProviderLabel: 'الصيغة',
    exportButton: 'تنزيل ملف الدرجات',
    exportReady: 'ملف الدرجات جاهز',
    exportNotes: 'ملاحظات الاستيراد',
    timelineRisk: 'يحتاج إعادة شرح',
    timelineWatch: 'يحتاج متابعة',
    timelineStrong: 'جلسة قوية',
    exportError: 'فشل تصدير ملف الدرجات. حاول مرة أخرى.',
  },
} as const;

const LMS_PROVIDER_OPTIONS = [
  {
    id: 'generic_csv',
    label: { en: 'Generic CSV', he: 'CSV כללי', ar: 'CSV عام' },
    hint: {
      en: 'Best when you want the richest raw sheet for manual LMS mapping.',
      he: 'הכי טוב כשצריך גיליון עשיר למיפוי ידני ל־LMS.',
      ar: 'الأفضل عندما تحتاج ملفًا غنيًا للربط اليدوي مع نظام إدارة التعلم.',
    },
  },
  {
    id: 'canvas',
    label: { en: 'Canvas', he: 'Canvas', ar: 'Canvas' },
    hint: {
      en: 'Canvas-shaped columns for lecturer import workflows.',
      he: 'עמודות תואמות Canvas לזרימת ייבוא מרצה.',
      ar: 'أعمدة مهيأة لتدفقات الاستيراد في Canvas.',
    },
  },
  {
    id: 'moodle',
    label: { en: 'Moodle', he: 'Moodle', ar: 'Moodle' },
    hint: {
      en: 'Moodle-friendly grade and feedback columns.',
      he: 'עמודות ציונים ומשוב מותאמות Moodle.',
      ar: 'أعمدة درجات وملاحظات ملائمة لـ Moodle.',
    },
  },
  {
    id: 'blackboard',
    label: { en: 'Blackboard', he: 'Blackboard', ar: 'Blackboard' },
    hint: {
      en: 'Grade Center style CSV for Blackboard workflows.',
      he: 'CSV בסגנון Grade Center ל־Blackboard.',
      ar: 'ملف CSV بأسلوب Grade Center لـ Blackboard.',
    },
  },
] as const;

function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getTimelineTone(row: any) {
  const accuracy = Number(row?.avg_accuracy || 0);
  const stress = Number(row?.stress_index || 0);
  if (accuracy >= 80 && stress < 35) return 'strong';
  if (accuracy < 60 || stress >= 55) return 'risk';
  return 'watch';
}

function formatReportDate(value: unknown, language: 'en' | 'he' | 'ar') {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) {
    if (language === 'he') return 'לאחרונה';
    if (language === 'ar') return 'مؤخرًا';
    return 'Recently';
  }

  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function translateReportHeadline(headline: string, language: 'en' | 'he' | 'ar') {
  if (language === 'en') return headline;

  const normalized = String(headline || '').trim();
  const translations: Record<string, { he: string; ar: string }> = {
    'Open this report to inspect the response patterns in detail.': {
      he: 'פתחו את הדוח כדי לבדוק לעומק את דפוסי התגובה בסשן הזה.',
      ar: 'افتح هذا التقرير لفحص أنماط الاستجابة في هذه الجلسة بالتفصيل.',
    },
    'The room opened, but no student answers were captured yet.': {
      he: 'החדר נפתח, אבל עדיין לא נשמרו תשובות של תלמידים.',
      ar: 'تم فتح الغرفة، لكن لم يتم التقاط إجابات الطلاب بعد.',
    },
    'Students moved through this session with strong accuracy and low pressure.': {
      he: 'התלמידים עברו את הסשן הזה עם דיוק גבוה ולחץ נמוך.',
      ar: 'مرّ الطلاب بهذه الجلسة بدقة عالية وضغط منخفض.',
    },
    'Most students stayed on track, with a few hesitation signals worth reviewing.': {
      he: 'רוב התלמידים נשארו במסלול, עם כמה סימני היסוס שכדאי לבדוק.',
      ar: 'بقي معظم الطلاب على المسار، مع بعض إشارات التردد التي تستحق المراجعة.',
    },
    'This session needs a guided recap before the next checkpoint.': {
      he: 'הסשן הזה צריך חזרה מונחית לפני נקודת הבדיקה הבאה.',
      ar: 'هذه الجلسة تحتاج إلى مراجعة موجهة قبل نقطة التحقق التالية.',
    },
  };

  return translations[normalized]?.[language] || normalized;
}

function translateReportInsight(insight: { title: string; body: string }, language: 'en' | 'he' | 'ar') {
  if (language === 'en') return insight;

  const title = String(insight?.title || '').trim();
  const body = String(insight?.body || '').trim();

  const translatedTitle = {
    'Most challenging session': { he: 'הסשן המאתגר ביותר', ar: 'أكثر جلسة تحديًا' },
    'Highest pressure session': { he: 'הסשן עם הלחץ הגבוה ביותר', ar: 'الجلسة ذات الضغط الأعلى' },
    'No major risk detected': { he: 'לא זוהה סיכון משמעותי', ar: 'لم يتم رصد خطر كبير' },
  }[title]?.[language] || title;

  let translatedBody = body;

  const hardestMatch = body.match(/^(.*) settled at ([\d.]+)% accuracy\. That session is the best candidate for a guided rematch\.$/);
  if (hardestMatch) {
    const [, quizName, accuracy] = hardestMatch;
    translatedBody =
      language === 'he'
        ? `${quizName} התייצב על ${accuracy}% דיוק. זה הסשן הכי מתאים למשחק חזרה מונחה.`
        : `${quizName} استقر عند ${accuracy}% دقة. هذه هي الجلسة الأنسب لإعادة مواجهة موجهة.`;
  }

  const pressureMatch = body.match(/^(.*) showed the strongest pressure signals \(([\d.]+)%\)\. Review pacing, distractors, and timer pressure there first\.$/);
  if (pressureMatch) {
    const [, quizName, pressure] = pressureMatch;
    translatedBody =
      language === 'he'
        ? `${quizName} הראה את אותות הלחץ החזקים ביותר (${pressure}%). כדאי לבדוק שם קודם את הקצב, המסיחים ולחץ הטיימר.`
        : `${quizName} أظهر أقوى إشارات الضغط (${pressure}%). راجع هناك أولًا الوتيرة والمشتتات وضغط المؤقت.`;
  }

  if (body === 'Recent sessions look stable. Keep the same pacing and follow up with a short practice task between live games.') {
    translatedBody =
      language === 'he'
        ? 'הסשנים האחרונים נראים יציבים. שמרו על אותו קצב והמשיכו עם משימת תרגול קצרה בין המשחקים החיים.'
        : 'تبدو الجلسات الأخيرة مستقرة. حافظ على الوتيرة نفسها وأضف مهمة تدريب قصيرة بين الألعاب المباشرة.';
  }

  return {
    title: translatedTitle,
    body: translatedBody,
  };
}

export default function TeacherReports() {
  const navigate = useNavigate();
  const { language, direction } = useTeacherLanguage();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Delete state
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [selectedExportSessionId, setSelectedExportSessionId] = useState<number | ''>('');
  const [selectedExportProviderId, setSelectedExportProviderId] = useState('generic_csv');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [lastExportMeta, setLastExportMeta] = useState<null | { filename: string; providerLabel: string; notes: string[] }>(null);

  // Student Account Coverage states
  const [classes, setClasses] = useState<TeacherClassCard[]>([]);
  const [classOverviewError, setClassOverviewError] = useState('');
  const [hasLoadedClassOverview, setHasLoadedClassOverview] = useState(false);

  const copy = REPORTS_COPY[language as keyof typeof REPORTS_COPY] || REPORTS_COPY.en;
  const isRtl = direction === 'rtl';
  const reportLanguage = (language === 'he' || language === 'ar' ? language : 'en') as 'en' | 'he' | 'ar';

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson('/api/dashboard/teacher/overview');
      setReport(payload);
    } catch (loadError: any) {
      console.error('Failed to load teacher overview:', loadError);
      setError(loadError?.message || copy.loadFailedBody);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailedBody]);

  const loadClassOverview = useCallback(async () => {
    try {
      setClassOverviewError('');
      const payload = await listTeacherClasses();
      setClasses(Array.isArray(payload) ? payload : []);
      setHasLoadedClassOverview(true);
    } catch (loadError: any) {
      setClassOverviewError(loadError?.message || (language === 'he' ? 'טעינת הכיתות נכשלה.' : 'Failed to load classes.'));
      setHasLoadedClassOverview(true);
    }
  }, [language]);

  useEffect(() => {
    void loadReport();
    void loadClassOverview();
  }, [loadReport, loadClassOverview]);

  useEffect(() => {
    const recentSessions = Array.isArray(report?.recent_sessions) ? report.recent_sessions : [];
    if (!recentSessions.length) {
      setSelectedExportSessionId('');
      return;
    }
    if (selectedExportSessionId && recentSessions.some((row: any) => Number(row.session_id) === Number(selectedExportSessionId))) {
      return;
    }
    setSelectedExportSessionId(Number(recentSessions[0].session_id));
  }, [report, selectedExportSessionId]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteId) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await apiFetchJson(`/api/teacher/sessions/${pendingDeleteId}`, { method: 'DELETE' });
      // Optimistically remove from local state
      setReport((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          recent_sessions: (prev.recent_sessions || []).filter(
            (row: any) => Number(row.session_id) !== pendingDeleteId,
          ),
          summary: prev.summary
            ? { ...prev.summary, quizzes_hosted: Math.max(0, (prev.summary.quizzes_hosted || 1) - 1) }
            : prev.summary,
        };
      });
      setPendingDeleteId(null);
      setPendingDeleteName('');
    } catch (deleteErr: any) {
      console.error('[TeacherReports] Delete session failed:', deleteErr);
      setDeleteError(deleteErr?.message || copy.deleteError);
    } finally {
      setIsDeleting(false);
    }
  }, [pendingDeleteId, copy.deleteError]);

  const stats = useMemo(
    () => [
      {
        id: 'players',
        title: copy.stats.players.title,
        value: report?.summary?.total_players || 0,
        caption: copy.stats.players.caption,
        color: 'bg-brand-yellow',
      },
      {
        id: 'accuracy',
        title: copy.stats.accuracy.title,
        value: `${(report?.summary?.avg_accuracy || 0).toFixed(1)}%`,
        caption: copy.stats.accuracy.caption,
        color: 'bg-brand-orange',
      },
      {
        id: 'quizzes',
        title: copy.stats.quizzes.title,
        value: report?.summary?.quizzes_hosted || 0,
        caption: copy.stats.quizzes.caption,
        color: 'bg-brand-purple',
        textColor: 'text-white',
      },
      {
        id: 'stress',
        title: copy.stats.stress.title,
        value: `${(report?.summary?.avg_stress || 0).toFixed(0)}%`,
        caption: copy.stats.stress.caption,
        color: 'bg-brand-dark',
        textColor: 'text-white',
      },
    ],
    [copy, report],
  );

  const studentAccountCoverage = useMemo(() => {
    const classRows = classes.map((classItem) => {
      const rostered = Number(classItem.student_count || classItem.stats.student_count || 0);
      const linked = Number(classItem.invite_summary?.linked_count || 0);
      const readyToClaim = Number(classItem.invite_summary?.pending_count || 0);
      const missingEmail = Number(classItem.invite_summary?.session_only_count || 0);
      const coverage = rostered > 0 ? Math.round((linked / rostered) * 100) : 0;
      return {
        id: classItem.id,
        name: classItem.name,
        subject: classItem.subject,
        grade: classItem.grade,
        rostered,
        linked,
        readyToClaim,
        missingEmail,
        coverage,
      };
    });

    const totalRostered = classRows.reduce((sum, classItem) => sum + classItem.rostered, 0);
    const linkedStudents = classRows.reduce((sum, classItem) => sum + classItem.linked, 0);
    const readyToClaim = classRows.reduce((sum, classItem) => sum + classItem.readyToClaim, 0);
    const missingEmail = classRows.reduce((sum, classItem) => sum + classItem.missingEmail, 0);
    const coveragePercent = totalRostered > 0 ? Math.round((linkedStudents / totalRostered) * 100) : 0;
    const classesNeedingAttention = classRows.filter(
      (classItem) => classItem.readyToClaim > 0 || classItem.missingEmail > 0,
    );

    return {
      totalClasses: classRows.length,
      totalRostered,
      linkedStudents,
      readyToClaim,
      missingEmail,
      coveragePercent,
      classesNeedingAttention: classesNeedingAttention.length,
      focusClasses: [...classRows]
        .sort((left, right) => {
          if (left.readyToClaim !== right.readyToClaim) return right.readyToClaim - left.readyToClaim;
          if (left.coverage !== right.coverage) return left.coverage - right.coverage;
          return left.name.localeCompare(right.name);
        })
        .slice(0, 3),
    };
  }, [classes]);

  const timelineRows = useMemo(
    () =>
      (Array.isArray(report?.recent_sessions) ? report.recent_sessions : []).map((row: any) => {
        const tone = getTimelineTone(row);
        return {
          ...row,
          dateLabel: formatReportDate(row.date, reportLanguage),
          headlineLabel: translateReportHeadline(String(row.headline || ''), reportLanguage),
          tone,
          toneLabel:
            tone === 'strong'
              ? copy.timelineStrong
              : tone === 'risk'
                ? copy.timelineRisk
                : copy.timelineWatch,
        };
      }),
    [copy.timelineRisk, copy.timelineStrong, copy.timelineWatch, report, reportLanguage],
  );

  const localizedInsights = useMemo(
    () => (Array.isArray(report?.insights) ? report.insights : []).map((insight: any) => translateReportInsight(insight, reportLanguage)),
    [report?.insights, reportLanguage],
  );

  const selectedExportSession = useMemo(
    () =>
      timelineRows.find((row: any) => Number(row.session_id) === Number(selectedExportSessionId)) || timelineRows[0] || null,
    [selectedExportSessionId, timelineRows],
  );

  const providerOption = useMemo(
    () => LMS_PROVIDER_OPTIONS.find((option) => option.id === selectedExportProviderId) || LMS_PROVIDER_OPTIONS[0],
    [selectedExportProviderId],
  );

  const handleDownloadGradebook = useCallback(async () => {
    if (!selectedExportSession) return;
    setIsExporting(true);
    setExportError('');
    try {
      const payload = await apiFetchJson(`/api/teacher/sessions/${selectedExportSession.session_id}/lms-export?provider=${encodeURIComponent(selectedExportProviderId)}`);
      downloadTextFile(payload.filename || `session-${selectedExportSession.session_id}.csv`, payload.csv || '');
      setLastExportMeta({
        filename: payload.filename || `session-${selectedExportSession.session_id}.csv`,
        providerLabel: payload.provider_label || providerOption.label[language as keyof typeof providerOption.label] || providerOption.label.en,
        notes: Array.isArray(payload.notes) ? payload.notes : [],
      });
    } catch (downloadError: any) {
      console.error('[TeacherReports] Gradebook export failed:', downloadError);
      setExportError(downloadError?.message || copy.exportError);
    } finally {
      setIsExporting(false);
    }
  }, [copy.exportError, language, providerOption.label, selectedExportProviderId, selectedExportSession]);

  const mainAreaDirection = direction;

  return (
    <div
      dir={direction}
      data-no-translate="true"
      className="teacher-layout-shell"
    >
      <TeacherSidebar />

      <main className="teacher-layout-main teacher-page-pad pt-20 lg:pt-8">
        <div className="max-w-[1200px] mx-auto relative z-10">
          <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 ${isRtl ? 'md:flex-row-reverse' : ''}`}>
            <div className={isRtl ? 'text-right' : ''}>
              <h1 className="text-3xl lg:text-4xl font-black tracking-tight">{copy.title}</h1>
              <p className="text-brand-dark/60 font-bold mt-2 max-w-3xl">{copy.subtitle}</p>
            </div>
            <button
              onClick={loadReport}
              className={`px-6 py-3 bg-brand-purple text-white border-2 border-brand-dark rounded-full flex items-center gap-2 hover:bg-purple-500 transition-colors font-black text-base shadow-[2px_2px_0px_0px_#1A1A1A] w-fit ${isRtl ? 'self-end md:self-auto flex-row-reverse' : ''}`}
            >
              <RefreshCw className="w-5 h-5" />
              {copy.refresh}
            </button>
          </div>

          {loading ? (
            <div className={`bg-white border-2 border-brand-dark rounded-[2rem] p-12 shadow-[4px_4px_0px_0px_#1A1A1A] text-center ${isRtl ? 'text-right' : ''}`}>
              <p className="text-2xl font-black">{copy.loading}</p>
            </div>
          ) : error ? (
            <div className={`bg-white border-2 border-brand-dark rounded-[2rem] p-8 shadow-[4px_4px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : ''}`}>
              <h2 className="text-2xl font-black mb-2">{copy.loadFailedTitle}</h2>
              <p className="font-bold text-brand-dark/60 mb-5">{error}</p>
              <button
                onClick={() => void loadReport()}
                className={`px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full inline-flex items-center gap-2 font-black shadow-[2px_2px_0px_0px_#1A1A1A] ${isRtl ? 'flex-row-reverse' : ''}`}
              >
                <RefreshCw className="w-5 h-5" />
                {copy.retry}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                {stats.map((stat) => (
                  <StatCard
                    key={stat.id}
                    title={stat.title}
                    value={stat.value}
                    caption={stat.caption}
                    color={stat.color}
                    textColor={stat.textColor}
                    align={direction}
                  />
                ))}
              </div>

              {/* Student Account Coverage */}
              {!loading && !error && (
                <div className="mb-8 rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A] lg:p-6">
                  <div className={`flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between ${isRtl ? 'lg:flex-row-reverse' : ''}`}>
                    <div className={`max-w-3xl ${isRtl ? 'text-right' : ''}`}>
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-purple">
                        {language === 'he' ? 'כיסוי חשבונות תלמידים' : 'Student Account Coverage'}
                      </p>
                      <h2 className="text-2xl font-black tracking-tight lg:text-3xl">
                        {language === 'he' 
                          ? 'ראה אילו מהתלמידים הרשומים כבר מקושרים לפרופיל תלמיד קבוע.' 
                          : 'See which rostered students are already linked to a persistent student profile.'}
                      </h2>
                      <p className="mt-3 max-w-[70ch] text-sm font-bold text-brand-dark/65">
                        {language === 'he'
                          ? 'מידע זה עוזר לך לזהות אילו כיתות מוכנות לאנליטיקה ארוכת טווח, אילו תלמידים עדיין צריכים לשייך חשבון, ואיפה הנתונים עדיין מתבססים על סשנים בודדים.'
                          : 'This block helps you spot which classes are ready for longitudinal analytics, which students still need to claim an account, and where the board is still relying on session-only reads.'}
                      </p>
                    </div>
                    <button
                      onClick={() => navigate('/teacher/classes')}
                      className={`inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-5 py-3 font-black shadow-[3px_3px_0px_0px_#1A1A1A] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all ${isRtl ? 'flex-row-reverse' : ''}`}
                    >
                      {language === 'he' ? 'פתיחת כיתות' : 'Open Classes'}
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  </div>

                  {classOverviewError ? (
                    <div className={`mt-5 rounded-[1.4rem] border-2 border-brand-dark bg-brand-orange/10 p-4 ${isRtl ? 'text-right' : ''}`}>
                      <p className="font-black">{language === 'he' ? 'הכיתות לא נטענו כראוי.' : 'Classes did not load cleanly.'}</p>
                      <p className="mt-1 text-sm font-bold text-brand-dark/65">{classOverviewError}</p>
                    </div>
                  ) : !hasLoadedClassOverview ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div
                          key={`coverage-skeleton-${index}`}
                          className="h-24 animate-pulse rounded-[1.3rem] border-2 border-brand-dark bg-brand-bg"
                        />
                      ))}
                    </div>
                  ) : studentAccountCoverage.totalClasses === 0 ? (
                    <div className={`mt-5 rounded-[1.4rem] border-2 border-dashed border-brand-dark/30 bg-brand-bg/80 p-6 ${isRtl ? 'text-right' : ''}`}>
                      <p className="text-lg font-black">{language === 'he' ? 'אין כיתות עדיין. הוסף כיתה כדי להתחיל לסנכרן חשבונות תלמידים עם אנליטיקה.' : 'No classes yet. Add a class to start syncing student accounts with teacher analytics.'}</p>
                    </div>
                  ) : (
                    <>
                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <CoverageMetric
                          label={language === 'he' ? 'תלמידים רשומים' : 'Rostered students'}
                          value={studentAccountCoverage.totalRostered}
                          detail={language === 'he' ? 'בכל רשימות הכיתות המקושרות' : 'Across linked class rosters'}
                          isRtl={isRtl}
                        />
                        <CoverageMetric
                          label={language === 'he' ? 'תלמידים מקושרים' : 'Linked Students'}
                          value={studentAccountCoverage.linkedStudents}
                          detail={`${studentAccountCoverage.coveragePercent}% ${language === 'he' ? 'כיסוי חשבונות' : 'claim coverage'}`}
                          isRtl={isRtl}
                        />
                        <CoverageMetric
                          label={language === 'he' ? 'מוכנים לשיוך' : 'Ready to claim'}
                          value={studentAccountCoverage.readyToClaim}
                          detail={language === 'he' ? 'לתלמידים יש מייל ברשימה אך טרם פתחו חשבון' : 'Students have an email on the roster but no claimed account yet'}
                          isRtl={isRtl}
                        />
                        <CoverageMetric
                          label={language === 'he' ? 'כיתות הדורשות תשומת לב' : 'Classes need attention'}
                          value={studentAccountCoverage.classesNeedingAttention}
                          detail={studentAccountCoverage.missingEmail > 0 ? (language === 'he' ? 'לחלק מחברי הכיתה עדיין חסרה כתובת מייל' : 'Some roster members are still missing an email address') : (language === 'he' ? 'התמקד בכיתות אלו קודם' : 'Focus these classes first')}
                          isRtl={isRtl}
                        />
                      </div>

                      <div className="mt-5 grid gap-3 xl:grid-cols-3">
                        {studentAccountCoverage.focusClasses.map((classItem) => (
                          <div
                            key={classItem.id}
                            className={`rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 shadow-[3px_3px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : ''}`}
                          >
                            <div className={`flex items-start justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
                              <div className="min-w-0">
                                <p className="text-lg font-black truncate">{classItem.name}</p>
                                <p className="text-sm font-bold text-brand-dark/55">
                                  {[classItem.subject, classItem.grade].filter(Boolean).join(' • ') || (language === 'he' ? 'כיתות' : 'Classes')}
                                </p>
                              </div>
                              <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black shrink-0">
                                {classItem.coverage}%
                              </span>
                            </div>

                            <div className={`mt-4 flex flex-wrap gap-2 text-xs font-black ${isRtl ? 'flex-row-reverse' : ''}`}>
                              <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                {classItem.linked}/{classItem.rostered} {language === 'he' ? 'מקושרים' : 'linked'}
                              </span>
                              {classItem.readyToClaim > 0 && (
                                <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-1">
                                  {classItem.readyToClaim} {language === 'he' ? 'מוכנים לשיוך' : 'Ready to claim'}
                                </span>
                              )}
                              {classItem.missingEmail > 0 && (
                                <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1">
                                  {classItem.missingEmail} {language === 'he' ? 'מיילים חסרים' : 'missing emails'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {localizedInsights.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  {localizedInsights.map((insight: any, index: number) => (
                    <div key={index} className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] p-6">
                      <div className={`flex items-start gap-4 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                        <div className="w-12 h-12 rounded-2xl bg-brand-purple text-white border-2 border-brand-dark flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{copy.insightLabel}</p>
                          <h2 className="text-2xl font-black mb-2">{insight.title}</h2>
                          <p className="text-brand-dark/70 font-medium leading-relaxed">{insight.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6 mb-8">
                <div className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] p-6">
                  <div className={`flex items-start gap-3 mb-5 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                    <div className="w-12 h-12 rounded-2xl bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shrink-0">
                      <Clock3 className="w-6 h-6 text-brand-dark" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black">{copy.timelineTitle}</h2>
                      <p className="text-sm font-bold text-brand-dark/60 mt-1">{copy.timelineSubtitle}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {timelineRows.length > 0 ? (
                      timelineRows.map((row: any, index: number) => (
                        <div
                          key={`timeline-${row.session_id}`}
                          className={`rounded-[1.5rem] border-2 border-brand-dark p-4 ${
                            row.tone === 'strong'
                              ? 'bg-emerald-50'
                              : row.tone === 'risk'
                                ? 'bg-brand-orange/10'
                                : 'bg-brand-bg'
                          }`}
                        >
                          <div className={`flex items-start gap-4 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                            <div className="flex flex-col items-center shrink-0">
                              <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${
                                row.tone === 'strong' ? 'bg-emerald-500' : row.tone === 'risk' ? 'bg-brand-orange' : 'bg-brand-yellow'
                              }`} />
                              {index < timelineRows.length - 1 && <div className="mt-2 w-[2px] h-12 bg-brand-dark/20" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={`flex items-start justify-between gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
                                <div className="min-w-0">
                                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple mb-1">{row.dateLabel}</p>
                                  <p className="text-xl font-black break-words">{row.quiz_name}</p>
                                  <p className="text-sm font-bold text-brand-dark/60 mt-1">{row.headlineLabel}</p>
                                </div>
                                <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] shrink-0">
                                  {row.toneLabel}
                                </span>
                              </div>
                              <div className={`mt-4 flex flex-wrap gap-2 ${isRtl ? 'justify-end' : ''}`}>
                                <MetricPill icon={<Users className="w-3.5 h-3.5" />} label={`${row.players} ${copy.table.players}`} />
                                <MetricPill icon={<TrendingUp className="w-3.5 h-3.5" />} label={`${Number(row.avg_accuracy || 0).toFixed(1)}%`} />
                                <MetricPill icon={<Gauge className="w-3.5 h-3.5" />} label={`${Number(row.stress_index || 0).toFixed(0)}% ${copy.table.stress.toLowerCase()}`} />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="font-bold text-brand-dark/55">{copy.noSessions}</p>
                    )}
                  </div>
                </div>

                <div className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] p-6">
                  <div className={`flex items-start gap-3 mb-5 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                    <div className="w-12 h-12 rounded-2xl bg-brand-purple text-white border-2 border-brand-dark flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black">{copy.exportTitle}</h2>
                      <p className="text-sm font-bold text-brand-dark/60 mt-1">{copy.exportSubtitle}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{copy.exportSessionLabel}</label>
                      <select
                        value={selectedExportSessionId}
                        onChange={(event) => setSelectedExportSessionId(Number(event.target.value))}
                        className="w-full rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 py-3 font-black"
                        disabled={timelineRows.length === 0}
                      >
                        {timelineRows.map((row: any) => (
                          <option key={`export-session-${row.session_id}`} value={row.session_id}>
                            {row.quiz_name} • {row.dateLabel}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{copy.exportProviderLabel}</label>
                      <select
                        value={selectedExportProviderId}
                        onChange={(event) => setSelectedExportProviderId(event.target.value)}
                        className="w-full rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 py-3 font-black"
                      >
                        {LMS_PROVIDER_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label[language as keyof typeof option.label] || option.label.en}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedExportSession && (
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple mb-2">
                          {selectedExportSession.quiz_name}
                        </p>
                        <p className="font-black">{providerOption.hint[language as keyof typeof providerOption.hint] || providerOption.hint.en}</p>
                        <div className={`mt-3 flex flex-wrap gap-2 ${isRtl ? 'justify-end' : ''}`}>
                          <MetricPill icon={<Users className="w-3.5 h-3.5" />} label={`${selectedExportSession.players} ${copy.table.players}`} />
                          <MetricPill icon={<TrendingDown className="w-3.5 h-3.5" />} label={`${Number(selectedExportSession.avg_accuracy || 0).toFixed(1)}% ${copy.table.accuracy.toLowerCase()}`} />
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => void handleDownloadGradebook()}
                      disabled={!selectedExportSession || isExporting}
                      className="w-full rounded-full border-2 border-brand-dark bg-brand-orange px-5 py-4 font-black text-white shadow-[3px_3px_0px_0px_#1A1A1A] disabled:opacity-50"
                    >
                      <span className={`inline-flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                        <Download className="w-4 h-4" />
                        {isExporting ? '...' : copy.exportButton}
                      </span>
                    </button>

                    {exportError && (
                      <p className="rounded-2xl border-2 border-brand-dark bg-brand-orange/10 px-4 py-3 text-sm font-black text-brand-dark">
                        {exportError}
                      </p>
                    )}

                    {lastExportMeta && (
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{copy.exportReady}</p>
                        <p className="font-black">{lastExportMeta.filename}</p>
                        <p className="text-sm font-bold text-brand-dark/60 mt-1">{lastExportMeta.providerLabel}</p>
                        {lastExportMeta.notes.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{copy.exportNotes}</p>
                            <div className="space-y-2">
                              {lastExportMeta.notes.map((note, index) => (
                                <p key={`export-note-${index}`} className="text-sm font-bold text-brand-dark/65">
                                  {note}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white border-2 border-brand-dark rounded-[2rem] shadow-[4px_4px_0px_0px_#1A1A1A] overflow-hidden">
                <div className={`p-6 border-b-2 border-brand-dark bg-slate-50 ${isRtl ? 'text-right' : ''}`}>
                  <h2 className="text-2xl font-black">{copy.sessionsTitle}</h2>
                  <p className="text-sm font-bold text-brand-dark/60 mt-1">{copy.sessionsSubtitle}</p>
                </div>

                {pendingDeleteId !== null && (
                  <div className="border-b-2 border-brand-dark bg-brand-bg px-6 py-4">
                    <div className={`rounded-[1.4rem] border-2 border-brand-dark bg-white px-4 py-4 shadow-[3px_3px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : ''}`}>
                      <div className={`flex items-start gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
                        <div className="w-10 h-10 rounded-full border-2 border-brand-dark bg-brand-orange/10 flex items-center justify-center shrink-0">
                          <AlertTriangle className="w-5 h-5 text-brand-orange" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black">{copy.confirmDeleteTitle}</p>
                          {pendingDeleteName && (
                            <p className="text-sm font-bold text-brand-dark/50 truncate mt-1">"{pendingDeleteName}"</p>
                          )}
                          <p className="text-sm font-bold text-brand-dark/65 mt-2">{copy.confirmDeleteBody}</p>
                          {deleteError && (
                            <p className="mt-3 rounded-xl bg-brand-orange/10 border-2 border-brand-orange px-3 py-2 text-sm font-bold text-brand-orange">
                              {deleteError}
                            </p>
                          )}
                          <div className={`mt-4 flex flex-wrap gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                            <button
                              onClick={() => void handleDeleteConfirm()}
                              disabled={isDeleting}
                              className="rounded-full border-2 border-brand-dark bg-brand-orange px-4 py-2 font-black text-white disabled:opacity-60"
                            >
                              {isDeleting ? '...' : copy.confirmDeleteAction}
                            </button>
                            <button
                              onClick={() => {
                                if (isDeleting) return;
                                setPendingDeleteId(null);
                                setPendingDeleteName('');
                                setDeleteError('');
                              }}
                              disabled={isDeleting}
                              className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 font-black disabled:opacity-60"
                            >
                              {copy.cancelAction}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className={`w-full border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead>
                      <tr className="border-b-2 border-brand-dark bg-white">
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.quizName}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.date}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.players}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.accuracy}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.stress}</th>
                        <th className="p-4 font-black text-sm uppercase tracking-wider">{copy.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recent_sessions?.length > 0 ? (
                        report.recent_sessions.map((row: any) => (
                          <tr key={row.session_id} className="border-b-2 border-brand-dark/10 hover:bg-slate-50 transition-colors">
                            <td className="p-4">
                              <p className="font-bold">{row.quiz_name}</p>
                              <p className="text-xs font-bold text-brand-dark/50 mt-1">{row.headlineLabel}</p>
                            </td>
                            <td className="p-4 text-brand-dark/70 font-medium">{row.dateLabel}</td>
                            <td className="p-4 font-bold">{row.players}</td>
                            <td className="p-4">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-black border-2 ${
                                  (row.avg_accuracy || 0) > 80
                                    ? 'bg-emerald-100 border-emerald-500 text-emerald-700'
                                    : (row.avg_accuracy || 0) > 60
                                      ? 'bg-brand-yellow/30 border-brand-yellow text-brand-dark'
                                      : 'bg-brand-orange/20 border-brand-orange text-brand-dark'
                                }`}
                              >
                                {(row.avg_accuracy || 0).toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-4 font-bold">{(row.stress_index || 0).toFixed(0)}%</td>
                            <td className="p-4">
                              <div className={`flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
                                <button
                                  onClick={() => navigate(`/teacher/analytics/class/${row.session_id}`)}
                                  className={`text-brand-purple hover:text-purple-700 font-black text-sm inline-flex items-center gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}
                                >
                                  {copy.view}
                                  {isRtl ? <ArrowUpLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => {
                                    setPendingDeleteId(Number(row.session_id));
                                    setPendingDeleteName(row.quiz_name || '');
                                    setDeleteError('');
                                  }}
                                  className="text-brand-dark/40 hover:text-brand-orange transition-colors inline-flex items-center gap-1 font-black text-sm"
                                  title={copy.delete}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-10 text-center text-brand-dark/50 font-bold">
                            {copy.noSessions}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function MetricPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black">
      {icon}
      {label}
    </span>
  );
}

function StatCard({
  title,
  value,
  caption,
  color,
  textColor = 'text-brand-dark',
  align,
}: {
  key?: React.Key;
  title: string;
  value: string | number;
  caption: string;
  color: string;
  textColor?: string;
  align: 'ltr' | 'rtl';
}) {
  return (
    <div className={`${color} ${textColor} border-2 border-brand-dark rounded-[2rem] p-6 shadow-[4px_4px_0px_0px_#1A1A1A] ${align === 'rtl' ? 'text-right' : ''}`}>
      <p className="text-sm font-bold uppercase tracking-wider opacity-80 mb-2">{title}</p>
      <p className="text-4xl font-black mb-2">{value}</p>
      <span className="inline-block bg-white/20 px-2 py-1 rounded-lg text-sm font-black border border-current/20">
        {caption}
      </span>
    </div>
  );
}
function CoverageMetric({
  label,
  value,
  detail,
  isRtl,
}: {
  label: string;
  value: string | number;
  detail: string;
  isRtl: boolean;
}) {
  return (
    <div className={`rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 shadow-[3px_3px_0px_0px_#1A1A1A] ${isRtl ? 'text-right' : ''}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-purple">{label}</p>
      <p className="mt-2 text-3xl font-black leading-none">{value}</p>
      <p className="mt-2 text-sm font-bold text-brand-dark/60">{detail}</p>
    </div>
  );
}
