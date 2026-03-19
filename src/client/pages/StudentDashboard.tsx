import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Clock3,
  Flame,
  Gauge,
  Layers3,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  MasteryBarChart,
  QuestionFlowChart,
  QuestionStatusStripChart,
  SessionHistoryTrendChart,
} from '../components/studentDashboardCharts.tsx';
import { apiFetchJson } from '../lib/api.ts';
import Avatar, { extractNickname } from '../components/Avatar.tsx';
import { clearJoinedParticipantSession } from '../lib/studentSession.ts';

// Replaced by central apiFetchJson

export default function StudentDashboard() {
  const { nickname } = useParams();
  const navigate = useNavigate();
  const participantId = localStorage.getItem('participant_id');
  const displayNickname = extractNickname(localStorage.getItem('nickname') || nickname || '');

  const [overallData, setOverallData] = useState<any>(null);
  const [gameData, setGameData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!nickname) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      const [overallResult, gameResult] = await Promise.allSettled([
        apiFetchJson(`/api/analytics/student/${encodeURIComponent(nickname)}`),
        participantId
          ? apiFetchJson(`/api/reports/student/${participantId}`).catch((error: any) => {
              const message = String(error?.message || '');
              if (
                message.includes('Teacher authentication required') ||
                message.includes('403') ||
                message.includes('401')
              ) {
                return null;
              }
              throw error;
            })
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      if (overallResult.status === 'fulfilled') {
        setOverallData(overallResult.value);
      } else {
        setOverallData(null);
      }

      if (gameResult.status === 'fulfilled') {
        setGameData(gameResult.value);
      } else {
        setGameData(null);
      }

      if (overallResult.status === 'rejected' && gameResult.status === 'rejected') {
        setError(overallResult.reason?.message || gameResult.reason?.message || 'Failed to load dashboard');
      } else if (overallResult.status === 'rejected') {
        setError(overallResult.reason?.message || 'Overall analytics unavailable, showing latest game only.');
      } else if (gameResult.status === 'rejected' && participantId) {
        setError(gameResult.reason?.message || 'Latest game analytics unavailable, showing overall view only.');
      }

      setLoading(false);
    };

    load().catch((loadError: any) => {
      if (cancelled) return;
      setError(loadError?.message || 'Failed to load dashboard');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [nickname, participantId]);

  const overall = overallData || gameData;
  const latestGame = gameData;
  const mastery = overall?.mastery || [];
  const overallSignals = overall?.behaviorSignals || [];
  const latestSignals = latestGame?.behaviorSignals || [];
  const questionReview = latestGame?.questionReview || [];
  const sessionSegments = latestGame?.sessionSegments || [];
  const sessionHistory = overall?.sessionHistory || latestGame?.sessionHistory || [];
  const shakyQuestions = questionReview.filter((row: any) => row.status !== 'solid');
  const focusTags = overall?.practicePlan?.focus_tags || overall?.profile?.weak_tags || [];
  const confidenceScore = Number(overall?.profile?.confidence_score || 0);
  const focusScore = Number(overall?.profile?.focus_score || 0);
  const totalScore = Number(overall?.stats?.total_score || 0);
  const hasOverallBaseline = Boolean(overallData && gameData);
  const currentXP = totalScore * 10 + Number(overall?.stats?.total_answers || 0) * 30 + 400;
  const level = Math.floor(currentXP / 1000) + 1;
  const xpProgress = currentXP % 1000;
  const xpToNextLevel = 1000 - xpProgress;
  const latestSessionTitle = latestGame?.pack?.title || latestGame?.sessionHistory?.[0]?.pack_title;

  const signalBaselines = useMemo(
    () => new Map(overallSignals.map((signal: any) => [signal.id, signal.score])),
    [overallSignals],
  );

  const gameVsOverall = useMemo(
    () =>
      latestSignals.map((signal: any) => ({
        ...signal,
        delta:
          hasOverallBaseline && signalBaselines.has(signal.id)
            ? Number(signal.score || 0) - Number(signalBaselines.get(signal.id) || 0)
            : null,
      })),
    [hasOverallBaseline, latestSignals, signalBaselines],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center text-brand-dark">
          <div className="w-16 h-16 border-4 border-brand-dark border-t-brand-orange rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xl font-black">Loading your personal dashboard...</p>
        </div>
      </div>
    );
  }

  if (!overall) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-8">
        <div className="bg-white rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-8 max-w-xl text-center">
          <p className="text-3xl font-black mb-3">Student dashboard unavailable</p>
          <p className="font-bold text-brand-dark/60 mb-6">{error || 'No analytics were returned.'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black"
          >
            Back Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg font-sans text-brand-dark pb-20 selection:bg-brand-orange selection:text-white">
      <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,_rgba(255,90,54,0.18),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(180,136,255,0.16),_transparent_34%)] pointer-events-none" />

      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b-4 border-brand-dark shadow-[0_4px_0px_0px_#1A1A1A]">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="w-12 h-12 rounded-full bg-brand-yellow border-2 border-brand-dark flex items-center justify-center shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Student Command Center</p>
              <h1 className="text-3xl font-black tracking-tight">{displayNickname}</h1>
              <p className="font-bold text-brand-dark/60">
                {latestSessionTitle ? `Latest game: ${latestSessionTitle}` : 'Overall learning profile'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/explore')}
              className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              Explore Packs
            </button>
            <button
              onClick={() => navigate(`/student/practice/${nickname}`)}
              className="px-5 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#1A1A1A] flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Start Adaptive Practice
            </button>
            <button
              onClick={() => {
                clearJoinedParticipantSession();
                navigate('/');
              }}
              className="px-5 py-3 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black shadow-[2px_2px_0px_0px_#FF5A36]"
            >
              Log Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto px-6 pt-10 relative z-10">
        {error && (
          <div className="mb-6 px-5 py-4 bg-brand-yellow border-2 border-brand-dark rounded-[1.5rem] font-bold">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-8 mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-brand-dark text-white rounded-[2.8rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-8"
          >
            <div className="flex items-center gap-5 mb-8">
              <Avatar 
                nickname={nickname || ''} 
                imgClassName="w-24 h-24 text-5xl border-4 border-white -rotate-6" 
                textClassName="hidden"
              />
              <div>
                <h2 className="text-3xl font-black">{displayNickname}</h2>
                <p className="font-bold text-white/65">Personal learning profile</p>
              </div>
            </div>


            <div className="rounded-[2rem] border border-white/15 bg-white/10 p-5 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-brand-yellow" />
                  <span className="font-black">Level {level}</span>
                </div>
                <span className="text-sm font-bold text-white/70">{xpToNextLevel} XP to next</span>
              </div>
              <div className="w-full h-3 rounded-full bg-black/25 overflow-hidden">
                <div className="h-full rounded-full bg-brand-yellow" style={{ width: `${xpProgress / 10}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <HeroMetric label="Total Score" value={totalScore} tone="orange" />
              <HeroMetric label="Accuracy" value={`${Number(overall?.stats?.accuracy || 0).toFixed(0)}%`} tone="yellow" />
              <HeroMetric label="Confidence" value={confidenceScore} tone="white" />
              <HeroMetric label="Focus" value={focusScore} tone="purple" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[2.8rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] overflow-hidden"
          >
            <div className="p-8 md:p-10 bg-brand-yellow border-b-4 border-brand-dark relative overflow-hidden">
              <div className="absolute top-[-25px] right-[-10px] w-48 h-48 rounded-full bg-white/30" />
              <div className="relative z-10">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black ${riskTone(overall?.risk?.level).chip}`}>
                    {String(overall?.risk?.level || 'low').toUpperCase()} RISK
                  </span>
                  <span className="px-4 py-2 rounded-full border-2 border-brand-dark bg-white font-black">
                    {overall?.profile?.decision_style}
                  </span>
                  {latestSessionTitle && (
                    <span className="px-4 py-2 rounded-full border-2 border-brand-dark bg-brand-dark text-white font-black">
                      {latestSessionTitle}
                    </span>
                  )}
                </div>
                <h2 className="text-4xl md:text-5xl font-black leading-tight mb-3">
                  {overall?.overallStory?.headline || overall?.profile?.headline}
                </h2>
                <p className="text-lg font-bold text-brand-dark/70 max-w-3xl">
                  {overall?.overallStory?.body || overall?.profile?.body}
                </p>
              </div>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-6">
              <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-bg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Rocket className="w-6 h-6 text-brand-orange" />
                  <h3 className="text-2xl font-black">Best Next Move</h3>
                </div>
                <p className="font-bold text-brand-dark/70 mb-5">{overall?.practicePlan?.body}</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {focusTags.length > 0 ? (
                    focusTags.map((tag: string) => (
                      <span key={`practice-${tag}`} className="px-3 py-2 rounded-full bg-white border-2 border-brand-dark text-xs font-black capitalize">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="font-bold text-brand-dark/60">No clear weak tags yet.</span>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/student/practice/${nickname}`)}
                  className="px-6 py-4 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[3px_3px_0px_0px_#FF5A36]"
                >
                  <Sparkles className="w-4 h-4 text-brand-yellow" />
                  Practice On My Weak Spots
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InsightTile
                  label="Games Played"
                  value={sessionHistory.length || Number(overall?.stats?.total_answers ? 1 : 0)}
                  helper="Tracked sessions"
                  icon={<Layers3 className="w-5 h-5" />}
                />
                <InsightTile
                  label="Avg Response"
                  value={`${(Number(overall?.stats?.avg_response_ms || 0) / 1000).toFixed(1)}s`}
                  helper="Across recorded answers"
                  icon={<Clock3 className="w-5 h-5" />}
                />
                <InsightTile
                  label="Stress Index"
                  value={`${Number(overall?.risk?.stress_index || 0).toFixed(0)}%`}
                  helper="Behavior under pressure"
                  icon={<Flame className="w-5 h-5" />}
                />
                <InsightTile
                  label="Question Volume"
                  value={overall?.stats?.total_answers || 0}
                  helper="Answers observed"
                  icon={<BarChart3 className="w-5 h-5" />}
                />
              </div>
            </div>
          </motion.div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 mb-8">
          <SurfaceCard
            title="Behavior Signals"
            subtitle="How your decisions look beyond right or wrong answers."
            icon={<BrainCircuit className="w-6 h-6 text-brand-purple" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(latestSignals.length > 0 ? gameVsOverall : overallSignals).map((signal: any) => (
                <div key={signal.id}>
                  <SignalCard
                    label={signal.label}
                    caption={signal.caption}
                    score={signal.score}
                    delta={signal.delta}
                  />
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard
            title="Latest Game Read"
            subtitle="A focused look at the most recent session and how you behaved inside it."
            icon={<Gauge className="w-6 h-6 text-brand-orange" />}
          >
            {latestGame ? (
              <div className="space-y-5">
                <QuestionFlowChart rows={questionReview} />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <CompactMetric label="Accuracy" value={`${Number(latestGame?.stats?.accuracy || 0).toFixed(0)}%`} />
                  <CompactMetric label="Stress" value={`${Number(latestGame?.risk?.stress_index || 0).toFixed(0)}%`} />
                  <CompactMetric label="Swaps" value={latestGame?.aggregates?.total_swaps || 0} />
                  <CompactMetric label="Focus Loss" value={latestGame?.aggregates?.total_focus_loss || 0} />
                </div>

                <div className={`rounded-[1.75rem] border-2 border-brand-dark p-5 ${momentumTone(latestGame?.momentum?.direction)}`}>
                  <p className="text-xs font-black uppercase tracking-[0.2em] mb-2">Momentum</p>
                  <p className="text-2xl font-black mb-2">{latestGame?.momentum?.headline}</p>
                  <p className="font-medium">{latestGame?.momentum?.body}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {sessionSegments.map((segment: any) => (
                    <div key={segment.label} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{segment.label}</p>
                      <p className="text-3xl font-black mb-2">{segment.accuracy.toFixed(0)}%</p>
                      <p className="font-medium text-brand-dark/70">Stress {segment.avg_stress.toFixed(0)}%</p>
                      <p className="font-medium text-brand-dark/70">
                        Commit {(Number(segment.avg_commit_window_ms || 0) / 1000).toFixed(1)}s
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Gauge className="w-8 h-8" />}
                title="No single-game analytics yet"
                body="Play one hosted game to unlock the detailed session breakdown."
              />
            )}
          </SurfaceCard>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_0.95fr] gap-8 mb-8">
          <SurfaceCard
            title="Session Timeline"
            subtitle="Track how your performance and pressure move from game to game."
            icon={<TrendingUp className="w-6 h-6 text-emerald-500" />}
          >
            {sessionHistory.length > 0 ? (
              <div className="space-y-4">
                <SessionHistoryTrendChart rows={sessionHistory} />

                {sessionHistory.slice(0, 5).map((session: any) => (
                  <div key={session.session_id} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{session.date}</p>
                        <p className="text-2xl font-black">{session.pack_title}</p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <MiniPill label="Score" value={session.score} />
                        <MiniPill label="Accuracy" value={`${Number(session.accuracy || 0).toFixed(0)}%`} />
                        <MiniPill label="Stress" value={`${Number(session.avg_stress || 0).toFixed(0)}%`} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <MetricStrip label="Commit Window" value={`${(Number(session.avg_commit_window_ms || 0) / 1000).toFixed(1)}s`} />
                      <MetricStrip label="Focus Events" value={session.focus_events} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Layers3 className="w-8 h-8" />}
                title="No session timeline yet"
                body="As soon as you complete more hosted games, your longitudinal timeline will appear here."
              />
            )}
          </SurfaceCard>

          <SurfaceCard
            title="Topic Mastery"
            subtitle="Your strongest and weakest content areas right now."
            icon={<Target className="w-6 h-6 text-brand-orange" />}
          >
            {mastery.length > 0 ? (
              <div className="space-y-4">
                <MasteryBarChart rows={mastery} limit={6} />

                {mastery.map((item: any) => (
                  <div key={item.tag} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <p className="font-black text-xl capitalize">{item.tag}</p>
                      <p className="text-2xl font-black">{item.score}<span className="text-base text-brand-dark/40">/100</span></p>
                    </div>
                    <div className="w-full h-4 rounded-full bg-white border-2 border-brand-dark/10 overflow-hidden p-[2px]">
                      <div className={`h-full rounded-full ${masteryTone(item.score)}`} style={{ width: `${Math.max(0, Math.min(100, Number(item.score || 0)))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen className="w-8 h-8" />}
                title="No mastery map yet"
                body="Once enough tagged answers accumulate, your topic map will show here."
              />
            )}
          </SurfaceCard>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8">
          <SurfaceCard
            title="Latest Game Question Lab"
            subtitle="Where the last session felt solid, shaky, or conceptually fragile."
            icon={<ShieldCheck className="w-6 h-6 text-brand-purple" />}
          >
            {questionReview.length > 0 ? (
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
                      <span className={`px-4 py-3 rounded-2xl border-2 border-brand-dark font-black ${questionStatusTone(question.status)}`}>
                        {question.status === 'missed' ? 'Missed' : question.status === 'shaky' ? 'Correct But Shaky' : 'Stable'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <CompactMetric label="Response" value={`${(Number(question.response_ms || 0) / 1000).toFixed(1)}s`} />
                      <CompactMetric label="Volatility" value={`${Number(question.decision_volatility || 0).toFixed(0)}%`} />
                      <CompactMetric label="Deadline Buffer" value={`${(Number(question.deadline_buffer_ms || 0) / 1000).toFixed(1)}s`} />
                      <CompactMetric label="Commit" value={question.commit_style} />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <CompactMetric label="Revisits" value={question.revisit_count} />
                      <CompactMetric label="Flip-Flops" value={question.flip_flops} />
                      <CompactMetric label="Focus Loss" value={question.focus_loss_count} />
                      <CompactMetric label="Pace" value={question.pace_label} />
                    </div>

                    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                      <p className="font-medium text-brand-dark/75">{question.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ShieldCheck className="w-8 h-8" />}
                title="No per-question trace yet"
                body="The question lab appears after a full tracked hosted game."
              />
            )}
          </SurfaceCard>

          <SurfaceCard
            title="Attention Queue"
            subtitle="The exact places where you should spend effort next."
            icon={<AlertTriangle className="w-6 h-6 text-brand-orange" />}
          >
            <div className="space-y-4">
              {shakyQuestions.length > 0 ? (
                shakyQuestions.slice(0, 5).map((question: any) => (
                  <div key={`attention-${question.question_id}`} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">
                      {question.status === 'missed' ? 'Immediate review' : 'Stabilize this answer'}
                    </p>
                    <p className="text-xl font-black mb-3">Q{question.question_index}. {question.prompt}</p>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <MetricStrip label="Stress" value={`${Number(question.stress_index || 0).toFixed(0)}%`} />
                      <MetricStrip label="Swaps" value={question.total_swaps} />
                    </div>
                    <p className="font-medium text-brand-dark/70">{question.recommendation}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.75rem] border-2 border-brand-dark bg-emerald-100 p-6">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700 mb-2">Healthy signal</p>
                  <p className="text-2xl font-black mb-2">No unstable questions were detected.</p>
                  <p className="font-medium text-brand-dark/70">
                    Your last game looked behaviorally stable. Keep practicing weak tags to convert that stability into even higher mastery.
                  </p>
                </div>
              )}

              <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-purple text-white p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70 mb-2">Adaptive note</p>
                <p className="text-2xl font-black mb-2">{overall?.practicePlan?.headline}</p>
                <p className="font-medium text-white/80 mb-4">{overall?.practicePlan?.body}</p>
                <button
                  onClick={() => navigate(`/student/practice/${nickname}`)}
                  className="px-5 py-3 bg-white text-brand-dark border-2 border-brand-dark rounded-full font-black"
                >
                  Launch Practice Round
                </button>
              </div>
            </div>
          </SurfaceCard>
        </section>
      </main>
    </div>
  );
}

function SurfaceCard({
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
    <div className="bg-white rounded-[2.4rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden">
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

function HeroMetric({ label, value, tone }: { label: string; value: string | number; tone: 'orange' | 'yellow' | 'white' | 'purple' }) {
  const tones = {
    orange: 'bg-brand-orange text-white',
    yellow: 'bg-brand-yellow text-brand-dark',
    white: 'bg-white text-brand-dark',
    purple: 'bg-brand-purple text-white',
  };

  return (
    <div className={`rounded-[1.5rem] border border-white/15 p-4 ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-2">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function InsightTile({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45">{label}</span>
        {icon}
      </div>
      <p className="text-3xl font-black mb-1">{value}</p>
      <p className="font-medium text-brand-dark/65">{helper}</p>
    </div>
  );
}

function SignalCard({
  label,
  caption,
  score,
  delta,
}: {
  label: string;
  caption: string;
  score: number;
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
          <span className={`px-3 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${delta >= 0 ? 'bg-emerald-200' : 'bg-brand-orange/15'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)} vs overall
          </span>
        )}
      </div>
      <div className="w-full h-3 rounded-full bg-white border-2 border-brand-dark/10 overflow-hidden p-[2px] mb-3">
        <div className={`h-full rounded-full ${scoreTone(score)}`} style={{ width: `${Math.max(0, Math.min(100, Number(score || 0)))}%` }} />
      </div>
      <p className="font-medium text-brand-dark/68">{caption}</p>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</p>
      <p className="text-xl font-black">{value}</p>
    </div>
  );
}

function MiniPill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark text-sm font-black">
      {label}: {value}
    </span>
  );
}

function MetricStrip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-1">{label}</p>
      <p className="text-lg font-black">{value}</p>
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

function scoreTone(score: number) {
  if (score >= 80) return 'bg-emerald-400';
  if (score >= 55) return 'bg-brand-yellow';
  return 'bg-brand-orange';
}

function masteryTone(score: number) {
  if (score >= 80) return 'bg-emerald-400';
  if (score >= 50) return 'bg-brand-yellow';
  return 'bg-brand-orange';
}

function riskTone(level?: string) {
  if (level === 'high') {
    return { chip: 'bg-brand-orange text-white' };
  }
  if (level === 'medium') {
    return { chip: 'bg-brand-yellow text-brand-dark' };
  }
  return { chip: 'bg-emerald-200 text-brand-dark' };
}

function momentumTone(direction?: string) {
  if (direction === 'up') return 'bg-emerald-100';
  if (direction === 'down') return 'bg-brand-orange/10';
  return 'bg-brand-bg';
}

function questionStatusTone(status: string) {
  if (status === 'missed') return 'bg-brand-orange text-white';
  if (status === 'shaky') return 'bg-brand-yellow text-brand-dark';
  return 'bg-emerald-200 text-brand-dark';
}
