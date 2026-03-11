import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Download,
  Eye,
  Flame,
  Gauge,
  RefreshCw,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { getGameMode } from '../lib/gameModes.ts';

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

export default function TeacherAnalytics() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  const loadAnalytics = async () => {
    if (!sessionId) return;
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/analytics/class/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to load class analytics');
      }
      const payload = await response.json();
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

  const participants = data?.participants || [];
  const questionRows = data?.questions || [];
  const alertList = data?.alerts || [];
  const topGapTags = data?.tagSummary?.slice(0, 6) || [];
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
  const accuracyDistribution = data?.distributions?.accuracy || [];
  const stressDistribution = data?.distributions?.stress || [];
  const riskDistribution = data?.distributions?.risk || [];
  const gameMode = getGameMode(data?.session?.game_type);

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
        accuracy: row.accuracy,
        difficulty_index: row.difficulty_index,
        discrimination_index: row.discrimination_index,
        stress_index: row.stress_index,
        top_group_accuracy: row.top_group_accuracy,
        bottom_group_accuracy: row.bottom_group_accuracy,
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
        <div className="max-w-[1520px] mx-auto px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => navigate('/teacher/reports')}
              className="w-12 h-12 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A] shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Post-Quiz Analytics</p>
              <h1 className="text-3xl font-black tracking-tight truncate">{data?.session?.pack_title || `Session #${sessionId}`}</h1>
              <p className="font-bold text-brand-dark/60 truncate">
                Session #{data?.session?.id || sessionId} · PIN {data?.session?.pin || 'N/A'} · {gameMode.label} · {participants.length} students · {researchRows.length} research-grade rows
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadAnalytics}
              className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
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
      </div>

      <main className="max-w-[1520px] mx-auto px-6 pt-10">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-brand-dark text-white rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8 lg:p-10 mb-8 overflow-hidden relative"
        >
          <div className="absolute right-[-40px] top-[-50px] w-60 h-60 rounded-full bg-white/10" />
          <div className="absolute right-24 bottom-[-45px] w-32 h-32 rounded-full bg-brand-yellow/20" />
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">Class Narrative</p>
              <h2 className="text-4xl lg:text-5xl font-black leading-tight mb-4">{data.summary?.headline}</h2>
              <p className="text-lg font-medium text-white/70 max-w-3xl">{data.summary?.summary}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <PulseChip label="Top Gap" value={data.summary?.top_gap_tag || 'Stable'} accent="bg-brand-yellow text-brand-dark" />
              <PulseChip label="High Risk" value={`${data.summary?.high_risk_students || 0}`} accent="bg-brand-orange text-white" />
              <PulseChip label="Focus Watch" value={`${data.summary?.focus_watch_students || 0}`} accent="bg-brand-purple text-white" />
              <PulseChip label="Research Rows" value={compactNumber.format(researchRows.length || 0)} accent="bg-white text-brand-dark" />
            </div>
          </div>
        </motion.section>

        <section className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-6 gap-5 mb-8">
          <MetricCard icon={<Target className="w-6 h-6" />} title="Accuracy" value={`${(data.summary?.overall_accuracy || 0).toFixed(1)}%`} color="bg-brand-yellow" />
          <MetricCard icon={<Users className="w-6 h-6" />} title="Students" value={data.summary?.participant_count || 0} color="bg-brand-purple" textColor="text-white" />
          <MetricCard icon={<Gauge className="w-6 h-6" />} title="Stress" value={`${(data.summary?.stress_index || 0).toFixed(0)}%`} color="bg-brand-orange" textColor="text-white" />
          <MetricCard icon={<Activity className="w-6 h-6" />} title="Answers" value={data.summary?.total_answers || 0} color="bg-white" />
          <MetricCard icon={<Flame className="w-6 h-6" />} title="Panic Swaps" value={data.summary?.total_panic_swaps || 0} color="bg-brand-dark" textColor="text-white" />
          <MetricCard icon={<Eye className="w-6 h-6" />} title="Focus Events" value={data.summary?.total_focus_loss || 0} color="bg-[#d8f1ff]" />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.78fr_1.22fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Mode Intelligence</p>
            <h2 className="text-3xl font-black mb-3">{gameMode.label}</h2>
            <p className="font-medium text-brand-dark/70 mb-5">{gameMode.description}</p>
            <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 mb-4">
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

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Telemetry Command Board</p>
                <h2 className="text-3xl font-black">Attention and Input Signals</h2>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
              <SignalPill label="Attention Drag" value={research?.behavior_patterns?.attention_drag_index?.mean ?? 0} />
              <SignalPill label="Interaction / s" value={research?.behavior_patterns?.interaction_intensity?.mean ?? 0} />
              <SignalPill label="Hover Entropy" value={research?.behavior_patterns?.hover_entropy?.mean ?? 0} />
              <SignalPill label="P75 Drag" value={research?.behavior_patterns?.attention_drag_index?.p75 ?? 0} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DistributionGroup title="Input mix" items={research?.behavior_patterns?.input_mix || []} />
              <DistributionGroup title="Commit styles" items={research?.behavior_patterns?.commit_style_distribution || []} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 2xl:grid-cols-[1.15fr_0.85fr] gap-8 mb-8">
          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-purple text-white">
              <h2 className="text-3xl font-black">Session Dynamics</h2>
              <p className="font-bold text-white/70 mt-2">Question-by-question pressure curve for accuracy, stress, response time, and panic behavior.</p>
            </div>
            <div className="p-7">
              <ResearchLineChart rows={sequenceDynamics} />
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
            <div className="p-7 border-b-4 border-brand-dark bg-brand-yellow">
              <h2 className="text-3xl font-black">Student Pressure Scatter</h2>
              <p className="font-bold text-brand-dark/65 mt-2">Each dot is one student. X = accuracy, Y = stress. Click a dot to open the personal dashboard.</p>
            </div>
            <div className="p-7">
              <StudentScatterPlot
                participants={participants}
                selectedStudentId={selectedStudent?.id}
                onSelect={(studentId) => setSelectedStudentId(studentId)}
                onOpen={openStudentDashboard}
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8 mb-8">
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
                      <p className="text-xs font-bold text-brand-dark/50">{tag.students_count} students touched this topic</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <SignalPill label="Stress" value={`${tag.stress_index.toFixed(0)}%`} tone={tag.stress_level} />
                    <SignalPill label="Avg TFI" value={formatMs(Number(tag.avg_tfi || 0))} />
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
              <h2 className="text-3xl font-black">Question Diagnostics Lab</h2>
              <p className="font-bold text-brand-dark/60 mt-2">Item difficulty, discrimination, stress, and timing in one research-ready view.</p>
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
            {questionDiagnostics.map((question: any) => (
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
              </div>
            ))}
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
                      <SignalPill label="Swaps" value={question.avg_swaps.toFixed(1)} />
                      <SignalPill label="Panic" value={question.total_panic_swaps} />
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
                {(data.studentSpotlight?.attention_needed || []).slice(0, 5).map((student: any) => (
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

  return (
    <div>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {rows.map((row) => (
          <div key={`summary-${row.question_index}`} className="rounded-[1.2rem] border-2 border-brand-dark bg-white p-3">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">Question {row.question_index}</p>
            <p className="font-black">Accuracy {row.accuracy}%</p>
            <p className="font-medium text-brand-dark/65">Stress {row.stress_index}% · {formatMs(Number(row.avg_response_ms || 0))}</p>
          </div>
        ))}
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
  const width = 420;
  const height = 320;
  const padding = 26;

  return (
    <div>
      <div className="rounded-[1.7rem] border-2 border-brand-dark bg-brand-bg p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-h-[320px]">
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#1A1A1A" strokeWidth="2" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#1A1A1A" strokeWidth="2" />
          <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="12" fontWeight="800" fill="#1A1A1A">Accuracy</text>
          <text x={18} y={height / 2} textAnchor="middle" fontSize="12" fontWeight="800" fill="#1A1A1A" transform={`rotate(-90 18 ${height / 2})`}>Stress</text>

          {[25, 50, 75, 100].map((tick) => {
            const x = padding + (tick / 100) * (width - padding * 2);
            const y = height - padding - (tick / 100) * (height - padding * 2);
            return (
              <g key={tick}>
                <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#1A1A1A" strokeOpacity="0.1" strokeWidth="1" />
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1A1A1A" strokeOpacity="0.1" strokeWidth="1" />
              </g>
            );
          })}

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
                <circle cx={x} cy={y} r={isSelected ? 14 : 11} fill={fill} stroke="#1A1A1A" strokeWidth="3" />
                <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#1A1A1A">
                  {String(student.nickname || '?').trim().charAt(0).toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <LegendRow label="Stable" tone="bg-brand-purple" body="High/medium accuracy with controlled stress." />
        <LegendRow label="Watch" tone="bg-brand-yellow" body="Mixed profile that needs teacher attention." />
        <LegendRow label="High Risk" tone="bg-brand-orange" body="Low mastery or high pressure collapse pattern." />
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  color,
  textColor = 'text-brand-dark',
}: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  color: string;
  textColor?: string;
}) {
  return (
    <div className={`${color} ${textColor} rounded-[1.75rem] border-4 border-brand-dark p-5 shadow-[6px_6px_0px_0px_#1A1A1A]`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-black uppercase tracking-[0.15em] opacity-70">{title}</p>
        <div>{icon}</div>
      </div>
      <p className="text-4xl font-black">{value}</p>
    </div>
  );
}

function PulseChip({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`${accent} rounded-[1.5rem] border-2 border-brand-dark p-4 shadow-[4px_4px_0px_0px_#1A1A1A]`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-black">{value}</p>
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
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'mid' | 'bad' | 'low' | 'medium' | 'high' | 'neutral';
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
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/50 mb-1">{label}</p>
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
