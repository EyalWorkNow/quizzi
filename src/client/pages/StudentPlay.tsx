import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, CheckCircle2, Clock, Flame, LoaderCircle, Sparkles, Stars, Trophy, Wifi, WifiOff, XCircle } from 'lucide-react';
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
import { isPeerInstructionMode, isUntimedMode, requiresConfidenceLock } from '../lib/sessionModeRules.ts';
import { apiFetch, apiFetchJson, apiEventSource } from '../lib/api.ts';
import { getParticipantToken } from '../lib/studentSession.ts';
import { enterLinkedStudentLiveSession } from '../lib/studentLiveSession.ts';
import { loadStudentAuth } from '../lib/studentAuth.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { getLiveQuestionDensity, formatAnswerSlotLabel } from '../../shared/liveQuestionDensity.ts';
import type { TelemetryEvent, TelemetryPayload } from '../../shared/types.ts';

const ANSWER_TONES = [
  {
    bg: '#B488FF',
    text: '#ffffff',
    hover: '#9E70F6',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#6D49C6',
  },
  {
    bg: '#FFD13B',
    text: '#1A1A1A',
    hover: '#FFB703',
    hoverText: '#1A1A1A',
    sweep: '#FF5A36',
    shadow: '#1A1A1A',
    hoverShadow: '#B76F00',
  },
  {
    bg: '#FF8A5B',
    text: '#ffffff',
    hover: '#FF6E45',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#C44120',
  },
  {
    bg: '#FFF8EA',
    text: '#1A1A1A',
    hover: '#B488FF',
    hoverText: '#ffffff',
    sweep: '#FFD13B',
    shadow: '#1A1A1A',
    hoverShadow: '#6D49C6',
  },
] as const;

const SELECTED_ANSWER_TONE = {
  bg: '#1A1A1A',
  text: '#ffffff',
  hover: '#1A1A1A',
  hoverText: '#ffffff',
  sweep: '#FF5A36',
  shadow: '#FF5A36',
  hoverShadow: '#FF5A36',
} as const;

function buildAnswerToneStyle(index: number, isSelected: boolean): CSSProperties {
  const tone = isSelected ? SELECTED_ANSWER_TONE : ANSWER_TONES[index % ANSWER_TONES.length];
  return {
    ['--student-answer-bg' as string]: tone.bg,
    ['--student-answer-text' as string]: tone.text,
    ['--student-answer-hover-bg' as string]: tone.hover,
    ['--student-answer-hover-text' as string]: tone.hoverText,
    ['--student-answer-sweep' as string]: tone.sweep,
    ['--student-answer-shadow' as string]: tone.shadow,
    ['--student-answer-hover-shadow' as string]: tone.hoverShadow,
  };
}

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
  telemetry: TelemetryPayload;
  queuedAt: number;
  selectedAnswerText: string;
};

type StoredSeatSnapshot = {
  participantId: string;
  nickname: string;
  participantToken: string;
  storedSessionPin: string;
  teamName: string;
  savedGameType: string;
};

const TELEMETRY_VERSION = 'telemetry_v2';

function readStoredSeatSnapshot(): StoredSeatSnapshot {
  if (typeof window === 'undefined') {
    return {
      participantId: '',
      nickname: '',
      participantToken: '',
      storedSessionPin: '',
      teamName: '',
      savedGameType: '',
    };
  }

  return {
    participantId: String(window.localStorage.getItem('participant_id') || ''),
    nickname: String(window.localStorage.getItem('nickname') || ''),
    participantToken: String(getParticipantToken() || ''),
    storedSessionPin: String(window.localStorage.getItem('session_pin') || ''),
    teamName: String(window.localStorage.getItem('team_name') || ''),
    savedGameType: String(window.localStorage.getItem('game_type') || ''),
  };
}
const UI_FREEZE_THRESHOLD_MS = 2500;

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

function isInvalidSessionStateError(message: string) {
  return message.toLowerCase().includes('invalid session state');
}

function resolvePhaseSeconds(value: unknown, fallback = 30) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function detectDeviceProfile() {
  if (typeof window === 'undefined') return 'unknown';
  const width = window.innerWidth || 0;
  const hasTouch = typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints || 0) > 0;
  if (width > 0 && width < 640) return hasTouch ? 'mobile-touch' : 'mobile';
  if (width > 0 && width < 1024) return hasTouch ? 'tablet-touch' : 'tablet';
  return hasTouch ? 'hybrid' : 'desktop';
}

function StudentPlaySubmitButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      type="button"
      className="student-play-submit-button"
    >
      <span className="student-play-submit-button__text">{label}</span>
      <span className="student-play-submit-button__icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="50" height="20" viewBox="0 0 38 15" fill="none">
          <path
            fill="currentColor"
            d="M10 7.519l-.939-.344h0l.939.344zm14.386-1.205l-.981-.192.981.192zm1.276 5.509l.537.843.148-.094.107-.139-.792-.611zm4.819-4.304l-.385-.923h0l.385.923zm7.227.707a1 1 0 0 0 0-1.414L31.343.448a1 1 0 0 0-1.414 0 1 1 0 0 0 0 1.414l5.657 5.657-5.657 5.657a1 1 0 0 0 1.414 1.414l6.364-6.364zM1 7.519l.554.833.029-.019.094-.061.361-.23 1.277-.77c1.054-.609 2.397-1.32 3.629-1.787.617-.234 1.17-.392 1.623-.455.477-.066.707-.008.788.034.025.013.031.021.039.034a.56.56 0 0 1 .058.235c.029.327-.047.906-.39 1.842l1.878.689c.383-1.044.571-1.949.505-2.705-.072-.815-.45-1.493-1.16-1.865-.627-.329-1.358-.332-1.993-.244-.659.092-1.367.305-2.056.566-1.381.523-2.833 1.297-3.921 1.925l-1.341.808-.385.245-.104.068-.028.018c-.011.007-.011.007.543.84zm8.061-.344c-.198.54-.328 1.038-.36 1.484-.032.441.024.94.325 1.364.319.45.786.64 1.21.697.403.054.824-.001 1.21-.09.775-.179 1.694-.566 2.633-1.014l3.023-1.554c2.115-1.122 4.107-2.168 5.476-2.524.329-.086.573-.117.742-.115s.195.038.161.014c-.15-.105.085-.139-.076.685l1.963.384c.192-.98.152-2.083-.74-2.707-.405-.283-.868-.37-1.28-.376s-.849.069-1.274.179c-1.65.43-3.888 1.621-5.909 2.693l-2.948 1.517c-.92.439-1.673.743-2.221.87-.276.064-.429.065-.492.057-.043-.006.066.003.155.127.07.099.024.131.038-.063.014-.187.078-.49.243-.94l-1.878-.689zm14.343-1.053c-.361 1.844-.474 3.185-.413 4.161.059.95.294 1.72.811 2.215.567.544 1.242.546 1.664.459a2.34 2.34 0 0 0 .502-.167l.15-.076.049-.028.018-.011c.013-.008.013-.008-.524-.852l-.536-.844.019-.012c-.038.018-.064.027-.084.032-.037.008.053-.013.125.056.021.02-.151-.135-.198-.895-.046-.734.034-1.887.38-3.652l-1.963-.384zm2.257 5.701l.791.611.024-.031.08-.101.311-.377 1.093-1.213c.922-.954 2.005-1.894 2.904-2.27l-.771-1.846c-1.31.547-2.637 1.758-3.572 2.725l-1.184 1.314-.341.414-.093.117-.025.032c-.01.013-.01.013.781.624zm5.204-3.381c.989-.413 1.791-.42 2.697-.307.871.108 2.083.385 3.437.385v-2c-1.197 0-2.041-.226-3.19-.369-1.114-.139-2.297-.146-3.715.447l.771 1.846z"
          />
        </svg>
      </span>
    </motion.button>
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
  const [lastScoreAwarded, setLastScoreAwarded] = useState(0);
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
  const [isRecoveringSeat, setIsRecoveringSeat] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'fallback'>('connecting');
  const [pendingSubmission, setPendingSubmission] = useState<QueuedAnswerSubmission | null>(null);
  const [isRetryingPendingSubmission, setIsRetryingPendingSubmission] = useState(false);

  const firstInteractionMsRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const answerHistoryRef = useRef<{ index: number; timestamp: number }[]>([]);
  const telemetryEventsRef = useRef<TelemetryEvent[]>([]);
  const telemetryEventSequenceRef = useRef(0);
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
  const optionHoverCountsRef = useRef<Record<number, number>>({});
  const currentHoverOptionRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const lastPointerTrackedAtRef = useRef(0);
  const lastPointerPositionRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const outsideAnswerPointerMovesRef = useRef(0);
  const rapidPointerJumpsRef = useRef(0);
  const lastPromptRereadAtRef = useRef(0);
  const firstRoundChoiceRef = useRef<number | null>(null);
  const currentSelectedAnswerRef = useRef<number | null>(null);
  const pendingSubmissionRef = useRef<QueuedAnswerSubmission | null>(null);
  const submissionRetryCountRef = useRef(0);
  const reconnectCountRef = useRef(0);
  const visibilityInterruptionsRef = useRef(0);
  const connectionStateRef = useRef<'connecting' | 'live' | 'fallback'>('connecting');
  const linkedSeatBootstrapAttemptedRef = useRef(false);
  const participantAuthRecoveryAttemptedRef = useRef(false);
  const seatRecoveryInFlightRef = useRef<Promise<StoredSeatSnapshot | null> | null>(null);
  const expirySyncKeyRef = useRef('');

  const focusLossDebounceRef = useRef(0);
  const answerBoardRef = useRef<HTMLDivElement | null>(null);
  const idleThresholdMs = 4000;

  const [seatSnapshot, setSeatSnapshot] = useState<StoredSeatSnapshot>(() => readStoredSeatSnapshot());
  const participantId = seatSnapshot.participantId;
  const nickname = seatSnapshot.nickname;
  const participantToken = seatSnapshot.participantToken;
  const storedSessionPin = seatSnapshot.storedSessionPin;
  const teamName = seatSnapshot.teamName;
  const savedGameType = seatSnapshot.savedGameType;
  const participantIdNumber = Number.parseInt(participantId, 10);
  const linkedStudentSession = loadStudentAuth();
  const linkedStudentUserId = Number(linkedStudentSession?.student_user_id || 0);
  const linkedStudentDisplayName = String(linkedStudentSession?.displayName || '').trim();
  const hasMatchingStoredSeat = Boolean(
    Number.isFinite(participantIdNumber) && participantIdNumber > 0
    && nickname
    && participantToken
    && String(storedSessionPin || '') === String(pin || ''),
  );
  const playStateKey = pin && participantId ? buildStudentPlayStateKey(String(pin), String(participantId)) : '';
  const queuedAnswerKey = pin && participantId ? buildQueuedAnswerKey(String(pin), String(participantId)) : '';
  const displayNickname = extractNickname(String(nickname || ''));
  const participantDashboardPath = nickname ? `/student/dashboard/${nickname}` : '/';
  const linkedStudentHomePath = linkedStudentUserId ? '/student/me' : '';
  const primaryExitPath = linkedStudentHomePath || participantDashboardPath;
  const leaveSessionPath = linkedStudentHomePath || (pin ? `/join/${pin}` : '/');
  const modeConfig = sessionMeta?.mode_config || sessionMeta?.modeConfig || {};
  const gameMode = getGameMode(sessionMeta?.game_type || savedGameType || 'classic_quiz');
  const gameTone = getGameModeTone(gameMode.id);
  const isPeerMode = isPeerInstructionMode(gameMode.id, modeConfig);
  const needsConfidence = requiresConfidenceLock(gameMode.id, modeConfig);
  const isUntimedQuestionPhase =
    (status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE') && isUntimedMode(gameMode.id, modeConfig);
  const isInteractivePhase = status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE';
  const isTimedInteractivePhaseExpired =
    isInteractivePhase &&
    !isUntimedQuestionPhase &&
    timeLeft <= 0;
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
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    pendingSubmissionRef.current = pendingSubmission;
  }, [pendingSubmission]);

  useEffect(() => {
    linkedSeatBootstrapAttemptedRef.current = false;
    participantAuthRecoveryAttemptedRef.current = false;
  }, [pin]);

  useEffect(() => {
    setSeatSnapshot(readStoredSeatSnapshot());
  }, [pin]);

  const refreshSeatSnapshot = () => {
    const nextSnapshot = readStoredSeatSnapshot();
    setSeatSnapshot(nextSnapshot);
    return nextSnapshot;
  };

  const ensureActiveSeatSnapshot = async () => {
    const currentSnapshot = readStoredSeatSnapshot();
    if (
      Number.parseInt(currentSnapshot.participantId, 10) > 0
      && currentSnapshot.participantToken
      && String(currentSnapshot.storedSessionPin || '') === String(pin || '')
    ) {
      setSeatSnapshot(currentSnapshot);
      return currentSnapshot;
    }

    if (!linkedStudentUserId || !pin) {
      setSeatSnapshot(currentSnapshot);
      return currentSnapshot;
    }

    if (seatRecoveryInFlightRef.current) {
      return seatRecoveryInFlightRef.current;
    }

    const recoveryPromise = enterLinkedStudentLiveSession({
      pin: String(pin),
      nickname: linkedStudentDisplayName || String(currentSnapshot.nickname || nickname || ''),
    })
      .then(() => refreshSeatSnapshot())
      .catch((error: any) => {
        const nextSnapshot = refreshSeatSnapshot();
        setSessionError(String(error?.message || 'We could not refresh your seat in this live room.'));
        return nextSnapshot;
      })
      .finally(() => {
        seatRecoveryInFlightRef.current = null;
      });

    seatRecoveryInFlightRef.current = recoveryPromise;
    return recoveryPromise;
  };

  useEffect(() => {
    if (!pin) {
      navigate('/');
      return;
    }
    if (hasMatchingStoredSeat) {
      setSessionError('');
      return;
    }
    if (linkedSeatBootstrapAttemptedRef.current) {
      if (!isRecoveringSeat) {
        setIsBootstrapping(false);
      }
      return;
    }

    linkedSeatBootstrapAttemptedRef.current = true;

    if (!linkedStudentUserId) {
      setSessionError(
        storedSessionPin && String(storedSessionPin) !== String(pin)
          ? 'This live link belongs to a different room than the saved seat on this device. Join this room from the student area or the room code page.'
          : 'This live room needs a saved seat. Join it from the student area or enter the room code first.',
      );
      setIsBootstrapping(false);
      return;
    }

    let cancelled = false;
    setSessionError('');
    setActionError('');
    setIsRecoveringSeat(true);
    setIsBootstrapping(true);

    void enterLinkedStudentLiveSession({
      pin: String(pin),
      nickname: linkedStudentDisplayName || String(nickname || ''),
    })
      .then(() => {
        if (cancelled) return;
        window.location.replace(`/student/session/${pin}/play`);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setSessionError(String(error?.message || 'We could not restore your seat in this live room.'));
        setIsBootstrapping(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsRecoveringSeat(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasMatchingStoredSeat, isRecoveringSeat, linkedStudentDisplayName, linkedStudentUserId, navigate, nickname, pin, storedSessionPin]);

  useEffect(() => {
    const previousState = connectionStateRef.current;
    if (previousState === 'fallback' && connectionState === 'live') {
      reconnectCountRef.current += 1;
    }
    if (
      question?.id
      && ['QUESTION_ACTIVE', 'QUESTION_REVOTE', 'QUESTION_DISCUSSION', 'QUESTION_REVEAL'].includes(status)
      && previousState !== connectionState
    ) {
      recordTelemetryEvent('network_state_changed', {
        payload: {
          previous_state: previousState,
          next_state: connectionState,
        },
      });
    }
    connectionStateRef.current = connectionState;
  }, [connectionState, question?.id, status]);

  const recordTelemetryEvent = (
    eventType: TelemetryEvent['event_type'],
    {
      optionIndex = null,
      payload,
      eventTime = Date.now(),
      networkLatencyMs = 0,
      clientRenderDelayMs = 0,
    }: {
      optionIndex?: number | null;
      payload?: Record<string, unknown>;
      eventTime?: number;
      networkLatencyMs?: number;
      clientRenderDelayMs?: number;
    } = {},
  ) => {
    if (!question?.id) return;
    const baseStart = startTimeRef.current || eventTime;
    const eventTsMs = Math.max(0, eventTime - baseStart);
    telemetryEventSequenceRef.current += 1;
    telemetryEventsRef.current = [
      ...telemetryEventsRef.current,
      {
        event_type: eventType,
        event_ts_ms: eventTsMs,
        event_seq: telemetryEventSequenceRef.current,
        option_index: optionIndex ?? undefined,
        payload_json: JSON.stringify(payload || {}),
        network_latency_ms: networkLatencyMs,
        client_render_delay_ms: clientRenderDelayMs,
        device_profile: detectDeviceProfile(),
      },
    ].slice(-180);
  };

  const ensureFirstInteraction = (eventTime = Date.now(), source = 'pointer') => {
    if (firstInteractionMsRef.current !== null) return;
    const baseStart = startTimeRef.current || eventTime;
    firstInteractionMsRef.current = Math.max(0, eventTime - baseStart);
    recordTelemetryEvent('first_interaction', {
      eventTime,
      payload: {
        source,
      },
    });
  };

  const resetTelemetry = () => {
    firstInteractionMsRef.current = null;
    telemetryEventsRef.current = [];
    telemetryEventSequenceRef.current = 0;
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
    submissionRetryCountRef.current = 0;
    reconnectCountRef.current = 0;
    visibilityInterruptionsRef.current = 0;
    optionDwellRef.current = {};
    optionHoverCountsRef.current = {};
    outsideAnswerPointerMovesRef.current = 0;
    rapidPointerJumpsRef.current = 0;
    lastPointerPositionRef.current = null;
    lastPromptRereadAtRef.current = 0;
    currentHoverOptionRef.current = null;
    hoverStartTimeRef.current = null;
  };

  const flushHoverDwell = (forcedTimestamp?: number) => {
    const optionIndex = currentHoverOptionRef.current;
    const hoverStartedAt = hoverStartTimeRef.current;
    if (optionIndex === null || hoverStartedAt === null) return;
    const endedAt = forcedTimestamp ?? Date.now();
    const durationMs = Math.max(0, endedAt - hoverStartedAt);
    optionDwellRef.current = {
      ...optionDwellRef.current,
      [optionIndex]: (optionDwellRef.current[optionIndex] || 0) + durationMs,
    };
    recordTelemetryEvent('option_hover_end', {
      optionIndex,
      eventTime: endedAt,
      payload: {
        duration_ms: durationMs,
      },
    });
    currentHoverOptionRef.current = null;
    hoverStartTimeRef.current = null;
  };

  const beginHoverDwell = (optionIndex: number) => {
    if (isSelectionLocked || !isInteractivePhase) return;
    if (currentHoverOptionRef.current === optionIndex) return;
    const now = Date.now();
    flushHoverDwell(now);
    ensureFirstInteraction(now, 'hover');
    currentHoverOptionRef.current = optionIndex;
    hoverStartTimeRef.current = now;
    optionHoverCountsRef.current = {
      ...optionHoverCountsRef.current,
      [optionIndex]: (optionHoverCountsRef.current[optionIndex] || 0) + 1,
    };
    recordTelemetryEvent('option_hover_start', {
      optionIndex,
      eventTime: now,
    });
  };

  const recordActivity = (
    kind: 'pointer' | 'keyboard' | 'touch',
    eventTime = Date.now(),
    details?: { x?: number; y?: number; target?: EventTarget | null },
  ) => {
    if (!isInteractivePhase || isSelectionLocked) return;

    const idleGap = eventTime - lastActivityTimeRef.current;
    if (idleGap > idleThresholdMs) {
      const idleSpan = idleGap - idleThresholdMs;
      idleTimeMsRef.current += idleSpan;
      longestIdleStreakRef.current = Math.max(longestIdleStreakRef.current, idleSpan);
    }
    lastActivityTimeRef.current = eventTime;
    ensureFirstInteraction(eventTime, kind);

    if (kind === 'pointer') {
      if (eventTime - lastPointerTrackedAtRef.current < 250) return;
      lastPointerTrackedAtRef.current = eventTime;
      pointerActivityCountRef.current += 1;
      if (typeof details?.x === 'number' && typeof details?.y === 'number') {
        const lastPointer = lastPointerPositionRef.current;
        if (
          lastPointer
          && eventTime - lastPointer.at <= 300
          && Math.hypot(details.x - lastPointer.x, details.y - lastPointer.y) >= 220
        ) {
          rapidPointerJumpsRef.current += 1;
        }
        lastPointerPositionRef.current = {
          x: details.x,
          y: details.y,
          at: eventTime,
        };
      }
      if (
        details?.target
        && answerBoardRef.current
        && details.target instanceof Node
        && !answerBoardRef.current.contains(details.target)
      ) {
        outsideAnswerPointerMovesRef.current += 1;
      }
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

  const syncStateFromServer = async () => {
    if (!pin) return null;
    const data = await apiFetchJson(`/api/sessions/${pin}/student-state`);
    const sessionPayload = data?.session || null;
    const participantState = data?.participant_state || null;
    const currentAnswer = participantState?.current_answer || null;
    const nextQuestion = data?.question || null;
    const nextStatus = String(sessionPayload?.status || 'LOBBY');

    setSessionMeta(sessionPayload);
    setStatus(nextStatus as any);
    setScore(Number(participantState?.score || 0));
    setStreak(Number(participantState?.streak || 0));

    if (nextQuestion) {
      setQuestion(nextQuestion);
      setTimeLeft(resolvePhaseSeconds(nextQuestion.time_limit_seconds, 30));
    }

    if (currentAnswer && nextQuestion && Number(currentAnswer.question_id) === Number(nextQuestion.id)) {
      clearPendingSubmissionState();
      setHasAnswered(true);
      setCurrentSelectedAnswer(Number(currentAnswer.chosen_index));
      setFirstRoundChoice(Number(currentAnswer.chosen_index));
      setHasLockedInitialVote(false);
      setSelectedConfidence(2);
      setLastScoreAwarded(Number(currentAnswer.score_awarded || 0));
    } else if (nextStatus === 'QUESTION_ACTIVE' || nextStatus === 'QUESTION_REVOTE') {
      setHasAnswered(false);
      setHasLockedInitialVote(false);
      setLastScoreAwarded(0);
    }

    return data;
  };

  const applyAnswerSubmissionSuccess = (payload: any) => {
    clearPendingSubmissionState();
    setHasAnswered(true);
    const scoreAwarded = Number(payload?.score_awarded || 0);
    const participantScoreTotal = Number(payload?.participant_score_total);
    const participantStreak = Number(payload?.participant_streak);
    const chosenIndex = Number(payload?.chosen_index);
    const hasChosenIndex = Number.isFinite(chosenIndex);
    setLastScoreAwarded(Math.max(0, scoreAwarded));
    if (hasChosenIndex) {
      setCurrentSelectedAnswer(chosenIndex);
      setFirstRoundChoice(chosenIndex);
    }

    if (Number.isFinite(participantScoreTotal)) {
      setScore(participantScoreTotal);
    } else if (!payload?.duplicate) {
      setScore((current) => current + scoreAwarded);
    }

    if (Number.isFinite(participantStreak)) {
      setStreak(participantStreak);
    } else if (!payload?.duplicate) {
      if (scoreAwarded > 0) {
        setStreak((current) => current + 1);
      } else {
        setStreak(0);
      }
    }

    if (participantIdNumber > 0) {
      void publishAnswerProgress(String(pin || ''), {
        participantId: participantIdNumber,
        totalAnswers: Number(payload?.total_answers || 0),
        expected: Number(payload?.expected || 0),
      });
      void publishLiveSelection(String(pin || ''), {
        participantId: participantIdNumber,
        nickname: String(nickname || ''),
        chosenIndex: Number.isFinite(chosenIndex) ? chosenIndex : -1,
      });
    }
  };

  const postAnswerSubmission = async (submission: QueuedAnswerSubmission) => {
    const maxAttempts = 3;
    let attempt = 0;
    const activeSeat = await ensureActiveSeatSnapshot();
    const activeParticipantId = Number.parseInt(String(activeSeat?.participantId || ''), 10);

    if (!Number.isFinite(activeParticipantId) || activeParticipantId <= 0) {
      throw new Error('Participant authentication required');
    }

    while (attempt < maxAttempts) {
      attempt += 1;
      const response = await apiFetch(`/api/sessions/${pin}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: activeParticipantId,
          question_id: submission.questionId,
          chosen_index: submission.chosenIndex,
          response_ms: submission.responseMs,
          confidence_level: submission.confidenceLevel ?? undefined,
          telemetry: submission.telemetry,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        return payload;
      }

      const message = String(payload?.error || 'Failed to submit answer');
      const canRetryStateRace =
        isInvalidSessionStateError(message)
        && (status === 'QUESTION_ACTIVE' || status === 'QUESTION_REVOTE')
        && attempt < maxAttempts;

      if (!canRetryStateRace) {
        if (isInvalidSessionStateError(message)) {
          void syncStateFromServer().catch(() => {});
        }
        throw new Error(message);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 180 * attempt));
    }

    throw new Error('Failed to submit answer');
  };

  const retryPendingSubmission = async () => {
    if (!pendingSubmission || isRetryingPendingSubmission) return;
    try {
      setIsRetryingPendingSubmission(true);
      submissionRetryCountRef.current += 1;
      const refreshedSubmission: QueuedAnswerSubmission = {
        ...pendingSubmission,
        telemetry: {
          ...pendingSubmission.telemetry,
          submission_retry_count: submissionRetryCountRef.current,
          reconnect_count: reconnectCountRef.current,
          visibility_interruptions: visibilityInterruptionsRef.current,
          network_degraded: connectionStateRef.current !== 'live' || (typeof navigator !== 'undefined' && navigator.onLine === false),
          device_profile: detectDeviceProfile(),
          analytics_version: TELEMETRY_VERSION,
        },
      };
      setPendingSubmission(refreshedSubmission);
      const payload = await postAnswerSubmission(refreshedSubmission);
      applyAnswerSubmissionSuccess(payload);
      setActionError('');
    } catch (error: any) {
      const message = String(error?.message || '');
      if (isInvalidSessionStateError(message)) {
        void syncStateFromServer().catch(() => {});
      }
      if (!shouldQueueAnswerRetry(message)) {
        clearPendingSubmissionState();
        setActionError(
          isInvalidSessionStateError(message)
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
    if (!pin) {
      navigate('/');
      return;
    }
    if (!hasMatchingStoredSeat) {
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
        setLastScoreAwarded(0);
        if (nextQuestion) {
          setQuestion(nextQuestion);
        }
        setHasAnswered(false);
        setHasLockedInitialVote(false);
        setFirstRoundChoice(null);
        const nextStartTime = Date.now();
        startTimeRef.current = nextStartTime;
        setStartTime(nextStartTime);
        setTimeLeft(resolvePhaseSeconds(nextQuestion?.time_limit_seconds, 30));
        setCurrentSelectedAnswer(null);
        setSelectedConfidence(2);
        resetTelemetry();
      } else if (nextStatus === 'QUESTION_DISCUSSION') {
        if (nextQuestion) {
          setQuestion(nextQuestion);
          setTimeLeft(resolvePhaseSeconds(nextQuestion.time_limit_seconds, Number(nextModeConfig?.discussion_seconds || 30)));
      } else {
          setTimeLeft(resolvePhaseSeconds(nextModeConfig?.discussion_seconds, 30));
        }
        if (firstRoundChoiceRef.current === null && currentSelectedAnswerRef.current !== null) {
          setFirstRoundChoice(currentSelectedAnswerRef.current);
        }
        flushHoverDwell();
      } else if (nextStatus === 'QUESTION_REVOTE') {
        if (nextQuestion) {
          setQuestion(nextQuestion);
          setTimeLeft(resolvePhaseSeconds(nextQuestion.time_limit_seconds, Number(nextModeConfig?.revote_seconds || 22)));
        } else {
          setTimeLeft(resolvePhaseSeconds(nextModeConfig?.revote_seconds, 22));
        }
        setLastScoreAwarded(0);
        setHasAnswered(false);
        setHasLockedInitialVote(false);
        setCurrentSelectedAnswer((current) => current ?? firstRoundChoiceRef.current);
        setSelectedConfidence(2);
        const nextStartTime = Date.now();
        startTimeRef.current = nextStartTime;
        setStartTime(nextStartTime);
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
        navigate(primaryExitPath);
      }
    };

    const startEventSource = () => {
      if (cancelled || eventSource) return;

      eventSource = apiEventSource(`/api/sessions/${pin}/stream`);
      eventSource.onopen = () => {
        if (!cancelled && connectionStateRef.current !== 'live') {
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

    startEventSource();

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
        setLastScoreAwarded(0);
        if (typeof sessionPayload?.current_question_index === 'number') {
          setTimeLeft(resolvePhaseSeconds(data?.question?.time_limit_seconds, 30));
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
          setLastScoreAwarded(Number(currentAnswer.score_awarded || 0));
          return;
        }
        if (queuedSubmission && data?.question && queuedSubmission.questionId === Number(data.question.id)) {
          setPendingSubmission(queuedSubmission);
          setCurrentSelectedAnswer(queuedSubmission.chosenIndex);
          setSelectedConfidence(queuedSubmission.confidenceLevel || 2);
        }
        if (persistedState && data?.question && persistedState.questionId === Number(data.question.id)) {
          setCurrentSelectedAnswer(
            persistedState.currentSelectedAnswer ?? persistedState.firstRoundChoice ?? null,
          );
          setSelectedConfidence(persistedState.selectedConfidence || 2);
          setFirstRoundChoice(persistedState.firstRoundChoice);
          // Do not re-apply a purely local "locked first vote" flag on fresh room entry.
          // If the server has no answer for this question yet, restoring that flag can
          // trap linked students in a locked state with no way to submit.
          setHasLockedInitialVote(false);
          setHasAnswered(false);
        }
      })
      .catch((error) => {
        console.error('Failed to load session meta:', error);
        if (cancelled) return;
        if (String(error?.message || '').includes('Participant authentication required')) {
          if (linkedStudentUserId && !participantAuthRecoveryAttemptedRef.current) {
            participantAuthRecoveryAttemptedRef.current = true;
            setSessionError('Refreshing your seat in this live room...');
            setIsRecoveringSeat(true);
            setIsBootstrapping(true);
            void enterLinkedStudentLiveSession({
              pin: String(pin),
              nickname: linkedStudentDisplayName || String(nickname || ''),
            })
              .then(() => {
                if (cancelled) return;
                window.location.replace(`/student/session/${pin}/play`);
              })
              .catch((recoveryError: any) => {
                if (cancelled) return;
                setSessionError(String(recoveryError?.message || 'We could not refresh your access to this live room.'));
                setIsBootstrapping(false);
              })
              .finally(() => {
                if (!cancelled) {
                  setIsRecoveringSeat(false);
                }
              });
            return;
          }
          setSessionError('The saved access for this room is no longer valid. Please enter the room again.');
          setIsBootstrapping(false);
          return;
        }
        setSessionError(error?.message || 'לא ניתן היה לטעון את הסשן.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsBootstrapping(false);
      });

    if (participantIdNumber > 0) {
      void attachParticipantPresence(String(pin || ''), {
        participantId: participantIdNumber,
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
    }

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
      }
    });

    return () => {
      cancelled = true;
      realtimeCleanup?.();
      presenceCleanup?.();
      eventSource?.close();
    };
  }, [
    hasMatchingStoredSeat,
    linkedStudentDisplayName,
    linkedStudentUserId,
    navigate,
    nickname,
    participantId,
    participantToken,
    pin,
    playStateKey,
    primaryExitPath,
    queuedAnswerKey,
    savedGameType,
    teamName,
  ]);

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

  useEffect(() => {
    if (!pin || !question?.id || !isTimedInteractivePhaseExpired) return;

    const expiryKey = `${status}:${question.id}`;
    if (expirySyncKeyRef.current === expiryKey) return;
    expirySyncKeyRef.current = expiryKey;
    setActionError((current) => current || 'Time is up. Syncing the next phase...');
    void syncStateFromServer().catch(() => {});
  }, [isTimedInteractivePhaseExpired, pin, question?.id, status]);

  useEffect(() => {
    if (isTimedInteractivePhaseExpired) return;
    expirySyncKeyRef.current = '';
  }, [isTimedInteractivePhaseExpired, question?.id, status]);

  useEffect(() => {
    if (!question?.id || !['QUESTION_ACTIVE', 'QUESTION_REVOTE', 'QUESTION_DISCUSSION'].includes(status)) return;
    const renderedAt = Date.now();
    let settleId = 0;
    const frameId = window.requestAnimationFrame(() => {
      settleId = window.requestAnimationFrame(() => {
        const clientRenderDelayMs = Math.max(0, Date.now() - renderedAt);
        recordTelemetryEvent('question_rendered', {
          eventTime: renderedAt,
          clientRenderDelayMs,
          payload: {
            question_id: Number(question.id),
            has_image: Boolean(question?.image_url),
            answer_count: Array.isArray(question?.answers) ? question.answers.length : 0,
          },
        });
        if (clientRenderDelayMs >= UI_FREEZE_THRESHOLD_MS) {
          recordTelemetryEvent('ui_freeze_detected', {
            payload: {
              freeze_ms: clientRenderDelayMs,
              phase: status,
            },
          });
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (settleId) {
        window.cancelAnimationFrame(settleId);
      }
    };
  }, [question?.id, question?.image_url, question?.answers, status]);

  useEffect(() => {
    if (!['QUESTION_ACTIVE', 'QUESTION_REVOTE', 'QUESTION_DISCUSSION'].includes(status)) return;
    let frameId = 0;
    let lastTick = performance.now();
    const trackFrame = (tick: number) => {
      const delta = tick - lastTick;
      if (delta >= UI_FREEZE_THRESHOLD_MS) {
        recordTelemetryEvent('ui_freeze_detected', {
          payload: {
            freeze_ms: Math.round(delta),
            phase: status,
          },
        });
      }
      lastTick = tick;
      frameId = window.requestAnimationFrame(trackFrame);
    };

    frameId = window.requestAnimationFrame(trackFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [status, question?.id]);

  // Focus loss tracker
  useEffect(() => {
    const registerFocusLoss = (reason: 'blur' | 'visibility') => {
      if (isInteractivePhase && !isSelectionLocked) {
        const now = Date.now();
        if (now - focusLossDebounceRef.current < 800) return;
        focusLossDebounceRef.current = now;
        focusLossCountRef.current += 1;
        if (reason === 'visibility') {
          visibilityInterruptionsRef.current += 1;
        }
        if (blurStartRef.current === null) {
          blurStartRef.current = now;
        }
        recordTelemetryEvent(reason === 'visibility' ? 'visibility_hidden' : 'tab_blur', {
          eventTime: now,
        });
        flushHoverDwell(now);
        // Report to host
        if (participantIdNumber > 0) {
          apiFetch(`/api/sessions/${pin}/focus-loss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id: participantIdNumber })
          }).catch(err => console.error('Focus loss report failed:', err));
          void publishFocusAlert(String(pin || ''), {
            participantId: participantIdNumber,
            nickname: String(nickname || ''),
          });
        }
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        registerFocusLoss('visibility');
      } else if (blurStartRef.current !== null) {
        recordTelemetryEvent('visibility_visible');
        blurTimeMsRef.current += Math.max(0, Date.now() - blurStartRef.current);
        blurStartRef.current = null;
      }
    };
    const handleFocusRestore = () => {
      if (blurStartRef.current !== null) {
        recordTelemetryEvent('tab_focus');
        blurTimeMsRef.current += Math.max(0, Date.now() - blurStartRef.current);
        blurStartRef.current = null;
      }
    };
    const handleBlur = () => registerFocusLoss('blur');
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocusRestore);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocusRestore);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hasAnswered, isInteractivePhase, isSelectionLocked, participantId, pin]);

  // Idle time tracker
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => recordActivity('pointer', Date.now(), {
      x: event.clientX,
      y: event.clientY,
      target: event.target,
    });
    const handlePointerDown = (event: PointerEvent) => recordActivity('pointer', Date.now(), {
      x: event.clientX,
      y: event.clientY,
      target: event.target,
    });
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
    recordTelemetryEvent('submit_clicked', {
      optionIndex: finalIndex,
      eventTime: submitTime,
      payload: {
        selected_confidence: needsConfidence ? selectedConfidence : null,
      },
    });
    flushHoverDwell(submitTime);
    if (blurStartRef.current !== null) {
      blurTimeMsRef.current += Math.max(0, submitTime - blurStartRef.current);
      blurStartRef.current = null;
    }
    const responseMs = submitTime - startTime;
    const timeLimitSeconds = resolvePhaseSeconds(question?.time_limit_seconds, 30);
    const timeLimitMs = timeLimitSeconds > 0 ? timeLimitSeconds * 1000 : 0;
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
      if (timeLimitMs <= 0) return count;
      return timeLimitMs - item.timestamp <= 5000 ? count + 1 : count;
    }, 0);

    const telemetry: TelemetryPayload = {
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
      option_hover_counts_json: JSON.stringify(optionHoverCountsRef.current),
      outside_answer_pointer_moves: outsideAnswerPointerMovesRef.current,
      rapid_pointer_jumps: rapidPointerJumpsRef.current,
      submission_retry_count: submissionRetryCountRef.current,
      reconnect_count: reconnectCountRef.current,
      visibility_interruptions: visibilityInterruptionsRef.current,
      network_degraded: connectionStateRef.current !== 'live' || (typeof navigator !== 'undefined' && navigator.onLine === false),
      device_profile: detectDeviceProfile(),
      analytics_version: TELEMETRY_VERSION,
      events: telemetryEventsRef.current,
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
    if (!isInteractivePhase) return;
    if (isTimedInteractivePhaseExpired) {
      setActionError('Time is up. Syncing the next phase...');
      void syncStateFromServer().catch(() => {});
      return;
    }

    const now = Date.now();
    setActionError('');
    ensureFirstInteraction(now, 'answer_select');
    recordActivity('pointer', now);
    beginHoverDwell(index);
    if (currentSelectedAnswer === index) {
      sameAnswerReclicksRef.current += 1;
      return;
    }

    if (currentSelectedAnswerRef.current !== null) {
      recordTelemetryEvent('option_deselected', {
        optionIndex: currentSelectedAnswerRef.current,
        eventTime: now,
        payload: {
          next_index: index,
        },
      });
    }

    setCurrentSelectedAnswer(index);
    answerHistoryRef.current = [...answerHistoryRef.current, { index, timestamp: now - startTimeRef.current }];
    lastActivityTimeRef.current = now;
    recordTelemetryEvent('option_selected', {
      optionIndex: index,
      eventTime: now,
      payload: {
        answer_text: String(question?.answers?.[index] || ''),
      },
    });

    // Broadcast selection change to host for real-time "thinking" pulse
    void (async () => {
      try {
        const activeSeat = await ensureActiveSeatSnapshot();
        const activeParticipantId = Number.parseInt(String(activeSeat?.participantId || ''), 10);
        if (!Number.isFinite(activeParticipantId) || activeParticipantId <= 0) {
          return;
        }

        const response = await apiFetch(`/api/sessions/${pin}/selection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: activeParticipantId,
            chosen_index: index,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message = String(payload?.error || response.statusText || '');
          if (isInvalidSessionStateError(message)) {
            setActionError('The round already moved on. Syncing now...');
            void syncStateFromServer().catch(() => {});
            return;
          }
          throw new Error(message || 'Failed to broadcast selection');
        }

        void publishLiveSelection(String(pin || ''), {
          participantId: activeParticipantId,
          nickname: String(activeSeat?.nickname || nickname || ''),
          chosenIndex: index,
        });
      } catch (err) {
        const message = String((err as any)?.message || '');
        if (isInvalidSessionStateError(message)) {
          setActionError('The round already moved on. Syncing now...');
          void syncStateFromServer().catch(() => {});
          return;
        }
        console.error('Failed to broadcast selection:', err);
      }
    })();
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

  const handlePromptReread = () => {
    const now = Date.now();
    if (now - lastPromptRereadAtRef.current < 1200) return;
    lastPromptRereadAtRef.current = now;
    recordTelemetryEvent('prompt_reread', {
      eventTime: now,
    });
  };

  if (isBootstrapping) {
    return (
      <StudentShellFallback
        title={isRecoveringSeat ? 'Restoring your live seat...' : 'Connecting you to the game...'}
        body={
          isRecoveringSeat
            ? 'We found your student account and are reconnecting it to this live room.'
            : 'We are restoring your seat, syncing the live room, and getting the next phase ready.'
        }
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
        onExit={() => navigate(leaveSessionPath)}
        exitLabel={linkedStudentHomePath ? 'Back to student space' : 'Back home'}
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
        onExit={() => navigate(primaryExitPath)}
        exitLabel={linkedStudentHomePath ? 'Back to student space' : 'Back home'}
      />
    );
  }

  if (status === 'LOBBY') {
    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Lobby Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
             <div className="flex min-w-0 items-center gap-2 sm:gap-3">
               <motion.button
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => {
                   if (window.confirm('Are you sure you want to leave the game?')) {
                     navigate(primaryExitPath);
                   }
                 }}
                 className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-11 sm:w-11"
               >
                 <XCircle className="h-6 w-6 opacity-40" />
               </motion.button>
               <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A] sm:px-4 sm:text-xs sm:tracking-widest">
                  {t('game.status.lobby')}
               </div>
             </div>
             
             <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
               <div className="flex h-10 max-w-full items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:gap-3 sm:px-4">
                 <Avatar
                   nickname={String(nickname || '')}
                   imgClassName="h-6 w-6 rounded-lg sm:h-7 sm:w-7 sm:rounded-xl"
                 />
                 <span className="max-w-[45vw] truncate font-black text-xs uppercase tracking-tight sm:max-w-none sm:text-sm">{displayNickname}</span>
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
        <div className="relative mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-3 py-4 sm:p-5 lg:p-8 custom-scrollbar">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2.25rem] sm:rounded-[3rem] border-4 border-brand-dark bg-white px-5 py-6 sm:px-8 sm:py-8 text-center shadow-[10px_10px_0px_0px_#1A1A1A] sm:shadow-[14px_14px_0px_0px_#1A1A1A] overflow-hidden"
           >
              {/* Background ambient elements */}
              <div className="absolute inset-0 z-0 pointer-events-none opacity-10">
                 <div className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-brand-yellow blur-3xl animate-pulse" />
                 <div className="absolute -bottom-10 -right-10 h-32 w-32 rounded-full bg-brand-purple blur-3xl animate-pulse [animation-delay:1s]" />
              </div>

              <div className="relative z-10 text-center">
                 <div className="mx-auto mb-5 sm:mb-7 w-fit relative group">
                    <motion.div
                      animate={{ 
                        y: [0, -8, 0],
                        rotate: [0, 2, -2, 0]
                      }}
                      transition={{ 
                        duration: 6,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="relative z-10"
                    >
                      <Avatar
                        nickname={String(nickname || '')}
                        className="mb-0"
                        imgClassName="h-24 w-24 sm:h-32 sm:w-32 rounded-[1.75rem] sm:rounded-[2.25rem] border-4 border-brand-dark bg-brand-yellow shadow-[5px_5px_0px_0px_#1A1A1A] sm:shadow-[7px_7px_0px_0px_#1A1A1A]"
                        textClassName="hidden"
                      />
                    </motion.div>
                    
                    {/* Status badge */}
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.5, type: 'spring' }}
                      className="absolute -bottom-1 -right-1 z-20 h-9 w-9 sm:h-10 sm:w-10 rounded-xl sm:rounded-[1.1rem] border-4 border-brand-dark bg-white flex items-center justify-center shadow-[3px_3px_0px_0px_#1A1A1A]"
                    >
                       <CheckCircle className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-emerald-500" />
                    </motion.div>

                    {/* Decorative glow */}
                    <div className="absolute inset-0 -z-10 bg-brand-yellow/20 blur-2xl rounded-full scale-110 opacity-0 group-hover:opacity-100 transition-opacity" />
                 </div>
                 
                 <h2 className="mb-2 sm:mb-3 text-[clamp(2.2rem,8vw,3.8rem)] font-black tracking-tighter leading-none text-brand-dark">
                    You're in!
                 </h2>
                 <p className="mb-6 sm:mb-7 text-sm sm:text-xl font-bold leading-tight text-brand-dark/50 max-w-[24ch] mx-auto">
                    Ready for the magic? The host starts soon.
                 </p>

                 <div className="grid grid-cols-1 gap-3 sm:gap-3.5 sm:grid-cols-2">
                    <LobbyMetaCard label="Game Track" value={gameMode.label} />
                    <LobbyMetaCard label="Your Pod" value={teamName || (gameMode.teamBased ? 'Syncing team' : 'Solo Mastery')} />
                 </div>

                 <div className="mt-6 sm:mt-7 rounded-[1.75rem] sm:rounded-[2.25rem] border-4 border-brand-dark/5 bg-brand-bg/30 px-4 py-3.5 sm:px-5 sm:py-4 flex flex-wrap items-center justify-center gap-3 sm:gap-6">
                    <div className="flex items-center gap-2 sm:gap-3">
                       <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                       <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40">Status:</span>
                       <span className="text-xs sm:text-sm font-black text-brand-dark/80">{connectionLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                       <Wifi className="h-3.5 w-3.5 text-brand-purple/40" />
                       <span className="text-xs sm:text-sm font-black text-brand-dark/80 tracking-tight">Real-time Synced</span>
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
        <div className="relative mx-auto flex-1 min-h-0 w-full max-w-4xl overflow-y-auto px-3 py-4 sm:p-8 lg:p-12 custom-scrollbar">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2.25rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[8px_8px_0px_0px_#1A1A1A] sm:rounded-[3.5rem] sm:p-12 sm:shadow-[16px_16px_0px_0px_#1A1A1A]"
           >
              <h2 className="mb-3 text-3xl font-black tracking-tighter text-brand-dark sm:text-6xl lg:text-7xl">Pod Discussion</h2>
              <p className="mx-auto mb-8 max-w-[30ch] text-base font-bold leading-relaxed text-brand-dark/50 sm:mb-12 sm:text-2xl">
                 Defend your choice, listen to your peers, and sync up for the final vote!
              </p>

              <div className="mb-8 grid grid-cols-1 gap-4 text-left md:grid-cols-2 sm:gap-6 sm:mb-10">
                <div className="rounded-[1.7rem] border-4 border-brand-dark bg-brand-bg/50 p-4 shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2.5rem] sm:p-6 sm:shadow-[8px_8px_0px_0px_#1A1A1A]">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-orange mb-3">Your Initial Choice</p>
                   <p className="text-xl font-black leading-snug text-brand-dark sm:text-2xl">
                     {firstRoundChoice !== null ? question?.answers?.[firstRoundChoice] : 'No choice locked'}
                   </p>
                </div>
                <div className="rounded-[1.7rem] border-4 border-brand-dark bg-brand-yellow p-4 shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2.5rem] sm:p-6 sm:shadow-[8px_8px_0px_0px_#1A1A1A]">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-dark/60 mb-3">Your Pod</p>
                   <p className="text-xl font-black leading-snug text-brand-dark sm:text-2xl">{teamName || 'Consult nearby teammates'}</p>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[2.2rem] border-4 border-brand-dark bg-brand-dark p-5 text-left text-white shadow-[8px_8px_0px_0px_#1A1A1A] sm:rounded-[3rem] sm:p-10 sm:shadow-[12px_12px_0px_0px_#1A1A1A]">
                <div className="absolute -top-10 -right-10 p-4 opacity-10">
                   <Sparkles className="h-40 w-40 text-brand-yellow" />
                </div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-yellow mb-5">Question Spotlight</p>
                   <h3 className="mb-6 text-xl font-black leading-[1.15] tracking-tight text-balance sm:mb-10 sm:text-4xl">{question?.prompt}</h3>
                   
                   <div className="grid gap-4 sm:grid-cols-2">
                     {question?.answers?.map((answer: string, index: number) => (
                       <div
                         key={index}
                         className={`rounded-[1.25rem] border-4 p-4 text-sm font-black transition-colors sm:rounded-[1.5rem] sm:p-5 sm:text-base ${
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
              
              <div className="mt-8 flex items-center justify-center gap-3 sm:mt-12 sm:gap-4">
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
        : gameMode.id === 'accuracy_quiz'
          ? 'Every correct answer earns the same score. Accuracy matters more than speed in this round.'
          : gameMode.quickSummary;
    const lockLabel = isRevote
      ? 'Submit Final Answer'
      : isPeerMode
        ? 'Lock First Vote'
        : needsConfidence
          ? 'Lock Answer + Confidence'
          : 'Lock It In';
    const phaseTimerLabel = isUntimedQuestionPhase ? t('game.timer.untimed') : `${timeLeft}s`;
    const phaseTimerDanger = !isUntimedQuestionPhase && timeLeft <= 5;
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
                    <Clock className={`h-5 w-5 ${phaseTimerDanger ? 'text-rose-500 animate-pulse' : 'text-brand-purple'}`} />
                    <span className={`font-black text-lg ${phaseTimerDanger ? 'text-rose-600' : ''}`}>{phaseTimerLabel}</span>
                  </div>
                  <motion.div
                    key={`wait-score-${score}`}
                    initial={{ scale: 1.2, rotate: -4 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-yellow px-4 shadow-[4px_4px_0px_0px_#1A1A1A]"
                  >
                    <Trophy className="h-5 w-5 fill-current text-brand-dark/30" />
                    <span className="font-black text-lg">{score}</span>
                  </motion.div>
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

                {hasAnswered && lastScoreAwarded > 0 && (
                  <motion.div
                    initial={{ scale: 0.92, opacity: 0, y: 12 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    className="mt-6 rounded-[2.5rem] border-4 border-brand-dark bg-brand-yellow p-6 text-left shadow-[8px_8px_0px_0px_#1A1A1A]"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-dark/50">Score Updated</p>
                        <p className="mt-2 text-4xl font-black tracking-tight text-brand-dark">+{lastScoreAwarded}</p>
                      </div>
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white px-4 py-3 text-right shadow-[4px_4px_0px_0px_#1A1A1A]">
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-brand-dark/40">Total Score</p>
                        <p className="mt-1 text-2xl font-black text-brand-dark">{score}</p>
                      </div>
                    </div>
                  </motion.div>
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
          <div className="mx-auto flex w-full max-w-[1540px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (window.confirm('Are you sure you want to leave the game?')) {
                    navigate(primaryExitPath);
                  }
                }}
                className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-11 sm:w-11"
              >
                <XCircle className="h-6 w-6 opacity-40" />
              </motion.button>
              
              <div className="flex h-10 max-w-[60vw] items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:max-w-none sm:gap-3 sm:px-4">
                <Avatar
                  nickname={String(nickname || '')}
                  imgClassName="h-6 w-6 rounded-lg sm:h-7 sm:w-7 sm:rounded-xl"
                />
                <span className="truncate font-black text-xs uppercase tracking-tight sm:text-sm">{displayNickname}</span>
              </div>
            </div>

            <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
              <div className="flex h-10 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:px-4">
                <Clock className={`h-5 w-5 ${phaseTimerDanger ? 'text-rose-500 animate-pulse' : 'text-brand-purple'}`} />
                <span className={`font-black text-base sm:text-lg ${phaseTimerDanger ? 'text-rose-600' : ''}`}>{phaseTimerLabel}</span>
              </div>
              
              <motion.div
                key={score}
                initial={{ scale: 1.25, rotate: -5 }}
                animate={{ scale: 1, rotate: 0 }}
                className="flex h-10 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-yellow px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:px-4"
              >
                <Trophy className="h-5 w-5 fill-current text-brand-dark/30" />
                <span className="font-black text-base sm:text-lg">{score}</span>
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
        <div className="relative mx-auto flex w-full max-w-[1540px] flex-1 min-h-0 flex-col gap-3 overflow-x-visible overflow-y-auto px-3 py-3 sm:gap-4 sm:p-6 sm:overflow-y-hidden lg:p-8">
          
          {/* Question Hero */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`relative ${questionHeroFlexClass} ${questionHeroMinHeightClass} shrink-0 overflow-hidden rounded-[2rem] border-4 border-brand-dark bg-white shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2.5rem] sm:shadow-[10px_10px_0px_0px_#1A1A1A]`}
          >
            <div className="absolute inset-x-0 top-0 z-20 h-2 bg-gradient-to-r from-brand-purple via-brand-yellow to-brand-orange" />
            
            <div className="relative z-10 flex h-full w-full flex-col p-4 sm:p-8">
               {question?.image_url ? (
                  <>
                    <div className="absolute inset-0 z-0">
                      <img
                        src={question.image_url}
                        alt={question?.prompt || 'Question image'}
                        className="h-full w-full object-cover"
                        onClick={() => {
                          recordTelemetryEvent('media_opened', {
                            payload: {
                              media_type: 'image',
                            },
                          });
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/90 via-brand-dark/28 to-transparent" />
                    </div>
                    <div className="relative z-10 flex h-full w-full items-center justify-center">
                      <div className="w-full max-w-5xl rounded-[1.5rem] border-4 border-white/20 bg-brand-dark/52 p-4 text-center text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-md sm:rounded-[2.6rem] sm:p-8">
                        <div
                          onScroll={handlePromptReread}
                          className={`mx-auto ${questionPromptScrollerClass} overflow-y-auto px-1 custom-scrollbar`}
                        >
                          <h2 className={`${studentPromptClassName} font-black leading-[1.1] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] text-balance`}>
                            {question?.prompt}
                          </h2>
                        </div>
                      </div>
                    </div>
                  </>
               ) : (
                  <div className="flex-1 flex flex-col justify-center text-center">
                     <div
                       onScroll={handlePromptReread}
                       className={`mx-auto max-w-[35ch] ${questionPromptScrollerClass} overflow-y-auto px-1 custom-scrollbar`}
                     >
                       <h2 className={`${studentPromptClassName} font-black leading-[1.1] tracking-tight text-brand-dark text-balance`}>
                          {question?.prompt}
                       </h2>
                     </div>
                  </div>
               )}
            </div>
          </motion.div>

          {/* Answer Interaction Area */}
          <section ref={answerBoardRef} className={`relative z-10 flex min-h-0 ${answerBoardFlexClass} flex-col overflow-hidden rounded-[2rem] border-4 border-brand-dark bg-white shadow-[7px_7px_0px_0px_#1A1A1A] sm:rounded-[2.8rem] sm:shadow-[12px_12px_0px_0px_#1A1A1A]`}>
            
            {/* Answer Grid Container - Added bottom padding to avoid overlap with floating bar */}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pb-36 sm:p-6 sm:pb-32 lg:p-8 lg:pb-12 custom-scrollbar">
               <div className={`grid min-h-full ${answerGridColumnsClass} ${answerGridRowsClass} gap-3 sm:gap-6`}>
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
                        onMouseEnter={() => beginHoverDwell(i)}
                        onFocus={() => beginHoverDwell(i)}
                        onMouseLeave={() => flushHoverDwell()}
                        onBlur={() => flushHoverDwell()}
                        style={buildAnswerToneStyle(i, isSelected)}
                        data-locked={isSelectionLocked && !isSelected ? 'true' : 'false'}
                        className={`
                          student-answer-button student-play-answer-tile group relative flex ${studentAnswerMinHeightClass} items-center px-4 py-3 text-left sm:px-8 sm:py-4
                          ${isSelected ? 'student-play-answer-tile--selected' : ''}
                          ${isSelectionLocked && !isSelected ? 'opacity-30 grayscale-[0.8]' : ''}
                        `}
                      >
                        <div className={`mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 text-base font-black transition-colors sm:mr-5 sm:h-10 sm:w-10 sm:rounded-xl sm:text-lg ${
                          isSelected ? 'border-white/20 bg-white/10' : 'border-brand-dark/10 bg-white/40 text-brand-dark/30'
                        }`}>
                          {formatAnswerSlotLabel(i)}
                        </div>
                        <span className={`block flex-1 break-words font-black leading-tight ${studentAnswerTextClass}`}>
                          {ans}
                        </span>
                        
                        {isSelected && !hasAnswered && (
                          <div className="absolute right-3 top-2 flex h-5 items-center gap-1 rounded-full bg-brand-orange px-2 text-[9px] font-black uppercase tracking-[0.15em] text-white shadow-lg sm:right-4 sm:h-6 sm:gap-1.5 sm:px-3 sm:text-[10px] sm:tracking-widest">
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
          </section>

          <AnimatePresence>
            {(currentSelectedAnswer !== null || hasAnswered) && (
              <motion.div
                initial={{ y: 28, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 28, opacity: 0 }}
                className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex justify-center px-3 sm:bottom-6 sm:px-4"
              >
                <div className="pointer-events-auto">
                  {shouldShowAnswerSummary && !hasAnswered && (
                    <StudentPlaySubmitButton
                      label={lockLabel}
                      onClick={handleLockIn}
                    />
                  )}
                  {hasAnswered && (
                    <div className="student-play-submit-state">
                      <CheckCircle2 className="h-5 w-5" />
                      <span>Submitted</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
             <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A] sm:px-4 sm:text-xs sm:tracking-widest">
                   {t('game.status.reveal')}
                </div>
             </div>
             
             <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
               <div className="flex h-10 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:px-4">
                 <Trophy className="h-5 w-5 fill-current text-brand-yellow" />
                 <span className="font-black text-base sm:text-lg">{score}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Reveal Content Viewport - Optimized for 100vh */}
        <div className="relative mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col items-center justify-center overflow-hidden px-2 py-3 sm:p-5 lg:p-6">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 max-h-[calc(100vh-8.75rem)] w-full overflow-x-hidden overflow-y-auto rounded-[2rem] border-4 border-brand-dark bg-white p-3 text-center shadow-[6px_6px_0px_0px_#1A1A1A] sm:max-h-[calc(100vh-9.5rem)] sm:p-5"
           >
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.15rem] border-4 border-brand-dark bg-brand-bg shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-16 sm:w-16">
                 {answeredCorrectly ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }}>
                       <CheckCircle className="h-7 w-7 text-emerald-500 sm:h-8 sm:w-8" />
                    </motion.div>
                 ) : (
                    <motion.div animate={{ rotate: [0, -10, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                       <Flame className="h-7 w-7 text-brand-orange sm:h-8 sm:w-8" />
                    </motion.div>
                 )}
              </div>

              <h2 className="mb-2 text-xl font-black tracking-tighter text-brand-dark sm:text-3xl">
                 {answeredCorrectly ? t('game.feedback.correct') : chosenAnswer ? t('game.feedback.incorrect') : t('game.feedback.timesUp')}
              </h2>
              
              <p className="mx-auto max-w-[30ch] text-sm font-bold leading-tight text-brand-dark/50 sm:text-base">
                 {answeredCorrectly ? 'Dynamic performance! You’re crushing this.' : 'A learning moment! Swipe through the details below.'}
              </p>

              <div className="mt-5 grid min-w-0 gap-3 text-left sm:grid-cols-2">
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

              <div className="mt-3 grid w-full min-w-0 grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:justify-center">
                 <PlayerMetricCard label="Score" value={score} tone="dark" />
                 {lastScoreAwarded > 0 && <PlayerMetricCard label="This Round" value={`+${lastScoreAwarded}`} tone="warm" />}
                 <PlayerMetricCard label="Streak" value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
              </div>

              {question?.image_url && (
                 <div className="mt-4">
                    <QuestionImageCard
                      imageUrl={question.image_url}
                      alt={question?.prompt || 'Question image'}
                      className="mx-auto h-[150px] w-full max-w-lg sm:h-[180px]"
                      imgClassName="h-full w-full bg-white"
                    />
                 </div>
              )}

              {question?.explanation && (
                 <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-4 rounded-[1.5rem] border-4 border-brand-dark border-dashed bg-brand-bg/40 p-3 text-left"
                 >
                    <div className="mb-2 flex items-center gap-2">
                       <Sparkles className="h-3 w-3 text-brand-purple" />
                       <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-purple">The "Why" Factor</p>
                    </div>
                    <p className="text-xs font-bold italic leading-tight text-brand-dark/80 sm:text-sm">
                       "{question.explanation}"
                    </p>
                 </motion.div>
              )}

              <div className="mt-5 flex items-center justify-center gap-2.5">
                 <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-purple" />
                 <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-yellow [animation-delay:0.2s]" />
                 <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-orange [animation-delay:0.4s]" />
                 <span className="ml-1 text-[8px] font-black uppercase tracking-[0.15em] text-brand-dark/30">Host Synced</span>
              </div>
           </motion.div>
        </div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    const leaderboardHeading = gameMode.id === 'accuracy_quiz' ? 'Accuracy Standings' : 'Standings';
    const leaderboardBody = gameMode.id === 'accuracy_quiz'
      ? 'Correct answers matter most in this room. Watch the main stage for the latest order.'
      : 'Eye on the prize! Watch the main stage.';
    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Leaderboard Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
             <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A] sm:px-4 sm:text-xs sm:tracking-widest">
                   {t('game.leaderboard.title')}
                </div>
             </div>
             
             <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
               <div className="flex h-10 max-w-[60vw] items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:max-w-none sm:gap-3 sm:px-4">
                 <Avatar
                   nickname={String(nickname || '')}
                   imgClassName="h-6 w-6 rounded-lg sm:h-7 sm:w-7 sm:rounded-xl"
                 />
                 <span className="truncate font-black text-xs uppercase tracking-tight sm:text-sm">{displayNickname}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Centered Leaderboard Content - Optimized for 100vh */}
        <div className="relative mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col items-center justify-center overflow-hidden px-3 py-4 sm:p-6 lg:p-8">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2rem] border-4 border-brand-dark bg-white p-4 text-center shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2.5rem] sm:p-7"
           >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.5rem] border-4 border-brand-dark bg-brand-yellow shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-20 sm:w-20 text-brand-dark">
                 <Trophy className="h-8 w-8 sm:h-10 sm:w-10" />
              </div>

              <h2 className="mb-2 text-3xl font-black tracking-tighter text-brand-dark sm:text-5xl">{leaderboardHeading}</h2>
              <p className="mb-4 text-sm font-bold leading-tight text-brand-dark/40 sm:text-base">{leaderboardBody}</p>

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
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
             <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="rounded-2xl border-2 border-brand-dark bg-brand-bg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A] sm:px-4 sm:text-xs sm:tracking-widest">
                   {t('game.status.ended')}
                </div>
             </div>
             
             <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
               <div className="flex h-10 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-11 sm:px-4">
                 <Trophy className="h-5 w-5 fill-current text-brand-yellow" />
                 <span className="font-black text-base sm:text-lg">{score}</span>
               </div>
             </div>
          </div>
        </div>

        {/* Centered Ended Content */}
        <div className="relative mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-3 py-4 sm:p-8 lg:p-12">
           <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 w-full rounded-[2.2rem] border-4 border-brand-dark bg-white p-5 text-center shadow-[8px_8px_0px_0px_#1A1A1A] sm:rounded-[3.5rem] sm:p-12 sm:shadow-[16px_16px_0px_0px_#1A1A1A]"
           >
              <div className="mx-auto mb-7 flex h-24 w-24 items-center justify-center rounded-[1.8rem] border-4 border-brand-dark bg-brand-yellow shadow-[6px_6px_0px_0px_#1A1A1A] sm:mb-10 sm:h-36 sm:w-36 sm:rounded-[2.5rem] sm:shadow-[8px_8px_0px_0px_#1A1A1A]">
                 <Sparkles className="h-16 w-16 text-brand-dark" />
              </div>

              <h2 className="mb-3 text-3xl font-black tracking-tighter text-brand-dark sm:text-7xl">{t('game.ended.title')}</h2>
              <p className="mb-7 text-base font-bold leading-relaxed text-brand-dark/40 sm:mb-10 sm:text-3xl">{t('game.ended.body')}</p>

              <div className="mb-8 grid grid-cols-2 gap-3 sm:mb-12 sm:gap-6">
                <PlayerMetricCard label="Final Rank" value={score > 1000 ? "#4" : "#12"} tone="dark" />
                <PlayerMetricCard label="Final Streak" value={streak} tone={streak >= 2 ? 'warm' : 'light'} />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-5">
                 <motion.button
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => navigate(primaryExitPath)}
                   className="game-action-button game-action-button--primary px-6 py-4 text-base sm:px-10 sm:py-5 sm:text-lg"
                 >
                   {t('game.ended.primary')}
                 </motion.button>
                 <motion.button
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => navigate(leaveSessionPath)}
                   className="game-action-button game-action-button--secondary px-6 py-4 text-base sm:px-10 sm:py-5 sm:text-lg"
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
      onExit={() => navigate(primaryExitPath)}
      exitLabel={linkedStudentHomePath ? 'Back to student space' : 'Back home'}
    />
  );
}


function LobbyMetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] sm:rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-3 sm:p-4 text-left shadow-[4px_4px_0px_0px_#1A1A1A] sm:shadow-none">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-1 sm:mb-2">{label}</p>
      <p className="text-lg sm:text-xl font-black capitalize break-words leading-tight">{String(value || '').replace(/_/g, ' ')}</p>
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
            className="game-action-button game-action-button--secondary px-4 py-2 text-xs uppercase tracking-[0.2em]"
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
    <div className={`min-w-0 overflow-hidden rounded-2xl border-4 p-3 sm:p-4 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{label}</p>
      <p className="min-w-0 break-words text-base font-black leading-tight text-brand-dark sm:text-xl">
        {value}
      </p>
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
    <div className={`min-w-0 rounded-2xl border-4 border-brand-dark p-3 sm:p-4 ${toneClass}`}>
      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="min-w-0 break-words text-lg font-black leading-tight sm:text-2xl">{value}</p>
    </div>
  );
}

function StudentShellFallback({
  title,
  body,
  loading = false,
  onRetry,
  onExit,
  exitLabel = 'Exit room',
}: {
  title: string;
  body: string;
  loading?: boolean;
  onRetry?: () => void;
  onExit?: () => void;
  exitLabel?: string;
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
                className="game-action-button game-action-button--dark px-6 py-4"
              >
                {t('dash.action.tryAgain')}
              </button>
            )}
            {onExit && (
              <button
                onClick={onExit}
                className="game-action-button game-action-button--secondary px-6 py-4"
              >
                {exitLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
