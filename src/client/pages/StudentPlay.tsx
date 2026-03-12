import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Trophy, Sparkles, Flame, Star, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';
import {
  attachParticipantPresence,
  publishAnswerProgress,
  publishFocusAlert,
  publishLiveSelection,
  subscribeToStudentSessionRealtime,
} from '../lib/firebaseRealtime.ts';

const COLORS = [
  { bg: 'bg-brand-purple', text: 'text-white', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-brand-yellow', text: 'text-brand-dark', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-brand-orange', text: 'text-white', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-white', text: 'text-brand-dark', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' }
];

function isTeamGameLabel(gameType?: string) {
  return ['team_relay', 'peer_pods', 'mastery_matrix'].includes(String(gameType || ''));
}

export default function StudentPlay() {
  const { pin } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState('LOBBY');
  const [question, setQuestion] = useState<any>(null);
  const [sessionMeta, setSessionMeta] = useState<any>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);

  const [currentSelectedAnswer, setCurrentSelectedAnswer] = useState<number | null>(null);

  const firstInteractionMsRef = useRef<number | null>(null);
  const answerHistoryRef = useRef<{ index: number; timestamp: number }[]>([]);
  const focusLossCountRef = useRef(0);
  const idleTimeMsRef = useRef(0);
  const longestIdleStreakRef = useRef(0);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const blurTimeMsRef = useRef(0);
  const blurStartRef = useRef<number | null>(null);
  const pointerActivityCountRef = useRef(0);
  const keyboardActivityCountRef = useRef(0);
  const touchActivityCountRef = useRef(0);
  const sameAnswerReclicksRef = useRef(0);
  const optionDwellRef = useRef<Record<number, number>>({});
  const currentHoverOptionRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const lastPointerTrackedAtRef = useRef(0);

  const focusLossDebounceRef = useRef(0);
  const idleThresholdMs = 4000;

  const participantId = localStorage.getItem('participant_id');
  const nickname = localStorage.getItem('nickname');
  const avatar = localStorage.getItem('avatar') || '😎';
  const teamName = localStorage.getItem('team_name') || '';
  const savedGameType = localStorage.getItem('game_type') || '';

  const resetTelemetry = () => {
    firstInteractionMsRef.current = null;
    answerHistoryRef.current = [];
    focusLossCountRef.current = 0;
    idleTimeMsRef.current = 0;
    longestIdleStreakRef.current = 0;
    lastActivityTimeRef.current = Date.now();
    blurTimeMsRef.current = 0;
    blurStartRef.current = null;
    pointerActivityCountRef.current = 0;
    keyboardActivityCountRef.current = 0;
    touchActivityCountRef.current = 0;
    sameAnswerReclicksRef.current = 0;
    optionDwellRef.current = {};
    currentHoverOptionRef.current = null;
    hoverStartTimeRef.current = null;
  };

  const flushHoverDwell = (forcedTimestamp?: number) => {
    const optionIndex = currentHoverOptionRef.current;
    const hoverStartedAt = hoverStartTimeRef.current;
    if (optionIndex === null || hoverStartedAt === null) return;
    const endedAt = forcedTimestamp ?? Date.now();
    optionDwellRef.current = {
      ...optionDwellRef.current,
      [optionIndex]: (optionDwellRef.current[optionIndex] || 0) + Math.max(0, endedAt - hoverStartedAt),
    };
    currentHoverOptionRef.current = null;
    hoverStartTimeRef.current = null;
  };

  const beginHoverDwell = (optionIndex: number) => {
    if (hasAnswered || status !== 'QUESTION_ACTIVE') return;
    if (currentHoverOptionRef.current === optionIndex) return;
    flushHoverDwell();
    currentHoverOptionRef.current = optionIndex;
    hoverStartTimeRef.current = Date.now();
  };

  const recordActivity = (kind: 'pointer' | 'keyboard' | 'touch', eventTime = Date.now()) => {
    if (status !== 'QUESTION_ACTIVE' || hasAnswered) return;

    const idleGap = eventTime - lastActivityTimeRef.current;
    if (idleGap > idleThresholdMs) {
      const idleSpan = idleGap - idleThresholdMs;
      idleTimeMsRef.current += idleSpan;
      longestIdleStreakRef.current = Math.max(longestIdleStreakRef.current, idleSpan);
    }
    lastActivityTimeRef.current = eventTime;

    if (kind === 'pointer') {
      if (eventTime - lastPointerTrackedAtRef.current < 250) return;
      lastPointerTrackedAtRef.current = eventTime;
      pointerActivityCountRef.current += 1;
      return;
    }
    if (kind === 'keyboard') {
      keyboardActivityCountRef.current += 1;
      return;
    }
    touchActivityCountRef.current += 1;
  };

  useEffect(() => {
    if (!participantId || !nickname) {
      navigate('/');
      return;
    }

    let cancelled = false;
    let realtimeCleanup: (() => void) | null = null;
    let presenceCleanup: (() => void) | null = null;
    let eventSource: EventSource | null = null;

    const applyLiveStateChange = (data: any) => {
      const nextStatus = data?.status || 'LOBBY';
      setStatus(nextStatus);
      setSessionMeta((current: any) => ({
        ...(current || {}),
        status: nextStatus,
        game_type: data?.game_type || current?.game_type || savedGameType || 'classic_quiz',
        current_question_index: Number(data?.current_question_index ?? data?.currentQuestionIndex ?? current?.current_question_index ?? 0),
      }));

      if (nextStatus === 'QUESTION_ACTIVE') {
        setQuestion(data.question);
        setHasAnswered(false);
        setIsCorrect(null);
        setStartTime(Date.now());
        setTimeLeft(data.question?.time_limit_seconds || 30);
        setCurrentSelectedAnswer(null);
        resetTelemetry();
      } else if (nextStatus === 'QUESTION_REVEAL') {
        if (data?.question) {
          setQuestion(data.question);
        }
        flushHoverDwell();
      } else if (nextStatus === 'ENDED') {
        navigate(`/student/dashboard/${nickname}`);
      }
    };

    const startEventSource = () => {
      if (cancelled || eventSource) return;

      eventSource = new EventSource(`/api/sessions/${pin}/stream`);
      eventSource.addEventListener('STATE_CHANGE', (event) => {
        applyLiveStateChange(JSON.parse(event.data));
      });
    };

    fetch(`/api/sessions/${pin}`)
      .then((res) => res.json())
      .then((data) => setSessionMeta(data))
      .catch((error) => console.error('Failed to load session meta:', error));

    void attachParticipantPresence(String(pin || ''), {
      participantId: Number(participantId),
      nickname,
      teamName: teamName || null,
      createdAt: new Date().toISOString(),
      online: true,
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.();
        return;
      }
      if (cleanup) {
        presenceCleanup = cleanup;
      }
    });

    void subscribeToStudentSessionRealtime(String(pin || ''), {
      onMeta: (meta) => {
        if (!meta) return;
        applyLiveStateChange({
          status: meta.status,
          question: meta.question,
          game_type: meta.gameType,
        });
      },
      onError: () => {
        startEventSource();
      },
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.();
        return;
      }
      if (cleanup) {
        realtimeCleanup = cleanup;
      } else {
        startEventSource();
      }
    });

    return () => {
      cancelled = true;
      realtimeCleanup?.();
      presenceCleanup?.();
      eventSource?.close();
    };
  }, [pin, navigate, participantId, nickname]);

  // Timer effect & telemetry watchers
  useEffect(() => {
    if (status === 'QUESTION_ACTIVE' && !hasAnswered && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, hasAnswered, timeLeft]);

  // Focus loss tracker
  useEffect(() => {
    const registerFocusLoss = () => {
      if (status === 'QUESTION_ACTIVE' && !hasAnswered) {
        const now = Date.now();
        if (now - focusLossDebounceRef.current < 800) return;
        focusLossDebounceRef.current = now;
        focusLossCountRef.current += 1;
        if (blurStartRef.current === null) {
          blurStartRef.current = now;
        }
        flushHoverDwell(now);
        // Report to host
        fetch(`/api/sessions/${pin}/focus-loss`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participant_id: Number(participantId) })
        }).catch(err => console.error('Focus loss report failed:', err));
        void publishFocusAlert(String(pin || ''), {
          participantId: Number(participantId),
          nickname: String(nickname || ''),
        });
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        registerFocusLoss();
      } else if (blurStartRef.current !== null) {
        blurTimeMsRef.current += Math.max(0, Date.now() - blurStartRef.current);
        blurStartRef.current = null;
      }
    };
    const handleFocusRestore = () => {
      if (blurStartRef.current !== null) {
        blurTimeMsRef.current += Math.max(0, Date.now() - blurStartRef.current);
        blurStartRef.current = null;
      }
    };
    window.addEventListener('blur', registerFocusLoss);
    window.addEventListener('focus', handleFocusRestore);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', registerFocusLoss);
      window.removeEventListener('focus', handleFocusRestore);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [status, hasAnswered, participantId, pin]);

  // Idle time tracker
  useEffect(() => {
    const handleMouseMove = () => recordActivity('pointer');
    const handlePointerDown = () => recordActivity('pointer');
    const handleTouch = () => recordActivity('touch');
    const handleKeyDown = () => recordActivity('keyboard');

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('touchstart', handleTouch);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('touchstart', handleTouch);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasAnswered, status]);

  // Submit final answer to server with telemetry
  const submitAnswer = async (finalIndex: number, submitHistory: any[]) => {
    if (hasAnswered) return;
    setHasAnswered(true);

    const submitTime = Date.now();
    flushHoverDwell(submitTime);
    if (blurStartRef.current !== null) {
      blurTimeMsRef.current += Math.max(0, submitTime - blurStartRef.current);
      blurStartRef.current = null;
    }
    const responseMs = submitTime - startTime;
    const timeLimitMs = (question?.time_limit_seconds || 30) * 1000;
    const tfi = firstInteractionMsRef.current || responseMs;
    const lastChangeTimestamp = submitHistory.length > 0 ? submitHistory[submitHistory.length - 1].timestamp : responseMs;
    const commitWindowMs = Math.max(0, responseMs - lastChangeTimestamp);
    const pendingIdleMs = Math.max(0, submitTime - lastActivityTimeRef.current - idleThresholdMs);
    const longestIdleStreakMs = Math.max(longestIdleStreakRef.current, pendingIdleMs);

    const totalSwaps = submitHistory.reduce((count: number, item: { index: number }, index: number, history: { index: number }[]) => {
      if (index === 0) return count;
      return history[index - 1].index !== item.index ? count + 1 : count;
    }, 0);
    const panicSwaps = submitHistory.reduce((count: number, item: { timestamp: number }, index: number) => {
      if (index === 0) return count;
      return timeLimitMs - item.timestamp <= 5000 ? count + 1 : count;
    }, 0);

    const telemetry = {
      tfi_ms: tfi,
      final_decision_buffer_ms: commitWindowMs,
      total_swaps: totalSwaps,
      panic_swaps: panicSwaps,
      answer_path_json: JSON.stringify(submitHistory),
      focus_loss_count: focusLossCountRef.current,
      idle_time_ms: idleTimeMsRef.current + pendingIdleMs,
      blur_time_ms: blurTimeMsRef.current,
      longest_idle_streak_ms: longestIdleStreakMs,
      pointer_activity_count: pointerActivityCountRef.current,
      keyboard_activity_count: keyboardActivityCountRef.current,
      touch_activity_count: touchActivityCountRef.current,
      same_answer_reclicks: sameAnswerReclicksRef.current,
      option_dwell_json: JSON.stringify(optionDwellRef.current),
    };

    try {
      const response = await fetch(`/api/sessions/${pin}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: Number(participantId),
          question_id: question.id,
          chosen_index: finalIndex,
          response_ms: responseMs,
          telemetry
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to submit answer');
      }
      if (response.ok) {
        setScore((current) => current + Number(payload?.score_awarded || 0));
        void publishAnswerProgress(String(pin || ''), {
          participantId: Number(participantId),
          totalAnswers: Number(payload?.total_answers || 0),
          expected: Number(payload?.expected || 0),
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAnswerSelect = async (index: number) => {
    if (hasAnswered) return;

    const now = Date.now();
    if (!firstInteractionMsRef.current) firstInteractionMsRef.current = now - startTime;
    recordActivity('pointer', now);
    beginHoverDwell(index);
    if (currentSelectedAnswer === index) {
      sameAnswerReclicksRef.current += 1;
      return;
    }

    setCurrentSelectedAnswer(index);
    answerHistoryRef.current = [...answerHistoryRef.current, { index, timestamp: now - startTime }];
    lastActivityTimeRef.current = now;

    // Broadcast selection change to host for real-time "thinking" pulse
    try {
      fetch(`/api/sessions/${pin}/selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: Number(participantId),
          chosen_index: index
        })
      });
      void publishLiveSelection(String(pin || ''), {
        participantId: Number(participantId),
        nickname: String(nickname || ''),
        chosenIndex: index,
      });
    } catch (err) {
      console.error('Failed to broadcast selection:', err);
    }
  };

  const handleLockIn = () => {
    if (currentSelectedAnswer === null || hasAnswered) return;
    submitAnswer(currentSelectedAnswer, answerHistoryRef.current);
  };

  if (status === 'LOBBY') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8 text-brand-dark text-center overflow-hidden relative selection:bg-brand-orange selection:text-white">
        {/* Exit Button */}
        <button
          onClick={() => navigate(`/student/dashboard/${nickname}`)}
          className="absolute top-8 left-8 z-50 flex items-center gap-2 bg-white border-2 border-brand-dark hover:bg-brand-yellow px-4 py-2 rounded-full shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all font-bold"
        >
          <XCircle className="w-5 h-5" />
          Leave Game
        </button>

        {/* Decorative elements */}
        <div className="absolute top-10 left-10 w-24 h-24 bg-brand-yellow rounded-full border-4 border-brand-dark opacity-50 animate-pulse"></div>
        <div className="absolute bottom-20 right-20 w-32 h-32 bg-brand-purple rounded-full border-4 border-brand-dark opacity-50 animate-bounce"></div>
        <div className="absolute top-1/4 right-1/4 w-16 h-16 bg-brand-orange rounded-full border-4 border-brand-dark opacity-50"></div>

        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0.5 }}
          className="relative z-10 bg-white border-4 border-brand-dark rounded-[3rem] p-12 shadow-[16px_16px_0px_0px_#1A1A1A] max-w-lg w-full flex flex-col items-center"
        >
          <div className="w-32 h-32 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center text-6xl mb-8 shadow-[8px_8px_0px_0px_#1A1A1A] -rotate-6">
            {avatar}
          </div>
          <h2 className="text-5xl font-black mb-2 tracking-tight">You're in!</h2>
          <p className="text-xl font-bold text-brand-dark/60 mb-8">Waiting for the host to start...</p>

          <div className="space-y-4 w-full">
            <div className="bg-brand-bg px-8 py-4 rounded-full border-2 border-brand-dark/20 flex items-center justify-center gap-4">
              <span className="text-sm font-bold text-brand-dark/50 uppercase tracking-widest">Playing as</span>
              <span className="text-2xl font-black">{nickname}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LobbyMetaCard label="Game Type" value={sessionMeta?.game_type || savedGameType || 'classic_quiz'} />
              <LobbyMetaCard label="Team" value={teamName || 'Solo'} />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'QUESTION_ACTIVE') {
    if (hasAnswered) {
      return (
        <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-hidden">
          {/* Animated background patterns */}
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10 bg-white p-16 rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-xl w-full"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="inline-block mb-10"
            >
              <div className="w-32 h-32 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Clock className="w-16 h-16 text-brand-dark" />
              </div>
            </motion.div>
            <h2 className="text-5xl font-black text-brand-dark tracking-tight mb-6">Answer submitted!</h2>
            <p className="text-2xl text-brand-dark/60 font-bold">Waiting for others to finish...</p>

            <div className="mt-12 inline-flex items-center gap-2 bg-brand-bg px-6 py-3 rounded-full border-2 border-brand-dark/20">
              <Zap className="w-5 h-5 text-brand-orange" />
              <span className="font-bold text-brand-dark/70">You answered in {(30 - timeLeft)}s</span>
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-brand-bg flex flex-col p-4 md:p-8 selection:bg-brand-orange selection:text-white">
        {/* Top Bar */}
        <div className="flex justify-between items-center mb-8 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to leave the game?')) {
                  navigate(`/student/dashboard/${nickname}`);
                }
              }}
              className="w-12 h-12 flex items-center justify-center bg-white border-4 border-brand-dark rounded-full hover:bg-brand-orange hover:text-white transition-colors shadow-[4px_4px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none"
              title="Leave Game"
            >
              <XCircle className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-4 bg-white px-6 py-3 rounded-full border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
              <span className="text-2xl">{avatar}</span>
              <span className="font-black text-xl">{nickname}</span>
            </div>
            {(teamName || isTeamGameLabel(sessionMeta?.game_type || savedGameType)) && (
              <div className="hidden lg:flex items-center gap-3 bg-brand-yellow px-5 py-3 rounded-full border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Sparkles className="w-5 h-5 text-brand-dark" />
                <span className="font-black">{teamName || 'Team mode'}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 bg-brand-dark text-white px-6 py-3 rounded-full border-4 border-brand-dark shadow-[4px_4px_0px_0px_#FF5A36]">
            <Clock className="w-6 h-6 text-brand-yellow" />
            <span className="font-black text-2xl w-8 text-center">{timeLeft}</span>
          </div>

          <div className="flex items-center gap-3 bg-white px-6 py-3 rounded-full border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
            <Star className="w-6 h-6 text-brand-orange fill-current" />
            <span className="font-black text-xl">{score}</span>
          </div>
        </div>

        {/* Question Card */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white rounded-[3rem] p-12 border-4 border-brand-dark mb-10 text-center shadow-[12px_12px_0px_0px_#1A1A1A] max-w-6xl mx-auto w-full relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-2 bg-brand-dark/10">
            <motion.div
              className="h-full bg-brand-orange"
              initial={{ width: '100%' }}
              animate={{ width: `${(timeLeft / Math.max(1, Number(question?.time_limit_seconds || 30))) * 100}%` }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </div>
          <h2 className="text-4xl md:text-6xl font-black text-brand-dark leading-tight">{question?.prompt}</h2>
        </motion.div>

        {/* Answers Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto w-full">
          <AnimatePresence>
            {question?.answers?.map((ans: string, i: number) => (
              <motion.button
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ delay: i * 0.1, type: 'spring', bounce: 0.4 }}
                key={i}
                onClick={() => handleAnswerSelect(i)}
                onMouseEnter={() => beginHoverDwell(i)}
                onMouseLeave={() => flushHoverDwell()}
                onFocus={() => beginHoverDwell(i)}
                onBlur={() => flushHoverDwell()}
                className={`${COLORS[i % 4].bg} ${COLORS[i % 4].text} border-4 ${COLORS[i % 4].border} rounded-[3rem] flex items-center justify-center p-10 text-3xl md:text-4xl font-black ${COLORS[i % 4].shadow} hover:translate-y-[4px] hover:translate-x-[4px] hover:shadow-[4px_4px_0px_0px_#1A1A1A] active:shadow-none active:translate-y-[8px] active:translate-x-[8px] transition-all relative overflow-hidden group`}
              >
                {/* Decorative shape on hover */}
                <div className="absolute -right-10 -bottom-10 w-32 h-32 bg-black/10 rounded-full scale-0 group-hover:scale-100 transition-transform duration-500"></div>

                <span className="relative z-10">{ans}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>

        {/* Lock In Button */}
        <AnimatePresence>
          {currentSelectedAnswer !== null && !hasAnswered && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-8 left-0 right-0 flex justify-center z-50 px-4"
            >
              <button
                onClick={handleLockIn}
                className="bg-brand-dark text-white text-3xl font-black px-12 py-6 rounded-full border-4 border-brand-dark shadow-[8px_8px_0px_0px_#FF5A36] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none active:translate-y-[4px] active:translate-x-[4px] transition-all flex items-center gap-4 group"
              >
                <CheckCircle className="w-8 h-8 text-brand-yellow group-hover:scale-125 transition-transform" />
                LOCK IT IN!
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (status === 'QUESTION_REVEAL') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-hidden">
        {/* Animated background patterns */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

        <motion.div
          initial={{ scale: 0.8, opacity: 0, rotate: 10 }}
          animate={{ scale: 1, opacity: 1, rotate: -2 }}
          className="relative z-10 bg-brand-purple p-16 rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-2xl w-full"
        >
          <div className="inline-flex items-center justify-center w-32 h-32 bg-white border-4 border-brand-dark rounded-full mb-10 shadow-[8px_8px_0px_0px_#1A1A1A] rotate-12">
            <Flame className="w-16 h-16 text-brand-orange" />
          </div>
          <h2 className="text-6xl md:text-7xl font-black text-white mb-8 tracking-tight">Time's Up!</h2>
          <div className="bg-white/20 p-6 rounded-2xl border-2 border-white/30 backdrop-blur-sm">
            <p className="text-2xl text-white font-bold">Look at the main screen to see the correct answer and your points.</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-hidden">
        {/* Animated background patterns */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.6 }}
          className="relative z-10 bg-white p-16 rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-2xl w-full"
        >
          <div className="inline-flex items-center justify-center w-32 h-32 bg-brand-yellow border-4 border-brand-dark rounded-full mb-10 shadow-[8px_8px_0px_0px_#1A1A1A]">
            <Trophy className="w-16 h-16 text-brand-dark" />
          </div>
          <h2 className="text-6xl md:text-7xl font-black mb-8 tracking-tight text-brand-dark">Leaderboard</h2>
          <div className="bg-brand-bg p-8 rounded-[2rem] border-4 border-brand-dark/10">
            <p className="text-3xl text-brand-dark/80 font-bold mb-4">Check the main screen!</p>
            <p className="text-xl text-brand-dark/50 font-medium">Did you make it to the top 5?</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return null;
}

function LobbyMetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 text-left">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{label}</p>
      <p className="text-xl font-black capitalize break-words">{String(value || '').replace(/_/g, ' ')}</p>
    </div>
  );
}
