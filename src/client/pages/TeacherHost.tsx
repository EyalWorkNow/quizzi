import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Users, Play, CheckCircle, XCircle, BarChart3, ChevronRight, Sparkles, Clock, AlertTriangle, Copy, Check, BookOpen, Rocket, Link2, Trophy, Medal, Crown, Award, ArrowLeft, Lightbulb, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { QRCodeSVG } from 'qrcode.react';
import Avatar, { extractNickname } from '../components/Avatar.tsx';
import QuestionImageCard from '../components/QuestionImageCard.tsx';
import SessionSoundtrackPlayer from '../components/SessionSoundtrackPlayer.tsx';
import {
  subscribeToHostedSessionRealtime,
  syncHostedParticipants,
  writeHostedSessionMeta,
} from '../lib/firebaseRealtime.ts';
import { getGameMode } from '../lib/gameModes.ts';
import { getGameModeTone } from '../lib/gameModePresentation.ts';
import { buildSessionJoinUrl } from '../lib/joinCodes.ts';
import { isPeerInstructionMode, resolveSessionQuestionTimeLimit } from '../lib/sessionModeRules.ts';
import { apiFetch, apiFetchJson, apiEventSource } from '../lib/api.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';

const HOST_STATUS_ALIASES: Record<string, string> = {
  QUESTION_RESULT: 'QUESTION_REVEAL',
  QUESTION_RESULTS: 'QUESTION_REVEAL',
  RESULT: 'QUESTION_REVEAL',
  RESULTS: 'QUESTION_REVEAL',
  SCOREBOARD: 'LEADERBOARD',
  FINAL_RESULTS: 'LEADERBOARD',
  COMPLETE: 'ENDED',
  COMPLETED: 'ENDED',
  CLOSED: 'ENDED',
};

function normalizeHostStatus(value: unknown) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'LOBBY';
  return HOST_STATUS_ALIASES[raw] || raw;
}

function formatAnswerSlotLabel(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

function buildLiveHostInsights({
  status,
  participants,
  totalAnswers,
  voteCount,
  phaseTimeLeft,
  activeQuestionSeconds,
  isPeerMode,
  currentQuestion,
  answerSelectionSummary,
}: {
  status: string;
  participants: number;
  totalAnswers: number;
  voteCount: number;
  phaseTimeLeft: number;
  activeQuestionSeconds: number;
  isPeerMode: boolean;
  currentQuestion: any;
  answerSelectionSummary: Array<{ index: number; count: number; pct: number }>;
}) {
  const answeredCount =
    status === 'QUESTION_DISCUSSION' || (status === 'QUESTION_ACTIVE' && isPeerMode)
      ? voteCount
      : totalAnswers;
  const participationPct = participants > 0 ? Math.round((answeredCount / participants) * 100) : 0;
  const sortedSelections = [...answerSelectionSummary].sort((left, right) => right.count - left.count);
  const leader = sortedSelections[0] || null;
  const runnerUp = sortedSelections[1] || null;
  const secondsThreshold = Math.max(6, Math.ceil(activeQuestionSeconds * 0.35));
  const cues: Array<{ tone: 'warning' | 'insight' | 'success'; title: string; body: string }> = [];

  if (!participants) {
    cues.push({
      tone: 'insight',
      title: 'Room not ready yet',
      body: 'No students are connected right now, so keep the PIN visible until the room fills.',
    });
  } else if (participationPct < 55 && phaseTimeLeft <= secondsThreshold) {
    cues.push({
      tone: 'warning',
      title: 'Hesitation detected',
      body: 'Many students still have not committed. Add a hint, extend the timer, or slow the pace before you reveal.',
    });
  }

  if (leader && runnerUp && leader.count > 0 && runnerUp.count > 0 && leader.pct - runnerUp.pct <= 12) {
    cues.push({
      tone: 'insight',
      title: 'Split room',
      body: `The room is split between ${formatAnswerSlotLabel(leader.index)} and ${formatAnswerSlotLabel(runnerUp.index)}. Invite both sides to justify before the reveal.`,
    });
  }

  if (
    currentQuestion &&
    leader &&
    leader.count > 0 &&
    leader.index !== Number(currentQuestion.correct_index) &&
    leader.pct >= 45
  ) {
    cues.push({
      tone: 'warning',
      title: 'Misconception cluster',
      body: `Most students are leaning toward ${formatAnswerSlotLabel(leader.index)}, which is not correct. Pause and probe the reasoning before moving on.`,
    });
  }

  if (participants > 0 && participationPct >= 85 && phaseTimeLeft <= Math.max(3, Math.ceil(activeQuestionSeconds * 0.15))) {
    cues.push({
      tone: 'success',
      title: 'Ready to move',
      body: 'The room has mostly committed. You can reveal soon without losing much participation.',
    });
  }

  if (cues.length === 0) {
    cues.push({
      tone: 'insight',
      title: status === 'QUESTION_DISCUSSION' ? 'Discussion in motion' : 'Healthy momentum',
      body:
        status === 'QUESTION_DISCUSSION'
          ? 'Pods are comparing reasoning right now. Listen for one strong argument from each side before opening the revote.'
          : 'The room is moving at a stable pace. Let the strongest pattern emerge before the next transition.',
    });
  }

  return {
    answeredCount,
    participationPct,
    leader,
    runnerUp,
    primaryCue: cues[0],
    secondaryCue: cues[1] || null,
  };
}

export default function TeacherHost() {
  const { pin } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useAppLanguage();
  const [sessionId, setSessionId] = useState(location.state?.sessionId);
  const [packId, setPackId] = useState(location.state?.packId);
  const [sessionMeta, setSessionMeta] = useState<any>(null);

  const [status, setStatus] = useState('LOBBY');
  const [participants, setParticipants] = useState<any[]>([]);
  const [totalAnswers, setTotalAnswers] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [pack, setPack] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [teamBoard, setTeamBoard] = useState<any[]>([]);
  const [studentSelections, setStudentSelections] = useState<Record<number, number>>({});
  const [focusAlerts, setFocusAlerts] = useState<Set<string>>(new Set());
  const [isPinCopied, setIsPinCopied] = useState(false);
  const [isJoinLinkCopied, setIsJoinLinkCopied] = useState(false);
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
  const [hostMessage, setHostMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [isCreatingPersonalizedGames, setIsCreatingPersonalizedGames] = useState(false);
  const [personalizedGamesSummary, setPersonalizedGamesSummary] = useState<null | {
    createdCount: number;
    reusedCount: number;
    failedCount: number;
    createdPacks: any[];
    failedStudents: any[];
  }>(null);
  const [questionReplay, setQuestionReplay] = useState<any>(null);
  const [isQuestionReplayLoading, setIsQuestionReplayLoading] = useState(false);
  const [questionReplayError, setQuestionReplayError] = useState('');
  const [isLaunchingQuestionRematch, setIsLaunchingQuestionRematch] = useState(false);
  const [pendingStateKey, setPendingStateKey] = useState('');
  const participantCountRef = useRef(0);
  const questionIndexRef = useRef(0);
  const statusRef = useRef(status);
  const focusAlertTimeoutsRef = useRef<Record<string, number>>({});
  const pendingStateKeyRef = useRef('');
  const gameTypeRef = useRef('classic_quiz');
  const modeConfigRef = useRef<Record<string, unknown>>({});
  const autoAdvanceKeyRef = useRef('');
  const peerVoteAdvanceKeyRef = useRef('');
  const lastStateChangeAtRef = useRef(Date.now());
  const lastPhaseKeyRef = useRef(`${status}:${questionIndex}`);
  const hasInitializedPhaseRef = useRef(false);

  // Transition tracking moved fully to Effects

  const gameMode = getGameMode(sessionMeta?.game_type);
  const gameTone = getGameModeTone(gameMode.id);
  const isTeamMode = gameMode.teamBased;
  const modeConfig = sessionMeta?.mode_config || sessionMeta?.modeConfig || {};
  const isPeerMode = isPeerInstructionMode(sessionMeta?.game_type, modeConfig);
  const discussionSeconds = Math.max(10, Number(modeConfig?.discussion_seconds || 30));
  const revoteSeconds = Math.max(8, Number(modeConfig?.revote_seconds || 22));
  const joinUrl = pin && typeof window !== 'undefined' ? buildSessionJoinUrl(pin, window.location.origin) : '';
  const groupedParticipants = participants.reduce((groups: Record<string, any[]>, participant: any) => {
    const key = participant.team_name || 'Solo';
    groups[key] = groups[key] || [];
    groups[key].push(participant);
    return groups;
  }, {});
  const currentQuestion = pack?.questions?.[questionIndex];
  const currentAnswers = React.useMemo(() => {
    if (!currentQuestion) return [];
    try {
      if (Array.isArray(currentQuestion.answers)) return currentQuestion.answers;
      if (typeof currentQuestion.answers_json === 'string') {
        return JSON.parse(currentQuestion.answers_json || '[]');
      }
      return [];
    } catch (err) {
      console.error('[TeacherHost] Failed to parse answers_json:', err, currentQuestion);
      return [];
    }
  }, [currentQuestion]);

  const activeQuestionSeconds = currentQuestion
    ? resolveSessionQuestionTimeLimit(currentQuestion, modeConfig)
    : 20;
  const packQuestionCount = pack?.questions?.length || 0;
  const recentParticipants = participants.slice(-4).reverse();
  const roomReadTitle =
    participants.length === 0
      ? 'Waiting for the first student.'
      : participants.length < 4
        ? 'The room is filling up.'
        : 'The room looks ready.';
  const roomReadBody =
    participants.length === 0
      ? 'Keep the PIN visible. New names will appear here automatically as soon as students join.'
      : participants.length < 4
        ? 'A few students are already here. Give the room another moment if you expect more names to arrive.'
        : 'You have enough students in the room to launch cleanly once the roster stops changing.';
  const responseCountLabel =
    status === 'QUESTION_ACTIVE' && isPeerMode
      ? `${Object.keys(studentSelections).length} / ${participants.length} Votes`
      : `${totalAnswers} / ${participants.length} Answers`;
  const answerSelectionSummary = currentAnswers.map((_, index) => {
    const count = Object.values(studentSelections).filter((value) => Number(value) === index).length;
    return {
      index,
      count,
      pct: participants.length > 0 ? Math.round((count / participants.length) * 100) : 0,
    };
  });
  const correctSelectionCount =
    currentQuestion && Number.isFinite(Number(currentQuestion.correct_index))
      ? Number(answerSelectionSummary[Number(currentQuestion.correct_index)]?.count || 0)
      : 0;
  const liveHostInsights = React.useMemo(
    () =>
      buildLiveHostInsights({
        status,
        participants: participants.length,
        totalAnswers,
        voteCount: Object.keys(studentSelections).length,
        phaseTimeLeft,
        activeQuestionSeconds,
        isPeerMode,
        currentQuestion,
        answerSelectionSummary,
      }),
    [activeQuestionSeconds, answerSelectionSummary, currentQuestion, isPeerMode, participants.length, phaseTimeLeft, status, studentSelections, totalAnswers],
  );
  const phaseTransitionPending = Boolean(pendingStateKey);

  useEffect(() => {
    participantCountRef.current = participants.length;
  }, [participants.length]);

  useEffect(() => {
    questionIndexRef.current = questionIndex;
  }, [questionIndex]);

  useEffect(() => {
    statusRef.current = normalizeHostStatus(status);
  }, [status]);

  useEffect(() => {
    gameTypeRef.current = String(sessionMeta?.game_type || 'classic_quiz');
    modeConfigRef.current = modeConfig;
  }, [modeConfig, sessionMeta?.game_type]);

  useEffect(() => {
    if (!hostMessage) return;
    const timeoutId = window.setTimeout(() => setHostMessage(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [hostMessage]);

  useEffect(() => {
    if (status !== 'ENDED' || !sessionId) return;
    const timeoutId = window.setTimeout(() => {
      navigate(`/teacher/analytics/class/${sessionId}`);
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [navigate, sessionId, status]);

  useEffect(() => {
    // Force targetTime calculation to be stable
    let targetSeconds = 0;
    if (status === 'QUESTION_ACTIVE') {
      targetSeconds = activeQuestionSeconds;
    } else if (status === 'QUESTION_DISCUSSION') {
      targetSeconds = discussionSeconds;
    } else if (status === 'QUESTION_REVOTE') {
      targetSeconds = revoteSeconds;
    }

    if (targetSeconds > 0) {
      setPhaseTimeLeft(targetSeconds);
      lastStateChangeAtRef.current = Date.now();
      lastPhaseKeyRef.current = `${status}:${questionIndex}`;
      hasInitializedPhaseRef.current = true;
      autoAdvanceKeyRef.current = '';
      peerVoteAdvanceKeyRef.current = '';
    } else {
      setPhaseTimeLeft(0);
      hasInitializedPhaseRef.current = false;
    }
  }, [activeQuestionSeconds, discussionSeconds, questionIndex, revoteSeconds, status]);

  useEffect(() => {
    if (!['QUESTION_ACTIVE', 'QUESTION_DISCUSSION', 'QUESTION_REVOTE'].includes(status) || phaseTimeLeft <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPhaseTimeLeft((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [phaseTimeLeft, status]);

  useEffect(() => {
    if (!pin) return;
    apiFetchJson(`/api/teacher/sessions/pin/${pin}`)
      .then(data => {
        setSessionMeta(data);
        setSessionId(data.id);
        setPackId(data.quiz_pack_id);
        setStatus(normalizeHostStatus(data.status));
        setQuestionIndex(data.current_question_index);
      })
      .catch((err: any) => {
        console.error('[TeacherHost] Failed to fetch session metadata:', err);
        if (err.message?.includes('401')) {
          navigate('/auth', { state: { error: 'Your teacher session has expired. Please sign in again.' } });
          return;
        }
        if (err.message?.includes('404')) {
          navigate('/teacher/dashboard', { state: { error: 'Session not found or expired.' } });
          return;
        }
      });
  }, [pin, navigate]);

  useEffect(() => {
    if (!pin || !sessionId) return;
    apiFetchJson(`/api/teacher/sessions/pin/${pin}/participants`)
      .then((data) => {
        const nextParticipants = data.participants || [];
        setParticipants(nextParticipants);
        void syncHostedParticipants(
          pin,
          nextParticipants.map((participant: any) => ({
            participantId: Number(participant.id || participant.participantId || 0),
            nickname: participant.nickname || '',
            teamId: Number(participant.team_id || participant.teamId || 0),
            teamName: participant.team_name || participant.teamName || null,
            seatIndex: Number(participant.seat_index || participant.seatIndex || 0),
            createdAt: participant.created_at || participant.createdAt || null,
            online: true,
          })),
        );
      })
      .catch(err => {
        console.error('[TeacherHost] Failed to fetch participants:', err);
      });
  }, [pin, sessionId]);

  const loadLeaderboard = () => {
    if (!sessionId) return;
    apiFetchJson(`/api/analytics/class/${sessionId}`)
      .then((analytics) => {
        setLeaderboard(analytics.participants || []);
        setTeamBoard(analytics.teams || []);
      })
      .catch(() => {});
  };

  const queueFocusAlert = (nickname?: string) => {
    if (!nickname) return;

    const existingTimeout = focusAlertTimeoutsRef.current[nickname];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    setFocusAlerts((prev) => {
      const next = new Set(prev);
      next.add(nickname);
      return next;
    });

    focusAlertTimeoutsRef.current[nickname] = window.setTimeout(() => {
      setFocusAlerts((prev) => {
        const next = new Set(prev);
        next.delete(nickname);
        return next;
      });
      delete focusAlertTimeoutsRef.current[nickname];
    }, 5000);
  };

  const handleParticipantJoined = (data: any) => {
    setParticipants((prev) =>
      prev.some((participant) => Number(participant.id) === Number(data.participant_id) || participant.nickname === data.nickname)
        ? prev
        : [
            ...prev,
            {
              id: data.participant_id,
              nickname: data.nickname,
              team_id: data.team_id,
              team_name: data.team_name,
              seat_index: data.seat_index,
              online: true,
            },
          ],
    );
  };

  const handleLiveStateChange = (data: any) => {
    const nextStatus = normalizeHostStatus(data?.status || sessionMeta?.status || 'LOBBY');
    const nextQuestionIndex = Number(data?.current_question_index ?? data?.currentQuestionIndex ?? 0);
    const nextGameType = data?.game_type || data?.gameType;
    const nextTeamCount = data?.team_count ?? data?.teamCount;
    const nextModeConfig = data?.mode_config || data?.modeConfig;

    const nextStateStartedAt = data?.state_started_at;

    setStatus(nextStatus);
    setQuestionIndex(nextQuestionIndex);
    
    if (nextStateStartedAt) {
      lastStateChangeAtRef.current = nextStateStartedAt;
      lastPhaseKeyRef.current = `${nextStatus}:${nextQuestionIndex}`;
    }
    setSessionMeta((current: any) => {
      if (!current) return current;
      const resolved = {
        ...current,
        status: nextStatus,
        current_question_index: nextQuestionIndex,
        game_type: nextGameType || current.game_type,
        team_count: nextTeamCount ?? current.team_count,
        mode_config: nextModeConfig || current.mode_config || current.modeConfig || {},
      };
      if (
        current.status === resolved.status &&
        Number(current.current_question_index || 0) === Number(resolved.current_question_index || 0) &&
        current.game_type === resolved.game_type &&
        Number(current.team_count || 0) === Number(resolved.team_count || 0) &&
        JSON.stringify(current.mode_config || current.modeConfig || {}) === JSON.stringify(resolved.mode_config || {})
      ) {
        return current;
      }
      return {
        ...resolved,
      };
    });

    if (nextStatus === 'QUESTION_ACTIVE' || nextStatus === 'QUESTION_REVOTE' || nextStatus === 'LOBBY') {
      setTotalAnswers(0);
      setStudentSelections({});
      setFocusAlerts(new Set());
    } else if (nextStatus === 'LEADERBOARD' && statusRef.current !== 'LEADERBOARD') {
      loadLeaderboard();
    }
  };

  const buildRealtimeQuestionPayload = (nextStatus: string, index: number) => {
    const question = pack?.questions?.[index];
    if (
      !question ||
      (
        nextStatus !== 'QUESTION_ACTIVE' &&
        nextStatus !== 'QUESTION_DISCUSSION' &&
        nextStatus !== 'QUESTION_REVOTE' &&
        nextStatus !== 'QUESTION_REVEAL'
      )
    ) {
      return null;
    }

    const answers =
      Array.isArray(question.answers) ? question.answers : JSON.parse(question.answers_json || '[]');
    const timeLimitSeconds =
      nextStatus === 'QUESTION_DISCUSSION'
        ? discussionSeconds
        : nextStatus === 'QUESTION_REVOTE'
          ? revoteSeconds
          : resolveSessionQuestionTimeLimit(question, modeConfig);
    const payload = {
      id: question.id,
      prompt: question.prompt,
      answers,
      time_limit_seconds: timeLimitSeconds,
    } as Record<string, unknown>;

    if (nextStatus === 'QUESTION_REVEAL') {
      payload.correct_index = question.correct_index;
      payload.explanation = question.explanation;
    }

    return payload;
  };

  const buildHostedStatePayload = (nextStatus: string, index: number, questionPayload?: Record<string, unknown> | null) => ({
    status: nextStatus,
    current_question_index: index,
    state_started_at: Date.now(),
    question: questionPayload === undefined ? buildRealtimeQuestionPayload(nextStatus, index) : questionPayload,
    game_type: sessionMeta?.game_type || gameTypeRef.current || 'classic_quiz',
    team_count: Number(sessionMeta?.team_count || 0),
    mode_config: sessionMeta?.mode_config || sessionMeta?.modeConfig || modeConfigRef.current || {},
  });

  useEffect(() => {
    if (packId) {
      apiFetchJson(`/api/teacher/packs/${packId}`)
        .then(data => setPack(data))
        .catch((err: any) => {
          console.error('[TeacherHost] Failed to fetch pack data:', err);
          if (err.message?.includes('401')) {
            navigate('/auth', { state: { error: 'Authentication required to view this pack.' } });
            return;
          }
          if (err.message?.includes('404')) {
            navigate('/teacher/dashboard', { state: { error: 'This pack is no longer available.' } });
          }
        });
    }
  }, [packId, navigate]);

  useEffect(() => {
    if (!pin || !sessionId) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let realtimeCleanup: (() => void) | null = null;

    const startEventSource = () => {
      if (cancelled || eventSource) return;

      eventSource = apiEventSource(`/api/sessions/${pin}/stream`);

      eventSource.addEventListener('PARTICIPANT_JOINED', (event) => {
        const data = JSON.parse(event.data);
        handleParticipantJoined(data);
      });

      eventSource.addEventListener('STATE_CHANGE', (event) => {
        handleLiveStateChange(JSON.parse(event.data));
      });

      eventSource.addEventListener('SELECTION_CHANGE', (event) => {
        const data = JSON.parse(event.data);
        setStudentSelections((prev) => ({
          ...prev,
          [data.participant_id]: data.chosen_index,
        }));
      });

      eventSource.addEventListener('FOCUS_LOST', (event) => {
        const data = JSON.parse(event.data);
        queueFocusAlert(data.nickname);
      });

      eventSource.addEventListener('ANSWER_RECEIVED', (event) => {
        const data = JSON.parse(event.data);
        setTotalAnswers(data.total_answers);
        const peerMode = isPeerInstructionMode(gameTypeRef.current, modeConfigRef.current);
        const shouldReveal =
          data.total_answers >= participantCountRef.current &&
          participantCountRef.current > 0 &&
          (
            statusRef.current === 'QUESTION_REVOTE' ||
            (statusRef.current === 'QUESTION_ACTIVE' && !peerMode)
          );
        if (shouldReveal) {
          void updateState('QUESTION_REVEAL', questionIndexRef.current);
        }
      });
    };

    void subscribeToHostedSessionRealtime(pin, {
      onMeta: (meta) => {
        if (!meta) return;
        handleLiveStateChange(meta);
      },
      onParticipants: (realtimeParticipants) => {
        if (!realtimeParticipants.length) return;
        setParticipants(
          realtimeParticipants.map((participant) => ({
            id: participant.participantId,
            nickname: participant.nickname,
            team_id: participant.teamId,
            team_name: participant.teamName,
            seat_index: participant.seatIndex,
            created_at: participant.createdAt,
            online: participant.online,
          })),
        );
      },
      onSelections: (selections) => {
        setStudentSelections(selections);
      },
      onFocusAlerts: (alerts) => {
        alerts.forEach((alert) => queueFocusAlert(alert.nickname));
      },
      onAnswerProgress: ({ totalAnswers: nextTotalAnswers }) => {
        setTotalAnswers(nextTotalAnswers);
        const peerMode = isPeerInstructionMode(gameTypeRef.current, modeConfigRef.current);
        const shouldReveal =
          nextTotalAnswers >= participantCountRef.current &&
          participantCountRef.current > 0 &&
          (
            statusRef.current === 'QUESTION_REVOTE' ||
            (statusRef.current === 'QUESTION_ACTIVE' && !peerMode)
          );
        if (shouldReveal) {
          void updateState('QUESTION_REVEAL', questionIndexRef.current);
        }
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
      eventSource?.close();
      (Object.values(focusAlertTimeoutsRef.current) as number[]).forEach((timeoutId) => window.clearTimeout(timeoutId));
      focusAlertTimeoutsRef.current = {};
    };
  }, [pin, sessionId]);

  useEffect(() => {
    if (status !== 'LEADERBOARD') return;
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { y: 0.1 },
      colors: ['#4f46e5', '#9333ea', '#eab308', '#10b981'],
    });
  }, [status]);

  useEffect(() => {
    if (!pin || !sessionId || !sessionMeta) return;

    void writeHostedSessionMeta(pin, {
      sessionId: Number(sessionId),
      quizPackId: Number(packId || sessionMeta?.quiz_pack_id || 0),
      packTitle: pack?.title || sessionMeta?.pack_title || '',
      gameType: sessionMeta?.game_type || 'classic_quiz',
      teamCount: Number(sessionMeta?.team_count || 0),
      modeConfig,
      status: normalizeHostStatus(sessionMeta?.status || status),
      currentQuestionIndex: Number(sessionMeta?.current_question_index ?? questionIndex),
      question: buildRealtimeQuestionPayload(
        normalizeHostStatus(sessionMeta?.status || status),
        Number(sessionMeta?.current_question_index ?? questionIndex),
      ),
      expectedParticipants: participantCountRef.current,
    });
  }, [modeConfig, pin, sessionId, packId, pack, sessionMeta, questionIndex, status]);

  const updateState = async (newStatus: string, index: number) => {
    const normalizedSessionId = Number(sessionId || 0);
    if (!normalizedSessionId) {
      setHostMessage({ tone: 'error', text: 'The live session is not ready yet. Refresh the room and try again.' });
      return false;
    }

    const requestKey = `${normalizedSessionId}:${newStatus}:${index}`;
    if (pendingStateKeyRef.current === requestKey) {
      return false;
    }

    pendingStateKeyRef.current = requestKey;
    setPendingStateKey(requestKey);
    setHostMessage({ tone: 'info', text: `Updating room to ${newStatus.replace(/_/g, ' ').toLowerCase()}...` });

    try {
      const response = await apiFetch(`/api/sessions/${normalizedSessionId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, current_question_index: index })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to update session state');
      }

      const nextStatePayload = payload?.state || buildHostedStatePayload(newStatus, index);
      handleLiveStateChange(nextStatePayload);
      setHostMessage(null);
      return true;
    } catch (error: any) {
      console.error('[TeacherHost] Failed to update session state:', error);
      setHostMessage({
        tone: 'error',
        text: error?.message || 'Could not move the game to the next phase. Try again.',
      });
      return false;
    } finally {
      if (pendingStateKeyRef.current === requestKey) {
        pendingStateKeyRef.current = '';
      }
      setPendingStateKey((current) => (current === requestKey ? '' : current));
    }
  };

  const handleEndSession = async () => {
    if (window.confirm('Are you sure you want to end the game early? This will close the room for students and jump to analytics.')) {
      const ended = await updateState('ENDED', questionIndex);
      if (ended) {
        navigate(`/teacher/analytics/class/${sessionId}`);
      }
    }
  };

  const handleCreatePersonalizedGames = async () => {
    const normalizedSessionId = Number(sessionId || 0);
    if (!normalizedSessionId || isCreatingPersonalizedGames) return;

    try {
      setIsCreatingPersonalizedGames(true);
      setHostMessage({ tone: 'info', text: 'Building personal adaptive games for every participating student...' });
      const payload = await apiFetchJson(`/api/analytics/class/${normalizedSessionId}/personalized-games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: Math.min(5, Math.max(1, packQuestionCount || 5)),
        }),
      });

      const createdCount = Number(payload?.created_count || 0);
      const reusedCount = Number(payload?.reused_count || 0);
      const failedCount = Number(payload?.failed_count || 0);
      setPersonalizedGamesSummary({
        createdCount,
        reusedCount,
        failedCount,
        createdPacks: Array.isArray(payload?.created_packs) ? payload.created_packs : [],
        failedStudents: Array.isArray(payload?.failed_students) ? payload.failed_students : [],
      });

      if (createdCount > 0 || reusedCount > 0) {
        const summaryParts = [
          createdCount > 0 ? `${createdCount} personal games created` : '',
          reusedCount > 0 ? `${reusedCount} existing games reused` : '',
          failedCount > 0 ? `${failedCount} students skipped` : '',
        ].filter(Boolean);
        setHostMessage({ tone: 'info', text: `${summaryParts.join(' • ')}.` });
      } else {
        setHostMessage({ tone: 'error', text: 'No personal games could be prepared for this session.' });
      }
    } catch (error: any) {
      console.error('[TeacherHost] Failed to build personalized games:', error);
      setHostMessage({
        tone: 'error',
        text: error?.message || 'Failed to build personalized games for this class.',
      });
    } finally {
      setIsCreatingPersonalizedGames(false);
    }
  };

  const handleLaunchQuestionRematch = async () => {
    const normalizedSessionId = Number(sessionId || 0);
    const normalizedQuestionId = Number(currentQuestion?.id || questionReplay?.question_id || 0);
    if (!normalizedSessionId || !normalizedQuestionId || isLaunchingQuestionRematch) return;

    try {
      setIsLaunchingQuestionRematch(true);
      setHostMessage({ tone: 'info', text: 'Building a targeted rematch from this question...' });
      const payload = await apiFetchJson(`/api/analytics/class/${normalizedSessionId}/questions/${normalizedQuestionId}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: Number(questionReplay?.next_action?.recommended_count || 3),
          launch_now: true,
        }),
      });

      if (!payload?.pin || !payload?.session_id) {
        throw new Error('The rematch pack was created, but the new room could not be opened.');
      }

      setHostMessage({ tone: 'info', text: `Rematch ready on PIN ${payload.pin}. Opening the new room now...` });
      navigate(`/teacher/session/${payload.pin}/host`, {
        state: {
          sessionId: Number(payload.session_id),
          packId: Number(payload.pack_id || 0),
        },
      });
    } catch (error: any) {
      console.error('[TeacherHost] Failed to launch question rematch:', error);
      setHostMessage({
        tone: 'error',
        text: error?.message || 'Could not prepare the rematch from this question.',
      });
    } finally {
      setIsLaunchingQuestionRematch(false);
    }
  };

  useEffect(() => {
    if (status !== 'QUESTION_REVEAL' || !sessionId || !currentQuestion?.id) {
      setQuestionReplay(null);
      setQuestionReplayError('');
      setIsQuestionReplayLoading(false);
      return;
    }

    let cancelled = false;
    setIsQuestionReplayLoading(true);
    setQuestionReplayError('');
    setQuestionReplay(null);

    apiFetchJson(`/api/analytics/class/${sessionId}/questions/${currentQuestion.id}/replay`)
      .then((payload) => {
        if (cancelled) return;
        setQuestionReplay(payload);
      })
      .catch((error: any) => {
        if (cancelled) return;
        console.error('[TeacherHost] Failed to load question replay:', error);
        setQuestionReplayError(error?.message || 'Question replay is unavailable for this round.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsQuestionReplayLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentQuestion?.id, sessionId, status]);

  useEffect(() => {
    if (!isPeerMode || status !== 'QUESTION_ACTIVE' || participants.length === 0) {
      return;
    }

    if (Object.keys(studentSelections).length < participants.length) {
      return;
    }

    const advanceKey = `peer-votes:${questionIndex}`;
    if (peerVoteAdvanceKeyRef.current === advanceKey) {
      return;
    }

    peerVoteAdvanceKeyRef.current = advanceKey;
    void updateState('QUESTION_DISCUSSION', questionIndex);
  }, [isPeerMode, participants.length, questionIndex, status, studentSelections]);

  useEffect(() => {
    if (!['QUESTION_ACTIVE', 'QUESTION_DISCUSSION', 'QUESTION_REVOTE'].includes(status)) {
      return;
    }

    // Safety guards against race conditions:
    // 1. Don't advance if we haven't even initialized the phase timer yet
    // 2. Don't advance if the timer is still showing time left
    // 3. Don't advance if we just transitioned in the last 4000ms (grace period)
    const now = Date.now();
    const elapsedSinceTransition = now - lastStateChangeAtRef.current;
    
    // NEW IMPORTANT GUARD: Ensure we have the correct question data loaded for the current index
    // If the question for the current index is missing, we must NOT advance.
    const hasCorrectQuestionData = pack?.questions?.[questionIndex] !== undefined;
    
    if (!hasInitializedPhaseRef.current || phaseTimeLeft > 0 || elapsedSinceTransition < 4000 || !hasCorrectQuestionData) {
      if (status === 'QUESTION_ACTIVE' && !hasCorrectQuestionData && elapsedSinceTransition > 10000) {
        // Fallback for extreme cases: if we are stuck for 10s without question data, something is wrong
        console.warn('[TeacherHost] Stuck in phase without question data:', { status, questionIndex });
      }
      return;
    }

    const advanceKey = `${status}:${questionIndex}`;
    if (autoAdvanceKeyRef.current === advanceKey) {
      return;
    }

    autoAdvanceKeyRef.current = advanceKey;
    if (status === 'QUESTION_ACTIVE') {
      void updateState(isPeerMode ? 'QUESTION_DISCUSSION' : 'QUESTION_REVEAL', questionIndex);
      return;
    }

    if (status === 'QUESTION_DISCUSSION') {
      void updateState('QUESTION_REVOTE', questionIndex);
      return;
    }

    void updateState('QUESTION_REVEAL', questionIndex);
  }, [isPeerMode, phaseTimeLeft, questionIndex, status, pack]);

  const copyPin = async () => {
    try {
      await navigator.clipboard.writeText(String(pin || ''));
      setIsPinCopied(true);
      setTimeout(() => setIsPinCopied(false), 1800);
    } catch {
      setIsPinCopied(false);
    }
  };

  const copyJoinLink = async () => {
    if (!joinUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinUrl);
      setIsJoinLinkCopied(true);
      setTimeout(() => setIsJoinLinkCopied(false), 1800);
    } catch {
      setIsJoinLinkCopied(false);
    }
  };

  // NEW: Critical Loading Guard to prevent crashes during race conditions
  // If we have a pin but haven't loaded the session metadata OR the pack itself,
  // we show a loading view to prevent the game-state UI from rendering with nulls.
  if (pin && (!sessionMeta || !pack)) {
    return (
      <div className="game-viewport-shell flex flex-col items-center justify-center p-4 sm:p-8">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <motion.div
          animate={{ 
            rotate: 360,
            scale: [1, 1.1, 1]
          }}
          transition={{ 
            rotate: { duration: 2, repeat: Infinity, ease: 'linear' },
            scale: { duration: 1, repeat: Infinity, ease: 'easeInOut' }
          }}
          className="mb-8"
        >
          <div className="w-20 h-20 rounded-3xl bg-white border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-brand-orange" />
          </div>
        </motion.div>
        
        <div className="text-center space-y-3 max-w-md">
          <h2 className="text-4xl font-black text-brand-dark tracking-tight">Syncing Session...</h2>
          <p className="text-brand-dark/60 font-bold text-lg leading-relaxed">
            Connecting to real-time room data and preparing your questions.
          </p>
        </div>

        <motion.button 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 3 }}
          onClick={() => navigate('/teacher/dashboard')}
          className="mt-12 group flex items-center gap-2 text-brand-purple font-black hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </motion.button>
      </div>
    );
  }

  if (status === 'LOBBY') {
    return (
      <div className="game-viewport-shell relative flex flex-col items-center justify-center p-4 sm:p-8 bg-brand-bg md:p-12">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Background elements for depth */}
        <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] border-[8px] border-brand-dark/[0.03] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] border-[8px] border-brand-dark/[0.03] rounded-full pointer-events-none" />

        <div className="relative z-10 w-full max-w-5xl">
          {/* Main Lobby Card */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-[4rem] border-[10px] border-brand-dark shadow-[24px_24px_0px_0px_#1A1A1A] p-8 md:p-16 flex flex-col items-center"
          >
            {/* Top decorative pill */}
            <div className="w-48 h-10 bg-[#E5E7EB] rounded-full border-4 border-brand-dark mb-10 flex items-center justify-center">
               <div className="w-16 h-1.5 bg-brand-dark rounded-full" />
            </div>

            {/* PIN Section */}
            <motion.div 
              whileHover={{ scale: 1.02 }}
              onClick={copyPin}
              className="w-full bg-[#B488FF] rounded-[2.5rem] border-[6px] border-brand-dark p-6 shadow-[12px_12px_0px_0px_#1A1A1A] mb-12 cursor-pointer relative group"
            >
              <div className="absolute -top-4 -right-4 bg-brand-yellow border-4 border-brand-dark rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {isPinCopied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </div>
              
              <div className="flex justify-center items-center gap-3 sm:gap-4 overflow-hidden">
                {String(pin || '000000').split('').map((digit, index) => (
                  <motion.div
                    key={`${digit}-${index}`}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="aspect-square w-12 sm:w-20 rounded-2xl bg-white border-[5px] border-brand-dark flex items-center justify-center text-4xl sm:text-6xl font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
                  >
                    {digit}
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* QR Code Section */}
            <div className="mb-12 p-6 bg-white rounded-[2.5rem] border-[6px] border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] hover:rotate-1 transition-transform">
              <QRCodeSVG value={joinUrl || String(pin || '')} size={220} level="H" includeMargin />
            </div>

            {/* Middle decorative pill */}
            <div className="w-56 h-12 bg-[#E5E7EB] rounded-full border-4 border-brand-dark mb-10 flex items-center justify-center">
               <div className="w-20 h-2 bg-brand-dark rounded-full" />
            </div>

            {/* Student Grid */}
            <div className="w-full max-h-[400px] overflow-y-auto custom-scrollbar pr-2 mb-10">
              {participants.length > 0 ? (
                isTeamMode ? (
                  <div className="space-y-6">
                    {(Object.entries(groupedParticipants) as Array<[string, any[]]>).map(([teamName, members]) => (
                      <div key={teamName} className="rounded-[2.5rem] border-[6px] border-brand-dark bg-brand-bg/50 p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
                        <div className="flex items-center justify-between mb-6 px-4">
                          <div>
                             <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Pod / Team</p>
                             <h3 className="text-3xl font-black text-brand-dark">{teamName}</h3>
                          </div>
                          <span className="px-5 py-2 rounded-full bg-white border-4 border-brand-dark font-black text-lg shadow-[4px_4px_0px_0px_#1A1A1A]">
                            {members.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <AnimatePresence>
                            {members.map((participant: any, index: number) => (
                              <motion.div
                                key={`${participant.nickname}-${index}`}
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                className="bg-[#E5E7EB] rounded-full border-4 border-brand-dark px-4 py-3 flex items-center gap-3 shadow-[4px_4px_0px_0px_#1A1A1A]"
                              >
                                <div className="w-8 h-8 rounded-full bg-white border-2 border-brand-dark flex-shrink-0 flex items-center justify-center font-black text-xs text-brand-dark">
                                  {participant.seat_index || index + 1}
                                </div>
                                <div className="w-full h-2 bg-brand-dark/20 rounded-full relative overflow-hidden">
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-black uppercase tracking-wider truncate text-brand-dark">
                                    {participant.nickname}
                                  </span>
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <AnimatePresence>
                      {participants.map((participant: any, index: number) => (
                        <motion.div
                          key={`${participant.nickname}-${index}`}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          className="bg-[#E5E7EB] rounded-full border-4 border-brand-dark px-4 py-3 flex items-center gap-3 shadow-[4px_4px_0px_0px_#1A1A1A]"
                        >
                          <div className="w-8 h-8 rounded-full bg-white border-2 border-brand-dark flex-shrink-0" />
                          <div className="w-full h-2 bg-brand-dark/20 rounded-full relative overflow-hidden">
                            <span className="absolute inset-0 flex items-center px-1 text-[10px] font-black uppercase tracking-wider truncate text-brand-dark">
                              {participant.nickname}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )
              ) : (
                <div className="col-span-full py-10 text-center">
                  <p className="text-xl font-black text-brand-dark/30 uppercase tracking-widest">Waiting for students...</p>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="w-full flex flex-col sm:flex-row gap-4 items-center justify-between border-t-8 border-brand-dark/10 pt-10">
               <button
                 onClick={() => navigate('/teacher/dashboard')}
                 className="flex items-center gap-2 text-brand-dark/40 font-black hover:text-brand-orange transition-colors"
               >
                 <ArrowLeft className="w-5 h-5" />
                 Back to Dashboard
               </button>

               <div className="flex gap-4">
                 <button
                   onClick={handleEndSession}
                   className="px-6 py-3 bg-white border-4 border-brand-dark rounded-full font-black text-rose-500 shadow-[4px_4px_0px_0px_#1A1A1A] hover:bg-rose-50 transition-colors"
                 >
                   Stop
                 </button>
                 <motion.button
                   whileHover={{ scale: participants.length > 0 ? 1.05 : 1 }}
                   whileTap={{ scale: participants.length > 0 ? 0.95 : 1 }}
                   onClick={() => updateState('QUESTION_ACTIVE', 0)}
                   disabled={participants.length === 0 || phaseTransitionPending}
                   className="px-10 py-5 bg-brand-orange text-white border-4 border-brand-dark rounded-[2rem] font-black text-2xl shadow-[10px_10px_0px_0px_#1A1A1A] disabled:opacity-40"
                 >
                   Launch Game
                 </motion.button>
               </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }



  if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_DISCUSSION' || status === 'QUESTION_REVOTE') {
    const isDiscussion = status === 'QUESTION_DISCUSSION';
    const isRevote = status === 'QUESTION_REVOTE';
    const nextStatus = isDiscussion ? 'QUESTION_REVOTE' : isPeerMode && !isRevote ? 'QUESTION_DISCUSSION' : 'QUESTION_REVEAL';
    const nextButtonLabel = isDiscussion ? 'Final Revote' : isPeerMode && !isRevote ? 'Start Discussion' : 'Reveal Answer';

    return (
      <div className="game-viewport-shell flex flex-col overflow-hidden text-brand-dark bg-white relative">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Top Minimal Action Bar */}
        <div className="flex items-center justify-between px-6 lg:px-12 py-6 shrink-0 z-20">
          <div className="flex items-center gap-4">
            <div className="bg-[#B488FF] rounded-[1.2rem] border-4 border-brand-dark px-3 py-2 shadow-[4px_4px_0px_0px_#1A1A1A] flex items-center gap-1.5 cursor-pointer" onClick={copyPin}>
              {String(pin || '000000').split('').map((digit, index) => (
                <div key={index} className="w-6 h-8 lg:w-7 lg:h-9 bg-white rounded-lg border-[3px] border-brand-dark flex flex-col items-center justify-center font-black text-sm lg:text-base">
                  {digit}
                </div>
              ))}
            </div>
            {isPinCopied && <span className="font-black text-brand-purple text-sm animate-pulse">Copied!</span>}
            
            {/* Host End Game logic hidden in a clean way, or placed on corner */}
            <button onClick={handleEndSession} className="w-10 h-10 lg:w-12 lg:h-12 rounded-[1rem] border-4 border-rose-500 bg-rose-50 text-rose-500 flex items-center justify-center shadow-[4px_4px_0px_0px_#F43F5E] hover:bg-rose-100 transition-colors ml-4 sm:ml-0" title="Close Session">
              <XCircle className="w-6 h-6" />
            </button>
          </div>

          <div className="hidden md:flex absolute left-1/2 top-10 -translate-x-1/2">
             <div className="w-32 h-8 lg:w-48 lg:h-10 bg-[#E5E7EB] rounded-full border-4 border-brand-dark flex items-center justify-center">
                <div className="w-12 h-1.5 lg:w-20 lg:h-2 bg-brand-dark rounded-full" />
             </div>
          </div>

          <div className="flex items-center gap-6">
             <div className="hidden lg:block text-2xl font-black text-brand-dark/40 border-r-4 border-brand-dark/10 pr-6">
               <span className="text-brand-dark">{totalAnswers}</span> / {participants.length || 0} Votes
             </div>
             <div className="text-4xl lg:text-5xl xl:text-6xl font-black tabular-nums tracking-tighter">
               0:{phaseTimeLeft.toString().padStart(2, '0')}
             </div>
          </div>
        </div>

        {/* Alerts / Notices (Floating) */}
        {hostMessage && (
          <div className="absolute top-28 left-1/2 -translate-x-1/2 z-50">
            <HostPhaseNotice message={hostMessage} />
          </div>
        )}
        <div className="absolute top-28 right-4 space-y-2 pointer-events-none z-50">
          <AnimatePresence>
            {Array.from(focusAlerts).map((nickname) => (
              <motion.div
                key={nickname}
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 100, opacity: 0 }}
                className="bg-brand-orange text-white px-6 py-3 rounded-[1.5rem] border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] flex items-center gap-3 font-black"
              >
                <AlertTriangle className="w-5 h-5" />
                {extractNickname(nickname as string)} focus loss!
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col px-4 lg:px-12 pb-24 xl:pb-32 min-h-0 w-full max-w-[1800px] mx-auto">
          
          <motion.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full h-full flex-[1.4] rounded-[2.5rem] lg:rounded-[3rem] border-8 border-brand-dark relative overflow-hidden shadow-[12px_12px_0px_0px_#1A1A1A] mb-8 bg-brand-purple flex items-center justify-center z-10 ${!currentQuestion?.image_url ? 'bg-gradient-to-br from-brand-orange to-brand-yellow' : ''}`}
          >
            {/* Progress Bar mapped to top */}
            <div className="absolute top-0 left-0 w-full h-3 z-30 bg-brand-dark/10">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${participants.length > 0 ? (totalAnswers / participants.length) * 100 : 0}%` }}
                className="h-full bg-brand-yellow"
                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
              />
            </div>

            {currentQuestion?.image_url && (
               <img src={currentQuestion.image_url} alt="Question Context" className="absolute inset-0 w-full h-full object-cover object-center" />
            )}
            
            {/* Subtle overlay to ensure the prompt pill pops */}
            <div className="absolute inset-0 bg-brand-dark/5 backdrop-blur-[2px]" />

            {/* Floating Overlaid Question */}
            <div className="relative z-20 px-8 py-5 md:px-16 md:py-8 bg-white rounded-[2.5rem] md:rounded-[3.5rem] border-[6px] border-brand-dark shadow-[16px_16px_0px_0px_#1A1A1A] max-w-[90%] md:max-w-5xl text-center">
               <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black leading-tight text-brand-dark tracking-tight" dir="auto">
                 {currentQuestion?.prompt}
               </h2>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-8 w-full shrink-0 flex-1 min-h-[160px] max-h-[40vh]">
            {currentAnswers.map((ans: string, i: number) => {
              const selectionCount = Object.values(studentSelections).filter((idx) => idx === i).length;
              const selectionPct = participants.length > 0 ? Math.round((selectionCount / participants.length) * 100) : 0;
              return (
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.08 }}
                  key={i}
                  className="relative flex items-center overflow-hidden rounded-[2.5rem] lg:rounded-[3rem] border-[6px] border-brand-dark bg-[#E5E7EB] px-8 lg:px-12 py-6 shadow-[10px_10px_0px_0px_#1A1A1A]"
                >
                  <div className="absolute top-0 left-0 h-full bg-[#D1D5DB] transition-all duration-300" style={{ width: `${selectionPct}%` }} />
                  
                  <div className="relative z-10 w-full flex flex-col justify-center h-full">
                    <p className="leading-tight break-words text-brand-dark font-black text-2xl lg:text-4xl pr-8" dir="auto">{ans}</p>
                    
                    {/* Visual vote count mapped below the text elegantly */}
                    {selectionCount > 0 && (
                      <div className="mt-4 flex items-center gap-3">
                         <div className="flex -space-x-2">
                           {Array.from({ length: Math.min(3, selectionCount) }).map((_, idx) => (
                             <div key={idx} className="w-6 h-6 rounded-full bg-white border-2 border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]" />
                           ))}
                         </div>
                         <span className="font-black text-brand-dark/50 text-lg">+{selectionCount} inside</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Restored Host Insights Data Row */}
          {liveHostInsights && !isDiscussion && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 mt-8 w-full shrink-0 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
              <HostInsightCard
                title="Room Pulse"
                accent="indigo"
                compact
                value={`${liveHostInsights.participationPct}%`}
                body={`${liveHostInsights.answeredCount} students committed.`}
              />
              <HostInsightCard
                title="Lead Signal"
                compact
                accent={
                  liveHostInsights.leader &&
                  currentQuestion &&
                  liveHostInsights.leader.index !== Number(currentQuestion.correct_index) &&
                  liveHostInsights.leader.pct >= 45
                     ? 'amber'
                     : 'emerald'
                }
                value={
                  liveHostInsights.leader
                    ? `${formatAnswerSlotLabel(liveHostInsights.leader.index)} · ${liveHostInsights.leader.pct}%`
                    : 'Waiting'
                }
                body={
                  liveHostInsights.runnerUp
                    ? `Runner up: ${formatAnswerSlotLabel(liveHostInsights.runnerUp.index)} · ${liveHostInsights.runnerUp.pct}%`
                    : 'No clear pattern yet.'
                }
              />
              <HostInsightCard
                title={liveHostInsights.primaryCue.title}
                compact
                accent={
                  liveHostInsights.primaryCue.tone === 'warning'
                    ? 'amber'
                    : liveHostInsights.primaryCue.tone === 'success'
                      ? 'emerald'
                      : 'indigo'
                }
                body={liveHostInsights.primaryCue.body}
              />
            </div>
          )}
        </div>

        {/* BOTTOM FLOATING ACTION BUTTON (Mapped to Next Phase) */}
        <div className="absolute bottom-[-20px] left-1/2 -translate-x-1/2 z-50">
           <motion.button
            whileHover={{ scale: phaseTransitionPending ? 1 : 1.05, y: -10 }}
            whileTap={{ scale: phaseTransitionPending ? 1 : 0.95 }}
            onClick={() => updateState(nextStatus, questionIndex)}
            disabled={phaseTransitionPending}
            className="w-48 lg:w-64 h-24 lg:h-32 bg-[#E5E7EB] border-[8px] border-brand-dark rounded-[3rem] flex flex-col items-center justify-start pt-6 font-black text-xl lg:text-3xl hover:bg-brand-yellow hover:text-brand-dark hover:border-brand-dark transition-all group overflow-hidden shadow-[0px_0px_30px_rgba(0,0,0,0.15)]"
          >
            {phaseTransitionPending ? (
               <span>Working...</span>
            ) : (
               <>
                 <span className="opacity-0 group-hover:opacity-100 absolute top-7 flex items-center justify-center font-black">
                   {nextButtonLabel} <ChevronRight className="w-6 h-6 ml-1 stroke-[3px]" />
                 </span>
                 <div className="w-20 lg:w-28 h-2.5 lg:h-3 bg-brand-dark rounded-full group-hover:opacity-0 transition-opacity" />
               </>
            )}
          </motion.button>
        </div>
      </div>
    );
  }

  if (status === 'QUESTION_REVEAL') {
    return (
      <div className="game-viewport-shell flex flex-col overflow-hidden text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="z-50 shrink-0 flex flex-col gap-4 border-b-4 border-brand-dark bg-white px-4 py-4 shadow-sm sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={handleEndSession}
              className="flex items-center gap-3 text-brand-dark/30 hover:text-rose-500 font-black transition-colors text-lg"
            >
              <XCircle className="w-6 h-6" />
              End Game
            </button>
            <div className="text-brand-dark font-black text-2xl bg-brand-bg px-6 py-2 rounded-xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">Results</div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
              {gameMode.label}
            </div>
          </div>
          <motion.button
            whileHover={{ scale: phaseTransitionPending ? 1 : 1.05 }}
            whileTap={{ scale: phaseTransitionPending ? 1 : 0.95 }}
            onClick={() => updateState('LEADERBOARD', questionIndex)}
            disabled={phaseTransitionPending}
            className="bg-brand-dark text-white px-8 py-3 rounded-xl font-black text-xl hover:bg-brand-dark/90 transition-all flex items-center gap-3 shadow-[6px_6px_0px_0px_#FF5A36] disabled:opacity-50"
          >
            {phaseTransitionPending ? 'Working...' : 'Next Phase'} <ChevronRight className="w-6 h-6" />
          </motion.button>
        </div>

        {hostMessage && (
          <div className="px-8 pt-4 shrink-0">
            <HostPhaseNotice message={hostMessage} />
          </div>
        )}

        <div className="relative mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-6 sm:px-6">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full mb-6 rounded-[2rem] border-4 border-brand-dark bg-white p-6 relative overflow-hidden shadow-[10px_10px_0px_0px_#1A1A1A] shrink-0"
          >
            <div className="flex flex-col lg:flex-row lg:items-center gap-6">
              {currentQuestion?.image_url && (
                <QuestionImageCard
                  imageUrl={currentQuestion?.image_url}
                  alt={currentQuestion?.prompt || 'Question image'}
                  className="shrink-0"
                  imgClassName="max-h-[15vh] w-auto rounded-xl"
                />
              )}
              <div className="min-w-0 flex-1">
                <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.2em] mb-2 ${gameTone.pill}`}>
                  The Correct Answer
                </span>
                <h2 className="text-2xl lg:text-3xl font-black text-brand-dark leading-tight line-clamp-3">
                  {currentQuestion?.prompt}
                </h2>
              </div>
            </div>
          </motion.div>

          <QuestionReplayShowcase
            replay={questionReplay}
            loading={isQuestionReplayLoading}
            error={questionReplayError}
            onLaunchRematch={() => void handleLaunchQuestionRematch()}
            rematchBusy={isLaunchingQuestionRematch}
          />

          {/* Statistics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full mb-6 shrink-0">
            <HostStageMetric label="Timer" value="Reveal" tone="dark" />
            <HostStageMetric label="Correct" value={correctSelectionCount} tone="warm" />
            <HostStageMetric label="Total Votes" value={totalAnswers} tone="light" />
            <HostStageMetric 
              label="Accuracy" 
              value={participants.length > 0 ? `${Math.round((correctSelectionCount / participants.length) * 100)}%` : '0%'} 
              tone="light" 
            />
          </div>

          <div className="grid w-full gap-4 mb-6 lg:grid-cols-2 flex-1 min-h-0 overflow-auto pr-2 custom-scrollbar">
            {currentAnswers.map((choice: string, i: number) => {
              const isCorrect = i === currentQuestion?.correct_index;
              const choiceResult = answerSelectionSummary[i] || { count: 0, pct: 0 };
              return (
                <motion.div
                  key={i}
                  initial={{ x: i % 2 === 0 ? -20 : 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className={`relative p-5 rounded-[1.8rem] border-4 flex flex-col gap-3 shadow-[8px_8px_0px_0px_#1A1A1A] ${
                    isCorrect ? 'border-emerald-500 bg-emerald-50' : 'border-brand-dark/10 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black shrink-0 ${isCorrect ? 'bg-emerald-500 text-white' : 'bg-brand-bg text-brand-dark/30'}`}>
                        {isCorrect ? <CheckCircle2 className="w-6 h-6" /> : formatAnswerSlotLabel(i)}
                      </div>
                      <p className={`font-black text-lg lg:text-xl break-words ${isCorrect ? 'text-brand-dark' : 'text-brand-dark/40'}`}>{choice}</p>
                    </div>
                    {isCorrect && <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />}
                  </div>
                  
                  <div className="flex items-center gap-3">
                     <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isCorrect ? 'bg-white border-emerald-300 text-emerald-800' : 'bg-brand-bg border-brand-dark/5 text-brand-dark/30'}`}>
                        {choiceResult.count} {choiceResult.count === 1 ? 'student' : 'students'}
                      </span>
                      <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isCorrect ? 'bg-emerald-500 text-white border-brand-dark' : 'bg-white border-brand-dark/5 text-brand-dark/20'}`}>
                        {choiceResult.pct}%
                      </span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {currentQuestion?.explanation && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="w-full bg-brand-purple/5 border-2 border-brand-purple/20 p-4 rounded-2xl flex items-start gap-3 shrink-0"
            >
              <Lightbulb className="w-5 h-5 text-brand-purple shrink-0 mt-1" />
              <p className="text-sm font-medium text-brand-dark/80 line-clamp-3">
                <span className="font-black text-brand-purple">Insight:</span> {currentQuestion.explanation}
              </p>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    const isLast = questionIndex >= (pack?.questions?.length || 0) - 1;

    return (
      <div className="game-viewport-shell flex flex-col overflow-hidden text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="z-50 shrink-0 flex flex-col gap-4 border-b-4 border-brand-dark bg-white px-4 py-4 shadow-sm sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={handleEndSession}
              className="flex items-center gap-2 text-brand-dark/30 hover:text-rose-500 font-black transition-colors text-lg"
            >
              <XCircle className="w-6 h-6" />
              End Game
            </button>
            <div className="text-brand-dark font-black text-2xl bg-brand-bg px-6 py-2 rounded-xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
              {isLast ? 'Final Standings' : 'Standings'}
            </div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
              {gameMode.label}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {isLast && (
              <motion.button
                whileHover={{ scale: isCreatingPersonalizedGames ? 1 : 1.03 }}
                whileTap={{ scale: isCreatingPersonalizedGames ? 1 : 0.97 }}
                onClick={() => void handleCreatePersonalizedGames()}
                disabled={isCreatingPersonalizedGames}
                className="bg-brand-yellow text-brand-dark px-6 py-4 rounded-xl font-black text-lg hover:opacity-90 transition-all flex items-center justify-center gap-3 shadow-[6px_6px_0px_0px_#1A1A1A] disabled:opacity-60"
              >
                <Sparkles className="w-6 h-6" />
                {isCreatingPersonalizedGames
                  ? 'Building Personal Games...'
                  : personalizedGamesSummary
                    ? 'Refresh Personal Games'
                    : 'Build Personal Games For Everyone'}
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: phaseTransitionPending ? 1 : 1.05 }}
              whileTap={{ scale: phaseTransitionPending ? 1 : 0.95 }}
              onClick={async () => {
                if (isLast) {
                  const ended = await updateState('ENDED', questionIndex);
                  if (ended) {
                    navigate(`/teacher/analytics/class/${sessionId}`);
                  }
                } else {
                  await updateState('QUESTION_ACTIVE', questionIndex + 1);
                }
              }}
              disabled={phaseTransitionPending}
              className={`${isLast ? 'bg-emerald-500 shadow-[6px_6px_0px_0px_#064e3b]' : 'bg-brand-dark shadow-[6px_6px_0px_0px_#FF5A36]'} text-white px-10 py-4 rounded-xl font-black text-xl hover:opacity-90 transition-all flex items-center justify-center gap-3 disabled:opacity-50`}
            >
              {phaseTransitionPending ? 'Working...' : isLast ? 'End Game & Results' : 'Next Question'} <ChevronRight className="w-8 h-8" />
            </motion.button>
          </div>
        </div>

        {hostMessage && (
          <div className="px-8 pt-4 shrink-0">
            <HostPhaseNotice message={hostMessage} />
          </div>
        )}

        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 sm:px-6">
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-6 shrink-0"
          >
            <h2 className="text-4xl lg:text-5xl font-black text-brand-dark tracking-tight text-center">
              {isLast ? 'The Winners Circle' : 'Leaderboard'}
            </h2>
          </motion.div>

          {isLast && personalizedGamesSummary && (
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="mb-6 w-full shrink-0 rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Personal Adaptive Games</p>
                  <h3 className="text-2xl font-black leading-tight">
                    {personalizedGamesSummary.createdCount > 0
                      ? `Prepared ${personalizedGamesSummary.createdCount} new personal games for this class`
                      : 'Personal games were already prepared for this class'}
                  </h3>
                  <p className="font-medium text-brand-dark/70 mt-2">
                    These packs are now available in My Quizzes, one per student, using the session analytics and each learner&apos;s weak areas.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-sm font-black">
                    {personalizedGamesSummary.createdCount} created
                  </span>
                  <span className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-sm font-black">
                    {personalizedGamesSummary.reusedCount} reused
                  </span>
                  <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black">
                    {personalizedGamesSummary.failedCount} skipped
                  </span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {personalizedGamesSummary.createdPacks.slice(0, 6).map((packRow: any) => (
                  <div
                    key={`${packRow.participant?.id}-${packRow.pack_id}`}
                    className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-lg font-black truncate">{packRow.participant?.nickname}</p>
                        <p className="font-medium text-brand-dark/65 truncate">{packRow.title}</p>
                      </div>
                      <span className={`rounded-full border-2 border-brand-dark px-3 py-1 text-xs font-black ${packRow.reused ? 'bg-white' : 'bg-emerald-100 text-emerald-900'}`}>
                        {packRow.reused ? 'Reused' : 'Ready'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1 text-xs font-black">
                        {packRow.question_count} questions
                      </span>
                      {Array.isArray(packRow.focus_tags) && packRow.focus_tags.slice(0, 2).map((tag: string) => (
                        <span
                          key={`${packRow.pack_id}-${tag}`}
                          className="rounded-full border-2 border-brand-dark bg-brand-orange/10 px-3 py-1 text-xs font-black capitalize"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {personalizedGamesSummary.failedCount > 0 && personalizedGamesSummary.failedStudents.length > 0 && (
                <p className="mt-4 font-medium text-brand-dark/70">
                  Skipped students: {personalizedGamesSummary.failedStudents.slice(0, 4).map((row: any) => row?.participant?.nickname).filter(Boolean).join(', ')}
                  {personalizedGamesSummary.failedStudents.length > 4 ? '...' : ''}
                </p>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => navigate('/teacher/dashboard')}
                  className="rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white transition-transform hover:-translate-y-0.5"
                >
                  Open My Quizzes
                </button>
                <button
                  onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
                  className="rounded-full border-2 border-brand-dark bg-white px-5 py-3 font-black transition-transform hover:-translate-y-0.5"
                >
                  Open Class Analytics
                </button>
              </div>
            </motion.div>
          )}

          <div className="flex-1 w-full min-h-0 overflow-auto custom-scrollbar pr-2 pb-10">
            {isTeamMode && teamBoard.length > 0 ? (
              <div className="w-full max-w-4xl mx-auto space-y-6">
                {teamBoard.slice(0, 5).map((team: any, i: number) => (
                  <motion.div
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1 }}
                    key={team.team_id || team.team_name}
                    className={`p-6 rounded-[2rem] border-4 shadow-[8px_8px_0px_0px_#1A1A1A] ${i === 0 ? 'bg-brand-yellow border-brand-dark' : 'bg-white border-brand-dark/10'}`}
                  >
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-6">
                        <div className={`w-14 h-14 rounded-full border-4 border-brand-dark flex items-center justify-center font-black text-2xl ${i === 0 ? 'bg-brand-orange text-white' : 'bg-brand-bg text-brand-dark/40'}`}>
                          {i + 1}
                        </div>
                        <div>
                          <span className="text-3xl font-black text-brand-dark">{team.team_name}</span>
                          <p className="text-sm font-bold text-brand-dark/50">{team.student_count} members · {team.accuracy?.toFixed?.(0) || team.accuracy}% correct</p>
                        </div>
                      </div>
                      <div className="text-4xl font-black text-brand-purple">{team.total_score || 0}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                <div className="w-full mb-10 shrink-0">
                  {leaderboard.length > 0 ? (
                    <div className="flex h-[260px] flex-row items-end justify-center gap-3 sm:h-[320px] lg:h-[400px] lg:gap-4">
                      {/* 2nd Place */}
                      {leaderboard[1] && (
                        <PodiumStep 
                          participant={leaderboard[1]} 
                          rank={2} 
                          height="h-[65%]" 
                          delay={0.2} 
                          color="bg-brand-bg"
                          icon={<Medal className="w-10 h-10 text-brand-dark/30" />}
                        />
                      )}
                      
                      {/* 1st Place */}
                      {leaderboard[0] && (
                        <PodiumStep 
                          participant={leaderboard[0]} 
                          rank={1} 
                          height="h-[90%]" 
                          delay={0.4} 
                          color="bg-brand-yellow"
                          icon={<Crown className="w-14 h-14 text-brand-orange" />}
                          isWinner
                        />
                      )}

                      {/* 3rd Place */}
                      {leaderboard[2] && (
                        <PodiumStep 
                          participant={leaderboard[2]} 
                          rank={3} 
                          height="h-[50%]" 
                          delay={0.6} 
                          color="bg-brand-orange/10"
                          icon={<Award className="w-8 h-8 text-brand-orange" />}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-brand-dark/40 py-12 text-xl font-black">Calculating standings...</div>
                  )}
                </div>

                {leaderboard.length > 3 && (
                  <div className="w-full max-w-5xl space-y-4">
                    <h3 className="text-xl font-black text-brand-dark/30 uppercase tracking-[0.2em] mb-4 flex items-center justify-center gap-3">
                      <BarChart3 className="w-5 h-5" />
                      Challengers
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {leaderboard.slice(3, 12).map((p: any, i: number) => (
                        <motion.div
                          initial={{ y: 10, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.8 + i * 0.05 }}
                          key={p.id}
                          className="flex items-center justify-between p-4 bg-white rounded-2xl border-2 border-brand-dark/5 shadow-sm hover:border-brand-dark/20 transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-brand-bg flex items-center justify-center font-black text-xs text-brand-dark/40">
                              {i + 4}
                            </div>
                            <Avatar 
                              nickname={p.nickname} 
                              imgClassName="w-10 h-10 rounded-xl" 
                              textClassName="text-base font-black text-brand-dark truncate" 
                            />
                          </div>
                          <div className="text-xl font-black text-brand-purple">{p.total_score || 0}</div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ENDED') {
    return (
      <div className="game-viewport-shell flex flex-col items-center justify-center p-4 sm:p-8 text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="w-full max-w-xl rounded-[2rem] border-4 border-brand-dark bg-white p-8 text-center shadow-[8px_8px_0px_0px_#1A1A1A]">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border-4 border-brand-dark bg-brand-yellow">
            <Trophy className="h-8 w-8 text-brand-orange" />
          </div>
          <h2 className="mb-3 text-3xl font-black">Game complete</h2>
          <p className="mb-6 font-medium text-brand-dark/70">
            Quizzi is wrapping this room and opening the analytics report for the finished session.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
              className="rounded-full border-2 border-brand-dark bg-brand-orange px-6 py-3 font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A]"
            >
              Open Analytics
            </button>
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="rounded-full border-2 border-brand-dark bg-white px-6 py-3 font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  console.warn('[TeacherHost] Unhandled game status or state reached. Rendering fallback.', { status, pin, sessionId, packId });
  return (
    <div className="game-viewport-shell flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="bg-white rounded-[2rem] border-4 border-brand-dark p-8 shadow-[8px_8px_0px_0px_#1A1A1A] max-w-md text-center">
        <h2 className="text-3xl font-black mb-4">{t('dash.error.requestFailed')}</h2>
        <p className="font-medium text-brand-dark/70 mb-6">
          {t('game.fallback.unfamiliarState')}
        </p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => window.location.reload()}
            className="w-full px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
          >
            {t('dash.action.refresh')}
          </button>
          <button 
            onClick={() => navigate('/teacher/dashboard')}
            className="w-full px-6 py-3 bg-white border-2 border-brand-dark rounded-full font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
          >
            {t('nav.dashboard')}
          </button>
        </div>
      </div>
    </div>
  );
}

const REPLAY_CHOICE_COLORS = [
  '#FF5A36',
  '#9B51E0',
  '#FFD233',
  '#1A1A1A',
  '#10B981',
  '#0EA5E9',
  '#F97316',
  '#EF4444',
];

function getReplayChoiceColor(index: number) {
  return REPLAY_CHOICE_COLORS[Math.abs(index) % REPLAY_CHOICE_COLORS.length];
}

function replayToneClasses(tone?: string) {
  if (tone === 'danger') {
    return 'border-brand-dark bg-brand-orange text-white';
  }
  if (tone === 'warning') {
    return 'border-brand-dark bg-brand-yellow text-brand-dark';
  }
  if (tone === 'success') {
    return 'border-emerald-400 bg-emerald-100 text-emerald-900';
  }
  return 'border-brand-dark bg-white text-brand-dark';
}

function QuestionReplayShowcase({
  replay,
  loading,
  error,
  onLaunchRematch,
  rematchBusy,
}: {
  replay: any;
  loading: boolean;
  error: string;
  onLaunchRematch: () => void;
  rematchBusy: boolean;
}) {
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-[2rem] border-4 border-brand-dark bg-brand-dark p-6 text-white shadow-[10px_10px_0px_0px_#FF5A36]"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl border-2 border-white/20 border-t-white animate-spin" />
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Mind Replay</p>
            <p className="text-2xl font-black">Building the question story from live telemetry...</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-28 rounded-[1.5rem] bg-white/10 animate-pulse" />
          <div className="h-28 rounded-[1.5rem] bg-white/10 animate-pulse" />
          <div className="h-28 rounded-[1.5rem] bg-white/10 animate-pulse" />
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-rose-400 bg-rose-50">
            <AlertTriangle className="w-6 h-6 text-rose-600" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Mind Replay</p>
            <p className="text-2xl font-black mb-2">This round closed, but the replay could not load.</p>
            <p className="font-medium text-brand-dark/70">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!replay) return null;

  const signals = Array.isArray(replay?.signals) ? replay.signals.slice(0, 4) : [];
  const spotlightGroups = Array.isArray(replay?.spotlight_groups) ? replay.spotlight_groups : [];
  const actionLabel = String(replay?.next_action?.cta_label || 'Launch targeted rematch');

  return (
    <div className="mb-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_360px]"
      >
        <div className="rounded-[2.2rem] border-4 border-brand-dark bg-brand-dark p-6 text-white shadow-[10px_10px_0px_0px_#FF5A36]">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.2em]">
              Mind Replay
            </span>
            <span className="rounded-full border border-brand-dark bg-brand-yellow px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-brand-dark">
              {replay?.story?.kicker || 'Question replay'}
            </span>
          </div>
          <h3 className="text-3xl lg:text-4xl font-black leading-tight tracking-tight mb-3">
            {replay?.story?.headline}
          </h3>
          <p className="max-w-3xl text-base lg:text-lg font-medium text-white/80 leading-relaxed">
            {replay?.story?.body}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {signals.map((signal: any) => (
              <React.Fragment key={signal.id}>
                <ReplaySignalPill signal={signal} />
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="rounded-[2.2rem] border-4 border-brand-dark bg-white p-6 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Next Move</p>
          <h4 className="text-2xl font-black leading-tight mb-3">{actionLabel}</h4>
          <p className="font-medium text-brand-dark/75 leading-relaxed mb-4">
            {replay?.story?.next_move}
          </p>
          <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 mb-5">
            <p className="text-sm font-bold text-brand-dark/80">
              {replay?.next_action?.body}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: rematchBusy ? 1 : 1.03 }}
            whileTap={{ scale: rematchBusy ? 1 : 0.97 }}
            onClick={onLaunchRematch}
            disabled={rematchBusy}
            className="w-full rounded-[1.4rem] border-4 border-brand-dark bg-brand-orange px-5 py-4 text-lg font-black text-white shadow-[6px_6px_0px_0px_#1A1A1A] disabled:opacity-60 flex items-center justify-center gap-3"
          >
            <Rocket className="w-5 h-5" />
            {rematchBusy ? 'Preparing Rematch...' : actionLabel}
          </motion.button>
        </div>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <ReplayTimeline replay={replay} />

        <div className="space-y-4">
          {spotlightGroups.length > 0 ? (
            spotlightGroups.map((group: any) => (
              <React.Fragment key={group.id}>
                <ReplaySpotlightCard group={group} />
              </React.Fragment>
            ))
          ) : (
            <div className="rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A]">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Student Spotlights</p>
              <p className="text-2xl font-black mb-2">The strongest pattern here is collective.</p>
              <p className="font-medium text-brand-dark/70">
                This question is better explained by the whole-room story than by one or two outlier students.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplaySignalPill({ signal }: { signal: any }) {
  const accentClass =
    signal?.tone === 'danger'
      ? 'bg-brand-orange text-white border-brand-dark'
      : signal?.tone === 'warning'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : signal?.tone === 'success'
          ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
          : 'bg-white/10 text-white border-white/10';

  return (
    <div className={`rounded-[1.3rem] border-2 p-4 ${accentClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-75 mb-1">{signal?.label}</p>
      <p className="text-2xl font-black leading-none mb-1">{signal?.value}</p>
      <p className="text-sm font-bold leading-snug opacity-85">{signal?.detail}</p>
    </div>
  );
}

function ReplayTimeline({ replay }: { replay: any }) {
  const timeline = Array.isArray(replay?.timeline) ? replay.timeline : [];
  const finalDistribution = Array.isArray(replay?.final_distribution) ? replay.final_distribution : [];
  const roomSize = Math.max(1, Number(replay?.participants || 0));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[2rem] border-4 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Timeline Replay</p>
          <h4 className="text-2xl font-black leading-tight">How the room committed over time</h4>
          <p className="font-medium text-brand-dark/70 mt-1">
            Each column shows the room state at that time slice, including how many students had still not committed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {finalDistribution
            .filter((entry: any) => Number(entry?.count || 0) > 0 || Number(entry?.index || 0) === Number(replay?.correct_index || 0))
            .map((entry: any) => {
              const isCorrect = Number(entry?.index || 0) === Number(replay?.correct_index || 0);
              const color = getReplayChoiceColor(Number(entry?.index || 0));
              return (
                <span
                  key={`final-${entry.index}`}
                  className={`rounded-full border-2 px-3 py-1.5 text-xs font-black ${isCorrect ? 'text-white border-brand-dark' : 'text-brand-dark border-brand-dark'}`}
                  style={{ backgroundColor: isCorrect ? color : `${color}22` }}
                >
                  {formatAnswerSlotLabel(Number(entry.index || 0))} {entry.pct_of_room}%
                </span>
              );
            })}
          <span className="rounded-full border-2 border-brand-dark bg-white px-3 py-1.5 text-xs font-black text-brand-dark">
            Pending
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[700px] items-end gap-3">
          {timeline.map((bucket: any) => (
            <div key={`replay-bucket-${bucket.bucket_index}`} className="flex-1 min-w-[80px]">
              <div className="h-48 overflow-hidden rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg">
                <div className="flex h-full flex-col">
                  {Number(bucket?.unanswered_count || 0) > 0 && (
                    <div
                      className="border-b border-brand-dark/10 bg-white/80"
                      style={{ height: `${(Number(bucket.unanswered_count || 0) / roomSize) * 100}%` }}
                    />
                  )}
                  {Array.isArray(bucket?.answer_counts) && bucket.answer_counts.map((entry: any) => {
                    const count = Number(entry?.count || 0);
                    if (count <= 0) return null;
                    return (
                      <div
                        key={`bucket-${bucket.bucket_index}-choice-${entry.index}`}
                        style={{
                          height: `${(count / roomSize) * 100}%`,
                          backgroundColor: getReplayChoiceColor(Number(entry?.index || 0)),
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mt-2 text-center">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/55">{bucket.label}</p>
                <p className="text-sm font-black text-brand-dark">{bucket.committed_count}/{replay.participants}</p>
                <p className="text-[11px] font-bold text-brand-dark/60">
                  {bucket.submission_count > 0 ? `${bucket.submission_count} locked` : ' '}
                </p>
                <p className="text-[11px] font-bold text-brand-dark/60">
                  {bucket.switch_count > 0 ? `${bucket.switch_count} shifts` : ' '}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function ReplaySpotlightCard({ group }: { group: any }) {
  const toneClass = replayToneClasses(group?.tone);
  const students = Array.isArray(group?.students) ? group.students : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-[2rem] border-4 p-5 shadow-[8px_8px_0px_0px_#1A1A1A] ${toneClass}`}
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70 mb-2">Student Spotlights</p>
      <h4 className="text-2xl font-black leading-tight mb-2">{group?.title}</h4>
      <p className="font-medium leading-relaxed opacity-80 mb-4">{group?.body}</p>
      <div className="space-y-3">
        {students.map((student: any) => (
          <div
            key={`${group?.id}-${student?.participant_id}`}
            className="rounded-[1.2rem] border-2 border-brand-dark/10 bg-white/70 p-3 text-brand-dark"
          >
            <p className="font-black">{extractNickname(String(student?.nickname || 'Student'))}</p>
            <p className="text-sm font-medium text-brand-dark/70">{student?.detail}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function PodiumStep({ 
  participant, 
  rank, 
  height, 
  delay, 
  color, 
  icon, 
  isWinner 
}: { 
  participant: any; 
  rank: number; 
  height: string; 
  delay: number; 
  color: string; 
  icon: React.ReactNode;
  isWinner?: boolean;
}) {
  useEffect(() => {
    if (isWinner) {
      const timer = setTimeout(() => {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#FF5A36', '#B488FF', '#FFD233']
        });
      }, delay * 1000 + 500);
      return () => clearTimeout(timer);
    }
  }, [isWinner, delay]);

  return (
    <motion.div 
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, duration: 0.8, type: 'spring' }}
      className={`flex flex-col items-center justify-end w-full max-w-[280px] h-full relative group`}
    >
      <div className="mb-6 flex flex-col items-center">
        <motion.div
          animate={isWinner ? { y: [0, -10, 0] } : {}}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <Avatar 
            nickname={participant.nickname} 
            imgClassName="w-24 h-24 ring-4 ring-white shadow-2xl" 
            textClassName="hidden"
          />
        </motion.div>
        <div className="mt-6 max-w-[220px] rounded-full border-4 border-brand-dark bg-white px-5 py-3 shadow-[4px_4px_0px_0px_#1A1A1A] sm:max-w-[260px] sm:px-8">
          <p className="truncate text-xl font-black text-brand-dark sm:text-2xl lg:text-3xl">{extractNickname(participant.nickname)}</p>
        </div>
        <p className="text-5xl font-black text-brand-purple mt-4 drop-shadow-sm">{participant.total_score || 0}</p>
      </div>

      <motion.div 
        initial={{ height: 0 }}
        animate={{ height: height.match(/\d+/) ? `${height.match(/\d+/)[0]}%` : '50%' }}
        transition={{ delay: delay + 0.3, duration: 1, ease: 'circOut' }}
        className={`w-full ${height} ${color} rounded-t-[3.5rem] border-x-4 border-t-4 border-brand-dark shadow-[16px_-4px_0px_0px_rgba(0,0,0,0.1)] flex flex-col items-center justify-start pt-12 relative`}
      >
        <div className="absolute -top-14 drop-shadow-xl scale-[1.5]">
          {icon}
        </div>
        <div className="text-[10rem] font-black text-white/30 select-none leading-none mt-4">{rank}</div>
      </motion.div>
    </motion.div>
  );
}

function LobbyMetric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: 'light' | 'warm' | 'dark';
}) {
  const toneClass =
    tone === 'dark'
      ? 'bg-brand-dark text-white border-brand-dark'
      : tone === 'warm'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : 'bg-white text-brand-dark border-brand-dark';

  return (
    <div className={`rounded-[1.5rem] border-2 p-4 min-h-[128px] ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
        <div>{icon}</div>
      </div>
      <p className="text-2xl font-black break-words leading-none">{value}</p>
    </div>
  );
}

function HostStageMetric({
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
      ? 'bg-brand-dark text-white border-brand-dark'
      : tone === 'warm'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : 'bg-white text-brand-dark border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]';

  return (
    <div className={`rounded-[1.4rem] border-2 p-4 min-h-[94px] ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-2">{label}</p>
      <p className="text-2xl font-black break-words leading-tight">{value}</p>
    </div>
  );
}

function HostInsightCard({
  title,
  value,
  body,
  secondaryBody,
  accent,
  compact = false,
}: {
  title: string;
  value?: string;
  body: string;
  secondaryBody?: string;
  accent: 'indigo' | 'amber' | 'emerald';
  compact?: boolean;
}) {
  const accentClass =
    accent === 'amber'
      ? 'border-brand-dark bg-brand-yellow text-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A]'
      : accent === 'emerald'
        ? 'border-brand-dark bg-emerald-50 text-emerald-900 shadow-[8px_8px_0px_0px_#10b98144]'
        : 'border-brand-dark bg-brand-bg text-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A]';

  return (
    <div className={`${compact ? 'p-3 rounded-[1.2rem]' : 'p-5 rounded-[1.6rem]'} border-2 ${accentClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-1">{title}</p>
      {value && <p className={`${compact ? 'text-2xl' : 'text-3xl'} font-black leading-none mb-2`}>{value}</p>}
      <p className={`${compact ? 'text-sm' : 'text-base'} font-bold leading-snug`}>{body}</p>
      {secondaryBody && !compact ? <p className="mt-3 text-sm font-medium opacity-80">{secondaryBody}</p> : null}
    </div>
  );
}

function HostPhaseNotice({
  message,
}: {
  message: { tone: 'error' | 'info'; text: string };
}) {
  const isError = message.tone === 'error';
  return (
    <div
      className={`rounded-[1.4rem] border-2 px-4 py-3 font-black flex items-center gap-3 ${
        isError
          ? 'bg-rose-50 border-rose-400 text-rose-700'
          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
      }`}
    >
      {isError ? <AlertTriangle className="w-5 h-5 flex-shrink-0" /> : <Clock className="w-5 h-5 flex-shrink-0" />}
      <span>{message.text}</span>
    </div>
  );
}

function JoinStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-3">
      <p className="font-black mb-1">{title}</p>
      <p className="font-medium text-brand-dark/65 text-sm">{body}</p>
    </div>
  );
}

function LobbyParticipantCard({
  participant,
  subtitle,
}: {
  participant: any;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <Avatar
        nickname={participant.nickname}
        imgClassName="w-12 h-12 rounded-2xl"
        textClassName="hidden"
      />
      <div className="min-w-0">
        <p className="font-black text-lg truncate">{extractNickname(participant.nickname || '')}</p>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{subtitle}</p>
      </div>
    </div>
  );
}

function TipRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
      <p className="font-black mb-1">{title}</p>
      <p className="font-medium text-brand-dark/70">{body}</p>
    </div>
  );
}
