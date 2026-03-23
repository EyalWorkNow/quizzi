import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Clock, Flame, LoaderCircle, Sparkles, Trophy, Wifi, WifiOff, XCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';
import Avatar, { extractNickname } from '../components/Avatar.tsx';
import QuestionImageCard from '../components/QuestionImageCard.tsx';
import SessionSoundtrackPlayer from '../components/SessionSoundtrackPlayer.tsx';
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
import { getParticipantToken } from '../lib/studentSession.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';

const COLORS = [
  { bg: 'bg-brand-purple', text: 'text-white', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-brand-yellow', text: 'text-brand-dark', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-brand-orange', text: 'text-white', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' },
  { bg: 'bg-white', text: 'text-brand-dark', border: 'border-brand-dark', shadow: 'shadow-[8px_8px_0px_0px_#1A1A1A]' }
];

type PersistedStudentPlayState = {
  questionId: number | null;
  currentSelectedAnswer: number | null;
  selectedConfidence: number;
  firstRoundChoice: number | null;
  hasLockedInitialVote: boolean;
  hasAnswered: boolean;
  score: number;
  streak: number;
};

type QueuedAnswerSubmission = {
  questionId: number;
  chosenIndex: number;
  responseMs: number;
  confidenceLevel: number | null;
  telemetry: Record<string, unknown>;
  queuedAt: number;
  selectedAnswerText: string;
};

function isTeamGameLabel(gameType?: string) {
  return ['team_relay', 'peer_pods', 'mastery_matrix'].includes(String(gameType || ''));
}

function buildStudentPlayStateKey(pin: string, participantId: string) {
  return `quizzi.student.play-state:${pin}:${participantId}`;
}

function buildQueuedAnswerKey(pin: string, participantId: string) {
  return `quizzi.student.pending-answer:${pin}:${participantId}`;
}

function readPersistedStudentPlayState(storageKey: string): PersistedStudentPlayState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      questionId: Number.isFinite(Number(parsed?.questionId)) ? Number(parsed.questionId) : null,
      currentSelectedAnswer: Number.isFinite(Number(parsed?.currentSelectedAnswer)) ? Number(parsed.currentSelectedAnswer) : null,
      selectedConfidence: Number.isFinite(Number(parsed?.selectedConfidence)) ? Number(parsed.selectedConfidence) : 2,
      firstRoundChoice: Number.isFinite(Number(parsed?.firstRoundChoice)) ? Number(parsed.firstRoundChoice) : null,
      hasLockedInitialVote: Boolean(parsed?.hasLockedInitialVote),
      hasAnswered: Boolean(parsed?.hasAnswered),
      score: Number.isFinite(Number(parsed?.score)) ? Number(parsed.score) : 0,
      streak: Number.isFinite(Number(parsed?.streak)) ? Number(parsed.streak) : 0,
    };
  } catch {
    return null;
  }
}

function persistStudentPlayState(storageKey: string, state: PersistedStudentPlayState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function clearPersistedStudentPlayState(storageKey: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey);
}

function readQueuedAnswerSubmission(storageKey: string): QueuedAnswerSubmission | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const questionId = Number(parsed?.questionId);
    const chosenIndex = Number(parsed?.chosenIndex);
    if (!Number.isFinite(questionId) || !Number.isFinite(chosenIndex)) {
      return null;
    }
    return {
      questionId,
      chosenIndex,
      responseMs: Number.isFinite(Number(parsed?.responseMs)) ? Number(parsed.responseMs) : 0,
      confidenceLevel: Number.isFinite(Number(parsed?.confidenceLevel)) ? Number(parsed.confidenceLevel) : null,
      telemetry: parsed?.telemetry && typeof parsed.telemetry === 'object' ? parsed.telemetry : {},
      queuedAt: Number.isFinite(Number(parsed?.queuedAt)) ? Number(parsed.queuedAt) : Date.now(),
      selectedAnswerText: String(parsed?.selectedAnswerText || ''),
    };
  } catch {
    return null;
  }
}

function persistQueuedAnswerSubmission(storageKey: string, submission: QueuedAnswerSubmission) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(submission));
}

function clearQueuedAnswerSubmission(storageKey: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey);
}

function shouldQueueAnswerRetry(message: string) {
  const normalized = message.toLowerCase();
  return !(
    normalized.includes('participant authentication required')
    || normalized.includes('invalid session state')
    || normalized.includes('question not found')
    || normalized.includes('invalid answer choice')
    || normalized.includes('final answers open after the discussion round')
  );
}

export default function StudentPlay() {
  const { pin } = useParams();
  const navigate = useNavigate();
  const { t } = useAppLanguage();

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
  const [sessionError, setSessionError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'fallback'>('connecting');
  const [pendingSubmission, setPendingSubmission] = useState<QueuedAnswerSubmission | null>(null);
  const [isRetryingPendingSubmission, setIsRetryingPendingSubmission] = useState(false);

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
  const currentSelectedAnswerRef = useRef<number | null>(null);
  const pendingSubmissionRef = useRef<QueuedAnswerSubmission | null>(null);

  const focusLossDebounceRef = useRef(0);
  const idleThresholdMs = 4000;

  const participantId = localStorage.getItem('participant_id');
  const nickname = localStorage.getItem('nickname');
  const participantToken = getParticipantToken();
  const teamName = localStorage.getItem('team_name') || '';
  const savedGameType = localStorage.getItem('game_type') || '';
  const playStateKey = pin && participantId ? buildStudentPlayStateKey(String(pin), String(participantId)) : '';
  const queuedAnswerKey = pin && participantId ? buildQueuedAnswerKey(String(pin), String(participantId)) : '';
  const displayNickname = extractNickname(String(nickname || ''));
  const modeConfig = sessionMeta?.mode_config || sessionMeta?.modeConfig || {};
  const gameMode = getGameMode(sessionMeta?.game_type || savedGameType || 'classic_quiz');
  const gameTone = getGameModeTone(gameMode.id);
  const isPeerMode = isPeerInstructionMode(gameMode.id, modeConfig);
  const needsConfidence = requiresConfidenceLock(gameMode.id, modeConfig);
  const isInteractivePhase = status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE';
  const isSelectionLocked = hasAnswered || Boolean(pendingSubmission) || (isPeerMode && status === 'QUESTION_ACTIVE' && hasLockedInitialVote);
  const selectedAnswerText =
    currentSelectedAnswer !== null && Array.isArray(question?.answers)
      ? String(question.answers[currentSelectedAnswer] || '')
      : '';
  const connectionLabel =
    connectionState === 'live'
      ? t('game.student.liveSync')
      : connectionState === 'fallback'
        ? t('game.student.backupSync')
        : t('game.student.connectingLabel');

  useEffect(() => {
    firstRoundChoiceRef.current = firstRoundChoice;
  }, [firstRoundChoice]);

  useEffect(() => {
    currentSelectedAnswerRef.current = currentSelectedAnswer;
  }, [currentSelectedAnswer]);

  useEffect(() => {
    pendingSubmissionRef.current = pendingSubmission;
  }, [pendingSubmission]);

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

  const clearPendingSubmissionState = () => {
    setPendingSubmission(null);
    if (queuedAnswerKey) {
      clearQueuedAnswerSubmission(queuedAnswerKey);
    }
  };

  const applyAnswerSubmissionSuccess = (payload: any) => {
    clearPendingSubmissionState();
    setHasAnswered(true);
    const scoreAwarded = Number(payload?.score_awarded || 0);
    setScore((current) => current + scoreAwarded);
    if (scoreAwarded > 0) {
      setStreak((current) => current + 1);
    } else {
      setStreak(0);
    }

    void publishAnswerProgress(String(pin || ''), {
      participantId: Number(participantId),
      totalAnswers: Number(payload?.total_answers || 0),
      expected: Number(payload?.expected || 0),
    });
  };

  const postAnswerSubmission = async (submission: QueuedAnswerSubmission) => {
    const response = await apiFetch(`/api/sessions/${pin}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: Number(participantId),
        question_id: submission.questionId,
        chosen_index: submission.chosenIndex,
        response_ms: submission.responseMs,
        confidence_level: submission.confidenceLevel ?? undefined,
        telemetry: submission.telemetry,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to submit answer');
    }
    return payload;
  };

  const retryPendingSubmission = async () => {
    if (!pendingSubmission || isRetryingPendingSubmission) return;
    try {
      setIsRetryingPendingSubmission(true);
      const payload = await postAnswerSubmission(pendingSubmission);
      applyAnswerSubmissionSuccess(payload);
      setActionError('');
    } catch (error: any) {
      const message = String(error?.message || '');
      if (!shouldQueueAnswerRetry(message)) {
        clearPendingSubmissionState();
        setActionError(
          message.toLowerCase().includes('invalid session state')
            ? 'The round moved on before your queued answer could sync.'
            : message || 'The queued answer could not be synced.',
        );
      } else {
        setActionError(t('game.student.savedDeviceRetry'));
      }
    } finally {
      setIsRetryingPendingSubmission(false);
    }
  };

  useEffect(() => {
    if (!participantId || !nickname || !participantToken) {
      navigate('/');
      return;
    }

    let cancelled = false;
    let realtimeCleanup: (() => void) | null = null;
    let presenceCleanup: (() => void) | null = null;
    let eventSource: EventSource | null = null;
    setSessionError('');
    setActionError('');
    setIsBootstrapping(true);
    setConnectionState('connecting');

    const applyLiveStateChange = (data: any) => {
      const nextStatus = data?.status || 'LOBBY';
      const nextModeConfig = data?.mode_config || data?.modeConfig || {};
      const nextQuestion = data?.question || null;
      setSessionError('');
      setStatus(nextStatus);
      setSessionMeta((current: any) => ({
        ...(current || {}),
        status: nextStatus,
        game_type: data?.game_type || current?.game_type || savedGameType || 'classic_quiz',
        mode_config: nextModeConfig && Object.keys(nextModeConfig).length ? nextModeConfig : current?.mode_config || current?.modeConfig || {},
        current_question_index: Number(data?.current_question_index ?? data?.currentQuestionIndex ?? current?.current_question_index ?? 0),
      }));

      if (nextStatus === 'QUESTION_ACTIVE') {
        if (pendingSubmissionRef.current && Number(pendingSubmissionRef.current.questionId || 0) !== Number(nextQuestion?.id || 0)) {
          clearPendingSubmissionState();
          setActionError('The room moved on before your queued answer could sync.');
        }
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
          if (nextQuestion.correct_index === currentSelectedAnswerRef.current) {
            confetti({
              particleCount: 150,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#FFC800', '#FF5A36', '#9B51E0']
            });
          }
        }
        if (pendingSubmissionRef.current) {
          clearPendingSubmissionState();
          setActionError('The round closed before your queued answer could sync.');
        }
        flushHoverDwell();
      } else if (nextStatus === 'ENDED') {
        clearPendingSubmissionState();
        navigate(`/student/dashboard/${nickname}`);
      }
    };

    const startEventSource = () => {
      if (cancelled || eventSource) return;

      eventSource = apiEventSource(`/api/sessions/${pin}/stream`);
      eventSource.onopen = () => {
        if (!cancelled) {
          setConnectionState('fallback');
        }
      };
      eventSource.addEventListener('STATE_CHANGE', (event) => {
        applyLiveStateChange(JSON.parse(event.data));
      });
      eventSource.onerror = () => {
        if (!cancelled) {
          setSessionError('Live updates are unstable right now. We are trying to keep you connected.');
        }
      };
    };

    apiFetchJson(`/api/sessions/${pin}/student-state`)
      .then((data) => {
        if (cancelled) return;
        const sessionPayload = data?.session || null;
        const participantState = data?.participant_state || null;
        const currentAnswer = participantState?.current_answer || null;
        const persistedState = playStateKey ? readPersistedStudentPlayState(playStateKey) : null;
        const queuedSubmission = queuedAnswerKey ? readQueuedAnswerSubmission(queuedAnswerKey) : null;
        setSessionMeta(sessionPayload);
        if (sessionPayload?.status) {
          setStatus(sessionPayload.status);
        }
        setScore(Number(participantState?.score || 0));
        setStreak(Number(participantState?.streak || persistedState?.streak || 0));
        if (typeof sessionPayload?.current_question_index === 'number') {
          setTimeLeft(Number(data?.question?.time_limit_seconds || 30));
        }
        if (data?.question) {
          setQuestion(data.question);
        }
        if (currentAnswer && data?.question && Number(currentAnswer.question_id) === Number(data.question.id)) {
          clearPendingSubmissionState();
          setHasAnswered(true);
          setCurrentSelectedAnswer(Number(currentAnswer.chosen_index));
          setSelectedConfidence(2);
          setFirstRoundChoice(Number(currentAnswer.chosen_index));
          setHasLockedInitialVote(false);
          return;
        }
        if (queuedSubmission && data?.question && queuedSubmission.questionId === Number(data.question.id)) {
          setPendingSubmission(queuedSubmission);
          setCurrentSelectedAnswer(queuedSubmission.chosenIndex);
          setSelectedConfidence(queuedSubmission.confidenceLevel || 2);
        }
        if (persistedState && data?.question && persistedState.questionId === Number(data.question.id)) {
          setCurrentSelectedAnswer(persistedState.currentSelectedAnswer);
          setSelectedConfidence(persistedState.selectedConfidence || 2);
          setFirstRoundChoice(persistedState.firstRoundChoice);
          setHasLockedInitialVote(persistedState.hasLockedInitialVote);
          setHasAnswered(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load session meta:', error);
        if (cancelled) return;
        if (String(error?.message || '').includes('Participant authentication required')) {
          navigate('/');
          return;
        }
        setSessionError(error?.message || 'The session could not be loaded.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsBootstrapping(false);
      });

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
        setConnectionState('live');
        applyLiveStateChange({
          status: meta.status,
          question: meta.question,
          game_type: meta.gameType,
          mode_config: meta.modeConfig,
          current_question_index: meta.currentQuestionIndex,
        });
      },
      onError: () => {
        setConnectionState('fallback');
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
  }, [navigate, nickname, participantId, participantToken, pin, playStateKey, queuedAnswerKey, savedGameType, teamName]);

  useEffect(() => {
    if (!playStateKey || isBootstrapping) return;
    if (status === 'ENDED') {
      clearPersistedStudentPlayState(playStateKey);
      clearPendingSubmissionState();
      return;
    }
    persistStudentPlayState(playStateKey, {
      questionId: Number.isFinite(Number(question?.id)) ? Number(question.id) : null,
      currentSelectedAnswer,
      selectedConfidence,
      firstRoundChoice,
      hasLockedInitialVote,
      hasAnswered,
      score,
      streak,
    });
  }, [
    currentSelectedAnswer,
    firstRoundChoice,
    hasAnswered,
    hasLockedInitialVote,
    isBootstrapping,
    playStateKey,
    question?.id,
    score,
    selectedConfidence,
    status,
    streak,
  ]);

  useEffect(() => {
    if (!queuedAnswerKey) return;
    if (!pendingSubmission) {
      clearQueuedAnswerSubmission(queuedAnswerKey);
      return;
    }
    persistQueuedAnswerSubmission(queuedAnswerKey, pendingSubmission);
  }, [pendingSubmission, queuedAnswerKey]);

  useEffect(() => {
    setActionError('');
  }, [status, question?.id]);

  useEffect(() => {
    if (!pendingSubmission) return;

    const handleOnline = () => {
      void retryPendingSubmission();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [pendingSubmission]);

  useEffect(() => {
    if (!pendingSubmission || isRetryingPendingSubmission) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const timeout = window.setTimeout(() => {
      void retryPendingSubmission();
    }, connectionState === 'live' ? 1200 : 2800);

    return () => window.clearTimeout(timeout);
  }, [connectionState, isRetryingPendingSubmission, pendingSubmission, question?.id, status]);

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
    setActionError('');
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

    const submission: QueuedAnswerSubmission = {
      questionId: Number(question.id),
      chosenIndex: finalIndex,
      responseMs,
      confidenceLevel: needsConfidence ? selectedConfidence : null,
      telemetry,
      queuedAt: Date.now(),
      selectedAnswerText: String(question?.answers?.[finalIndex] || ''),
    };

    try {
      const payload = await postAnswerSubmission(submission);
      applyAnswerSubmissionSuccess(payload);
    } catch (error: any) {
      const message = String(error?.message || '');
      if (shouldQueueAnswerRetry(message)) {
        setHasAnswered(false);
        setPendingSubmission(submission);
        setActionError('Your answer is saved on this device. We will keep retrying until the connection stabilizes.');
      } else {
        setHasAnswered(false);
        clearPendingSubmissionState();
        setActionError(message || 'Your answer did not go through. Check your connection and try locking it in again.');
      }
      console.error(error);
    }
  };

  const handleAnswerSelect = async (index: number) => {
    if (isSelectionLocked) return;

    const now = Date.now();
    setActionError('');
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
    if (isSelectionLocked) return;
    if (currentSelectedAnswer === null) {
      setActionError('Pick an answer before you lock it in.');
      return;
    }
    if (isPeerMode && status === 'QUESTION_ACTIVE') {
      setFirstRoundChoice(currentSelectedAnswer);
      setHasLockedInitialVote(true);
      flushHoverDwell();
      return;
    }
    if (needsConfidence && !selectedConfidence) {
      setActionError('Choose how confident you feel before submitting.');
      return;
    }
    submitAnswer(currentSelectedAnswer, answerHistoryRef.current);
  };

  if (isBootstrapping) {
    return (
      <StudentShellFallback
        title="Connecting you to the game..."
        body="We are restoring your seat, syncing the live room, and getting the next phase ready."
        loading
      />
    );
  }

  if (sessionError && !sessionMeta) {
    return (
      <StudentShellFallback
        title="The live game could not be loaded"
        body={sessionError}
        onRetry={() => window.location.reload()}
        onExit={() => navigate('/')}
      />
    );
  }

  if (
    ['QUESTION_ACTIVE', 'QUESTION_DISCUSSION', 'QUESTION_REVOTE', 'QUESTION_REVEAL'].includes(status) &&
    (!question || !Array.isArray(question?.answers))
  ) {
    return (
      <StudentShellFallback
        title="Waiting for the next question..."
        body="The host already moved the room forward. We are still syncing the question payload to your device."
        loading
        onRetry={() => window.location.reload()}
        onExit={() => navigate(`/student/dashboard/${nickname}`)}
      />
    );
  }

  if (status === 'LOBBY') {
    return (
      <StudentStageViewport
        status={status}
        modeConfig={modeConfig}
        banner={<StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />}
        maxWidthClass="max-w-4xl"
      >
        <div className="relative flex w-full flex-col gap-4 text-center">
          <button
            onClick={() => navigate(`/student/dashboard/${nickname}`)}
            className="z-20 inline-flex w-full items-center justify-center gap-2 self-start rounded-full border-2 border-brand-dark bg-white px-4 py-3 font-bold shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:bg-brand-yellow sm:w-auto"
          >
            <XCircle className="h-5 w-5" />
            Leave Game
          </button>

          <div className="pointer-events-none absolute inset-0 hidden sm:block">
            <div className="absolute left-4 top-4 h-16 w-16 rounded-full border-4 border-brand-dark bg-brand-yellow opacity-40" />
            <div className="absolute bottom-6 right-8 h-20 w-20 rounded-full border-4 border-brand-dark bg-brand-purple opacity-35" />
          </div>

          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0.32 }}
            className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-center rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 shadow-[12px_12px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-8"
          >
            <Avatar
              nickname={String(nickname || '')}
              className="mb-5 sm:mb-6"
              imgClassName="h-24 w-24 rounded-full border-4 border-brand-dark bg-brand-yellow shadow-[6px_6px_0px_0px_#1A1A1A] sm:h-32 sm:w-32"
              textClassName="hidden"
            />
            <h2 className="mb-2 text-3xl font-black tracking-tight sm:text-5xl">You're in!</h2>
            <p className="mb-5 text-base font-bold text-brand-dark/60 sm:mb-7 sm:text-xl">Waiting for the host to start...</p>

            <div className="w-full space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-3 rounded-[1.4rem] border-2 border-brand-dark/20 bg-brand-bg px-4 py-4 sm:gap-4 sm:px-6">
                <span className="text-xs font-bold uppercase tracking-widest text-brand-dark/50 sm:text-sm">Playing as</span>
                <span className="text-lg font-black sm:text-2xl">{displayNickname}</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <LobbyMetaCard label="Game Type" value={gameMode.label} />
                <LobbyMetaCard label="Team" value={teamName || (gameMode.teamBased ? 'Auto team' : 'Solo')} />
              </div>

              <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4 text-left">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-purple">Sync status</p>
                <div className="flex items-center gap-3 font-black">
                  {connectionState === 'live' ? <Wifi className="h-5 w-5 text-emerald-600" /> : connectionState === 'fallback' ? <WifiOff className="h-5 w-5 text-brand-orange" /> : <LoaderCircle className="h-5 w-5 animate-spin text-brand-dark/70" />}
                  <span className="break-words">{connectionLabel}</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </StudentStageViewport>
    );
  }

  if (status === 'QUESTION_DISCUSSION') {
    return (
      <StudentStageViewport
        status={status}
        modeConfig={modeConfig}
        banner={<StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />}
        maxWidthClass="max-w-5xl"
        patterned
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 18 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="relative z-10 w-full rounded-[2.4rem] border-4 border-brand-dark bg-white p-5 shadow-[12px_12px_0px_0px_#1A1A1A] sm:p-8 lg:p-10"
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
            <QuestionImageCard
              imageUrl={question?.image_url}
              alt={question?.prompt || 'Question image'}
              className="mb-5 shadow-none border-white/20"
              imgClassName="max-h-[28vh] sm:max-h-[260px]"
            />
            <p className="text-xl font-black sm:text-3xl mb-5 text-balance">{question?.prompt}</p>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}
            >
              {question?.answers?.map((answer: string, index: number) => (
                <div
                  key={index}
                  className={`rounded-[1.4rem] border-2 p-4 font-black text-base sm:text-lg break-words ${firstRoundChoice === index ? 'bg-brand-yellow text-brand-dark border-brand-dark' : 'bg-white/10 border-white/10 text-white'}`}
                >
                  {answer}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </StudentStageViewport>
    );
  }

  if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE') {
    const isRevote = status === 'QUESTION_REVOTE';
    const showWaitCard = hasAnswered || Boolean(pendingSubmission) || (isPeerMode && status === 'QUESTION_ACTIVE' && hasLockedInitialVote);
    const waitTitle = hasAnswered ? 'Answer submitted!' : pendingSubmission ? 'Answer saved locally' : 'First vote locked!';
    const waitBody = hasAnswered
      ? 'Waiting for the rest of the class to finish...'
      : pendingSubmission
        ? 'We are retrying your answer in the background and will sync it as soon as the connection stabilizes.'
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
        <StudentStageViewport
          status={status}
          modeConfig={modeConfig}
          banner={
            <StudentRealtimeBanner
              connectionState={connectionState}
              sessionError={sessionError}
              actionError={actionError}
              pendingSubmission={pendingSubmission}
              onRetryPending={() => void retryPendingSubmission()}
              isRetryingPendingSubmission={isRetryingPendingSubmission}
            />
          }
          maxWidthClass="max-w-4xl"
          patterned
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10 mx-auto w-full max-w-xl rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 shadow-[12px_12px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-8 lg:p-10"
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

            {selectedAnswerText && (
              <div className="mt-8 rounded-[1.8rem] border-4 border-brand-dark bg-brand-bg p-5 text-left">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">
                  {hasAnswered ? 'Your submitted answer' : pendingSubmission ? 'Queued answer' : 'Your locked answer'}
                </p>
                <p className="text-xl font-black text-brand-dark break-words">{selectedAnswerText}</p>
              </div>
            )}

            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <span className={`px-5 py-3 rounded-full border-2 border-brand-dark font-black ${gameTone.pill}`}>
                {stageTitle}
              </span>
              <span className="px-5 py-3 rounded-full border-2 border-brand-dark bg-brand-bg font-black text-brand-dark">
                {timeLeft}s left
              </span>
            </div>
          </motion.div>
        </StudentStageViewport>
      );
    }

    return (
      <div className="game-viewport-shell relative flex flex-col">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]">
          <motion.div
            animate={{
              rotate: [0, 360],
              scale: [1, 1.1, 1],
            }}
            transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
            className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%]"
            style={{
              backgroundImage: 'radial-gradient(circle at center, #1A1A1A 2px, transparent 2px)',
              backgroundSize: timeLeft < 5 ? '20px 20px' : '40px 40px',
              transition: 'background-size 0.5s ease',
            }}
          />
        </div>

        <div className="relative z-20 px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="mx-auto w-full max-w-6xl">
            <StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />
          </div>
        </div>

        <div className="relative z-10 mx-auto mb-4 mt-4 grid w-full max-w-6xl gap-4 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.04, rotate: -3 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                if (window.confirm('Are you sure you want to leave the game?')) {
                  navigate(`/student/dashboard/${nickname}`);
                }
              }}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-4 border-brand-dark bg-white shadow-[4px_4px_0px_0px_#1A1A1A] transition-all hover:bg-brand-orange hover:text-white sm:h-14 sm:w-14"
            >
              <XCircle className="h-6 w-6 sm:h-7 sm:w-7" />
            </motion.button>
            <div className="min-w-0 flex flex-1 items-center gap-3 rounded-2xl border-4 border-brand-dark bg-white px-4 py-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:flex-none sm:px-6 sm:py-3.5">
              <Avatar
                nickname={String(nickname || '')}
                imgClassName="h-11 w-11 rounded-2xl sm:h-12 sm:w-12"
                textClassName="truncate font-black text-lg sm:text-xl lg:text-2xl"
              />
            </div>
            {(teamName || isTeamGameLabel(sessionMeta?.game_type || savedGameType)) && (
              <div className="flex min-w-0 items-center gap-3 rounded-2xl border-4 border-brand-dark bg-brand-yellow px-4 py-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:px-6 sm:py-3.5">
                <Sparkles className="h-5 w-5 shrink-0 text-brand-dark sm:h-6 sm:w-6" />
                <span className="truncate font-black text-base sm:text-lg">{teamName || t('game.status.lobby')}</span>
              </div>
            )}
          </div>

          <motion.div 
            key={`score-${score}`}
            initial={{ scale: 1.2, rotate: -5 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className="flex items-center gap-3 rounded-2xl border-4 border-brand-dark bg-white px-5 py-3 shadow-[6px_6px_0px_0px_#1A1A1A] sm:px-8 sm:py-3.5"
          >
            <Trophy className="h-7 w-7 fill-current text-brand-yellow sm:h-8 sm:w-8" />
            <span className="font-black text-xl sm:text-2xl">{score}</span>
          </motion.div>

          <div className={`flex min-w-0 items-center gap-3 rounded-2xl border-4 border-brand-dark px-4 py-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:px-6 sm:py-3.5 ${connectionState === 'live' ? 'bg-white' : 'bg-brand-yellow'}`}>
            {connectionState === 'live' ? <Wifi className="h-5 w-5 shrink-0 text-emerald-600 sm:h-6 sm:w-6" /> : connectionState === 'fallback' ? <WifiOff className="h-5 w-5 shrink-0 text-brand-dark sm:h-6 sm:w-6" /> : <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-brand-dark sm:h-6 sm:w-6" />}
            <span className="truncate font-black text-base sm:text-lg">{connectionLabel}</span>
          </div>
        </div>

        <div className="game-viewport-scroll relative z-10 pt-0">
          <div className="game-viewport-inner">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative z-10 mx-auto mb-6 w-full max-w-6xl overflow-hidden rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[12px_12px_0px_0px_#1A1A1A] sm:p-8 lg:p-10"
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
              <motion.div 
                animate={timeLeft <= 5 ? { scale: [1, 1.1, 1], backgroundColor: ['#FFF0ED', '#FF5A36', '#FFF0ED'], color: ['#1A1A1A', '#FFFFFF', '#1A1A1A'] } : {}}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="px-4 py-1.5 rounded-full bg-brand-bg border-2 border-brand-dark text-xs font-black uppercase tracking-widest text-brand-dark/60"
              >
                {stageTitle} - {timeLeft}s
              </motion.div>
            </div>
            
            <QuestionImageCard
              imageUrl={question?.image_url}
              alt={question?.prompt || t('game.question.imageAlt')}
              className="relative z-10 max-w-4xl mx-auto w-full mb-6"
              imgClassName="max-h-[28vh] sm:max-h-[340px]"
            />
            <h2 className="text-2xl font-black leading-tight tracking-tight text-brand-dark text-balance sm:text-4xl md:text-5xl">
              {question?.prompt}
            </h2>
            <p className="text-lg sm:text-xl font-bold text-brand-dark/40 max-w-3xl mx-auto">{stageBody}</p>
            </motion.div>

            <SelectedAnswerSummaryCard
              selectedAnswerText={selectedAnswerText}
              currentSelectedAnswer={currentSelectedAnswer}
              selectedConfidence={selectedConfidence}
              needsConfidence={needsConfidence}
              lockLabel={lockLabel}
              isRevote={isRevote}
            />

            {needsConfidence && (
              <div className="relative z-10 mx-auto mb-6 w-full max-w-6xl">
                <div className="flex flex-col gap-5 rounded-[2rem] border-4 border-brand-dark/10 bg-brand-bg/50 p-5 backdrop-blur-md md:flex-row md:items-center">
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-brand-dark bg-brand-purple">
                      <Flame className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-sm font-black uppercase tracking-widest">{t('game.student.confidence')}</span>
                  </div>
                  <div className="grid w-full flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      { id: 1, label: t('game.student.guess'), icon: '🤔' },
                      { id: 2, label: t('game.student.sure'), icon: '👍' },
                      { id: 3, label: t('game.student.expert'), icon: '🧠' },
                    ].map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSelectedConfidence(option.id)}
                        className={`rounded-2xl border-4 px-5 py-4 font-black transition-all flex items-center justify-center gap-3 ${
                          selectedConfidence === option.id
                            ? 'scale-[1.02] border-brand-dark bg-brand-purple text-white shadow-[4px_4px_0px_0px_#1A1A1A]'
                            : 'border-brand-dark/10 bg-white text-brand-dark hover:border-brand-dark'
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

            <div
              className="relative z-10 mx-auto mb-6 grid w-full max-w-6xl gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}
            >
              <AnimatePresence mode="popLayout">
                {question?.answers?.map((ans: string, i: number) => {
                  const isSelected = currentSelectedAnswer === i;
                  return (
                    <motion.button
                      key={`ans-${i}`}
                      initial={{ scale: 0.94, opacity: 0 }}
                      animate={{
                        scale: isSelected ? 1.02 : 1,
                        opacity: 1,
                        y: isSelected ? -4 : 0,
                      }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      onClick={() => handleAnswerSelect(i)}
                      onMouseEnter={() => beginHoverDwell(i)}
                      onMouseLeave={() => flushHoverDwell()}
                      className={`
                        student-answer-button group relative flex min-h-[132px] items-center justify-center rounded-[2rem] border-4 p-5 text-center text-lg font-black transition-all sm:min-h-[160px] sm:p-6 sm:text-2xl lg:min-h-[180px] lg:text-3xl
                        ${isSelected
                          ? 'border-brand-dark bg-brand-dark text-white shadow-[10px_10px_0px_0px_#FF5A36]'
                          : `${COLORS[i % 4].bg} ${COLORS[i % 4].text} border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] hover:translate-x-1 hover:translate-y-1 hover:shadow-none`
                        }
                      `}
                    >
                      <div className="absolute left-5 top-4 text-xs font-black tracking-widest opacity-20 sm:left-6 sm:top-5">0{i + 1}</div>
                      <span className="relative z-10 break-words text-balance">{ans}</span>

                      {isSelected && (
                        <motion.div
                          layoutId="choice-spark"
                          className="pointer-events-none absolute inset-0 rounded-[2rem] border-[6px] border-brand-orange/30 sm:border-8"
                        />
                      )}
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {currentSelectedAnswer !== null && !hasAnswered && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="relative z-20 shrink-0 border-t-2 border-brand-dark/10 bg-brand-bg/95 px-4 py-4 backdrop-blur sm:px-6"
            >
              <div className="mx-auto flex w-full max-w-6xl justify-center">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  animate={{ 
                    boxShadow: [
                      '10px 10px 0px 0px #FF5A36',
                      '14px 14px 0px 0px #FFC800',
                      '10px 10px 0px 0px #FF5A36'
                    ]
                  }}
                  transition={{ boxShadow: { duration: 2, repeat: Infinity, ease: 'easeInOut' } }}
                  onClick={handleLockIn}
                  className="group relative flex w-full max-w-lg items-center justify-center gap-4 overflow-hidden rounded-full border-4 border-brand-dark bg-brand-dark px-6 py-4 text-white sm:py-5"
                >
                  <div className="absolute inset-0 translate-y-full bg-gradient-to-r from-brand-orange to-brand-yellow opacity-20 transition-transform duration-300 group-hover:translate-y-0" />
                  <CheckCircle className="relative z-10 h-8 w-8 text-brand-yellow sm:h-10 sm:w-10 group-hover:scale-110 transition-transform" />
                  <span className="relative z-10 text-xl font-black sm:text-2xl">{lockLabel}</span>
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (status === 'QUESTION_REVEAL') {
    const answeredCorrectly = currentSelectedAnswer !== null && Number(question?.correct_index) === currentSelectedAnswer;
    const chosenAnswer =
      currentSelectedAnswer !== null && Array.isArray(question?.answers)
        ? String(question.answers[currentSelectedAnswer] || '')
        : '';
    const correctAnswer =
      Number.isFinite(Number(question?.correct_index)) && Array.isArray(question?.answers)
        ? String(question.answers[Number(question.correct_index)] || '')
        : '';
    return (
      <StudentStageViewport
        status={status}
        modeConfig={modeConfig}
        banner={<StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />}
        maxWidthClass="max-w-4xl"
        patterned
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, rotate: 2 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          className="relative z-10 mx-auto w-full max-w-3xl rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[12px_12px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-8 lg:p-10"
        >
          <div className="flex justify-center mb-6">
            <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </span>
          </div>
          <div className={`inline-flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 border-4 border-brand-dark rounded-full mb-8 sm:mb-10 shadow-[8px_8px_0px_0px_#1A1A1A] ${answeredCorrectly ? 'bg-emerald-100' : 'bg-brand-yellow'}`}>
            {answeredCorrectly ? <CheckCircle className="w-12 h-12 sm:w-16 sm:h-16 text-emerald-600" /> : <Flame className="w-12 h-12 sm:w-16 sm:h-16 text-brand-orange" />}
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-brand-dark sm:text-5xl md:text-6xl">
            {answeredCorrectly ? t('game.feedback.correct') : chosenAnswer ? t('game.feedback.incorrect') : t('game.feedback.timesUp')}
          </h2>
          <p className="text-lg sm:text-2xl font-bold text-brand-dark/60 mb-8">
            {answeredCorrectly
              ? t('game.student.matchedCorrect')
              : chosenAnswer
                ? t('game.student.reviewCompared')
                : t('game.student.roundClosedNoSync')}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mb-8">
            <RevealAnswerCard label={t('game.student.yourAnswer')} value={chosenAnswer || t('game.student.noAnswer')} tone={answeredCorrectly ? 'success' : chosenAnswer ? 'warning' : 'neutral'} />
            <RevealAnswerCard label={t('game.student.correctAnswer')} value={correctAnswer || t('game.student.watchHostScreen')} tone="success" />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <PlayerMetricCard label={t('game.metrics.score')} value={score} tone="dark" />
            <PlayerMetricCard label={t('game.metrics.streak')} value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
          </div>

          {question?.explanation && (
            <div className="rounded-[2rem] border-4 border-brand-dark bg-brand-bg p-6 text-left mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('game.feedback.explanation')}</p>
              <p className="text-base font-bold text-brand-dark/75 sm:text-lg">{question.explanation}</p>
            </div>
          )}

          <div className="bg-brand-purple p-6 rounded-2xl border-2 border-brand-dark text-white">
            <p className="text-xl sm:text-2xl font-bold">{t('game.feedback.watchScreen')}</p>
          </div>
        </motion.div>
      </StudentStageViewport>
    );
  }

  if (status === 'LEADERBOARD') {
    return (
      <StudentStageViewport
        status={status}
        modeConfig={modeConfig}
        banner={<StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />}
        maxWidthClass="max-w-4xl"
        patterned
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.4 }}
          className="relative z-10 mx-auto w-full max-w-2xl rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[12px_12px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-8 lg:p-10"
        >
          <div className="flex justify-center mb-6">
            <span className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </span>
          </div>
          <div className="inline-flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 bg-brand-yellow border-4 border-brand-dark rounded-full mb-8 sm:mb-10 shadow-[8px_8px_0px_0px_#1A1A1A]">
            <Trophy className="w-12 h-12 sm:w-16 sm:h-16 text-brand-dark" />
          </div>
          <h2 className="mb-8 text-3xl font-black tracking-tight text-brand-dark sm:text-5xl md:text-7xl">{t('game.leaderboard.title')}</h2>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <PlayerMetricCard label={t('game.metrics.currentScore')} value={score} tone="dark" />
            <PlayerMetricCard label={t('game.metrics.bestStreak')} value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
          </div>
          <div className="bg-brand-bg p-5 sm:p-8 rounded-[2rem] border-4 border-brand-dark/10">
            <p className="text-2xl sm:text-3xl text-brand-dark/80 font-bold mb-4">{t('game.leaderboard.checkMainScreen')}</p>
            <p className="text-lg sm:text-xl text-brand-dark/50 font-medium">{t('game.leaderboard.scoreLocked')}</p>
          </div>
        </motion.div>
      </StudentStageViewport>
    );
  }

  if (status === 'ENDED') {
    return (
      <StudentStageViewport
        status={status}
        modeConfig={modeConfig}
        banner={<StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} />}
        maxWidthClass="max-w-3xl"
        patterned
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 24 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0.24 }}
          className="relative z-10 mx-auto w-full max-w-2xl rounded-[2.2rem] border-4 border-brand-dark bg-white p-6 text-center shadow-[12px_12px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-8 lg:p-10"
        >
          <div className="mx-auto mb-6 inline-flex h-24 w-24 items-center justify-center rounded-full border-4 border-brand-dark bg-brand-yellow shadow-[8px_8px_0px_0px_#1A1A1A] sm:h-28 sm:w-28">
            <Trophy className="h-12 w-12 text-brand-dark sm:h-14 sm:w-14" />
          </div>
          <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('game.status.ended')}</p>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-brand-dark sm:text-5xl">
            {t('game.ended.title')}
          </h2>
          <p className="mb-8 text-base font-bold text-brand-dark/65 sm:text-xl">
            {t('game.ended.body')}
          </p>

          <div className="mb-8 grid grid-cols-2 gap-4">
            <PlayerMetricCard label={t('game.ended.finalScore')} value={score} tone="dark" />
            <PlayerMetricCard label={t('game.ended.finalStreak')} value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(`/student/dashboard/${nickname}`)}
              className="flex-1 rounded-full border-2 border-brand-dark bg-brand-orange px-5 py-4 font-black text-white shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
            >
              {t('game.ended.primary')}
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex-1 rounded-full border-2 border-brand-dark bg-white px-5 py-4 font-black text-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
            >
              {t('game.ended.secondary')}
            </button>
          </div>
        </motion.div>
      </StudentStageViewport>
    );
  }

  return (
    <StudentShellFallback
      title={t('game.fallback.unfamiliarState')}
      body={t('game.fallback.unknownStatus', { status })}
      onRetry={() => window.location.reload()}
      onExit={() => navigate(`/student/dashboard/${nickname}`)}
    />
  );
}

function StudentStageViewport({
  status,
  modeConfig,
  banner,
  children,
  maxWidthClass = 'max-w-4xl',
  patterned = false,
  center = true,
}: {
  status: string;
  modeConfig?: Record<string, unknown> | null;
  banner?: ReactNode;
  children: ReactNode;
  maxWidthClass?: string;
  patterned?: boolean;
  center?: boolean;
}) {
  return (
    <div className="game-viewport-shell relative flex flex-col">
      <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
      {patterned ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(#1A1A1A 2px, transparent 2px)', backgroundSize: '30px 30px' }}
        />
      ) : null}
      <div className="game-viewport-scroll relative z-20">
        <div className={`game-viewport-inner ${center ? 'justify-center' : ''}`}>
          {banner ? <div className={`mx-auto mb-4 w-full ${maxWidthClass}`}>{banner}</div> : null}
          <div className={`game-stage-card mx-auto w-full ${maxWidthClass} ${center ? 'my-auto' : ''}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function LobbyMetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 text-left">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{label}</p>
      <p className="text-xl font-black capitalize break-words">{String(value || '').replace(/_/g, ' ')}</p>
    </div>
  );
}

function StudentRealtimeBanner({
  connectionState,
  sessionError,
  actionError,
  pendingSubmission,
  onRetryPending,
  isRetryingPendingSubmission = false,
}: {
  connectionState: 'connecting' | 'live' | 'fallback';
  sessionError: string;
  actionError: string;
  pendingSubmission?: QueuedAnswerSubmission | null;
  onRetryPending?: () => void;
  isRetryingPendingSubmission?: boolean;
}) {
  const { t } = useAppLanguage();
  const bannerMessage =
    pendingSubmission
      ? t('game.student.savedDeviceRetry')
      : actionError || sessionError
        ? actionError || sessionError
        : connectionState === 'live'
          ? t('game.student.liveStable')
          : connectionState === 'fallback'
            ? t('game.student.fallbackActive')
            : t('game.student.connecting');
  const toneClass =
    pendingSubmission || actionError || sessionError
      ? 'bg-brand-orange/15 border-brand-dark text-brand-dark'
      : connectionState === 'live'
        ? 'bg-white border-brand-dark text-brand-dark'
        : 'bg-brand-yellow border-brand-dark text-brand-dark';

  return (
    <div className={`rounded-[1.5rem] border-2 px-4 py-3 shadow-[3px_3px_0px_0px_#1A1A1A] ${toneClass}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 font-black">
          {pendingSubmission ? (
            isRetryingPendingSubmission ? (
              <LoaderCircle className="w-5 h-5 animate-spin text-brand-orange" />
            ) : (
              <WifiOff className="w-5 h-5 text-brand-orange" />
            )
          ) : actionError || sessionError ? (
            <AlertTriangle className="w-5 h-5 text-brand-orange" />
          ) : connectionState === 'live' ? (
            <Wifi className="w-5 h-5 text-emerald-600" />
          ) : connectionState === 'fallback' ? (
            <WifiOff className="w-5 h-5 text-brand-dark" />
          ) : (
            <LoaderCircle className="w-5 h-5 animate-spin text-brand-dark/70" />
          )}
          <span>{bannerMessage}</span>
        </div>
        {pendingSubmission && onRetryPending ? (
          <button
            type="button"
            onClick={onRetryPending}
            disabled={isRetryingPendingSubmission}
            className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.2em] shadow-[2px_2px_0px_0px_#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRetryingPendingSubmission ? t('game.student.retrying') : t('game.student.retryNow')}
          </button>
        ) : !actionError && !sessionError && (
          <span className="text-xs font-black uppercase tracking-[0.2em] opacity-60">
            {connectionState === 'live' ? t('game.student.realtimeActive') : connectionState === 'fallback' ? t('game.student.fallbackActiveLabel') : t('game.student.booting')}
          </span>
        )}
      </div>
    </div>
  );
}

function SelectedAnswerSummaryCard({
  selectedAnswerText,
  currentSelectedAnswer,
  selectedConfidence,
  needsConfidence,
  lockLabel,
  isRevote,
}: {
  selectedAnswerText: string;
  currentSelectedAnswer: number | null;
  selectedConfidence: number;
  needsConfidence: boolean;
  lockLabel: string;
  isRevote: boolean;
}) {
  const { t } = useAppLanguage();
  return (
    <div className="relative z-10 max-w-6xl mx-auto w-full mb-8">
      <div className="rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 md:p-6 shadow-[6px_6px_0px_0px_#1A1A1A]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">
              {currentSelectedAnswer !== null ? (isRevote ? t('game.student.currentFinalChoice') : t('game.student.currentChoice')) : t('game.student.chooseOne')}
            </p>
            <p className="text-2xl font-black text-brand-dark break-words">
              {selectedAnswerText || t('game.student.tapToPreview')}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 shrink-0 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-3 text-center font-black">
              {lockLabel}
            </span>
            {needsConfidence && (
              <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-3 text-center font-black">
                {t('game.student.confidence')} {selectedConfidence}/3
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RevealAnswerCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'neutral';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-100 border-emerald-400'
      : tone === 'warning'
        ? 'bg-brand-yellow border-brand-dark'
        : 'bg-brand-bg border-brand-dark';

  return (
    <div className={`rounded-[1.8rem] border-4 p-5 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{label}</p>
      <p className="text-2xl font-black text-brand-dark">{value}</p>
    </div>
  );
}

function PlayerMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'light' | 'warm' | 'dark';
}) {
  const toneClass =
    tone === 'dark'
      ? 'bg-brand-dark text-white'
      : tone === 'warm'
        ? 'bg-brand-orange text-white'
        : 'bg-brand-bg text-brand-dark';

  return (
    <div className={`rounded-[1.8rem] border-4 border-brand-dark p-5 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-2">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function StudentShellFallback({
  title,
  body,
  loading = false,
  onRetry,
  onExit,
}: {
  title: string;
  body: string;
  loading?: boolean;
  onRetry?: () => void;
  onExit?: () => void;
}) {
  const { t } = useAppLanguage();
  return (
    <div className="game-viewport-shell flex flex-col">
      <div className="game-viewport-scroll flex items-center justify-center">
        <div className="w-full max-w-2xl rounded-[2.6rem] border-4 border-brand-dark bg-white p-6 text-center shadow-[12px_12px_0px_0px_#1A1A1A] sm:p-8">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-yellow">
            {loading ? <LoaderCircle className="w-12 h-12 animate-spin text-brand-dark" /> : <AlertTriangle className="w-12 h-12 text-brand-dark" />}
          </div>
          <h2 className="mb-4 text-4xl font-black text-brand-dark">{title}</h2>
          <p className="mb-8 text-lg font-bold text-brand-dark/65">{body}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            {onRetry && (
              <button
                onClick={onRetry}
                className="rounded-2xl border-2 border-brand-dark bg-brand-dark px-6 py-4 font-black text-white shadow-[4px_4px_0px_0px_#FF5A36]"
              >
                {t('dash.action.tryAgain')}
              </button>
            )}
            {onExit && (
              <button
                onClick={onExit}
                className="rounded-2xl border-2 border-brand-dark bg-white px-6 py-4 font-black"
              >
                {t('game.action.next')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
