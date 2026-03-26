import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Copy,
  Download,
  Eye,
  Gauge,
  ListChecks,
  RefreshCw,
  Rocket,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { getGameMode } from '../lib/gameModes.ts';
import { apiFetchJson } from '../lib/api.ts';
import { useTeacherAnalyticsLanguage } from '../lib/teacherAnalyticsLanguage.ts';

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const TEACHER_BOARD_VIEW_KEY = 'quizzi.teacher.analytics.view';

type TeacherBoardViewMode = 'simple' | 'advanced';
type StudentBoardFilter = 'all' | 'attention' | 'high-risk' | 'fatigue' | 'low-accuracy';
type QuestionBoardFilter = 'all' | 'teach-now' | 'low-accuracy' | 'high-stress' | 'distractor';

function readTeacherBoardViewMode(): TeacherBoardViewMode {
  if (typeof window === 'undefined') return 'simple';
  return window.localStorage.getItem(TEACHER_BOARD_VIEW_KEY) === 'advanced' ? 'advanced' : 'simple';
}

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

function generateCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const csv = generateCsv(rows);
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadAllCsvs(baseName: string, files: Array<{ name: string; rows: any[] }>) {
  const zip = new JSZip();
  let hasContent = false;

  files.forEach((file) => {
    if (file.rows && file.rows.length > 0) {
      const csv = generateCsv(file.rows);
      zip.file(file.name, csv);
      hasContent = true;
    }
  });

  if (!hasContent) return;

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}-reports.zip`;
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

function buildSearchHaystack(parts: Array<unknown>) {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part) => part != null && String(part).trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function normalizeTagList(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function questionNeedsImmediateAttention(question: any) {
  return (
    Number(question?.accuracy || 0) < 70 ||
    Number(question?.stress_index || 0) >= 60 ||
    Number(question?.deadline_dependency_rate || 0) >= 25 ||
    Number(question?.top_distractor?.rate || 0) >= 20 ||
    Number(question?.changed_away_from_correct_rate || 0) >= 15
  );
}

function getQuestionPrioritySignal(question: any) {
  if (Number(question?.accuracy || 0) < 55) {
    return { label: 'Reteach now', tone: 'bad' as const };
  }
  if (Number(question?.top_distractor?.rate || 0) >= 20) {
    return {
      label: question?.top_distractor?.label
        ? `Distractor ${question.top_distractor.label} is sticky`
        : 'Distractor cluster',
      tone: 'bad' as const,
    };
  }
  if (Number(question?.stress_index || 0) >= 60 || Number(question?.deadline_dependency_rate || 0) >= 25) {
    return { label: 'Pressure hotspot', tone: 'mid' as const };
  }
  if (Number(question?.changed_away_from_correct_rate || 0) >= 15) {
    return { label: 'Confidence wobble', tone: 'mid' as const };
  }
  return { label: 'Monitor', tone: 'good' as const };
}

function getStudentPrioritySignal(student: any, isInAttentionQueue: boolean) {
  if (isInAttentionQueue) {
    return { label: 'Priority follow-up', tone: 'bad' as const };
  }
  if (String(student?.risk_level || '') === 'high') {
    return { label: 'High risk', tone: 'bad' as const };
  }
  if (student?.fatigue_drift?.direction === 'fatigue') {
    return { label: 'Fatigue drift', tone: 'mid' as const };
  }
  if (Number(student?.accuracy || 0) < 65) {
    return { label: 'Accuracy dip', tone: 'mid' as const };
  }
  return { label: 'Stable', tone: 'good' as const };
}

const METRIC_EXPLANATIONS = {
  en: {
    accuracy: {
      title: 'Accuracy',
      body: 'Percent of correct answers out of all attempts in the class.',
    },
    'first-pass': {
      title: 'First-Pass Accuracy',
      body: 'How often students chose the correct answer on the first attempt.',
    },
    'harmful-revisions': {
      title: 'Harmful Revisions',
      body: 'Times a student changed a correct answer into a wrong one.',
    },
    pressure: {
      title: 'Pressure Load',
      body: 'Share of answers submitted in the last seconds before time ran out.',
    },
    focus: {
      title: 'Focus Drag',
      body: 'How often students left the tab or lost focus during the session.',
    },
    coverage: {
      title: 'Coverage',
      body: 'The share of possible answers that were actually submitted by the class.',
    },
    'decision-quality': {
      title: 'Decision Quality',
      body: 'Whether students arrived at answers from knowledge or unstable guessing.',
    },
    'confidence-stability': {
      title: 'Confidence Stability',
      body: 'How consistently students stayed with their answer choice.',
    },
    'revision-efficiency': {
      title: 'Revision Efficiency',
      body: 'Whether changing an answer helped or hurt the student.',
    },
    'attention-drag': {
      title: 'Attention Drag',
      body: 'A cognitive-load signal built from hesitation, blur, and activity patterns.',
    },
  },
  he: {
    accuracy: {
      title: 'מדד דיוק',
      body: 'אחוז התשובות הנכונות מכלל הניסיונות בכיתה.',
    },
    'first-pass': {
      title: 'דיוק בבחירה ראשונה',
      body: 'אחוז הפעמים שבהן התלמידים בחרו בתשובה הנכונה כבר בניסיון הראשון.',
    },
    'harmful-revisions': {
      title: 'שינויים מזיקים',
      body: 'מספר הפעמים שתלמיד שינה תשובה נכונה לתשובה שגויה.',
    },
    pressure: {
      title: 'עומס ולחץ',
      body: 'אחוז התשובות שניתנו בשניות האחרונות לפני תום הזמן.',
    },
    focus: {
      title: 'איבוד ריכוז',
      body: 'מספר הפעמים שתלמידים יצאו מהטאב או איבדו פוקוס במהלך המשחק.',
    },
    coverage: {
      title: 'מדד השתתפות',
      body: 'היחס בין מספר התשובות שניתנו לבין המקסימום האפשרי.',
    },
    'decision-quality': {
      title: 'איכות החלטה',
      body: 'האם התלמידים הגיעו לתשובה מתוך ידע מבוסס או מתוך ניחוש לא יציב.',
    },
    'confidence-stability': {
      title: 'יציבות הביטחון',
      body: 'עד כמה התלמידים דבקו בבחירה שלהם לאורך התהליך.',
    },
    'revision-efficiency': {
      title: 'יעילות תיקון',
      body: 'האם שינוי התשובה עזר לתלמיד או הזיק לו.',
    },
    'attention-drag': {
      title: 'גרירת קשב',
      body: 'אות לעומס קוגניטיבי המבוסס על היסוס, יציאה מפוקוס ודפוסי פעילות.',
    },
  },
} as const;

function InfoTooltip({ metricId }: { metricId: string }) {
  const { language } = useTeacherAnalyticsLanguage();
  const explanationSet = METRIC_EXPLANATIONS[language as keyof typeof METRIC_EXPLANATIONS] || METRIC_EXPLANATIONS.en;
  const explanation = explanationSet[metricId as keyof typeof METRIC_EXPLANATIONS.en];
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
  const { direction, isRtl, t } = useTeacherAnalyticsLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);
  const [isHeaderPinnedOpen, setIsHeaderPinnedOpen] = useState(false);
  const [viewMode, setViewMode] = useState<TeacherBoardViewMode>(() => readTeacherBoardViewMode());
  const [pendingAdvancedTarget, setPendingAdvancedTarget] = useState<string | null>(null);
  const [followUpBusyPlanId, setFollowUpBusyPlanId] = useState<string | null>(null);
  const [followUpNotice, setFollowUpNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [recoveryBuilderBusyKey, setRecoveryBuilderBusyKey] = useState<string | null>(null);
  const [memoryAutopilotBusy, setMemoryAutopilotBusy] = useState(false);
  const [recoveryBuilderSummary, setRecoveryBuilderSummary] = useState<null | {
    targetLabel: string;
    createdCount: number;
    reusedCount: number;
    failedCount: number;
    createdPacks: any[];
  }>(null);
  const [copiedOfficeHoursKey, setCopiedOfficeHoursKey] = useState('');
  const [copiedReplayTimeline, setCopiedReplayTimeline] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<StudentBoardFilter>('all');
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionFilter, setQuestionFilter] = useState<QuestionBoardFilter>('teach-now');

  const loadAnalytics = async () => {
    if (!sessionId) return;
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}`);
      setData(payload);
      const defaultStudentId =
        Number(payload?.studentSpotlight?.attention_needed?.[0]?.id ?? payload?.participants?.[0]?.id ?? 0) || null;
      setSelectedStudentId((current) => current ?? defaultStudentId);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TEACHER_BOARD_VIEW_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !pendingAdvancedTarget || viewMode !== 'advanced') return;

    let timeoutId = 0;
    let attempts = 0;
    const tryScroll = () => {
      if (scrollToBoardSection(pendingAdvancedTarget)) {
        setPendingAdvancedTarget(null);
        return;
      }

      if (attempts >= 10) {
        setPendingAdvancedTarget(null);
        return;
      }

      attempts += 1;
      timeoutId = window.setTimeout(tryScroll, 120);
    };

    const frameId = window.requestAnimationFrame(() => {
      tryScroll();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [pendingAdvancedTarget, viewMode]);

  useEffect(() => {
    if (!followUpNotice) return;
    const timeout = window.setTimeout(() => setFollowUpNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [followUpNotice]);

  useEffect(() => {
    if (!copiedOfficeHoursKey) return;
    const timeout = window.setTimeout(() => setCopiedOfficeHoursKey(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [copiedOfficeHoursKey]);

  useEffect(() => {
    if (!copiedReplayTimeline) return;
    const timeout = window.setTimeout(() => setCopiedReplayTimeline(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copiedReplayTimeline]);

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
  const followUpEngine = data?.follow_up_engine || null;
  const memoryBoard = data?.memory_board || null;
  const memoryAlerts = Array.isArray(memoryBoard?.alerts) ? memoryBoard.alerts : [];
  const memoryGroups = Array.isArray(memoryBoard?.groups) ? memoryBoard.groups : [];
  const memoryWatchlist = Array.isArray(memoryBoard?.watchlist) ? memoryBoard.watchlist : [];
  const memoryAutopilotQueue = Array.isArray(memoryBoard?.autopilot_queue) ? memoryBoard.autopilot_queue : [];
  const crossSectionComparison = data?.cross_section_comparison || null;
  const sortedAlerts = useMemo(
    () => [...alertList, ...memoryAlerts].sort((left: any, right: any) => severityRank(right.severity) - severityRank(left.severity)),
    [alertList, memoryAlerts],
  );
  const leadAlert = sortedAlerts[0] || null;
  const leadQuestion = questionDiagnostics[0] || null;
  const leadMisconception = recurrentMisconceptions[0] || null;
  const summaryTrust = data?.summary || {};
  const summaryObservedFacts = summaryTrust?.observed_facts || null;
  const summaryInterpretation = summaryTrust?.derived_interpretation || null;
  const summaryTeacherAction = summaryTrust?.teacher_action || null;
  const summaryRawFacts = Array.isArray(summaryTrust?.raw_facts) ? summaryTrust.raw_facts.slice(0, 4) : [];
  const summaryGradingMetrics = Array.isArray(summaryTrust?.grading_safe_metrics)
    ? summaryTrust.grading_safe_metrics.slice(0, 4)
    : [];
  const summaryBehaviorMetrics = Array.isArray(summaryTrust?.behavior_signal_metrics)
    ? summaryTrust.behavior_signal_metrics.slice(0, 4)
    : [];
  const attentionQueue = data?.studentSpotlight?.attention_needed || [];
  const topAttentionStudents = attentionQueue.slice(0, 3);
  const attentionOrder = useMemo(
    () =>
      new Map<number, number>(
        attentionQueue.map((student: any, index: number) => [Number(student.id), index] as const),
      ),
    [attentionQueue],
  );
  const highRiskFatigueCount = participants.filter(
    (student: any) => student.risk_level === 'high' && student.fatigue_drift?.direction === 'fatigue',
  ).length;
  const fatigueAffectedCount = participants.filter((student: any) => student.fatigue_drift?.direction === 'fatigue').length;
  const firstChoiceRate = Number(revisionIntelligence?.first_choice_correct_rate || data?.summary?.first_choice_accuracy || 0);
  const helpfulRevisionRate = Number(revisionIntelligence?.corrected_after_wrong_rate || 0);
  const harmfulRevisionRate = Number(revisionIntelligence?.changed_away_from_correct_rate || 0);
  const lockedWrongRate = Number(revisionIntelligence?.stayed_wrong_rate || 0);
  const pressureRate = Number(deadlineDependency?.pressure_rate || 0);
  const leadQuestionTags = useMemo(
    () =>
      new Set(
        [leadMisconception?.tag, ...(Array.isArray(leadQuestion?.tags) ? leadQuestion.tags : [])]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase()),
      ),
    [leadMisconception?.tag, leadQuestion?.tags],
  );
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

  const showAdvancedPanels = viewMode === 'advanced';

  const scrollToBoardSection = (sectionId: string) => {
    if (typeof document === 'undefined') return false;
    const section = document.getElementById(sectionId);
    if (!section) return false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  };

  const openAdvancedView = (targetSectionId = 'teacher-board-advanced') => {
    if (showAdvancedPanels) {
      scrollToBoardSection(targetSectionId);
      return;
    }
    setPendingAdvancedTarget(targetSectionId);
    setViewMode('advanced');
  };

  const guidedWorkflowCards = useMemo(
    () => [
      {
        id: 'class-decision',
        step: 'Step 1',
        label: 'Class Decision',
        title: executiveSummary.actionTitle,
        body: executiveSummary.actionBody,
        tone: 'bg-brand-purple text-white',
        actionLabel: 'Open the misconception block',
        action: () => scrollToBoardSection('teacher-board-teach'),
      },
      {
        id: 'student-follow-up',
        step: 'Step 2',
        label: 'Student Follow-Up',
        title: topAttentionStudents[0]?.nickname || 'No student needs immediate follow-up',
        body: topAttentionStudents[0]?.recommendation || 'The page is already simplified for a fast teaching read.',
        tone: 'bg-brand-yellow text-brand-dark',
        actionLabel: topAttentionStudents[0] ? 'Open individual dashboard' : 'Student Command Center',
        action: () =>
          topAttentionStudents[0]
            ? openStudentDashboard(topAttentionStudents[0].id)
            : scrollToBoardSection('teacher-board-students-list'),
      },
      {
        id: 'question-focus',
        step: 'Step 3',
        label: 'Question Focus',
        title: leadQuestion ? `Question ${leadQuestion.question_index}` : 'Question Diagnostics',
        body: leadQuestion?.recommendation || 'No question hotspot has separated from the rest yet.',
        tone: 'bg-white text-brand-dark',
        actionLabel: 'Jump to question diagnostics',
        action: () => scrollToBoardSection('teacher-board-questions'),
      },
    ],
    [executiveSummary, leadQuestion, topAttentionStudents],
  );

  const quickNavigationCards = useMemo(
    () => [
      {
        id: 'overview',
        label: 'Overview',
        body: executiveSummary.classStateTitle,
        action: () => scrollToBoardSection('teacher-board-overview'),
      },
      {
        id: 'follow-up',
        label: 'Follow-Up',
        body: followUpEngine?.plans?.[0]?.title || 'Build the next round from this session',
        action: () => scrollToBoardSection('teacher-board-follow-up'),
      },
      {
        id: 'students',
        label: 'Students',
        body: topAttentionStudents.length > 0 ? `${topAttentionStudents.length} students` : 'No student queue has been produced yet.',
        action: () => scrollToBoardSection('teacher-board-students'),
      },
      {
        id: 'memory',
        label: 'Memory',
        body: memoryAlerts[0]?.title || 'Student memory groups and alerts',
        action: () => scrollToBoardSection('teacher-board-memory'),
      },
      {
        id: 'questions',
        label: 'Questions',
        body: leadQuestion ? `Question ${leadQuestion.question_index}` : 'Question Diagnostics',
        action: () => scrollToBoardSection('teacher-board-questions'),
      },
      {
        id: 'advanced',
        label: showAdvancedPanels ? 'Advanced View' : 'Advanced',
        body: showAdvancedPanels
          ? 'Advanced view opens the full research layer, detailed distributions, and export-oriented analytics.'
          : 'Advanced analysis is currently hidden',
        action: () => {
          if (showAdvancedPanels) {
            scrollToBoardSection('teacher-board-advanced');
            return;
          }
          openAdvancedView();
        },
      },
    ],
    [executiveSummary.classStateTitle, followUpEngine?.plans, leadQuestion, memoryAlerts, showAdvancedPanels, topAttentionStudents.length],
  );

  const prioritizedParticipants = useMemo(() => {
    return [...participants].sort((left: any, right: any) => {
      const leftAttentionIndex = attentionOrder.get(Number(left.id));
      const rightAttentionIndex = attentionOrder.get(Number(right.id));

      if (leftAttentionIndex != null || rightAttentionIndex != null) {
        if (leftAttentionIndex == null) return 1;
        if (rightAttentionIndex == null) return -1;
        if (leftAttentionIndex !== rightAttentionIndex) {
          return Number(leftAttentionIndex) - Number(rightAttentionIndex);
        }
      }

      const riskDelta = severityRank(right.risk_level) - severityRank(left.risk_level);
      if (riskDelta !== 0) return riskDelta;

      const accuracyDelta = Number(left.accuracy || 0) - Number(right.accuracy || 0);
      if (accuracyDelta !== 0) return accuracyDelta;

      const rankDelta = Number(left.rank || Number.MAX_SAFE_INTEGER) - Number(right.rank || Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) return rankDelta;

      return String(left.nickname || '').localeCompare(String(right.nickname || ''));
    });
  }, [attentionOrder, participants]);

  const filteredParticipants = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return prioritizedParticipants.filter((student: any) => {
      const matchesFilter =
        studentFilter === 'all'
          ? true
          : studentFilter === 'attention'
            ? attentionOrder.has(Number(student.id))
            : studentFilter === 'high-risk'
              ? String(student.risk_level || '') === 'high'
              : studentFilter === 'fatigue'
                ? student?.fatigue_drift?.direction === 'fatigue'
                : Number(student.accuracy || 0) < 65;

      if (!matchesFilter) return false;
      if (!query) return true;

      return buildSearchHaystack([
        student.nickname,
        student.decision_style,
        student.recommendation,
        student.weak_tags,
        student.strong_tags,
        student.flags,
      ]).includes(query);
    });
  }, [attentionOrder, prioritizedParticipants, studentFilter, studentSearch]);

  const filteredQuestionDiagnostics = useMemo(() => {
    const query = questionSearch.trim().toLowerCase();
    return questionDiagnostics.filter((question: any) => {
      const matchesFilter =
        questionFilter === 'all'
          ? true
          : questionFilter === 'teach-now'
            ? questionNeedsImmediateAttention(question)
            : questionFilter === 'low-accuracy'
              ? Number(question.accuracy || 0) < 70
              : questionFilter === 'high-stress'
                ? Number(question.stress_index || 0) >= 60 || Number(question.deadline_dependency_rate || 0) >= 25
                : Boolean(question.top_distractor) && Number(question.top_distractor?.rate || 0) >= 15;

      if (!matchesFilter) return false;
      if (!query) return true;

      return buildSearchHaystack([
        question.question_index,
        `question ${question.question_index}`,
        question.question_prompt,
        question.tags,
        question.learning_objective,
        question.bloom_level,
        question.top_distractor?.text,
        question.top_distractor?.label,
        question.recommendation,
      ]).includes(query);
    });
  }, [questionDiagnostics, questionFilter, questionSearch]);

  const openStudentDashboard = (studentId: number | string) => {
    if (!sessionId) return;
    navigate(`/teacher/analytics/class/${sessionId}/student/${studentId}`);
  };

  const focusStudentCommandCenter = (filter: StudentBoardFilter = 'all', search = '') => {
    setStudentFilter(filter);
    setStudentSearch(search);
    scrollToBoardSection('teacher-board-students-list');
  };

  const focusQuestionBoard = (filter: QuestionBoardFilter = 'teach-now', search = '') => {
    setQuestionFilter(filter);
    setQuestionSearch(search);
    scrollToBoardSection('teacher-board-questions');
  };

  const handleFollowUpAction = async (planId: string, launchNow: boolean) => {
    if (!sessionId) return;

    try {
      setFollowUpBusyPlanId(`${planId}:${launchNow ? 'host' : 'pack'}`);
      setFollowUpNotice(null);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/follow-up-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          launch_now: launchNow,
        }),
      });

      if (launchNow && payload?.pin) {
        navigate(`/teacher/session/${payload.pin}/host`);
        return;
      }

      setFollowUpNotice({ tone: 'success', message: 'Follow-up pack created.' });
    } catch (actionError: any) {
      setFollowUpNotice({ tone: 'error', message: actionError?.message || 'Failed to create follow-up pack.' });
    } finally {
      setFollowUpBusyPlanId(null);
    }
  };

  const handleCopyOfficeHours = async (copyKey: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOfficeHoursKey(copyKey);
    } catch (copyError: any) {
      setFollowUpNotice({ tone: 'error', message: copyError?.message || 'Failed to copy outreach text.' });
    }
  };

  const handleCopyReplayTimeline = async () => {
    try {
      await navigator.clipboard.writeText(replayTimelineText);
      setCopiedReplayTimeline(true);
    } catch (copyError: any) {
      setFollowUpNotice({ tone: 'error', message: copyError?.message || 'Failed to copy replay timeline.' });
    }
  };

  const handleBuildRecoveryGames = async (target: { id: string; label: string; participantIds: number[] }) => {
    if (!sessionId || target.participantIds.length === 0) return;

    try {
      setRecoveryBuilderBusyKey(target.id);
      setRecoveryBuilderSummary(null);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/personalized-games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: 5,
          participant_ids: target.participantIds,
        }),
      });

      setRecoveryBuilderSummary({
        targetLabel: target.label,
        createdCount: Number(payload?.created_count || 0),
        reusedCount: Number(payload?.reused_count || 0),
        failedCount: Number(payload?.failed_count || 0),
        createdPacks: Array.isArray(payload?.created_packs) ? payload.created_packs : [],
      });
      setFollowUpNotice({
        tone: 'success',
        message: `${target.label}: ${Number(payload?.created_count || 0)} created, ${Number(payload?.reused_count || 0)} reused.`,
      });
    } catch (buildError: any) {
      setFollowUpNotice({ tone: 'error', message: buildError?.message || 'Failed to build targeted recovery games.' });
    } finally {
      setRecoveryBuilderBusyKey(null);
    }
  };

  const handleRunMemoryAutopilot = async (participantIds?: number[]) => {
    if (!sessionId) return;

    try {
      setMemoryAutopilotBusy(true);
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/memory-autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_ids: Array.isArray(participantIds) && participantIds.length > 0 ? participantIds : undefined,
        }),
      });
      setRecoveryBuilderSummary({
        targetLabel: participantIds?.length ? 'Memory autopilot selection' : 'Memory autopilot watchlist',
        createdCount: Number(payload?.created_count || 0),
        reusedCount: Number(payload?.reused_count || 0),
        failedCount: Number(payload?.failed_count || 0),
        createdPacks: Array.isArray(payload?.created_packs) ? payload.created_packs : [],
      });
      setFollowUpNotice({
        tone: 'success',
        message: `Memory autopilot created ${Number(payload?.created_count || 0)} packs and reused ${Number(payload?.reused_count || 0)}.`,
      });
    } catch (autopilotError: any) {
      setFollowUpNotice({ tone: 'error', message: autopilotError?.message || 'Failed to run memory autopilot.' });
    } finally {
      setMemoryAutopilotBusy(false);
    }
  };

  const teacherActionQueue = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      title: string;
      body: string;
      metricLabel: string;
      metricValue: string;
      tone: 'bad' | 'mid' | 'good';
      actionLabel: string;
      action:
        | { type: 'scroll'; target: string }
        | { type: 'student'; studentId: number | string }
        | { type: 'follow-up'; planId: string }
        | { type: 'memory-autopilot'; participantIds?: number[] };
    }> = [];

    if (leadQuestion) {
      items.push({
        id: 'lead-question',
        label: 'Teach next',
        title: `Question ${leadQuestion.question_index} needs a reset`,
        body:
          leadQuestion.recommendation ||
          `${Number(leadQuestion.accuracy || 0).toFixed(0)}% accuracy with visible confusion on this item.`,
        metricLabel: 'Accuracy',
        metricValue: `${Number(leadQuestion.accuracy || 0).toFixed(0)}%`,
        tone: Number(leadQuestion.accuracy || 0) < 60 ? 'bad' : 'mid',
        actionLabel: 'Open question triage',
        action: { type: 'scroll', target: 'teacher-board-questions' },
      });
    }

    if (topAttentionStudents[0]) {
      items.push({
        id: 'priority-student',
        label: 'Student support',
        title: `${topAttentionStudents[0].nickname} needs follow-up`,
        body:
          topAttentionStudents[0].recommendation ||
          'Open the individual dashboard to build a same-material recovery plan.',
        metricLabel: 'Risk',
        metricValue: String(topAttentionStudents[0].risk_level || 'medium'),
        tone: String(topAttentionStudents[0].risk_level || '') === 'high' ? 'bad' : 'mid',
        actionLabel: 'Open student dashboard',
        action: { type: 'student', studentId: topAttentionStudents[0].id },
      });
    }

    if (memoryAlerts[0]) {
      items.push({
        id: 'memory-alert',
        label: 'Memory alert',
        title: memoryAlerts[0].title,
        body: memoryAlerts[0].body,
        metricLabel: 'Students',
        metricValue: `${Number(memoryAlerts[0].count || 0)}`,
        tone: String(memoryAlerts[0].severity || '') === 'high' ? 'bad' : 'mid',
        actionLabel: memoryWatchlist.length > 0 ? 'Run autopilot' : 'Open cohorts',
        action: memoryWatchlist.length > 0
          ? { type: 'memory-autopilot', participantIds: memoryWatchlist.slice(0, 3).map((student: any) => Number(student.id)) }
          : { type: 'scroll', target: 'teacher-board-memory' },
      });
    }

    if (leadMisconception && leadQuestion) {
      items.push({
        id: 'misconception-cluster',
        label: 'Misconception',
        title: `${humanizeTag(leadMisconception.tag)} is spreading`,
        body: `${leadMisconception.student_count} students converged on distractor ${leadMisconception.choice_label} in question ${leadQuestion.question_index}.`,
        metricLabel: 'Students',
        metricValue: `${Number(leadMisconception.student_count || 0)}`,
        tone: Number(leadMisconception.student_count || 0) >= Math.max(4, Math.round(participants.length * 0.3)) ? 'bad' : 'mid',
        actionLabel: 'Open misconception block',
        action: { type: 'scroll', target: 'teacher-board-teach' },
      });
    }

    if (followUpEngine?.plans?.[0]) {
      items.push({
        id: 'follow-up-plan',
        label: 'Next lesson',
        title: followUpEngine.plans[0].title,
        body: followUpEngine.plans[0].body || 'Create the next same-material round directly from this board.',
        metricLabel: 'Questions',
        metricValue: `${Number(followUpEngine.plans[0].question_count || 0)}`,
        tone: 'good',
        actionLabel: 'Create follow-up pack',
        action: { type: 'follow-up', planId: followUpEngine.plans[0].id },
      });
    }

    if (!items.length) {
      items.push({
        id: 'overview-fallback',
        label: 'Overview',
        title: 'The class is currently stable',
        body: 'Use the overview and student board to spot smaller patterns before the next live run.',
        metricLabel: 'Students',
        metricValue: `${participants.length}`,
        tone: 'good',
        actionLabel: 'Jump to overview',
        action: { type: 'scroll', target: 'teacher-board-overview' },
      });
    }

    return items.slice(0, 4);
  }, [followUpEngine?.plans, leadMisconception, leadQuestion, memoryAlerts, memoryWatchlist, participants.length, topAttentionStudents]);

  useEffect(() => {
    if (!filteredParticipants.length) return;
    if (filteredParticipants.some((student: any) => Number(student.id) === Number(selectedStudentId))) return;
    setSelectedStudentId(Number(filteredParticipants[0].id));
  }, [filteredParticipants, selectedStudentId]);

  const interventionCohorts = useMemo(() => {
    const sharedLeadTag = leadMisconception?.tag ? String(leadMisconception.tag).toLowerCase() : '';
    const cohorts = [
      {
        id: 'reteach-clinic',
        label: 'Reteach Clinic',
        title: leadQuestion ? `Students who missed question ${leadQuestion.question_index}` : 'Students who need a same-concept reset',
        body: leadMisconception
          ? `Built around ${humanizeTag(leadMisconception.tag)} and the distractor pattern that spread across the room.`
          : 'Use this group for a short same-material reteach before the next live round.',
        tone: 'bad' as const,
        actionLabel: 'Open matching students',
        actionFilter: 'low-accuracy' as StudentBoardFilter,
        searchTerm: sharedLeadTag,
        students: prioritizedParticipants.filter((student: any) => {
          const weakTags = Array.isArray(student?.weak_tags) ? student.weak_tags.map((tag: string) => String(tag).toLowerCase()) : [];
          return (
            Number(student.accuracy || 0) < 70 ||
            weakTags.some((tag: string) => leadQuestionTags.has(tag)) ||
            (sharedLeadTag ? weakTags.includes(sharedLeadTag) : false)
          );
        }),
      },
      {
        id: 'confidence-rescue',
        label: 'Confidence Rescue',
        title: 'Students who knew it, then lost it',
        body: 'These learners are close to mastery but unstable under pressure. They need a calmer re-check, not a brand-new lesson.',
        tone: 'mid' as const,
        actionLabel: 'Open confidence wobble group',
        actionFilter: 'attention' as StudentBoardFilter,
        searchTerm: '',
        students: prioritizedParticipants.filter((student: any) =>
          Number(student.changed_away_from_correct || 0) > 0 ||
          (Number(student.first_choice_accuracy || 0) >= 45 && Number(student.stability_score || 0) < 60),
        ),
      },
      {
        id: 'fatigue-reset',
        label: 'Fatigue Reset',
        title: 'Students fading late in the run',
        body: 'Use a slower pacing move, shorter bursts, or one extra scaffold before the next live block.',
        tone: 'mid' as const,
        actionLabel: 'Open fatigue group',
        actionFilter: 'fatigue' as StudentBoardFilter,
        searchTerm: '',
        students: prioritizedParticipants.filter((student: any) =>
          student?.fatigue_drift?.direction === 'fatigue' ||
          Number(student.total_focus_loss || 0) >= 2 ||
          (Number(student.stress_index || 0) >= 70 && Number(student.accuracy || 0) < 75),
        ),
      },
      {
        id: 'peer-leads',
        label: 'Peer Leads',
        title: 'Stable students who can anchor the room',
        body: 'These students can model reasoning, lead a pair check, or stabilize table talk during the next round.',
        tone: 'good' as const,
        actionLabel: 'See likely peer leads',
        actionFilter: 'all' as StudentBoardFilter,
        searchTerm: '',
        students: prioritizedParticipants.filter((student: any) =>
          String(student.risk_level || '') === 'low' &&
          Number(student.accuracy || 0) >= 85 &&
          Number(student.confidence_score || 0) >= 60,
        ),
      },
    ]
      .map((cohort) => ({
        ...cohort,
        count: cohort.students.length,
        names: cohort.students.slice(0, 4).map((student: any) => student.nickname),
        focusTags: Array.from(
          new Set(
            cohort.students
              .flatMap((student: any) => (Array.isArray(student?.weak_tags) ? student.weak_tags : []))
              .filter(Boolean)
              .slice(0, 4),
          ),
        ),
      }))
      .filter((cohort) => cohort.count > 0)
      .sort((left, right) => right.count - left.count);

    const memoryCohorts = memoryGroups.map((group: any) => ({
      id: `memory-${group.id}`,
      label: group.label,
      title: `${group.label} from student memory`,
      body: group.body,
      tone: group.id === 'memory-confidence-reset' ? ('bad' as const) : group.id === 'memory-momentum' ? ('good' as const) : ('mid' as const),
      actionLabel: 'Open matching students',
      actionFilter:
        group.id === 'memory-confidence-reset'
          ? ('attention' as StudentBoardFilter)
          : group.id === 'memory-momentum'
            ? ('all' as StudentBoardFilter)
            : ('low-accuracy' as StudentBoardFilter),
      searchTerm: Array.isArray(group.focus_tags) && group.focus_tags[0] ? String(group.focus_tags[0]) : '',
      count: Number(group.count || 0),
      names: Array.isArray(group.students) ? group.students.slice(0, 4) : [],
      focusTags: Array.isArray(group.focus_tags) ? group.focus_tags.slice(0, 4) : [],
    }));

    return [...memoryCohorts, ...cohorts].slice(0, 4);
  }, [leadMisconception, leadQuestion, leadQuestionTags, memoryGroups, prioritizedParticipants]);

  const peerTutorMatches = useMemo(() => {
    const tutors = prioritizedParticipants
      .filter((student: any) =>
        Number(student.id || 0) > 0 &&
        String(student.risk_level || '') === 'low' &&
        Number(student.accuracy || 0) >= 82 &&
        Number(student.confidence_score || 0) >= 55,
      )
      .map((student: any) => ({
        ...student,
        supportTags: normalizeTagList([student.strong_tags, student.weak_tags]).map((tag) => tag.toLowerCase()),
      }));

    const learners = prioritizedParticipants
      .filter((student: any) =>
        Number(student.id || 0) > 0 &&
        (attentionOrder.has(Number(student.id)) ||
          String(student.risk_level || '') === 'high' ||
          Number(student.accuracy || 0) < 70 ||
          student?.fatigue_drift?.direction === 'fatigue'),
      )
      .map((student: any) => ({
        ...student,
        needTags: normalizeTagList([student.weak_tags, Array.from(leadQuestionTags)]).map((tag) => tag.toLowerCase()),
      }));

    const usedTutorIds = new Set<number>();
    const matches = learners
      .map((learner: any) => {
        const bestTutor = tutors
          .filter((tutor: any) => Number(tutor.id) !== Number(learner.id) && !usedTutorIds.has(Number(tutor.id)))
          .map((tutor: any) => {
            const overlap = tutor.supportTags.filter((tag: string) => learner.needTags.includes(tag));
            const score =
              overlap.length * 12
              + Number(tutor.accuracy || 0) * 0.4
              + Number(tutor.confidence_score || 0) * 0.3
              + Number(tutor.stability_score || 0) * 0.2;
            return { tutor, overlap, score };
          })
          .sort((left, right) => right.score - left.score)[0];

        if (!bestTutor || bestTutor.score <= 0 || bestTutor.overlap.length === 0) {
          return null;
        }

        usedTutorIds.add(Number(bestTutor.tutor.id));
        return {
          id: `peer-match-${learner.id}-${bestTutor.tutor.id}`,
          tutor: bestTutor.tutor,
          learner,
          overlap: bestTutor.overlap.slice(0, 3),
        };
      })
      .filter(Boolean) as Array<{ id: string; tutor: any; learner: any; overlap: string[] }>;

    return matches.slice(0, 4);
  }, [attentionOrder, leadQuestionTags, prioritizedParticipants]);

  const pivotMoments = useMemo(() => {
    const moments = fatigueTimeline
      .map((row, index, rows) => {
        if (index === 0) return null;
        const previous = rows[index - 1];
        const accuracyDrop = Number(previous.rolling_accuracy || previous.accuracy || 0) - Number(row.rolling_accuracy || row.accuracy || 0);
        const pressureSpike = Number(row.deadline_dependency_rate || 0) - Number(previous.deadline_dependency_rate || 0);
        const responseSpike = Number(row.rolling_response_ms || row.avg_response_ms || 0) - Number(previous.rolling_response_ms || previous.avg_response_ms || 0);
        const volatilitySpike = Number(row.rolling_volatility || row.avg_volatility || 0) - Number(previous.rolling_volatility || previous.avg_volatility || 0);
        const question = questionDiagnostics.find(
          (questionRow: any) => Number(questionRow.question_index || 0) === Number(row.question_index || 0),
        );
        const score =
          Math.max(0, accuracyDrop) * 1.7 +
          Math.max(0, pressureSpike) * 0.9 +
          Math.max(0, responseSpike) / 350 +
          Math.max(0, volatilitySpike) * 18;

        if (score < 8) return null;

        let title = `Question ${row.question_index} changed the room`;
        let body = question?.recommendation || 'This is the point where the class pattern stopped looking stable.';
        let metricLabel = 'Accuracy drop';
        let metricValue = `${Math.max(0, accuracyDrop).toFixed(0)} pts`;
        let tone: 'bad' | 'mid' = 'mid';

        if (accuracyDrop >= 8) {
          title = `Accuracy broke at question ${row.question_index}`;
          body = question?.recommendation || `Rolling accuracy fell by ${accuracyDrop.toFixed(0)} points compared with the previous step.`;
          metricLabel = 'Accuracy drop';
          metricValue = `${accuracyDrop.toFixed(0)} pts`;
          tone = accuracyDrop >= 14 ? 'bad' : 'mid';
        } else if (pressureSpike >= 10) {
          title = `Pressure spiked at question ${row.question_index}`;
          body = question?.recommendation || `More students waited until the deadline on this item than on the previous question.`;
          metricLabel = 'Pressure spike';
          metricValue = `${pressureSpike.toFixed(0)} pts`;
          tone = pressureSpike >= 18 ? 'bad' : 'mid';
        } else if (responseSpike >= 1200) {
          title = `Decision time stretched at question ${row.question_index}`;
          body = question?.recommendation || 'Students slowed down noticeably here, which usually signals uncertainty rather than productive struggle.';
          metricLabel = 'Response shift';
          metricValue = `+${formatMs(responseSpike)}`;
          tone = responseSpike >= 2200 ? 'bad' : 'mid';
        } else if (volatilitySpike >= 0.2) {
          title = `Choice stability slipped at question ${row.question_index}`;
          body = question?.recommendation || 'Answer movement widened here, suggesting wobble rather than confident revision.';
          metricLabel = 'Volatility';
          metricValue = `+${volatilitySpike.toFixed(2)}`;
          tone = 'mid';
        }

        return {
          id: `pivot-${row.question_index}`,
          questionIndex: Number(row.question_index || 0),
          title,
          body,
          metricLabel,
          metricValue,
          tone,
          searchTerm: String(row.question_index || ''),
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      questionIndex: number;
      title: string;
      body: string;
      metricLabel: string;
      metricValue: string;
      tone: 'bad' | 'mid';
      searchTerm: string;
    }>;

    return moments.sort((left, right) => right.questionIndex - left.questionIndex).slice(0, 3);
  }, [fatigueTimeline, questionDiagnostics]);

  const sessionReplayTimeline = useMemo(() => {
    return questionDiagnostics
      .map((question: any) => {
        const timelineRow = fatigueTimeline.find((row) => Number(row.question_index || 0) === Number(question.question_index || 0));
        const matchingPivot = pivotMoments.find((moment) => Number(moment.questionIndex || 0) === Number(question.question_index || 0));
        const accuracy = Number(question?.accuracy || 0);
        const stress = Number(question?.stress_index || 0);
        const responseMs = Number(timelineRow?.avg_response_ms || question?.avg_response_ms || 0);
        const distractorRate = Number(question?.top_distractor?.rate || 0);

        let signal = 'Stable checkpoint';
        let tone: 'good' | 'mid' | 'bad' = 'good';
        let move = 'Keep the pace and use this question as an anchor for what the class currently understands.';

        if (matchingPivot) {
          signal = matchingPivot.title;
          tone = matchingPivot.tone === 'bad' ? 'bad' : 'mid';
          move = matchingPivot.body;
        } else if (accuracy < 60) {
          signal = 'Reteach trigger';
          tone = 'bad';
          move = question?.recommendation || 'Re-open the core distinction before asking the class to move on.';
        } else if (distractorRate >= 18 || stress >= 60) {
          signal = 'Confusion or pressure spike';
          tone = 'mid';
          move = question?.recommendation || 'Contrast the sticky distractor with the correct idea and give the room one calmer re-check.';
        }

        return {
          id: `timeline-${question.question_index}`,
          questionIndex: Number(question.question_index || 0),
          prompt: String(question.question_prompt || ''),
          signal,
          tone,
          move,
          accuracy,
          stress,
          responseMs,
          distractorLabel: question?.top_distractor?.label || null,
          distractorRate,
        };
      })
      .sort((left, right) => left.questionIndex - right.questionIndex);
  }, [fatigueTimeline, pivotMoments, questionDiagnostics]);

  const replayTimelineText = useMemo(() => {
    return [
      `Session Replay Timeline: ${data?.session?.pack_title || `Session #${sessionId}`}`,
      '',
      ...sessionReplayTimeline.map((row) => {
        const segments = [
          `Q${row.questionIndex}`,
          row.signal,
          `${row.accuracy.toFixed(0)}% accuracy`,
          `${row.stress.toFixed(0)}% stress`,
          formatMs(row.responseMs),
        ];
        if (row.distractorLabel) {
          segments.push(`distractor ${row.distractorLabel} at ${row.distractorRate.toFixed(0)}%`);
        }
        return `${segments.join(' • ')}\nNext move: ${row.move}`;
      }),
    ].join('\n\n');
  }, [data?.session?.pack_title, sessionId, sessionReplayTimeline]);

  const officeHoursQueue = useMemo(() => {
    return prioritizedParticipants
      .filter((student: any) =>
        attentionOrder.has(Number(student.id))
        || String(student.risk_level || '') === 'high'
        || Number(student.accuracy || 0) < 70
        || student?.fatigue_drift?.direction === 'fatigue',
      )
      .slice(0, 6)
      .map((student: any, index: number) => {
        const focusTags = normalizeTagList([student.weak_tags]).slice(0, 3);
        const reason =
          student.recommendation
          || (student?.fatigue_drift?.direction === 'fatigue'
            ? 'this student faded late in the session and needs a lower-friction reset'
            : String(student.risk_level || '') === 'high'
              ? 'this student shows high-risk signals and should hear from the teacher before the next checkpoint'
              : 'this student needs a short same-material follow-up while the misconception is still fresh');
        const invite = [
          `Hi ${student.nickname},`,
          '',
          `I want to pull you into a short Quizzi support check because ${reason}.`,
          focusTags.length > 0
            ? `We will focus on: ${focusTags.join(', ')}.`
            : 'We will focus on the concept cluster that felt least stable in the last session.',
          'Plan for a short, low-pressure reset rather than a full reteach.',
        ].join('\n');

        return {
          id: Number(student.id || index),
          nickname: String(student.nickname || 'Student'),
          riskLevel: String(student.risk_level || 'medium'),
          accuracy: Number(student.accuracy || 0),
          focusTags,
          reason,
          invite,
        };
      });
  }, [attentionOrder, prioritizedParticipants]);

  const officeHoursPacketText = useMemo(() => {
    return [
      `Office Hours Auto-Invite: ${data?.session?.pack_title || `Session #${sessionId}`}`,
      '',
      ...officeHoursQueue.map((student, index) => (
        `${index + 1}. ${student.nickname} (${student.riskLevel} risk, ${student.accuracy.toFixed(0)}% accuracy)\nReason: ${student.reason}\nFocus: ${student.focusTags.length > 0 ? student.focusTags.join(', ') : 'same-material reset'}\nMessage:\n${student.invite}`
      )),
    ].join('\n\n');
  }, [data?.session?.pack_title, officeHoursQueue, sessionId]);

  const recoveryBuilderTargets = useMemo(() => {
    const targets = [
      {
        id: 'attention',
        label: 'Attention Queue',
        body: 'Build personal recovery games for the students who need follow-up first.',
        participantIds: topAttentionStudents.map((student: any) => Number(student.id)).filter((id: number) => id > 0),
      },
      {
        id: 'high-risk',
        label: 'High Risk',
        body: 'Build the lightest same-material recovery games for the students with the most fragile signal.',
        participantIds: prioritizedParticipants
          .filter((student: any) => String(student.risk_level || '') === 'high')
          .slice(0, 6)
          .map((student: any) => Number(student.id))
          .filter((id: number) => id > 0),
      },
      {
        id: 'fatigue',
        label: 'Fatigue Reset',
        body: 'Build recovery games for the students who faded late or lost focus repeatedly.',
        participantIds: prioritizedParticipants
          .filter((student: any) =>
            student?.fatigue_drift?.direction === 'fatigue' || Number(student.total_focus_loss || 0) >= 2,
          )
          .slice(0, 6)
          .map((student: any) => Number(student.id))
          .filter((id: number) => id > 0),
      },
    ];

    return targets
      .map((target) => ({ ...target, count: target.participantIds.length }))
      .filter((target) => target.count > 0);
  }, [prioritizedParticipants, topAttentionStudents]);

  const visibleKeyMetricCards = useMemo(
    () => (showAdvancedPanels ? keyMetricCards : keyMetricCards.slice(0, 4)),
    [keyMetricCards, showAdvancedPanels],
  );

  const questionPreviewLimit = showAdvancedPanels ? 4 : 3;
  const visibleQuestionDiagnostics = useMemo(
    () => filteredQuestionDiagnostics.slice(0, questionPreviewLimit),
    [filteredQuestionDiagnostics, questionPreviewLimit],
  );
  const hiddenQuestionDiagnostics = useMemo(
    () => filteredQuestionDiagnostics.slice(questionPreviewLimit),
    [filteredQuestionDiagnostics, questionPreviewLimit],
  );

  const studentPreviewLimit = showAdvancedPanels ? filteredParticipants.length : 6;
  const visibleStudentCards = useMemo(
    () => filteredParticipants.slice(0, studentPreviewLimit),
    [filteredParticipants, studentPreviewLimit],
  );
  const hiddenStudentCards = useMemo(
    () => filteredParticipants.slice(studentPreviewLimit),
    [filteredParticipants, studentPreviewLimit],
  );

  const simpleViewPreviewCards = useMemo(
    () =>
      showAdvancedPanels
        ? []
        : [
            {
              id: 'recovery',
              label: 'Recovery Tools',
              title:
                recoveryBuilderTargets.length > 0
                  ? `${recoveryBuilderTargets[0].count} students are ready for targeted recovery`
                  : 'Targeted recovery tools stay available in full view',
              body:
                recoveryBuilderTargets[0]?.body ||
                'Open full view to build personal recovery games and copy-ready intervention packets.',
              badge: recoveryBuilderTargets.length > 0 ? `${recoveryBuilderTargets[0].count}` : 'Tooling',
              targetId: 'teacher-board-recovery-tools',
            },
            {
              id: 'replay',
              label: 'Session Replay',
              title:
                sessionReplayTimeline.length > 0
                  ? `${sessionReplayTimeline.length} question checkpoints are ready`
                  : 'Question-by-question replay stays in full view',
              body:
                sessionReplayTimeline[0]?.move ||
                'Open the full timeline when you need the exact moment the room held, slipped, or needed a reteach.',
              badge: sessionReplayTimeline.length > 0 ? `Q${sessionReplayTimeline[0].questionIndex}` : 'Replay',
              targetId: 'teacher-board-replay',
            },
            {
              id: 'peer-support',
              label: 'Peer Support',
              title:
                peerTutorMatches.length > 0
                  ? `${peerTutorMatches.length} support matches were identified`
                  : 'Peer tutoring suggestions stay in full view',
              body:
                peerTutorMatches[0]
                  ? `${peerTutorMatches[0].tutor.nickname} can stabilize ${peerTutorMatches[0].learner.nickname} around ${peerTutorMatches[0].overlap.slice(0, 2).join(', ')}.`
                  : 'Use full view for live peer-support pairings, richer cohorts, and extra classroom operations.',
              badge: peerTutorMatches.length > 0 ? `${peerTutorMatches.length}` : 'Support',
              targetId: 'teacher-board-peer-support',
            },
          ],
    [peerTutorMatches, recoveryBuilderTargets, sessionReplayTimeline, showAdvancedPanels],
  );

  const conceptClinics = useMemo(
    () =>
      topGapTags
        .slice(0, 3)
        .map((tag: any, index: number) => ({
          id: `clinic-${tag.tag || index}`,
          concept: humanizeTag(tag.tag),
          title:
            Number(tag.accuracy || 0) < 60
              ? `${humanizeTag(tag.tag)} needs a whole-class reset`
              : `${humanizeTag(tag.tag)} needs a short clinic`,
          body:
            Number(tag.changed_away_from_correct_rate || 0) >= 15
              ? 'Students are unstable even when they get close. Re-explain the distinction and rehearse it immediately.'
              : 'Use a short reteach, one contrast example, and one fast re-check to close this gap.',
          tone:
            Number(tag.accuracy || 0) < 60 || Number(tag.stress_index || 0) >= 65
              ? ('bad' as const)
              : ('mid' as const),
          studentCount: Number(tag.students_count ?? tag.attempts ?? 0),
          actionSearch: String(tag.tag || ''),
        })),
    [topGapTags],
  );

  const teachingPlaybook = useMemo(() => {
    const leadCohort = interventionCohorts.find((cohort) => cohort.id !== 'peer-leads') || interventionCohorts[0] || null;
    const leadClinic = conceptClinics[0] || null;
    const leadPlan = followUpEngine?.plans?.[0] || null;

    return [
      {
        id: 'playbook-brief',
        label: '1 minute',
        title: leadQuestion ? `Re-open question ${leadQuestion.question_index}` : 'Start with the hardest idea',
        body:
          leadQuestion?.recommendation ||
          executiveSummary.actionBody,
        tone: 'bad' as const,
        actionLabel: 'Open question triage',
        onAction: () => focusQuestionBoard('teach-now', String(leadQuestion?.question_index || '')),
      },
      {
        id: 'playbook-group',
        label: '3 minutes',
        title: leadCohort ? `Split off ${leadCohort.count} students for a targeted reset` : 'Open the student command center',
        body:
          leadCohort?.body ||
          'Use the command center to decide who needs a slower same-material intervention.',
        tone: 'mid' as const,
        actionLabel: leadCohort ? 'Open matching students' : 'Open students',
        onAction: () => focusStudentCommandCenter(leadCohort?.actionFilter || 'all', leadCohort?.searchTerm || ''),
      },
      {
        id: 'playbook-seal',
        label: 'After class',
        title: leadPlan ? leadPlan.title : leadClinic ? `Build a ${leadClinic.concept} clinic` : 'Create the next round',
        body:
          leadPlan?.body ||
          leadClinic?.body ||
          'Turn this session into a short follow-up pack while the misconceptions are still fresh.',
        tone: 'good' as const,
        actionLabel: leadPlan ? 'Create follow-up pack' : 'Open follow-up engine',
        onAction: () => {
          if (leadPlan) {
            void handleFollowUpAction(leadPlan.id, false);
            return;
          }
          scrollToBoardSection('teacher-board-follow-up');
        },
      },
    ];
  }, [conceptClinics, executiveSummary.actionBody, followUpEngine?.plans, interventionCohorts, leadQuestion]);

  const runTeacherAction = async (
    action:
      | { type: 'scroll'; target: string }
      | { type: 'student'; studentId: number | string }
      | { type: 'follow-up'; planId: string }
      | { type: 'memory-autopilot'; participantIds?: number[] },
  ) => {
    if (action.type === 'scroll') {
      scrollToBoardSection(action.target);
      return;
    }
    if (action.type === 'student') {
      openStudentDashboard(action.studentId);
      return;
    }
    if (action.type === 'memory-autopilot') {
      await handleRunMemoryAutopilot(action.participantIds);
      return;
    }
    await handleFollowUpAction(action.planId, false);
  };

  if (loading) {
    return (
      <div dir={direction} className="min-h-screen bg-brand-bg flex items-center justify-center text-brand-dark">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">{t('Loading class command center...')}</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div dir={direction} className="min-h-screen bg-brand-bg flex items-center justify-center p-8">
        <div className="bg-white border-4 border-brand-dark rounded-[2rem] shadow-[8px_8px_0px_0px_#1A1A1A] p-8 max-w-xl text-center">
          <p className="text-3xl font-black mb-3">{t('Analytics unavailable')}</p>
          <p className="font-bold text-brand-dark/60 mb-6">{t(error || 'No analytics payload was returned.')}</p>
          <button
            onClick={() => navigate('/teacher/reports')}
            className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
          >
            {t('Back to Reports')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      dir={direction}
      className="min-h-screen bg-brand-bg pb-20 font-sans text-brand-dark selection:bg-brand-orange selection:text-white"
    >
      <div className={`sticky top-0 z-30 border-b-4 border-brand-dark shadow-[0_4px_0px_0px_#1A1A1A] transition-all duration-300 ${isHeaderCondensed ? 'bg-white/85 backdrop-blur-md' : 'bg-white'}`}>
        <div className={`max-w-[1520px] mx-auto px-4 sm:px-6 transition-all duration-300 ${showExpandedHeader ? 'py-4 space-y-4' : 'py-2 space-y-1'}`}>
          <div className={`flex flex-col justify-between gap-4 ${showExpandedHeader ? '2xl:flex-row 2xl:items-start' : 'xl:flex-row xl:items-center'} ${isRtl ? '2xl:flex-row-reverse xl:flex-row-reverse' : ''}`}>
            <div className={`flex items-start gap-4 min-w-0 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <button
                onClick={() => navigate('/teacher/reports')}
                className={`${showExpandedHeader ? 'w-12 h-12' : 'w-10 h-10'} rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A] shrink-0 transition-all duration-300`}
              >
                <ArrowLeft className={`${showExpandedHeader ? 'w-5 h-5' : 'w-4 h-4'} transition-all`} />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-purple mb-2">
                  {showExpandedHeader ? t('Teacher Command Board') : t('Session analytics')}
                </p>
                <h1 className={`${showExpandedHeader ? 'text-4xl lg:text-5xl' : 'text-xl lg:text-2xl'} font-black tracking-tight leading-tight break-words transition-all duration-300`}>
                  {data?.session?.pack_title || t(`Session #${sessionId}`)}
                </h1>
                {showExpandedHeader ? (
                  <p className="font-bold text-brand-dark/65 mt-2 max-w-3xl">
                    {t('Read the class state, locate the misconception, then decide who needs follow-up. This header is intentionally tuned for a fast teaching decision.')}
                  </p>
                ) : (
                  <p className="font-bold text-brand-dark/60 mt-1 max-w-3xl">
                    {t(executiveSummary.classStateTitle)} • {t(executiveSummary.actionTitle)}
                  </p>
                )}
                {showExpandedHeader && (
                  <div className="flex flex-wrap gap-2 mt-3 transition-opacity">
                    <ContextChip label="Session" value={`#${data?.session?.id || sessionId}`} tone="neutral" />
                    <ContextChip label="Status" value={data?.session?.status || 'Unknown'} tone={data?.session?.status === 'ENDED' ? 'good' : 'mid'} />
                    <ContextChip label="Students" value={`${participants.length}`} tone="neutral" />
                    <ContextChip label="Questions" value={`${questionRows.length}`} tone="neutral" />
                    <ContextChip label="Mode" value={gameMode.label} tone="neutral" />
                    {showAdvancedPanels && (
                      <ContextChip label="Research Rows" value={compactNumber.format(researchRows.length || 0)} tone="neutral" />
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-full border-2 border-brand-dark bg-brand-bg p-1 shadow-[2px_2px_0px_0px_#1A1A1A]">
                <button
                  onClick={() => setViewMode('simple')}
                  className={`px-4 py-2 rounded-full font-black text-sm ${viewMode === 'simple' ? 'bg-white text-brand-dark' : 'text-brand-dark/65'}`}
                >
                  {t('Simple View')}
                </button>
                <button
                  onClick={() => setViewMode('advanced')}
                  className={`px-4 py-2 rounded-full font-black text-sm ${viewMode === 'advanced' ? 'bg-brand-dark text-white' : 'text-brand-dark/65'}`}
                >
                  {t('Advanced View')}
                </button>
              </div>
              {isHeaderCondensed && (
                <button
                  onClick={() => setIsHeaderPinnedOpen((current) => !current)}
                  className={`${showExpandedHeader ? 'px-5 py-3' : 'px-3 py-2 text-xs'} bg-brand-bg border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] transition-all`}
                >
                  {showExpandedHeader ? t('Collapse header') : t('Expand')}
                </button>
              )}
              <button
                onClick={loadAnalytics}
                className={`${showExpandedHeader ? 'px-5 py-3' : 'px-3 py-2 text-xs'} bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] transition-all`}
              >
                <RefreshCw className={`${showExpandedHeader ? 'w-4 h-4' : 'w-3 h-3'}`} />
                {t('Refresh')}
              </button>
              {showExpandedHeader && showAdvancedPanels && (
                <button
                  onClick={() =>
                    downloadAllCsvs(exportBaseName, [
                      { name: 'students.csv', rows: studentCsvRows },
                      { name: 'questions.csv', rows: questionCsvRows },
                      { name: 'lms-gradebook.csv', rows: lmsCsvRows },
                      { name: 'teams.csv', rows: teamCsvRows },
                      { name: 'responses.csv', rows: researchRows },
                    ])
                  }
                  className={`${showExpandedHeader ? 'px-5 py-3' : 'px-3 py-2 text-xs'} bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] transition-all`}
                >
                  <Download className={`${showExpandedHeader ? 'w-4 h-4' : 'w-3 h-3'}`} />
                  {t('Download All (ZIP)')}
                </button>
              )}
              {selectedStudent && (
                <button
                  onClick={() => navigate(`/teacher/analytics/class/${sessionId}/student/${selectedStudent.id}`)}
                  className={`${showExpandedHeader ? 'px-5 py-3' : 'px-3 py-2 text-xs'} bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] transition-all`}
                >
                  {t(selectedStudent.nickname)}
                  <ArrowUpRight className={`${showExpandedHeader ? 'w-4 h-4' : 'w-3 h-3'}`} />
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

      <main className="max-w-[1520px] mx-auto px-4 sm:px-6 pt-8 sm:pt-10">
        <SectionIntro
          eyebrow="Immediate Read"
          title="Start with the verdict, not the telemetry"
          body="This opening block is meant to answer three questions fast: what is happening in the class, what is driving it, and who needs teacher attention first."
        />

        <motion.section
          id="teacher-board-overview"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="scroll-mt-40 bg-brand-dark text-white rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8 lg:p-9 mb-8 overflow-hidden relative"
        >
          <div className="absolute right-[-40px] top-[-50px] w-60 h-60 rounded-full bg-white/10" />
          <div className="absolute right-24 bottom-[-45px] w-32 h-32 rounded-full bg-brand-yellow/20" />
          <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[1.12fr_0.88fr] gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">{t('Executive Diagnosis')}</p>
              <h2 className="text-4xl lg:text-5xl font-black leading-tight mb-4">
                {t(data?.summary?.headline || 'Class snapshot ready')}
              </h2>
              <p className="text-lg font-medium text-white/75 max-w-3xl">
                {t(data?.summary?.summary || 'We are loading the class narrative and will surface the strongest signal first.')}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Diagnosis')}</p>
                  <p className="text-xl font-black leading-tight">{t(executiveSummary.topIssueTitle)}</p>
                  <p className="font-medium text-white/72 mt-2">{t(executiveSummary.topIssueBody)}</p>
                </div>
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Why It Matters')}</p>
                  <p className="text-xl font-black leading-tight">
                    {t(helpfulRevisionRate > harmfulRevisionRate ? 'Students can recover, but too late for fluent mastery.' : 'The class is not correcting itself reliably enough.')}
                  </p>
                  <p className="font-medium text-white/72 mt-2">
                    {t(`${helpfulRevisionRate.toFixed(0)}% corrected a wrong start, while ${harmfulRevisionRate.toFixed(0)}% reversed away from the right answer.`)}
                  </p>
                </div>
                <div className="rounded-[1.6rem] border border-white/15 bg-white/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Recommended Move')}</p>
                  <p className="text-xl font-black leading-tight">{t(executiveSummary.actionTitle)}</p>
                  <p className="font-medium text-white/72 mt-2">{t(executiveSummary.actionBody)}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.9rem] border-4 border-brand-dark bg-white text-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <div className="flex items-center gap-3 mb-4">
                  <ListChecks className="w-5 h-5 text-brand-purple" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('Who Needs Attention Now')}</p>
                    <p className="font-bold text-brand-dark/65">{t('Open these students first if you only have a minute.')}</p>
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
                      <p className="font-medium text-brand-dark/70">{t(student.recommendation)}</p>
                    </button>
                  )) : (
                    <p className="font-bold text-brand-dark/60">{t('No student queue has been produced yet.')}</p>
                  )}
                </div>
              </div>

              <div className="rounded-[1.9rem] border-4 border-brand-dark bg-brand-yellow text-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <div className="flex items-center gap-3 mb-3">
                  <CircleAlert className="w-5 h-5 text-brand-orange" />
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/60">{t('Critical Alert')}</p>
                </div>
                <p className="text-2xl font-black leading-tight mb-2">{t(leadAlert?.title || 'No urgent class-wide alert')}</p>
                <p className="font-medium text-brand-dark/75">
                  {t(leadAlert?.body || 'The class does not currently show a single alert that outweighs the rest of the board.')}
                </p>
              </div>

              <div className="rounded-[1.9rem] border-4 border-brand-dark bg-white text-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('Teacher Trust Mode')}</p>
                    <p className="font-bold text-brand-dark/65 mt-1">{t('Observed facts, interpretation, and action')}</p>
                  </div>
                  <div className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/55">
                    {String(summaryTrust?.analytics_version || data?.analytics_version || 'n/a').replace(/_/g, ' ')}
                  </div>
                </div>

                <div className="grid gap-3">
                  <TrustReadCard
                    eyebrow={t('Observed Facts')}
                    title={t(summaryObservedFacts?.headline || 'Observed facts')}
                    body={t(summaryObservedFacts?.body || 'No evidence snapshot was produced yet.')}
                    tone="light"
                  />
                  <TrustReadCard
                    eyebrow={t('Derived Interpretation')}
                    title={t(summaryInterpretation?.headline || data?.summary?.headline || 'Class read')}
                    body={t(summaryInterpretation?.body || data?.summary?.summary || 'No interpretation was produced yet.')}
                    tone="purple"
                  />
                  <TrustReadCard
                    eyebrow={t('Teacher Action')}
                    title={t(summaryTeacherAction?.label || summaryTeacherAction?.title || 'Monitor')}
                    body={t(summaryTeacherAction?.body || 'Keep watching the next round for a clearer instructional move.')}
                    tone="amber"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <SignalPill label="Signal Quality" value={summaryTrust?.signal_quality || 'low'} tone={riskTone(summaryTrust?.signal_quality)} />
                  <SignalPill label="Confidence Band" value={summaryTrust?.confidence_band || 'low'} tone={riskTone(summaryTrust?.confidence_band)} />
                  <SignalPill label="Evidence Count" value={summaryTrust?.evidence_count ?? 0} />
                  <SignalPill label="Suppressed" value={summaryTrust?.suppressed_reason ? 'Yes' : 'No'} tone={summaryTrust?.suppressed_reason ? 'medium' : 'good'} />
                </div>

                {(summaryGradingMetrics.length > 0 || summaryBehaviorMetrics.length > 0 || summaryRawFacts.length > 0) && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t('Grading-Safe Metrics')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {summaryGradingMetrics.map((metric: any, index: number) => (
                          <React.Fragment key={`grading-safe-${metric.label || index}`}>
                            <TrustMetricChip metric={metric} />
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t('Behavior Signals')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(summaryBehaviorMetrics.length > 0 ? summaryBehaviorMetrics : summaryRawFacts).map((metric: any, index: number) => (
                          <React.Fragment key={`behavior-signal-${metric.label || index}`}>
                            <TrustMetricChip metric={metric} />
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    {summaryTrust?.suppressed_reason && (
                      <div className="rounded-[1.2rem] border-2 border-dashed border-brand-dark/25 bg-brand-bg p-3">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-1">{t('Suppressed Reason')}</p>
                        <p className="font-medium text-brand-dark/70">{t(summaryTrust.suppressed_reason)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        <section className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 ${showAdvancedPanels ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
          {visibleKeyMetricCards.map((card) => (
            <React.Fragment key={card.id}>
              <MetricCard
                metricId={card.id}
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

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-10">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <ListChecks className="w-6 h-6 text-brand-purple" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Teacher Workflow')}</p>
                <h2 className="text-3xl font-black">{t('What to do now')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('Three fast moves for this class')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {guidedWorkflowCards.map((card) => (
                <React.Fragment key={card.id}>
                  <WorkflowActionCard
                    step={card.step}
                    label={card.label}
                    title={card.title}
                    body={card.body}
                    tone={card.tone}
                    actionLabel={card.actionLabel}
                    onAction={card.action}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-6 h-6 text-brand-orange" />
                <div>
                  <h2 className="text-3xl font-black">{t('Focus Mode')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-1">{t('Make the board usable in under a minute')}</p>
                </div>
              </div>
              <div className="inline-flex items-center rounded-full border-2 border-brand-dark bg-brand-bg p-1 mb-4">
                <button
                  onClick={() => setViewMode('simple')}
                  className={`px-4 py-2 rounded-full font-black ${viewMode === 'simple' ? 'bg-white' : 'text-brand-dark/60'}`}
                >
                  {t('Simple View')}
                </button>
                <button
                  onClick={() => setViewMode('advanced')}
                  className={`px-4 py-2 rounded-full font-black ${viewMode === 'advanced' ? 'bg-brand-dark text-white' : 'text-brand-dark/60'}`}
                >
                  {t('Advanced View')}
                </button>
              </div>
              <p className="font-medium text-brand-dark/72">
                {t(
                  viewMode === 'simple'
                    ? 'Simple view keeps the board focused on what to teach, who needs help, and which question to review first.'
                    : 'Advanced view opens the full research layer, detailed distributions, and export-oriented analytics.',
                )}
              </p>
              {!showAdvancedPanels && (
                <div className="rounded-[1.35rem] border-2 border-brand-dark bg-brand-bg p-4 mt-4">
                  <p className="font-black">{t('Advanced analysis is currently hidden')}</p>
                  <p className="font-medium text-brand-dark/70 mt-2">
                    {t('Simple view is hiding deeper research charts, benchmarks, telemetry tables, and export-heavy diagnostics until you ask for them.')}
                  </p>
                  <button
                    onClick={() => openAdvancedView()}
                    className="mt-4 px-5 py-3 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black"
                  >
                    {t('Show advanced analysis')}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-4">
                <Target className="w-6 h-6 text-brand-purple" />
                <div>
                  <h2 className="text-3xl font-black">{t('Quick Navigation')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-1">{t('Jump to the next teaching decision instead of scanning the whole page.')}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {quickNavigationCards.map((card) => (
                  <React.Fragment key={card.id}>
                    <QuickNavCard
                      label={card.label}
                      body={card.body}
                      onClick={card.action}
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-10">
          <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-6 lg:p-7">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <BrainCircuit className="w-6 h-6 text-brand-yellow" />
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow">{t('Intervention Queue')}</p>
                </div>
                <h2 className="text-3xl font-black">{t('What deserves attention first')}</h2>
                <p className="font-bold text-white/72 mt-2 max-w-3xl">
                  {t('This queue turns the board into a decision tool: what to reteach, who to support, and what to launch next.')}
                </p>
              </div>
              <div className="rounded-full border-2 border-white/20 bg-white/10 px-4 py-2 text-sm font-black">
                {t(`${teacherActionQueue.length} recommended actions`)}
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {teacherActionQueue.map((item) => (
                <React.Fragment key={item.id}>
                  <ActionQueueCard
                    label={item.label}
                    title={item.title}
                    body={item.body}
                    metricLabel={item.metricLabel}
                    metricValue={item.metricValue}
                    tone={item.tone}
                    actionLabel={item.actionLabel}
                    onAction={() => void runTeacherAction(item.action)}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        <section id="teacher-board-memory" className="grid grid-cols-1 xl:grid-cols-[1.04fr_0.96fr] gap-8 mb-10">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <Target className="w-6 h-6 text-brand-orange" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Teaching Playbook')}</p>
                <h2 className="text-3xl font-black">{t('A fast plan for the next teaching move')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('Use this when you want to move from analytics to instruction without planning from scratch.')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {teachingPlaybook.map((step) => (
                <React.Fragment key={step.id}>
                  <PlaybookStepCard
                    label={step.label}
                    title={step.title}
                    body={step.body}
                    tone={step.tone}
                    actionLabel={step.actionLabel}
                    onAction={step.onAction}
                  />
                </React.Fragment>
              ))}
            </div>

            {memoryAutopilotQueue.length > 0 && (
              <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-yellow mt-5 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/55 mb-2">{t('Memory Autopilot')}</p>
                    <p className="text-2xl font-black">{t('Launch the highest-value interventions from memory')}</p>
                    <p className="font-medium text-brand-dark/70 mt-2">
                      {t(`${memoryAutopilotQueue.length} students are ready for a same-material intervention right now.`)}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleRunMemoryAutopilot()}
                    disabled={memoryAutopilotBusy}
                    className="px-5 py-3 rounded-full border-2 border-brand-dark bg-brand-dark text-white font-black disabled:opacity-60"
                  >
                    {t(memoryAutopilotBusy ? 'Launching...' : 'Run watchlist autopilot')}
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                  {memoryAutopilotQueue.slice(0, 4).map((item: any) => (
                    <div key={item.id} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                      <p className="font-black text-lg mb-1">{t(item.title)}</p>
                      <p className="font-medium text-brand-dark/70 mb-3">{t(item.body)}</p>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {(item.focus_tags || []).map((tag: string) => (
                          <span key={`${item.id}-${tag}`} className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-bg text-xs font-black">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => void handleRunMemoryAutopilot([Number(item.participant_id)])}
                        disabled={memoryAutopilotBusy}
                        className="px-4 py-2 rounded-full border-2 border-brand-dark bg-brand-purple text-white font-black disabled:opacity-60"
                      >
                        {t('Launch for this student')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-6 h-6 text-brand-purple" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Intervention Cohorts')}</p>
                <h2 className="text-3xl font-black">{t('Auto-built groups from this session')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('Instead of one giant class response, use these groups to differentiate the next move.')}</p>
              </div>
            </div>
            <div className="space-y-4">
              {interventionCohorts.length > 0 ? (
                interventionCohorts.map((cohort) => (
                  <React.Fragment key={cohort.id}>
                    <CohortCard
                      label={cohort.label}
                      title={cohort.title}
                      body={cohort.body}
                      tone={cohort.tone}
                      count={cohort.count}
                      names={cohort.names}
                      focusTags={cohort.focusTags}
                      actionLabel={cohort.actionLabel}
                      onAction={() => focusStudentCommandCenter(cohort.actionFilter, cohort.searchTerm)}
                    />
                  </React.Fragment>
                ))
              ) : (
                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="font-black">{t('Not enough student separation was produced yet')}</p>
                  <p className="font-medium text-brand-dark/70 mt-2">
                    {t('Once the session produces clearer weak-tag and risk patterns, the board will propose differentiated groups here.')}
                  </p>
                </div>
              )}
            </div>

            {memoryWatchlist.length > 0 && (
              <div className="mt-5 rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Memory Watchlist')}</p>
                <div className="space-y-3">
                  {memoryWatchlist.slice(0, 5).map((student: any) => (
                    <button
                      key={`memory-watch-${student.id}`}
                      onClick={() => openStudentDashboard(student.id)}
                      className="w-full text-left rounded-[1.2rem] border-2 border-brand-dark bg-white p-4 hover:bg-brand-bg transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="font-black">{student.nickname}</p>
                        <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
                          {student.action}
                        </span>
                      </div>
                      <p className="font-medium text-brand-dark/70 mb-2">{student.headline}</p>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-dark/45">
                        {t(`${Number(student.accuracy_pct || 0).toFixed(0)}% accuracy • ${Number(student.stress_index || 0).toFixed(0)}% stress`)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {showAdvancedPanels && (
          <section id="teacher-board-peer-support" className="scroll-mt-40 mb-10">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-brand-orange" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Peer Tutor Matching')}</p>
                  <h2 className="text-3xl font-black">{t('Who can stabilize whom right now')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-1">{t('These matches pair a stable student with a learner who needs support on the same concept cluster.')}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {peerTutorMatches.length > 0 ? (
                  peerTutorMatches.map((match) => (
                    <React.Fragment key={match.id}>
                      <PeerTutorMatchCard
                        tutorName={match.tutor.nickname}
                        learnerName={match.learner.nickname}
                        overlap={match.overlap}
                        onTutorAction={() => openStudentDashboard(match.tutor.id)}
                        onLearnerAction={() => openStudentDashboard(match.learner.id)}
                      />
                    </React.Fragment>
                  ))
                ) : (
                  <div className="xl:col-span-2 rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <p className="font-black">{t('No clear peer-support pair emerged from this session')}</p>
                    <p className="font-medium text-brand-dark/70 mt-2">
                      {t('As soon as the board sees stable high performers and overlapping weak-tag patterns, it will suggest live peer pairings here.')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-8 mb-10">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-6 h-6 text-brand-orange" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Pivot Moments')}</p>
                <h2 className="text-3xl font-black">{t('Where the session stopped feeling stable')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('These are the moments where the class bent under pressure, hesitation, or confusion.')}</p>
              </div>
            </div>
            <div className="space-y-4">
              {pivotMoments.length > 0 ? (
                pivotMoments.map((moment) => (
                  <React.Fragment key={moment.id}>
                    <PivotMomentCard
                      title={moment.title}
                      body={moment.body}
                      metricLabel={moment.metricLabel}
                      metricValue={moment.metricValue}
                      tone={moment.tone}
                      onAction={() => focusQuestionBoard('teach-now', moment.searchTerm)}
                    />
                  </React.Fragment>
                ))
              ) : (
                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="font-black">{t('No sharp pivot moment stood out above the baseline')}</p>
                  <p className="font-medium text-brand-dark/70 mt-2">
                    {t('This run looked relatively even across questions, so use concept clinics and the student board before changing pacing.')}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <BrainCircuit className="w-6 h-6 text-brand-purple" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Concept Clinics')}</p>
                <h2 className="text-3xl font-black">{t('Topic-level fixes for the whole class')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('Each clinic proposes a fast same-material intervention around one weak concept cluster.')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {conceptClinics.length > 0 ? (
                conceptClinics.map((clinic) => (
                  <React.Fragment key={clinic.id}>
                    <ConceptClinicCard
                      concept={clinic.concept}
                      title={clinic.title}
                      body={clinic.body}
                      studentCount={clinic.studentCount}
                      tone={clinic.tone}
                      onStudentAction={() => focusStudentCommandCenter('all', clinic.actionSearch)}
                      onQuestionAction={() => focusQuestionBoard('teach-now', clinic.actionSearch)}
                    />
                  </React.Fragment>
                ))
              ) : (
                <div className="xl:col-span-3 rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <p className="font-black">{t('No concept clinics were generated yet')}</p>
                  <p className="font-medium text-brand-dark/70 mt-2">
                    {t('When the session exposes repeatable weak-topic patterns, this section will turn them into quick class clinics.')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {showAdvancedPanels && (
          <>
            <section id="teacher-board-recovery-tools" className="scroll-mt-40 grid grid-cols-1 xl:grid-cols-[0.98fr_1.02fr] gap-8 mb-10">
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-6 h-6 text-brand-orange" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Office Hours Auto-Invite')}</p>
                      <h2 className="text-3xl font-black">{t('Who should hear from you next')}</h2>
                      <p className="font-bold text-brand-dark/60 mt-1">{t('Copy a ready-made invite for the students most likely to drift or underperform next.')}</p>
                    </div>
                  </div>
                  {officeHoursQueue.length > 0 && (
                    <button
                      onClick={() => void handleCopyOfficeHours('office-hours-all', officeHoursPacketText)}
                      className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black"
                    >
                      {copiedOfficeHoursKey === 'office-hours-all' ? t('Copied') : t('Copy full list')}
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {officeHoursQueue.length > 0 ? (
                    officeHoursQueue.map((student) => (
                      <React.Fragment key={student.id}>
                        <OfficeHoursInviteCard
                          nickname={student.nickname}
                          riskLevel={student.riskLevel}
                          accuracy={student.accuracy}
                          reason={student.reason}
                          focusTags={student.focusTags}
                          copied={copiedOfficeHoursKey === `invite-${student.id}`}
                          onCopy={() => void handleCopyOfficeHours(`invite-${student.id}`, student.invite)}
                          onOpen={() => openStudentDashboard(student.id)}
                        />
                      </React.Fragment>
                    ))
                  ) : (
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <p className="font-black">{t('No office-hours queue was generated for this session')}</p>
                      <p className="font-medium text-brand-dark/70 mt-2">
                        {t('Once the board detects risk, fatigue, or accuracy drops, this section will prepare the next outreach move for you.')}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <Rocket className="w-6 h-6 text-brand-purple" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Targeted Recovery Builder')}</p>
                    <h2 className="text-3xl font-black">{t('Build personal games for the right cohort')}</h2>
                    <p className="font-bold text-brand-dark/60 mt-1">{t('Instead of building for the whole class, create personal recovery games only for the students who need them most.')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {recoveryBuilderTargets.length > 0 ? (
                    recoveryBuilderTargets.map((target) => (
                      <React.Fragment key={target.id}>
                        <RecoveryBuilderCard
                          label={target.label}
                          body={target.body}
                          count={target.count}
                          busy={recoveryBuilderBusyKey === target.id}
                          onBuild={() => void handleBuildRecoveryGames(target)}
                        />
                      </React.Fragment>
                    ))
                  ) : (
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <p className="font-black">{t('No recovery cohort is ready yet')}</p>
                      <p className="font-medium text-brand-dark/70 mt-2">
                        {t('As soon as the session identifies an attention queue, high-risk cluster, or fatigue group, you will be able to build personal games for them here.')}
                      </p>
                    </div>
                  )}
                </div>

                {recoveryBuilderSummary && (
                  <div className="mt-5 rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Latest build')}</p>
                        <p className="text-2xl font-black">{t(recoveryBuilderSummary.targetLabel)}</p>
                        <p className="font-medium text-brand-dark/70 mt-2">
                          {t('These packs are now waiting in My Quizzes and can be launched later or assigned in your next live block.')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-3 py-2 text-sm font-black">
                          {recoveryBuilderSummary.createdCount} {t('created')}
                        </span>
                        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-sm font-black">
                          {recoveryBuilderSummary.reusedCount} {t('reused')}
                        </span>
                        <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-2 text-sm font-black">
                          {recoveryBuilderSummary.failedCount} {t('skipped')}
                        </span>
                      </div>
                    </div>
                    {recoveryBuilderSummary.createdPacks.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {recoveryBuilderSummary.createdPacks.slice(0, 4).map((packRow: any) => (
                          <div key={`${packRow.pack_id}-${packRow.participant?.id}`} className="rounded-[1.1rem] border-2 border-brand-dark bg-white px-4 py-3">
                            <p className="font-black">{packRow.participant?.nickname}</p>
                            <p className="font-medium text-brand-dark/65">{packRow.title}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section id="teacher-board-replay" className="scroll-mt-40 mb-10">
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3">
                    <Activity className="w-6 h-6 text-brand-purple" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Session Replay Timeline')}</p>
                      <h2 className="text-3xl font-black">{t('Question by question, where the room held or slipped')}</h2>
                      <p className="font-bold text-brand-dark/60 mt-1">{t('Use this when you need the exact lesson arc: where confidence held, where stress rose, and where the class needed a pivot.')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleCopyReplayTimeline()}
                    className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black"
                  >
                    {copiedReplayTimeline ? t('Copied') : t('Copy replay timeline')}
                  </button>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {sessionReplayTimeline.map((row) => (
                    <React.Fragment key={row.id}>
                      <SessionReplayCard
                        questionIndex={row.questionIndex}
                        prompt={row.prompt}
                        signal={row.signal}
                        tone={row.tone}
                        accuracy={row.accuracy}
                        stress={row.stress}
                        responseMs={row.responseMs}
                        move={row.move}
                        distractorLabel={row.distractorLabel}
                        distractorRate={row.distractorRate}
                        onOpen={() => focusQuestionBoard('teach-now', String(row.questionIndex))}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {followUpEngine?.plans?.length > 0 && (
          <section id="teacher-board-follow-up" className="scroll-mt-40 mb-10">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <Sparkles className="w-6 h-6 text-brand-orange" />
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange">{t('Follow-Up Engine')}</p>
                  </div>
                  <h2 className="text-3xl font-black">{t('Turn this session into the next lesson')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-2 max-w-3xl">
                    {t('Pick a ready-made follow-up path, create the pack, or open it live right now from the same analytics board.')}
                  </p>
                </div>
                {followUpNotice && (
                  <div
                    className={`rounded-[1.35rem] border-2 px-4 py-3 font-black ${
                      followUpNotice.tone === 'success'
                        ? 'border-emerald-700 bg-emerald-100 text-emerald-900'
                        : 'border-brand-dark bg-brand-yellow text-brand-dark'
                    }`}
                  >
                    {t(followUpNotice.message)}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                {followUpEngine.plans.map((plan: any) => {
                  const createKey = `${plan.id}:pack`;
                  const hostKey = `${plan.id}:host`;
                  const isCreatingPack = followUpBusyPlanId === createKey;
                  const isHostingPack = followUpBusyPlanId === hostKey;
                  return (
                    <div key={plan.id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(plan.audience)}</p>
                          <h3 className="text-2xl font-black">{t(plan.title)}</h3>
                        </div>
                        <div className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-sm font-black">
                          {plan.question_count}
                        </div>
                      </div>

                      <p className="font-medium text-brand-dark/72 mb-4">{t(plan.body)}</p>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-1">{t('Students')}</p>
                          <p className="text-xl font-black">{plan.target_student_count}</p>
                        </div>
                        <div className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-1">{t('Questions')}</p>
                          <p className="text-xl font-black">{plan.priority_question_indexes?.length || plan.question_count}</p>
                        </div>
                      </div>

                      {plan.focus_tags?.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{t('Focus Tags')}</p>
                          <div className="flex flex-wrap gap-2">
                            {plan.focus_tags.map((tag: string) => (
                              <span key={`${plan.id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {plan.priority_question_indexes?.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{t('Priority Questions')}</p>
                          <div className="flex flex-wrap gap-2">
                            {plan.priority_question_indexes.map((questionIndex: number) => (
                              <span key={`${plan.id}-q-${questionIndex}`} className="px-3 py-1 rounded-full bg-brand-yellow border-2 border-brand-dark text-xs font-black">
                                {t(`Question ${questionIndex}`)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {plan.target_student_names?.length > 0 && (
                        <div className="mb-5">
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{t('Student Group')}</p>
                          <div className="flex flex-wrap gap-2">
                            {plan.target_student_names.map((studentName: string) => (
                              <span key={`${plan.id}-${studentName}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                                {studentName}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={() => void handleFollowUpAction(plan.id, false)}
                          disabled={Boolean(followUpBusyPlanId)}
                          className="flex-1 px-4 py-3 bg-white border-2 border-brand-dark rounded-full font-black disabled:opacity-60"
                        >
                          {isCreatingPack ? t('Creating...') : t('Create follow-up pack')}
                        </button>
                        <button
                          onClick={() => void handleFollowUpAction(plan.id, true)}
                          disabled={Boolean(followUpBusyPlanId)}
                          className="flex-1 px-4 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black disabled:opacity-60"
                        >
                          {isHostingPack ? t('Creating...') : t('Create and host now')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {showAdvancedPanels && (packMeta || crossSectionComparison) && (
          <section id="teacher-board-advanced" className="scroll-mt-40 grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-8 mb-10">
            {packMeta && (
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <Target className="w-6 h-6 text-brand-purple" />
                  <div>
                    <h2 className="text-3xl font-black">{t('Academic Mapping')}</h2>
                    <p className="font-bold text-brand-dark/60 mt-1">{t('Keep this session anchored to the course structure, not just the game.')}</p>
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
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Learning outcomes')}</p>
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
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Bloom coverage')}</p>
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
                    <h2 className="text-3xl font-black">{t('Cross-Section Comparison')}</h2>
                    <p className="font-bold text-brand-dark/60 mt-1">
                      {t(`Compare this run against ${crossSectionComparison.benchmark?.compared_sessions || 0} prior session${Number(crossSectionComparison.benchmark?.compared_sessions || 0) === 1 ? '' : 's'} on the same ${crossSectionComparison.basis === 'course_code' ? 'course code' : 'pack'}.`)}
                    </p>
                  </div>
                  <div className="px-4 py-3 rounded-full bg-brand-bg border-2 border-brand-dark font-black text-sm">
                    {t(crossSectionComparison.course_code || 'Pack scope')}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  <PackMetric
                    label="Accuracy delta"
                    value={`${Number(crossSectionComparison.benchmark?.delta_accuracy || 0).toFixed(1)} pts`}
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
                            {row.section_name || t('Main')}
                            {row.is_current ? ` • ${t('Current session')}` : ''}
                          </p>
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/50">
                            {[row.academic_term, row.week_label].filter(Boolean).join(' • ') || t('Unmapped session')}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                            {t(`${Number(row.accuracy || 0).toFixed(1)}% accuracy`)}
                          </span>
                          <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                            {t(`${row.participant_count} students`)}
                          </span>
                        </div>
                      </div>
                      <p className="font-medium text-brand-dark/70">
                        {t(`Avg response ${formatMs(Number(row.avg_response_ms || 0))} • Session #${row.session_id}`)}
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

        <section id="teacher-board-teach" className="scroll-mt-40 grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-4">
              <BrainCircuit className="w-6 h-6 text-brand-purple" />
              <div>
                <h2 className="text-3xl font-black">{t('Decision Intelligence')}</h2>
                <p className="font-bold text-brand-dark/60 mt-1">{t('Three verdicts first, then the evidence underneath.')}</p>
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
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Recovery + Drift')}</p>
              <h2 className="text-3xl font-black mb-3">{t(fatigueDrift?.headline || 'No fatigue read yet')}</h2>
              <p className="font-medium text-white/75 mb-5">{t(fatigueDrift?.body || 'There are not enough rows yet to estimate drift.')}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <MiniMetric label="Recovery Rate" value={`${Number(recoveryProfile?.recovery_rate || 0).toFixed(0)}%`} />
                <MiniMetric label="Commit Window" value={formatMs(Number(behaviorPatterns?.commitment_latency_ms?.median || 0))} />
                <MiniMetric label="Early Accuracy" value={`${Number(fatigueDrift?.early_accuracy || 0).toFixed(0)}%`} />
                <MiniMetric label="Late Accuracy" value={`${Number(fatigueDrift?.late_accuracy || 0).toFixed(0)}%`} />
              </div>
              <div className="rounded-[1.5rem] border border-white/15 bg-white/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-2">{t('So what?')}</p>
                <p className="text-xl font-black mb-1">
                  {t(fatigueDrift?.direction === 'flat' ? 'The main issue is not only fatigue.' : 'Some students fade as the session goes on.')}
                </p>
                <p className="font-medium text-white/72">
                  {t(fatigueDrift?.direction === 'flat'
                    ? highRiskFatigueCount > 0
                      ? `${highRiskFatigueCount} high-risk students still showed late fade even though the class average stayed flatter.`
                      : 'Class-wide fatigue stayed limited, so the bigger teaching move is conceptual clarification plus calmer pacing.'
                    : `${fatigueAffectedCount} students show a fatigue pattern, with ${highRiskFatigueCount} of them already in the high-risk group.`)}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="w-6 h-6 text-brand-orange" />
                <div>
                  <h2 className="text-3xl font-black">{t('Recurrent Misconceptions')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-1">
                    {t(visibleMisconceptions.length > 0
                      ? 'Show the most instruction-worthy confusion clusters first.'
                      : 'No misconception cluster repeated enough to outrank the rest.')}
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
                              {t(index === 0 ? 'Most Widespread' : severityLabel)}
                            </span>
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange">{humanizeTag(pattern.tag)}</span>
                          </div>
                          <p className="font-black leading-tight text-lg">
                            {t(`Distractor ${pattern.choice_label}: ${pattern.choice_text}`)}
                          </p>
                        </div>
                        <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black shrink-0">
                          {affectedShare}%
                        </span>
                      </div>
                      <p className="font-medium text-brand-dark/72">
                        {t(`${pattern.student_count} students hit this misconception across ${pattern.question_count} question${Number(pattern.question_count) === 1 ? '' : 's'}.`)}
                      </p>
                      <p className="font-black text-brand-dark mt-3">{t(actionHint)}</p>
                    </div>
                  );
                }) : (
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="font-black">{t('No repeated misconception cluster outran the noise floor.')}</p>
                    <p className="font-medium text-brand-dark/70 mt-2">
                      {t('Treat the weaker items as isolated question problems rather than one repeating class-wide misunderstanding.')}
                    </p>
                  </div>
                )}

                {hiddenMisconceptions.length > 0 && (
                  <details className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black">{t(`Show ${hiddenMisconceptions.length} additional misconception patterns`)}</p>
                        <p className="font-medium text-brand-dark/65">{t('Keep the top three open by default so the page stays scannable.')}</p>
                      </div>
                      <ChevronDown className="w-5 h-5 shrink-0" />
                    </summary>
                    <div className="space-y-3 mt-4">
                      {hiddenMisconceptions.map((pattern: any) => (
                        <div key={`hidden-${pattern.tag}-${pattern.choice_label}-${pattern.choice_text}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-1">{humanizeTag(pattern.tag)}</p>
                          <p className="font-black">{t(`Distractor ${pattern.choice_label}: ${pattern.choice_text}`)}</p>
                          <p className="font-medium text-brand-dark/70 mt-2">
                            {t(`${pattern.student_count} students across ${pattern.question_count} question${Number(pattern.question_count) === 1 ? '' : 's'}.`)}
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

        {showAdvancedPanels && (
        <details id={packMeta || crossSectionComparison ? undefined : 'teacher-board-advanced'} className="scroll-mt-40 bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
          <summary className="list-none cursor-pointer p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Supporting Context')}</p>
              <h2 className="text-3xl font-black">{t('Session context and attention signals')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Open this when you need the quiz format context or the raw attention telemetry behind the verdicts above.')}</p>
            </div>
            <div className="flex items-center gap-3">
              <ContextChip label="Mode" value={gameMode.label} tone="neutral" />
              <ContextChip label="Rows" value={`${researchRows.length}`} tone="neutral" />
              <ChevronDown className="w-5 h-5" />
            </div>
          </summary>
          <div className="px-6 lg:px-7 pb-7 grid grid-cols-1 xl:grid-cols-[0.78fr_1.22fr] gap-8">
            <div className="bg-brand-bg rounded-[1.8rem] border-2 border-brand-dark p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">{t('Session Context')}</p>
              <h3 className="text-3xl font-black mb-3">{t(gameMode.label)}</h3>
              <p className="font-medium text-brand-dark/70 mb-5">{t(gameMode.description)}</p>
              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4 mb-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Research cue')}</p>
                <p className="font-black">{t(gameMode.researchCue)}</p>
              </div>
              <div className="flex flex-wrap gap-2 mb-5">
                {gameMode.objectives.map((objective) => (
                  <span key={objective} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black">
                    {t(objective)}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SignalPill label="Teams" value={teams.length || data?.summary?.team_count || 0} />
                <SignalPill label="Mode Type" value={gameMode.teamBased ? 'Group' : 'Solo'} />
                <SignalPill label="Rows" value={researchRows.length} />
                <SignalPill label="Questions" value={questionRows.length} />
              </div>
            </div>

            <div className="bg-brand-bg rounded-[1.8rem] border-2 border-brand-dark p-6">
              <div className="mb-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Attention Signals')}</p>
                <h3 className="text-3xl font-black">{t('Human-readable telemetry')}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                {attentionInsights.map((insight) => (
                  <div key={insight.id} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                    <p className="font-black leading-tight">{t(insight.title)}</p>
                    <p className="font-medium text-brand-dark/68 mt-2">{t(insight.body)}</p>
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
        )}

        <SectionIntro
          eyebrow={showAdvancedPanels ? 'Class Behavior' : 'Student Attention'}
          title={showAdvancedPanels ? 'Read where the class bent under pressure' : 'See who needs teacher attention first'}
          body={
            showAdvancedPanels
              ? 'Use these charts after you know the misconception. They explain when the room destabilized, which students stayed resilient, and whether time pressure changed the outcome.'
              : 'Start with the student map and the attention queue. Open the advanced view for revision flow, timing curves, and the deeper research layer.'
          }
        />

        <section id="teacher-board-students" className={`scroll-mt-40 grid grid-cols-1 gap-8 mb-8 ${showAdvancedPanels ? 'xl:grid-cols-[1.16fr_0.84fr]' : ''}`}>
          {showAdvancedPanels && (
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden h-full flex flex-col">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-purple mb-2">{t('Decision Paths')}</p>
                  <h2 className="text-3xl font-black">{t('Decision Revision Flow')}</h2>
                  <p className="font-bold text-brand-dark/65 mt-2">
                    {t(`${helpfulRevisionRate.toFixed(0)}% improved after revision, but ${harmfulRevisionRate.toFixed(0)}% reversed from correct to incorrect.`)}
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
          )}

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden h-full flex flex-col">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-brand-yellow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-dark/55 mb-2">{t('Student Map')}</p>
                  <h2 className="text-3xl font-black">{t('Student Pressure Scatter')}</h2>
                  <p className="font-bold text-brand-dark/65 mt-2">{t('Each dot is one student. X = accuracy, Y = stress. The quadrants show who is stable, pressured, or drifting out of control.')}</p>
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

        {showAdvancedPanels && (
          <>
        <section className="grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-purple text-white">
              <h2 className="text-3xl font-black">{t('Session Dynamics')}</h2>
              <p className="font-bold text-white/70 mt-2">{t('Question-by-question turning points for accuracy, stress, response time, and panic behavior.')}</p>
            </div>
            <div className="p-7">
              <ResearchLineChart rows={sequenceDynamics} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-6 lg:p-7 border-b-4 border-brand-dark bg-brand-yellow">
              <h2 className="text-3xl font-black">{t('Recovery Patterns')}</h2>
              <p className="font-bold text-brand-dark/65 mt-2">{t(recoverySummary)}</p>
            </div>
            <div className="p-6">
              <RecoveryPatternsChart rows={[...recoveryPatterns].sort((left, right) => Number(right.count || 0) - Number(left.count || 0))} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-white">
              <h2 className="text-3xl font-black">{t('Fatigue / Drift Timeline')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Rolling accuracy, response time, and hesitation across the run of the game.')}</p>
            </div>
            <div className="p-6">
              <FatigueTimelineChart rows={fatigueTimeline} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-bg">
              <h2 className="text-3xl font-black">{t('Deadline Dependency Curve')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Binned by remaining time, so you can see whether late decisions help or hurt.')}</p>
            </div>
            <div className="p-6">
              <DeadlineDependencyChart rows={deadlineCurve} />
            </div>
          </div>
        </section>

        <details className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] mb-8">
          <summary className="list-none cursor-pointer p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Deeper Read')}</p>
              <h2 className="text-3xl font-black">{t('Student drilldown and statistical detail')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Open this layer when you need richer student context, correlation reads, or the slower diagnostic charts below.')}</p>
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
              <h2 className="text-3xl font-black">{t('Descriptive Statistics')}</h2>
            </div>
            <p className="font-bold text-brand-dark/60 mb-6">{t('Mean, spread, and quartiles for the main instructional and behavioral signals in this session.')}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {descriptiveStats.map((metric: any) => (
                <div key={metric.id} className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(metric.label)}</p>
                      <p className="text-3xl font-black">
                        {metric.summary?.mean}
                        <span className="text-base ml-1">{metric.unit}</span>
                      </p>
                    </div>
                    <SignalPill label="Std Dev" value={metric.summary?.stddev ?? 0} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <h2 className="text-3xl font-black">{t('Correlation Lab')}</h2>
              </div>
              <div className="space-y-3">
                {correlations.map((correlation: any) => (
                  <div key={correlation.label} className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="font-black text-lg">{t(correlation.label)}</p>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{t(correlation.strength)} {t('signal')} · {t(correlation.direction)}</p>
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
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Selected Student')}</p>
                  <h2 className="text-3xl font-black">{selectedStudent?.nickname || t('No student selected')}</h2>
                </div>
                {selectedStudent && <RiskBadge level={selectedStudent.risk_level} />}
              </div>

              {selectedStudent ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <MiniMetric label="Accuracy" value={`${selectedStudent.accuracy.toFixed(0)}%`} />
                    <MiniMetric label="Stress" value={`${selectedStudent.stress_index.toFixed(0)}%`} />
                    <MiniMetric label="Confidence" value={`${selectedStudent.confidence_score || 0}`} />
                    <MiniMetric label="Focus" value={`${selectedStudent.focus_score || 0}`} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <MiniMetric label="1st Choice" value={`${Number(selectedStudent.first_choice_accuracy || 0).toFixed(0)}%`} />
                    <MiniMetric label="Recovery" value={`${Number(selectedStudent.recovery_rate || 0).toFixed(0)}%`} />
                    <MiniMetric label="Commit" value={formatMs(Number(selectedStudent.avg_commitment_latency_ms || 0))} />
                    <MiniMetric label="Stability" value={`${Number(selectedStudent.stability_score || 0).toFixed(0)}`} />
                  </div>
                  <p className="text-xl font-black text-brand-yellow mb-2">{t(selectedStudent.headline)}</p>
                  <p className="font-medium text-white/75 mb-5">{t(selectedStudent.body)}</p>

                  <div className="flex flex-wrap gap-2 mb-5">
                    {(selectedStudent.weak_tags || []).slice(0, 3).map((tag: string) => (
                      <span key={`weak-${tag}`} className="px-3 py-2 rounded-full bg-brand-orange text-white border-2 border-white/20 text-xs font-black capitalize">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="bg-white/10 rounded-2xl border border-white/15 p-4 mb-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-2">{t('Recommended move')}</p>
                    <p className="font-medium text-white/80">{t(selectedStudent.recommendation)}</p>
                  </div>

                  <button
                    onClick={() => navigate(`/teacher/analytics/class/${sessionId}/student/${selectedStudent.id}`)}
                    className="w-full px-5 py-4 bg-brand-yellow text-brand-dark border-2 border-brand-dark rounded-full font-black flex items-center justify-center gap-2"
                  >
                    {t('Open Personal Dashboard')}
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <p className="font-bold text-white/60">{t('No student data available.')}</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-white">
              <h2 className="text-3xl font-black">{t('Commitment Behavior')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('A histogram of commitment latency, so mean values do not hide different solving styles.')}</p>
            </div>
            <div className="p-6">
              <CommitmentDistributionChart rows={commitmentDistribution} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-[#d8f1ff]">
              <h2 className="text-3xl font-black">{t('Re-engagement Outcomes')}</h2>
              <p className="font-bold text-brand-dark/65 mt-2">{t('Whether quick or prolonged returns from blur actually hurt the class.')}</p>
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
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Supporting Analysis')}</p>
              <h2 className="text-3xl font-black">{t('Benchmarks, clusters, and deeper telemetry')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Open this layer when you want the fuller statistical context behind the main read.')}</p>
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
              <h2 className="text-3xl font-black">{t('Cohort Benchmarks')}</h2>
            </div>
            <div className="space-y-4">
              {Object.values(quartileBenchmarks).map((group: any) => (
                <div key={group.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-lg font-black">{t(group.label)}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{t(`${group.count} students`)}</p>
                    </div>
                    <div className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
                      {t(`${group.accuracy?.toFixed?.(1) ?? group.accuracy}% accuracy`)}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-sm font-black mb-2">
                            <span>{t('Stress')}</span>
                        <span>{group.stress_index}%</span>
                      </div>
                      <Bar value={Number(group.stress_index) || 0} tone={accuracyTone(100 - Number(group.stress_index || 0))} />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-sm font-black mb-2">
                            <span>{t('Focus')}</span>
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
              <h2 className="text-3xl font-black">{t('Behavior Research')}</h2>
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
                    <span className="capitalize">{t(row.label)}</span>
                    <span>{t(`${row.accuracy}% accuracy`)} · {t(`${row.count} rows`)}</span>
                  </div>
                  <Bar value={Number(row.accuracy) || 0} tone={accuracyTone(Number(row.accuracy) || 0)} />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-brand-yellow rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <Sparkles className="w-6 h-6 text-brand-orange" />
              <h2 className="text-3xl font-black">{t('Clusters and Outliers')}</h2>
            </div>
            <div className="space-y-4 mb-6">
              {clusters.map((cluster: any) => (
                <div key={cluster.id} className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-lg font-black">{t(cluster.label)}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{t(`${cluster.count} students`)}</p>
                    </div>
                    <div className="px-3 py-2 rounded-full border-2 border-brand-dark bg-brand-bg font-black">
                      {cluster.count}
                    </div>
                  </div>
                  <p className="font-medium text-brand-dark/70 mb-3">{t(cluster.description)}</p>
                  <p className="font-bold text-brand-dark/60">
                    {(cluster.students || []).slice(0, 4).map((student: any) => student.nickname).join(', ')}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {outliers.map((outlier: any, index: number) => (
                <div key={`${outlier.title}-${index}`} className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t(outlier.title)}</p>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-lg font-black">{outlier.label}</p>
                    <span className="px-3 py-1 rounded-full bg-brand-bg border-2 border-brand-dark font-black">{outlier.value}</span>
                  </div>
                  <p className="font-medium text-brand-dark/70">{t(outlier.body)}</p>
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
                  <h2 className="text-3xl font-black">{t('Team BI Board')}</h2>
                </div>
                <div className="space-y-4">
                  {teams.map((team: any) => (
                    <div key={team.team_id || team.team_name} className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(`Rank #${team.rank}`)}</p>
                          <p className="text-2xl font-black">{team.team_name}</p>
                          <p className="font-medium text-brand-dark/65">{t(`${team.student_count} students`)} · {t('Consensus')} {team.consensus_index}%</p>
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
                            <span>{t('Accuracy')}</span>
                            <span>{team.accuracy}%</span>
                          </div>
                          <Bar value={Number(team.accuracy) || 0} tone={accuracyTone(Number(team.accuracy) || 0)} />
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                            <span>{t('Consensus')}</span>
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
                <h2 className="text-3xl font-black">{t('Student Telemetry Table')}</h2>
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
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{t(student.team_name || 'Solo')} · {t(student.risk_level)}</p>
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
          </>
        )}

        <section className={`grid grid-cols-1 gap-8 mb-8 ${showAdvancedPanels ? 'xl:grid-cols-[0.95fr_1.05fr]' : ''}`}>
          {showAdvancedPanels && (
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <BrainCircuit className="w-6 h-6 text-brand-purple" />
                <h2 className="text-3xl font-black">{t('Concept Heatmap')}</h2>
              </div>
              <p className="font-bold text-brand-dark/60 mb-6">{t('These are the concept clusters that generated the weakest outcomes across the class.')}</p>
              <div className="space-y-4">
                {topGapTags.map((tag: any) => (
                  <div key={tag.tag} className="bg-brand-bg rounded-2xl border-2 border-brand-dark p-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t('Concept')}</p>
                        <p className="text-2xl font-black capitalize">{tag.tag}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-black">{tag.accuracy.toFixed(0)}%</p>
                        <p className="text-xs font-bold text-brand-dark/50">{t(`${tag.students_count ?? tag.attempts ?? 0} students touched this topic`)}</p>
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
          )}

          <div className={`grid grid-cols-1 gap-6 ${showAdvancedPanels ? 'lg:grid-cols-2' : ''}`}>
            <div className="bg-brand-yellow rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <AlertTriangle className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{t('Teacher Alerts')}</h2>
              </div>
              <div className="space-y-4">
                {alertList.length > 0 ? alertList.map((alert: any, index: number) => (
                  <div key={`${alert.type}-${index}`} className="bg-white rounded-2xl border-2 border-brand-dark p-4 shadow-[3px_3px_0px_0px_#1A1A1A]">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full border-2 border-brand-dark flex items-center justify-center ${alert.type === 'focus' ? 'bg-brand-purple text-white' : alert.type === 'mastery' ? 'bg-brand-dark text-brand-yellow' : 'bg-brand-orange text-white'}`}>
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-lg leading-tight mb-1">{t(alert.title)}</p>
                        <p className="font-medium text-brand-dark/70">{t(alert.body)}</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="font-bold text-brand-dark/60">{t('No urgent class-level alerts were produced for this session.')}</p>
                )}
              </div>
            </div>

            {showAdvancedPanels && (
              <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
                <div className="flex items-center gap-3 mb-5">
                  <BarChart3 className="w-6 h-6 text-brand-dark" />
                  <h2 className="text-3xl font-black">{t('Signal Distribution')}</h2>
                </div>
                <DistributionGroup title="Accuracy bands" items={accuracyDistribution} />
                <DistributionGroup title="Stress bands" items={stressDistribution} />
                <DistributionGroup title="Risk bands" items={riskDistribution} />
              </div>
            )}
          </div>
        </section>

        <section id="teacher-board-questions" className="scroll-mt-40 bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden mb-8">
          <div className="p-7 border-b-4 border-brand-dark bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black">{t('Question Diagnostics')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('Open with the hardest items first. The rest stay tucked behind a single click so the page keeps its hierarchy.')}</p>
            </div>
            {showAdvancedPanels && (
              <button
                onClick={() => downloadCsv(`${exportBaseName}-question-diagnostics.csv`, questionCsvRows)}
                className="w-fit px-5 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <Download className="w-4 h-4" />
                {t('Export Diagnostics CSV')}
              </button>
            )}
          </div>

          <div className="px-6 pt-6">
            <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-4 lg:p-5">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                <AnalyticsSearchField
                  value={questionSearch}
                  onChange={setQuestionSearch}
                  placeholder="Search a question, tag, distractor, or objective"
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    ['teach-now', 'Teach Now'],
                    ['low-accuracy', 'Low Accuracy'],
                    ['high-stress', 'High Stress'],
                    ['distractor', 'Distractor'],
                    ['all', 'All Questions'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setQuestionFilter(value as typeof questionFilter)}
                      className={`px-4 py-2 rounded-full border-2 border-brand-dark text-sm font-black transition-colors ${
                        questionFilter === value ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'
                      }`}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="font-bold text-brand-dark/60 mt-3">
                {showAdvancedPanels
                  ? t(`Showing ${filteredQuestionDiagnostics.length} of ${questionDiagnostics.length} questions in the triage view.`)
                  : t(`Simple view keeps ${visibleQuestionDiagnostics.length} highest-priority questions open out of ${filteredQuestionDiagnostics.length} matches.`)}
              </p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-5">
            {visibleQuestionDiagnostics.map((question: any) => (
              <div key={question.question_id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(`Question ${question.question_index}`)}</p>
                    <p className="text-xl font-black leading-tight mb-3">{question.question_prompt}</p>
                    <div className="mb-3">
                      <AnalyticsBadge
                        label={getQuestionPrioritySignal(question).label}
                        tone={getQuestionPrioritySignal(question).tone}
                      />
                    </div>
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
                    <SignalPill label="Discrimination" value={`${question.discrimination_index.toFixed(0)} pts`} tone={question.discrimination_index >= 30 ? 'good' : question.discrimination_index >= 10 ? 'mid' : 'bad'} />
                    <SignalPill label="Stress" value={`${question.stress_index.toFixed(0)}%`} tone={riskTone(question.stress_index >= 70 ? 'high' : question.stress_index >= 40 ? 'medium' : 'low')} />
                    <SignalPill label="Response" value={formatMs(Number(question.avg_response_ms || 0))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                        <span>{t('Accuracy')}</span>
                      <span>{question.accuracy}%</span>
                    </div>
                    <Bar value={question.accuracy} tone={accuracyTone(question.accuracy)} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                        <span>{t('Top vs Bottom Gap')}</span>
                      <span>{t(`${question.discrimination_index} pts`)}</span>
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
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('Top distractor')}</p>
                    {question.top_distractor ? (
                      <>
                        <p className="font-black text-lg mb-1">
                          {question.top_distractor.label}. {question.top_distractor.text}
                        </p>
                        <p className="font-medium text-brand-dark/70">
                          {t(`${Number(question.top_distractor.rate || 0).toFixed(1)}% of students were pulled here.`)}
                          {' '}
                          {t(`Deadline dependency on this item was ${Number(question.deadline_dependency_rate || 0).toFixed(1)}%.`)}
                        </p>
                      </>
                    ) : (
                      <p className="font-medium text-brand-dark/70">
                        {t('No single wrong option emerged as a dominant misconception on this question.')}
                      </p>
                    )}
                  </div>
                  <div className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-3">{t('Choice distribution')}</p>
                    <ChoiceDistributionSparkline
                      choices={question.choice_distribution || []}
                      highlightLabel={question.top_distractor?.label}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredQuestionDiagnostics.length === 0 && (
            <div className="px-6 pb-6">
              <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-6">
                <p className="text-xl font-black">{t('No questions matched this triage view')}</p>
                <p className="font-medium text-brand-dark/70 mt-2">
                  {t('Try widening the search or switching back to all questions to restore the full board.')}
                </p>
              </div>
            </div>
          )}

          {hiddenQuestionDiagnostics.length > 0 && (
            <div className="px-6 pb-6">
              <details className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                <summary className="list-none cursor-pointer flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black">{t(`Show ${hiddenQuestionDiagnostics.length} more question diagnostics`)}</p>
                    <p className="font-medium text-brand-dark/65">
                      {showAdvancedPanels
                        ? t('Keep the top trouble spots visible by default, and open the rest only when you need item-level follow-up.')
                        : t('Simple view keeps only the most urgent question cards expanded so the triage stays fast.')}
                    </p>
                  </div>
                  <ChevronDown className="w-5 h-5 shrink-0" />
                </summary>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
                  {hiddenQuestionDiagnostics.map((question: any) => (
                    <div key={`extra-${question.question_id}`} className="rounded-[1.75rem] border-2 border-brand-dark bg-white p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(`Question ${question.question_index}`)}</p>
                          <p className="text-xl font-black leading-tight mb-3">{question.question_prompt}</p>
                          <div className="mb-3">
                            <AnalyticsBadge
                              label={getQuestionPrioritySignal(question).label}
                              tone={getQuestionPrioritySignal(question).tone}
                            />
                          </div>
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
                          ? t(`${Number(question.top_distractor.rate || 0).toFixed(0)}% were pulled to distractor ${question.top_distractor.label}.`)
                          : t('No single distractor dominated this item.')}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>

        {showAdvancedPanels && (
          <section className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden mb-8">
            <div className="p-7 border-b-4 border-brand-dark bg-white">
              <h2 className="text-3xl font-black">{t('Distractor Heatmap')}</h2>
              <p className="font-bold text-brand-dark/60 mt-2">{t('See whether errors are scattered or whether the same distractors are repeatedly seducing the class.')}</p>
            </div>
            <div className="p-6">
              <DistractorHeatmapChart heatmap={distractorHeatmap} />
            </div>
          </section>
        )}

        <section className={`grid grid-cols-1 gap-8 mb-8 ${showAdvancedPanels ? 'xl:grid-cols-[1.1fr_0.9fr]' : ''}`}>
          {showAdvancedPanels && (
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
              <div className="p-7 border-b-4 border-brand-dark bg-brand-purple text-white">
                <h2 className="text-3xl font-black">{t('Question Pressure Map')}</h2>
                <p className="font-bold text-white/70 mt-2">{t('Every item is scored on both mastery and behavioral pressure.')}</p>
              </div>
              <div className="p-6 space-y-4">
                {questionRows.map((question: any) => (
                  <div key={question.id} className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(`Question ${question.index}`)}</p>
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
                    <p className="font-medium text-brand-dark/70 mt-3">{t(question.recommendation)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
              <div className="flex items-center gap-3 mb-5">
                <Sparkles className="w-6 h-6 text-brand-orange" />
                <h2 className="text-3xl font-black">{t('Attention Queue')}</h2>
              </div>
              <div className="space-y-3">
                {attentionQueue.slice(0, 5).length > 0 ? (
                  attentionQueue.slice(0, 5).map((student: any) => (
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
                      <p className="font-medium text-brand-dark/70">{t(student.recommendation)}</p>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="font-black">{t('No student queue has been produced yet.')}</p>
                    <p className="font-medium text-brand-dark/70 mt-2">
                      {t('The page is already simplified for a fast teaching read.')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {showAdvancedPanels && (
              <div className="bg-brand-dark text-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] p-7">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{t('Data Pack')}</p>
                <h2 className="text-3xl font-black mb-3">{t('Research export ready')}</h2>
                <p className="font-medium text-white/75 mb-5">
                  {t('Exported response rows include timing, swaps, focus-loss, commit window, volatility, and question metadata so the session can be reused later for statistical analysis.')}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <MiniMetric label="Rows" value={compactNumber.format(researchRows.length || 0)} />
                  <MiniMetric label="Questions" value={`${questionDiagnostics.length}`} />
                  <MiniMetric label="Students" value={`${participants.length}`} />
                </div>
              </div>
            )}
          </div>
        </section>

        <section id="teacher-board-students-list" className="scroll-mt-40 bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
          <div className="p-7 border-b-4 border-brand-dark bg-white">
            <h2 className="text-3xl font-black">{t('Student Command Center')}</h2>
            <p className="font-bold text-brand-dark/60 mt-2">{t('Select a student for quick insight, then drill into the personal dashboard to build a same-material follow-up game.')}</p>
          </div>

          <div className="px-6 pt-6">
            <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-4 lg:p-5">
              <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                <AnalyticsSearchField
                  value={studentSearch}
                  onChange={setStudentSearch}
                  placeholder="Search by student, weak topic, decision style, or recommendation"
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    ['all', 'All Students'],
                    ['attention', 'Attention Queue'],
                    ['high-risk', 'High Risk'],
                    ['fatigue', 'Fatigue'],
                    ['low-accuracy', 'Low Accuracy'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setStudentFilter(value as typeof studentFilter)}
                      className={`px-4 py-2 rounded-full border-2 border-brand-dark text-sm font-black transition-colors ${
                        studentFilter === value ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'
                      }`}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="font-bold text-brand-dark/60 mt-3">
                {showAdvancedPanels
                  ? t(`Showing ${filteredParticipants.length} of ${prioritizedParticipants.length} students in the command center.`)
                  : t(`Simple view keeps ${visibleStudentCards.length} students open out of ${filteredParticipants.length} matches.`)}
              </p>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {visibleStudentCards.map((student: any) => (
              <button
                key={student.id}
                onMouseEnter={() => setSelectedStudentId(Number(student.id))}
                onFocus={() => setSelectedStudentId(Number(student.id))}
                onClick={() => openStudentDashboard(student.id)}
                className={`text-left rounded-[1.75rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A] transition-transform hover:-translate-y-1 ${Number(selectedStudent?.id) === Number(student.id) ? 'bg-brand-yellow' : 'bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{t(`Rank #${student.rank}`)}</p>
                    <h3 className="text-2xl font-black">{student.nickname}</h3>
                    <p className="font-bold text-brand-dark/60">{t(student.decision_style)}</p>
                    <div className="mt-3">
                      <AnalyticsBadge
                        label={getStudentPrioritySignal(student, attentionOrder.has(Number(student.id))).label}
                        tone={getStudentPrioritySignal(student, attentionOrder.has(Number(student.id))).tone}
                      />
                    </div>
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

                <p className="font-medium text-brand-dark/70 mb-4 min-h-[72px]">{t(student.recommendation)}</p>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-brand-purple">{t('Open individual dashboard')}</span>
                  <div className="w-10 h-10 rounded-full bg-brand-dark text-white border-2 border-brand-dark flex items-center justify-center">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {hiddenStudentCards.length > 0 && (
            <div className="px-6 pb-6">
              <details className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-5">
                <summary className="list-none cursor-pointer flex items-center justify-between gap-3">
                  <div>
                    <p className="font-black">{t(`Show ${hiddenStudentCards.length} more students`)}</p>
                    <p className="font-medium text-brand-dark/65">{t('Simple view keeps the highest-priority student cards expanded and tucks the rest into a lighter roster.')}</p>
                  </div>
                  <ChevronDown className="w-5 h-5 shrink-0" />
                </summary>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-5">
                  {hiddenStudentCards.map((student: any) => (
                    <button
                      key={`hidden-student-${student.id}`}
                      onMouseEnter={() => setSelectedStudentId(Number(student.id))}
                      onFocus={() => setSelectedStudentId(Number(student.id))}
                      onClick={() => openStudentDashboard(student.id)}
                      className="rounded-[1.35rem] border-2 border-brand-dark bg-white p-4 text-left transition-colors hover:bg-brand-yellow/30"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="font-black text-lg leading-tight">{student.nickname}</p>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45 mt-1">
                            {t(`Rank #${student.rank}`)} • {t(student.decision_style)}
                          </p>
                        </div>
                        <RiskBadge level={student.risk_level} compact />
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <SignalPill label="Accuracy" value={`${student.accuracy.toFixed(0)}%`} tone={accuracyTone(student.accuracy)} />
                        <SignalPill label="Stress" value={`${student.stress_index.toFixed(0)}%`} tone={student.stress_level} />
                      </div>
                      {(student.weak_tags || []).slice(0, 2).length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {(student.weak_tags || []).slice(0, 2).map((tag: string) => (
                            <span key={`hidden-${student.id}-${tag}`} className="px-3 py-1 rounded-full bg-brand-orange/10 border-2 border-brand-dark text-xs font-black capitalize">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="font-medium text-brand-dark/70">{t(student.recommendation)}</p>
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}

          {filteredParticipants.length === 0 && (
            <div className="px-6 pb-6">
              <div className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-6">
                <p className="text-xl font-black">{t('No students matched this filter')}</p>
                <p className="font-medium text-brand-dark/70 mt-2">
                  {t('Try another student segment or clear the search to bring the full roster back.')}
                </p>
              </div>
            </div>
          )}
        </section>

        {!showAdvancedPanels && simpleViewPreviewCards.length > 0 && (
          <section className="mb-10">
            <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6 lg:p-7">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('Full View Preview')}</p>
                  <h2 className="text-3xl font-black">{t('Keep the board light, then open deeper tools only when needed')}</h2>
                  <p className="font-bold text-brand-dark/60 mt-2 max-w-3xl">
                    {t('Simple view hides heavier operational tools until you ask for them. These previews preserve the signal without forcing every module onto the page at once.')}
                  </p>
                </div>
                <button
                  onClick={() => openAdvancedView()}
                  className="w-fit rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white"
                >
                  {t('Open full analytics')}
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {simpleViewPreviewCards.map((card) => (
                  <React.Fragment key={card.id}>
                    <SimpleModePreviewCard
                      label={card.label}
                      title={card.title}
                      body={card.body}
                      badge={card.badge}
                      onClick={() => openAdvancedView(card.targetId)}
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function WorkflowActionCard({
  step,
  label,
  title,
  body,
  tone,
  actionLabel,
  onAction,
}: {
  step: string;
  label: string;
  title: string;
  body: string;
  tone: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const isDarkTone = tone.includes('text-white');

  return (
    <div className={`rounded-[1.5rem] border-2 border-brand-dark p-4 flex h-full flex-col ${tone}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${isDarkTone ? 'text-white/70' : 'text-brand-dark/55'}`}>{t(step)}</p>
          <p className={`text-xs font-black uppercase tracking-[0.18em] mt-2 ${isDarkTone ? 'text-white/80' : 'text-brand-purple'}`}>{t(label)}</p>
        </div>
        <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 ${isDarkTone ? 'border-white/20 bg-white/10 text-white' : 'border-brand-dark bg-white text-brand-dark'}`}>
          <CheckCircle2 className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-black leading-tight">{t(title)}</p>
      <p className={`font-medium mt-3 flex-1 ${isDarkTone ? 'text-white/78' : 'text-brand-dark/72'}`}>{t(body)}</p>
      <button
        onClick={onAction}
        className={`mt-4 w-full rounded-full border-2 px-4 py-3 font-black transition-transform hover:-translate-y-0.5 ${isDarkTone ? 'border-white bg-white text-brand-dark' : 'border-brand-dark bg-brand-dark text-white'}`}
      >
        {t(actionLabel)}
      </button>
    </div>
  );
}

function OfficeHoursInviteCard({
  nickname,
  riskLevel,
  accuracy,
  reason,
  focusTags,
  copied,
  onCopy,
  onOpen,
}: {
  nickname: string;
  riskLevel: string;
  accuracy: number;
  reason: string;
  focusTags: string[];
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-lg font-black">{nickname}</p>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/45">
            {t(`${riskLevel} risk`)} • {accuracy.toFixed(0)}% {t('accuracy')}
          </p>
        </div>
        <button
          onClick={onCopy}
          className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black inline-flex items-center gap-2"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? t('Copied') : t('Copy invite')}
        </button>
      </div>
      <p className="font-medium text-brand-dark/72">{t(reason)}</p>
      {focusTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {focusTags.map((tag) => (
            <span key={`${nickname}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
              {tag}
            </span>
          ))}
        </div>
      )}
      <button
        onClick={onOpen}
        className="mt-4 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black"
      >
        {t('Open student dashboard')}
      </button>
    </div>
  );
}

function RecoveryBuilderCard({
  label,
  body,
  count,
  busy,
  onBuild,
}: {
  label: string;
  body: string;
  count: number;
  busy: boolean;
  onBuild: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t(label)}</p>
          <p className="text-lg font-black">{count} {t('students ready')}</p>
        </div>
        <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black">
          {count}
        </span>
      </div>
      <p className="font-medium text-brand-dark/72">{t(body)}</p>
      <button
        onClick={onBuild}
        disabled={busy}
        className="mt-4 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-2 text-sm font-black text-white disabled:opacity-60"
      >
        {busy ? t('Building...') : t('Build personal games')}
      </button>
    </div>
  );
}

function SessionReplayCard({
  questionIndex,
  prompt,
  signal,
  tone,
  accuracy,
  stress,
  responseMs,
  move,
  distractorLabel,
  distractorRate,
  onOpen,
}: {
  questionIndex: number;
  prompt: string;
  signal: string;
  tone: 'good' | 'mid' | 'bad';
  accuracy: number;
  stress: number;
  responseMs: number;
  move: string;
  distractorLabel: string | null;
  distractorRate: number;
  onOpen: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass = tone === 'bad' ? 'bg-brand-orange/10' : tone === 'mid' ? 'bg-brand-yellow/25' : 'bg-emerald-100';

  return (
    <div className={`rounded-[1.6rem] border-2 border-brand-dark p-5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t(`Question ${questionIndex}`)}</p>
          <p className="text-xl font-black leading-tight">{prompt}</p>
        </div>
        <AnalyticsBadge label={signal} tone={tone} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <SignalPill label="Accuracy" value={`${accuracy.toFixed(0)}%`} tone={accuracyTone(accuracy)} />
        <SignalPill label="Stress" value={`${stress.toFixed(0)}%`} tone={riskTone(stress >= 70 ? 'high' : stress >= 45 ? 'medium' : 'low')} />
        <SignalPill label="Response" value={formatMs(responseMs)} />
      </div>

      {distractorLabel && (
        <p className="font-bold text-brand-dark/70 mb-3">
          {t(`Distractor ${distractorLabel} pulled ${distractorRate.toFixed(0)}% of the class.`)}
        </p>
      )}

      <p className="font-medium text-brand-dark/72">{t(move)}</p>

      <button
        onClick={onOpen}
        className="mt-4 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black"
      >
        {t('Open question triage')}
      </button>
    </div>
  );
}

function QuickNavCard({
  label,
  body,
  onClick,
}: {
  label: string;
  body: string;
  onClick: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();

  return (
    <button
      onClick={onClick}
      className="rounded-[1.35rem] border-2 border-brand-dark bg-brand-bg p-4 text-left transition-colors hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-purple">{t(label)}</p>
        <ArrowUpRight className="w-4 h-4 shrink-0" />
      </div>
      <p className="font-medium text-brand-dark/72 leading-relaxed">{t(body)}</p>
    </button>
  );
}

function SimpleModePreviewCard({
  label,
  title,
  body,
  badge,
  onClick,
}: {
  label: string;
  title: string;
  body: string;
  badge: string;
  onClick: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();

  return (
    <button
      onClick={onClick}
      className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5 text-left transition-colors hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple">{t(label)}</p>
          <p className="text-xl font-black leading-tight mt-2">{t(title)}</p>
        </div>
        <span className="shrink-0 rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-xs font-black">
          {t(badge)}
        </span>
      </div>
      <p className="font-medium text-brand-dark/72">{t(body)}</p>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black">
        {t('Open in full view')}
        <ArrowUpRight className="w-4 h-4" />
      </div>
    </button>
  );
}

function ActionQueueCard({
  label,
  title,
  body,
  metricLabel,
  metricValue,
  tone,
  actionLabel,
  onAction,
}: {
  label: string;
  title: string;
  body: string;
  metricLabel: string;
  metricValue: string;
  tone: 'bad' | 'mid' | 'good';
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClasses =
    tone === 'bad'
      ? 'bg-brand-yellow text-brand-dark'
      : tone === 'mid'
        ? 'bg-white text-brand-dark'
        : 'bg-[#d8f1ff] text-brand-dark';

  return (
    <div className={`rounded-[1.6rem] border-2 border-white/15 p-5 ${toneClasses}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] opacity-65">{t(label)}</p>
          <p className="text-2xl font-black leading-tight mt-2">{t(title)}</p>
        </div>
        <div className="rounded-[1rem] border-2 border-brand-dark bg-white px-3 py-2 text-right">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(metricLabel)}</p>
          <p className="text-lg font-black">{t(metricValue)}</p>
        </div>
      </div>
      <p className="font-medium opacity-80">{t(body)}</p>
      <button
        onClick={onAction}
        className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white transition-transform hover:-translate-y-0.5"
      >
        {t(actionLabel)}
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function PlaybookStepCard({
  label,
  title,
  body,
  tone,
  actionLabel,
  onAction,
}: {
  label: string;
  title: string;
  body: string;
  tone: 'bad' | 'mid' | 'good';
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass =
    tone === 'bad'
      ? 'bg-brand-yellow'
      : tone === 'mid'
        ? 'bg-brand-bg'
        : 'bg-[#d8f1ff]';

  return (
    <div className={`${toneClass} rounded-[1.5rem] border-2 border-brand-dark p-5 flex h-full flex-col`}>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t(label)}</p>
      <p className="text-2xl font-black leading-tight">{t(title)}</p>
      <p className="font-medium text-brand-dark/72 mt-3 flex-1">{t(body)}</p>
      <button
        onClick={onAction}
        className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white transition-transform hover:-translate-y-0.5"
      >
        {t(actionLabel)}
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function CohortCard({
  label,
  title,
  body,
  tone,
  count,
  names,
  focusTags,
  actionLabel,
  onAction,
}: {
  label: string;
  title: string;
  body: string;
  tone: 'bad' | 'mid' | 'good';
  count: number;
  names: string[];
  focusTags: string[];
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass =
    tone === 'bad'
      ? 'bg-brand-yellow'
      : tone === 'mid'
        ? 'bg-brand-bg'
        : 'bg-emerald-50';

  return (
    <div className={`${toneClass} rounded-[1.5rem] border-2 border-brand-dark p-5`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t(label)}</p>
          <p className="text-xl font-black leading-tight">{t(title)}</p>
        </div>
        <div className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-sm font-black shrink-0">
          {count}
        </div>
      </div>
      <p className="font-medium text-brand-dark/72">{t(body)}</p>
      {focusTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {focusTags.map((tag) => (
            <span key={`${label}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
              {t(tag)}
            </span>
          ))}
        </div>
      )}
      {names.length > 0 && (
        <p className="font-bold text-brand-dark/60 mt-4">
          {t('Example students')}: {names.join(', ')}
        </p>
      )}
      <button
        onClick={onAction}
        className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-5 py-3 font-black transition-transform hover:-translate-y-0.5"
      >
        {t(actionLabel)}
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function PivotMomentCard({
  title,
  body,
  metricLabel,
  metricValue,
  tone,
  onAction,
}: {
  title: string;
  body: string;
  metricLabel: string;
  metricValue: string;
  tone: 'bad' | 'mid';
  onAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass = tone === 'bad' ? 'bg-brand-orange/10' : 'bg-brand-bg';

  return (
    <div className={`${toneClass} rounded-[1.5rem] border-2 border-brand-dark p-5`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-xl font-black leading-tight">{t(title)}</p>
          <p className="font-medium text-brand-dark/72 mt-2">{t(body)}</p>
        </div>
        <div className="rounded-[1rem] border-2 border-brand-dark bg-white px-3 py-2 text-right shrink-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(metricLabel)}</p>
          <p className="text-lg font-black">{t(metricValue)}</p>
        </div>
      </div>
      <button
        onClick={onAction}
        className="inline-flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-5 py-3 font-black transition-transform hover:-translate-y-0.5"
      >
        {t('Open this question')}
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function ConceptClinicCard({
  concept,
  title,
  body,
  studentCount,
  tone,
  onStudentAction,
  onQuestionAction,
}: {
  concept: string;
  title: string;
  body: string;
  studentCount: number;
  tone: 'bad' | 'mid';
  onStudentAction: () => void;
  onQuestionAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass = tone === 'bad' ? 'bg-brand-yellow' : 'bg-brand-bg';

  return (
    <div className={`${toneClass} rounded-[1.5rem] border-2 border-brand-dark p-5 flex h-full flex-col`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t(concept)}</p>
          <p className="text-xl font-black leading-tight">{t(title)}</p>
        </div>
        <div className="rounded-full border-2 border-brand-dark bg-white px-3 py-2 text-sm font-black shrink-0">
          {studentCount}
        </div>
      </div>
      <p className="font-medium text-brand-dark/72 flex-1">{t(body)}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={onStudentAction}
          className="rounded-full border-2 border-brand-dark bg-white px-5 py-3 text-sm font-black whitespace-nowrap transition-transform hover:-translate-y-0.5 sm:text-base"
        >
          {t('See matching students')}
        </button>
        <button
          onClick={onQuestionAction}
          className="rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 text-sm font-black whitespace-nowrap text-white transition-transform hover:-translate-y-0.5 sm:text-base"
        >
          {t('Open matching questions')}
        </button>
      </div>
    </div>
  );
}

function PeerTutorMatchCard({
  tutorName,
  learnerName,
  overlap,
  onTutorAction,
  onLearnerAction,
}: {
  tutorName: string;
  learnerName: string;
  overlap: string[];
  onTutorAction: () => void;
  onLearnerAction: () => void;
}) {
  const { t } = useTeacherAnalyticsLanguage();

  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-purple mb-2">{t('Pair suggestion')}</p>
      <p className="text-xl font-black leading-tight">
        {t(tutorName)} {t('can support')} {t(learnerName)}
      </p>
      <p className="font-medium text-brand-dark/72 mt-2">
        {t('Shared concept focus')}: {overlap.map((tag) => t(tag)).join(', ')}
      </p>
      <div className="flex flex-wrap gap-2 mt-4">
        {overlap.map((tag) => (
          <span key={`${tutorName}-${learnerName}-${tag}`} className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black capitalize">
            {t(tag)}
          </span>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          onClick={onLearnerAction}
          className="flex-1 rounded-full border-2 border-brand-dark bg-brand-dark px-4 py-3 font-black text-white transition-transform hover:-translate-y-0.5"
        >
          {t('Open learner dashboard')}
        </button>
        <button
          onClick={onTutorAction}
          className="flex-1 rounded-full border-2 border-brand-dark bg-white px-4 py-3 font-black transition-transform hover:-translate-y-0.5"
        >
          {t('Open tutor dashboard')}
        </button>
      </div>
    </div>
  );
}

function AnalyticsSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const { direction, isRtl, t } = useTeacherAnalyticsLanguage();

  return (
    <label className="relative block flex-1 min-w-0 sm:min-w-[260px]">
      <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-brand-dark/45 ${isRtl ? 'right-4' : 'left-4'}`} />
      <input
        dir={direction}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t(placeholder)}
        className={`w-full rounded-full border-2 border-brand-dark bg-white py-3 font-bold outline-none transition-colors focus:bg-brand-bg ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}
      />
    </label>
  );
}

function AnalyticsBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'bad' | 'mid' | 'good';
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const classes =
    tone === 'bad'
      ? 'bg-brand-orange text-white border-brand-dark'
      : tone === 'mid'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : 'bg-emerald-100 text-emerald-900 border-brand-dark';

  return (
    <span className={`inline-flex items-center rounded-full border-2 px-3 py-1 text-xs font-black ${classes}`}>
      {t(label)}
    </span>
  );
}

function ResearchLineChart({ rows }: { rows: any[] }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{t('No sequence data available for this session.')}</p>;
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
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-2">{t(point.label)}</p>
                <p className="font-black leading-tight">{t(point.title)}</p>
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
            <p className="font-medium text-sm text-brand-dark/68">{t(point.body)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mb-5">
        <LegendSwatch label="Accuracy" color="bg-brand-purple" />
        <LegendSwatch label="Stress" color="bg-brand-orange" />
        <LegendSwatch label="Response Bars" color="bg-brand-yellow" />
      </div>
      <div className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full min-w-[540px] sm:h-[300px] sm:min-w-[620px]">
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
  const { t } = useTeacherAnalyticsLanguage();
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

            <text x={width / 2} y={height - 2} textAnchor="middle" fontSize="12" fontWeight="900" fill="#1A1A1A">{t('Accuracy')}</text>
            <text x={18} y={height / 2} textAnchor="middle" fontSize="12" fontWeight="900" fill="#1A1A1A" transform={`rotate(-90 18 ${height / 2})`}>{t('Stress')}</text>

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
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 mb-1">{t('Selected student')}</p>
              <p className="text-xl font-black">{selectedStudent.nickname}</p>
            </div>
            <RiskBadge level={selectedStudent.risk_level} compact />
          </div>
          <p className="font-medium text-sm text-brand-dark/68">
            {t(`${selectedStudent.accuracy.toFixed(0)}% accuracy at ${selectedStudent.stress_index.toFixed(0)}% stress. Click the dot again to open the individual dashboard.`)}
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
  const { t } = useTeacherAnalyticsLanguage();
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
        <div style={{ fontSize: '10px', fontWeight: 900, lineHeight: 1.1 }}>{t(title)}</div>
        <div style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1.1, opacity: 0.72 }}>{t(body)}</div>
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
  const { t } = useTeacherAnalyticsLanguage();
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
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 leading-tight">{t(label)}</p>
        <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black ${toneClass}`}>{value}</span>
      </div>
      <p className="font-medium text-sm text-brand-dark/68 leading-snug">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="mb-5 max-w-4xl">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-purple mb-2">{t(eyebrow)}</p>
      <h2 className="text-3xl lg:text-[2.35rem] font-black tracking-tight leading-tight">{t(title)}</h2>
      <p className="font-bold text-brand-dark/62 mt-2">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className={`${accent} rounded-[1.6rem] border-2 border-brand-dark p-4 shadow-[4px_4px_0px_0px_#1A1A1A]`}>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] opacity-70 mb-2">{t(label)}</p>
      <p className="text-lg font-black leading-tight">{t(title)}</p>
      <p className="font-medium text-sm opacity-80 mt-2">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
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
      <span className="opacity-55">{t(label)}</span>
      <span>{typeof value === 'string' ? t(value) : value}</span>
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
  const { t } = useTeacherAnalyticsLanguage();
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
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/50 mr-1">{t(label)}</p>
            {label.toLowerCase().includes('quality') && <InfoTooltip metricId="decision-quality" />}
            {label.toLowerCase().includes('stability') && <InfoTooltip metricId="confidence-stability" />}
            {label.toLowerCase().includes('efficiency') && <InfoTooltip metricId="revision-efficiency" />}
          </div>
          <p className="font-black leading-tight">{t(title)}</p>
        </div>
        <div className={`w-10 h-10 shrink-0 rounded-full border-2 border-brand-dark flex items-center justify-center ${badgeClass}`}>
          {tone === 'good' ? <CheckCircle2 className="w-4 h-4" /> : tone === 'mid' ? <TrendingUp className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        </div>
      </div>
      <p className="font-medium text-sm text-brand-dark/70">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
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
          <p className="font-black leading-tight">{t(title)}</p>
          <p className="font-medium text-sm text-brand-dark/68 mt-1">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
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
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/45 max-w-[11rem] leading-tight">{t(label)}</p>
          {label.toLowerCase().includes('positive') && <InfoTooltip metricId="revision-efficiency" />}
          {label.toLowerCase().includes('harmful') && <InfoTooltip metricId="harmful-revisions" />}
        </div>
        <span className={`shrink-0 rounded-full border-2 border-brand-dark px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${badgeClass}`}>
          {rate.toFixed(0)}%
        </span>
      </div>
      <p className="text-[2rem] font-black leading-none">{compactNumber.format(count)}</p>
      <p className="font-medium text-sm text-brand-dark/68 mt-2">{t('of all response rows followed this path.')}</p>
    </div>
  );
}

function MetricCard({
  metricId,
  icon,
  title,
  value,
  status,
  note,
  color,
  textColor = 'text-brand-dark',
}: {
  metricId?: string;
  icon: React.ReactNode;
  title: string;
  value: string | number;
  status: string;
  note: string;
  color: string;
  textColor?: string;
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const accentClasses = `${color} ${textColor}`;

  return (
    <div className="rounded-[1.75rem] border-4 border-brand-dark bg-white p-5 shadow-[6px_6px_0px_0px_#1A1A1A]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-black uppercase tracking-[0.15em] text-brand-dark/55">{t(title)}</p>
            <InfoTooltip metricId={metricId || title.toLowerCase().replace(/\s+/g, '-')} />
          </div>
        </div>
        <div className={`${accentClasses} w-11 h-11 shrink-0 rounded-[1rem] border-2 border-brand-dark flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <p className="text-4xl font-black leading-none text-brand-dark">{value}</p>
      <div className="mt-3 inline-flex max-w-full">
        <span className={`${accentClasses} rounded-full border-2 border-brand-dark px-3 py-2 text-xs font-black`}>
          {t(status)}
        </span>
      </div>
      <p className="font-medium text-sm text-brand-dark/72 mt-3">{t(note)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
  if (!choices.length) {
    return <p className="font-bold text-brand-dark/55">{t('No choice-distribution data available.')}</p>;
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
                title={t(`${choice.label}: ${choice.count} students`)}
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.15rem] border-2 border-brand-dark bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/42 mb-1">{t(title)}</p>
      <p className="font-black text-sm leading-tight">{t(body)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.15rem] border-2 border-brand-dark bg-white px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-3.5 h-3.5 rounded-full border-2 border-brand-dark ${color}`} />
        <p className="font-black text-sm">{t(label)}</p>
      </div>
      <p className="font-medium text-xs text-brand-dark/65 leading-snug">{t(body)}</p>
    </div>
  );
}

function DecisionRevisionFlowChart({ flow }: { flow: any }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!flow?.total) {
    return <p className="font-bold text-brand-dark/60">{t('No revision-flow data available yet.')}</p>;
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
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[760px] sm:min-w-[980px] h-auto" style={{ overflow: 'visible' }}>
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
                {t(columnIndex === 0 ? 'First Choice' : columnIndex === 1 ? 'Revision' : 'Final Answer')}
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
                      {t(node.tone === 'good' ? 'Strong path' : node.tone === 'mid' ? 'Watch path' : 'Risk path')}
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 900, lineHeight: 1.05, wordBreak: 'break-word' }}>
                      {t(node.label)}
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
                      ? t('A stronger instructional checkpoint.')
                      : node.tone === 'mid'
                        ? t('Needs context to know whether the change helped.')
                        : t('This path deserves the fastest teacher response.')}
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
  const { t } = useTeacherAnalyticsLanguage();
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  if (!total) {
    return <p className="font-bold text-brand-dark/60">{t('No recovery transitions were available for this session.')}</p>;
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
            title={t(`${row.label}: ${row.count}`)}
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
                  <p className="font-black leading-tight">{t(row.label)}</p>
                  <p className="font-medium text-sm text-brand-dark/66 mt-1">{t(descriptions[row.id] || 'Follow-up behavior after an error.')}</p>
                </div>
              </div>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black shrink-0">
                {Number(row.rate || 0).toFixed(1)}%
              </span>
            </div>
            <Bar value={Number(row.rate || 0)} tone={row.id === 'error_to_correct' || row.id === 'hesitant_correct' ? 'good' : row.id === 'rushed_wrong' ? 'mid' : 'bad'} />
            <p className="font-black text-xs uppercase tracking-[0.16em] text-brand-dark/45 mt-3">{t(`${row.count} follow-up transitions`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FatigueTimelineChart({ rows }: { rows: any[] }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{t('No drift timeline is available yet.')}</p>;
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
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t(metric.label)}</p>
                <p className="font-medium text-brand-dark/65">{t(`Q1 to Q${rows.length}`)}</p>
              </div>
              <span className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark font-black">
                {typeof metric.summary === 'string' ? t(metric.summary) : metric.summary}
              </span>
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
  const { t } = useTeacherAnalyticsLanguage();
  if (!rows.length) {
    return <p className="font-bold text-brand-dark/60">{t('No deadline dependency data is available.')}</p>;
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
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[250px] w-full min-w-[520px] sm:h-[290px] sm:min-w-[620px]">
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
                <text x={baseX + groupWidth * 0.2} y={height - 8} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">{t(row.label)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mt-5">
        {rows.map((row) => (
          <div key={`deadline-card-${row.id}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{t(row.label)}</p>
            <p className="font-black">{t(`${Number(row.accuracy || 0).toFixed(0)}% accurate`)}</p>
            <p className="font-medium text-brand-dark/65">{t(`${Number(row.changed_rate || 0).toFixed(0)}% revised · ${row.count} rows`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitmentDistributionChart({ rows }: { rows: any[] }) {
  const { t } = useTeacherAnalyticsLanguage();
  const maxCount = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
  if (!rows.some((row) => Number(row.count || 0) > 0)) {
    return <p className="font-bold text-brand-dark/60">{t('No commitment-latency distribution is available yet.')}</p>;
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
              <p className="text-sm font-black uppercase tracking-[0.1em] text-brand-purple">{t(row.label)}</p>
              <p className="font-bold text-brand-dark/70 text-sm">{t(`${row.count} responses`)}</p>
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
                {t(`${Number(row.accuracy || 0).toFixed(0)}% Accuracy`)}
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
  const { t } = useTeacherAnalyticsLanguage();
  if (!rows.some((row) => Number(row.count || 0) > 0)) {
    return <p className="font-bold text-brand-dark/60">{t('No re-engagement pattern was detected in this session.')}</p>;
  }

  const maxResponse = Math.max(...rows.map((row) => Number(row.avg_response_ms || 0)), 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {rows.map((row) => (
        <div key={row.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t(row.label)}</p>
          <p className="text-3xl font-black mb-4">{row.count}</p>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                <span>{t('Accuracy')}</span>
                <span>{Number(row.accuracy || 0).toFixed(0)}%</span>
              </div>
              <Bar value={Number(row.accuracy || 0)} tone={accuracyTone(Number(row.accuracy || 0))} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-3 text-sm font-black mb-2">
                <span>{t('Volatility')}</span>
                <span>{t(`${Number(row.avg_volatility || 0).toFixed(0)} pts`)}</span>
              </div>
              <Bar value={Number(row.avg_volatility || 0)} tone={Number(row.avg_volatility || 0) >= 60 ? 'bad' : Number(row.avg_volatility || 0) >= 35 ? 'mid' : 'good'} />
            </div>
          </div>
          <p className="font-medium text-brand-dark/65 mt-3">
            {t(`Avg response ${((Number(row.avg_response_ms || 0) / maxResponse) * 100).toFixed(0)}% of the slowest group`)}
            {' · '}
            {formatMs(Number(row.avg_response_ms || 0))}
          </p>
        </div>
      ))}
    </div>
  );
}

function DistractorHeatmapChart({ heatmap }: { heatmap: any }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!heatmap?.questions?.length) {
    return <p className="font-bold text-brand-dark/60">{t('No distractor heatmap is available for this session.')}</p>;
  }

  const columns = `110px repeat(${heatmap.questions.length}, minmax(76px, 1fr))`;

  return (
      <div className="overflow-x-auto">
      <div className="min-w-[620px] sm:min-w-[760px] space-y-2">
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
              <p className="font-black">{t(`Option ${optionLabel}`)}</p>
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
                  <p className="text-[11px] font-black">{cell?.isCorrect ? t('Correct key') : `${Number(cell?.rate || 0).toFixed(0)}%`}</p>
                  <p className="text-[11px] font-medium text-brand-dark/70 line-clamp-3">{cell?.text || t('No option')}</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(`${cell?.count || 0} students`)}</p>
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="bg-white/10 rounded-2xl border border-white/15 p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">{t(label)}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function PackMetric({ label, value }: { label: string; value: string | number }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(label)}</p>
      <p className="text-lg font-black break-words">{typeof value === 'string' ? t(value) : value}</p>
    </div>
  );
}

function RiskBadge({ level, compact = false }: { level?: string; compact?: boolean }) {
  const { t } = useTeacherAnalyticsLanguage();
  const label = level === 'high' ? 'High Risk' : level === 'medium' ? 'Watch' : 'Stable';
  const tone = level === 'high' ? 'bg-brand-orange text-white' : level === 'medium' ? 'bg-brand-yellow text-brand-dark' : 'bg-emerald-300 text-brand-dark';
  return (
    <span className={`${tone} ${compact ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm'} rounded-full border-2 border-brand-dark font-black uppercase tracking-[0.15em]`}>
      {t(label)}
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
  const { t } = useTeacherAnalyticsLanguage();
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
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-1">{t(label)}</p>
        {metricId && <InfoTooltip metricId={metricId} />}
      </div>
      <p className="text-lg font-black">{typeof value === 'string' ? t(value) : value}</p>
    </div>
  );
}

function TrustReadCard({
  eyebrow,
  title,
  body,
  tone,
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone: 'light' | 'purple' | 'amber';
}) {
  const { t } = useTeacherAnalyticsLanguage();
  const toneClass =
    tone === 'purple'
      ? 'bg-[#eef0ff]'
      : tone === 'amber'
        ? 'bg-[#fff6db]'
        : 'bg-brand-bg';

  return (
    <div className={`rounded-[1.2rem] border-2 border-brand-dark p-4 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{t(eyebrow)}</p>
      <p className="font-black leading-tight">{t(title)}</p>
      <p className="font-medium text-brand-dark/72 mt-2">{t(body)}</p>
    </div>
  );
}

interface MetricData {
  label?: string;
  value?: string | number;
  unit?: string;
  [key: string]: any;
}

function TrustMetricChip({ metric }: { metric: MetricData }) {
  const { t } = useTeacherAnalyticsLanguage();
  const unit = String(metric?.unit || '').trim();
  const rawValue = metric?.value;
  const formattedValue =
    typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? `${Number(rawValue).toFixed(unit === '%' ? 1 : unit === 'ms' ? 0 : Number.isInteger(rawValue) ? 0 : 1)}${unit ? ` ${unit}` : ''}`
      : `${String(rawValue ?? '--')}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="rounded-xl border-2 border-brand-dark bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">{t(metric?.label || 'Metric')}</p>
      <p className="text-sm font-black mt-1">{typeof rawValue === 'string' ? t(formattedValue) : formattedValue}</p>
    </div>
  );
}

function DistributionGroup({ title, items }: { title: string; items: any[] }) {
  const { t } = useTeacherAnalyticsLanguage();
  if (!items.length) {
    return (
      <div className="mb-6 last:mb-0">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-3">{t(title)}</p>
        <p className="font-bold text-brand-dark/50">{t('No distribution data.')}</p>
      </div>
    );
  }

  const maxCount = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  return (
    <div className="mb-6 last:mb-0">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-3">{t(title)}</p>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.label}`} className="grid grid-cols-[90px_1fr_40px] items-center gap-3">
            <span className="text-sm font-black capitalize">{t(item.label)}</span>
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
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${color}`} />
      <span className="text-sm font-black">{t(label)}</span>
    </div>
  );
}

function LegendRow({ label, tone, body }: { label: string; tone: string; body: string }) {
  const { t } = useTeacherAnalyticsLanguage();
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-4 h-4 rounded-full border-2 border-brand-dark ${tone}`} />
        <p className="font-black">{t(label)}</p>
      </div>
      <p className="font-medium text-brand-dark/65 text-sm">{t(body)}</p>
    </div>
  );
}
