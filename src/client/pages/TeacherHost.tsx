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
    statusRef.current = status;
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
        setStatus(data.status);
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
    const nextStatus = data?.status || 'LOBBY';
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
      status: sessionMeta?.status || status,
      currentQuestionIndex: Number(sessionMeta?.current_question_index ?? questionIndex),
      question: buildRealtimeQuestionPayload(sessionMeta?.status || status, Number(sessionMeta?.current_question_index ?? questionIndex)),
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
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8">
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
      <div className="h-screen max-h-screen overflow-hidden bg-brand-bg text-brand-dark font-sans selection:bg-brand-orange selection:text-white relative">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="absolute top-[-8%] left-[-4%] w-96 h-96 border-[4px] border-brand-dark/5 rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-6%] w-[460px] h-[460px] border-[4px] border-brand-dark/5 rounded-full pointer-events-none" />
        
        <div className="flex flex-col h-full max-w-[1380px] mx-auto px-6 lg:px-10 py-6 relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 shrink-0">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/teacher/dashboard')}>
                <span className="text-brand-orange">Quiz</span>zi
              </div>
              <span className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark font-black text-sm">Live Host Lobby</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/teacher/dashboard')}
                className="w-fit px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A] hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Dashboard
              </button>
              <button
                onClick={handleEndSession}
                className="w-fit px-5 py-3 bg-rose-50 border-2 border-rose-500 text-rose-600 rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#F43F5E] hover:bg-rose-100 transition-colors"
              >
                <XCircle className="w-5 h-5" />
                Close Session
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto custom-scrollbar pr-2 pb-6 space-y-8">
            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.1fr)_360px] gap-8">
              <section className="space-y-8 min-w-0">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-brand-dark text-white rounded-[3rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36] p-8 lg:p-10 overflow-hidden relative"
                >
                  <div className="absolute top-[-40px] right-[-30px] w-56 h-56 bg-white/10 rounded-full" />
                  <div className="absolute bottom-[-35px] right-32 w-28 h-28 bg-brand-yellow/15 rounded-full" />
                  <div className="relative z-10">
                  <div className="flex flex-wrap gap-3 mb-5">
                    <span className="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-xs font-black uppercase tracking-[0.2em]">Pack ready</span>
                    <span className="px-4 py-2 rounded-full bg-brand-yellow text-brand-dark border-2 border-brand-dark text-xs font-black uppercase tracking-[0.2em]">Session #{sessionId || '...'}</span>
                    <span className="px-4 py-2 rounded-full bg-white text-brand-dark border-2 border-brand-dark text-xs font-black uppercase tracking-[0.2em]">{gameMode.label}</span>
                  </div>

                    <h1 className="text-4xl lg:text-5xl font-black leading-[0.95] tracking-tight mb-4">
                      {participants.length > 0 ? 'The room is warming up.' : 'Your live game is waiting for students.'}
                    </h1>
                    <p className="text-lg text-white/75 font-medium max-w-2xl mb-8">
                      Share the PIN, watch students appear in real time, and launch only when the room feels settled.
                    </p>

                    <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark p-6 text-brand-dark mb-6">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Join with PIN or scan</p>
                          <p className="font-bold text-brand-dark/60 text-sm">Students can still type the code, but the QR path now opens the room automatically on their device.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={copyPin}
                            className="px-4 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark font-black text-sm flex items-center gap-2"
                          >
                            {isPinCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {isPinCopied ? 'Copied' : 'Copy PIN'}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-[2rem] border-4 border-brand-dark bg-brand-purple p-6 mb-6 overflow-hidden shadow-[12px_12px_0px_0px_#1A1A1A]">
                        <div className="grid grid-cols-6 gap-3 w-full max-w-[600px] mx-auto">
                          {String(pin || '').split('').map((digit, index) => (
                            <motion.div
                              key={`${digit}-${index}`}
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ delay: index * 0.1 }}
                              className="aspect-square min-h-[70px] rounded-[1.2rem] bg-white border-4 border-brand-dark flex items-center justify-center text-4xl sm:text-5xl font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
                            >
                              {digit}
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_200px] gap-4 items-stretch">
                        <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Join flow</p>
                          <div className="grid grid-cols-3 gap-3">
                            <JoinStep title="1. Scan" body="QR or link." />
                            <JoinStep title="2. Identify" body="Add nickname." />
                            <JoinStep title="3. Wait" body="Appear here." />
                          </div>
                        </div>
                        <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-yellow p-4 flex flex-col items-center justify-center text-center">
                          <div className="rounded-[1rem] border-2 border-brand-dark bg-white p-2 shadow-[2px_2px_0px_0px_#1A1A1A]">
                            <QRCodeSVG value={joinUrl || String(pin || '')} size={110} level="M" includeMargin />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-5 bg-white/10 rounded-[2rem] border border-white/10 p-5 items-center">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-1">Launch control</p>
                        <p className="text-xl font-black">{participants.length > 0 ? `${participants.length} students joined.` : 'Waiting for students...'}</p>
                      </div>
                      <motion.button
                        whileHover={{ scale: participants.length > 0 && !phaseTransitionPending ? 1.03 : 1 }}
                        whileTap={{ scale: participants.length > 0 && !phaseTransitionPending ? 0.98 : 1 }}
                        onClick={() => updateState('QUESTION_ACTIVE', 0)}
                        disabled={participants.length === 0 || phaseTransitionPending}
                        className="px-8 py-4 bg-brand-orange text-white border-4 border-brand-dark rounded-[1.5rem] font-black text-xl flex items-center justify-center gap-3 shadow-[6px_6px_0px_0px_#1A1A1A] disabled:opacity-50"
                      >
                        <Play className="w-5 h-5 fill-current" />
                        {phaseTransitionPending ? 'Launching...' : 'Start Game'}
                      </motion.button>
                    </div>

                    {hostMessage && (
                      <div className="mt-5">
                        <HostPhaseNotice message={hostMessage} />
                      </div>
                    )}
                  </div>
                </motion.div>
              </section>

              <section className="space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="bg-white rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <BarChart3 className="w-5 h-5 text-brand-purple" />
                    <h2 className="text-2xl font-black">Summary</h2>
                  </div>
                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-bg p-4 mb-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Room read</p>
                    <p className="text-xl font-black mb-1">{roomReadTitle}</p>
                    <p className="text-sm font-medium text-brand-dark/70">{roomReadBody}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <LobbyMetric label="Players" value={participants.length} icon={<Users className="w-4 h-4" />} tone="light" />
                    <LobbyMetric label="Questions" value={packQuestionCount} icon={<BookOpen className="w-4 h-4" />} tone="warm" />
                  </div>

                  <div className="rounded-[1.2rem] border-2 border-brand-dark bg-brand-yellow/10 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-orange mb-1">Current pack</p>
                    <p className="text-lg font-black truncate">{pack?.title || 'Loading...'}</p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.09 }}
                  className="bg-brand-yellow rounded-[2.2rem] border-4 border-brand-dark shadow-[8px_8px_0px_0px_#1A1A1A] p-6"
                >
                  <h2 className="text-2xl font-black mb-4">Checklist</h2>
                  <div className="space-y-2">
                    <TipRow title="PIN visible" body="Keep it on screen." />
                    <TipRow title="Roster calm" body="Wait for settles." />
                  </div>
                </motion.div>
              </section>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-8">
              <section className="space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="bg-white rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-7"
                >
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Waiting Room</p>
                      <h2 className="text-3xl font-black">Students joining live</h2>
                    </div>
                    <div className="px-4 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark font-black">
                      {participants.length}
                    </div>
                  </div>

                  {participants.length > 0 ? (
                    isTeamMode ? (
                      <div className="space-y-4">
                        {(Object.entries(groupedParticipants) as Array<[string, any[]]>).map(([teamName, members]) => (
                          <div key={teamName} className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-4">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div>
                                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Pod / Team</p>
                                <p className="text-2xl font-black">{teamName}</p>
                              </div>
                              <div className="px-3 py-2 rounded-full border-2 border-brand-dark bg-white font-black">
                                {members.length}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <AnimatePresence>
                                {members.map((participant: any, index: number) => (
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    key={`${participant.nickname}-${index}`}
                                    className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4"
                                  >
                                    <LobbyParticipantCard
                                      participant={participant}
                                      subtitle={`Seat ${participant.seat_index || index + 1}`}
                                    />
                                  </motion.div>
                                ))}
                              </AnimatePresence>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <AnimatePresence>
                          {participants.map((participant: any, index: number) => (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              key={`${participant.nickname}-${index}`}
                              className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-4"
                            >
                              <LobbyParticipantCard participant={participant} subtitle="Ready in lobby" />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )
                  ) : (
                    <div className="rounded-[2rem] border-2 border-dashed border-brand-dark/20 bg-brand-bg/70 p-12 text-center">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }} className="w-fit mx-auto mb-4">
                        <Sparkles className="w-10 h-10 text-brand-purple/40" />
                      </motion.div>
                      <p className="text-2xl font-black mb-2">No students yet</p>
                      <p className="font-bold text-brand-dark/55">Share the PIN above and the waiting room will populate automatically.</p>
                    </div>
                  )}
                </motion.div>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }



  if (status === 'QUESTION_ACTIVE' || status === 'QUESTION_DISCUSSION' || status === 'QUESTION_REVOTE') {
    const isDiscussion = status === 'QUESTION_DISCUSSION';
    const isRevote = status === 'QUESTION_REVOTE';
    const nextStatus = isDiscussion ? 'QUESTION_REVOTE' : isPeerMode && !isRevote ? 'QUESTION_DISCUSSION' : 'QUESTION_REVEAL';
    const nextButtonLabel = isDiscussion ? 'Open Final Revote' : isPeerMode && !isRevote ? 'Start Discussion' : 'Reveal Answer';
    const stageLabel = isDiscussion ? 'Pod Discussion' : isRevote ? 'Final Revote' : isPeerMode ? 'Silent Vote' : 'Question Live';
    const stageBody = isDiscussion
      ? 'Students compare reasoning inside their pod before the final revote window opens.'
      : isRevote
        ? 'Students can now keep or change their first answer and submit the final version.'
        : isPeerMode
          ? 'This is the first commit round. Students vote privately before they talk.'
          : gameMode.quickSummary;
    const stageCountLabel = isDiscussion
      ? `${Object.keys(studentSelections).length} / ${participants.length} first votes recorded`
      : responseCountLabel;
    return (
      <div className="h-screen max-h-screen bg-brand-bg flex flex-col overflow-hidden font-sans text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="bg-white px-6 py-4 shadow-sm flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b-4 border-brand-dark z-50 shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={handleEndSession}
              className="flex items-center gap-2 text-brand-dark/30 hover:text-rose-500 font-black transition-colors"
            >
              <XCircle className="w-6 h-6" />
              End Game
            </button>
            <div className="text-brand-dark font-black text-xl bg-brand-bg px-5 py-2 rounded-xl border-2 border-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A]">
              Question {questionIndex + 1} of {pack?.questions?.length}
            </div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </div>
            <div className="px-4 py-2 rounded-full bg-brand-dark text-white font-black text-sm border-2 border-brand-dark">
              {stageLabel}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-lg font-black text-brand-dark flex items-center gap-3 bg-white px-5 py-3 rounded-2xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
              <Clock className="w-6 h-6 text-brand-orange" />
              {phaseTimeLeft}s left
            </div>
            <div className="text-lg font-black text-brand-purple flex items-center gap-3 bg-white px-5 py-3 rounded-2xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
              <Users className="w-6 h-6" />
              {stageCountLabel}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: phaseTransitionPending ? 1 : 1.05 }}
            whileTap={{ scale: phaseTransitionPending ? 1 : 0.95 }}
            onClick={() => updateState(nextStatus, questionIndex)}
            disabled={phaseTransitionPending}
            className="bg-brand-dark text-white px-8 py-3 rounded-xl font-black text-lg shadow-[6px_6px_0px_0px_#FF5A36] disabled:opacity-50"
          >
            {phaseTransitionPending ? 'Working...' : nextButtonLabel}
          </motion.button>
        </div>

        {hostMessage && (
          <div className="px-6 pt-4">
            <HostPhaseNotice message={hostMessage} />
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 max-w-7xl mx-auto w-full relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 space-y-2 pointer-events-none z-50">
            <AnimatePresence>
              {Array.from(focusAlerts).map((nickname) => (
                <motion.div
                  key={nickname}
                  initial={{ x: 100, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 100, opacity: 0 }}
                  className="bg-brand-orange text-white px-6 py-3 rounded-2xl border-2 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A] flex items-center gap-3 font-black"
                >
                  <AlertTriangle className="w-5 h-5" />
                  {extractNickname(nickname as string)} lost focus!
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <motion.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full mb-6 rounded-[2.5rem] border-4 border-brand-dark bg-white p-6 sm:p-8 relative overflow-hidden shadow-[12px_12px_0px_0px_#1A1A1A] shrink-0"
          >
            {/* NEW: Engagement Progress Bar */}
            <div className="absolute top-0 left-0 w-full h-3 bg-brand-dark/5">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${participants.length > 0 ? (totalAnswers / participants.length) * 100 : 0}%` }}
                className="h-full bg-brand-purple shadow-[0_0_15px_rgba(155,81,224,0.3)]"
                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
              />
            </div>

            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.2em] ${gameTone.pill}`}>
                    {gameMode.shortLabel}
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-brand-bg text-brand-dark border-2 border-brand-dark text-xs font-black uppercase tracking-[0.2em]">
                    {gameMode.researchCue}
                  </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  {currentQuestion?.image_url && (
                    <QuestionImageCard
                      imageUrl={currentQuestion?.image_url}
                      alt={currentQuestion?.prompt || 'Question image'}
                      className="shrink-0"
                      imgClassName="max-h-[18vh] w-auto rounded-2xl"
                    />
                  )}
                  <h2 className="text-3xl lg:text-5xl font-black text-brand-dark leading-tight tracking-tight">
                    {currentQuestion?.prompt}
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-2 gap-3 min-w-[320px] shrink-0">
                <HostStageMetric label="Timer" value={`${phaseTimeLeft}s`} tone="dark" />
                <HostStageMetric label={isDiscussion ? 'First votes' : isPeerMode && !isRevote ? 'Votes' : 'Answers'} value={isDiscussion ? Object.keys(studentSelections).length : isPeerMode && !isRevote ? Object.keys(studentSelections).length : totalAnswers} tone="light" />
                <HostStageMetric label="Players" value={participants.length} tone="light" />
                <HostStageMetric label="Phase" value={stageLabel} tone="warm" />
              </div>
            </div>
          </motion.div>

          <div className="grid w-full gap-4 mb-6 lg:grid-cols-3 shrink-0">
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

          <div
            className="grid gap-6 w-full"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
          >
            {currentAnswers.map((ans: string, i: number) => {
              const selectionCount = Object.values(studentSelections).filter((idx) => idx === i).length;
              const selectionPct = participants.length > 0 ? Math.round((selectionCount / participants.length) * 100) : 0;
              return (
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.08 }}
                  key={i}
                  className={`rounded-[1.8rem] p-6 sm:p-8 text-2xl lg:text-3xl font-black text-center shadow-[8px_8px_0px_0px_#1A1A1A] flex flex-col items-center justify-center min-h-[140px] lg:min-h-[180px] relative overflow-hidden border-4 ${
                    isDiscussion ? 'bg-brand-dark text-white border-brand-dark' : 'bg-white text-brand-dark border-brand-dark'
                  }`}
                >
                  <div className="absolute top-0 left-0 h-full bg-brand-orange/15" style={{ width: `${selectionPct}%` }} />
                  <div className="relative z-10 w-full">
                    <p className="leading-tight break-words">{ans}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                      <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isDiscussion ? 'bg-white/10 text-white border-white/20' : 'bg-brand-bg text-brand-dark border-brand-dark/10'}`}>
                        {selectionCount}
                      </span>
                      <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isDiscussion ? 'bg-brand-yellow text-brand-dark border-brand-dark' : 'bg-brand-purple text-white border-brand-dark'}`}>
                        {selectionPct}%
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'QUESTION_REVEAL') {
    return (
      <div className="h-screen max-h-screen overflow-hidden bg-brand-bg flex flex-col font-sans text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="bg-white px-8 py-4 shadow-sm flex justify-between items-center border-b-4 border-brand-dark z-50 shrink-0">
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

        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 max-w-7xl mx-auto w-full relative overflow-hidden">
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
            {currentQuestion?.choices.map((choice, i) => {
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
                      <p className={`font-black text-lg lg:text-xl truncate ${isCorrect ? 'text-brand-dark' : 'text-brand-dark/40'}`}>{choice}</p>
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
      <div className="h-screen max-h-screen overflow-hidden bg-brand-bg flex flex-col font-sans text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        <div className="bg-white px-8 py-4 shadow-sm flex justify-between items-center border-b-4 border-brand-dark z-50 shrink-0">
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
            className={`${isLast ? 'bg-emerald-500 shadow-[6px_6px_0px_0px_#064e3b]' : 'bg-brand-dark shadow-[6px_6px_0px_0px_#FF5A36]'} text-white px-10 py-4 rounded-xl font-black text-xl hover:opacity-90 transition-all flex items-center gap-3 disabled:opacity-50`}
          >
            {phaseTransitionPending ? 'Working...' : isLast ? 'End Game & Results' : 'Next Question'} <ChevronRight className="w-8 h-8" />
          </motion.button>
        </div>

        {hostMessage && (
          <div className="px-8 pt-4 shrink-0">
            <HostPhaseNotice message={hostMessage} />
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col items-center justify-start p-6 max-w-[1400px] mx-auto w-full overflow-hidden">
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mb-6 shrink-0"
          >
            <h2 className="text-4xl lg:text-5xl font-black text-brand-dark tracking-tight text-center">
              {isLast ? 'The Winners Circle' : 'Leaderboard'}
            </h2>
          </motion.div>

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
                    <div className="flex flex-row items-end justify-center gap-4 h-[320px] lg:h-[400px]">
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

  console.warn('[TeacherHost] Unhandled game status or state reached. Rendering fallback.', { status, pin, sessionId, packId });
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-8">
      <div className="bg-white rounded-[2rem] border-4 border-brand-dark p-8 shadow-[8px_8px_0px_0px_#1A1A1A] max-w-md text-center">
        <h2 className="text-3xl font-black mb-4">Something went wrong</h2>
        <p className="font-medium text-brand-dark/70 mb-6">
          The game reached an unexpected state ({status}). 
          Try refreshing the page or going back to the dashboard.
        </p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => window.location.reload()}
            className="w-full px-6 py-3 bg-brand-orange text-white border-2 border-brand-dark rounded-full font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
          >
            Refresh Page
          </button>
          <button 
            onClick={() => navigate('/teacher/dashboard')}
            className="w-full px-6 py-3 bg-white border-2 border-brand-dark rounded-full font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
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
        <div className="mt-6 bg-white px-8 py-3 rounded-full border-4 border-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]">
          <p className="text-3xl font-black text-brand-dark whitespace-nowrap">{extractNickname(participant.nickname)}</p>
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
