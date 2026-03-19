import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
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
import { apiFetchJson } from '../lib/api.ts';

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

export default function TeacherStudentAnalytics() {
  const { sessionId, participantId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);

  const buildFallbackPayload = async () => {
    const classPayload = await apiFetchJson(`/api/analytics/class/${sessionId}`);
    const studentSummary = classPayload?.participants?.find((row: any) => Number(row.id) === Number(participantId));
    const reportPayload = await apiFetchJson(`/api/reports/student/${participantId}`);

    return {
      session: reportPayload?.session || classPayload?.session || { id: Number(sessionId) },
      pack:
        reportPayload?.pack || {
          id: classPayload?.session?.quiz_pack_id,
          title: classPayload?.session?.pack_title || `Pack ${classPayload?.session?.quiz_pack_id || ''}`,
        },
      participant:
        reportPayload?.participant || {
          id: Number(participantId),
          session_id: Number(sessionId),
          nickname: studentSummary?.nickname || 'Student',
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
      const payload = await apiFetchJson(`/api/analytics/class/${sessionId}/student/${participantId}`);
      if (!payload?.session_vs_overall && payload?.analytics && payload?.overall_analytics) {
        payload.session_vs_overall = buildSessionComparison(payload.analytics, payload.overall_analytics);
      }
      setData(payload);
    } catch (loadError: any) {
      try {
        const fallbackPayload = await buildFallbackPayload();
        setData(fallbackPayload);
        setError(loadError?.message || 'Primary endpoint failed, loaded fallback data.');
      } catch (fallbackError: any) {
        setError(fallbackError?.message || loadError?.message || 'Failed to load student analytics');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudentAnalytics();
  }, [sessionId, participantId]);

  const analytics = data?.analytics;
  const overallAnalytics = data?.overall_analytics;
  const comparison = data?.session_vs_overall || buildSessionComparison(analytics, overallAnalytics);
  const student = data?.student_summary;
  const classSummary = data?.class_summary;
  const preview = data?.adaptive_game_preview;
  const questionReview = analytics?.questionReview || [];
  const revisionInsights = analytics?.revisionInsights || {};
  const deadlineProfile = analytics?.deadlineProfile || {};
  const recoveryProfile = analytics?.recoveryProfile || {};
  const fatigueDrift = analytics?.fatigueDrift || {};
  const misconceptionPatterns = analytics?.misconceptionPatterns || [];
  const tagBehaviorProfiles = analytics?.tagPerformance || [];
  const stabilityScore = Number(analytics?.stabilityScore || analytics?.aggregates?.stability_score || 0);
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
      window.alert(createError?.message || 'Failed to create adaptive game');
    } finally {
      setIsCreatingGame(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center text-brand-dark">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-purple rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">Loading personal dashboard...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-8">
        <div className="bg-white border-4 border-brand-dark rounded-[2rem] shadow-[8px_8px_0px_0px_#1A1A1A] p-8 text-center max-w-xl">
          <p className="text-3xl font-black mb-3">Student dashboard unavailable</p>
          <p className="font-bold text-brand-dark/60 mb-6">{error || 'No data returned.'}</p>
          <button
            onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
            className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
          >
            Back to Class Analytics
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-dark font-sans pb-20 selection:bg-brand-orange selection:text-white">
      <div className="absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.16),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.18),_transparent_36%)] pointer-events-none" />

      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b-4 border-brand-dark shadow-[0_4px_0px_0px_#1A1A1A]">
        <div className="max-w-[1450px] mx-auto px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
              className="w-12 h-12 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Student Drill-Down</p>
              <h1 className="text-3xl font-black tracking-tight">{data?.participant?.nickname}</h1>
              <p className="font-bold text-brand-dark/60">
                {data?.pack?.title} · Session #{data?.session?.id} · Rank #{student?.rank || '-'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {error && (
              <div className="px-4 py-3 bg-brand-yellow border-2 border-brand-dark rounded-full font-black text-sm">
                Fallback data loaded
              </div>
            )}
            <button
              onClick={loadStudentAnalytics}
              className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={handleCreateAdaptiveGame}
              disabled={isCreatingGame}
              className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {isCreatingGame ? 'Creating Game...' : 'Build And Host Adaptive Game'}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1450px] mx-auto px-6 pt-10 relative z-10">
        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 mb-8">
          <div className="bg-brand-dark text-white rounded-[2.6rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8 overflow-hidden relative">
            <div className="absolute top-[-25px] right-[-20px] w-56 h-56 rounded-full bg-white/10" />
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`px-4 py-2 rounded-full border-2 border-white/30 font-black ${riskChip(student?.risk_level || analytics?.risk?.level)}`}>
                  {String(student?.risk_level || analytics?.risk?.level || 'low').toUpperCase()} RISK
                </span>
                <span className="px-4 py-2 rounded-full border-2 border-white/20 bg-white/10 font-black">
                  {analytics?.profile?.decision_style}
                </span>
              </div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">Session-Specific Read</p>
              <h2 className="text-4xl font-black leading-tight mb-3">
                {analytics?.overallStory?.headline || analytics?.profile?.headline}
              </h2>
              <p className="text-lg font-medium text-white/75 mb-6">
                {analytics?.overallStory?.body || analytics?.profile?.body}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <HeroStat label="Game Accuracy" value={`${Number(analytics?.stats?.accuracy || student?.accuracy || 0).toFixed(0)}%`} />
                <HeroStat label="Stress" value={`${Number(analytics?.risk?.stress_index || student?.stress_index || 0).toFixed(0)}%`} />
                <HeroStat label="Confidence" value={Number(analytics?.profile?.confidence_score || 0).toFixed(0)} />
                <HeroStat label="Focus" value={Number(analytics?.profile?.focus_score || 0).toFixed(0)} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-7">
            <div className="flex items-center gap-3 mb-5">
              <TrendingUp className="w-6 h-6 text-brand-purple" />
              <h2 className="text-3xl font-black">Game Vs Overall Baseline</h2>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <DeltaCard label="Accuracy Delta" value={comparison?.accuracy_delta} helper={`Overall ${Number(overallAnalytics?.stats?.accuracy || 0).toFixed(1)}%`} />
              <DeltaCard label="Stress Delta" value={comparison?.stress_delta} helper={`Overall ${Number(overallAnalytics?.risk?.stress_index || 0).toFixed(1)}%`} />
              <DeltaCard label="Confidence Delta" value={comparison?.confidence_delta} helper={`Overall ${Number(overallAnalytics?.profile?.confidence_score || 0).toFixed(0)}`} />
              <DeltaCard label="Focus Delta" value={comparison?.focus_delta} helper={`Overall ${Number(overallAnalytics?.profile?.focus_score || 0).toFixed(0)}`} />
            </div>

            <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Teacher Recommendation</p>
              <p className="text-xl font-black mb-2">{student?.headline || analytics?.practicePlan?.headline}</p>
              <p className="font-medium text-brand-dark/70">
                {student?.recommendation || analytics?.practicePlan?.body}
              </p>
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
                    <p className="font-black mb-1">{item.title}</p>
                    <p className="font-medium text-brand-dark/70">{item.body}</p>
                  </div>
                ))
              ) : (
                <p className="font-bold text-brand-dark/60">No extra intervention signal was generated for this student.</p>
              )}
            </div>
          </InfoPanel>
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

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
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
                      <p className="font-black">{category.label}</p>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{category.count} questions</p>
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
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Fatigue Drift</p>
                <p className="text-2xl font-black mb-2">{fatigueDrift?.headline || 'No drift estimate yet'}</p>
                <p className="font-medium text-brand-dark/70">{fatigueDrift?.body || 'There are not enough answered questions yet to estimate drift.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <CompactMetric label="Recovery Rate" value={`${Number(recoveryProfile?.recovery_rate || 0).toFixed(1)}%`} />
                <CompactMetric label="Pattern" value={recoveryProfile?.dominant_pattern || 'No misses yet'} />
                <CompactMetric label="Early Accuracy" value={`${Number(fatigueDrift?.early_accuracy || 0).toFixed(0)}%`} />
                <CompactMetric label="Late Accuracy" value={`${Number(fatigueDrift?.late_accuracy || 0).toFixed(0)}%`} />
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                        <p className="font-black mb-1 capitalize">{pattern.tag}</p>
                        <p className="font-medium text-brand-dark/70">
                          Keeps landing on {pattern.choice_label}. {pattern.choice_text} across {pattern.question_count} questions.
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
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Momentum</p>
                <p className="text-2xl font-black mb-2">{analytics?.momentum?.headline}</p>
                <p className="font-medium text-brand-dark/70">{analytics?.momentum?.body}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(analytics?.sessionSegments || []).map((segment: any) => (
                  <div key={segment.label} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{segment.label}</p>
                    <p className="text-3xl font-black mb-2">{Number(segment.accuracy || 0).toFixed(0)}%</p>
                    <p className="font-medium text-brand-dark/70">Stress {Number(segment.avg_stress || 0).toFixed(0)}%</p>
                    <p className="font-medium text-brand-dark/70">
                      Commit {(Number(segment.avg_commit_window_ms || 0) / 1000).toFixed(1)}s
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                        <p className="text-2xl font-black">{session.pack_title}</p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <MetricChip label="Score" value={session.score} />
                        <MetricChip label="Accuracy" value={`${Number(session.accuracy || 0).toFixed(0)}%`} />
                        <MetricChip label="Stress" value={`${Number(session.avg_stress || 0).toFixed(0)}%`} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
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
                <p className="text-2xl font-black mb-2">{preview?.strategy?.headline || 'Adaptive same-material follow-up'}</p>
                <p className="font-medium text-brand-dark/75">{preview?.strategy?.body}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(preview?.strategy?.focus_tags || []).map((tag: string) => (
                  <span key={`focus-${tag}`} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="space-y-3">
                {(preview?.questions || []).slice(0, 4).map((question: any, index: number) => (
                  <div key={`preview-${question.id}-${index}`} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="font-black leading-tight">Q{index + 1}. {question.prompt}</p>
                      <ArrowUpRight className="w-4 h-4 shrink-0 text-brand-purple" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(question.tags || []).map((tag: string) => (
                        <span key={`preview-tag-${question.id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-[11px] font-black capitalize">
                          {tag}
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
                {isCreatingGame ? 'Creating...' : 'Build And Host Now'}
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
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Question {question.question_index}</p>
                      <p className="text-xl font-black leading-tight mb-3">{question.prompt}</p>
                      <div className="flex flex-wrap gap-2">
                        {(question.tags || []).map((tag: string) => (
                          <span key={`${question.question_id}-${tag}`} className="px-3 py-1 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <StatusBadge status={question.status} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <CompactMetric label="Response" value={`${(Number(question.response_ms || 0) / 1000).toFixed(1)}s`} />
                    <CompactMetric label="Stress" value={`${Number(question.stress_index || 0).toFixed(0)}%`} />
                    <CompactMetric label="Volatility" value={`${Number(question.decision_volatility || 0).toFixed(0)}%`} />
                    <CompactMetric label="Commit" value={question.commit_style} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <CompactMetric label="Swaps" value={question.total_swaps} />
                    <CompactMetric label="Flip-Flops" value={question.flip_flops} />
                    <CompactMetric label="Revisits" value={question.revisit_count} />
                    <CompactMetric label="Deadline Buffer" value={`${(Number(question.deadline_buffer_ms || 0) / 1000).toFixed(1)}s`} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-4 mb-4">
                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Choice Journey</p>
                      <div className="space-y-2">
                        <p className="font-medium text-brand-dark/70">
                          First choice: <span className="font-black text-brand-dark">{question.first_choice_label}. {question.first_choice_text}</span>
                        </p>
                        <p className="font-medium text-brand-dark/70">
                          Final choice: <span className="font-black text-brand-dark">{question.final_choice_label}. {question.final_choice_text}</span>
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <JourneyBadge tone={question.first_choice_correct ? 'good' : 'mid'}>
                            {question.first_choice_correct ? 'Started correct' : 'Started wrong'}
                          </JourneyBadge>
                          <JourneyBadge tone={question.revision_outcome === 'correct_to_incorrect' ? 'bad' : question.revision_outcome === 'incorrect_to_correct' ? 'good' : 'mid'}>
                            {question.revision_outcome_label}
                          </JourneyBadge>
                          {question.verification_behavior && <JourneyBadge tone="good">Verified</JourneyBadge>}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <CompactMetric label="Commit Latency" value={formatMs(Number(question.commitment_latency_ms || 0))} />
                      <CompactMetric label="1st Choice" value={question.first_choice_correct ? 'Right' : 'Wrong'} />
                      <CompactMetric label="Deadline Dep." value={question.deadline_dependent ? 'Yes' : 'No'} />
                      <CompactMetric label="Pressure" value={question.under_time_pressure ? 'High' : 'Normal'} />
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                    <p className="font-medium text-brand-dark/70">{question.recommendation}</p>
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
                    <div className="grid grid-cols-2 gap-3 mb-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <CompactMetric label="Class Stress" value={`${Number(classSummary?.stress_index || 0).toFixed(0)}%`} />
                  <CompactMetric label="Student Score" value={student?.total_score || 0} />
                </div>
              </div>
            </div>
          </TeacherSurface>
        </section>
      </main>
    </div>
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
  return (
    <div className="bg-white rounded-[2.25rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
      <div className="p-7 border-b-4 border-brand-dark bg-slate-50">
        <div className="flex items-center gap-3 mb-2">
          {icon}
          <h2 className="text-3xl font-black">{title}</h2>
        </div>
        <p className="font-medium text-brand-dark/65">{subtitle}</p>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40 mb-2">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function DeltaCard({ label, value, helper }: { label: string; value?: number; helper: string }) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return (
      <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</p>
        <p className="text-3xl font-black mb-1">-</p>
        <p className="font-medium text-brand-dark/60">{helper}</p>
      </div>
    );
  }

  const numericValue = Number(value || 0);
  return (
    <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</p>
      <p className={`text-3xl font-black mb-1 ${numericValue >= 0 ? 'text-emerald-600' : 'text-brand-orange'}`}>
        {numericValue >= 0 ? '+' : ''}
        {numericValue.toFixed(1)}
      </p>
      <p className="font-medium text-brand-dark/60">{helper}</p>
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
  return (
    <div className="bg-white rounded-[2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className={`${accent} w-11 h-11 rounded-2xl border-2 border-brand-dark flex items-center justify-center`}>
          {icon}
        </div>
        <h2 className="text-2xl font-black">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function TagCloud({ tags, tone }: { tags: string[]; tone: 'weak' | 'strong' }) {
  if (!tags.length) {
    return <p className="font-bold text-brand-dark/60">No tag signal yet for this student.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={`${tone}-${tag}`}
          className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black capitalize ${tone === 'weak' ? 'bg-brand-orange/10' : 'bg-emerald-100'}`}
        >
          {tag}
        </span>
      ))}
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
  return (
    <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{label}</p>
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
      <p className="font-medium text-brand-dark/68 mb-2">{caption}</p>
      {overallScore !== undefined && overallScore !== null && (
        <p className="text-sm font-bold text-brand-dark/55">Overall baseline: {Number(overallScore).toFixed(1)}</p>
      )}
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</p>
      <p className="text-xl font-black break-words leading-tight">{value}</p>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark text-sm font-black">
      {label}: {value}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'missed') {
    return (
      <div className="px-4 py-3 rounded-2xl bg-brand-orange text-white border-2 border-brand-dark font-black flex items-center gap-2">
        <XCircle className="w-4 h-4" />
        Missed
      </div>
    );
  }
  if (status === 'shaky') {
    return (
      <div className="px-4 py-3 rounded-2xl bg-brand-yellow text-brand-dark border-2 border-brand-dark font-black flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Correct But Shaky
      </div>
    );
  }
  return (
    <div className="px-4 py-3 rounded-2xl bg-emerald-300 text-brand-dark border-2 border-brand-dark font-black flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4" />
      Stable
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
  return (
    <div className="rounded-[1.75rem] border-2 border-dashed border-brand-dark/30 bg-brand-bg p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-white border-2 border-brand-dark/15 flex items-center justify-center mx-auto mb-4 text-brand-dark/60">
        {icon}
      </div>
      <p className="text-2xl font-black mb-2">{title}</p>
      <p className="font-medium text-brand-dark/65">{body}</p>
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
