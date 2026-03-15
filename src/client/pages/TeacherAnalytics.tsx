import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Download,
  Eye,
  Flame,
  Gauge,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { getGameMode } from '../lib/gameModes.ts';
import { apiFetchJson } from '../lib/api.ts';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'session';
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '0ms';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function csvEscape(value: unknown) {
  if (value == null) return '';
  const text =
    typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'number'
        ? String(Number.isFinite(value) ? value : 0)
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function accuracyTone(value: number) {
  if (value >= 80) return 'good';
  if (value >= 60) return 'mid';
  return 'bad';
}

function riskTone(level?: string) {
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  return 'low';
}

function humanizeTag(value?: string) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function severityRank(level?: string) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

const METRIC_EXPLANATIONS: Record<string, { title: string; body: string }> = {
  accuracy: {
    title: 'מדד דיוק',
    body: 'אחוז התשובות הנכונות מכלל הניסיונות בכיתה. עוזר להבין את רמת השליטה הכללית בחומר.',
  },
  'first-pass': {
    title: 'דיוק בבחירה ראשונה',
    body: 'אחוז הפעמים שבהן הסטודנטים בחרו בתשובה הנכונה כבר בניסיון הראשון, ללא היסוס או שינוי.',
  },
  'harmful-revisions': {
    title: 'שינויים מזיקים',
    body: 'מספר הפעמים שסטודנט שינה תשובה נכונה לתשובה שגויה. מעיד על חוסר ביטחון או הטעיה של מסיחים.',
  },
  pressure: {
    title: 'עומס ולחץ',
    body: 'אחוז התשובות שניתנו בשניות האחרונות לפני תום הזמן. לחץ גבוה עלול לפגוע באיכות קבלת ההחלטות.',
  },
  focus: {
    title: 'איבוד ריכוז',
    body: 'מספר הפעמים שתלמידים יצאו מהטאב או איבדו פוקוס במהלך המשחק. מדד למעורבות וקשב.',
  },
  coverage: {
    title: 'מדד השתתפות',
    body: 'היחס בין מספר התשובות שניתנו לבין המקסימום האפשרי. מראה כמה מהכיתה באמת לקחה חלק פעיל.',
  },
  'decision-quality': {
    title: 'איכות החלטה',
    body: 'בוחן האם התלמידים מגיעים לתשובה מתוך ידע מבוסס או ניחוש, על פי זמן התגובה ודיוק הבחירה הראשונה.',
  },
  'confidence-stability': {
    title: 'יציבות הביטחון',
    body: 'בודק כמה התלמידים דבקים בבחירה שלהם. שינויים רבים מעידים על היסוס, גם אם התוצאה הסופית נכונה.',
  },
  'revision-efficiency': {
    title: 'יעילות תיקון',
    body: 'האם שינוי התשובה עזר לתלמיד (מעבר משגוי לנכון) או הזיק לו. מדד ליכולת למידה תוך כדי תנועה.',
  },
  'attention-drag': {
    title: 'גרירת קשב',
    body: 'מדד לעומס קוגניטיבי המבוסס על תנועות עכבר והיסוס. ערך גבוה מעיד על קושי בעיבוד המידע.',
  },
};

function InfoTooltip({ metricId }: { metricId: string }) {
  const explanation = METRIC_EXPLANATIONS[metricId];
  if (!explanation) return null;

  return (
    <div className="group relative inline-block ml-1.5 focus:outline-none" tabIndex={0}>
      <CircleHelp className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 group-focus:opacity-100 transition-opacity cursor-help" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-64 p-4 bg-brand-dark text-white rounded-2xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus:opacity-100 group-focus:visible transition-all z-50 pointer-events-none">
        <p className="font-black text-brand-yellow text-xs uppercase tracking-widest mb-1">{explanation.title}</p>
        <p className="text-sm font-bold leading-relaxed">{explanation.body}</p>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[8px] border-transparent border-t-brand-dark" />
      </div>
    </div>
  );
}

export default function TeacherAnalytics() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);
  const [isHeaderPinnedOpen, setIsHeaderPinnedOpen] = useState(false);

  const loadAnalytics = async () => {
    if (!sessionId) return;
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}`);
      setData(payload);
      setSelectedStudentId((current) => current ?? (Number(payload?.participants?.[0]?.id ?? 0) || null));
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [sessionId]);

  useEffect(() => {
    const handleScroll = () => {
      const shouldCondense = window.scrollY > 140;
      setIsHeaderCondensed(shouldCondense);
      if (!shouldCondense) {
        setIsHeaderPinnedOpen(false);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const participants = data?.participants || [];
  const questionRows = data?.questions || [];
  const alertList = data?.alerts || [];
  const research = data?.research || {};
  const sequenceDynamics = research?.sequence_dynamics || [];
  const descriptiveStats = research?.descriptive_stats || [];
  const correlations = research?.correlations || [];
  const researchRows = data?.researchRows || [];
  const teams = data?.teams || [];
  const clusters = research?.clusters || [];
  const outliers = research?.outliers || [];
  const questionDiagnostics = research?.question_diagnostics || [];
  const quartileBenchmarks = research?.quartile_benchmarks || {};
  const behaviorPatterns = research?.behavior_patterns || {};
  const revisionIntelligence = research?.revision_intelligence || {};
  const deadlineDependency = research?.deadline_dependency || {};
  const recoveryProfile = research?.recovery_profile || {};
  const fatigueDrift = research?.fatigue_drift || {};
  const recurrentMisconceptions = research?.recurrent_misconceptions || [];
  const topicBehaviorProfiles = research?.topic_behavior_profiles || data?.tagSummary || [];
  const topGapTags = topicBehaviorProfiles.slice(0, 6);
  const accuracyDistribution = data?.distributions?.accuracy || [];
  const stressDistribution = data?.distributions?.stress || [];
  const riskDistribution = data?.distributions?.risk || [];
  const gameMode = getGameMode(data?.session?.game_type);
  const packMeta = data?.pack || null;
  const crossSectionComparison = data?.cross_section_comparison || null;
  const sortedAlerts = useMemo(
    () => [...alertList].sort((left: any, right: any) => severityRank(right.severity) - severityRank(left.severity)),
    [alertList],
  );
  const leadAlert = sortedAlerts[0] || null;
  const leadQuestion = questionDiagnostics[0] || null;
  const leadMisconception = recurrentMisconceptions[0] || null;
  const attentionQueue = data?.studentSpotlight?.attention_needed || [];
  const topAttentionStudents = attentionQueue.slice(0, 3);
  const highRiskFatigueCount = participants.filter(
    (student: any) => student.risk_level === 'high' && student.fatigue_drift?.direction === 'fatigue',
  ).length;
  const fatigueAffectedCount = participants.filter((student: any) => student.fatigue_drift?.direction === 'fatigue').length;
  const firstChoiceRate = Number(revisionIntelligence?.first_choice_correct_rate || data?.summary?.first_choice_accuracy || 0);
  const helpfulRevisionRate = Number(revisionIntelligence?.corrected_after_wrong_rate || 0);
  const harmfulRevisionRate = Number(revisionIntelligence?.changed_away_from_correct_rate || 0);
  const lockedWrongRate = Number(revisionIntelligence?.stayed_wrong_rate || 0);
  const pressureRate = Number(deadlineDependency?.pressure_rate || 0);
  const focusWatchRate = participants.length
    ? (Number(data?.summary?.focus_watch_students || 0) / participants.length) * 100
    : 0;
  const focusEventsPerStudent = participants.length
    ? Number(data?.summary?.total_focus_loss || 0) / participants.length
    : 0;

  const selectedStudent = useMemo(() => {
    if (!participants.length) return null;
    return (
      participants.find((student: any) => Number(student.id) === Number(selectedStudentId)) ||
      participants[0]
    );
  }, [participants, selectedStudentId]);

  const exportBaseName = useMemo(() => {
    const packTitle = data?.session?.pack_title || `session-${sessionId || 'analytics'}`;
    return slugify(packTitle);
  }, [data, sessionId]);
  const showExpandedHeader = !isHeaderCondensed || isHeaderPinnedOpen;
  const lmsCsvRows = useMemo(
    () =>
      participants.map((student: any) => ({
        course_code: packMeta?.course_code || '',
        course_name: packMeta?.course_name || '',
        section_name: packMeta?.section_name || '',
        academic_term: packMeta?.academic_term || '',
        week_label: packMeta?.week_label || '',
        session_id: data?.session?.id || sessionId,
        session_pin: data?.session?.pin || '',
        pack_title: data?.session?.pack_title || packMeta?.title || '',
        participant_id: student.id,
        nickname: student.nickname,
        participation_present: Number(student.answers_count || 0) > 0 ? 1 : 0,
        answers_count: Number(student.answers_count || 0),
        total_score: Number(student.total_score || 0),
        accuracy: Number(student.accuracy || 0),
        stress_index: Number(student.stress_index || 0),
        confidence_score: Number(student.confidence_score || 0),
        risk_level: student.risk_level || '',
      })),
    [data?.session?.id, data?.session?.pack_title, data?.session?.pin, packMeta, participants, sessionId],
  );

  const studentCsvRows = useMemo(
    () =>
      participants.map((student: any) => ({
        participant_id: student.id,
        nickname: student.nickname,
        rank: student.rank,
        total_score: student.total_score,
        accuracy: student.accuracy,
        answers_count: student.answers_count,
        avg_response_ms: student.avg_response_ms,
        avg_tfi_ms: student.avg_tfi_ms,
        total_swaps: student.total_swaps,
        total_panic_swaps: student.total_panic_swaps,
        total_focus_loss: student.total_focus_loss,
        stress_index: student.stress_index,
        stress_level: student.stress_level,
        confidence_score: student.confidence_score,
        focus_score: student.focus_score,
        risk_score: student.risk_score,
        risk_level: student.risk_level,
        first_choice_accuracy: student.first_choice_accuracy,
        avg_commitment_latency_ms: student.avg_commitment_latency_ms,
        corrected_answers: student.corrected_answers,
        changed_away_from_correct: student.changed_away_from_correct,
        deadline_dependency_rate: student.deadline_dependency_rate,
        recovery_rate: student.recovery_rate,
        stability_score: student.stability_score,
        weak_tags: (student.weak_tags || []).join(', '),
        strong_tags: (student.strong_tags || []).join(', '),
        flags: (student.flags || []).join(', '),
        recommendation: student.recommendation,
      })),
    [participants],
  );

  const questionCsvRows = useMemo(
    () =>
      questionDiagnostics.map((row: any) => ({
        question_id: row.question_id,
        question_index: row.question_index,
        question_prompt: row.question_prompt,
        tags: Array.isArray(row.tags) ? row.tags.join(', ') : row.tags,
        learning_objective: row.learning_objective || '',
        bloom_level: row.bloom_level || '',
        accuracy: row.accuracy,
        difficulty_index: row.difficulty_index,
        discrimination_index: row.discrimination_index,
        stress_index: row.stress_index,
        top_group_accuracy: row.top_group_accuracy,
        bottom_group_accuracy: row.bottom_group_accuracy,
        first_choice_accuracy: row.first_choice_accuracy,
        corrected_after_wrong_rate: row.corrected_after_wrong_rate,
        changed_away_from_correct_rate: row.changed_away_from_correct_rate,
        avg_commitment_latency_ms: row.avg_commitment_latency_ms,
        deadline_dependency_rate: row.deadline_dependency_rate,
        top_distractor_label: row.top_distractor?.label || '',
        top_distractor_text: row.top_distractor?.text || '',
        top_distractor_rate: row.top_distractor?.rate || 0,
        avg_response_ms: row.avg_response_ms,
        avg_swaps: row.avg_swaps,
        avg_blur_time_ms: row.avg_blur_time_ms,
        avg_interaction_intensity: row.avg_interaction_intensity,
      })),
    [questionDiagnostics],
  );

  const teamCsvRows = useMemo(
    () =>
      teams.map((team: any) => ({
        team_id: team.team_id,
        team_name: team.team_name,
        rank: team.rank,
        student_count: team.student_count,
        total_score: team.total_score,
        base_score: team.base_score,
        mode_bonus: team.mode_bonus,
        accuracy: team.accuracy,
        consensus_index: team.consensus_index,
        coverage_score: team.coverage_score,
        avg_stress: team.avg_stress,
        avg_focus: team.avg_focus,
        avg_confidence: team.avg_confidence,
        members: (team.members || []).map((member: any) => member.nickname || member).join(', '),
      })),
    [teams],
  );

  const executiveSummary = useMemo(() => {
    const overallAccuracy = Number(data?.summary?.overall_accuracy || 0);
    const averageStress = Number(data?.summary?.stress_index || 0);
    const participantCount = Number(data?.summary?.participant_count || 0);
    const topIssueBody = leadMisconception && leadQuestion
      ? `${leadMisconception.student_count} of ${participantCount || participants.length} students were pulled to distractor ${leadMisconception.choice_label} on Q${leadQuestion.question_index}.`
      : leadAlert?.body || 'No class-wide issue rose above the current threshold.';
    let classStateTitle = 'Stable mastery, low friction';
    let classStateBody = `${overallAccuracy.toFixed(0)}% accuracy with calm pacing across ${participantCount || participants.length} students.`;

    if (overallAccuracy < 60 && averageStress >= 70) {
      classStateTitle = 'Mixed confidence, high pressure';
      classStateBody = `${overallAccuracy.toFixed(0)}% accuracy with ${averageStress.toFixed(0)}% average pressure. This class needs a guided reset before the next check.`;
    } else if (overallAccuracy < 75 || averageStress >= 55) {
      classStateTitle = 'Mixed mastery, uneven confidence';
      classStateBody = `${overallAccuracy.toFixed(0)}% accuracy with pockets of hesitation. Most students can recover, but not consistently.`;
    }

    const topIssueTitle = leadMisconception && leadQuestion
      ? `${humanizeTag(leadMisconception.tag)} is the main confusion cluster`
      : leadAlert?.title || 'No single issue dominates the board';

    let actionTitle = 'Keep the next activity on the same track';
    let actionBody = 'The class is stable enough for a brief practice round without a full reset.';

    if (leadMisconception && leadQuestion) {
      actionTitle = `Run a 2-minute reset on ${humanizeTag(leadMisconception.tag)}`;
      actionBody = `Contrast "${leadMisconception.choice_text}" with the correct idea before the next live question. Start from Q${leadQuestion.question_index}.`;
    } else if (leadAlert?.type === 'student-risk') {
      actionTitle = 'Pull a short targeted follow-up group';
      actionBody = `${Number(data?.summary?.high_risk_students || 0)} students need calmer pacing and same-material re-teaching before the next live run.`;
    } else if (highRiskFatigueCount > 0) {
      actionTitle = 'Intervene with the late-fading group';
      actionBody = `${highRiskFatigueCount} high-risk students show a clear drop late in the session even though the class average stayed flatter.`;
    }

    return {
      classStateTitle,
      classStateBody,
      topIssueTitle,
      topIssueBody,
      actionTitle,
      actionBody,
    };
  }, [data, leadAlert, leadMisconception, leadQuestion, participants.length, highRiskFatigueCount]);

  const topSummaryCards = useMemo(
    () => [
      {
        id: 'class-state',
        label: 'Class State',
        title: executiveSummary.classStateTitle,
        body: executiveSummary.classStateBody,
        accent: 'bg-brand-dark text-white',
      },
      {
        id: 'top-issue',
        label: 'Top Issue',
        title: executiveSummary.topIssueTitle,
        body: executiveSummary.topIssueBody,
        accent: 'bg-brand-yellow text-brand-dark',
      },
      {
        id: 'next-step',
        label: 'Suggested Action',
        title: executiveSummary.actionTitle,
        body: executiveSummary.actionBody,
        accent: 'bg-brand-purple text-white',
      },
    ],
    [executiveSummary],
  );

  const keyMetricCards = useMemo(
    () => [
      {
        id: 'accuracy',
        icon: <Target className="w-5 h-5" />,
        title: 'Accuracy',
        value: `${Number(data?.summary?.overall_accuracy || 0).toFixed(0)}%`,
        status: Number(data?.summary?.overall_accuracy || 0) >= 70 ? 'On track' : 'Below expected',
        note: leadQuestion ? `Q${leadQuestion.question_index} dropped to ${Number(leadQuestion.accuracy || 0).toFixed(0)}%.` : 'Use this as the headline mastery read.',
        color: 'bg-brand-yellow',
      },
      {
        id: 'first-pass',
        icon: <TrendingDown className="w-5 h-5" />,
        title: 'First Pass',
        value: `${firstChoiceRate.toFixed(0)}%`,
        status: firstChoiceRate >= 45 ? 'Initial read is solid' : 'Low initial certainty',
        note: `${helpfulRevisionRate.toFixed(0)}% later corrected themselves.`,
        color: 'bg-white',
      },
      {
        id: 'harmful-revisions',
        icon: <RefreshCw className="w-5 h-5" />,
        title: 'Harmful Revisions',
        value: `${Number(data?.summary?.changed_away_from_correct_count || 0)}`,
        status: harmfulRevisionRate >= 15 ? 'Too many reversals' : 'Reversal rate is contained',
        note: `${harmfulRevisionRate.toFixed(0)}% moved from correct to incorrect.`,
        color: 'bg-brand-orange',
        textColor: 'text-white',
      },
      {
        id: 'pressure',
        icon: <Gauge className="w-5 h-5" />,
        title: 'Pressure Load',
        value: `${pressureRate.toFixed(0)}%`,
        status: pressureRate >= 70 ? 'Most answers landed under pressure' : 'Pressure stayed limited',
        note: `${Number(deadlineDependency?.correct_under_pressure_rate || 0).toFixed(0)}% of pressured answers were still correct.`,
        color: 'bg-brand-dark',
        textColor: 'text-white',
      },
      {
        id: 'focus',
        icon: <Eye className="w-5 h-5" />,
        title: 'Focus Drag',
        value: `${Number(data?.summary?.total_focus_loss || 0)}`,
        status: focusWatchRate >= 60 ? 'Class attention was unstable' : 'Attention mostly held',
        note: `${focusEventsPerStudent.toFixed(1)} focus events per student on average.`,
        color: 'bg-[#d8f1ff]',
      },
      {
        id: 'coverage',
        icon: <Users className="w-5 h-5" />,
        title: 'Coverage',
        value: `${Number(data?.summary?.total_answers || 0)}/${participants.length * Math.max(1, questionRows.length)}`,
        status: Number(data?.summary?.completion_rate || 0) >= 95 ? 'Full participation' : 'Some answers were missed',
        note: `${Number(data?.summary?.completion_rate || 0).toFixed(0)}% completion across ${Number(data?.summary?.question_count || questionRows.length)} questions.`,
        color: 'bg-brand-purple',
        textColor: 'text-white',
      },
    ],
    [
      data,
      deadlineDependency,
      firstChoiceRate,
      focusEventsPerStudent,
      focusWatchRate,
      helpfulRevisionRate,
      harmfulRevisionRate,
      leadQuestion,
      participants.length,
      questionRows.length,
      pressureRate,
    ],
  );

  const decisionVerdicts = useMemo(() => {
    const decisionTone = firstChoiceRate >= 45 ? 'good' : helpfulRevisionRate >= 35 ? 'mid' : 'bad';
    const stabilityTone = harmfulRevisionRate >= 15 || Number(data?.summary?.total_panic_swaps || 0) >= participants.length * 10 ? 'bad' : 'mid';
    const revisionTone = helpfulRevisionRate >= harmfulRevisionRate + 10 ? 'good' : helpfulRevisionRate > harmfulRevisionRate ? 'mid' : 'bad';
    return [
      {
        id: 'decision-quality',
        label: 'Decision Quality',
        title: firstChoiceRate >= 45 ? 'Students usually knew it on the first pass' : helpfulRevisionRate >= 35 ? 'Knowledge is arriving late, not early' : 'Students are guessing before reasoning settles',
        body: `${firstChoiceRate.toFixed(0)}% first-choice correctness with ${helpfulRevisionRate.toFixed(0)}% later self-correction.`,
        tone: decisionTone,
      },
      {
        id: 'confidence-stability',
        label: 'Confidence Stability',
        title: harmfulRevisionRate >= 15 ? 'Too many students talk themselves out of correct answers' : 'Confidence wobbles, but outright reversals stay limited',
        body: `${harmfulRevisionRate.toFixed(0)}% ended wrong after touching the correct answer. ${Number(data?.summary?.total_panic_swaps || 0)} panic swaps were logged.`,
        tone: stabilityTone,
      },
      {
        id: 'revision-efficiency',
        label: 'Revision Efficiency',
        title: helpfulRevisionRate >= harmfulRevisionRate + 10 ? 'Revisions help more than they hurt' : helpfulRevisionRate > harmfulRevisionRate ? 'Revisions are net helpful but still messy' : 'Revisions are not rescuing enough of the class',
        body: `${helpfulRevisionRate.toFixed(0)}% corrected a wrong start. ${lockedWrongRate.toFixed(0)}% stayed wrong all the way through.`,
        tone: revisionTone,
      },
    ];
  }, [data, firstChoiceRate, helpfulRevisionRate, harmfulRevisionRate, lockedWrongRate, participants.length]);

  const decisionFindings = useMemo(
    () => [
      {
        id: 'late-correction',
        title: helpfulRevisionRate >= 35 ? 'Self-correction is visible, but it arrives late' : 'Few students recover once they start wrong',
        body: `${Number(revisionIntelligence?.corrected_after_wrong_count || 0)} of ${Number(revisionIntelligence?.total || 0)} responses corrected a wrong first move.`,
        tone: helpfulRevisionRate >= 35 ? 'good' : 'mid',
        metric: helpfulRevisionRate,
      },
      {
        id: 'wrong-way-revision',
        title: harmfulRevisionRate >= 15 ? 'Wrong-way revisions are high enough to merit intervention' : 'Wrong-way revisions stayed relatively contained',
        body: `${Number(revisionIntelligence?.changed_away_from_correct_count || 0)} responses flipped away from a correct path.`,
        tone: harmfulRevisionRate >= 15 ? 'bad' : 'mid',
        metric: harmfulRevisionRate,
      },
      {
        id: 'pressure-read',
        title: pressureRate >= 70 ? 'Most choices were made under pressure, not from a calm commit window' : 'Only a minority of answers were pressure-driven',
        body: `${Number(deadlineDependency?.pressure_count || 0)} responses landed under pressure. ${Number(deadlineDependency?.errors_under_pressure_rate || 0).toFixed(0)}% of wrong answers happened there.`,
        tone: pressureRate >= 70 ? 'bad' : 'good',
        metric: pressureRate,
      },
    ],
    [deadlineDependency, helpfulRevisionRate, harmfulRevisionRate, pressureRate, revisionIntelligence],
  );

  const visibleMisconceptions = recurrentMisconceptions.slice(0, 3);
  const hiddenMisconceptions = recurrentMisconceptions.slice(3);

  const revisionFlowSummaryCards = useMemo(() => {
    const categories = new Map((revisionIntelligence?.categories || []).map((category: any) => [category.id, category]));
    return [
      {
        id: 'positive',
        label: 'Positive revisions',
        category: categories.get('incorrect_to_correct'),
        tone: 'good' as const,
      },
      {
        id: 'harmful',
        label: 'Harmful revisions',
        category: categories.get('correct_to_incorrect'),
        tone: 'bad' as const,
      },
      {
        id: 'locked-wrong',
        label: 'Stable incorrect',
        category: categories.get('incorrect_to_incorrect'),
        tone: 'mid' as const,
      },
      {
        id: 'locked-right',
        label: 'Stable correct',
        category: {
          count: Number(revisionIntelligence?.first_choice_correct_count || 0) - Number(revisionIntelligence?.changed_away_from_correct_count || 0),
          rate: Math.max(0, Number(firstChoiceRate || 0) - Number(harmfulRevisionRate || 0)),
        },
        tone: 'good' as const,
      },
    ];
  }, [revisionIntelligence, firstChoiceRate, harmfulRevisionRate]);

  const attentionInsights = useMemo(() => {
    const dragMean = Number(behaviorPatterns?.attention_drag_index?.mean || 0);
    const interactionMean = Number(behaviorPatterns?.interaction_intensity?.mean || 0);
    const hoverMean = Number(behaviorPatterns?.hover_entropy?.mean || 0);
    return [
      {
        id: 'focus',
        title: dragMean >= 60 ? 'Attention remained under sustained drag' : dragMean >= 35 ? 'Attention was mixed, not catastrophic' : 'Attention stayed relatively stable',
        body: `${focusEventsPerStudent.toFixed(1)} focus events per student with an attention-drag mean of ${dragMean.toFixed(1)}.`,
      },
      {
        id: 'interaction',
        title: interactionMean >= 2 ? 'Students were very active before locking answers' : 'Interaction volume stayed measured',
        body: `${interactionMean.toFixed(2)} interaction events per second on average, which points to ${interactionMean >= 2 ? 'active answer checking' : 'leaner decision paths'}.`,
      },
      {
        id: 'exploration',
        title: hoverMean >= 1.5 ? 'Option scanning widened on harder moments' : 'Option scanning stayed narrow',
        body: `Hover entropy averaged ${hoverMean.toFixed(2)} bits, so the class ${hoverMean >= 1.5 ? 'looked broadly before committing' : 'stayed relatively direct in its choice search'}.`,
      },
    ];
  }, [behaviorPatterns, focusEventsPerStudent]);

  const decisionRevisionFlow = useMemo(() => {
    const rows = Array.isArray(researchRows) ? researchRows : [];
    const stageCounts = {
      started_correct: 0,
      started_incorrect: 0,
      held_choice: 0,
      revised_choice: 0,
      finished_correct: 0,
      finished_incorrect: 0,
    } as Record<string, number>;
    const linkCounts = new Map<string, number>();
    const addLink = (source: string, target: string) => {
      const key = `${source}__${target}`;
      linkCounts.set(key, Number(linkCounts.get(key) || 0) + 1);
    };

    rows.forEach((row: any) => {
      const started = Number(row.first_choice_correct || 0) ? 'started_correct' : 'started_incorrect';
      const changed = Number(row.changed_answer || 0) ? 'revised_choice' : 'held_choice';
      const finished = Number(row.is_correct || 0) ? 'finished_correct' : 'finished_incorrect';
      stageCounts[started] += 1;
      stageCounts[changed] += 1;
      stageCounts[finished] += 1;
      addLink(started, changed);
      addLink(changed, finished);
    });

    const nodeMeta = {
      started_correct: { label: 'Started Correct', tone: 'good' as const },
      started_incorrect: { label: 'Started Wrong', tone: 'bad' as const },
      held_choice: { label: 'Did Not Change', tone: 'mid' as const },
      revised_choice: { label: 'Changed Answer', tone: 'mid' as const },
      finished_correct: { label: 'Finished Correct', tone: 'good' as const },
      finished_incorrect: { label: 'Finished Wrong', tone: 'bad' as const },
    };

    return {
      total: rows.length,
      columns: [
        ['started_correct', 'started_incorrect'],
        ['held_choice', 'revised_choice'],
        ['finished_correct', 'finished_incorrect'],
      ].map((column) =>
        column.map((id) => ({
          id,
          ...nodeMeta[id as keyof typeof nodeMeta],
          count: stageCounts[id],
          rate: rows.length ? (stageCounts[id] / rows.length) * 100 : 0,
        })),
      ),
      links: Array.from(linkCounts.entries()).map(([key, value]) => {
        const [source, target] = key.split('__');
        return { source, target, value, rate: rows.length ? (value / rows.length) * 100 : 0 };
      }),
    };
  }, [researchRows]);

  const distractorHeatmap = useMemo(() => {
    const questions = [...questionDiagnostics].sort((left: any, right: any) => Number(left.question_index || 0) - Number(right.question_index || 0));
    const optionLabels = Array.from(
      new Set(
        questions.flatMap((question: any) => (question.choice_distribution || []).map((choice: any) => choice.label)),
      ),
    ).sort();
    const cells = questions.flatMap((question: any) =>
      optionLabels.map((optionLabel) => {
        const choice = (question.choice_distribution || []).find((entry: any) => entry.label === optionLabel);
        return {
          questionId: question.question_id,
          questionIndex: question.question_index,
          prompt: question.question_prompt,
          optionLabel,
          text: choice?.text || '',
          rate: Number(choice?.rate || 0),
          count: Number(choice?.count || 0),
          isCorrect: Boolean(choice?.is_correct),
          isTopDistractor: question.top_distractor?.label === optionLabel,
        };
      }),
    );
    const maxRate = Math.max(...cells.map((cell) => (cell.isCorrect ? 0 : cell.rate)), 1);
    return { questions, optionLabels, cells, maxRate };
  }, [questionDiagnostics]);

  const fatigueTimeline = useMemo(() => {
    const byQuestion = new Map<number, any[]>();
    researchRows.forEach((row: any) => {
      const key = Number(row.question_index || 0);
      if (!byQuestion.has(key)) byQuestion.set(key, []);
      byQuestion.get(key)?.push(row);
    });

    const rows = Array.from(byQuestion.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([questionIndex, rowsForQuestion]) => ({
        question_index: questionIndex,
        accuracy: rowsForQuestion.length ? (rowsForQuestion.reduce((sum, row) => sum + Number(row.is_correct || 0), 0) / rowsForQuestion.length) * 100 : 0,
        avg_response_ms: rowsForQuestion.reduce((sum, row) => sum + Number(row.response_ms || 0), 0) / Math.max(1, rowsForQuestion.length),
        avg_volatility: rowsForQuestion.reduce((sum, row) => sum + Number(row.decision_volatility || 0), 0) / Math.max(1, rowsForQuestion.length),
        deadline_dependency_rate: rowsForQuestion.length ? (rowsForQuestion.reduce((sum, row) => sum + Number(row.deadline_dependent || 0), 0) / rowsForQuestion.length) * 100 : 0,
      }));

    const withRolling = rows.map((row, index, array) => {
      const slice = array.slice(Math.max(0, index - 1), Math.min(array.length, index + 2));
      return {
        ...row,
        rolling_accuracy: slice.reduce((sum, entry) => sum + Number(entry.accuracy || 0), 0) / Math.max(1, slice.length),
        rolling_response_ms: slice.reduce((sum, entry) => sum + Number(entry.avg_response_ms || 0), 0) / Math.max(1, slice.length),
        rolling_volatility: slice.reduce((sum, entry) => sum + Number(entry.avg_volatility || 0), 0) / Math.max(1, slice.length),
      };
    });

    return withRolling;
  }, [researchRows]);

  const recoveryPatterns = useMemo(() => {
    const grouped = new Map<number, any[]>();
    researchRows.forEach((row: any) => {
      const participantId = Number(row.participant_id || 0);
      if (!grouped.has(participantId)) grouped.set(participantId, []);
      grouped.get(participantId)?.push(row);
    });

    const counts = {
      error_to_correct: 0,
      error_to_error: 0,
      error_to_timeout: 0,
      rushed_wrong: 0,
      hesitant_correct: 0,
    } as Record<string, number>;

    grouped.forEach((rowsForStudent) => {
      const ordered = [...rowsForStudent].sort((left, right) => Number(left.question_index || 0) - Number(right.question_index || 0));
      const medianResponse = (() => {
        const values = ordered.map((row) => Number(row.response_ms || 0)).sort((left, right) => left - right);
        return values[Math.floor(values.length / 2)] || 1;
      })();
      const medianCommit = (() => {
        const values = ordered.map((row) => Number(row.commitment_latency_ms || 0)).sort((left, right) => left - right);
        return values[Math.floor(values.length / 2)] || 1;
      })();

      ordered.forEach((row, index) => {
        if (Number(row.is_correct || 0) || index === ordered.length - 1) return;
        const next = ordered[index + 1];
        if (Number(next.is_correct || 0) && (Number(next.response_ms || 0) >= medianResponse * 1.25 || Number(next.commitment_latency_ms || 0) >= medianCommit * 1.25)) {
          counts.hesitant_correct += 1;
          return;
        }
        if (Number(next.is_correct || 0)) {
          counts.error_to_correct += 1;
          return;
        }
        if (Number(next.deadline_buffer_ms || 0) <= 750) {
          counts.error_to_timeout += 1;
          return;
        }
        if (Number(next.response_ms || 0) <= medianResponse * 0.8) {
          counts.rushed_wrong += 1;
          return;
        }
        counts.error_to_error += 1;
      });
    });

    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const labels = {
      error_to_correct: 'Error -> Correct',
      error_to_error: 'Error -> Error',
      error_to_timeout: 'Error -> Deadline Wrong',
      rushed_wrong: 'Error -> Rushed Wrong',
      hesitant_correct: 'Error -> Hesitant Correct',
    } as Record<string, string>;

    return Object.entries(counts).map(([id, count]) => ({
      id,
      label: labels[id],
      count,
      rate: total ? (count / total) * 100 : 0,
    }));
  }, [researchRows]);

  const commitmentDistribution = useMemo(() => {
    const bins = [
      { id: 'instant', label: '<0.6s', min: 0, max: 600 },
      { id: 'quick', label: '0.6-1.5s', min: 600, max: 1500 },
      { id: 'considered', label: '1.5-3s', min: 1500, max: 3000 },
      { id: 'hesitant', label: '3-5s', min: 3000, max: 5000 },
      { id: 'very_hesitant', label: '5s+', min: 5000, max: Number.POSITIVE_INFINITY },
    ];
    return bins.map((bin) => {
      const rowsForBin = researchRows.filter((row: any) => {
        const value = Number(row.commitment_latency_ms || 0);
        return value >= bin.min && value < bin.max;
      });
      return {
        ...bin,
        count: rowsForBin.length,
        accuracy: rowsForBin.length ? (rowsForBin.reduce((sum: number, row: any) => sum + Number(row.is_correct || 0), 0) / rowsForBin.length) * 100 : 0,
      };
    });
  }, [researchRows]);

  const deadlineCurve = useMemo(() => {
    const bins = [
      { id: 'critical', label: '<1s', min: 0, max: 1000 },
      { id: 'late', label: '1-3s', min: 1000, max: 3000 },
      { id: 'warning', label: '3-5s', min: 3000, max: 5000 },
      { id: 'comfortable', label: '5-8s', min: 5000, max: 8000 },
      { id: 'early', label: '8s+', min: 8000, max: Number.POSITIVE_INFINITY },
    ];
    return bins.map((bin) => {
      const rowsForBin = researchRows.filter((row: any) => {
        const value = Number(row.deadline_buffer_ms || 0);
        return value >= bin.min && value < bin.max;
      });
      const count = rowsForBin.length;
      const accuracy = count ? (rowsForBin.reduce((sum: number, row: any) => sum + Number(row.is_correct || 0), 0) / count) * 100 : 0;
      const changeRate = count ? (rowsForBin.reduce((sum: number, row: any) => sum + Number(row.changed_answer || 0), 0) / count) * 100 : 0;
      return {
        ...bin,
        count,
        accuracy,
        wrong_rate: 100 - accuracy,
        changed_rate: changeRate,
      };
    });
  }, [researchRows]);

  const reengagementOutcomes = useMemo(() => {
    const categories = [
      { id: 'clean', label: 'No focus loss' },
      { id: 'quick_return', label: 'Quick return' },
      { id: 'prolonged_return', label: 'Prolonged return' },
    ];
    const bucketed = new Map<string, any[]>();
    categories.forEach((category) => bucketed.set(category.id, []));

    researchRows.forEach((row: any) => {
      const focusLoss = Number(row.focus_loss_count || 0);
      const blurTime = Number(row.blur_time_ms || 0);
      const categoryId = focusLoss <= 0 && blurTime <= 0 ? 'clean' : blurTime <= 1500 ? 'quick_return' : 'prolonged_return';
      bucketed.get(categoryId)?.push(row);
    });

    return categories.map((category) => {
      const rowsForCategory = bucketed.get(category.id) || [];
      return {
        ...category,
        count: rowsForCategory.length,
        accuracy: rowsForCategory.length ? (rowsForCategory.reduce((sum, row) => sum + Number(row.is_correct || 0), 0) / rowsForCategory.length) * 100 : 0,
        avg_response_ms: rowsForCategory.reduce((sum, row) => sum + Number(row.response_ms || 0), 0) / Math.max(1, rowsForCategory.length),
        avg_volatility: rowsForCategory.reduce((sum, row) => sum + Number(row.decision_volatility || 0), 0) / Math.max(1, rowsForCategory.length),
      };
    });
  }, [researchRows]);

  const recoverySummary = useMemo(() => {
    const leadingPattern = [...recoveryPatterns].sort((left, right) => Number(right.count || 0) - Number(left.count || 0))[0];
    if (!leadingPattern) {
      return 'No post-error transitions were captured in this run.';
    }
    return `${leadingPattern.label} is the dominant follow-up pattern at ${Number(leadingPattern.rate || 0).toFixed(0)}%.`;
  }, [recoveryPatterns]);

  const openStudentDashboard = (studentId: number | string) => {
    if (!sessionId) return;
    navigate(`/teacher/analytics/class/${sessionId}/student/${studentId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center text-brand-dark">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">Loading class command center...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-8">
        <div className="bg-white border-4 border-brand-dark rounded-[2rem] shadow-[8px_8px_0px_0px_#1A1A1A] p-8 max-w-xl text-center">
          <p className="text-3xl font-black mb-3">Analytics unavailable</p>
          <p className="font-bold text-brand-dark/60 mb-6">{error || 'No analytics payload was returned.'}</p>
          <button
            onClick={() => navigate('/teacher/reports')}
            className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
          >
            Back to Reports
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg pb-20 font-sans text-brand-dark selection:bg-brand-orange selection:text-white">
      <div className="sticky top-0 z-30 bg-white border-b-4 border-brand-dark shadow-[0_4px_0px_0px_#1A1A1A]">
        <div className={`max-w-[1520px] mx-auto px-6 transition-all duration-200 ${showExpandedHeader ? 'py-4 space-y-4' : 'py-3 space-y-2'}`}>
          <div className={`flex flex-col justify-between gap-4 ${showExpandedHeader ? '2xl:flex-row 2xl:items-start' : 'xl:flex-row xl:items-center'}`}>
            <div className="flex items-start gap-4 min-w-0">
              <button
                onClick={() => navigate('/teacher/reports')}
                className="w-12 h-12 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A] shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-purple mb-2">
                  {showExpandedHeader ? 'Teacher Command Board' : 'Session analytics'}
                </p>
                <h1 className={`${showExpandedHeader ? 'text-4xl lg:text-5xl' : 'text-2xl lg:text-3xl'} font-black tracking-tight leading-tight break-words`}>
                  {data?.session?.pack_title || `Session #${sessionId}`}
                </h1>
                {showExpandedHeader ? (
                  <p className="font-bold text-brand-dark/65 mt-2 max-w-3xl">
                    Read the class state, locate the misconception, then decide who needs follow-up. This header is intentionally tuned for a fast teaching decision.
                  </p>
                ) : (
                  <p className="font-bold text-brand-dark/60 mt-1 max-w-3xl">
                    {executiveSummary.classStateTitle} • {executiveSummary.actionTitle}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <ContextChip label="Session" value={`#${data?.session?.id || sessionId}`} tone="neutral" />
                  <ContextChip label="Status" value={data?.session?.status || 'Unknown'} tone={data?.session?.status === 'ENDED' ? 'good' : 'mid'} />
                  <ContextChip label="Students" value={`${participants.length}`} tone="neutral" />
                  <ContextChip label="Questions" value={`${questionRows.length}`} tone="neutral" />
                  {showExpandedHeader && (
                    <>
                      <ContextChip label="Mode" value={gameMode.label} tone="neutral" />
                      <ContextChip label="Research Rows" value={compactNumber.format(researchRows.length || 0)} tone="neutral" />
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isHeaderCondensed && (
                <button
                  onClick={() => setIsHeaderPinnedOpen((current) => !current)}
                  className="px-5 py-3 bg-brand-bg border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                >
                  {showExpandedHeader ? 'Collapse header' : 'Expand header'}
                </button>
              )}
              <button
                onClick={loadAnalytics}
                className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              {showExpandedHeader && (
                <>
                  <button
                    onClick={() => downloadCsv(`${exportBaseName}-students.csv`, studentCsvRows)}
                    className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    <Download className="w-4 h-4" />
                    Students CSV
                  </button>
                  <button
                    onClick={() => downloadCsv(`${exportBaseName}-questions.csv`, questionCsvRows)}
                    className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    <Download className="w-4 h-4" />
                    Questions CSV
                  </button>
                  <button
                    onClick={() => downloadCsv(`${exportBaseName}-lms-gradebook.csv`, lmsCsvRows)}
                    className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    <Download className="w-4 h-4" />
                    LMS Gradebook CSV
                  </button>
                  {teams.length > 0 && (
                    <button
                      onClick={() => downloadCsv(`${exportBaseName}-teams.csv`, teamCsvRows)}
                      className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                    >
                      <Download className="w-4 h-4" />
                      Teams CSV
                    </button>
                  )}
                  <button
                    onClick={() => downloadCsv(`${exportBaseName}-responses.csv`, researchRows)}
                    className="px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                  >
                    <Download className="w-4 h-4" />
                    Response Rows CSV
                  </button>
                </>
              )}
              {selectedStudent && (
                <button
                  onClick={() => navigate(`/teacher/analytics/class/${sessionId}/student/${selectedStudent.id}`)}
                  className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
                >
                  Open {selectedStudent.nickname}
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {showExpandedHeader && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {topSummaryCards.map((card) => (
                <React.Fragment key={card.id}>
                  <SummaryStripCard
                    label={card.label}
                    title={card.title}
                    body={card.body}
                    accent={card.accent}
                  />
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="max-w-[1520px] mx-auto px-6 pt-10">
        <SectionIntro
          eyebrow="Immediate Read"
          title="Start with the verdict, not the telemetry"
          body="This opening block is meant to answer three questions fast: what is happening in the class, what is driving it, and who needs teacher attention first."
        />

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-brand-dark text-white rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8 lg:p-9 mb-8 overflow-hidden relative"
        >
          <div className="absolute right-[-40px] top-[-50px] w-60 h-60 rounded-full bg-white/10" />
          <div className="absolute right-24 bottom-[-45px] w-32 h-32 rounded-full bg-brand-yellow/20" />
          <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[1.12fr_0.88fr] gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">Executive Diagnosis</p>
              <h2 className="text-4xl lg:text-5xl font-black leading-tight mb-4">
                {data?.summary?.headline || 'Class snapshot ready'}
              </h2>
              <p className="text-lg font-medium text-white/75 max-w-3xl">
                {data?.summary?.summary || 'We are loading the class narrative and will surface the strongest signal first.'}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Diagnosis</p>
                  <p className="text-xl font-black leading-tight">{executiveSummary.topIssueTitle}</p>
                  <p className="font-medium text-white/72 mt-2">{executiveSummary.topIssueBody}</p>
                </div>
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Why It Matters</p>
                  <p className="text-xl font-black leading-tight">
                    {helpfulRevisionRate > harmfulRevisionRate ? 'Students can recover, but too late for fluent mastery.' : 'The class is not correcting itself reliably enough.'}
                  </p>
                  <p className="font-medium text-white/72 mt-2">
                    {helpfulRevisionRate.toFixed(0)}% corrected a wrong start, while {harmfulRevisionRate.toFixed(0)}% reversed away from the right answer.
                  </p>
                </div>
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Recommended Move</p>
                  <p className="text-xl font-black leading-tight">{executiveSummary.actionTitle}</p>
                  <p className="font-medium text-white/72 mt-2">{executiveSummary.actionBody}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.9rem] border-4 border-brand-dark bg-white text-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <div className="flex items-center gap-3 mb-4">
                  <ListChecks className="w-5 h-5 text-brand-purple" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">Who Needs Attention Now</p>
                    <p className="font-bold text-brand-dark/65">Open these students first if you only have a minute.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {topAttentionStudents.length > 0 ? topAttentionStudents.map((student: any) => (
                    <button
                      key={`hero-attention-${student.id}`}
                      onClick={() => openStudentDashboard(student.id)}
                      className="w-full text-left rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4 hover:bg-white transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="font-black text-lg">{student.nickname}</p>
                        <RiskBadge level={student.risk_level} compact />
                      </div>
                      <p className="font-medium text-brand-dark/70">{student.recommendation}</p>
                    </button>
                  )) : (
                    <p className="font-bold text-brand-dark/60">No student queue has been produced yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-[1.9rem] border-4 border-brand-dark bg-brand-yellow text-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <div className="flex items-center gap-3 mb-3">
                  <CircleAlert className="w-5 h-5 text-brand-orange" />
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/60">Critical Alert</p>
                </div>
                <p className="text-2xl font-black leading-tight mb-2">{leadAlert?.title || 'No urgent class-wide alert'}</p>
                <p className="font-medium text-brand-dark/75">
                  {leadAlert?.body || 'The class does not currently show a single alert that outweighs the rest of the board.'}
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        <section className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 mb-10">
          {keyMetricCards.map((card) => (
            <React.Fragment key={card.id}>
              <MetricCard
                icon={card.icon}
                title={card.title}
                value={card.value}
                status={card.status}
                note={card.note}
                color={card.color}
                textColor={card.textColor}
              />
            </React.Fragment>
          ))}
        </section>

        {(packMeta || crossSectionComparison) && (
          <section className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-8 mb-10">
            {packMeta && (
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <Target className="w-6 h-6 text-brand-purple" />
                  <div>
                    <h2 className="text-3xl font-black">Academic Mapping</h2>
                    <p className="font-bold text-brand-dark/60 mt-1">Keep this session anchored to the course structure, not just the game.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <PackMetric label="Course" value={packMeta.course_code || 'Not set'} />
                  <PackMetric label="Section" value={packMeta.section_name || 'Not set'} />
                  <PackMetric label="Term" value={packMeta.academic_term || 'Not set'} />
                  <PackMetric label="Week" value={packMeta.week_label || 'Not set'} />
                </div>
                {(packMeta.learning_objectives || []).length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Learning outcomes</p>
                    <div className="flex flex-wrap gap-2">
                      {(packMeta.learning_objectives || []).map((objective: string) => (
                        <span key={objective} className="px-3 py-2 rounded-full bg-emerald-100 border-2 border-brand-dark text-xs font-black">
                          {objective}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(packMeta.bloom_levels || []).length > 0 && (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Bloom coverage</p>
                    <div className="flex flex-wrap gap-2">
                      {(packMeta.bloom_levels || []).map((level: string) => (
                        <span key={level} className="px-3 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark text-xs font-black">
                          {level}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {crossSectionComparison && (
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-3xl font-black">Cross-Section Comparison</h2>
                    <p className="font-bold text-brand-dark/60 mt-1">
                      Compare this run against {crossSectionComparison.benchmark?.compared_sessions || 0} prior session{Number(crossSectionComparison.benchmark?.compared_sessions || 0) === 1 ? '' : 's'} on the same {crossSectionComparison.basis === 'course_code' ? 'course code' : 'pack'}.
                    </p>
                  </div>
                  <div className="px-4 py-3 rounded-full bg-brand-bg border-2 border-brand-dark font-black text-sm">
                    {crossSectionComparison.course_code || 'Pack scope'}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  <PackMetric
                    label="Accuracy delta"
                    value={`${Number(crossSectionComparison.benchmark?.delta_accuracy || 0).toFixed(1)}pts`}
                  />
                  <PackMetric
                    label="Peer avg accuracy"
                    value={`${Number(crossSectionComparison.benchmark?.average_accuracy || 0).toFixed(1)}%`}
                  />
                  <PackMetric
                    label="Peer avg attendance"
                    value={Number(crossSectionComparison.benchmark?.average_participant_count || 0).toFixed(1)}
                  />
                </div>

                <div className="space-y-3">
                  {(crossSectionComparison.sessions || []).slice(0, 6).map((row: any) => (
                    <div key={row.session_id} className={`rounded-[1.3rem] border-2 border-brand-dark p-4 ${row.is_current ? 'bg-brand-yellow' : 'bg-brand-bg'}`}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="font-black text-lg">
                            {row.section_name || 'Main'}
                            {row.is_current ? ' • Current session' : ''}
                          </p>
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/50">
                            {[row.academic_term, row.week_label].filter(Boolean).join(' • ') || 'Unmapped session'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                            {Number(row.accuracy || 0).toFixed(1)}% accuracy
                          </span>
                          <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                            {row.participant_count} students
                          </span>
                        </div>
                      </div>
                      <p className="font-medium text-brand-dark/70">
                        Avg response {formatMs(Number(row.avg_response_ms || 0))} • Session #{row.session_id}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <SectionIntro
          eyebrow="Instructional Diagnosis"
          title="Turn the signal into a teaching move"
          body="These sections prioritize verdicts, misconceptions, and revision behavior so the page answers what to reteach, what to slow down, and who to support."
        />

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <BrainCircuit className="w-6 h-6 text-brand-purple" />
              <div>
                <h2 className="text-3xl font-black">Decision Intelligence</h2>
                <p className="font-bold text-brand-dark/60 mt-1">Three verdicts first, then the evidence underneath.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {decisionVerdicts.map((verdict) => (
                <React.Fragment key={verdict.id}>
                  <VerdictCard
                    label={verdict.label}
                    title={verdict.title}
                    body={verdict.body}
                    tone={verdict.tone}
                  />
                </React.Fragment>
              ))}
            </div>

            <div className="space-y-3">
              {decisionFindings.map((finding) => (
                <React.Fragment key={finding.id}>
                  <FindingCallout
                    title={finding.title}
                    body={finding.body}
                    tone={finding.tone}
                    metric={finding.metric}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-6 lg:p-7">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Recovery + Drift</p>
              <h2 className="text-3xl font-black mb-3">{fatigueDrift?.headline || 'No fatigue read yet'}</h2>
              <p className="font-medium text-white/75 mb-5">{fatigueDrift?.body || 'There are not enough rows yet to estimate drift.'}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <MiniMetric label="Recovery Rate" value={`${Number(recoveryProfile?.recovery_rate || 0).toFixed(0)}%`} />
                <MiniMetric label="Commit Window" value={formatMs(Number(behaviorPatterns?.commitment_latency_ms?.median || 0))} />
                <MiniMetric label="Early Accuracy" value={`${Number(fatigueDrift?.early_accuracy || 0).toFixed(0)}%`} />
                <MiniMetric label="Late Accuracy" value={`${Number(fatigueDrift?.late_accuracy || 0).toFixed(0)}%`} />
              </div>
              <div className="rounded-[1.5rem] border border-white/15 bg-white/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-2">So what?</p>
                <p className="text-xl font-black mb-1">
                  {fatigueDrift?.direction === 'flat' ? 'The main issue is not only fatigue.' : 'Some students fade as the session goes on.'}
                </p>
                <p className="font-medium text-white/72">
                  {fatigueDrift?.direction === 'flat'
                    ? highRiskFatigueCount > 0
                      ? `${highRiskFatigueCount} high-risk students still showed late fade even though the class average stayed flatter.`
                      : 'Class-wide fatigue stayed limited, so the bigger teaching move is conceptual clarification plus calmer pacing.'
                    : `${fatigueAffectedCount} students show a fatigue pattern, with ${highRiskFatigueCount} of them already in the high-risk group.`}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="w-6 h-6 text-brand-orange" />
                <div>
                  <h2 className="text-3xl font-black">Recurrent Misconceptions</h2>
                  <p className="font-bold text-brand-dark/60 mt-1">
                    {visibleMisconceptions.length > 0
                      ? 'Show the most instruction-worthy confusion clusters first.'
                      : 'No misconception cluster repeated enough to outrank the rest.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {visibleMisconceptions.length > 0 ? visibleMisconceptions.map((pattern: any, index: number) => {
                  const affectedShare = participants.length ? Math.round((Number(pattern.student_count || 0) / participants.length) * 100) : 0;
                  const severityLabel = affectedShare >= 50 ? 'Widespread' : affectedShare >= 25 ? 'Recurring' : 'Localized';
                  const actionHint = Number(pattern.question_count || 0) > 1
                    ? 'Reteach the concept boundary across the repeated questions.'
                    : `Contrast distractor ${pattern.choice_label} with the correct explanation before the next live check.`;
                  return (
                    <div key={`${pattern.tag}-${pattern.choice_label}-${pattern.choice_text}`} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-[11px] font-black uppercase tracking-[0.18em]">
                              {index === 0 ? 'Most Widespread' : severityLabel}
                            </span>
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange">{humanizeTag(pattern.tag)}</span>
                          </div>
                          <p className="font-black leading-tight text-lg">
                            Distractor {pattern.choice_label}: {pattern.choice_text}
                          </p>
                        </div>
                        <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black shrink-0">
                          {affectedShare}%
                        </span>
                      </div>
                      <p className="font-medium text-brand-dark/72">
                        {pattern.student_count} students hit this misconception across {pattern.question_count} question{Number(pattern.question_count) === 1 ? '' : 's'}.
                      </p>
                      <p className="font-black text-brand-dark mt-3">{actionHint}</p>
                    </div>
                  );
                }) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="font-black">No repeated misconception cluster outran the noise floor.</p>
                    <p className="font-medium text-brand-dark/70 mt-2">
                      Treat the weaker items as isolated question problems rather than one repeating class-wide misunderstanding.
                    </p>
                  </div>
                )}

                {hiddenMisconceptions.length > 0 && (
                  <details className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black">Show {hiddenMisconceptions.length} additional misconception patterns</p>
                        <p className="font-medium text-brand-dark/65">Keep the top three open by default so the page stays scannable.</p>
                      </div>
                      <ChevronDown className="w-5 h-5 shrink-0" />
                    </summary>
                    <div className="space-y-3 mt-4">
                      {hiddenMisconceptions.map((pattern: any) => (
                        <div key={`hidden-${pattern.tag}-${pattern.choice_label}-${pattern.choice_text}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-1">{humanizeTag(pattern.tag)}</p>
                          <p className="font-black">Distractor {pattern.choice_label}: {pattern.choice_text}</p>
                          <p className="font-medium text-brand-dark/70 mt-2">
                            {pattern.student_count} students across {pattern.question_count} question{Number(pattern.question_count) === 1 ? '' : 's'}.
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        </section>

        <details className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
          <summary className="list-none cursor-pointer p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Supporting Context</p>
              <h2 className="text-3xl font-black">Session context and attention signals</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Open this when you need the quiz format context or the raw attention telemetry behind the verdicts above.</p>
            </div>
            <div className="flex items-center gap-3">
              <ContextChip label="Mode" value={gameMode.label} tone="neutral" />
              <ContextChip label="Rows" value={`${researchRows.length}`} tone="neutral" />
              <ChevronDown className="w-5 h-5" />
            </div>
          </summary>
          <div className="px-6 lg:px-7 pb-7 grid grid-cols-1 xl:grid-cols-[0.78fr_1.22fr] gap-8">
            <div className="bg-brand-bg rounded-[1.8rem] border-2 border-brand-dark p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Session Context</p>
              <h3 className="text-3xl font-black mb-3">{gameMode.label}</h3>
              <p className="font-medium text-brand-dark/70 mb-5">{gameMode.description}</p>
              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4 mb-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Research cue</p>
                <p className="font-black">{gameMode.researchCue}</p>
              </div>
              <div className="flex flex-wrap gap-2 mb-5">
                {gameMode.objectives.map((objective) => (
                  <span key={objective} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                    {objective}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SignalPill label="Teams" value={teams.length || data?.summary?.team_count || 0} />
                <SignalPill label="Mode Type" value={gameMode.teamBased ? 'Group' : 'Solo'} />
                <SignalPill label="Rows" value={researchRows.length} />
                <SignalPill label="Questions" value={questionRows.length} />
              </div>
            </div>

            <div className="bg-brand-bg rounded-[1.8rem] border-2 border-brand-dark p-6">
              <div className="mb-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Attention Signals</p>
                <h3 className="text-3xl font-black">Human-readable telemetry</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                {attentionInsights.map((insight) => (
                  <div key={insight.id} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                    <p className="font-black leading-tight">{insight.title}</p>
                    <p className="font-medium text-brand-dark/68 mt-2">{insight.body}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
                <SignalPill label="Attention Drag" value={research?.behavior_patterns?.attention_drag_index?.mean ?? 0} tone={riskTone(Number(research?.behavior_patterns?.attention_drag_index?.mean || 0) >= 60 ? 'high' : Number(research?.behavior_patterns?.attention_drag_index?.mean || 0) >= 35 ? 'medium' : 'low')} metricId="attention-drag" />
                <SignalPill label="Interaction / s" value={research?.behavior_patterns?.interaction_intensity?.mean ?? 0} />
                <SignalPill label="Hover Entropy" value={research?.behavior_patterns?.hover_entropy?.mean ?? 0} />
                <SignalPill label="P75 Drag" value={research?.behavior_patterns?.attention_drag_index?.p75 ?? 0} metricId="attention-drag" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DistributionGroup title="Input mix" items={research?.behavior_patterns?.input_mix || []} />
                <DistributionGroup title="Commit styles" items={research?.behavior_patterns?.commit_style_distribution || []} />
              </div>
            </div>
          </div>
        </details>

        <SectionIntro
          eyebrow="Class Behavior"
          title="Read where the class bent under pressure"
          body="Use these charts after you know the misconception. They explain when the room destabilized, which students stayed resilient, and whether time pressure changed the outcome."
        />

        <section className="grid grid-cols-1 xl:grid-cols-[1.16fr_0.84fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden h-full flex flex-col">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-purple mb-2">Decision Paths</p>
                  <h2 className="text-3xl font-black">Decision Revision Flow</h2>
                  <p className="font-bold text-brand-dark/65 mt-2">
                    {helpfulRevisionRate.toFixed(0)}% improved after revision, but {harmfulRevisionRate.toFixed(0)}% reversed from correct to incorrect.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ContextChip label="Revised" value={`${Number(decisionRevisionFlow?.columns?.[1]?.[1]?.rate || 0).toFixed(0)}%`} tone="mid" />
                  <ContextChip label="Locked Wrong" value={`${lockedWrongRate.toFixed(0)}%`} tone={lockedWrongRate >= 30 ? 'bad' : 'mid'} />
                </div>
              </div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
                {revisionFlowSummaryCards.map((item) => (
                  <React.Fragment key={item.id}>
                    <FlowSummaryCard
                      label={item.label}
                      count={Number(item.category?.count || 0)}
                      rate={Number(item.category?.rate || 0)}
                      tone={item.tone}
                    />
                  </React.Fragment>
                ))}
              </div>
              <DecisionRevisionFlowChart flow={decisionRevisionFlow} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden h-full flex flex-col">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-brand-yellow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-dark/55 mb-2">Student Map</p>
                  <h2 className="text-3xl font-black">Student Pressure Scatter</h2>
                  <p className="font-bold text-brand-dark/65 mt-2">Each dot is one student. X = accuracy, Y = stress. The quadrants show who is stable, pressured, or drifting out of control.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ContextChip label="High Risk" value={participants.filter((student: any) => student.risk_level === 'high').length} tone="bad" />
                  <ContextChip label="Stable" value={participants.filter((student: any) => student.risk_level === 'low').length} tone="good" />
                </div>
              </div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <StudentScatterPlot
                participants={participants}
                selectedStudentId={selectedStudent?.id}
                onSelect={(studentId) => setSelectedStudentId(studentId)}
                onOpen={openStudentDashboard}
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-purple text-white">
              <h2 className="text-3xl font-black">Session Dynamics</h2>
              <p className="font-bold text-white/70 mt-2">Question-by-question turning points for accuracy, stress, response time, and panic behavior.</p>
            </div>
            <div className="p-7">
              <ResearchLineChart rows={sequenceDynamics} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-brand-yellow">
              <h2 className="text-3xl font-black">Recovery Patterns</h2>
              <p className="font-bold text-brand-dark/65 mt-2">{recoverySummary}</p>
            </div>
            <div className="p-6">
              <RecoveryPatternsChart rows={[...recoveryPatterns].sort((left, right) => Number(right.count || 0) - Number(left.count || 0))} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-white">
              <h2 className="text-3xl font-black">Fatigue / Drift Timeline</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Rolling accuracy, response time, and hesitation across the run of the game.</p>
            </div>
            <div className="p-6">
              <FatigueTimelineChart rows={fatigueTimeline} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-bg">
              <h2 className="text-3xl font-black">Deadline Dependency Curve</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Binned by remaining time, so you can see whether late decisions help or hurt.</p>
            </div>
            <div className="p-6">
              <DeadlineDependencyChart rows={deadlineCurve} />
            </div>
          </div>
        </section>

        <details className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
          <summary className="list-none cursor-pointer p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Deeper Read</p>
              <h2 className="text-3xl font-black">Student drilldown and statistical detail</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Open this layer when you need richer student context, correlation reads, or the slower diagnostic charts below.</p>
            </div>
            <div className="flex items-center gap-3">
              <ContextChip label="Stats" value={`${descriptiveStats.length}`} tone="neutral" />
              <ContextChip label="Correlations" value={`${correlations.length}`} tone="neutral" />
              <ChevronDown className="w-5 h-5" />
            </div>
          </summary>
          <div className="px-6 lg:px-7 pb-7">
        <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8 mb-6">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <BarChart3 className="w-6 h-6 text-brand-purple" />
              <h2 className="text-3xl font-black">Descriptive Statistics</h2>
            </div>
            <p className="font-bold text-brand-dark/60 mb-6">Mean, spread, and quartiles for the main instructional and behavioral signals in this session.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {descriptiveStats.map((metric: any) => (
                <div key={metric.id} className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{metric.label}</p>
                      <p className="text-3xl font-black">
                        {metric.summary?.mean}
                        <span className="text-base ml-1">{metric.unit}</span>
                      </p>
                    </div>
                    <SignalPill label="Std Dev" value={metric.summary?.stddev ?? 0} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <SignalPill label="Median" value={metric.summary?.median ?? 0} />
                    <SignalPill label="P25" value={metric.summary?.p25 ?? 0} />
                    <SignalPill label="P75" value={metric.summary?.p75 ?? 0} />
                    <SignalPill label="Range" value={`${metric.summary?.min ?? 0} - ${metric.summary?.max ?? 0}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <BrainCircuit className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">Correlation Lab</h2>
              </div>
              <div className="space-y-3">
                {correlations.map((correlation: any) => (
                  <div key={correlation.label} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="font-black text-lg">{correlation.label}</p>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{correlation.strength} signal · {correlation.direction}</p>
                      </div>
                      <div className={`px-3 py-2 rounded-full border-2 border-brand-dark font-black ${Math.abs(Number(correlation.value)) >= 0.65 ? 'bg-brand-orange text-white' : Math.abs(Number(correlation.value)) >= 0.35 ? 'bg-brand-yellow text-brand-dark' : 'bg-white text-brand-dark'}`}>
                        r = {Number(correlation.value).toFixed(3)}
                      </div>
                    </div>
                    <div className="h-4 rounded-full border-2 border-brand-dark bg-white overflow-hidden">
                      <div
                        className={`${Number(correlation.value) >= 0 ? 'bg-brand-purple ml-[50%]' : 'bg-brand-orange'} h-full`}
                        style={{
                          width: `${Math.abs(Number(correlation.value)) * 50}%`,
                          transform: Number(correlation.value) >= 0 ? 'translateX(0)' : 'translateX(0)',
                          marginLeft: Number(correlation.value) >= 0 ? '50%' : `${50 - Math.abs(Number(correlation.value)) * 50}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-7">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Selected Student</p>
                  <h2 className="text-3xl font-black">{selectedStudent?.nickname || 'No student selected'}</h2>
                </div>
                {selectedStudent && <RiskBadge level={selectedStudent.risk_level} />}
              </div>

              {selectedStudent ? (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <MiniMetric label="Accuracy" value={`${selectedStudent.accuracy.toFixed(0)}%`} />
                    <MiniMetric label="Stress" value={`${selectedStudent.stress_index.toFixed(0)}%`} />
                    <MiniMetric label="Confidence" value={`${selectedStudent.confidence_score || 0}`} />
                    <MiniMetric label="Focus" value={`${selectedStudent.focus_score || 0}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <MiniMetric label="1st Choice" value={`${Number(selectedStudent.first_choice_accuracy || 0).toFixed(0)}%`} />
                    <MiniMetric label="Recovery" value={`${Number(selectedStudent.recovery_rate || 0).toFixed(0)}%`} />
                    <MiniMetric label="Commit" value={formatMs(Number(selectedStudent.avg_commitment_latency_ms || 0))} />
                    <MiniMetric label="Stability" value={`${Number(selectedStudent.stability_score || 0).toFixed(0)}`} />
                  </div>
                  <p className="text-xl font-black text-brand-yellow mb-2">{selectedStudent.headline}</p>
                  <p className="font-medium text-white/75 mb-5">{selectedStudent.body}</p>

                  <div className="flex flex-wrap gap-2 mb-5">
                    {(selectedStudent.weak_tags || []).slice(0, 3).map((tag: string) => (
                      <span key={`weak-${tag}`} className="px-3 py-2 rounded-full bg-brand-orange text-white border-2 border-white/20 text-xs font-black capitalize">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="bg-white/10 rounded-2xl border border-white/15 p-4 mb-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-2">Recommended move</p>
                    <p className="font-medium text-white/80">{selectedStudent.recommendation}</p>
                  </div>

                  <button
                    onClick={() => navigate(`/teacher/analytics/class/${sessionId}/student/${selectedStudent.id}`)}
                    className="w-full px-5 py-4 bg-brand-yellow text-brand-dark border-2 border-brand-dark rounded-full font-black flex items-center justify-center gap-2"
                  >
                    Open Personal Dashboard
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <p className="font-bold text-white/60">No student data available.</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-white">
              <h2 className="text-3xl font-black">Commitment Behavior</h2>
              <p className="font-bold text-brand-dark/60 mt-2">A histogram of commitment latency, so mean values do not hide different solving styles.</p>
            </div>
            <div className="p-6">
              <CommitmentDistributionChart rows={commitmentDistribution} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-[#d8f1ff]">
              <h2 className="text-3xl font-black">Re-engagement Outcomes</h2>
              <p className="font-bold text-brand-dark/65 mt-2">Whether quick or prolonged returns from blur actually hurt the class.</p>
            </div>
            <div className="p-6">
              <ReengagementOutcomeChart rows={reengagementOutcomes} />
            </div>
          </div>
        </section>
          </div>
        </details>

        <details className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
          <summary className="list-none cursor-pointer p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Supporting Analysis</p>
              <h2 className="text-3xl font-black">Benchmarks, clusters, and deeper telemetry</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Open this layer when you want the fuller statistical context behind the main read.</p>
            </div>
            <div className="flex items-center gap-3">
              <ContextChip label="Quartiles" value={`${Object.values(quartileBenchmarks).length}`} tone="neutral" />
              <ContextChip label="Clusters" value={`${clusters.length}`} tone="neutral" />
              <ChevronDown className="w-5 h-5" />
            </div>
          </summary>
          <div className="px-6 lg:px-7 pb-7">
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <Users className="w-6 h-6 text-brand-purple" />
              <h2 className="text-3xl font-black">Cohort Benchmarks</h2>
            </div>
            <div className="space-y-4">
              {Object.values(quartileBenchmarks).map((group: any) => (
                <div key={group.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-lg font-black">{group.label}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{group.count} students</p>
                    </div>
                    <div className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
                      {group.accuracy?.toFixed?.(1) ?? group.accuracy}% accuracy
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-sm font-black mb-2">
                        <span>Stress</span>
                        <span>{group.stress_index}%</span>
                      </div>
                      <Bar value={Number(group.stress_index) || 0} tone={accuracyTone(100 - Number(group.stress_index || 0))} />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-sm font-black mb-2">
                        <span>Focus</span>
                        <span>{group.focus_score}</span>
                      </div>
                      <Bar value={Number(group.focus_score) || 0} tone={accuracyTone(Number(group.focus_score) || 0)} />
                    </div>
                    <p className="font-medium text-brand-dark/70">
                      {Array.isArray(group.students) ? group.students.join(', ') : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <Activity className="w-6 h-6 text-brand-orange" />
              <h2 className="text-3xl font-black">Behavior Research</h2>
            </div>
            <DistributionGroup title="Pace distribution" items={behaviorPatterns?.pace_distribution || []} />
            <DistributionGroup title="Commit style distribution" items={behaviorPatterns?.commit_style_distribution || []} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
              <SignalPill label="Volatility Mean" value={behaviorPatterns?.decision_volatility?.mean ?? 0} />
              <SignalPill label="Median Commit" value={formatMs(Number(behaviorPatterns?.commit_window_ms?.median || 0))} />
              <SignalPill label="Median Buffer" value={formatMs(Number(behaviorPatterns?.deadline_buffer_ms?.median || 0))} />
            </div>
            <div className="mt-6 space-y-3">
              {(behaviorPatterns?.accuracy_by_pace || []).map((row: any) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                    <span className="capitalize">{row.label}</span>
                    <span>{row.accuracy}% accuracy · {row.count} rows</span>
                  </div>
                  <Bar value={Number(row.accuracy) || 0} tone={accuracyTone(Number(row.accuracy) || 0)} />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-brand-yellow rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <Sparkles className="w-6 h-6 text-brand-orange" />
              <h2 className="text-3xl font-black">Clusters and Outliers</h2>
            </div>
            <div className="space-y-4 mb-6">
              {clusters.map((cluster: any) => (
                <div key={cluster.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-lg font-black">{cluster.label}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{cluster.count} students</p>
                    </div>
                    <div className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-bg font-black">
                      {cluster.count}
                    </div>
                  </div>
                  <p className="font-medium text-brand-dark/70 mb-3">{cluster.description}</p>
                  <p className="font-bold text-brand-dark/60">
                    {(cluster.students || []).slice(0, 4).map((student: any) => student.nickname).join(', ')}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {outliers.map((outlier: any, index: number) => (
                <div key={`${outlier.title}-${index}`} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{outlier.title}</p>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-lg font-black">{outlier.label}</p>
                    <span className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark font-black">{outlier.value}</span>
                  </div>
                  <p className="font-medium text-brand-dark/70">{outlier.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {(teams.length > 0 || participants.length > 0) && (
          <section className={`grid grid-cols-1 gap-8 mb-8 ${teams.length > 0 ? 'xl:grid-cols-[1fr_1fr]' : ''}`}>
            {teams.length > 0 && (
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
                <div className="flex items-center gap-3 mb-5">
                  <Users className="w-6 h-6 text-brand-purple" />
                  <h2 className="text-3xl font-black">Team BI Board</h2>
                </div>
                <div className="space-y-4">
                  {teams.map((team: any) => (
                    <div key={team.team_id || team.team_name} className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Rank #{team.rank}</p>
                          <p className="text-2xl font-black">{team.team_name}</p>
                          <p className="font-medium text-brand-dark/65">{team.student_count} students · consensus {team.consensus_index}%</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 min-w-[240px]">
                          <SignalPill label="Score" value={team.total_score} />
                          <SignalPill label="Mode Bonus" value={team.mode_bonus} tone={team.mode_bonus > 0 ? 'good' : 'neutral'} />
                          <SignalPill label="Coverage" value={`${team.coverage_score}%`} tone={accuracyTone(Number(team.coverage_score || 0))} />
                          <SignalPill label="Stress" value={`${team.avg_stress}%`} tone={riskTone(team.avg_stress >= 70 ? 'high' : team.avg_stress >= 40 ? 'medium' : 'low')} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                            <span>Accuracy</span>
                            <span>{team.accuracy}%</span>
                          </div>
                          <Bar value={Number(team.accuracy) || 0} tone={accuracyTone(Number(team.accuracy) || 0)} />
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                            <span>Consensus</span>
                            <span>{team.consensus_index}%</span>
                          </div>
                          <Bar value={Number(team.consensus_index) || 0} tone={accuracyTone(Number(team.consensus_index) || 0)} />
                        </div>
                      </div>
                      <p className="font-medium text-brand-dark/70">
                        {(team.members || []).map((member: any) => member.nickname || member).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <Gauge className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">Student Telemetry Table</h2>
              </div>
              <div className="space-y-3">
                {[...participants]
                  .sort((left: any, right: any) => Number(right.attention_drag_index || 0) - Number(left.attention_drag_index || 0))
                  .slice(0, 8)
                  .map((student: any) => (
                    <button
                      key={`telemetry-${student.id}`}
                      onClick={() => openStudentDashboard(student.id)}
                      className="w-full text-left rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 hover:bg-white transition-colors"
                    >
                      <div className="grid grid-cols-[1.2fr_repeat(4,minmax(0,0.8fr))] gap-3 items-center">
                        <div>
                          <p className="font-black text-lg">{student.nickname}</p>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{student.team_name || 'Solo'} · {student.risk_level}</p>
                        </div>
                        <SignalPill label="Drag" value={student.attention_drag_index ?? 0} tone={riskTone(student.attention_drag_index >= 70 ? 'high' : student.attention_drag_index >= 40 ? 'medium' : 'low')} />
                        <SignalPill label="Blur" value={formatMs(Number(student.avg_blur_time_ms || 0))} />
                        <SignalPill label="Intensity" value={student.avg_interaction_intensity ?? 0} />
                        <SignalPill label="Entropy" value={student.avg_hover_entropy ?? 0} />
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </section>
        )}
          </div>
        </details>

        <section className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <BrainCircuit className="w-6 h-6 text-brand-purple" />
              <h2 className="text-3xl font-black">Concept Heatmap</h2>
            </div>
            <p className="font-bold text-brand-dark/60 mb-6">These are the concept clusters that generated the weakest outcomes across the class.</p>
            <div className="space-y-4">
              {topGapTags.map((tag: any) => (
                <div key={tag.tag} className="bg-brand-bg rounded-2xl border-2 border-brand-dark p-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Concept</p>
                      <p className="text-2xl font-black capitalize">{tag.tag}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black">{tag.accuracy.toFixed(0)}%</p>
                      <p className="text-xs font-bold text-brand-dark/50">{tag.students_count ?? tag.attempts ?? 0} students touched this topic</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
                    <SignalPill label="Stress" value={`${tag.stress_index.toFixed(0)}%`} tone={tag.stress_level} />
                    <SignalPill label="Avg TFI" value={formatMs(Number(tag.avg_tfi || 0))} />
                    <SignalPill label="1st Choice" value={`${Number(tag.first_choice_accuracy || 0).toFixed(0)}%`} tone={accuracyTone(Number(tag.first_choice_accuracy || 0))} />
                    <SignalPill label="Commit" value={formatMs(Number(tag.avg_commitment_latency_ms || 0))} />
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
                    <SignalPill label="Corrected" value={`${Number(tag.correction_rate || 0).toFixed(0)}%`} tone="good" />
                    <SignalPill label="Wrong Revision" value={`${Number(tag.changed_away_from_correct_rate || 0).toFixed(0)}%`} tone={Number(tag.changed_away_from_correct_rate || 0) >= 15 ? 'bad' : 'mid'} />
                    <SignalPill label="Deadline" value={`${Number(tag.deadline_dependency_rate || 0).toFixed(0)}%`} tone={Number(tag.deadline_dependency_rate || 0) >= 25 ? 'bad' : 'mid'} />
                    <SignalPill label="Panic" value={tag.total_panic_swaps} />
                  </div>
                  <Bar value={tag.accuracy} tone={accuracyTone(tag.accuracy)} />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-brand-yellow rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <AlertTriangle className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">Teacher Alerts</h2>
              </div>
              <div className="space-y-4">
                {alertList.length > 0 ? alertList.map((alert: any, index: number) => (
                  <div key={`${alert.type}-${index}`} className="bg-white rounded-2xl border-2 border-brand-dark p-4 shadow-[3px_3px_0px_0px_#1A1A1A]">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center ${alert.type === 'focus' ? 'bg-brand-purple text-white' : alert.type === 'mastery' ? 'bg-brand-dark text-brand-yellow' : 'bg-brand-orange text-white'}`}>
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-lg leading-tight mb-1">{alert.title}</p>
                        <p className="font-medium text-brand-dark/70">{alert.body}</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">No urgent class-level alerts were produced for this session.</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <BarChart3 className="w-6 h-6 text-brand-dark" />
                <h2 className="text-3xl font-black">Signal Distribution</h2>
              </div>
              <DistributionGroup title="Accuracy bands" items={accuracyDistribution} />
              <DistributionGroup title="Stress bands" items={stressDistribution} />
              <DistributionGroup title="Risk bands" items={riskDistribution} />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden mb-8">
          <div className="p-7 border-b-4 border-brand-dark bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black">Question Diagnostics</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Open with the hardest items first. The rest stay tucked behind a single click so the page keeps its hierarchy.</p>
            </div>
            <button
              onClick={() => downloadCsv(`${exportBaseName}-question-diagnostics.csv`, questionCsvRows)}
              className="w-fit px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <Download className="w-4 h-4" />
              Export Diagnostics CSV
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-5">
            {questionDiagnostics.slice(0, 4).map((question: any) => (
              <div key={question.question_id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Question {question.question_index}</p>
                    <p className="text-xl font-black leading-tight mb-3">{question.question_prompt}</p>
                    <div className="flex flex-wrap gap-2">
                      {(question.tags || []).map((tag: string) => (
                        <span key={`${question.question_id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                          {tag}
                        </span>
                      ))}
                      {question.learning_objective && (
                        <span className="px-3 py-1 rounded-full bg-emerald-100 border-2 border-brand-dark text-xs font-black">
                          {question.learning_objective}
                        </span>
                      )}
                      {question.bloom_level && (
                        <span className="px-3 py-1 rounded-full bg-brand-yellow border-2 border-brand-dark text-xs font-black">
                          {question.bloom_level}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 min-w-[220px]">
                    <SignalPill label="Difficulty" value={`${question.difficulty_index.toFixed(0)}%`} tone={question.difficulty_index >= 50 ? 'bad' : 'mid'} />
                    <SignalPill label="Discrimination" value={`${question.discrimination_index.toFixed(0)}pts`} tone={question.discrimination_index >= 30 ? 'good' : question.discrimination_index >= 10 ? 'mid' : 'bad'} />
                    <SignalPill label="Stress" value={`${question.stress_index.toFixed(0)}%`} tone={riskTone(question.stress_index >= 70 ? 'high' : question.stress_index >= 40 ? 'medium' : 'low')} />
                    <SignalPill label="Response" value={formatMs(Number(question.avg_response_ms || 0))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                      <span>Accuracy</span>
                      <span>{question.accuracy}%</span>
                    </div>
                    <Bar value={question.accuracy} tone={accuracyTone(question.accuracy)} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                      <span>Top vs Bottom Gap</span>
                      <span>{question.discrimination_index}pts</span>
                    </div>
                    <Bar value={Math.max(0, Math.min(100, question.discrimination_index + 50))} tone={question.discrimination_index >= 30 ? 'good' : question.discrimination_index >= 10 ? 'mid' : 'bad'} />
                  </div>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                  <SignalPill label="1st Choice" value={`${Number(question.first_choice_accuracy || 0).toFixed(0)}%`} tone={accuracyTone(Number(question.first_choice_accuracy || 0))} />
                  <SignalPill label="Recovered" value={`${Number(question.corrected_after_wrong_rate || 0).toFixed(0)}%`} tone="good" />
                  <SignalPill label="Wrong Revision" value={`${Number(question.changed_away_from_correct_rate || 0).toFixed(0)}%`} tone={Number(question.changed_away_from_correct_rate || 0) >= 15 ? 'bad' : 'mid'} />
                  <SignalPill label="Commit" value={formatMs(Number(question.avg_commitment_latency_ms || 0))} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-4 mt-4">
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Top distractor</p>
                    {question.top_distractor ? (
                      <>
                        <p className="font-black text-lg mb-1">
                          {question.top_distractor.label}. {question.top_distractor.text}
                        </p>
                        <p className="font-medium text-brand-dark/70">
                          {Number(question.top_distractor.rate || 0).toFixed(1)}% of students were pulled here.
                          Deadline dependency on this item was {Number(question.deadline_dependency_rate || 0).toFixed(1)}%.
                        </p>
                      </>
                    ) : (
                      <p className="font-medium text-brand-dark/70">
                        No single wrong option emerged as a dominant misconception on this question.
                      </p>
                    )}
                  </div>
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">Choice distribution</p>
                    <ChoiceDistributionSparkline
                      choices={question.choice_distribution || []}
                      highlightLabel={question.top_distractor?.label}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {questionDiagnostics.length > 4 && (
            <div className="px-6 pb-6">
              <details className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                <summary className="list-none cursor-pointer flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black">Show {questionDiagnostics.length - 4} more question diagnostics</p>
                    <p className="font-medium text-brand-dark/65">Keep the top trouble spots visible by default, and open the rest only when you need item-level follow-up.</p>
                  </div>
                  <ChevronDown className="w-5 h-5 shrink-0" />
                </summary>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
                  {questionDiagnostics.slice(4).map((question: any) => (
                    <div key={`extra-${question.question_id}`} className="rounded-[1.75rem] border-2 border-brand-dark bg-white p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Question {question.question_index}</p>
                          <p className="text-xl font-black leading-tight mb-3">{question.question_prompt}</p>
                          <div className="flex flex-wrap gap-2">
                            {(question.tags || []).map((tag: string) => (
                              <span key={`extra-${question.question_id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark text-xs font-black capitalize">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 min-w-[220px]">
                          <SignalPill label="Difficulty" value={`${question.difficulty_index.toFixed(0)}%`} tone={question.difficulty_index >= 50 ? 'bad' : 'mid'} />
                          <SignalPill label="Stress" value={`${question.stress_index.toFixed(0)}%`} tone={riskTone(question.stress_index >= 70 ? 'high' : question.stress_index >= 40 ? 'medium' : 'low')} />
                          <SignalPill label="1st Choice" value={`${Number(question.first_choice_accuracy || 0).toFixed(0)}%`} tone={accuracyTone(Number(question.first_choice_accuracy || 0))} />
                          <SignalPill label="Commit" value={formatMs(Number(question.avg_commitment_latency_ms || 0))} />
                        </div>
                      </div>
                      <p className="font-medium text-brand-dark/70">
                        {question.top_distractor
                          ? `${Number(question.top_distractor.rate || 0).toFixed(0)}% were pulled to distractor ${question.top_distractor.label}.`
                          : 'No single distractor dominated this item.'}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>

        <section className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden mb-8">
          <div className="p-7 border-b-4 border-brand-dark bg-white">
            <h2 className="text-3xl font-black">Distractor Heatmap</h2>
            <p className="font-bold text-brand-dark/60 mt-2">See whether errors are scattered or whether the same distractors are repeatedly seducing the class.</p>
          </div>
          <div className="p-6">
            <DistractorHeatmapChart heatmap={distractorHeatmap} />
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-purple text-white">
              <h2 className="text-3xl font-black">Question Pressure Map</h2>
              <p className="font-bold text-white/70 mt-2">Every item is scored on both mastery and behavioral pressure.</p>
            </div>
            <div className="p-6 space-y-4">
              {questionRows.map((question: any) => (
                <div key={question.id} className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-5">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Question {question.index}</p>
                      <p className="text-xl font-black leading-tight">{question.prompt}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {question.tags?.map((tag: string) => (
                          <span key={`${question.id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 min-w-[200px]">
                      <SignalPill label="Accuracy" value={`${question.accuracy.toFixed(0)}%`} tone={accuracyTone(question.accuracy)} />
                      <SignalPill label="Stress" value={`${question.stress_index.toFixed(0)}%`} tone={question.stress_level} />
                      <SignalPill label="1st Choice" value={`${Number(question.first_choice_accuracy || 0).toFixed(0)}%`} tone={accuracyTone(Number(question.first_choice_accuracy || 0))} />
                      <SignalPill label="Deadline" value={`${Number(question.deadline_dependency_rate || 0).toFixed(0)}%`} tone={Number(question.deadline_dependency_rate || 0) >= 25 ? 'bad' : 'mid'} />
                    </div>
                  </div>
                  <Bar value={question.accuracy} tone={accuracyTone(question.accuracy)} />
                  <p className="font-medium text-brand-dark/70 mt-3">{question.recommendation}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <Sparkles className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">Attention Queue</h2>
              </div>
              <div className="space-y-3">
                {(data?.studentSpotlight?.attention_needed || []).slice(0, 5).map((student: any) => (
                  <button
                    key={`queue-${student.id}`}
                    onMouseEnter={() => setSelectedStudentId(Number(student.id))}
                    onFocus={() => setSelectedStudentId(Number(student.id))}
                    onClick={() => openStudentDashboard(student.id)}
                    className={`w-full text-left rounded-2xl border-2 border-brand-dark p-4 transition-colors ${Number(selectedStudent?.id) === Number(student.id) ? 'bg-brand-yellow' : 'bg-brand-bg hover:bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-lg font-black">{student.nickname}</p>
                      <RiskBadge level={student.risk_level} compact />
                    </div>
                    <p className="font-medium text-brand-dark/70">{student.recommendation}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-7">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Data Pack</p>
              <h2 className="text-3xl font-black mb-3">Research export ready</h2>
              <p className="font-medium text-white/75 mb-5">
                Exported response rows include timing, swaps, focus-loss, commit window, volatility, and question metadata so the session can be reused later for statistical analysis.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <MiniMetric label="Rows" value={compactNumber.format(researchRows.length || 0)} />
                <MiniMetric label="Questions" value={`${questionDiagnostics.length}`} />
                <MiniMetric label="Students" value={`${participants.length}`} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
          <div className="p-7 border-b-4 border-brand-dark bg-white">
            <h2 className="text-3xl font-black">Student Command Center</h2>
            <p className="font-bold text-brand-dark/60 mt-2">Select a student for quick insight, then drill into the personal dashboard to build a same-material follow-up game.</p>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {participants.map((student: any) => (
              <button
                key={student.id}
                onMouseEnter={() => setSelectedStudentId(Number(student.id))}
                onFocus={() => setSelectedStudentId(Number(student.id))}
                onClick={() => openStudentDashboard(student.id)}
                className={`text-left rounded-[1.75rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-1 ${Number(selectedStudent?.id) === Number(student.id) ? 'bg-brand-yellow' : 'bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">Rank #{student.rank}</p>
                    <h3 className="text-2xl font-black">{student.nickname}</h3>
                    <p className="font-bold text-brand-dark/60">{student.decision_style}</p>
                  </div>
                  <RiskBadge level={student.risk_level} compact />
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <SignalPill label="Score" value={student.total_score} />
                  <SignalPill label="Accuracy" value={`${student.accuracy.toFixed(0)}%`} tone={accuracyTone(student.accuracy)} />
                  <SignalPill label="Stress" value={`${student.stress_index.toFixed(0)}%`} tone={student.stress_level} />
                  <SignalPill label="Focus" value={student.focus_score || 0} />
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {(student.weak_tags || []).slice(0, 3).map((tag: string) => (
                    <span key={`${student.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-orange/10 border-2 border-brand-dark text-xs font-black capitalize">
                      {tag}
                    </span>
                  ))}
                </div>

                <p className="font-medium text-brand-dark/70 mb-4 min-h-[72px]">{student.recommendation}</p>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-brand-purple">Open individual dashboard</span>
                  <div className="w-10 h-10 rounded-full bg-brand-dark text-white border-2 border-brand-dark flex items-center justify-center">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ResearchLineChart({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">No sequence data available for this session.</p>;
  }

  const width = 760;
  const height = 280;
  const padding = 28;
  const maxResponseMs = Math.max(...rows.map((row) => Number(row.avg_response_ms) || 0), 1);
  const step = rows.length === 1 ? 0 : (width - padding * 2) / (rows.length - 1);

  const accuracyPoints = rows
    .map((row, index) => `${padding + step * index},${padding + ((100 - Number(row.accuracy || 0)) / 100) * (height - padding * 2)}`)
    .join(' ');
  const stressPoints = rows
    .map((row, index) => `${padding + step * index},${padding + ((100 - Number(row.stress_index || 0)) / 100) * (height - padding * 2)}`)
    .join(' ');
  const lowestAccuracyRow = [...rows].sort((left, right) => Number(left.accuracy || 0) - Number(right.accuracy || 0))[0];
  const highestStressRow = [...rows].sort((left, right) => Number(right.stress_index || 0) - Number(left.stress_index || 0))[0];
  const swingRow =
    rows.slice(1).reduce(
      (best, row, index) => {
        const delta = Number(row.accuracy || 0) - Number(rows[index].accuracy || 0);
        if (Math.abs(delta) > Math.abs(best.delta)) {
          return { row, delta };
        }
        return best;
      },
      { row: rows[0], delta: 0 } as { row: any; delta: number },
    ) || { row: rows[0], delta: 0 };
  const turningPoints = [
    {
      id: 'low-point',
      label: 'Lowest mastery moment',
      title: `Q${lowestAccuracyRow.question_index} fell to ${Number(lowestAccuracyRow.accuracy || 0).toFixed(0)}% accuracy`,
      body: `${Number(lowestAccuracyRow.stress_index || 0).toFixed(0)}% stress with ${formatMs(Number(lowestAccuracyRow.avg_response_ms || 0))} average response time.`,
      tone: 'bad' as const,
    },
    {
      id: 'pressure-peak',
      label: 'Highest pressure point',
      title: `Q${highestStressRow.question_index} peaked at ${Number(highestStressRow.stress_index || 0).toFixed(0)}% stress`,
      body: `${Number(highestStressRow.panic_swaps || 0)} panic swaps and ${Number(highestStressRow.avg_swaps || 0).toFixed(1)} average revisions.`,
      tone: 'mid' as const,
    },
    {
      id: 'swing',
      label: swingRow.delta >= 0 ? 'Strongest recovery' : 'Sharpest drop',
      title: `Q${swingRow.row?.question_index} ${swingRow.delta >= 0 ? 'rebounded' : 'dropped'} by ${Math.abs(Number(swingRow.delta || 0)).toFixed(0)} points`,
      body: `This shift came with ${formatMs(Number(swingRow.row?.avg_response_ms || 0))} response time and ${Number(swingRow.row?.stress_index || 0).toFixed(0)}% stress.`,
      tone: swingRow.delta >= 0 ? ('good' as const) : ('bad' as const),
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {turningPoints.map((point) => (
          <div key={point.id} className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{point.label}</p>
                <p className="font-black leading-tight">{point.title}</p>
              </div>
              <div
                className={`w-10 h-10 shrink-0 rounded-full border-2 border-brand-dark flex items-center justify-center ${
                  point.tone === 'good'
                    ? 'bg-emerald-300 text-brand-dark'
                    : point.tone === 'mid'
                      ? 'bg-brand-yellow text-brand-dark'
                      : 'bg-brand-orange text-white'
                }`}
              >
                {point.tone === 'good' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              </div>
            </div>
            <p className="font-medium text-sm text-brand-dark/68">{point.body}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mb-5">
        <LegendSwatch label="Accuracy" color="bg-brand-purple" />
        <LegendSwatch label="Stress" color="bg-brand-orange" />
        <LegendSwatch label="Response Bars" color="bg-brand-yellow" />
      </div>
      <div className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[620px] h-[300px]">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padding + ((100 - tick) / 100) * (height - padding * 2);
            return (
              <g key={tick}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.15" strokeWidth="1" />
                <text x={4} y={y + 4} fontSize="11" fontWeight="700" fill="#1A1A1A">
                  {tick}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = padding + step * index;
            const barHeight = ((Number(row.avg_response_ms || 0) / maxResponseMs) * (height - padding * 2)) * 0.42;
            const y = height - padding - barHeight;
            return (
              <g key={`bar-${row.question_index}`}>
                <rect x={x - 12} y={y} width="24" height={barHeight} rx="10" fill="#F6CD3B" stroke="#1A1A1A" strokeWidth="2" />
                <text x={x} y={height - 6} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1A1A1A">
                  Q{row.question_index}
                </text>
              </g>
            );
          })}

          <polyline fill="none" stroke="#8B5CF6" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={accuracyPoints} />
          <polyline fill="none" stroke="#FF5A36" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={stressPoints} />

          {rows.map((row, index) => {
            const x = padding + step * index;
            const accuracyY = padding + ((100 - Number(row.accuracy || 0)) / 100) * (height - padding * 2);
            const stressY = padding + ((100 - Number(row.stress_index || 0)) / 100) * (height - padding * 2);
            return (
              <g key={`dots-${row.question_index}`}>
                <circle cx={x} cy={accuracyY} r="5" fill="#8B5CF6" stroke="#1A1A1A" strokeWidth="2" />
                <circle cx={x} cy={stressY} r="5" fill="#FF5A36" stroke="#1A1A1A" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function StudentScatterPlot({
  participants,
  selectedStudentId,
  onSelect,
  onOpen,
}: {
  participants: any[];
  selectedStudentId?: number;
  onSelect: (studentId: number) => void;
  onOpen: (studentId: number) => void;
}) {
  const width = 432;
  const height = 316;
  const padding = 34;
  const quadrantCounts = participants.reduce(
    (counts, student) => {
      const accuracy = Number(student.accuracy || 0);
      const stress = Number(student.stress_index || 0);
      if (accuracy >= 50 && stress < 50) counts.stable += 1;
      else if (accuracy >= 50 && stress >= 50) counts.pressured += 1;
      else if (accuracy < 50 && stress >= 50) counts.struggling += 1;
      else counts.quiet += 1;
      return counts;
    },
    { stable: 0, pressured: 0, struggling: 0, quiet: 0 },
  );
  const selectedStudent =
    participants.find((student) => Number(student.id) === Number(selectedStudentId)) ||
    [...participants].sort((left, right) => severityRank(right.risk_level) - severityRank(left.risk_level))[0] ||
    null;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="grid grid-cols-2 gap-3">
        <ScatterSummaryChip label="Stable cluster" value={quadrantCounts.stable} body="High accuracy without visible pressure drag." tone="good" />
        <ScatterSummaryChip label="Pressured correctors" value={quadrantCounts.pressured} body="Still right, but spending cognitive budget to get there." tone="mid" />
        <ScatterSummaryChip label="Struggling unstable" value={quadrantCounts.struggling} body="Low accuracy with high pressure and likely collapse risk." tone="bad" />
        <ScatterSummaryChip label="Quiet underperformance" value={quadrantCounts.quiet} body="Not visibly stressed, but still landing wrong." tone="neutral" />
      </div>

      <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-4">
        <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-3 overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto max-h-[320px]">
            <defs>
              <filter id="scatter-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="0" floodColor="#1A1A1A" floodOpacity="0.22" />
              </filter>
            </defs>

            <rect x={padding} y={padding} width={(width - padding * 2) / 2} height={(height - padding * 2) / 2} rx="26" fill="#FFE4DD" />
            <rect x={width / 2} y={padding} width={(width - padding * 2) / 2} height={(height - padding * 2) / 2} rx="26" fill="#FFF3BE" />
            <rect x={padding} y={height / 2} width={(width - padding * 2) / 2} height={(height - padding * 2) / 2} rx="26" fill="#F8F0D0" />
            <rect x={width / 2} y={height / 2} width={(width - padding * 2) / 2} height={(height - padding * 2) / 2} rx="26" fill="#EFE7FF" />

            {[0, 25, 50, 75, 100].map((tick) => {
              const x = padding + (tick / 100) * (width - padding * 2);
              const y = height - padding - (tick / 100) * (height - padding * 2);
              return (
                <g key={tick}>
                  <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#1A1A1A" strokeOpacity={tick === 50 ? '0.26' : '0.08'} strokeWidth={tick === 50 ? '2' : '1'} strokeDasharray={tick === 50 ? '10 10' : '6 10'} />
                  <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity={tick === 50 ? '0.26' : '0.08'} strokeWidth={tick === 50 ? '2' : '1'} strokeDasharray={tick === 50 ? '10 10' : '6 10'} />
                  {tick < 100 && tick > 0 ? (
                    <>
                      <text x={x} y={height - 10} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A" opacity="0.5">
                        {tick}
                      </text>
                      <text x={16} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A" opacity="0.5">
                        {tick}
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}

            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#1A1A1A" strokeWidth="2.5" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#1A1A1A" strokeWidth="2.5" />

            <QuadrantLabel x={padding + 14} y={padding + 16} title="Struggling + unstable" body="Wrong and visibly overloaded." />
            <QuadrantLabel x={width / 2 + 12} y={padding + 16} title="Pressured but correct" body="Knows enough, but not calmly." />
            <QuadrantLabel x={padding + 14} y={height / 2 + 14} title="Quiet underperformance" body="Low mastery without overt stress." />
            <QuadrantLabel x={width / 2 + 12} y={height / 2 + 14} title="Stable high performers" body="Strong and under control." />

            <text x={width / 2} y={height - 2} textAnchor="middle" fontSize="12" fontWeight="900" fill="#1A1A1A">Accuracy</text>
            <text x={18} y={height / 2} textAnchor="middle" fontSize="12" fontWeight="900" fill="#1A1A1A" transform={`rotate(-90 18 ${height / 2})`}>Stress</text>

            {participants.map((student) => {
              const x = padding + (Number(student.accuracy || 0) / 100) * (width - padding * 2);
              const y = height - padding - (Number(student.stress_index || 0) / 100) * (height - padding * 2);
              const isSelected = Number(selectedStudentId) === Number(student.id);
              const fill =
                student.risk_level === 'high'
                  ? '#FF5A36'
                  : student.risk_level === 'medium'
                    ? '#F6CD3B'
                    : '#8B5CF6';

              return (
                <g
                  key={student.id}
                  onMouseEnter={() => onSelect(Number(student.id))}
                  onFocus={() => onSelect(Number(student.id))}
                  onClick={() => onOpen(Number(student.id))}
                  className="cursor-pointer"
                >
                  {isSelected && <circle cx={x} cy={y} r="19" fill={fill} opacity="0.18" />}
                  <circle cx={x} cy={y} r={isSelected ? 13 : 10.5} fill={fill} stroke="#1A1A1A" strokeWidth="3" filter="url(#scatter-shadow)" />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill={fill === '#F6CD3B' ? '#1A1A1A' : '#FFFFFF'}>
                    {String(student.nickname || '?').trim().charAt(0).toUpperCase()}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <LegendRow label="Stable" tone="bg-brand-purple" body="High/medium accuracy with controlled stress." />
        <LegendRow label="Watch" tone="bg-brand-yellow" body="Mixed profile that needs teacher attention." />
        <LegendRow label="High Risk" tone="bg-brand-orange" body="Low mastery or high pressure collapse pattern." />
      </div>

      {selectedStudent && (
        <div className="rounded-[1.35rem] border-2 border-brand-dark bg-white p-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-1">Selected student</p>
              <p className="text-xl font-black">{selectedStudent.nickname}</p>
            </div>
            <RiskBadge level={selectedStudent.risk_level} compact />
          </div>
          <p className="font-medium text-sm text-brand-dark/68">
            {selectedStudent.accuracy.toFixed(0)}% accuracy at {selectedStudent.stress_index.toFixed(0)}% stress. Click the dot again to open the individual dashboard.
          </p>
        </div>
      )}
    </div>
  );
}

function QuadrantLabel({
  x,
  y,
  title,
  body,
}: {
  x: number;
  y: number;
  title: string;
  body: string;
}) {
  return (
    <foreignObject x={x} y={y} width="148" height="52">
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          border: '2px solid #1A1A1A',
          borderRadius: '16px',
          background: 'rgba(255,255,255,0.88)',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        <div style={{ fontSize: '10px', fontWeight: 900, lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1.1, opacity: 0.72 }}>{body}</div>
      </div>
    </foreignObject>
  );
}

function ScatterSummaryChip({
  label,
  value,
  body,
  tone,
}: {
  label: string;
  value: number;
  body: string;
  tone: 'good' | 'mid' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-brand-purple text-white'
      : tone === 'mid'
        ? 'bg-brand-yellow text-brand-dark'
        : tone === 'bad'
          ? 'bg-brand-orange text-white'
          : 'bg-white text-brand-dark';

  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 leading-tight">{label}</p>
        <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black ${toneClass}`}>{value}</span>
      </div>
      <p className="font-medium text-sm text-brand-dark/68 leading-snug">{body}</p>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mb-5 max-w-4xl">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-purple mb-2">{eyebrow}</p>
      <h2 className="text-3xl lg:text-[2.35rem] font-black tracking-tight leading-tight">{title}</h2>
      <p className="font-bold text-brand-dark/62 mt-2">{body}</p>
    </div>
  );
}

function SummaryStripCard({
  label,
  title,
  body,
  accent,
}: {
  label: string;
  title: string;
  body: string;
  accent: string;
}) {
  return (
    <div className={`${accent} rounded-[1.6rem] border-2 border-brand-dark p-4 shadow-[4px_4px_0px_0px_#1A1A1A]`}>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] opacity-70 mb-2">{label}</p>
      <p className="text-lg font-black leading-tight">{title}</p>
      <p className="font-medium text-sm opacity-80 mt-2">{body}</p>
    </div>
  );
}

function ContextChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'mid' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-100 text-brand-dark'
      : tone === 'mid'
        ? 'bg-brand-yellow text-brand-dark'
        : tone === 'bad'
          ? 'bg-brand-orange text-white'
          : 'bg-white text-brand-dark';

  return (
    <span className={`${toneClass} inline-flex items-center gap-2 rounded-full border-2 border-brand-dark px-3 py-2 text-xs font-black uppercase tracking-[0.16em]`}>
      <span className="opacity-55">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function VerdictCard({
  label,
  title,
  body,
  tone,
}: {
  label: string;
  title: string;
  body: string;
  tone: 'good' | 'mid' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-50'
      : tone === 'mid'
        ? 'bg-brand-yellow/25'
        : 'bg-brand-orange/12';
  const badgeClass =
    tone === 'good'
      ? 'bg-emerald-300 text-brand-dark'
      : tone === 'mid'
        ? 'bg-brand-yellow text-brand-dark'
        : 'bg-brand-orange text-white';

  return (
    <div className={`${toneClass} rounded-[1.35rem] border-2 border-brand-dark p-4`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50 mr-1">{label}</p>
            {label.toLowerCase().includes('quality') && <InfoTooltip metricId="decision-quality" />}
            {label.toLowerCase().includes('stability') && <InfoTooltip metricId="confidence-stability" />}
            {label.toLowerCase().includes('efficiency') && <InfoTooltip metricId="revision-efficiency" />}
          </div>
          <p className="font-black leading-tight">{title}</p>
        </div>
        <div className={`w-10 h-10 shrink-0 rounded-full border-2 border-brand-dark flex items-center justify-center ${badgeClass}`}>
          {tone === 'good' ? <CheckCircle2 className="w-4 h-4" /> : tone === 'mid' ? <TrendingUp className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        </div>
      </div>
      <p className="font-medium text-sm text-brand-dark/70">{body}</p>
    </div>
  );
}

function FindingCallout({
  title,
  body,
  tone,
  metric,
}: {
  title: string;
  body: string;
  tone: 'good' | 'mid' | 'bad';
  metric: number;
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-50'
      : tone === 'mid'
        ? 'bg-brand-bg'
        : 'bg-brand-orange/10';

  return (
    <div className={`${toneClass} rounded-[1.25rem] border-2 border-brand-dark p-4`}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-black leading-tight">{title}</p>
          <p className="font-medium text-sm text-brand-dark/68 mt-1">{body}</p>
        </div>
        <span className="shrink-0 px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
          {metric.toFixed(0)}%
        </span>
      </div>
      <Bar value={metric} tone={tone} />
    </div>
  );
}

function FlowSummaryCard({
  label,
  count,
  rate,
  tone,
}: {
  label: string;
  count: number;
  rate: number;
  tone: 'good' | 'mid' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-50'
      : tone === 'mid'
        ? 'bg-brand-bg'
        : 'bg-brand-orange/10';
  const badgeClass =
    tone === 'good'
      ? 'bg-brand-purple text-white'
      : tone === 'mid'
        ? 'bg-brand-yellow text-brand-dark'
        : 'bg-brand-orange text-white';
  return (
    <div className={`${toneClass} rounded-[1.35rem] border-2 border-brand-dark p-4 shadow-[4px_4px_0px_0px_#1A1A1A]`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 max-w-[11rem] leading-tight">{label}</p>
          {label.toLowerCase().includes('positive') && <InfoTooltip metricId="revision-efficiency" />}
          {label.toLowerCase().includes('harmful') && <InfoTooltip metricId="harmful-revisions" />}
        </div>
        <span className={`shrink-0 rounded-full border-2 border-brand-dark px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${badgeClass}`}>
          {rate.toFixed(0)}%
        </span>
      </div>
      <p className="text-[2rem] font-black leading-none">{compactNumber.format(count)}</p>
      <p className="font-medium text-sm text-brand-dark/68 mt-2">of all response rows followed this path.</p>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  status,
  note,
  color,
  textColor = 'text-brand-dark',
}: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  status: string;
  note: string;
  color: string;
  textColor?: string;
}) {
  return (
    <div className={`${color} ${textColor} rounded-[1.75rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center">
          <p className="text-sm font-black uppercase tracking-[0.15em] opacity-70">{title}</p>
          <InfoTooltip metricId={title.toLowerCase().replace(/\s+/g, '-')} />
        </div>
        <div>{icon}</div>
      </div>
      <p className="text-4xl font-black leading-none">{value}</p>
      <p className="font-black mt-3">{status}</p>
      <p className="font-medium text-sm opacity-75 mt-2">{note}</p>
    </div>
  );
}

function ChoiceDistributionSparkline({
  choices,
  highlightLabel,
}: {
  choices: any[];
  highlightLabel?: string;
}) {
  if (!choices.length) {
    return <p className="font-bold text-brand-dark/55">No choice-distribution data available.</p>;
  }

  const maxRate = Math.max(...choices.map((choice) => Number(choice.rate) || 0), 1);

  return (
    <div className="grid grid-cols-4 gap-3">
      {choices.map((choice) => {
        const isHighlighted = highlightLabel && choice.label === highlightLabel;
        const tone = isHighlighted ? 'bg-brand-orange' : choice.is_correct ? 'bg-brand-purple' : 'bg-brand-yellow';
        const height = Math.max(18, (Number(choice.rate || 0) / maxRate) * 74);
        return (
          <div key={`choice-${choice.label}`} className="rounded-[1.1rem] border-2 border-brand-dark bg-brand-bg p-2 text-center">
            <div className="h-[84px] flex items-end justify-center mb-2">
              <div
                className={`${tone} w-8 rounded-t-xl border-2 border-brand-dark`}
                style={{ height }}
                title={`${choice.label}: ${choice.count} students`}
              />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em]">{choice.label}</p>
            <p className="text-[11px] font-bold text-brand-dark/65">{Number(choice.rate || 0).toFixed(0)}%</p>
          </div>
        );
      })}
    </div>
  );
}

function DecisionFlowStageBadge({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.15rem] border-2 border-brand-dark bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/42 mb-1">{title}</p>
      <p className="font-black text-sm leading-tight">{body}</p>
    </div>
  );
}

function DecisionFlowLegendPill({
  label,
  color,
  body,
}: {
  label: string;
  color: string;
  body: string;
}) {
  return (
    <div className="rounded-[1.15rem] border-2 border-brand-dark bg-white px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-3.5 h-3.5 rounded-full border-2 border-brand-dark ${color}`} />
        <p className="font-black text-sm">{label}</p>
      </div>
      <p className="font-medium text-xs text-brand-dark/65 leading-snug">{body}</p>
    </div>
  );
}

function DecisionRevisionFlowChart({ flow }: { flow: any }) {
  if (!flow?.total) {
    return <p className="font-bold text-brand-dark/60">No revision-flow data available yet.</p>;
  }

  const width = 1060;
  const height = 468;
  const nodeWidth = 198;
  const nodePaddingX = 18;
  const columnX = [42, 430, 820];
  const availableHeight = 286;
  const topOffset = 98;
  const gap = 24;
  const scale = availableHeight / Math.max(1, Number(flow.total || 1));
  const toneFill = {
    good: '#8B5CF6',
    mid: '#F6CD3B',
    bad: '#FF5A36',
  } as Record<string, string>;
  const layout = new Map<string, { x: number; y: number; height: number; tone: string; label: string; count: number; rate: number }>();
  const highlightedLinks = [...flow.links]
    .sort((left: any, right: any) => Number(right.value || 0) - Number(left.value || 0))
    .slice(0, 3);

  flow.columns.forEach((column: any[], columnIndex: number) => {
    const heights = column.map((node) => Math.max(118, Number(node.count || 0) * scale));
    const totalHeight = heights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, column.length - 1);
    let y = topOffset + (availableHeight - totalHeight) / 2;
    column.forEach((node, index) => {
      layout.set(node.id, {
        x: columnX[columnIndex],
        y,
        height: heights[index],
        tone: node.tone,
        label: node.label,
        count: Number(node.count || 0),
        rate: Number(node.rate || 0),
      });
      y += heights[index] + gap;
    });
  });

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DecisionFlowStageBadge title="First choice" body="Who started right versus who entered the question confused." />
        <DecisionFlowStageBadge title="Revision" body="Whether students held the line or changed answers after inspecting options." />
        <DecisionFlowStageBadge title="Final answer" body="Where the class finished after that decision path played out." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DecisionFlowLegendPill label="Helpful path" color="bg-brand-purple" body="Revisions that moved students into a correct final answer." />
        <DecisionFlowLegendPill label="Neutral path" color="bg-brand-yellow" body="Students held or changed without improving overall accuracy." />
        <DecisionFlowLegendPill label="Harmful path" color="bg-brand-orange" body="Students moved away from the right answer or stayed trapped in error." />
      </div>

      <div className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[980px] h-auto" style={{ overflow: 'visible' }}>
          <defs>
            <filter id="decision-node-shadow" x="-20%" y="-20%" width="150%" height="150%">
              <feDropShadow dx="0" dy="6" stdDeviation="0" floodColor="#1A1A1A" floodOpacity="0.16" />
            </filter>
          </defs>

          {[0, 1, 2].map((columnIndex) => (
            <g key={`column-shell-${columnIndex}`}>
              <rect
                x={columnX[columnIndex] - 16}
                y={54}
                width={nodeWidth + 32}
                height={height - 84}
                rx="30"
                fill="#FFFFFF"
                stroke="#1A1A1A"
                strokeOpacity="0.1"
                strokeWidth="2"
              />
            </g>
          ))}

          {flow.links.map((link: any, index: number) => {
            const source = layout.get(link.source);
            const target = layout.get(link.target);
            if (!source || !target || !link.value) return null;
            const startX = source.x + nodeWidth;
            const endX = target.x;
            const startY = source.y + source.height / 2;
            const endY = target.y + target.height / 2;
            const curve = `M ${startX} ${startY} C ${startX + 96} ${startY}, ${endX - 96} ${endY}, ${endX} ${endY}`;
            const stroke = toneFill[source.tone] || '#1A1A1A';
            const strokeWidth = Math.min(74, Math.max(12, Number(link.value || 0) * scale));
            return (
              <g key={`${link.source}-${link.target}-${index}`}>
                <path
                  d={curve}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity="0.24"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
                {highlightedLinks.some((highlightedLink: any) => highlightedLink.source === link.source && highlightedLink.target === link.target) && (
                  <>
                    <rect
                      x={(startX + endX) / 2 - 28}
                      y={(startY + endY) / 2 - 16}
                      width="56"
                      height="24"
                      rx="12"
                      fill="#FFFFFF"
                      stroke="#1A1A1A"
                      strokeWidth="2"
                    />
                    <text
                      x={(startX + endX) / 2}
                      y={(startY + endY) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontWeight="900"
                      fill="#1A1A1A"
                    >
                      {Number(link.rate || 0).toFixed(0)}%
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {[0, 1, 2].map((columnIndex) => (
            <g key={`column-label-${columnIndex}`}>
              <rect
                x={columnX[columnIndex] + nodeWidth / 2 - 78}
                y={16}
                width="156"
                height="32"
                rx="16"
                fill="#FFFFFF"
                stroke="#1A1A1A"
                strokeWidth="2"
              />
              <text
                x={columnX[columnIndex] + nodeWidth / 2}
                y={32}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="13"
                fontWeight="900"
                fill="#1A1A1A"
              >
                {columnIndex === 0 ? 'First Choice' : columnIndex === 1 ? 'Revision' : 'Final Answer'}
              </text>
            </g>
          ))}

          {Array.from(layout.entries()).map(([id, node]) => (
            <g key={id}>
              <rect
                x={node.x}
                y={node.y}
                width={nodeWidth}
                height={node.height}
                rx="28"
                fill={toneFill[node.tone] || '#FFFFFF'}
                stroke="#1A1A1A"
                strokeWidth="3"
                filter="url(#decision-node-shadow)"
              />
              <foreignObject x={node.x + nodePaddingX} y={node.y + 14} width={nodeWidth - nodePaddingX * 2} height={node.height - 28}>
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    height: '100%',
                    color: node.tone === 'bad' ? '#FFFFFF' : '#1A1A1A',
                    fontFamily: 'inherit',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: node.tone === 'bad' ? 0.74 : 0.5 }}>
                      {node.tone === 'good' ? 'Strong path' : node.tone === 'mid' ? 'Watch path' : 'Risk path'}
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 900, lineHeight: 1.05, wordBreak: 'break-word' }}>
                      {node.label}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '38px', fontWeight: 900, lineHeight: 1 }}>
                      {compactNumber.format(node.count)}
                    </div>
                    <div
                      style={{
                        padding: '6px 10px',
                        borderRadius: '999px',
                        border: '2px solid #1A1A1A',
                        background: node.tone === 'bad' ? 'rgba(255,255,255,0.18)' : '#FFFFFF',
                        color: node.tone === 'bad' ? '#FFFFFF' : '#1A1A1A',
                        fontSize: '11px',
                        fontWeight: 900,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {node.rate.toFixed(1)}%
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      lineHeight: 1.18,
                      opacity: node.tone === 'bad' ? 0.84 : 0.74,
                      wordBreak: 'break-word',
                    }}
                  >
                    {node.tone === 'good'
                      ? 'A stronger instructional checkpoint.'
                      : node.tone === 'mid'
                        ? 'Needs context to know whether the change helped.'
                        : 'This path deserves the fastest teacher response.'}
                  </div>
                </div>
              </foreignObject>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function RecoveryPatternsChart({ rows }: { rows: any[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  if (!total) {
    return <p className="font-bold text-brand-dark/60">No recovery transitions were available for this session.</p>;
  }

  const tones = {
    error_to_correct: 'bg-emerald-400',
    hesitant_correct: 'bg-brand-purple',
    error_to_error: 'bg-brand-orange',
    error_to_timeout: 'bg-brand-dark',
    rushed_wrong: 'bg-brand-yellow',
  } as Record<string, string>;
  const descriptions = {
    error_to_correct: 'Students missed one item and recovered immediately on the next question.',
    hesitant_correct: 'Students recovered, but only after a slower and less stable follow-up.',
    error_to_error: 'The mistake carried into the next question with no visible reset.',
    error_to_timeout: 'The post-error pattern escalated into non-response under pressure.',
    rushed_wrong: 'Students sped up after the error, but the faster move stayed wrong.',
  } as Record<string, string>;

  return (
    <div>
      <div className="h-8 rounded-full border-2 border-brand-dark overflow-hidden flex mb-5">
        {rows.map((row) => (
          <div
            key={`stack-${row.id}`}
            className={`${tones[row.id] || 'bg-white'} h-full`}
            style={{ width: `${(Number(row.count || 0) / total) * 100}%` }}
            title={`${row.label}: ${row.count}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-5 h-5 rounded-full border-2 border-brand-dark ${tones[row.id] || 'bg-white'}`} />
                <div className="min-w-0">
                  <p className="font-black leading-tight">{row.label}</p>
                  <p className="font-medium text-sm text-brand-dark/66 mt-1">{descriptions[row.id] || 'Follow-up behavior after an error.'}</p>
                </div>
              </div>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black shrink-0">
                {Number(row.rate || 0).toFixed(1)}%
              </span>
            </div>
            <Bar value={Number(row.rate || 0)} tone={row.id === 'error_to_correct' || row.id === 'hesitant_correct' ? 'good' : row.id === 'rushed_wrong' ? 'mid' : 'bad'} />
            <p className="font-black text-xs uppercase tracking-[0.16em] text-brand-dark/45 mt-3">{row.count} follow-up transitions</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FatigueTimelineChart({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">No drift timeline is available yet.</p>;
  }

  const lastRow = rows[rows.length - 1] || {};
  const metrics = [
    {
      id: 'accuracy',
      label: 'Rolling Accuracy',
      key: 'rolling_accuracy',
      color: '#8B5CF6',
      summary: `${Number(lastRow.rolling_accuracy || 0).toFixed(0)}%`,
      normalize: (value: number) => value,
    },
    {
      id: 'response',
      label: 'Rolling Response',
      key: 'rolling_response_ms',
      color: '#FF5A36',
      summary: formatMs(Number(lastRow.rolling_response_ms || 0)),
      normalize: (value: number, all: number[]) => {
        const max = Math.max(...all, 1);
        return (value / max) * 100;
      },
    },
    {
      id: 'volatility',
      label: 'Rolling Hesitation',
      key: 'rolling_volatility',
      color: '#F6CD3B',
      summary: `${Number(lastRow.rolling_volatility || 0).toFixed(0)} pts`,
      normalize: (value: number) => value,
    },
  ];

  return (
    <div className="space-y-5">
      {metrics.map((metric) => {
        const values = rows.map((row) => Number(row[metric.key] || 0));
        const points = values
          .map((value, index) => {
            const x = rows.length === 1 ? 30 : 30 + (index / Math.max(1, rows.length - 1)) * 690;
            const normalized = metric.normalize(value, values);
            const y = 110 - (Math.max(0, Math.min(100, normalized)) / 100) * 80;
            return `${x},${y}`;
          })
          .join(' ');
        return (
          <div key={metric.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{metric.label}</p>
                <p className="font-medium text-brand-dark/65">Q1 to Q{rows.length}</p>
              </div>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">{metric.summary}</span>
            </div>
            <svg viewBox="0 0 750 120" className="w-full h-28">
              {[0, 50, 100].map((tick) => {
                const y = 110 - (tick / 100) * 80;
                return <line key={`${metric.id}-${tick}`} x1="30" y1={y} x2="720" y2={y} stroke="#1A1A1A" strokeOpacity="0.12" strokeWidth="1" />;
              })}
              <polyline fill="none" stroke={metric.color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={points} />
              {values.map((value, index) => {
                const x = rows.length === 1 ? 30 : 30 + (index / Math.max(1, rows.length - 1)) * 690;
                const normalized = metric.normalize(value, values);
                const y = 110 - (Math.max(0, Math.min(100, normalized)) / 100) * 80;
                return (
                  <g key={`${metric.id}-dot-${index}`}>
                    <circle cx={x} cy={y} r="5" fill={metric.color} stroke="#1A1A1A" strokeWidth="2" />
                    <text x={x} y="118" textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">Q{rows[index].question_index}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function DeadlineDependencyChart({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">No deadline dependency data is available.</p>;
  }

  const width = 760;
  const height = 270;
  const padding = 28;
  const groupWidth = (width - padding * 2) / rows.length;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5">
        <LegendSwatch label="Accuracy" color="bg-brand-purple" />
        <LegendSwatch label="Changed Answer" color="bg-brand-yellow" />
      </div>
      <div className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[620px] h-[290px]">
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = height - padding - (tick / 100) * (height - padding * 2);
            return (
              <g key={`deadline-${tick}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.12" strokeWidth="1" />
                <text x="6" y={y + 4} fontSize="11" fontWeight="800" fill="#1A1A1A">{tick}</text>
              </g>
            );
          })}
          {rows.map((row, index) => {
            const baseX = padding + index * groupWidth + groupWidth * 0.18;
            const chartHeight = height - padding * 2;
            const accuracyHeight = (Number(row.accuracy || 0) / 100) * chartHeight;
            const changedHeight = (Number(row.changed_rate || 0) / 100) * chartHeight;
            return (
              <g key={`deadline-group-${row.id}`}>
                <rect x={baseX} y={height - padding - accuracyHeight} width={groupWidth * 0.24} height={accuracyHeight} rx="10" fill="#8B5CF6" stroke="#1A1A1A" strokeWidth="2" />
                <rect x={baseX + groupWidth * 0.3} y={height - padding - changedHeight} width={groupWidth * 0.24} height={changedHeight} rx="10" fill="#F6CD3B" stroke="#1A1A1A" strokeWidth="2" />
                <text x={baseX + groupWidth * 0.2} y={height - 8} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">{row.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mt-5">
        {rows.map((row) => (
          <div key={`deadline-card-${row.id}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{row.label}</p>
            <p className="font-black">{Number(row.accuracy || 0).toFixed(0)}% accurate</p>
            <p className="font-medium text-brand-dark/65">{Number(row.changed_rate || 0).toFixed(0)}% revised · {row.count} rows</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitmentDistributionChart({ rows }: { rows: any[] }) {
  const maxCount = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
  if (!rows.some((row) => Number(row.count || 0) > 0)) {
    return <p className="font-bold text-brand-dark/60">No commitment-latency distribution is available yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const tone = Number(row.accuracy || 0) >= 75 ? 'good' : Number(row.accuracy || 0) >= 55 ? 'mid' : 'bad';
        const barColor = tone === 'good' ? 'bg-emerald-400' : tone === 'mid' ? 'bg-brand-yellow' : 'bg-brand-orange';
        const widthPct = Math.max(0, Math.min(100, (Number(row.count || 0) / maxCount) * 100));

        return (
          <div key={row.id} className="rounded-[1.25rem] border-2 border-brand-dark bg-brand-bg p-4 flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
            <div className="w-full md:w-48 shrink-0 flex items-center justify-between md:flex-col md:items-start">
              <p className="text-sm font-black uppercase tracking-[0.1em] text-brand-purple">{row.label}</p>
              <p className="font-bold text-brand-dark/70 text-sm">{row.count} responses</p>
            </div>
            
            <div className="flex-1 w-full">
              <div className="w-full h-8 sm:h-10 rounded-xl border-2 border-brand-dark bg-white overflow-hidden">
                <div 
                  className={`${barColor} h-full transition-all duration-500`} 
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>

            <div className="w-full md:w-32 shrink-0 flex flex-row items-center justify-between md:flex-col md:items-end gap-2">
              <span className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark font-black text-sm whitespace-nowrap">
                {Number(row.accuracy || 0).toFixed(0)}% Accuracy
              </span>
              <div className="w-24 hidden md:block">
                <Bar value={Number(row.accuracy || 0)} tone={tone} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReengagementOutcomeChart({ rows }: { rows: any[] }) {
  if (!rows.some((row) => Number(row.count || 0) > 0)) {
    return <p className="font-bold text-brand-dark/60">No re-engagement pattern was detected in this session.</p>;
  }

  const maxResponse = Math.max(...rows.map((row) => Number(row.avg_response_ms || 0)), 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {rows.map((row) => (
        <div key={row.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{row.label}</p>
          <p className="text-3xl font-black mb-4">{row.count}</p>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                <span>Accuracy</span>
                <span>{Number(row.accuracy || 0).toFixed(0)}%</span>
              </div>
              <Bar value={Number(row.accuracy || 0)} tone={accuracyTone(Number(row.accuracy || 0))} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                <span>Volatility</span>
                <span>{Number(row.avg_volatility || 0).toFixed(0)} pts</span>
              </div>
              <Bar value={Number(row.avg_volatility || 0)} tone={Number(row.avg_volatility || 0) >= 60 ? 'bad' : Number(row.avg_volatility || 0) >= 35 ? 'mid' : 'good'} />
            </div>
          </div>
          <p className="font-medium text-brand-dark/65 mt-3">
            Avg response {((Number(row.avg_response_ms || 0) / maxResponse) * 100).toFixed(0)}% of the slowest group
            {' · '}
            {formatMs(Number(row.avg_response_ms || 0))}
          </p>
        </div>
      ))}
    </div>
  );
}

function DistractorHeatmapChart({ heatmap }: { heatmap: any }) {
  if (!heatmap?.questions?.length) {
    return <p className="font-bold text-brand-dark/60">No distractor heatmap is available for this session.</p>;
  }

  const columns = `110px repeat(${heatmap.questions.length}, minmax(76px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] space-y-2">
        <div className="grid gap-2" style={{ gridTemplateColumns: columns }}>
          <div />
          {heatmap.questions.map((question: any) => (
            <div key={`heatmap-question-${question.question_id}`} className="rounded-xl border-2 border-brand-dark bg-brand-bg p-2 text-center">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">Q{question.question_index}</p>
              <p className="text-[11px] font-bold text-brand-dark/60 line-clamp-2">{question.question_prompt}</p>
            </div>
          ))}
        </div>
        {heatmap.optionLabels.map((optionLabel: string) => (
          <div key={`heatmap-row-${optionLabel}`} className="grid gap-2" style={{ gridTemplateColumns: columns }}>
            <div className="rounded-xl border-2 border-brand-dark bg-white p-3 flex items-center justify-center">
              <p className="font-black">Option {optionLabel}</p>
            </div>
            {heatmap.questions.map((question: any) => {
              const cell = heatmap.cells.find((entry: any) => entry.questionId === question.question_id && entry.optionLabel === optionLabel);
              const opacity = cell?.isCorrect ? 0.14 : 0.18 + (Number(cell?.rate || 0) / Math.max(1, heatmap.maxRate)) * 0.72;
              const background = cell?.isCorrect
                ? `rgba(139, 92, 246, ${opacity})`
                : cell?.isTopDistractor
                  ? `rgba(255, 90, 54, ${opacity})`
                  : `rgba(246, 205, 59, ${opacity})`;
              return (
                <div
                  key={`heatmap-cell-${question.question_id}-${optionLabel}`}
                  className="rounded-xl border-2 border-brand-dark p-3 min-h-[92px] flex flex-col justify-between"
                  style={{ backgroundColor: background }}
                >
                  <p className="text-[11px] font-black">{cell?.isCorrect ? 'Correct key' : `${Number(cell?.rate || 0).toFixed(0)}%`}</p>
                  <p className="text-[11px] font-medium text-brand-dark/70 line-clamp-3">{cell?.text || 'No option'}</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{cell?.count || 0} students</p>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-5">
        <LegendSwatch label="Top distractor" color="bg-brand-orange" />
        <LegendSwatch label="Secondary distractor" color="bg-brand-yellow" />
        <LegendSwatch label="Correct answer" color="bg-brand-purple" />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/10 rounded-2xl border border-white/15 p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function PackMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{label}</p>
      <p className="text-lg font-black break-words">{value}</p>
    </div>
  );
}

function RiskBadge({ level, compact = false }: { level?: string; compact?: boolean }) {
  const label = level === 'high' ? 'High Risk' : level === 'medium' ? 'Watch' : 'Stable';
  const tone = level === 'high' ? 'bg-brand-orange text-white' : level === 'medium' ? 'bg-brand-yellow text-brand-dark' : 'bg-emerald-300 text-brand-dark';
  return (
    <span className={`${tone} ${compact ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm'} rounded-full border-2 border-brand-dark font-black uppercase tracking-[0.15em]`}>
      {label}
    </span>
  );
}

function SignalPill({
  label,
  value,
  tone = 'neutral',
  metricId,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'mid' | 'bad' | 'low' | 'medium' | 'high' | 'neutral';
  metricId?: string;
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-100'
      : tone === 'mid' || tone === 'medium'
        ? 'bg-brand-yellow/30'
        : tone === 'bad' || tone === 'high'
          ? 'bg-brand-orange/20'
          : tone === 'low'
            ? 'bg-[#dff8e7]'
            : 'bg-white';

  return (
    <div className={`${toneClass} rounded-xl border-2 border-brand-dark p-3`}>
      <div className="flex items-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-1">{label}</p>
        {metricId && <InfoTooltip metricId={metricId} />}
      </div>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function DistributionGroup({ title, items }: { title: string; items: any[] }) {
  if (!items.length) {
    return (
      <div className="mb-6 last:mb-0">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-3">{title}</p>
        <p className="font-bold text-brand-dark/50">No distribution data.</p>
      </div>
    );
  }

  const maxCount = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  return (
    <div className="mb-6 last:mb-0">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-3">{title}</p>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.label}`} className="grid grid-cols-[90px_1fr_40px] items-center gap-3">
            <span className="text-sm font-black capitalize">{item.label}</span>
            <div className="h-4 rounded-full border-2 border-brand-dark bg-brand-bg overflow-hidden">
              <div className="h-full bg-brand-purple" style={{ width: `${(Number(item.count) / maxCount) * 100}%` }} />
            </div>
            <span className="text-sm font-black text-right">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ value, tone }: { value: number; tone: 'good' | 'mid' | 'bad' }) {
  const color = tone === 'good' ? 'bg-emerald-400' : tone === 'mid' ? 'bg-brand-yellow' : 'bg-brand-orange';
  return (
    <div className="h-4 rounded-full border-2 border-brand-dark bg-white overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function LegendSwatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${color}`} />
      <span className="text-sm font-black">{label}</span>
    </div>
  );
}

function LegendRow({ label, tone, body }: { label: string; tone: string; body: string }) {
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${tone}`} />
        <p className="font-black">{label}</p>
      </div>
      <p className="font-medium text-brand-dark/65 text-sm">{body}</p>
    </div>
  );
}
