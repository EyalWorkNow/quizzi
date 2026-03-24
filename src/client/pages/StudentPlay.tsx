import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Clock, Flame, LoaderCircle, Sparkles, Stars, Trophy, Wifi, WifiOff, XCircle } from 'lucide-react';
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
import { getLiveQuestionDensity, formatAnswerSlotLabel } from '../../shared/liveQuestionDensity.ts';

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
  const shouldRenderRealtimeBanner = (showWhenStable = false, queuedSubmission?: QueuedAnswerSubmission | null) =>
    Boolean(queuedSubmission || actionError || sessionError || connectionState !== 'live' || showWhenStable);

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
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Lobby Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
             <div className="flex items-center gap-3">
               <motion.button
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => {
                   if (window.confirm('Are you sure you want to leave the game?')) {
                     navigate(`/student/dashboard/${nickname}`);
                   }
                 }}
                 className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-brand-dark bg-white shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:bg-rose-50 hover:text-rose-600"
               >
                 <XCircle className="h-6 w-6 text-brand-dark/20" />
               </motion.button>
               <div className="rounded-2xl border-2 border-brand-dark px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-brand-bg shadow-[3px_3px_0px_0px_#1A1A1A]">
                  {t('game.status.lobby')}
               </div>
             </div>
             
             <div className="flex items-center gap-3">
               <div className="flex h-11 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <Avatar
                   nickname={String(nickname || '')}
                   imgClassName="h-7 w-7 rounded-xl"
                 />
                 <span className="hidden sm:inline font-black text-sm uppercase tracking-tight">{displayNickname}</span>
               </div>
             </div>
          </div>
        </div>

        {shouldRenderRealtimeBanner(true) && (
          <div className="relative z-20 shrink-0 px-4 pt-4">
             <StudentRealtimeBanner connectionState={connectionState} sessionError={sessionError} actionError={actionError} showWhenStable />
          </div>
        )}

        {/* Centered Lobby Content */}
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 sm:p-8 lg:p-12 w-full max-w-3xl mx-auto">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[3.5rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[16px_16px_0px_0px_#1A1A1A] sm:p-12"
           >
              <div className="absolute inset-0 z-0 pointer-events-none opacity-5">
                 <div className="absolute top-10 left-10 h-24 w-24 rounded-full bg-brand-yellow blur-2xl" />
                 <div className="absolute bottom-10 right-10 h-24 w-24 rounded-full bg-brand-purple blur-2xl" />
              </div>

              <div className="relative z-10 text-center">
                 <div className="mx-auto mb-10 w-fit relative">
                    <Avatar
                      nickname={String(nickname || '')}
                      className="mb-0"
                      imgClassName="h-32 w-32 rounded-[2.5rem] border-4 border-brand-dark bg-brand-yellow shadow-[8px_8px_0px_0px_#1A1A1A] sm:h-40 sm:w-40"
                      textClassName="hidden"
                    />
                    <div className="absolute -bottom-3 -right-3 h-12 w-12 rounded-2xl border-4 border-brand-dark bg-white flex items-center justify-center shadow-[4px_4px_0px_0px_#1A1A1A]">
                       <CheckCircle className="h-6 w-6 text-emerald-500" />
                    </div>
                 </div>
                 
                 <h2 className="mb-4 text-5xl font-black tracking-tighter text-brand-dark sm:text-7xl">You're in!</h2>
                 <p className="mb-10 text-xl font-bold leading-relaxed text-brand-dark/40 sm:text-3xl">Ready for the magic? The host starts soon.</p>

                 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LobbyMetaCard label="Game Track" value={gameMode.label} />
                    <LobbyMetaCard label="Your Pod" value={teamName || (gameMode.teamBased ? 'Syncing team' : 'Solo Mastery')} />
                 </div>

                 <div className="mt-10 rounded-[2.5rem] border-4 border-brand-dark/5 bg-brand-bg/30 p-6 flex flex-wrap items-center justify-center gap-6">
                    <div className="flex items-center gap-3">
                       <div className="h-3 w-3 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
                       <span className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">Status:</span>
                       <span className="text-sm font-black text-brand-dark/80">{connectionLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                       <Wifi className="h-4 w-4 text-brand-purple/40" />
                       <span className="text-sm font-black text-brand-dark/80 tracking-tight">Real-time Synced</span>
                    </div>
                 </div>
              </div>
           </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'QUESTION_DISCUSSION') {
    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Discussion Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
             <div className="flex items-center gap-3">
                <div className="rounded-2xl border-2 border-brand-dark px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-brand-yellow shadow-[3px_3px_0px_0px_#1A1A1A]">
                   Team Discussion
                </div>
             </div>
             
             <div className="flex items-center gap-3">
                <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <Clock className="h-5 w-5 text-brand-purple" />
                  <span className="font-black text-lg">{timeLeft}s</span>
                </div>
             </div>
          </div>
        </div>

        {/* Centered Discussion Content */}
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 lg:p-12 w-full max-w-4xl mx-auto custom-scrollbar">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[3.5rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[16px_16px_0px_0px_#1A1A1A] sm:p-12"
           >
              <h2 className="mb-4 text-4xl font-black tracking-tighter text-brand-dark sm:text-6xl lg:text-7xl">Pod Discussion</h2>
              <p className="mx-auto max-w-[35ch] text-lg font-bold leading-relaxed text-brand-dark/50 sm:text-2xl mb-12">
                 Defend your choice, listen to your peers, and sync up for the final vote!
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left mb-10">
                <div className="rounded-[2.5rem] border-4 border-brand-dark bg-brand-bg/50 p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-orange mb-3">Your Initial Choice</p>
                   <p className="text-2xl font-black text-brand-dark leading-snug">
                     {firstRoundChoice !== null ? question?.answers?.[firstRoundChoice] : 'No choice locked'}
                   </p>
                </div>
                <div className="rounded-[2.5rem] border-4 border-brand-dark bg-brand-yellow p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-dark/60 mb-3">Your Pod</p>
                   <p className="text-2xl font-black text-brand-dark leading-snug">{teamName || 'Consult nearby teammates'}</p>
                </div>
              </div>

              <div className="rounded-[3rem] border-4 border-brand-dark bg-brand-dark text-white p-8 sm:p-10 text-left relative overflow-hidden shadow-[12px_12px_0px_0px_#1A1A1A]">
                <div className="absolute -top-10 -right-10 p-4 opacity-10">
                   <Sparkles className="h-40 w-40 text-brand-yellow" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-yellow mb-5">Question Spotlight</p>
                   <h3 className="text-2xl font-black sm:text-4xl mb-10 text-balance leading-[1.15] tracking-tight">{question?.prompt}</h3>
                   
                   <div className="grid gap-4 sm:grid-cols-2">
                     {question?.answers?.map((answer: string, index: number) => (
                       <div
                         key={index}
                         className={`rounded-[1.5rem] border-4 p-5 font-black text-base transition-colors ${
                           firstRoundChoice === index 
                            ? 'bg-brand-yellow text-brand-dark border-brand-dark shadow-[4px_4px_0px_0px_#FF5A36]' 
                            : 'bg-white/10 border-white/10 text-white/90'
                         }`}
                       >
                         <div className="flex items-start gap-4">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 font-black text-xs ${
                               firstRoundChoice === index ? 'border-brand-dark/20 bg-brand-dark/10' : 'border-white/10 bg-white/5'
                            }`}>
                               {formatAnswerSlotLabel(index)}
                            </span>
                            <span className="flex-1 break-words">{answer}</span>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
              
              <div className="mt-12 flex items-center justify-center gap-4">
                 <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-purple" />
                 <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-yellow [animation-delay:0.2s]" />
                 <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-orange [animation-delay:0.4s]" />
                 <span className="ml-2 font-black uppercase tracking-[0.2em] text-[10px] text-brand-dark/30 italic">Round 2 starting soon...</span>
              </div>
           </motion.div>
        </div>
      </div>
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
    const liveQuestionDensity = getLiveQuestionDensity({
      prompt: question?.prompt,
      answers: Array.isArray(question?.answers) ? question.answers : [],
      hasImage: Boolean(question?.image_url),
    });
    const answerCount = Array.isArray(question?.answers) ? question.answers.length : 0;
    const questionHeroMinHeightClass = liveQuestionDensity.isUltraDense
      ? 'min-h-[168px] sm:min-h-[196px]'
      : liveQuestionDensity.isDense
        ? 'min-h-[186px] sm:min-h-[220px]'
        : 'min-h-[210px] sm:min-h-[250px]';
    const questionHeroFlexClass = liveQuestionDensity.isUltraDense
      ? 'flex-[0.78]'
      : liveQuestionDensity.isDense
        ? 'flex-[0.9]'
        : 'flex-[1]';
    const questionCardPaddingClass = liveQuestionDensity.isUltraDense
      ? 'px-4 py-4 sm:px-7 sm:py-5'
      : liveQuestionDensity.isDense
        ? 'px-5 py-4 sm:px-8 sm:py-5'
        : 'px-5 py-5 sm:px-10 sm:py-6';
    const questionPromptScrollerClass = liveQuestionDensity.isUltraDense
      ? 'max-h-[18vh] sm:max-h-[22vh]'
      : liveQuestionDensity.isDense
        ? 'max-h-[20vh] sm:max-h-[24vh]'
        : 'max-h-[24vh] sm:max-h-[28vh]';
    const studentPromptClassName = liveQuestionDensity.isUltraDense
      ? 'text-[clamp(1.2rem,1.6vw,2.15rem)]'
      : liveQuestionDensity.isDense
        ? 'text-[clamp(1.35rem,2vw,2.8rem)]'
        : 'text-[clamp(1.5rem,2.5vw,3.5rem)]';
    const answerGridColumnsClass =
      liveQuestionDensity.preferredColumns === 3
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        : answerCount > 1
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1';
    const answerGridRowsClass =
      answerCount === 4
        ? 'sm:grid-rows-2'
        : answerCount === 6 && liveQuestionDensity.preferredColumns === 3
          ? 'lg:grid-rows-2'
          : '';
    const studentAnswerMinHeightClass = liveQuestionDensity.isUltraDense
      ? 'min-h-[92px] sm:min-h-[96px]'
      : liveQuestionDensity.isDense
        ? 'min-h-[104px] sm:min-h-[112px]'
        : 'min-h-[118px] sm:min-h-[126px]';
    const studentAnswerTextClass = liveQuestionDensity.isUltraDense
      ? 'text-sm sm:text-base lg:text-lg'
      : liveQuestionDensity.isDense
        ? 'text-sm sm:text-lg lg:text-xl'
        : 'text-base sm:text-xl lg:text-2xl';
    const shouldShowAnswerSummary = currentSelectedAnswer !== null || hasAnswered || Boolean(pendingSubmission);
    const shouldShowConfidencePicker = needsConfidence && currentSelectedAnswer !== null && !isSelectionLocked;
    const shouldShowActiveRealtimeBanner = shouldRenderRealtimeBanner(false, pendingSubmission);
    const answerBoardFlexClass = answerCount <= 4 ? 'flex-[1.65]' : answerCount === 5 ? 'flex-[1.52]' : 'flex-[1.4]';
    const answerHeaderPaddingClass = shouldShowAnswerSummary || shouldShowConfidencePicker
      ? 'px-4 py-4 sm:px-6 sm:py-5'
      : 'px-4 py-3 sm:px-6 sm:py-3.5';
    const answerPreviewTextClass = currentSelectedAnswer !== null
      ? 'line-clamp-2 text-base font-black leading-snug text-balance text-brand-dark sm:text-2xl'
      : 'text-sm font-bold leading-relaxed text-brand-dark/70 sm:text-base';
    const answerScrollPaddingClass = answerCount <= 4
      ? 'pb-[4.75rem] sm:pb-6'
      : 'pb-[5.5rem] sm:pb-8';

    if (showWaitCard) {
      return (
        <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
          <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
          
          {/* Apex Student Header */}
          <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
               <div className="flex items-center gap-3">
                  <div className={`h-11 flex items-center gap-3 rounded-2xl border-2 border-brand-dark px-4 font-black shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
                     <span className="text-[10px] uppercase tracking-widest opacity-40">Phase</span>
                     <span className="text-xs">{stageTitle}</span>
                  </div>
               </div>
               
               <div className="flex items-center gap-3">
                  <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                    <Clock className={`h-5 w-5 ${timeLeft <= 5 ? 'text-rose-500 animate-pulse' : 'text-brand-purple'}`} />
                    <span className={`font-black text-lg ${timeLeft <= 5 ? 'text-rose-600' : ''}`}>{timeLeft}s</span>
                  </div>
               </div>
            </div>
          </div>

          {shouldRenderRealtimeBanner(false, pendingSubmission) && (
            <div className="relative z-20 shrink-0 px-4 pt-4">
               <StudentRealtimeBanner
                  connectionState={connectionState}
                  sessionError={sessionError}
                  actionError={actionError}
                  pendingSubmission={pendingSubmission}
                  onRetryPending={() => void retryPendingSubmission()}
                  isRetryingPendingSubmission={isRetryingPendingSubmission}
                />
            </div>
          )}

          {/* Centered Waiting Viewport */}
          <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 sm:p-8 w-full max-w-2xl mx-auto">
             <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative z-10 w-full rounded-[3.5rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[16px_16px_0px_0px_#1A1A1A] sm:p-12"
             >
                <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                   <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-yellow shadow-[6px_6px_0px_0px_#1A1A1A]">
                      <motion.div
                         animate={{ rotate: 360 }}
                         transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
                      >
                        <Clock className="h-12 w-12 text-brand-dark" />
                      </motion.div>
                   </div>
                </div>

                <div className="mt-10">
                   <h2 className="mb-4 text-4xl font-black tracking-tighter text-brand-dark sm:text-5xl lg:text-6xl">
                      {waitTitle}
                   </h2>
                   
                   <p className="mx-auto max-w-[28ch] text-lg font-bold leading-relaxed text-brand-dark/50 sm:text-xl">
                      {waitBody}
                   </p>
                </div>

                {selectedAnswerText && (
                  <div className="mt-10 rounded-[2.5rem] border-4 border-brand-dark bg-brand-bg/50 p-6 text-left shadow-[8px_8px_0px_0px_#1A1A1A] border-dashed">
                    <div className="mb-3 flex items-center justify-between">
                       <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-orange">
                          {hasAnswered ? 'Submitted Choice' : 'Locked Selection'}
                       </p>
                       <CheckCircle className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="text-xl font-black text-brand-dark leading-snug break-words">
                      "{selectedAnswerText}"
                    </p>
                  </div>
                )}

                <div className="mt-12 flex items-center justify-center gap-4">
                   <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-purple" />
                   <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-yellow [animation-delay:0.2s]" />
                   <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-orange [animation-delay:0.4s]" />
                </div>
             </motion.div>
          </div>
        </div>
      );
    }

    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Student Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (window.confirm('Are you sure you want to leave the game?')) {
                    navigate(`/student/dashboard/${nickname}`);
                  }
                }}
                className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-brand-dark bg-white shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:bg-rose-50 hover:text-rose-600"
              >
                <XCircle className="h-6 w-6 text-brand-dark/20" />
              </motion.button>
              
              <div className="flex h-11 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Avatar
                  nickname={String(nickname || '')}
                  imgClassName="h-7 w-7 rounded-xl"
                />
                <span className="hidden sm:inline font-black text-sm uppercase tracking-tight">{displayNickname}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <Clock className={`h-5 w-5 ${timeLeft <= 5 ? 'text-rose-500 animate-pulse' : 'text-brand-purple'}`} />
                <span className={`font-black text-lg ${timeLeft <= 5 ? 'text-rose-600' : ''}`}>{timeLeft}s</span>
              </div>
              
              <motion.div
                key={score}
                initial={{ scale: 1.25, rotate: -5 }}
                animate={{ scale: 1, rotate: 0 }}
                className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-yellow px-4 shadow-[4px_4px_0px_0px_#1A1A1A]"
              >
                <Trophy className="h-5 w-5 fill-current text-brand-dark/30" />
                <span className="font-black text-lg">{score}</span>
              </motion.div>
            </div>
          </div>
        </div>

        {shouldShowActiveRealtimeBanner && (
          <div className="relative z-20 shrink-0 px-4 pt-4">
             <StudentRealtimeBanner
                connectionState={connectionState}
                sessionError={sessionError}
                actionError={actionError}
                pendingSubmission={pendingSubmission}
                onRetryPending={() => void retryPendingSubmission()}
                isRetryingPendingSubmission={isRetryingPendingSubmission}
              />
          </div>
        )}

        {/* Main Content Viewport */}
        <div className="relative flex-1 min-h-0 flex flex-col gap-4 p-4 sm:p-6 lg:p-8 w-full max-w-[1540px] mx-auto overflow-hidden">
          
          {/* Question Hero */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`relative ${questionHeroFlexClass} ${questionHeroMinHeightClass} shrink-0 overflow-hidden rounded-[2.5rem] border-4 border-brand-dark bg-white shadow-[10px_10px_0px_0px_#1A1A1A]`}
          >
            <div className="absolute inset-x-0 top-0 z-20 h-2 bg-gradient-to-r from-brand-purple via-brand-yellow to-brand-orange" />
            
            <div className="relative z-10 flex h-full w-full flex-col p-6 sm:p-8">
               {question?.image_url ? (
                  <div className="flex flex-1 min-h-0 gap-8">
                    <div className="hidden md:block aspect-square h-full shrink-0 overflow-hidden rounded-[2rem] border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A]">
                       <img src={question.image_url} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                       <h2 className={`${studentPromptClassName} font-black leading-[1.1] tracking-tight text-brand-dark text-balance`}>
                          {question?.prompt}
                       </h2>
                    </div>
                  </div>
               ) : (
                  <div className="flex-1 flex flex-col justify-center text-center">
                     <h2 className={`${studentPromptClassName} font-black leading-[1.1] tracking-tight text-brand-dark max-w-[35ch] mx-auto text-balance`}>
                        {question?.prompt}
                     </h2>
                  </div>
               )}
            </div>
          </motion.div>

          {/* Answer Interaction Area */}
          <section className={`relative z-10 flex min-h-0 ${answerBoardFlexClass} flex-col overflow-hidden rounded-[2.8rem] border-4 border-brand-dark bg-white shadow-[12px_12px_0px_0px_#1A1A1A]`}>
            
            {/* Answer Grid Container - Added bottom padding to avoid overlap with floating bar */}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-28 sm:p-6 sm:pb-32 lg:p-8 lg:pb-36 custom-scrollbar">
               <div className={`grid min-h-full ${answerGridColumnsClass} gap-4 sm:gap-6`}>
                  {question?.answers?.map((ans: string, i: number) => {
                    const isSelected = currentSelectedAnswer === i;
                    return (
                      <motion.button
                        key={`ans-${i}`}
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ opacity: 1, scale: isSelected ? 1 : 1 }}
                        whileHover={{ scale: isSelectionLocked ? 1 : 1.02 }}
                        whileTap={{ scale: isSelectionLocked ? 1 : 0.98 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => handleAnswerSelect(i)}
                        className={`
                          group relative flex ${studentAnswerMinHeightClass} items-center rounded-[2rem] border-4 border-brand-dark px-6 py-4 text-left transition-all sm:px-8
                          ${isSelected
                            ? 'bg-brand-dark text-white shadow-[8px_8px_0px_0px_#FF5A36]'
                            : `${COLORS[i % 4].bg} ${COLORS[i % 4].text} shadow-[6px_6px_0px_0px_#1A1A1A] hoverShadowSmall`
                          }
                          ${isSelectionLocked && !isSelected ? 'opacity-30 grayscale-[0.8]' : ''}
                        `}
                      >
                        <div className={`mr-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 font-black text-lg transition-colors ${
                          isSelected ? 'border-white/20 bg-white/10' : 'border-brand-dark/10 bg-white/40 text-brand-dark/30'
                        }`}>
                          {formatAnswerSlotLabel(i)}
                        </div>
                        <span className={`block flex-1 break-words font-black leading-tight ${studentAnswerTextClass}`}>
                          {ans}
                        </span>
                        
                        {isSelected && !hasAnswered && (
                          <div className="absolute top-2 right-4 flex h-6 items-center gap-1.5 rounded-full bg-brand-orange px-3 text-[10px] font-black uppercase tracking-widest text-white shadow-lg">
                             <Stars className="h-3 w-3 fill-current" />
                             Selected
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
               </div>
            </div>

            {/* Space-Optimized Floating Action Overlay - Now at the BOTTOM */}
            <AnimatePresence>
              {(currentSelectedAnswer !== null || hasAnswered) && (
                <motion.div 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 50, opacity: 0 }}
                  className="absolute bottom-0 left-0 right-0 z-40 border-t-4 border-brand-dark bg-brand-bg/90 backdrop-blur-xl px-4 py-4 sm:px-8 sm:py-6 shadow-[0px_-8px_30px_rgba(0,0,0,0.1)]"
                >
                  <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto">
                    <div className="min-w-0 flex-1">
                       <p className="text-[10px] font-black uppercase text-brand-purple tracking-widest leading-none mb-2">
                         {isRevote ? 'Final Selection' : 'Choice Locked?'}
                       </p>
                       <p className="text-base font-bold truncate italic text-brand-dark leading-tight">
                         "{selectedAnswerText}"
                       </p>
                    </div>

                    <div className="flex items-center">
                       {shouldShowAnswerSummary && !hasAnswered && (
                         <motion.button
                           whileHover={{ scale: 1.05 }}
                           whileTap={{ scale: 0.95 }}
                           onClick={handleLockIn}
                           className="flex h-14 items-center gap-3 rounded-2xl border-4 border-brand-dark bg-brand-dark px-10 text-base font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#FF5A36]"
                         >
                           <CheckCircle className="h-5 w-5 text-brand-yellow" />
                           <span>Lock Choice</span>
                         </motion.button>
                       )}
                       {hasAnswered && (
                         <div className="flex h-14 items-center gap-3 rounded-2xl border-4 border-brand-dark bg-emerald-500 px-10 text-base font-black text-white shadow-[6px_6px_0px_0px_#1A1A1A]">
                            <CheckCircle2 className="h-5 w-5" />
                            <span>Submitted</span>
                         </div>
                       )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
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
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Reveal Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
             <div className="flex items-center gap-3">
                <div className="rounded-2xl border-2 border-brand-dark px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-brand-bg shadow-[3px_3px_0px_0px_#1A1A1A]">
                   {t('game.status.reveal')}
                </div>
             </div>
             
             <div className="flex items-center gap-3">
               <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <Trophy className="h-5 w-5 fill-current text-brand-yellow" />
                 <span className="font-black text-lg">{score}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Reveal Content Viewport - Optimized for 100vh */}
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 w-full max-w-2xl mx-auto overflow-hidden">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2.5rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[6px_6px_0px_0px_#1A1A1A] sm:p-7"
           >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] border-4 border-brand-dark bg-brand-bg shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-20 sm:w-20">
                 {answeredCorrectly ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }}>
                       <CheckCircle className="h-8 w-8 text-emerald-500 sm:h-10 sm:w-10" />
                    </motion.div>
                 ) : (
                    <motion.div animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                       <Flame className="h-8 w-8 text-brand-orange sm:h-10 sm:w-10" />
                    </motion.div>
                 )}
              </div>

              <h2 className="mb-2 text-2xl font-black tracking-tighter text-brand-dark sm:text-4xl">
                 {answeredCorrectly ? t('game.feedback.correct') : chosenAnswer ? t('game.feedback.incorrect') : t('game.feedback.timesUp')}
              </h2>
              
              <p className="mx-auto max-w-[32ch] text-base font-bold leading-tight text-brand-dark/50 sm:text-lg">
                 {answeredCorrectly ? 'Dynamic performance! You’re crushing this.' : 'A learning moment! Swipe through the details below.'}
              </p>

              <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
                 <RevealAnswerCard
                    label="Your Submission"
                    value={chosenAnswer || 'Thinking...'}
                    tone={answeredCorrectly ? 'success' : chosenAnswer ? 'warning' : 'neutral'}
                 />
                 <RevealAnswerCard
                    label="Correct Solution"
                    value={correctAnswer || 'Revealing...'}
                    tone="success"
                 />
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-3">
                 <PlayerMetricCard label="Score" value={score} tone="dark" />
                 <PlayerMetricCard label="Streak" value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
              </div>

              {question?.explanation && (
                 <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-6 rounded-[1.8rem] border-4 border-brand-dark bg-brand-bg/40 p-4 text-left border-dashed"
                 >
                    <div className="mb-2 flex items-center gap-2">
                       <Sparkles className="h-3 w-3 text-brand-purple" />
                       <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-purple">The "Why" Factor</p>
                    </div>
                    <p className="text-sm font-bold text-brand-dark/80 sm:text-base italic leading-tight">
                       "{question.explanation}"
                    </p>
                 </motion.div>
              )}

              <div className="mt-8 flex items-center justify-center gap-3">
                 <div className="h-2 w-2 animate-bounce rounded-full bg-brand-purple" />
                 <div className="h-2 w-2 animate-bounce rounded-full bg-brand-yellow [animation-delay:0.2s]" />
                 <div className="h-2 w-2 animate-bounce rounded-full bg-brand-orange [animation-delay:0.4s]" />
                 <span className="ml-1 font-black uppercase tracking-[0.15em] text-[8px] text-brand-dark/30">Host Synced</span>
              </div>
           </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Leaderboard Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
             <div className="flex items-center gap-3">
                <div className="rounded-2xl border-2 border-brand-dark px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-brand-bg shadow-[3px_3px_0px_0px_#1A1A1A]">
                   {t('game.leaderboard.title')}
                </div>
             </div>
             
             <div className="flex items-center gap-3">
               <div className="flex h-11 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <Avatar
                   nickname={String(nickname || '')}
                   imgClassName="h-7 w-7 rounded-xl"
                 />
                 <span className="hidden sm:inline font-black text-sm uppercase tracking-tight">{displayNickname}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Centered Leaderboard Content - Optimized for 100vh */}
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 w-full max-w-2xl mx-auto overflow-hidden">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2.5rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[6px_6px_0px_0px_#1A1A1A] sm:p-7"
           >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] border-4 border-brand-dark bg-brand-yellow shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-20 sm:w-20 text-brand-dark">
                 <Trophy className="h-8 w-8 sm:h-10 sm:w-10" />
              </div>

              <h2 className="mb-2 text-3xl font-black tracking-tighter text-brand-dark sm:text-5xl">Standings</h2>
              <p className="mb-4 text-sm font-bold leading-tight text-brand-dark/40 sm:text-base">Eye on the prize! Watch the main stage.</p>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <PlayerMetricCard label="Score" value={score} tone="dark" />
                <PlayerMetricCard label="Max Streak" value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
              </div>

              <div className="bg-brand-bg/40 p-5 rounded-[1.8rem] border-4 border-brand-dark/5 flex flex-col items-center gap-2">
                 <div className="flex items-center gap-2">
                    <Stars className="h-4 w-4 text-brand-yellow fill-current" />
                    <span className="text-lg font-black text-brand-dark">{t('game.leaderboard.scoreLocked')}</span>
                 </div>
                 <p className="text-xs font-bold text-brand-dark/40 max-w-[30ch]">The rankings are shifting in real-time on the Host screen!</p>
              </div>
           </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'ENDED') {
    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Ended Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
             <div className="flex items-center gap-3">
                <div className="rounded-2xl border-2 border-brand-dark px-4 py-1.5 text-xs font-black uppercase tracking-widest bg-brand-bg shadow-[3px_3px_0px_0px_#1A1A1A]">
                   {t('game.status.ended')}
                </div>
             </div>
             
             <div className="flex items-center gap-3">
               <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <Trophy className="h-5 w-5 fill-current text-brand-yellow" />
                 <span className="font-black text-lg">{score}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Centered Ended Content */}
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 sm:p-8 lg:p-12 w-full max-w-3xl mx-auto">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[3.5rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[16px_16px_0px_0px_#1A1A1A] sm:p-12"
           >
              <div className="mx-auto mb-10 flex h-28 w-28 items-center justify-center rounded-[2.5rem] border-4 border-brand-dark bg-brand-yellow shadow-[8px_8px_0px_0px_#1A1A1A] sm:h-36 sm:w-36">
                 <Sparkles className="h-16 w-16 text-brand-dark" />
              </div>

              <h2 className="mb-4 text-5xl font-black tracking-tighter text-brand-dark sm:text-7xl">{t('game.ended.title')}</h2>
              <p className="mb-10 text-xl font-bold leading-relaxed text-brand-dark/40 sm:text-3xl">{t('game.ended.body')}</p>

              <div className="grid grid-cols-2 gap-6 mb-12">
                <PlayerMetricCard label="Final Rank" value={score > 1000 ? "#4" : "#12"} tone="dark" />
                <PlayerMetricCard label="Final Streak" value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
              </div>

              <div className="flex flex-col gap-5 sm:flex-row sm:justify-center">
                 <motion.button
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => navigate(`/student/dashboard/${nickname}`)}
                   className="rounded-[1.5rem] border-4 border-brand-dark bg-brand-orange px-10 py-5 font-black text-white shadow-[6px_6px_0px_0px_#1A1A1A] transition-all hover:bg-brand-orange/90"
                 >
                   {t('game.ended.primary')}
                 </motion.button>
                 <motion.button
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => navigate('/')}
                   className="rounded-[1.5rem] border-4 border-brand-dark bg-white px-10 py-5 font-black text-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] transition-all hover:bg-brand-bg/50"
                 >
                   {t('game.ended.secondary')}
                 </motion.button>
              </div>
           </motion.div>
        </div>
      </div>
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
  showWhenStable = false,
}: {
  connectionState: 'connecting' | 'live' | 'fallback';
  sessionError: string;
  actionError: string;
  pendingSubmission?: QueuedAnswerSubmission | null;
  onRetryPending?: () => void;
  isRetryingPendingSubmission?: boolean;
  showWhenStable?: boolean;
}) {
  const { t } = useAppLanguage();
  if (!showWhenStable && !pendingSubmission && !actionError && !sessionError && connectionState === 'live') {
    return null;
  }
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
    <div className={`rounded-2xl border-4 p-3 sm:p-4 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{label}</p>
      <p className="text-base sm:text-xl font-black text-brand-dark truncate">{value}</p>
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
    <div className={`rounded-2xl border-4 border-brand-dark p-3 sm:p-4 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-1">{label}</p>
      <p className="text-lg sm:text-2xl font-black">{value}</p>
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
