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
import { getGameMode } from '../lib/gameModes.ts';
import { getGameModeTone } from '../lib/gameModePresentation.ts';
import { isPeerInstructionMode, requiresConfidenceLock } from '../lib/sessionModeRules.ts';
import { apiFetch, apiFetchJson, apiEventSource } from '../lib/api.ts';

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
  const [score, setScore] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);

  const [currentSelectedAnswer, setCurrentSelectedAnswer] = useState<number | null>(null);
  const [selectedConfidence, setSelectedConfidence] = useState(2);
  const [hasLockedInitialVote, setHasLockedInitialVote] = useState(false);
  const [firstRoundChoice, setFirstRoundChoice] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);

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
  const firstRoundChoiceRef = useRef<number | null>(null);

  const focusLossDebounceRef = useRef(0);
  const idleThresholdMs = 4000;

  const participantId = localStorage.getItem('participant_id');
  const nickname = localStorage.getItem('nickname');
  const avatar = localStorage.getItem('avatar') || '😎';
  const teamName = localStorage.getItem('team_name') || '';
  const savedGameType = localStorage.getItem('game_type') || '';
  const modeConfig = sessionMeta?.mode_config || sessionMeta?.modeConfig || {};
  const gameMode = getGameMode(sessionMeta?.game_type || savedGameType || 'classic_quiz');
  const gameTone = getGameModeTone(gameMode.id);
  const isPeerMode = isPeerInstructionMode(gameMode.id, modeConfig);
  const needsConfidence = requiresConfidenceLock(gameMode.id, modeConfig);
  const isInteractivePhase = status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE';
  const isSelectionLocked = hasAnswered || (isPeerMode && status === 'QUESTION_ACTIVE' && hasLockedInitialVote);

  useEffect(() => {
    firstRoundChoiceRef.current = firstRoundChoice;
  }, [firstRoundChoice]);

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
    if (isSelectionLocked || !isInteractivePhase) return;
    if (currentHoverOptionRef.current === optionIndex) return;
    flushHoverDwell();
    currentHoverOptionRef.current = optionIndex;
    hoverStartTimeRef.current = Date.now();
  };

  const recordActivity = (kind: 'pointer' | 'keyboard' | 'touch', eventTime = Date.now()) => {
    if (!isInteractivePhase || isSelectionLocked) return;

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
      const nextModeConfig = data?.mode_config || data?.modeConfig || {};
      const nextQuestion = data?.question || null;
      setStatus(nextStatus);
      setSessionMeta((current: any) => ({
        ...(current || {}),
        status: nextStatus,
        game_type: data?.game_type || current?.game_type || savedGameType || 'classic_quiz',
        mode_config: nextModeConfig && Object.keys(nextModeConfig).length ? nextModeConfig : current?.mode_config || current?.modeConfig || {},
        current_question_index: Number(data?.current_question_index ?? data?.currentQuestionIndex ?? current?.current_question_index ?? 0),
      }));

      if (nextStatus === 'QUESTION_ACTIVE') {
        setQuestion(nextQuestion);
        setHasAnswered(false);
        setHasLockedInitialVote(false);
        setFirstRoundChoice(null);
        setStartTime(Date.now());
        setTimeLeft(nextQuestion?.time_limit_seconds || 30);
        setCurrentSelectedAnswer(null);
        setSelectedConfidence(2);
        resetTelemetry();
      } else if (nextStatus === 'QUESTION_DISCUSSION') {
        if (nextQuestion) {
          setQuestion(nextQuestion);
          setTimeLeft(nextQuestion.time_limit_seconds || Number(nextModeConfig?.discussion_seconds || 30));
        } else {
          setTimeLeft(Number(nextModeConfig?.discussion_seconds || 30));
        }
        flushHoverDwell();
      } else if (nextStatus === 'QUESTION_REVOTE') {
        if (nextQuestion) {
          setQuestion(nextQuestion);
          setTimeLeft(nextQuestion.time_limit_seconds || Number(nextModeConfig?.revote_seconds || 22));
        } else {
          setTimeLeft(Number(nextModeConfig?.revote_seconds || 22));
        }
        setHasAnswered(false);
        setHasLockedInitialVote(false);
        setCurrentSelectedAnswer((current) => current ?? firstRoundChoiceRef.current);
        setSelectedConfidence(2);
        setStartTime(Date.now());
        resetTelemetry();
        if (firstRoundChoiceRef.current !== null) {
          answerHistoryRef.current = [{ index: firstRoundChoiceRef.current, timestamp: 0 }];
        }
      } else if (nextStatus === 'QUESTION_REVEAL') {
        if (nextQuestion) {
          setQuestion(nextQuestion);
          // NEW: Trigger confetti if correct and it was the reveal phase
          if (nextQuestion.correct_index === currentSelectedAnswer) {
            confetti({
              particleCount: 150,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#FFC800', '#FF5A36', '#9B51E0']
            });
          }
        }
        flushHoverDwell();
      } else if (nextStatus === 'ENDED') {
        navigate(`/student/dashboard/${nickname}`);
      }
    };

    const startEventSource = () => {
      if (cancelled || eventSource) return;

      eventSource = apiEventSource(`/api/sessions/${pin}/stream`);
      eventSource.addEventListener('STATE_CHANGE', (event) => {
        applyLiveStateChange(JSON.parse(event.data));
      });
    };

    apiFetchJson(`/api/sessions/${pin}`)
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
          mode_config: meta.modeConfig,
          current_question_index: meta.currentQuestionIndex,
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
  }, [navigate, nickname, participantId, pin, savedGameType, teamName]);

  // Timer effect & telemetry watchers
  useEffect(() => {
    if (['QUESTION_ACTIVE', 'QUESTION_DISCUSSION', 'QUESTION_REVOTE'].includes(status) && (!hasAnswered || status === 'QUESTION_DISCUSSION') && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, hasAnswered, timeLeft]);

  // Focus loss tracker
  useEffect(() => {
    const registerFocusLoss = () => {
      if (isInteractivePhase && !isSelectionLocked) {
        const now = Date.now();
        if (now - focusLossDebounceRef.current < 800) return;
        focusLossDebounceRef.current = now;
        focusLossCountRef.current += 1;
        if (blurStartRef.current === null) {
          blurStartRef.current = now;
        }
        flushHoverDwell(now);
        // Report to host
        apiFetch(`/api/sessions/${pin}/focus-loss`, {
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
  }, [hasAnswered, isInteractivePhase, isSelectionLocked, participantId, pin]);

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
  }, [isInteractivePhase, isSelectionLocked]);

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
      const response = await apiFetch(`/api/sessions/${pin}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: Number(participantId),
          question_id: question.id,
          chosen_index: finalIndex,
          response_ms: responseMs,
          confidence_level: needsConfidence ? selectedConfidence : undefined,
          telemetry
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to submit answer');
      }
      if (response.ok) {
        const scoreAwarded = Number(payload?.score_awarded || 0);
        setScore((current) => current + scoreAwarded);
        
        // NEW: Update streak
        if (scoreAwarded > 0) {
          setStreak(s => s + 1);
        } else {
          setStreak(0);
        }

        void publishAnswerProgress(String(pin || ''), {
          participantId: Number(participantId),
          totalAnswers: Number(payload?.total_answers || 0),
          expected: Number(payload?.expected || 0),
        });
      }
    } catch (err) {
      setHasAnswered(false);
      console.error(err);
    }
  };

  const handleAnswerSelect = async (index: number) => {
    if (isSelectionLocked) return;

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
      apiFetch(`/api/sessions/${pin}/selection`, {
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
    if (currentSelectedAnswer === null || isSelectionLocked) return;
    if (isPeerMode && status === 'QUESTION_ACTIVE') {
      setFirstRoundChoice(currentSelectedAnswer);
      setHasLockedInitialVote(true);
      flushHoverDwell();
      return;
    }
    if (needsConfidence && !selectedConfidence) return;
    submitAnswer(currentSelectedAnswer, answerHistoryRef.current);
  };

  if (status === 'LOBBY') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 sm:p-8 text-brand-dark text-center overflow-x-clip relative selection:bg-brand-orange selection:text-white">
        {/* Exit Button */}
        <button
          onClick={() => navigate(`/student/dashboard/${nickname}`)}
          className="absolute left-4 top-4 sm:left-8 sm:top-8 z-50 flex items-center gap-2 bg-white border-2 border-brand-dark hover:bg-brand-yellow px-4 py-2 rounded-full shadow-[2px_2px_0px_0px_#1A1A1A] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all font-bold"
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
          className="relative z-10 bg-white border-4 border-brand-dark rounded-[2.2rem] sm:rounded-[3rem] p-6 sm:p-12 shadow-[16px_16px_0px_0px_#1A1A1A] max-w-lg w-full flex flex-col items-center"
        >
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center text-5xl sm:text-6xl mb-6 sm:mb-8 shadow-[8px_8px_0px_0px_#1A1A1A] -rotate-6">
            {avatar}
          </div>
          <h2 className="text-4xl sm:text-5xl font-black mb-2 tracking-tight">You're in!</h2>
          <p className="text-lg sm:text-xl font-bold text-brand-dark/60 mb-6 sm:mb-8">Waiting for the host to start...</p>

          <div className="space-y-4 w-full">
            <div className="bg-brand-bg px-5 sm:px-8 py-4 rounded-full border-2 border-brand-dark/20 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <span className="text-sm font-bold text-brand-dark/50 uppercase tracking-widest">Playing as</span>
              <span className="text-xl sm:text-2xl font-black">{nickname}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LobbyMetaCard label="Game Type" value={gameMode.label} />
              <LobbyMetaCard label="Team" value={teamName || (gameMode.teamBased ? 'Auto team' : 'Solo')} />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'QUESTION_DISCUSSION') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 sm:p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-x-clip">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

        <motion.div
          initial={{ scale: 0.88, opacity: 0, y: 18 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="relative z-10 bg-white border-4 border-brand-dark rounded-[2.4rem] p-6 sm:p-10 lg:p-14 shadow-[16px_16px_0px_0px_#1A1A1A] max-w-4xl w-full"
        >
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </span>
            <span className="px-4 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark font-black text-sm">
              Discussion round
            </span>
            <span className="px-4 py-2 rounded-full bg-brand-dark text-white border-2 border-brand-dark font-black text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-yellow" />
              {timeLeft}s
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-brand-dark tracking-tight mb-4">
            Compare answers with your pod
          </h2>
          <p className="text-lg sm:text-xl font-bold text-brand-dark/65 mb-8 max-w-3xl mx-auto">
            Explain why you chose your answer, listen for stronger reasoning, and get ready for the final revote.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mb-8">
            <div className="rounded-[1.8rem] border-4 border-brand-dark bg-brand-bg p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Your first vote</p>
              <p className="text-2xl font-black text-brand-dark">
                {firstRoundChoice !== null ? question?.answers?.[firstRoundChoice] : 'No vote locked yet'}
              </p>
            </div>
            <div className="rounded-[1.8rem] border-4 border-brand-dark bg-brand-yellow p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/60 mb-3">Pod prompt</p>
              <p className="text-2xl font-black text-brand-dark">{teamName || 'Discuss with nearby teammates'}</p>
            </div>
          </div>

          <div className="rounded-[2rem] border-4 border-brand-dark bg-brand-dark text-white p-6 text-left">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-3">Question</p>
            <p className="text-2xl sm:text-3xl font-black mb-5">{question?.prompt}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {question?.answers?.map((answer: string, index: number) => (
                <div
                  key={index}
                  className={`rounded-[1.4rem] border-2 p-4 font-black text-lg ${firstRoundChoice === index ? 'bg-brand-yellow text-brand-dark border-brand-dark' : 'bg-white/10 border-white/10 text-white'}`}
                >
                  {answer}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE') {
    const isRevote = status === 'QUESTION_REVOTE';
    const showWaitCard = hasAnswered || (isPeerMode && status === 'QUESTION_ACTIVE' && hasLockedInitialVote);
    const waitTitle = hasAnswered ? 'Answer submitted!' : 'First vote locked!';
    const waitBody = hasAnswered
      ? 'Waiting for the rest of the class to finish...'
      : 'Hold your choice for now. Discussion opens as soon as the round ends.';
    const stageTitle = isRevote ? 'Final revote' : isPeerMode ? 'Silent first vote' : 'Live question';
    const stageBody = isRevote
      ? 'You can keep or change your first answer before the final submit.'
      : isPeerMode
        ? 'Choose privately first. No discussion yet.'
        : gameMode.quickSummary;
    const lockLabel = isRevote
      ? 'Submit Final Answer'
      : isPeerMode
        ? 'Lock First Vote'
        : needsConfidence
          ? 'Lock Answer + Confidence'
          : 'Lock It In';

    if (showWaitCard) {
      return (
        <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 sm:p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-x-clip">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10 bg-white p-6 sm:p-12 lg:p-16 rounded-[2.2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-xl w-full"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              className="inline-block mb-10"
            >
              <div className="w-24 h-24 sm:w-32 sm:h-32 bg-brand-yellow rounded-full border-4 border-brand-dark flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Clock className="w-12 h-12 sm:w-16 sm:h-16 text-brand-dark" />
              </div>
            </motion.div>
            <h2 className="text-4xl sm:text-5xl font-black text-brand-dark tracking-tight mb-6">{waitTitle}</h2>
            <p className="text-xl sm:text-2xl text-brand-dark/60 font-bold">{waitBody}</p>

            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <span className={`px-5 py-3 rounded-full border-2 border-brand-dark font-black ${gameTone.pill}`}>
                {stageTitle}
              </span>
              <span className="px-5 py-3 rounded-full border-2 border-brand-dark bg-brand-bg font-black text-brand-dark">
                {timeLeft}s left
              </span>
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-brand-bg flex flex-col p-4 sm:p-6 md:p-10 selection:bg-brand-orange selection:text-white relative overflow-hidden">
        {/* Dynamic Background Pattern */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]">
          <motion.div 
            animate={{ 
              rotate: [0, 360],
              scale: [1, 1.1, 1]
            }}
            transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
            className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%]"
            style={{ 
              backgroundImage: `radial-gradient(circle at center, #1A1A1A 2px, transparent 2px)`,
              backgroundSize: timeLeft < 5 ? '20px 20px' : '40px 40px',
              transition: 'background-size 0.5s ease'
            }}
          />
        </div>

        {/* Top HUD */}
        <div className="relative z-10 mb-8 max-w-6xl mx-auto w-full flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <div className="flex flex-wrap items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.1, rotate: -5 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                if (window.confirm('Are you sure you want to leave the game?')) {
                  navigate(`/student/dashboard/${nickname}`);
                }
              }}
              className="w-14 h-14 flex items-center justify-center bg-white border-4 border-brand-dark rounded-2xl shadow-[4px_4px_0px_0px_#1A1A1A] transition-all hover:bg-brand-orange hover:text-white"
            >
              <XCircle className="w-7 h-7" />
            </motion.button>
            <div className="flex items-center gap-4 bg-white px-6 py-3.5 rounded-2xl border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
              <span className="text-3xl">{avatar}</span>
              <span className="font-black text-xl lg:text-2xl">{nickname}</span>
            </div>
            {(teamName || isTeamGameLabel(sessionMeta?.game_type || savedGameType)) && (
              <div className="flex items-center gap-3 bg-brand-yellow px-6 py-3.5 rounded-2xl border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Sparkles className="w-6 h-6 text-brand-dark" />
                <span className="font-black text-lg">{teamName || 'Team mode'}</span>
              </div>
            )}
          </div>

          <motion.div 
            animate={timeLeft < 5 ? {
              rotate: [0, -2, 2, -2, 2, 0],
              scale: [1, 1.1, 1]
            } : {}}
            transition={timeLeft < 5 ? { duration: 0.4, repeat: Infinity } : {}}
            className={`flex items-center gap-4 bg-brand-dark text-white px-8 py-3.5 rounded-2xl border-4 border-brand-dark shadow-[6px_6px_0px_0px_#FF5A36] transition-transform`}
          >
            <Clock className={`w-8 h-8 ${timeLeft < 5 ? 'text-brand-orange' : 'text-brand-yellow'}`} />
            <span className={`font-black text-3xl w-10 text-center ${timeLeft < 5 ? 'text-brand-orange' : ''}`}>{timeLeft}</span>
          </motion.div>

          <div className="flex items-center gap-4 bg-white px-8 py-3.5 rounded-2xl border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A]">
            <Trophy className="w-8 h-8 text-brand-yellow fill-current" />
            <span className="font-black text-2xl">{score}</span>
          </div>

          {/* NEW: Streak Indicator */}
          {streak >= 2 && (
            <motion.div 
              initial={{ x: 50, opacity: 0, scale: 0.5 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              className="flex items-center gap-3 bg-brand-orange text-white px-6 py-3.5 rounded-2xl border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A]"
            >
              <Flame className="w-8 h-8 animate-pulse text-brand-yellow fill-current" />
              <div className="flex flex-col leading-none">
                <span className="text-[10px] font-black uppercase tracking-tighter opacity-70">On Fire</span>
                <span className="font-black text-2xl">{streak} Streak!</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Question Area */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative z-10 bg-white rounded-[2.5rem] p-8 sm:p-12 lg:p-14 border-4 border-brand-dark mb-8 text-center shadow-[16px_16px_0px_0px_#1A1A1A] max-w-6xl mx-auto w-full overflow-hidden"
        >
          {/* Progress Bar */}
          <div className="absolute top-0 left-0 w-full h-3 bg-brand-dark/5">
            <motion.div
              className={`h-full ${timeLeft < 5 ? 'bg-brand-orange' : 'bg-brand-purple'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${(timeLeft / Math.max(1, Number(question?.time_limit_seconds || 30))) * 100}%` }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-6">
            <div className={`px-4 py-1.5 rounded-full border-2 border-brand-dark text-xs font-black uppercase tracking-widest ${gameTone.pill}`}>
              {gameMode.shortLabel}
            </div>
            <div className="px-4 py-1.5 rounded-full bg-brand-bg border-2 border-brand-dark text-xs font-black uppercase tracking-widest text-brand-dark/60">
              {stageTitle}
            </div>
          </div>
          
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-black text-brand-dark leading-tight mb-4 tracking-tight">
            {question?.prompt}
          </h2>
          <p className="text-lg sm:text-xl font-bold text-brand-dark/40 max-w-3xl mx-auto">{stageBody}</p>
        </motion.div>

        {/* Confidence Check */}
        {needsConfidence && (
          <div className="relative z-10 max-w-6xl mx-auto w-full mb-8">
            <div className="bg-brand-bg/50 backdrop-blur-md rounded-[2.5rem] border-4 border-brand-dark/10 p-6 flex flex-col md:flex-row items-center gap-6">
              <div className="shrink-0 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-brand-purple border-4 border-brand-dark flex items-center justify-center">
                  <Flame className="w-6 h-6 text-white" />
                </div>
                <span className="font-black text-sm uppercase tracking-widest">Confidence</span>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                {[
                  { id: 1, label: 'GUESS', icon: '🤔' },
                  { id: 2, label: 'SURE', icon: '👍' },
                  { id: 3, label: 'EXPERT', icon: '🧠' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSelectedConfidence(option.id)}
                    className={`px-6 py-4 rounded-2xl border-4 font-black flex items-center justify-center gap-3 transition-all ${
                      selectedConfidence === option.id
                        ? 'bg-brand-purple text-white border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] scale-105'
                        : 'bg-white text-brand-dark border-brand-dark/10 hover:border-brand-dark'
                    }`}
                  >
                    <span>{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Answers Grid */}
        <div className="relative z-10 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto w-full mb-12">
          <AnimatePresence mode="popLayout">
            {question?.answers?.map((ans: string, i: number) => {
              const isSelected = currentSelectedAnswer === i;
              return (
                <motion.button
                  key={`ans-${i}`}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ 
                    scale: isSelected ? 1.02 : 1, 
                    opacity: 1,
                    y: isSelected ? -4 : 0
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  onClick={() => handleAnswerSelect(i)}
                  onMouseEnter={() => beginHoverDwell(i)}
                  onMouseLeave={() => flushHoverDwell()}
                  className={`
                    group relative flex min-h-[140px] md:min-h-[180px] items-center justify-center p-8 text-2xl md:text-4xl font-black rounded-[2.5rem] border-4 transition-all
                    ${isSelected 
                      ? 'bg-brand-dark text-white border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36]' 
                      : `${COLORS[i % 4].bg} ${COLORS[i % 4].text} border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] hover:translate-x-1 hover:translate-y-1 hover:shadow-none`
                    }
                  `}
                >
                  <div className="absolute top-6 left-8 text-sm opacity-20 font-black tracking-widest">0{i + 1}</div>
                  <span className="relative z-10">{ans}</span>
                  
                  {/* Selection Indicator */}
                  {isSelected && (
                    <motion.div 
                      layoutId="choice-spark"
                      className="absolute inset-0 border-8 border-brand-orange/30 rounded-[2.5rem] pointer-events-none"
                    />
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Final Lock-in Action */}
        <AnimatePresence>
          {currentSelectedAnswer !== null && !hasAnswered && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-8 left-0 right-0 flex justify-center z-50 px-6"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleLockIn}
                className="w-full max-w-lg bg-brand-dark text-white py-6 rounded-full border-4 border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36] flex items-center justify-center gap-5 group overflow-hidden relative"
              >
                <div className="absolute inset-0 bg-brand-orange/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <CheckCircle className="w-10 h-10 text-brand-yellow group-hover:scale-125 transition-transform relative z-10" />
                <span className="text-2xl md:text-3xl font-black relative z-10">{lockLabel}</span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (status === 'QUESTION_REVEAL') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 sm:p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-x-clip">
        {/* Animated background patterns */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

        <motion.div
          initial={{ scale: 0.8, opacity: 0, rotate: 10 }}
          animate={{ scale: 1, opacity: 1, rotate: -2 }}
          className="relative z-10 bg-brand-purple p-6 sm:p-10 lg:p-16 rounded-[2.2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-2xl w-full"
        >
          <div className="flex justify-center mb-6">
            <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </span>
          </div>
          <div className="inline-flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 bg-white border-4 border-brand-dark rounded-full mb-8 sm:mb-10 shadow-[8px_8px_0px_0px_#1A1A1A] rotate-12">
            <Flame className="w-12 h-12 sm:w-16 sm:h-16 text-brand-orange" />
          </div>
          <h2 className="text-4xl xs:text-5xl md:text-7xl font-black text-white mb-8 tracking-tight">Time's Up!</h2>
          <div className="bg-white/20 p-6 rounded-2xl border-2 border-white/30 backdrop-blur-sm">
            <p className="text-xl sm:text-2xl text-white font-bold">Look at the main screen to see the correct answer and your points.</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4 sm:p-8 text-center selection:bg-brand-orange selection:text-white relative overflow-x-clip">
        {/* Animated background patterns */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}></div>

        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.6 }}
          className="relative z-10 bg-white p-6 sm:p-10 lg:p-16 rounded-[2.2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-2xl w-full"
        >
          <div className="flex justify-center mb-6">
            <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </span>
          </div>
          <div className="inline-flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 bg-brand-yellow border-4 border-brand-dark rounded-full mb-8 sm:mb-10 shadow-[8px_8px_0px_0px_#1A1A1A]">
            <Trophy className="w-12 h-12 sm:w-16 sm:h-16 text-brand-dark" />
          </div>
          <h2 className="text-4xl xs:text-5xl md:text-7xl font-black mb-8 tracking-tight text-brand-dark">Leaderboard</h2>
          <div className="bg-brand-bg p-5 sm:p-8 rounded-[2rem] border-4 border-brand-dark/10">
            <p className="text-2xl sm:text-3xl text-brand-dark/80 font-bold mb-4">Check the main screen!</p>
            <p className="text-lg sm:text-xl text-brand-dark/50 font-medium">Did you make it to the top 5?</p>
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
