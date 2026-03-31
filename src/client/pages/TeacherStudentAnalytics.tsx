import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Gauge,
  Layers3,
  Printer,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import {
  MasteryBarChart,
  QuestionFlowChart,
  QuestionStatusStripChart,
  RevisionCategoryChart,
  SessionHistoryTrendChart,
} from '../components/studentDashboardCharts.tsx';
import AppLoadingScreen from '../components/AppLoadingScreen.tsx';
import { apiFetchJson } from '../lib/api.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { useTeacherAnalyticsLanguage } from '../lib/teacherAnalyticsLanguage.ts';

function buildSignalComparisons(sessionAnalytics: any, overallAnalytics: any) {
  const overallSignals = new Map(
    (Array.isArray(overallAnalytics?.behaviorSignals) ? overallAnalytics.behaviorSignals : []).map((signal: any) => [
      signal.id,
      signal.score,
    ]),
  );

  return (Array.isArray(sessionAnalytics?.behaviorSignals) ? sessionAnalytics.behaviorSignals : []).map((signal: any) => ({
    ...signal,
    overall_score: overallSignals.has(signal.id) ? Number(overallSignals.get(signal.id) || 0) : null,
    delta: overallSignals.has(signal.id)
      ? Number(signal.score || 0) - Number(overallSignals.get(signal.id) || 0)
      : null,
  }));
}

function buildSessionComparison(sessionAnalytics: any, overallAnalytics: any) {
  if (!overallAnalytics) {
    return {
      accuracy_delta: null,
      stress_delta: null,
      confidence_delta: null,
      focus_delta: null,
      behavior_signals: buildSignalComparisons(sessionAnalytics, overallAnalytics),
    };
  }

  return {
    accuracy_delta: Number(sessionAnalytics?.stats?.accuracy || 0) - Number(overallAnalytics?.stats?.accuracy || 0),
    stress_delta:
      Number(sessionAnalytics?.risk?.stress_index || 0) - Number(overallAnalytics?.risk?.stress_index || 0),
    confidence_delta:
      Number(sessionAnalytics?.profile?.confidence_score || 0) -
      Number(overallAnalytics?.profile?.confidence_score || 0),
    focus_delta:
      Number(sessionAnalytics?.profile?.focus_score || 0) - Number(overallAnalytics?.profile?.focus_score || 0),
    behavior_signals: buildSignalComparisons(sessionAnalytics, overallAnalytics),
  };
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '0ms';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatSigned(value: number, suffix = '') {
  const numericValue = Number(value || 0);
  return `${numericValue >= 0 ? '+' : ''}${numericValue.toFixed(1)}${suffix}`;
}

function formatDeltaMs(value: number) {
  const numericValue = Number(value || 0);
  if (Math.abs(numericValue) >= 1000) {
    return `${numericValue >= 0 ? '+' : ''}${(numericValue / 1000).toFixed(1)}s`;
  }
  return `${numericValue >= 0 ? '+' : ''}${Math.round(numericValue)}ms`;
}

function formatPercent(value: number, digits = 0) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function humanizeAnalyticsToken(value?: string) {
  const normalized = String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!normalized) return 'Unknown';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function actionLabel(action?: string) {
  switch (String(action || '').trim()) {
    case 'reteach':
      return 'Reteach';
    case 'slow_down':
      return 'Slow Down';
    case 'reduce_distractors':
      return 'Reduce Distractors';
    case 'keep_momentum':
      return 'Keep Momentum';
    default:
      return humanizeAnalyticsToken(action);
  }
}

function modelTone(state?: string) {
  if (state === 'high') return 'bg-brand-orange/10';
  if (state === 'medium') return 'bg-brand-yellow/35';
  return 'bg-emerald-50';
}

function labelSourceLabel(source?: string) {
  switch (String(source || '').trim()) {
    case 'teacher_review':
      return 'Teacher Review';
    case 'student_self_report':
      return 'Student Self-Report';
    case 'auto_outcome':
      return 'Automatic Outcome';
    default:
      return humanizeAnalyticsToken(source);
  }
}

export default function TeacherStudentAnalytics() {
  const { language } = useAppLanguage();
  const { t } = useTeacherAnalyticsLanguage();
  const { sessionId, participantId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [memoryNoteDraft, setMemoryNoteDraft] = useState('');
  const [memoryNoteSaving, setMemoryNoteSaving] = useState(false);
  const copy = {
    he: {
      packLabel: 'חבילה',
      studentLabel: 'תלמיד',
      primaryFallback: 'נקודת הקצה הראשית נכשלה, נטענו נתוני גיבוי.',
      loadFailed: 'טעינת ניתוח התלמיד נכשלה',
      adaptiveFailed: 'יצירת המשחק האדפטיבי נכשלה',
      copyFailed: 'העתקת תקציר התמיכה נכשלה',
      loading: 'טוען את לוח המחוונים האישי...',
    },
    ar: {
      packLabel: 'حزمة',
      studentLabel: 'طالب',
      primaryFallback: 'فشلت نقطة النهاية الرئيسية، وتم تحميل بيانات احتياطية.',
      loadFailed: 'فشل تحميل تحليلات الطالب',
      adaptiveFailed: 'فشل إنشاء اللعبة التكيّفية',
      copyFailed: 'فشل نسخ ملخص الدعم',
      loading: 'جارٍ تحميل لوحة المتابعة الشخصية...',
    },
    en: {
      packLabel: 'Pack',
      studentLabel: 'Student',
      primaryFallback: 'Primary endpoint failed, loaded fallback data.',
      loadFailed: 'Failed to load student analytics',
      adaptiveFailed: 'Failed to create adaptive game',
      copyFailed: 'Failed to copy support snapshot',
      loading: 'Loading personal dashboard...',
    },
  }[language];

  const buildFallbackPayload = async () => {
    const classPayload = await apiFetchJson(`/api/analytics/class/${sessionId}`);
    const studentSummary = classPayload?.participants?.find((row: any) => Number(row.id) === Number(participantId));
    const reportPayload = await apiFetchJson(`/api/reports/student/${participantId}`);

    return {
      session: reportPayload?.session || classPayload?.session || { id: Number(sessionId) },
      pack:
        reportPayload?.pack || {
          id: classPayload?.session?.quiz_pack_id,
          title: classPayload?.session?.pack_title || `${copy.packLabel} ${classPayload?.session?.quiz_pack_id || ''}`,
        },
      participant:
        reportPayload?.participant || {
          id: Number(participantId),
          session_id: Number(sessionId),
          nickname: studentSummary?.nickname || copy.studentLabel,
        },
      student_summary: studentSummary || null,
      class_summary: classPayload?.summary || null,
      class_distributions: classPayload?.distributions || null,
      analytics: reportPayload,
      overall_analytics: null,
      session_vs_overall: buildSessionComparison(reportPayload, null),
      adaptive_game_preview: { questions: [], strategy: null },
    };
  };

  const loadStudentAnalytics = async () => {
    if (!sessionId || !participantId) return;

    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/student/${participantId}?ui_language=${language}`);
      if (!payload?.session_vs_overall && payload?.analytics && payload?.overall_analytics) {
        payload.session_vs_overall = buildSessionComparison(payload.analytics, payload.overall_analytics);
      }
      setData(payload);
    } catch (loadError: any) {
      try {
        const fallbackPayload = await buildFallbackPayload();
        setData(fallbackPayload);
        setError(loadError?.message || copy.primaryFallback);
      } catch (fallbackError: any) {
        setError(fallbackError?.message || loadError?.message || copy.loadFailed);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudentAnalytics();
  }, [sessionId, participantId, language]);

  useEffect(() => {
    setMemoryNoteDraft(String(data?.student_memory?.teacher_notes?.note || ''));
  }, [data?.student_memory?.teacher_notes?.note]);

  useEffect(() => {
    if (!snapshotCopied) return;
    const timeout = window.setTimeout(() => setSnapshotCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [snapshotCopied]);

  const analytics = data?.analytics;
  const overallAnalytics = data?.overall_analytics;
  const studentMemory = data?.student_memory;
  const comparison = data?.session_vs_overall || buildSessionComparison(analytics, overallAnalytics);
  const student = data?.student_summary;
  const classSummary = data?.class_summary;
  const trust = analytics?.trust || analytics?.overallStory || {};
  const trustObservedFacts = trust?.observed_facts || analytics?.overallStory?.observed_facts || null;
  const trustInterpretation = trust?.derived_interpretation || analytics?.overallStory?.derived_interpretation || null;
  const trustTeacherAction = analytics?.risk?.teacher_action || trust?.teacher_action || analytics?.practicePlan?.teacher_action || null;
  const gradingSafeMetrics = Array.isArray(analytics?.gradingSafeMetrics) ? analytics.gradingSafeMetrics.slice(0, 4) : [];
  const behaviorSignalMetrics = Array.isArray(analytics?.behaviorSignalMetrics) ? analytics.behaviorSignalMetrics.slice(0, 4) : [];
  const preview = data?.adaptive_game_preview;
  const memoryInterventionPlan = data?.memory_intervention_plan;
  const questionReview = analytics?.questionReview || [];
  const revisionInsights = analytics?.revisionInsights || {};
  const deadlineProfile = analytics?.deadlineProfile || {};
  const recoveryProfile = analytics?.recoveryProfile || {};
  const fatigueDrift = analytics?.fatigueDrift || {};
  const misconceptionPatterns = analytics?.misconceptionPatterns || [];
  const tagBehaviorProfiles = analytics?.tagPerformance || [];
  const engagementModel = analytics?.engagementModel || {};
  const masteryState = Array.isArray(analytics?.masteryState) ? analytics.masteryState : [];
  const masterySnapshotRows = masteryState.map((row: any) => ({
    tag: row.learning_objective || humanizeAnalyticsToken(row.concept_id),
    score: Number(row.mastery_score || 0),
    accuracy: Number(row.accuracy || 0),
  }));
  const modelPredictions = Array.isArray(analytics?.modelPredictions) ? analytics.modelPredictions : [];
  const signalSuppressedMetrics = Array.isArray(analytics?.signalSuppressedMetrics) ? analytics.signalSuppressedMetrics : [];
  const conceptAttemptHistory = Array.isArray(analytics?.conceptAttemptHistory) ? analytics.conceptAttemptHistory : [];
  const recentAnalyticsLabels = Array.isArray(analytics?.labels) ? analytics.labels : [];
  const interventionModel = analytics?.interventionModel || null;
  const stabilityScore = Number(analytics?.stabilityScore || analytics?.aggregates?.stability_score || 0);
  const summaryCopy = {
    he: {
      printTitle: 'תקציר הוראה להדפסה',
      printSubtitle: 'מסמך קצר למורה: שורה תחתונה, משמעות פדגוגית, ומה כדאי לעשות עכשיו.',
      executiveLabel: 'שורה תחתונה',
      evidenceLabel: 'מה ראינו בפועל',
      strengthsLabel: 'מה כבר עובד',
      supportLabel: 'איפה דרושה תמיכה',
      meaningLabel: 'מה זה אומר פדגוגית',
      actionsLabel: 'מה עושים עכשיו',
      nextLessonLabel: 'לפני השיעור או ההפעלה הבאה',
      classPositionLabel: 'מיקום יחסי',
      focusQuestionsLabel: 'שאלות שכדאי לפתוח מחדש',
      familyLabel: 'הערה קצרה להורה / יועץ',
      summaryTitle: `תקציר תמיכה: ${data?.participant?.nickname || 'תלמיד/ה'}`,
      sessionLabel: `חבילה: ${data?.pack?.title || 'סשן Quizzi'} · סשן #${data?.session?.id || sessionId}`,
      happenedTitle: 'מה קרה במשחק הזה',
      showsTitle: 'מה התלמיד כבר מראה',
      neededTitle: 'איפה דרושה תמיכה',
      nextMoveTitle: 'המהלך הבא המומלץ',
      teacherNowLead: 'כרגע לא נראה שמדובר רק בפער ידע.',
      classPositionText: `מקום #${student?.rank || '-'} בסשן הזה, מול דיוק כיתתי של ${formatPercent(Number(classSummary?.accuracy || 0), 1)}.`,
      questionPrefix: 'שאלה',
      noQuestionFocus: 'לא זוהתה כרגע שאלה אחת שבולטת יותר מכל השאר, לכן כדאי להתחיל מהמושג המרכזי החלש ביותר.',
      printedOn: `הופק ב-${new Date().toLocaleDateString('he-IL')}`,
      noHistoryPattern: 'עדיין אין מספיק היסטוריה כדי לקבוע אם זה דפוס קבוע או אירוע נקודתי.',
      stablePattern: 'נראה שהתלמיד נשאר יחסית יציב בקצב, ולכן המוקד הוא דיוק והבהרה מושגית יותר מאשר ויסות.',
      pressurePattern: 'נראים רגעים של חוסר יציבות תחת לחץ, ולכן כדאי להשאיר את אותו חומר אבל להוריד עומס ולקצר את מרחק ההחלטה.',
      evidenceLines: (accuracy: string, stress: string, confidence: string, focus: string, recovery: string, deadline: string) => [
        `דיוק בסשן: ${accuracy}.`,
        `לחץ התנהגותי: ${stress}; ביטחון: ${confidence}; ריכוז: ${focus}.`,
        `שיעור התאוששות אחרי טעות: ${recovery}.`,
        `תלות בדדליין: ${deadline}.`,
      ],
      strengthsText: (text: string) => `האזורים היציבים יותר כרגע: ${text}.`,
      supportText: (text: string) => `האזור שדורש חיזוק עכשיו: ${text}.`,
      meaningText: (story: string, pattern: string) => `${story} ${pattern}`,
      nextLessonText: (move: string) => `המהלך המומלץ הוא ${move}`,
      questionText: (index: number, prompt: string, why: string) => `שאלה ${index}: ${prompt} ${why}`,
      focusWhyMissed: 'כדאי לפתוח מחדש את הניסוח והמושג לפני שממשיכים הלאה.',
      focusWhyRevision: 'השאלה הזו מצביעה על שינוי החלטה לא יציב, ולכן שווה לעצור עליה ולבדוק איך התלמיד מסביר את הבחירה.',
      focusWhyDeadline: 'כאן נראית תלות בקצה הזמן, ולכן כדאי להריץ בדיקה רגועה יותר על אותו תוכן.',
    },
    en: {
      printTitle: 'Printable Teaching Summary',
      printSubtitle: 'A short teacher-facing brief: bottom line, meaning, and what to do next.',
      executiveLabel: 'Bottom line',
      evidenceLabel: 'What we observed',
      strengthsLabel: 'What is already working',
      supportLabel: 'Where support is needed',
      meaningLabel: 'What this means instructionally',
      actionsLabel: 'What to do now',
      nextLessonLabel: 'Before the next live lesson',
      classPositionLabel: 'Relative position',
      focusQuestionsLabel: 'Questions worth reopening',
      familyLabel: 'Short home / advisor note',
      summaryTitle: `Support summary: ${data?.participant?.nickname || 'Student'}`,
      sessionLabel: `Pack: ${data?.pack?.title || 'Quizzi session'} · Session #${data?.session?.id || sessionId}`,
      happenedTitle: 'What happened in this game',
      showsTitle: 'What the student already shows',
      neededTitle: 'Where support is needed',
      nextMoveTitle: 'Recommended next move',
      teacherNowLead: 'This does not look like a knowledge gap alone.',
      classPositionText: `Rank #${student?.rank || '-'} in this session, against a class accuracy of ${formatPercent(Number(classSummary?.accuracy || 0), 1)}.`,
      questionPrefix: 'Question',
      noQuestionFocus: 'No single item stands out far above the rest yet, so start with the weakest shared concept.',
      printedOn: `Generated on ${new Date().toLocaleDateString('en-US')}`,
      noHistoryPattern: 'There is not enough history yet to tell whether this is a persistent pattern or a one-off event.',
      stablePattern: 'Pace looks relatively stable, so the main move is concept clarification rather than regulation support.',
      pressurePattern: 'There are unstable moments under pressure, so keep the same material but lower pressure and shorten the decision loop.',
      evidenceLines: (accuracy: string, stress: string, confidence: string, focus: string, recovery: string, deadline: string) => [
        `Session accuracy: ${accuracy}.`,
        `Behavioral stress: ${stress}; confidence: ${confidence}; focus: ${focus}.`,
        `Recovery after misses: ${recovery}.`,
        `Deadline dependence: ${deadline}.`,
      ],
      strengthsText: (text: string) => `Most stable areas right now: ${text}.`,
      supportText: (text: string) => `Main support area right now: ${text}.`,
      meaningText: (story: string, pattern: string) => `${story} ${pattern}`,
      nextLessonText: (move: string) => `Recommended move: ${move}`,
      questionText: (index: number, prompt: string, why: string) => `Question ${index}: ${prompt} ${why}`,
      focusWhyMissed: 'Re-open the wording and the underlying idea before moving on.',
      focusWhyRevision: 'This item shows unstable revision behavior, so ask the student to explain the choice before locking in.',
      focusWhyDeadline: 'This looks deadline-dependent, so a calmer re-check on the same content is the better next step.',
    },
    ar: {
      printTitle: 'ملخص تعليمي للطباعة',
      printSubtitle: 'ملف مختصر للمعلم: الخلاصة، معناها التعليمي، وما الذي ينبغي فعله الآن.',
      executiveLabel: 'الخلاصة',
      evidenceLabel: 'ما الذي رأيناه فعلاً',
      strengthsLabel: 'ما الذي يعمل بالفعل',
      supportLabel: 'أين نحتاج إلى دعم',
      meaningLabel: 'ماذا يعني هذا تربوياً',
      actionsLabel: 'ما الذي نفعله الآن',
      nextLessonLabel: 'قبل الحصة أو الجلسة القادمة',
      classPositionLabel: 'الموقع النسبي',
      focusQuestionsLabel: 'أسئلة تستحق إعادة الفتح',
      familyLabel: 'ملاحظة قصيرة للأهل / المرشد',
      summaryTitle: `ملخص دعم: ${data?.participant?.nickname || 'الطالب/ة'}`,
      sessionLabel: `الحزمة: ${data?.pack?.title || 'جلسة Quizzi'} · الجلسة #${data?.session?.id || sessionId}`,
      happenedTitle: 'ماذا حدث في هذه اللعبة',
      showsTitle: 'ما الذي يظهره الطالب بالفعل',
      neededTitle: 'أين نحتاج إلى دعم',
      nextMoveTitle: 'الخطوة التالية الموصى بها',
      teacherNowLead: 'لا يبدو أن هذا مجرد فجوة معرفية.',
      classPositionText: `المرتبة #${student?.rank || '-'} في هذه الجلسة، مقابل دقة صفية ${formatPercent(Number(classSummary?.accuracy || 0), 1)}.`,
      questionPrefix: 'السؤال',
      noQuestionFocus: 'لا يوجد عنصر واحد يبرز أكثر من الباقي حالياً، لذلك ابدأ بأضعف مفهوم مشترك.',
      printedOn: `تم الإنشاء في ${new Date().toLocaleDateString('ar')}`,
      noHistoryPattern: 'لا توجد بعد بيانات كافية لتحديد ما إذا كان هذا نمطاً ثابتاً أم حالة عابرة.',
      stablePattern: 'الوتيرة تبدو مستقرة نسبياً، لذا فالحركة الأساسية هي توضيح المفهوم أكثر من دعم التنظيم.',
      pressurePattern: 'هناك لحظات غير مستقرة تحت الضغط، لذلك من الأفضل إبقاء نفس المادة مع تقليل الضغط وتقريب دورة القرار.',
      evidenceLines: (accuracy: string, stress: string, confidence: string, focus: string, recovery: string, deadline: string) => [
        `دقة الجلسة: ${accuracy}.`,
        `الضغط السلوكي: ${stress}; الثقة: ${confidence}; التركيز: ${focus}.`,
        `التعافي بعد الخطأ: ${recovery}.`,
        `الاعتماد على الوقت النهائي: ${deadline}.`,
      ],
      strengthsText: (text: string) => `المجالات الأكثر استقراراً الآن: ${text}.`,
      supportText: (text: string) => `مجال الدعم الأهم الآن: ${text}.`,
      meaningText: (story: string, pattern: string) => `${story} ${pattern}`,
      nextLessonText: (move: string) => `الخطوة الموصى بها: ${move}`,
      questionText: (index: number, prompt: string, why: string) => `السؤال ${index}: ${prompt} ${why}`,
      focusWhyMissed: 'من المفيد إعادة فتح الصياغة والفكرة الأساسية قبل المتابعة.',
      focusWhyRevision: 'هذا البند يُظهر مراجعة غير مستقرة، لذا من الأفضل طلب تفسير الاختيار قبل التثبيت.',
      focusWhyDeadline: 'يبدو أن هذا مرتبط بضغط الوقت، لذا يفضّل إعادة فحص أكثر هدوءاً لنفس المحتوى.',
    },
  }[language] || {
    printTitle: 'Printable Teaching Summary',
    printSubtitle: 'A short teacher-facing brief: bottom line, meaning, and what to do next.',
    executiveLabel: 'Bottom line',
    evidenceLabel: 'What we observed',
    strengthsLabel: 'What is already working',
    supportLabel: 'Where support is needed',
    meaningLabel: 'What this means instructionally',
    actionsLabel: 'What to do now',
    nextLessonLabel: 'Before the next live lesson',
    classPositionLabel: 'Relative position',
    focusQuestionsLabel: 'Questions worth reopening',
    familyLabel: 'Short home / advisor note',
    summaryTitle: `Support summary: ${data?.participant?.nickname || 'Student'}`,
    sessionLabel: `Pack: ${data?.pack?.title || 'Quizzi session'} · Session #${data?.session?.id || sessionId}`,
    happenedTitle: 'What happened in this game',
    showsTitle: 'What the student already shows',
    neededTitle: 'Where support is needed',
    nextMoveTitle: 'Recommended next move',
    teacherNowLead: 'This does not look like a knowledge gap alone.',
    classPositionText: `Rank #${student?.rank || '-'} in this session, against a class accuracy of ${formatPercent(Number(classSummary?.accuracy || 0), 1)}.`,
    questionPrefix: 'Question',
    noQuestionFocus: 'No single item stands out far above the rest yet, so start with the weakest shared concept.',
    printedOn: `Generated on ${new Date().toLocaleDateString('en-US')}`,
    noHistoryPattern: 'There is not enough history yet to tell whether this is a persistent pattern or a one-off event.',
    stablePattern: 'Pace looks relatively stable, so the main move is concept clarification rather than regulation support.',
    pressurePattern: 'There are unstable moments under pressure, so keep the same material but lower pressure and shorten the decision loop.',
    evidenceLines: (accuracy: string, stress: string, confidence: string, focus: string, recovery: string, deadline: string) => [
      `Session accuracy: ${accuracy}.`,
      `Behavioral stress: ${stress}; confidence: ${confidence}; focus: ${focus}.`,
      `Recovery after misses: ${recovery}.`,
      `Deadline dependence: ${deadline}.`,
    ],
    strengthsText: (text: string) => `Most stable areas right now: ${text}.`,
    supportText: (text: string) => `Main support area right now: ${text}.`,
    meaningText: (story: string, pattern: string) => `${story} ${pattern}`,
    nextLessonText: (move: string) => `Recommended move: ${move}`,
    questionText: (index: number, prompt: string, why: string) => `Question ${index}: ${prompt} ${why}`,
    focusWhyMissed: 'Re-open the wording and the underlying idea before moving on.',
    focusWhyRevision: 'This item shows unstable revision behavior, so ask the student to explain the choice before locking in.',
    focusWhyDeadline: 'This looks deadline-dependent, so a calmer re-check on the same content is the better next step.',
  };
  const attentionQueue = useMemo(
    () =>
      [...questionReview]
        .filter((row: any) => row.status !== 'solid')
        .sort((left: any, right: any) => {
          const severity = (row: any) =>
            (row.status === 'missed' ? 3 : 1)
            + (row.revision_outcome === 'correct_to_incorrect' ? 2 : 0)
            + (Number(row.deadline_dependent) ? 1 : 0);
          return (
            severity(right) - severity(left)
            || Number(right.stress_index || 0) - Number(left.stress_index || 0)
            || Number(left.question_index || 0) - Number(right.question_index || 0)
          );
        }),
    [questionReview],
  );
  const sessionHistory = overallAnalytics?.sessionHistory || analytics?.sessionHistory || [];
  const signalComparisons =
    comparison?.behavior_signals?.length > 0 ? comparison.behavior_signals : buildSignalComparisons(analytics, overallAnalytics);

  const saveMemoryNote = async () => {
    if (!sessionId || !participantId) return;
    try {
      setMemoryNoteSaving(true);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/student/${participantId}/memory-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: memoryNoteDraft }),
      });
      setData((current: any) => ({
        ...(current || {}),
        student_memory: payload?.student_memory || current?.student_memory,
      }));
    } catch (saveError: any) {
        setError(saveError?.message || t('Failed to save memory note'));
    } finally {
      setMemoryNoteSaving(false);
    }
  };

  const teacherMoves = useMemo(() => {
    const moves: Array<{ title: string; body: string }> = [];

    if (student?.risk_level === 'high' || analytics?.risk?.level === 'high') {
      moves.push({
        title: 'Immediate targeted follow-up',
        body: 'This learner shows a combination of low mastery and unstable decision patterns. A same-material adaptive game is recommended before the next assessment.',
      });
    }
    if ((analytics?.aggregates?.total_panic_swaps || 0) > 0) {
      moves.push({
        title: 'Reduce last-second overload',
        body: 'Panic swaps were recorded. Reuse the same concept set with clearer distractors or slightly calmer pacing.',
      });
    }
    if ((analytics?.aggregates?.total_focus_loss || 0) > 0) {
      moves.push({
        title: 'Watch attention stability',
        body: 'The student left the active play context during the session. Keep the follow-up shorter and more tightly scaffolded.',
      });
    }
    if ((analytics?.profile?.weak_tags || []).length > 0) {
      moves.push({
        title: 'Aim the next round at weak tags',
        body: `Focus the adaptive game on ${(analytics?.profile?.weak_tags || []).slice(0, 2).join(', ')} before returning to mixed review.`,
      });
    }
    if ((analytics?.revisionInsights?.changed_away_from_correct_count || 0) > 0) {
      moves.push({
        title: 'Coach commitment after correct starts',
        body: 'This learner sometimes begins on the right answer and revises away from it. Add short explain-your-choice pauses before lock-in.',
      });
    }
    if ((analytics?.deadlineProfile?.last_second_rate || 0) >= 30) {
      moves.push({
        title: 'Reduce deadline dependence',
        body: 'A large share of decisions are landing in the final second. Reuse the same material with calmer pacing or explicit early-commit prompts.',
      });
    }
    if ((analytics?.recoveryProfile?.total_followups || 0) > 0 && (analytics?.recoveryProfile?.recovery_rate || 0) < 50) {
      moves.push({
        title: 'Support recovery after misses',
        body: 'The question after an error often stays unstable. A short reteach loop immediately after mistakes should help.',
      });
    }

    return moves.slice(0, 4);
  }, [analytics, student]);

  const supportSnapshot = useMemo(() => {
    const translateTags = (tags: string[]) => tags.map((tag) => t(tag)).filter(Boolean);
    const weakTags = (analytics?.practicePlan?.focus_tags || analytics?.profile?.weak_tags || []).slice(0, 3);
    const strongTags = (analytics?.profile?.strong_tags || overallAnalytics?.profile?.strong_tags || []).slice(0, 3);
    const translatedStrongTags = translateTags(strongTags);
    const translatedWeakTags = translateTags(weakTags);
    const accuracy = formatPercent(Number(analytics?.stats?.accuracy || student?.accuracy || 0));
    const stress = formatPercent(Number(analytics?.risk?.stress_index || student?.stress_index || 0));
    const confidence = formatPercent(Number(analytics?.profile?.confidence_score || 0));
    const focus = Number(analytics?.profile?.focus_score || 0).toFixed(0);
    const recovery = formatPercent(Number(recoveryProfile?.recovery_rate || 0), 1);
    const deadline = formatPercent(Number(deadlineProfile?.last_second_rate || 0), 1);
    const story = t(analytics?.overallStory?.body || analytics?.profile?.body || 'No interpretation was produced yet.');
    const pattern = (deadlineProfile?.last_second_rate || 0) >= 25 || (analytics?.risk?.stress_index || 0) >= 35
      ? summaryCopy.pressurePattern
      : summaryCopy.stablePattern;
    const strengths = translatedStrongTags.length > 0
      ? summaryCopy.strengthsText(translatedStrongTags.join(', '))
      : t('The student is currently strongest when the question format feels familiar and the decision path stays stable.');
    const watchouts = translatedWeakTags.length > 0
      ? summaryCopy.supportText(translatedWeakTags.join(', '))
      : t('The main support area is decision stability under pressure rather than one single content gap.');
    const sessionRead = language === 'he'
      ? `${data?.participant?.nickname} סיים/ה את הסשן הזה עם ${accuracy} דיוק, ${stress} לחץ, ביטחון ${confidence} וריכוז ${focus}.`
      : language === 'ar'
        ? `${data?.participant?.nickname} أنهى/أنهت هذه الجلسة بدقة ${accuracy}، ضغط ${stress}، ثقة ${confidence} وتركيز ${focus}.`
        : `${data?.participant?.nickname} finished this session with ${accuracy} accuracy, ${stress} stress, ${confidence} confidence, and ${focus} focus.`;
    const nextMove =
      student?.recommendation
      || analytics?.practicePlan?.body
      || teacherMoves[0]?.body
      || 'A short same-material adaptive game is the next recommended move.';
    const familyNote =
      student?.risk_level === 'high' || analytics?.risk?.level === 'high'
        ? 'This learner would benefit from a short, low-pressure re-entry step before the next bigger assessment.'
        : 'A short same-topic check-in this week should be enough to keep momentum stable.';
    const focusQuestions = attentionQueue.slice(0, 3).map((row: any) => {
      const why = row.revision_outcome === 'correct_to_incorrect'
        ? summaryCopy.focusWhyRevision
        : row.deadline_dependent
          ? summaryCopy.focusWhyDeadline
          : summaryCopy.focusWhyMissed;
      return summaryCopy.questionText(Number(row.question_index || 0), t(row.prompt || row.question_text || ''), why);
    });
    const evidence = summaryCopy.evidenceLines(accuracy, stress, confidence, focus, recovery, deadline);
    const executiveSummary = summaryCopy.nextLessonText(t(nextMove));
    const meaning = summaryCopy.meaningText(summaryCopy.teacherNowLead, `${story} ${sessionHistory.length > 0 ? pattern : summaryCopy.noHistoryPattern}`.trim());

    const lines = [
      summaryCopy.summaryTitle,
      summaryCopy.sessionLabel,
      '',
      `${summaryCopy.executiveLabel}: ${executiveSummary}`,
      '',
      `${summaryCopy.happenedTitle}: ${sessionRead}`,
      `${summaryCopy.strengthsLabel}: ${strengths}`,
      `${summaryCopy.supportLabel}: ${watchouts}`,
      `${summaryCopy.meaningLabel}: ${meaning}`,
      `${summaryCopy.nextMoveTitle}: ${t(nextMove)}`,
      `${summaryCopy.familyLabel}: ${t(familyNote)}`,
      `${summaryCopy.focusQuestionsLabel}:`,
      ...(focusQuestions.length > 0 ? focusQuestions.map((line) => `- ${line}`) : [`- ${summaryCopy.noQuestionFocus}`]),
      '',
      `${summaryCopy.evidenceLabel}:`,
      ...evidence.map((line) => `- ${line}`),
    ];

    return {
      title: summaryCopy.summaryTitle,
      strengths,
      watchouts,
      sessionRead,
      nextMove: t(nextMove),
      familyNote: t(familyNote),
      executiveSummary,
      meaning,
      evidence,
      focusQuestions,
      classPosition: summaryCopy.classPositionText,
      printedOn: summaryCopy.printedOn,
      text: lines.join('\n'),
    };
  }, [
    analytics,
    attentionQueue,
    data?.pack?.title,
    data?.participant?.nickname,
    data?.session?.id,
    deadlineProfile?.last_second_rate,
    language,
    overallAnalytics?.profile?.strong_tags,
    recoveryProfile?.recovery_rate,
    sessionHistory.length,
    sessionId,
    student,
    summaryCopy,
    t,
    teacherMoves,
  ]);

  const handleCreateAdaptiveGame = async () => {
    if (!sessionId || !participantId) return;

    try {
      setIsCreatingGame(true);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/student/${participantId}/adaptive-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: preview?.questions?.length || 5 }),
      });
      navigate(`/teacher/session/${payload.pin}/host`);
    } catch (createError: any) {
      window.alert(createError?.message || copy.adaptiveFailed);
    } finally {
      setIsCreatingGame(false);
    }
  };

  const handleRunMemoryIntervention = async () => {
    if (!sessionId || !participantId) return;

    try {
      setIsCreatingGame(true);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/student/${participantId}/adaptive-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: memoryInterventionPlan?.recommended_count || preview?.questions?.length || 5 }),
      });
      navigate(`/teacher/session/${payload.pin}/host`);
    } catch (createError: any) {
      window.alert(createError?.message || copy.adaptiveFailed);
    } finally {
      setIsCreatingGame(false);
    }
  };

  const handleCopySupportSnapshot = async () => {
    try {
      await navigator.clipboard.writeText(supportSnapshot.text);
      setSnapshotCopied(true);
    } catch (copyError: any) {
      window.alert(copyError?.message || copy.copyFailed);
    }
  };

  if (loading) {
    return (
      <AppLoadingScreen
        dir={language === 'he' ? 'rtl' : 'ltr'}
        label={copy.loading}
        caption={language === 'he' ? 'טוענים מגמות, תשובות ובעיות שדורשות תשומת לב.' : 'Loading trends, answer quality, and the signals that need attention.'}
      />
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-8">
        <div className="bg-white border-4 border-brand-dark rounded-[2rem] shadow-[8px_8px_0px_0px_#1A1A1A] p-8 text-center max-w-xl">
          <p className="text-3xl font-black mb-3">{t('Student dashboard unavailable')}</p>
          <p className="font-bold text-brand-dark/60 mb-6">{t(error || 'No data returned.')}</p>
          <button
            onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
            className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
          >
            {t('Back to Class Analytics')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .print-summary-sheet {
          display: none;
        }
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }
          body {
            background: #ffffff !important;
          }
          .screen-only-student-analytics {
            display: none !important;
          }
          .print-summary-sheet {
            display: block !important;
            color: #111111;
            font-family: Arial, sans-serif;
          }
          .print-summary-sheet * {
            box-sizing: border-box;
          }
          .print-summary-card {
            border: 2px solid #111111;
            border-radius: 18px;
            padding: 14px 16px;
            margin-bottom: 12px;
            break-inside: avoid;
          }
          .print-summary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }
          .print-summary-eyebrow {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 6px;
            color: #444444;
          }
          .print-summary-sheet h1,
          .print-summary-sheet h2,
          .print-summary-sheet h3,
          .print-summary-sheet p,
          .print-summary-sheet li {
            margin: 0;
          }
          .print-summary-sheet ul {
            margin: 0;
            padding-inline-start: 18px;
          }
        }
      `}</style>

      <section className="print-summary-sheet" dir={language === 'he' ? 'rtl' : language === 'ar' ? 'rtl' : 'ltr'}>
        <div style={{ marginBottom: '14px' }}>
          <p className="print-summary-eyebrow">{summaryCopy.printTitle}</p>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px' }}>{data?.participant?.nickname}</h1>
          <p style={{ fontSize: '14px', color: '#444444', marginBottom: '4px' }}>{summaryCopy.sessionLabel}</p>
          <p style={{ fontSize: '13px', color: '#555555' }}>{summaryCopy.printSubtitle}</p>
        </div>

        <div className="print-summary-card">
          <p className="print-summary-eyebrow">{summaryCopy.executiveLabel}</p>
          <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>
            {t(student?.headline || analytics?.practicePlan?.headline || analytics?.overallStory?.headline || analytics?.profile?.headline || 'Monitor')}
          </h2>
          <p style={{ fontSize: '14px', lineHeight: 1.55, marginBottom: '8px' }}>{supportSnapshot.executiveSummary}</p>
          <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{supportSnapshot.meaning}</p>
        </div>

        <div className="print-summary-grid">
          <div className="print-summary-card">
            <p className="print-summary-eyebrow">{summaryCopy.evidenceLabel}</p>
            <ul style={{ display: 'grid', gap: '6px', fontSize: '13px', lineHeight: 1.5 }}>
              {supportSnapshot.evidence.map((line: string) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="print-summary-card">
            <p className="print-summary-eyebrow">{summaryCopy.classPositionLabel}</p>
            <p style={{ fontSize: '14px', lineHeight: 1.55, marginBottom: '10px' }}>{supportSnapshot.classPosition}</p>
            <p className="print-summary-eyebrow" style={{ marginBottom: '6px' }}>{summaryCopy.nextLessonLabel}</p>
            <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{supportSnapshot.nextMove}</p>
          </div>
        </div>

        <div className="print-summary-grid">
          <div className="print-summary-card">
            <p className="print-summary-eyebrow">{summaryCopy.strengthsLabel}</p>
            <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{supportSnapshot.strengths}</p>
          </div>

          <div className="print-summary-card">
            <p className="print-summary-eyebrow">{summaryCopy.supportLabel}</p>
            <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{supportSnapshot.watchouts}</p>
          </div>
        </div>

        <div className="print-summary-card">
          <p className="print-summary-eyebrow">{summaryCopy.focusQuestionsLabel}</p>
          {supportSnapshot.focusQuestions.length > 0 ? (
            <ul style={{ display: 'grid', gap: '8px', fontSize: '13px', lineHeight: 1.5 }}>
              {supportSnapshot.focusQuestions.map((line: string) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{summaryCopy.noQuestionFocus}</p>
          )}
        </div>

        <div className="print-summary-card">
          <p className="print-summary-eyebrow">{summaryCopy.familyLabel}</p>
          <p style={{ fontSize: '14px', lineHeight: 1.55 }}>{supportSnapshot.familyNote}</p>
        </div>

        <p style={{ fontSize: '12px', color: '#666666' }}>{supportSnapshot.printedOn}</p>
      </section>

      <div className="screen-only-student-analytics min-h-screen bg-brand-bg text-brand-dark font-sans pb-20 selection:bg-brand-orange selection:text-white">
      <div className="absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)] pointer-events-none" />

      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b-4 border-brand-dark shadow-[0_4px_0px_0px_#1A1A1A]">
        <div className="max-w-[1450px] mx-auto px-4 sm:px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
              className="w-12 h-12 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t('Student Drill-Down')}</p>
              <h1 className="text-3xl font-black tracking-tight">{data?.participant?.nickname}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]">
                  {data?.participant?.account_linked ? t('Account linked') : t('Session only')}
                </span>
                <span className="inline-flex items-center rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em]">
                  {data?.participant?.profile_mode === 'longitudinal' ? t('Longitudinal profile') : t('Single-session profile')}
                </span>
              </div>
              <p className="font-bold text-brand-dark/60">
                {data?.pack?.title} · Session #{data?.session?.id} · Rank #{student?.rank || '-'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {error && (
              <div className="px-4 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black text-sm">
                {t('Fallback data loaded')}
              </div>
            )}
            <button
              onClick={loadStudentAnalytics}
              className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <RefreshCw className="w-4 h-4" />
              {t('Refresh')}
            </button>
            <button
              onClick={() => void handleCopySupportSnapshot()}
              className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              {snapshotCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {snapshotCopied ? 'התקציר הועתק' : 'העתק תקציר תמיכה'}
            </button>
            <button
              onClick={() => window.print()}
              className="px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <Printer className="w-4 h-4" />
              {t('Print Snapshot')}
            </button>
            <button
              onClick={handleCreateAdaptiveGame}
              disabled={isCreatingGame}
              className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {isCreatingGame ? 'יוצר משחק...' : 'בנה וארח משחק אדפטיבי'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1450px] mx-auto px-4 sm:px-6 pt-8 sm:pt-10 relative z-10">
        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 mb-8">
          <div className="bg-brand-dark text-white rounded-[2.6rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8 overflow-hidden relative">
            <div className="absolute top-[-25px] right-[-20px] w-56 h-56 rounded-full bg-white/10" />
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`px-4 py-2 rounded-full border-2 border-white/30 font-black ${riskChip(student?.risk_level || analytics?.risk?.level)}`}>
                  {t(String(student?.risk_level || analytics?.risk?.level || 'low').toUpperCase())} {t('RISK')}
                </span>
                <span className="px-4 py-2 rounded-full border-2 border-white/20 bg-white/10 font-black">
                  {t(analytics?.profile?.decision_style)}
                </span>
              </div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">{t('Session-Specific Read')}</p>
              <h2 className="text-4xl font-black leading-tight mb-3">
                {t(analytics?.overallStory?.headline || analytics?.profile?.headline)}
              </h2>
              <p className="text-lg font-medium text-white/75 mb-6">
                {t(analytics?.overallStory?.body || analytics?.profile?.body)}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <HeroStat label={t('Game Accuracy')} value={`${Number(analytics?.stats?.accuracy || student?.accuracy || 0).toFixed(0)}%`} />
                <HeroStat label={t('Stress')} value={`${Number(analytics?.risk?.stress_index || student?.stress_index || 0).toFixed(0)}%`} />
                <HeroStat label={t('Confidence')} value={Number(analytics?.profile?.confidence_score || 0).toFixed(0)} />
                <HeroStat label={t('Focus')} value={Number(analytics?.profile?.focus_score || 0).toFixed(0)} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <TrendingUp className="w-6 h-6 text-brand-purple" />
              <h2 className="text-3xl font-black">{t('Game Vs Overall Baseline')}</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <DeltaCard label={t('Accuracy Delta')} value={comparison?.accuracy_delta} helper={t(`Overall ${Number(overallAnalytics?.stats?.accuracy || 0).toFixed(1)}%`)} />
              <DeltaCard label={t('Stress Delta')} value={comparison?.stress_delta} helper={t(`Overall ${Number(overallAnalytics?.risk?.stress_index || 0).toFixed(1)}%`)} />
              <DeltaCard label={t('Confidence Delta')} value={comparison?.confidence_delta} helper={t(`Overall ${Number(overallAnalytics?.profile?.confidence_score || 0).toFixed(0)}`)} />
              <DeltaCard label={t('Focus Delta')} value={comparison?.focus_delta} helper={t(`Overall ${Number(overallAnalytics?.profile?.focus_score || 0).toFixed(0)}`)} />
            </div>

            <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Teacher Recommendation')}</p>
              <p className="text-xl font-black mb-2">{t(student?.headline || analytics?.practicePlan?.headline)}</p>
              <p className="font-medium text-brand-dark/70">
                {t(student?.recommendation || analytics?.practicePlan?.body)}
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-6 mb-8">
          <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Teacher Trust Mode</p>
                <h2 className="text-3xl font-black">{t('Why we think this is true')}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">
                  {t('Every student read is now split into observed facts, interpretation, and the next teaching move.')}
                </p>
              </div>
              <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-brand-dark/55">
                {String(analytics?.analytics_version || trust?.analytics_version || 'n/a').replace(/_/g, ' ')}
              </div>
            </div>

            <div className="grid gap-3">
              <TrustStoryCard
                eyebrow="Observed facts"
                title={trustObservedFacts?.headline || 'Observed facts'}
                body={t(trustObservedFacts?.body || 'The system has not produced an evidence read for this student yet.')}
                tone="bg-brand-bg"
              />
              <TrustStoryCard
                eyebrow="Derived interpretation"
                title={t(trustInterpretation?.headline || analytics?.overallStory?.headline || analytics?.profile?.headline || 'Session-specific interpretation')}
                body={t(trustInterpretation?.body || analytics?.overallStory?.body || analytics?.profile?.body || 'No interpretation was produced yet.')}
                tone="bg-[#eef0ff]"
              />
              <TrustStoryCard
                eyebrow="Teacher action"
                title={t(trustTeacherAction?.label || trustTeacherAction?.title || 'Monitor')}
                body={t(trustTeacherAction?.body || analytics?.practicePlan?.body || 'Watch the next game for a cleaner signal before changing the instruction plan.')}
                tone="bg-[#fff6db]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <TrustBadge label="Signal quality" value={analytics?.risk?.signal_quality || trust?.signal_quality || 'low'} />
              <TrustBadge label="Confidence band" value={analytics?.risk?.confidence_band || trust?.confidence_band || 'low'} />
              <TrustBadge label="Evidence count" value={analytics?.risk?.evidence_count ?? trust?.evidence_count ?? 0} />
              <TrustBadge label="Suppressed" value={(analytics?.risk?.suppressed_reason || trust?.suppressed_reason) ? 'Yes' : 'No'} />
            </div>
          </div>

          <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <Gauge className="w-6 h-6 text-brand-purple" />
              <div>
              <h2 className="text-3xl font-black">{t('Assessment vs behavior')}</h2>
              <p className="font-bold text-brand-dark/60 mt-1">
                {t('Separate grading-safe evidence from game-behavior signals before you act on the report.')}
              </p>
              </div>
            </div>

            <div className="space-y-4">
              <TrustMetricGroup
                title="Grading-safe metrics"
                metrics={gradingSafeMetrics}
                emptyBody="No grading-safe metrics were returned for this student yet."
              />
              <TrustMetricGroup
                title="Behavior signals"
                metrics={behaviorSignalMetrics}
                emptyBody="No behavior metrics were returned for this student yet."
              />
              {(analytics?.risk?.suppressed_reason || trust?.suppressed_reason) && (
                <div className="rounded-[1.3rem] border-2 border-dashed border-brand-dark/25 bg-brand-bg p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">Suppressed reason</p>
                  <p className="font-medium text-brand-dark/70">{analytics?.risk?.suppressed_reason || trust?.suppressed_reason}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5 mb-5">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <Users className="w-6 h-6 text-brand-purple" />
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('Support Snapshot')}</p>
                </div>
                <h2 className="text-3xl font-black">{supportSnapshot.title}</h2>
                <p className="font-bold text-brand-dark/60 mt-2">
                  {t('A short plain-language summary you can reuse with a parent, advisor, coordinator, or support teacher.')}
                </p>
              </div>
              <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 font-black">
                {t(`Session #${data?.session?.id}`)}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <SnapshotBlock title="What happened in this game" body={supportSnapshot.sessionRead} tone="bg-brand-bg" />
              <SnapshotBlock title="What the student already shows" body={supportSnapshot.strengths} tone="bg-emerald-50" />
              <SnapshotBlock title="Where support is needed" body={supportSnapshot.watchouts} tone="bg-brand-yellow/25" />
              <SnapshotBlock title="Recommended next move" body={supportSnapshot.nextMove} tone="bg-brand-orange/10" />
            </div>

            <div className="mt-4 rounded-[1.5rem] border-2 border-brand-dark bg-brand-dark p-5 text-white">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Home / Advisor Note')}</p>
              <p className="font-medium text-white/80">{t(supportSnapshot.familyNote)}</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <InfoPanel title="Weakest Tags" icon={<TriangleAlert className="w-5 h-5" />} accent="bg-brand-orange">
            <TagCloud tags={analytics?.practicePlan?.focus_tags || analytics?.profile?.weak_tags || []} tone="weak" />
          </InfoPanel>
          <InfoPanel title="Strongest Tags" icon={<Target className="w-5 h-5" />} accent="bg-emerald-400">
            <TagCloud tags={analytics?.profile?.strong_tags || overallAnalytics?.profile?.strong_tags || []} tone="strong" />
          </InfoPanel>
          <InfoPanel title="Teacher Moves" icon={<BrainCircuit className="w-5 h-5" />} accent="bg-brand-purple">
            <div className="space-y-3">
              {teacherMoves.length > 0 ? (
                teacherMoves.map((item) => (
                  <div key={item.title} className="rounded-2xl border-2 border-brand-dark bg-white p-4">
                    <p className="font-black mb-1">{t(item.title)}</p>
                    <p className="font-medium text-brand-dark/70">{t(item.body)}</p>
                  </div>
                ))
              ) : (
                <p className="font-bold text-brand-dark/60">{t('No extra intervention signal was generated for this student.')}</p>
              )}
            </div>
          </InfoPanel>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 mb-8">
          <TeacherSurface
            title="Analytics V2 Overlay"
            subtitle="Validated modeling, trust suppression, and the recommended intervention path from the new engine."
            icon={<BrainCircuit className="w-6 h-6 text-brand-purple" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
              <CompactMetric label="Engagement State" value={`${humanizeAnalyticsToken(engagementModel?.state)} · ${Number(engagementModel?.score || 0).toFixed(0)}`} />
              <CompactMetric label="Intervention Call" value={actionLabel(interventionModel?.recommended_action || trustTeacherAction || analytics?.practicePlan?.teacher_action)} />
              <CompactMetric label="Suppressed Metrics" value={signalSuppressedMetrics.length} />
              <CompactMetric label="Observed Labels" value={recentAnalyticsLabels.length} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {modelPredictions.length > 0 ? (
                modelPredictions.map((prediction: any) => (
                  <div key={prediction.id} className={`rounded-[1.5rem] border-2 border-brand-dark p-5 ${modelTone(prediction.state)}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{humanizeAnalyticsToken(prediction.id)}</p>
                        <p className="text-3xl font-black">{Number(prediction.score || 0).toFixed(0)}%</p>
                      </div>
                      <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black shrink-0">
                        {humanizeAnalyticsToken(prediction.state)}
                      </span>
                    </div>
                    <p className="font-medium text-brand-dark/72 mb-3">Recommended move: {actionLabel(prediction.recommended_action)}</p>
                    <div className="flex flex-wrap gap-2">
                      {(prediction.top_contributors || []).map((contributor: string) => (
                        <span key={`${prediction.id}-${contributor}`} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-white text-[11px] font-black">
                          {humanizeAnalyticsToken(contributor)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<BrainCircuit className="w-8 h-8" />}
                  title="No modeled intervention yet"
                  body="The engine needs a little more evidence before promoting a modeled recommendation."
                />
              )}
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">Trust gating</p>
              {signalSuppressedMetrics.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {signalSuppressedMetrics.map((metric: string) => (
                    <span key={metric} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-white text-xs font-black">
                      {humanizeAnalyticsToken(metric)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="font-medium text-brand-dark/70">No sensitive metrics are currently suppressed for this student.</p>
              )}
            </div>
          </TeacherSurface>

          <TeacherSurface
            title="Concept Trace"
            subtitle="How the new concept-level memory and validation layers explain this session."
            icon={<Layers3 className="w-6 h-6 text-brand-orange" />}
          >
            <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5 mb-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">Concept mastery snapshot</p>
              <MasteryBarChart rows={masterySnapshotRows} limit={5} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {conceptAttemptHistory.length > 0 ? (
                conceptAttemptHistory.slice(0, 4).map((entry: any, index: number) => (
                  <div key={`${entry.concept_id || 'concept'}-${entry.attempt_number || index}`} className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">
                      {humanizeAnalyticsToken(entry.concept_id)}
                    </p>
                    <p className="text-xl font-black mb-3">Attempt {Number(entry.attempt_number || 0)}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <CompactMetric label="Prior Mastery" value={`${Number(entry.prior_mastery || 0).toFixed(0)}%`} />
                      <CompactMetric label="Rolling Accuracy" value={`${Number(entry.rolling_accuracy_5 || 0).toFixed(0)}%`} />
                      <CompactMetric label="Rolling Stress" value={`${Number(entry.rolling_stress_5 || 0).toFixed(0)}%`} />
                      <CompactMetric label="Rolling Engagement" value={`${Number(entry.rolling_engagement_5 || 0).toFixed(0)}%`} />
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<Layers3 className="w-8 h-8" />}
                  title="No concept history yet"
                  body="As this learner revisits the same concepts, this panel will show retention and rolling mastery context."
                />
              )}
            </div>

            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">Recent validation labels</p>
              {recentAnalyticsLabels.length > 0 ? (
                <div className="space-y-3">
                  {recentAnalyticsLabels.slice(0, 5).map((label: any, index: number) => (
                    <div key={`${label.label_type || 'label'}-${label.labeled_at || index}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                        <p className="font-black">{humanizeAnalyticsToken(label.label_type)}</p>
                        <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-[11px] font-black">
                          {labelSourceLabel(label.source)}
                        </span>
                      </div>
                      <p className="font-medium text-brand-dark/70">
                        Value: <span className="font-black text-brand-dark">{humanizeAnalyticsToken(String(label.label_value || ''))}</span>
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-medium text-brand-dark/70">No teacher, self-report, or automatic validation labels are attached to this run yet.</p>
              )}
            </div>
          </TeacherSurface>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-8">
          <TeacherSurface
            title="Decision Intelligence"
            subtitle="Separate content knowledge from hesitation, revision quality, and last-second dependency."
            icon={<BrainCircuit className="w-6 h-6 text-brand-purple" />}
          >
            <div className="mb-6">
              <RevisionCategoryChart categories={revisionInsights?.categories || []} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <CompactMetric label="1st Choice" value={`${Number(revisionInsights?.first_choice_correct_rate || 0).toFixed(1)}%`} />
              <CompactMetric label="Recovered" value={`${Number(revisionInsights?.corrected_after_wrong_rate || 0).toFixed(1)}%`} />
              <CompactMetric label="Wrong Revision" value={`${Number(revisionInsights?.changed_away_from_correct_rate || 0).toFixed(1)}%`} />
              <CompactMetric label="Commit Latency" value={formatMs(Number(analytics?.aggregates?.avg_commitment_latency_ms || 0))} />
              <CompactMetric label="Deadline Dep." value={`${Number(deadlineProfile?.last_second_rate || 0).toFixed(1)}%`} />
              <CompactMetric label="Stability" value={stabilityScore.toFixed(0)} />
              <CompactMetric label="Verified Correct" value={`${Number(revisionInsights?.verified_correct_rate || 0).toFixed(1)}%`} />
              <CompactMetric label="Stayed Wrong" value={`${Number(revisionInsights?.stayed_wrong_rate || 0).toFixed(1)}%`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(revisionInsights?.categories || []).map((category: any) => (
                <div key={category.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-black">{t(category.label)}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{t(`${category.count} questions`)}</p>
                    </div>
                    <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
                      {Number(category.rate || 0).toFixed(1)}%
                    </span>
                  </div>
                  <MetricBar
                    value={Number(category.rate || 0)}
                    tone={category.id === 'incorrect_to_correct' || category.id === 'correct_verified' ? 'good' : category.id === 'correct_to_incorrect' ? 'bad' : 'mid'}
                  />
                </div>
              ))}
            </div>
          </TeacherSurface>

          <TeacherSurface
            title="Recovery And Fatigue"
            subtitle="What happens after errors, and whether the student fades or stabilizes as the game goes on."
            icon={<Clock3 className="w-6 h-6 text-brand-orange" />}
          >
            <div className="space-y-5">
              <div className={`rounded-[1.75rem] border-2 border-brand-dark p-5 ${fatigueTone(fatigueDrift?.direction)}`}>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Fatigue Drift')}</p>
                <p className="text-2xl font-black mb-2">{t(fatigueDrift?.headline || 'No drift estimate yet')}</p>
                <p className="font-medium text-brand-dark/70">{t(fatigueDrift?.body || 'There are not enough answered questions yet to estimate drift.')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <CompactMetric label="Recovery Rate" value={`${Number(recoveryProfile?.recovery_rate || 0).toFixed(1)}%`} />
                <CompactMetric label="Pattern" value={recoveryProfile?.dominant_pattern || 'No misses yet'} />
                <CompactMetric label="Early Accuracy" value={`${Number(fatigueDrift?.early_accuracy || 0).toFixed(0)}%`} />
                <CompactMetric label="Late Accuracy" value={`${Number(fatigueDrift?.late_accuracy || 0).toFixed(0)}%`} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <CompactMetric label="Resp Delta" value={formatDeltaMs(Number(fatigueDrift?.response_delta_ms || 0))} />
                <CompactMetric label="Volatility Delta" value={formatSigned(Number(fatigueDrift?.volatility_delta || 0), '%')} />
                <CompactMetric label="Pressure Errors" value={`${Number(deadlineProfile?.errors_under_pressure_rate || 0).toFixed(1)}%`} />
                <CompactMetric label="Last-second Success" value={`${Number(deadlineProfile?.last_second_correct_rate || 0).toFixed(1)}%`} />
              </div>

              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">Topic behavior profile</p>
                <MasteryBarChart rows={tagBehaviorProfiles} limit={4} />
              </div>

              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Repeated misconception pattern</p>
                {misconceptionPatterns.length > 0 ? (
                  <div className="space-y-3">
                    {misconceptionPatterns.slice(0, 3).map((pattern: any) => (
                      <div key={`${pattern.tag}-${pattern.choice_label}-${pattern.choice_text}`} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                <p className="font-black mb-1 capitalize">{t(pattern.tag)}</p>
                <p className="font-medium text-brand-dark/70">
                          {t(`Keeps landing on ${pattern.choice_label}. ${pattern.choice_text} across ${pattern.question_count} questions.`)}
                </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-medium text-brand-dark/70">No repeated distractor pattern rose above the minimum confidence threshold.</p>
                )}
              </div>
            </div>
          </TeacherSurface>
        </section>

        {studentMemory && (
          <section className="grid grid-cols-1 xl:grid-cols-[1.02fr_0.98fr] gap-6 mb-8">
            <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Student memory</p>
                  <h2 className="text-3xl font-black">{studentMemory.summary?.headline}</h2>
                </div>
                <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black">
                  {studentMemory.recommended_next_step?.action || 'monitor'}
                </span>
              </div>
              <p className="font-bold text-brand-dark/68 mb-6">{studentMemory.summary?.body}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <DeltaCard label="Remembered accuracy" value={Number(studentMemory.history_rollup?.accuracy_pct || 0) - Number(overallAnalytics?.stats?.accuracy || 0)} helper={`${Number(studentMemory.history_rollup?.accuracy_pct || 0).toFixed(0)}% memory baseline`} />
                <DeltaCard label="Stress baseline" value={Number(studentMemory.behavior_baseline?.stress_index || 0) - Number(overallAnalytics?.risk?.stress_index || 0)} helper={`${Number(studentMemory.behavior_baseline?.stress_index || 0).toFixed(0)}% memory stress`} />
              </div>

              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">Memory next step</p>
                <p className="text-2xl font-black mb-2">{studentMemory.recommended_next_step?.title}</p>
                <p className="font-medium text-brand-dark/70 mb-4">{studentMemory.recommended_next_step?.body}</p>
                {(studentMemory.recommended_next_step?.reasons || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(studentMemory.recommended_next_step?.reasons || []).map((reason: string) => (
                      <span key={reason} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(studentMemory.recommended_next_step?.focus_tags || []).map((tag: string) => (
                    <span key={`teacher-memory-focus-${tag}`} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                      {tag}
                    </span>
                    ))}
                </div>
              </div>

              {(studentMemory.coaching || studentMemory.trust) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                  {studentMemory.coaching && (
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-[#e9fff1] p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700 mb-2">Coaching layer</p>
                      <p className="font-black text-lg mb-2">{studentMemory.coaching.teacher_message}</p>
                      <p className="font-medium text-brand-dark/70">{studentMemory.coaching.caution}</p>
                    </div>
                  )}
                  {studentMemory.trust && (
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Trust layer</p>
                      <p className="font-black text-lg mb-2">{studentMemory.trust.confidence_band} confidence</p>
                      <p className="font-medium text-brand-dark/70">
                        {studentMemory.trust.evidence_count} signals across {studentMemory.trust.session_count} sessions.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {memoryInterventionPlan && (
                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-yellow/70 p-5 mt-5">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/55 mb-2">Autopilot intervention</p>
                  <p className="text-2xl font-black mb-2">{memoryInterventionPlan.title}</p>
                  <p className="font-medium text-brand-dark/70 mb-4">{memoryInterventionPlan.body}</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(memoryInterventionPlan.reasons || []).map((reason: string) => (
                      <span key={reason} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-white text-xs font-black">
                        {reason}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => void handleRunMemoryIntervention()}
                    disabled={isCreatingGame}
                    className="px-5 py-3 rounded-full border-2 border-brand-dark bg-brand-dark text-white font-black disabled:opacity-60"
                  >
                    {isCreatingGame ? 'Launching...' : 'Launch memory intervention'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-brand-dark text-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-7">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-3">Repeated patterns</p>
              <div className="space-y-4 mb-5">
                {(studentMemory.error_patterns || []).slice(0, 4).map((pattern: any) => (
                  <div key={pattern.id} className="rounded-[1.5rem] border border-white/15 bg-white/10 p-4">
                    <p className="text-lg font-black mb-2">{pattern.label}</p>
                    <p className="font-medium text-white/78">{pattern.body}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(studentMemory.focus_tags || []).map((tag: any) => (
                  <div key={`teacher-memory-tag-${tag.tag}`} className="rounded-[1.5rem] border-2 border-brand-dark bg-white text-brand-dark p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{tag.status}</p>
                    <p className="text-xl font-black mb-2">{tag.tag}</p>
                    <p className="font-bold">{Number(tag.mastery_score || 0).toFixed(0)}% remembered mastery</p>
                  </div>
                ))}
              </div>
              {(studentMemory.memory_timeline || []).length > 0 && (
                <div className="mt-5 rounded-[1.5rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-3">Growth timeline</p>
                  <div className="space-y-3">
                    {(studentMemory.memory_timeline || []).map((entry: any) => (
                      <div key={entry.id} className="rounded-[1.2rem] bg-white/10 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                        <p className="font-black">{t(entry.label)}</p>
                          <p className="text-sm font-bold text-white/70">{Number(entry.accuracy_pct || 0).toFixed(0)}%</p>
                        </div>
                        <p className="text-sm font-medium text-white/72">
                          {t(`Stress ${Number(entry.stress_index || 0).toFixed(0)}% • Confidence ${Number(entry.confidence_score || 0).toFixed(0)}%`)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5 rounded-[1.5rem] border-2 border-brand-dark bg-white text-brand-dark p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t('Teacher note')}</p>
                    <p className="font-medium text-brand-dark/65">{t('Merge your human read into the memory layer.')}</p>
                  </div>
                  <button
                    onClick={() => void saveMemoryNote()}
                    disabled={memoryNoteSaving}
                    className="px-4 py-2 rounded-full border-2 border-brand-dark bg-brand-yellow font-black disabled:opacity-60"
                  >
                    {memoryNoteSaving ? t('Saving...') : t('Save note')}
                  </button>
                </div>
                <textarea
                  value={memoryNoteDraft}
                  onChange={(event) => setMemoryNoteDraft(event.target.value)}
                  rows={4}
                  className="w-full rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg px-4 py-3 font-medium outline-none"
                  placeholder={t('Example: understands the idea verbally but freezes under timer pressure.')}
                />
                {studentMemory.teacher_notes?.updated_at && (
                  <p className="mt-2 text-xs font-bold text-brand-dark/55">
                    {t(`Last updated ${new Date(studentMemory.teacher_notes.updated_at).toLocaleString()}`)}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 mb-8">
          <TeacherSurface
            title="Behavior Architecture"
            subtitle="How this game's behavior compares to the student's longer-term baseline."
            icon={<Gauge className="w-6 h-6 text-brand-purple" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {signalComparisons.map((signal: any) => (
                <div key={signal.id}>
                  <SignalComparisonCard
                    label={signal.label}
                    caption={signal.caption}
                    score={signal.score}
                    overallScore={signal.overall_score}
                    delta={signal.delta}
                  />
                </div>
              ))}
            </div>
          </TeacherSurface>

          <TeacherSurface
            title="Session Flow"
            subtitle="Momentum, fatigue, and pressure across the opening, middle, and closing of the game."
            icon={<Clock3 className="w-6 h-6 text-brand-orange" />}
          >
            <div className="space-y-5">
              <QuestionFlowChart rows={questionReview} />

              <div className={`rounded-[1.75rem] border-2 border-brand-dark p-5 ${momentumTone(analytics?.momentum?.direction)}`}>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Momentum')}</p>
                <p className="text-2xl font-black mb-2">{t(analytics?.momentum?.headline)}</p>
                <p className="font-medium text-brand-dark/70">{t(analytics?.momentum?.body)}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(analytics?.sessionSegments || []).map((segment: any) => (
                  <div key={segment.label} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(segment.label)}</p>
                    <p className="text-3xl font-black mb-2">{Number(segment.accuracy || 0).toFixed(0)}%</p>
                    <p className="font-medium text-brand-dark/70">{t(`Stress ${Number(segment.avg_stress || 0).toFixed(0)}%`)}</p>
                    <p className="font-medium text-brand-dark/70">
                      {t(`Commit ${(Number(segment.avg_commit_window_ms || 0) / 1000).toFixed(1)}s`)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <CompactMetric label="Swaps" value={analytics?.aggregates?.total_swaps || 0} />
                <CompactMetric label="Panic Swaps" value={analytics?.aggregates?.total_panic_swaps || 0} />
                <CompactMetric label="Focus Loss" value={analytics?.aggregates?.total_focus_loss || 0} />
                <CompactMetric label="Avg Idle" value={`${(Number(analytics?.aggregates?.avg_idle_time_ms || 0) / 1000).toFixed(1)}s`} />
              </div>
            </div>
          </TeacherSurface>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-8 mb-8">
          <TeacherSurface
            title="Cross-Session Trajectory"
            subtitle="Whether this session is an anomaly or part of a longer pattern."
            icon={<BarChart3 className="w-6 h-6 text-emerald-500" />}
          >
            {sessionHistory.length > 0 ? (
              <div className="space-y-4">
                <SessionHistoryTrendChart rows={sessionHistory} />

                {sessionHistory.slice(0, 6).map((session: any) => (
                  <div key={session.session_id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="flex flex-col lg:flex-row justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{session.date}</p>
                        <p className="text-2xl font-black">{t(session.pack_title)}</p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <MetricChip label="Score" value={session.score} />
                        <MetricChip label="Accuracy" value={`${Number(session.accuracy || 0).toFixed(0)}%`} />
                        <MetricChip label="Stress" value={`${Number(session.avg_stress || 0).toFixed(0)}%`} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <CompactMetric label="Commit Window" value={`${(Number(session.avg_commit_window_ms || 0) / 1000).toFixed(1)}s`} />
                      <CompactMetric label="Focus Events" value={session.focus_events} />
                      <CompactMetric label="1st Choice" value={`${Number(session.first_choice_accuracy || 0).toFixed(0)}%`} />
                      <CompactMetric label="Deadline Dep." value={`${Number(session.deadline_dependency_rate || 0).toFixed(0)}%`} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Layers3 className="w-8 h-8" />}
                title="No session history yet"
                body="As the student completes more hosted games, this card will show whether today reflects a persistent pattern or a one-off event."
              />
            )}
          </TeacherSurface>

          <TeacherSurface
            title="Adaptive Game Studio"
            subtitle="Build a hostable follow-up from the same source material, tuned to this learner's weak spots."
            icon={<Sparkles className="w-6 h-6 text-brand-orange" />}
          >
            <div className="space-y-5">
              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-yellow p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/60 mb-2">Strategy</p>
                <p className="text-2xl font-black mb-2">{t(preview?.strategy?.headline || 'Adaptive same-material follow-up')}</p>
                <p className="font-medium text-brand-dark/75">{t(preview?.strategy?.body)}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(preview?.strategy?.focus_tags || []).map((tag: string) => (
                  <span key={`focus-${tag}`} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                    {t(tag)}
                  </span>
                ))}
              </div>

              <div className="space-y-3">
                {(preview?.questions || []).slice(0, 4).map((question: any, index: number) => (
                  <div key={`preview-${question.id}-${index}`} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="font-black leading-tight">Q{index + 1}. {t(question.prompt)}</p>
                      <ArrowUpRight className="w-4 h-4 shrink-0 text-brand-purple" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(question.tags || []).map((tag: string) => (
                        <span key={`preview-tag-${question.id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-[11px] font-black capitalize">
                          {t(tag)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleCreateAdaptiveGame}
                disabled={isCreatingGame}
                className="w-full px-6 py-4 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black flex items-center justify-center gap-2 shadow-[3px_3px_0px_0px_#1A1A1A] disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4 text-brand-yellow" />
                {isCreatingGame ? t('Creating...') : t('Build And Host Now')}
              </button>
            </div>
          </TeacherSurface>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8">
          <TeacherSurface
            title="Question-By-Question Lab"
            subtitle="A deep read of hesitation, volatility, and confidence for every item in this game."
            icon={<Users className="w-6 h-6 text-brand-purple" />}
          >
            <div className="space-y-4">
              <QuestionStatusStripChart rows={questionReview} />

              {questionReview.map((question: any) => (
                <div key={question.question_id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <div className="flex flex-col lg:flex-row justify-between gap-4 mb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(`Question ${question.question_index}`)}</p>
                      <p className="text-xl font-black leading-tight mb-3">{t(question.prompt)}</p>
                      <div className="flex flex-wrap gap-2">
                        {(question.tags || []).map((tag: string) => (
                          <span key={`${question.question_id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                            {t(tag)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <StatusBadge status={question.status} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <CompactMetric label="Response" value={`${(Number(question.response_ms || 0) / 1000).toFixed(1)}s`} />
                    <CompactMetric label="Stress" value={`${Number(question.stress_index || 0).toFixed(0)}%`} />
                    <CompactMetric label="Volatility" value={`${Number(question.decision_volatility || 0).toFixed(0)}%`} />
                    <CompactMetric label="Commit" value={question.commit_style} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <CompactMetric label="Swaps" value={question.total_swaps} />
                    <CompactMetric label="Flip-Flops" value={question.flip_flops} />
                    <CompactMetric label="Revisits" value={question.revisit_count} />
                    <CompactMetric label="Deadline Buffer" value={`${(Number(question.deadline_buffer_ms || 0) / 1000).toFixed(1)}s`} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-4 mb-4">
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Choice Journey')}</p>
                      <div className="space-y-2">
                        <p className="font-medium text-brand-dark/70">
                          {t('First choice')}: <span className="font-black text-brand-dark">{question.first_choice_label}. {t(question.first_choice_text)}</span>
                        </p>
                        <p className="font-medium text-brand-dark/70">
                          {t('Final choice')}: <span className="font-black text-brand-dark">{question.final_choice_label}. {t(question.final_choice_text)}</span>
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <JourneyBadge tone={question.first_choice_correct ? 'good' : 'mid'}>
                            {t(question.first_choice_correct ? 'Started correct' : 'Started wrong')}
                          </JourneyBadge>
                          <JourneyBadge tone={question.revision_outcome === 'correct_to_incorrect' ? 'bad' : question.revision_outcome === 'incorrect_to_correct' ? 'good' : 'mid'}>
                            {question.revision_outcome_label}
                          </JourneyBadge>
                          {question.verification_behavior && <JourneyBadge tone="good">{t('Verified')}</JourneyBadge>}
                        </div>
                      </div>
                    </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <CompactMetric label="Commit Latency" value={formatMs(Number(question.commitment_latency_ms || 0))} />
                      <CompactMetric label="1st Choice" value={question.first_choice_correct ? 'Right' : 'Wrong'} />
                      <CompactMetric label="Deadline Dep." value={question.deadline_dependent ? 'Yes' : 'No'} />
                      <CompactMetric label="Pressure" value={question.under_time_pressure ? 'High' : 'Normal'} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <CompactMetric label="Path Type" value={humanizeAnalyticsToken(question.path_type)} />
                    <CompactMetric label="Engagement" value={humanizeAnalyticsToken(question.engagement_state)} />
                    <CompactMetric label="Event Count" value={question.event_count || 0} />
                    <CompactMetric label="Rereads" value={question.prompt_reread_count || 0} />
                  </div>

                  {(Array.isArray(question.event_path_states) && question.event_path_states.length > 0) ||
                  (Array.isArray(question.top_contributors) && question.top_contributors.length > 0) ||
                  Number(question.ui_freeze_count || 0) > 0 ||
                  Number(question.media_open_count || 0) > 0 ? (
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4 mb-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">{t('Observed path evidence')}</p>
                      <div className="flex flex-wrap gap-2">
                        {(question.event_path_states || []).map((state: string) => (
                          <span key={`${question.question_id}-${state}`} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-bg text-xs font-black">
                            {humanizeAnalyticsToken(state)}
                          </span>
                        ))}
                        {(question.top_contributors || []).map((item: string) => (
                          <span key={`${question.question_id}-contributor-${item}`} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-emerald-50 text-xs font-black">
                            {humanizeAnalyticsToken(item)}
                          </span>
                        ))}
                        {Number(question.media_open_count || 0) > 0 && (
                          <span className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-yellow/25 text-xs font-black">
                            Media Opened {question.media_open_count}x
                          </span>
                        )}
                        {Number(question.ui_freeze_count || 0) > 0 && (
                          <span className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-orange/10 text-xs font-black">
                            UI Freeze {question.ui_freeze_count}x
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                    <p className="font-medium text-brand-dark/70">{t(question.recommendation)}</p>
                  </div>
                </div>
              ))}
            </div>
          </TeacherSurface>

          <TeacherSurface
            title="Attention Queue"
            subtitle="The student-specific items that most deserve intervention before the next game."
            icon={<AlertTriangle className="w-6 h-6 text-brand-orange" />}
          >
            <div className="space-y-4">
              {attentionQueue.length > 0 ? (
                attentionQueue.slice(0, 5).map((question: any) => (
                  <div key={`attention-${question.question_id}`} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange">
                        {question.status === 'missed' ? 'Reteach this concept' : 'Stabilize this concept'}
                      </p>
                      {question.status === 'missed' ? (
                        <div className="w-10 h-10 rounded-full bg-brand-orange text-white border-2 border-brand-dark flex items-center justify-center">
                          <XCircle className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-brand-yellow text-brand-dark border-2 border-brand-dark flex items-center justify-center">
                          <AlertTriangle className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <p className="text-xl font-black mb-3">Q{question.question_index}. {question.prompt}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <CompactMetric label="Pace" value={question.pace_label} />
                      <CompactMetric label="Focus Loss" value={question.focus_loss_count} />
                      <CompactMetric label="Revision" value={question.revision_outcome_label} />
                      <CompactMetric label="Commit" value={formatMs(Number(question.commitment_latency_ms || 0))} />
                    </div>
                    <p className="font-medium text-brand-dark/70">{question.recommendation}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.75rem] border-2 border-brand-dark bg-emerald-100 p-6">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700 mb-2">Healthy session</p>
                  <p className="text-2xl font-black mb-2">No unstable questions were detected in this game.</p>
                  <p className="font-medium text-brand-dark/70">
                    The student solved the current pack without clear behavioral fragility. Use overall weak tags to decide whether to deepen or broaden practice.
                  </p>
                </div>
              )}

              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-purple text-white p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70 mb-2">Class Position</p>
                <p className="text-2xl font-black mb-2">Rank #{student?.rank || '-'} in this session</p>
                <p className="font-medium text-white/80 mb-4">
                  Accuracy {Number(student?.accuracy || 0).toFixed(1)}% vs class average {Number(classSummary?.overall_accuracy || 0).toFixed(1)}%.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CompactMetric label="Class Stress" value={`${Number(classSummary?.stress_index || 0).toFixed(0)}%`} />
                  <CompactMetric label="Student Score" value={student?.total_score || 0} />
                </div>
              </div>
            </div>
          </TeacherSurface>
        </section>
      </main>
      </div>
    </>
  );
}

function TeacherSurface({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="bg-white rounded-[2.25rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
      <div className="p-7 border-b-4 border-brand-dark bg-slate-50">
        <div className="flex items-center gap-3 mb-2">
          {icon}
          <h2 className="text-3xl font-black">{t(title)}</h2>
        </div>
        <p className="font-medium text-brand-dark/65">{t(subtitle)}</p>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">{t(label)}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function TrustStoryCard({
  eyebrow,
  title,
  body,
  tone,
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone: string;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className={`rounded-[1.4rem] border-2 border-brand-dark p-4 ${tone}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(eyebrow)}</p>
      <p className="font-black leading-tight">{t(title)}</p>
      <p className="font-medium text-brand-dark/72 mt-2">{t(body)}</p>
    </div>
  );
}

function TrustBadge({ label, value }: { label: string; value: string | number }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.1rem] border-2 border-brand-dark bg-brand-bg px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(label)}</p>
      <p className="text-lg font-black mt-1">{typeof value === 'string' ? t(value) : value}</p>
    </div>
  );
}

function TrustMetricGroup({
  title,
  metrics,
  emptyBody,
}: {
  title: string;
  metrics: any[];
  emptyBody: string;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!metrics.length) {
    return (
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(title)}</p>
        <div className="rounded-[1.3rem] border-2 border-dashed border-brand-dark/20 bg-brand-bg p-4">
          <p className="font-medium text-brand-dark/65">{t(emptyBody)}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(title)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {metrics.map((metric, index) => {
          const unit = String(metric?.unit || '').trim();
          const rawValue = metric?.value;
          const displayValue =
            typeof rawValue === 'number' && Number.isFinite(rawValue)
              ? `${Number(rawValue).toFixed(unit === '%' ? 1 : unit === 'ms' ? 0 : Number.isInteger(rawValue) ? 0 : 1)}${unit ? ` ${unit}` : ''}`
              : `${String(rawValue ?? '--')}${unit ? ` ${unit}` : ''}`;

          return (
            <div key={`${title}-${metric?.label || index}`} className="rounded-[1.1rem] border-2 border-brand-dark bg-white px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(metric?.label || 'Metric')}</p>
              <p className="text-sm font-black mt-1">{typeof displayValue === 'string' ? t(displayValue) : displayValue}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeltaCard({ label, value, helper }: { label: string; value?: number; helper: string }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (value === undefined || value === null || Number.isNaN(value)) {
    return (
      <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{t(label)}</p>
        <p className="text-3xl font-black mb-1">-</p>
        <p className="font-medium text-brand-dark/60">{t(helper)}</p>
      </div>
    );
  }

  const numericValue = Number(value || 0);
  return (
    <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{t(label)}</p>
      <p className={`text-3xl font-black mb-1 ${numericValue >= 0 ? 'text-emerald-600' : 'text-brand-orange'}`}>
        {numericValue >= 0 ? '+' : ''}
        {numericValue.toFixed(1)}
      </p>
      <p className="font-medium text-brand-dark/60">{t(helper)}</p>
    </div>
  );
}

function InfoPanel({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: ReactNode;
  accent: string;
  children: ReactNode;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className={`${accent} w-11 h-11 rounded-2xl border-2 border-brand-dark flex items-center justify-center`}>
          {icon}
        </div>
        <h2 className="text-2xl font-black">{t(title)}</h2>
      </div>
      {children}
    </div>
  );
}

function TagCloud({ tags, tone }: { tags: string[]; tone: 'weak' | 'strong' }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!tags.length) {
    return <p className="font-bold text-brand-dark/60">{t('No tag signal yet for this student.')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={`${tone}-${tag}`}
          className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black capitalize ${tone === 'weak' ? 'bg-brand-orange/10' : 'bg-emerald-100'}`}
        >
          {t(tag)}
        </span>
      ))}
    </div>
  );
}

function SnapshotBlock({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: string;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className={`rounded-[1.5rem] border-2 border-brand-dark p-5 ${tone}`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(title)}</p>
      <p className="font-medium text-brand-dark/75">{t(body)}</p>
    </div>
  );
}

function SignalComparisonCard({
  label,
  caption,
  score,
  overallScore,
  delta,
}: {
  label: string;
  caption: string;
  score: number;
  overallScore?: number | null;
  delta?: number | null;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(label)}</p>
          <p className="text-4xl font-black">{Number(score || 0).toFixed(0)}</p>
        </div>
        {delta !== undefined && delta !== null && (
          <span className={`px-3 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${delta >= 0 ? 'bg-emerald-200' : 'bg-brand-orange/10'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)}
          </span>
        )}
      </div>
      <div className="w-full h-3 rounded-full bg-white border-2 border-brand-dark/10 overflow-hidden p-[2px] mb-3">
        <div className={`h-full rounded-full ${scoreTone(score)}`} style={{ width: `${Math.max(0, Math.min(100, Number(score || 0)))}%` }} />
      </div>
      <p className="font-medium text-brand-dark/68 mb-2">{t(caption)}</p>
      {overallScore !== undefined && overallScore !== null && (
        <p className="text-sm font-bold text-brand-dark/55">{t(`Overall baseline: ${Number(overallScore).toFixed(1)}`)}</p>
      )}
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{t(label)}</p>
      <p className="text-xl font-black break-words leading-tight">{typeof value === 'string' ? t(value) : value}</p>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string | number }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <span className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark text-sm font-black">
      {t(label)}: {typeof value === 'string' ? t(value) : value}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (status === 'missed') {
    return (
      <div className="px-4 py-3 rounded-2xl bg-brand-orange text-white border-2 border-brand-dark font-black flex items-center gap-2">
        <XCircle className="w-4 h-4" />
        {t('Missed')}
      </div>
    );
  }
  if (status === 'shaky') {
    return (
      <div className="px-4 py-3 rounded-2xl bg-brand-yellow text-brand-dark border-2 border-brand-dark font-black flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        {t('Correct But Shaky')}
      </div>
    );
  }
  return (
    <div className="px-4 py-3 rounded-2xl bg-emerald-300 text-brand-dark border-2 border-brand-dark font-black flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4" />
      {t('Stable')}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.75rem] border-2 border-dashed border-brand-dark/30 bg-brand-bg p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-white border-2 border-brand-dark/15 flex items-center justify-center mx-auto mb-4 text-brand-dark/60">
        {icon}
      </div>
      <p className="text-2xl font-black mb-2">{t(title)}</p>
      <p className="font-medium text-brand-dark/65">{t(body)}</p>
    </div>
  );
}

function MetricBar({ value, tone }: { value: number; tone: 'good' | 'mid' | 'bad' }) {
  const color = tone === 'good' ? 'bg-emerald-400' : tone === 'mid' ? 'bg-brand-yellow' : 'bg-brand-orange';
  return (
    <div className="h-3 rounded-full border-2 border-brand-dark bg-white overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} />
    </div>
  );
}

function JourneyBadge({
  tone,
  children,
}: {
  tone: 'good' | 'mid' | 'bad';
  children: ReactNode;
}) {
  const toneClass = tone === 'good' ? 'bg-emerald-100' : tone === 'mid' ? 'bg-brand-yellow/30' : 'bg-brand-orange/15';
  return (
    <span className={`${toneClass} px-3 py-2 rounded-full border-2 border-brand-dark text-xs font-black`}>
      {children}
    </span>
  );
}

function riskChip(level?: string) {
  if (level === 'high') return 'bg-brand-orange text-white';
  if (level === 'medium') return 'bg-brand-yellow text-brand-dark';
  return 'bg-emerald-200 text-brand-dark';
}

function scoreTone(score: number) {
  if (score >= 80) return 'bg-emerald-400';
  if (score >= 55) return 'bg-brand-yellow';
  return 'bg-brand-orange';
}

function momentumTone(direction?: string) {
  if (direction === 'up') return 'bg-emerald-100';
  if (direction === 'down') return 'bg-brand-orange/10';
  return 'bg-brand-bg';
}

function fatigueTone(direction?: string) {
  if (direction === 'fatigue') return 'bg-brand-orange/10';
  if (direction === 'settling_in' || direction === 'stabilizing') return 'bg-emerald-100';
  return 'bg-brand-bg';
}
