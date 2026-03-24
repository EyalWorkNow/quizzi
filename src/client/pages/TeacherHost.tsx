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
import { getLiveQuestionDensity, formatAnswerSlotLabel } from '../../shared/liveQuestionDensity.ts';

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
  
  // Polling Fallback: If SSE is unstable, we re-fetch participants every 5s while in LOBBY
  useEffect(() => {
    if (!pin || !sessionId || status !== 'LOBBY') return;

    const intervalId = window.setInterval(() => {
      apiFetchJson(`/api/teacher/sessions/pin/${pin}/participants`)
        .then((data) => {
          const nextParticipants = data.participants || [];
          // Only update if count changed or identities are different to avoid unnecessary re-renders
          setParticipants((current) => {
            const hasChanged = 
              current.length !== nextParticipants.length ||
              nextParticipants.some((p: any, idx: number) => !current[idx] || String(current[idx].id) !== String(p.id));
            
            return hasChanged ? nextParticipants : current;
          });
        })
        .catch(err => {
          console.warn('[TeacherHost] Polling fallback failed:', err);
        });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [pin, sessionId, status]);

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
    const lobbyRoomName = pack?.title || 'Live quiz room';
    const lobbyTitle = participants.length > 0 ? 'Room ready for students.' : 'Waiting for students to join.';
    const lobbySubtitle =
      participants.length > 0
        ? `${participants.length} ${participants.length === 1 ? 'student is' : 'students are'} already inside. Keep the PIN visible and launch when the room feels settled.`
        : 'Keep the PIN visible so students can scan the QR or type the code and appear here in real time.';
    const participantSectionCopy =
      participants.length > 0
        ? 'Students appear here the moment they join.'
        : 'Once someone joins, the room will start to populate here automatically.';

    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Header Consistency */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-3 px-4 py-2 sm:px-8">
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate('/teacher/dashboard')}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:border-brand-purple hover:text-brand-purple sm:h-12 sm:w-12"
              >
                <ArrowLeft className="h-6 w-6 text-brand-dark/30" />
              </motion.button>
              <div className="flex h-10 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <span className="text-xs font-black uppercase tracking-widest text-brand-dark/40">Lobby Phase</span>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center justify-center gap-3 lg:flex">
                <LobbyMetric label="Ready" value={participants.length} tone="light" compact />
                <LobbyMetric label="Questions" value={packQuestionCount} tone="light" compact />
            </div>

            <div className="flex items-center justify-end gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleEndSession}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:border-rose-300 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 text-brand-dark/30" />
              </motion.button>
              
              <motion.button
                whileHover={{ scale: participants.length > 0 && !phaseTransitionPending ? 1.03 : 1 }}
                whileTap={{ scale: participants.length > 0 && !phaseTransitionPending ? 0.97 : 1 }}
                onClick={() => updateState('QUESTION_ACTIVE', 0)}
                disabled={participants.length === 0 || phaseTransitionPending}
                className="group relative rounded-2xl border-4 border-brand-dark bg-brand-dark px-6 py-3 text-base font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] flex items-center gap-2 transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#FF5A36] disabled:opacity-50"
              >
                {phaseTransitionPending ? '...' : (participants.length > 0 ? 'Launch Session' : 'Waiting...')}
                <Rocket className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </motion.button>
            </div>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 p-3 sm:p-5 lg:p-6 w-full max-w-[1600px] mx-auto">
          <div className="absolute top-[-8%] left-[-4%] w-96 h-96 border-[4px] border-brand-dark/5 rounded-full pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-6%] w-[460px] h-[460px] border-[4px] border-brand-dark/5 rounded-full pointer-events-none" />
          
          <div className="relative z-10 mx-auto flex h-full w-full min-h-0 flex-col gap-3">
            {hostMessage && <HostPhaseNotice message={hostMessage} />}

            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-[2.5rem] border-4 border-brand-dark bg-white p-4 shadow-[12px_12px_0px_0px_#1A1A1A] sm:p-5 lg:p-6"
            >
              <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-bg px-4 py-4 sm:px-5 sm:py-5">
                    <div className="mb-3 flex flex-wrap gap-2">
                      <span className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                        Room Ready
                      </span>
                      <span className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                        {packQuestionCount} Questions
                      </span>
                      <span className="rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                        {participants.length} {participants.length === 1 ? 'Player' : 'Players'}
                      </span>
                    </div>

                    <p className="max-w-[24ch] text-balance text-[clamp(1.2rem,1.8vw,2rem)] font-black leading-[1.06] tracking-tight">
                      {lobbyRoomName}
                    </p>
                    <h1 className="mt-2 max-w-[12ch] text-balance text-[clamp(2.15rem,3.1vw,3.45rem)] font-black leading-[0.94] tracking-tight">
                      {lobbyTitle}
                    </h1>
                    <p className="mt-2 max-w-[58ch] text-balance text-sm font-bold text-brand-dark/65 sm:text-[0.96rem]">
                      {lobbySubtitle}
                    </p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
                    <div className="rounded-[2.2rem] border-4 border-brand-dark bg-brand-purple p-4 shadow-[10px_10px_0px_0px_#1A1A1A] sm:p-5">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="text-left text-white">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/80">Room PIN</p>
                          <p className="mt-1 text-sm font-bold text-white/80 sm:text-base">
                            Keep this code visible so students can join.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={copyPin}
                          className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-2 font-black text-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A] sm:w-auto"
                        >
                          {isPinCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {isPinCopied ? 'Copied' : 'Copy PIN'}
                        </button>
                      </div>

                      <div className="mx-auto grid max-w-[700px] grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
                        {String(pin || '').split('').map((digit, index) => (
                          <motion.div
                            key={`${digit}-${index}`}
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: index * 0.08 }}
                            className="flex aspect-square min-h-[58px] items-center justify-center rounded-[1rem] border-4 border-brand-dark bg-white text-[clamp(1.8rem,2.8vw,3.5rem)] font-black leading-none shadow-[4px_4px_0px_0px_#1A1A1A] sm:min-h-[72px]"
                          >
                            {digit}
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-[1.8rem] border-4 border-brand-dark bg-brand-yellow p-4 shadow-[8px_8px_0px_0px_#1A1A1A]">
                        <div className="mx-auto flex aspect-square w-full max-w-[160px] items-center justify-center rounded-[1.4rem] border-2 border-brand-dark bg-white p-3">
                          <QRCodeSVG value={joinUrl || String(pin || '')} size={160} level="M" includeMargin />
                        </div>
                        <p className="mt-3 text-center text-sm font-black">Scan to join instantly</p>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="flex min-h-0 flex-col overflow-hidden rounded-[2.2rem] border-2 border-brand-dark bg-white/95 p-4 shadow-[8px_8px_0px_0px_#1A1A1A] sm:p-5">
                  <div className="mb-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-brand-orange">Participants</p>
                        <h2 className="text-[clamp(1.5rem,2vw,2.2rem)] font-black leading-tight">Who is in the room</h2>
                      </div>
                      <div className="w-fit rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-sm font-black shadow-[3px_3px_0px_0px_#1A1A1A]">
                        {participants.length}
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto custom-scrollbar pr-1">
                    {participants.length > 0 ? (
                      isTeamMode ? (
                        <div className="space-y-3">
                          {(Object.entries(groupedParticipants) as Array<[string, any[]]>).map(([teamName, members]) => (
                            <div key={teamName} className="rounded-[1.6rem] border-2 border-brand-dark bg-brand-bg p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">Pod / Team</p>
                                  <p className="text-xl font-black leading-none">{teamName}</p>
                                </div>
                                <div className="rounded-full border-2 border-brand-dark bg-white px-3 py-1.5 text-sm font-black shadow-[3px_3px_0px_0px_#1A1A1A]">
                                  {members.length}
                                </div>
                              </div>
                              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                                <AnimatePresence>
                                  {members.map((participant: any, index: number) => (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.94 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      key={`${participant.nickname}-${index}`}
                                      className="rounded-[1.3rem] border-2 border-brand-dark bg-white p-3 shadow-[3px_3px_0px_0px_#1A1A1A]"
                                    >
                                      <LobbyParticipantCard participant={participant} subtitle="Team Ready" />
                                    </motion.div>
                                  ))}
                                </AnimatePresence>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
                          <AnimatePresence>
                            {participants.map((participant: any, index: number) => (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.94 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.94 }}
                                key={`${participant.nickname}-${index}`}
                                className="rounded-[1.3rem] border-2 border-brand-dark bg-brand-bg p-3 shadow-[3px_3px_0px_0px_#1A1A1A]"
                              >
                                <LobbyParticipantCard participant={participant} subtitle="Ready" />
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )
                    ) : (
                      <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[1.8rem] border-2 border-dashed border-brand-dark/20 bg-brand-bg/70 p-8 text-center">
                        <Sparkles className="w-10 h-10 text-brand-purple/40 mb-4" />
                        <p className="mb-2 text-2xl font-black">No students yet</p>
                        <p className="mx-auto max-w-[24ch] font-bold text-brand-dark/55">
                          Share the PIN above and the room will populate.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-auto">
                    <SessionSoundtrackPlayer
                      status={status}
                      modeConfig={modeConfig}
                      placement="inline"
                    />
                  </div>
                </aside>
              </div>
            </motion.section>
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
    
    const stageCountLabel = isDiscussion
      ? `${Object.keys(studentSelections).length} / ${participants.length} first votes`
      : responseCountLabel;
      
    const currentPrompt = currentQuestion?.prompt || '';
    const liveQuestionDensity = getLiveQuestionDensity({
      prompt: currentPrompt,
      answers: currentAnswers,
      hasImage: Boolean(currentQuestion?.image_url),
    });

    const questionHeroFlexClass = currentQuestion?.image_url
      ? liveQuestionDensity.isUltraDense ? 'flex-[0.7]' : liveQuestionDensity.isDense ? 'flex-[0.85]' : 'flex-[1]'
      : liveQuestionDensity.isUltraDense ? 'flex-[0.9]' : liveQuestionDensity.isDense ? 'flex-[1.1]' : 'flex-[1.4]';
    
    const questionHeroMinHeightClass = liveQuestionDensity.isUltraDense ? 'min-h-[140px]' : 'min-h-[180px]';
    
    const answerGridColumnsClass = liveQuestionDensity.preferredColumns === 3
      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
      : currentAnswers.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1';
      
    const answerGridHeightClass = liveQuestionDensity.isUltraDense
      ? 'min-h-[42vh]'
      : liveQuestionDensity.isDense
        ? 'min-h-[36vh]'
        : 'min-h-[30vh]';

    const answerTextClass = liveQuestionDensity.isUltraDense
      ? 'text-xs sm:text-base lg:text-lg'
      : liveQuestionDensity.isDense
        ? 'text-sm sm:text-lg lg:text-xl'
        : 'text-base sm:text-xl lg:text-3xl';

    const activePromptClassName = liveQuestionDensity.isUltraDense
      ? 'text-[clamp(1.25rem,1.6vw,2.1rem)]'
      : liveQuestionDensity.isDense
        ? 'text-[clamp(1.4rem,2vw,2.6rem)]'
        : currentPrompt.length > 140
          ? 'text-[clamp(1.6rem,2.4vw,3.2rem)]'
          : 'text-[clamp(2.2rem,3.4vw,4.2rem)]';

    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Header */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-3 px-4 py-2 sm:px-8">
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleEndSession}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:border-rose-300 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6" />
              </motion.button>
              <div className="flex flex-col">
                 <span className="text-[10px] font-black uppercase tracking-widest text-brand-dark/30">Session PIN</span>
                 <span className="text-lg font-black leading-none">{pin}</span>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center justify-center gap-3 md:flex">
              <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 py-2 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <span className="text-xs font-black uppercase text-brand-orange">Q{questionIndex + 1}</span>
                <span className="h-4 w-[2px] bg-brand-dark/10" />
                <span className="text-sm font-black">{pack?.title}</span>
              </div>
              <div className={`rounded-2xl border-2 border-brand-dark px-4 py-2 text-xs font-black uppercase tracking-widest shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
                {gameMode.label}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end mr-2">
                 <span className="text-[10px] font-black uppercase tracking-widest text-brand-dark/30">Submissions</span>
                 <span className="text-lg font-black leading-none text-brand-purple">{stageCountLabel}</span>
              </div>
              <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-14">
                <Clock className={`h-5 w-5 ${phaseTimeLeft <= 10 ? 'text-rose-500 animate-pulse' : 'text-brand-orange'}`} />
                <span className={`text-xl font-black ${phaseTimeLeft <= 10 ? 'text-rose-600' : ''}`}>{phaseTimeLeft}s</span>
              </div>
              <motion.button
                whileHover={{ scale: phaseTransitionPending ? 1 : 1.03 }}
                whileTap={{ scale: phaseTransitionPending ? 1 : 0.97 }}
                onClick={() => updateState(nextStatus, questionIndex)}
                disabled={phaseTransitionPending}
                className="rounded-2xl border-4 border-brand-dark bg-brand-dark px-6 py-3 text-base font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#FF5A36] disabled:opacity-50 sm:px-8"
              >
                {phaseTransitionPending ? '...' : nextButtonLabel}
              </motion.button>
            </div>
          </div>
        </div>
        <div className="relative flex-1 min-h-0 flex flex-col p-2 sm:p-4 lg:p-5 gap-2 sm:gap-4 overflow-hidden w-full max-w-[1600px] mx-auto">
          
          {/* Status Overlay Notifications */}
          <div className="pointer-events-none absolute right-6 top-6 z-40 space-y-3 sm:right-10">
            <AnimatePresence>
              {Array.from(focusAlerts).map((nickname) => (
                <motion.div
                  key={nickname}
                  initial={{ x: 100, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 100, opacity: 0 }}
                  className="flex items-center gap-4 rounded-[1.5rem] border-4 border-brand-dark bg-brand-orange p-3 sm:p-4 font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A]"
                >
                  <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
                  <span className="text-sm sm:text-lg">{extractNickname(nickname as string)} lost focus!</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Unified Question Hero Area - Density Aware */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative ${questionHeroFlexClass} ${questionHeroMinHeightClass} min-h-0 w-full rounded-[2.5rem] sm:rounded-[3rem] border-4 border-brand-dark bg-white shadow-[8px_8px_0px_0px_#1A1A1A] overflow-hidden`}
          >
            {currentQuestion?.image_url && (
              <div className="absolute inset-0 z-0">
                 <img 
                   src={currentQuestion.image_url} 
                   alt={currentPrompt} 
                   className="w-full h-full object-cover" 
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/95 via-brand-dark/30 to-transparent" />
              </div>
            )}
            
            <div className={`relative z-10 flex h-full w-full flex-col items-center justify-center ${
              liveQuestionDensity.isUltraDense ? 'p-4 sm:p-6' : 'p-6 sm:p-10 lg:p-14'
            }`}>
               <div className={`w-full max-w-5xl rounded-[2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] ${
                 currentQuestion?.image_url ? 'bg-white/95 backdrop-blur-md' : 'bg-brand-bg/50'
               } ${liveQuestionDensity.isUltraDense ? 'p-4 sm:p-6 lg:p-8' : 'p-6 sm:p-10 lg:p-12'}`}>
                  <h2 className={`${activePromptClassName} text-balance font-black leading-[1.05] tracking-tight text-brand-dark text-center`}>
                    {currentPrompt}
                  </h2>
               </div>
            </div>
          </motion.div>

          {/* Clean Answers Grid - Optimized for compression */}
          <motion.div 
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className={`grid flex-1 min-h-0 ${answerGridHeightClass} w-full gap-3 sm:gap-4 auto-rows-fr ${answerGridColumnsClass}`}
          >
            {currentAnswers.map((ans: string, i: number) => {
              const selectionCount = Object.values(studentSelections).filter((idx) => idx === i).length;
              const selectionPct = participants.length > 0 ? Math.round((selectionCount / participants.length) * 100) : 0;
              const toneColor = getReplayChoiceColor(i);

              return (
                <div
                  key={i}
                  className={`group relative flex h-full flex-col overflow-hidden rounded-[1.5rem] sm:rounded-[2rem] border-[3px] sm:border-4 border-brand-dark transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none shadow-[6px_6px_0px_0px_#1A1A1A] ${
                    isDiscussion ? 'bg-brand-dark text-white' : 'bg-white text-brand-dark'
                  } ${liveQuestionDensity.isUltraDense ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}
                >
                  <div className="relative z-10 flex h-full gap-3 items-center">
                    <div className={`flex ${
                      liveQuestionDensity.isUltraDense ? 'h-9 w-9 text-base' : 'h-12 w-12 text-xl'
                    } shrink-0 items-center justify-center rounded-xl border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A] ${
                      isDiscussion ? 'bg-white/10' : toneColor
                    }`}>
                      {formatAnswerSlotLabel(i)}
                    </div>
                    
                    <div className="flex-1 flex items-center justify-center px-1 min-w-0">
                       <span className={`block flex-1 break-words font-black leading-tight ${liveQuestionDensity.isUltraDense ? 'text-xs sm:text-sm line-clamp-3' : answerTextClass}`}>
                          {ans}
                       </span>
                    </div>

                    <div className="flex flex-col items-end shrink-0">
                       <span className={`${
                         liveQuestionDensity.isUltraDense ? 'text-lg' : 'text-2xl'
                       } font-black ${isDiscussion ? 'text-brand-yellow' : 'text-brand-purple'}`}>
                         {selectionPct}%
                       </span>
                       <span className="text-[9px] font-black uppercase tracking-widest opacity-40">
                         {selectionCount} votes
                       </span>
                    </div>
                  </div>
                  
                  {/* Subtle Progress Background - Smaller in dense mode */}
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${selectionPct}%` }}
                    className={`absolute bottom-0 left-0 ${
                      liveQuestionDensity.isUltraDense ? 'h-1' : 'h-1.5'
                    } opacity-20 ${isDiscussion ? 'bg-brand-yellow' : 'bg-brand-purple'}`}
                  />
                </div>
              );
            })}
          </motion.div>

          {/* Integrated Insights / Context Footer */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-brand-dark/5">
             <div className="flex items-center gap-6">
                {liveHostInsights.primaryCue ? (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full animate-pulse ${liveHostInsights.primaryCue.tone === 'warning' ? 'bg-brand-yellow' : 'bg-emerald-500'}`} />
                    <span className="text-xs font-black uppercase text-brand-dark/60">{liveHostInsights.primaryCue.title}</span>
                  </div>
                ) : (
                  <div className="text-xs font-black uppercase text-brand-dark/30 tracking-[0.2em]">Mastery Insight active</div>
                )}
             </div>
             
             <div className="flex items-center gap-4">
                <div className="h-4 w-[1px] bg-brand-dark/10" />
                <div className="flex items-center gap-2 text-brand-dark/40 font-bold text-xs italic truncate max-w-md">
                   {currentQuestion?.explanation || currentPrompt}
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  }


  if (status === 'QUESTION_REVEAL') {
    const currentPrompt = currentQuestion?.prompt || '';
    const liveQuestionDensity = getLiveQuestionDensity({
      prompt: currentPrompt,
      explanation: currentQuestion?.explanation || currentAnswers[correctIndex],
      answers: currentAnswers,
      hasImage: Boolean(currentQuestion?.image_url),
    });

    const questionHeroFlexClass = liveQuestionDensity.isUltraDense ? 'flex-[0.28]' : 'flex-[0.5]';
    const answerGridHeightClass = liveQuestionDensity.isUltraDense ? 'max-h-[62vh]' : 'max-h-[52vh]';
    
    const answerGridColumnsClass = liveQuestionDensity.preferredColumns === 3
      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
      : currentAnswers.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1';

    const totalVotes = Object.keys(studentSelections).length;
    const correctVotes = Object.values(studentSelections).filter(idx => idx === currentQuestion?.correct_index).length;
    const accuracyPct = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;
    const correctIndex = currentQuestion?.correct_index ?? -1;
    
    const answerSelectionSummary = currentAnswers.reduce((acc: any, _, idx: number) => {
      const count = Object.values(studentSelections).filter(v => v === idx).length;
      acc[idx] = {
        count,
        pct: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
      };
      return acc;
    }, {});

    const answerTextClass = liveQuestionDensity.isUltraDense
      ? 'text-sm sm:text-lg'
      : liveQuestionDensity.isDense
        ? 'text-base sm:text-xl'
        : 'text-lg sm:text-2xl';

    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Header Consistency */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-3 px-4 py-2 sm:px-8">
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleEndSession}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:border-rose-300 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 text-brand-dark/30" />
              </motion.button>
              <div className="flex h-10 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <span className="text-xs font-black uppercase tracking-widest text-brand-dark/40">Results Phase</span>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center justify-center gap-3 lg:flex">
              <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 py-2 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <span className="text-xs font-black uppercase text-brand-dark/40">Class Accuracy</span>
                <span className={`text-lg font-black ${accuracyPct >= 70 ? 'text-emerald-600' : accuracyPct >= 40 ? 'text-brand-orange' : 'text-rose-500'}`}>
                  {accuracyPct}%
                </span>
              </div>
              <HostStageMetric label="Correct" value={correctVotes} tone="light" compact />
              <HostStageMetric label="Total" value={totalVotes} tone="light" compact />
            </div>

            <div className="flex items-center justify-end gap-3">
              <motion.button
                whileHover={{ scale: phaseTransitionPending ? 1 : 1.03 }}
                whileTap={{ scale: phaseTransitionPending ? 1 : 0.97 }}
                onClick={() => updateState('LEADERBOARD', questionIndex)}
                disabled={phaseTransitionPending}
                className="group relative rounded-2xl border-4 border-brand-dark bg-brand-dark px-6 py-3 text-base font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] flex items-center gap-2 transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_#FF5A36] disabled:opacity-50"
              >
                {phaseTransitionPending ? '...' : 'Next Phase'}
                <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </motion.button>
            </div>
          </div>
        </div>

      <div className="relative flex-1 min-h-0 flex flex-col p-2 sm:p-4 lg:p-5 gap-2 sm:gap-4 overflow-hidden w-full max-w-[1600px] mx-auto">
          
          {/* Simplified Emerald Unified Hero */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative ${questionHeroFlexClass} min-h-0 w-full rounded-[1.5rem] sm:rounded-[2rem] border-4 border-emerald-600 bg-emerald-500 shadow-[6px_6px_0px_0px_#064e3b] flex flex-col items-center justify-center overflow-hidden p-6 sm:p-10`}
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '24px 24px'
            }}
          >
            <div className="relative z-10 w-full max-w-5xl flex flex-col items-center text-center">
              <p className={`${
                liveQuestionDensity.isUltraDense ? 'text-lg sm:text-xl' : 'text-2xl sm:text-4xl'
              } font-black leading-tight text-white tracking-tight drop-shadow-md overflow-y-auto custom-scrollbar-thin max-h-[30vh]`}>
                "{currentQuestion?.explanation || currentAnswers[correctIndex]}"
              </p>
              <div className="absolute -bottom-2 -right-2 opacity-10">
                 <CheckCircle2 className="w-32 h-32 text-white" />
              </div>
            </div>
          </motion.div>

          {/* Answer Distribution Grid - Optimized staggered layout */}
          <div className={`grid flex-1 min-h-0 ${answerGridHeightClass} w-full gap-2 sm:gap-4 auto-rows-fr ${answerGridColumnsClass}`}>
            {currentAnswers.map((choice: string, i: number) => {
              const isCorrect = i === correctIndex;
              const choiceResult = answerSelectionSummary[i] || { count: 0, pct: 0 };
              const selectionPct = choiceResult.pct;

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + (i * 0.08) }}
                  className={`group relative flex items-center justify-between overflow-hidden rounded-[2.5rem] border-2 transition-all h-[4.5rem] sm:h-[5.8rem] px-5 sm:px-8 ${
                    isCorrect 
                      ? 'border-brand-dark bg-emerald-500 text-white shadow-[4px_4px_0px_0px_#1A1A1A]' 
                      : 'border-brand-dark/10 bg-gray-100 text-brand-dark shadow-[2px_2px_0px_0px_rgba(0,0,0,0.05)]'
                  }`}
                >
                   {/* Centered Answer Text (Left-Center) */}
                   <div className="flex-1 flex items-center justify-center text-center mr-6 sm:mr-10 min-w-0">
                      <p className={`font-black leading-tight break-words ${
                        choice.length > 50 ? 'text-[10px] sm:text-xs' : 
                        choice.length > 30 ? 'text-xs sm:text-sm' : 
                        'text-sm sm:text-lg lg:text-2xl'
                      }`}>
                        {choice}
                      </p>
                   </div>

                   {/* Right Metrics Pill */}
                   <div className={`flex shrink-0 items-center justify-center px-4 py-1.5 min-w-[3.5rem] sm:min-w-[4.8rem] rounded-xl border-2 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.05)] bg-white ${
                     isCorrect ? 'border-emerald-700/30 text-emerald-600' : 'border-brand-dark/10 text-brand-dark/40'
                   }`}>
                      <span className="text-base sm:text-xl">{selectionPct}%</span>
                   </div>
                </motion.div>
              );
            })}
          </div>

          {/* Background Prompt Context Integration */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-brand-dark/5 mt-auto">
             <div className="flex items-center gap-4">
                <span className="text-[10px] font-black uppercase text-brand-dark/30 tracking-[0.3em] whitespace-nowrap">Original Prompt</span>
                <div className="h-4 w-[1.5px] bg-brand-dark/10" />
                <div className="text-sm font-bold text-brand-dark/50 truncate italic max-w-2xl">{currentPrompt}</div>
             </div>
             
             <div className="flex items-center gap-3 text-brand-dark/20 text-[10px] font-black uppercase tracking-widest">
                <span>Apex Phase: Results</span>
                <div className="h-1 w-1 rounded-full bg-brand-dark/20" />
                <span>Quizzi Live</span>
             </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    const totalVotes = Object.keys(studentSelections).length;
    const correctVotes = Object.values(studentSelections).filter(idx => idx === currentQuestion?.correct_index).length;
    const accuracyPct = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;

    const isLast = questionIndex >= (pack?.questions?.length || 0) - 1;

    return (
      <div className="game-viewport-shell flex flex-col h-screen overflow-hidden text-brand-dark bg-brand-bg">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        {/* Cinematic Header Consistency */}
        <div className="z-30 shrink-0 border-b-4 border-brand-dark bg-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleEndSession}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-brand-dark/10 bg-white shadow-[2px_2px_0px_0px_#1A1A1A] transition-all hover:border-rose-300 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 text-brand-dark/30" />
              </motion.button>
              <div className="flex h-11 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <span className="text-xs font-black uppercase tracking-widest text-brand-dark/40">
                   {isLast ? 'Final Standings' : 'Current Standings'}
                 </span>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center justify-center gap-3 md:flex">
              <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 py-2 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <span className="text-xs font-black uppercase text-brand-orange">Q{questionIndex + 1}/{pack?.questions?.length}</span>
              </div>
              <div className={`rounded-2xl border-2 border-brand-dark px-4 py-2 text-xs font-black uppercase tracking-widest shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
                {gameMode.label}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isLast && (
                <motion.button
                  whileHover={{ scale: isCreatingPersonalizedGames ? 1 : 1.03 }}
                  whileTap={{ scale: isCreatingPersonalizedGames ? 1 : 0.97 }}
                  onClick={() => void handleCreatePersonalizedGames()}
                  disabled={isCreatingPersonalizedGames}
                  className="hidden sm:flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-brand-yellow px-5 py-2.5 text-sm font-black shadow-[4px_4px_0px_0px_#1A1A1A] disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {isCreatingPersonalizedGames ? 'Building...' : 'Personal Games'}
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: phaseTransitionPending ? 1 : 1.03 }}
                whileTap={{ scale: phaseTransitionPending ? 1 : 0.97 }}
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
                className={`rounded-2xl border-4 border-brand-dark px-6 py-3 text-base font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] flex items-center gap-2 disabled:opacity-50 transition-all ${
                  isLast ? 'bg-emerald-600 shadow-[6px_6px_0px_0px_#065f46] hover:shadow-[8px_8px_0px_0px_#065f46]' : 'bg-brand-dark hover:shadow-[8px_8px_0px_0px_#FF5A36]'
                }`}
              >
                {phaseTransitionPending ? '...' : isLast ? 'End & Analyze' : 'Next Question'}
                <ChevronRight className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col p-2 sm:p-4 lg:p-5 gap-2 sm:gap-4 overflow-hidden w-full max-w-[1540px] mx-auto">
          
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="shrink-0 flex flex-col items-center"
          >
             <div className="mb-2 flex items-center gap-3">
                <span className="h-[2px] w-12 bg-brand-purple/20" />
                <span className="text-xs font-black uppercase tracking-[0.4em] text-brand-purple">Performance Board</span>
                <span className="h-[2px] w-12 bg-brand-purple/20" />
             </div>
             <h2 className="text-4xl sm:text-5xl lg:text-7xl font-black text-brand-dark tracking-tighter text-center">
               {isLast ? 'The Winners Circle' : 'Leaderboard'}
             </h2>
          </motion.div>

          <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-6">
             {/* Left Column: Metrics and Insights */}
             <div className="hidden lg:flex flex-col gap-6 w-80 shrink-0 mt-4">
                <div className="rounded-[2.5rem] border-4 border-brand-dark bg-white p-6 shadow-[8px_8px_0px_0px_#1A1A1A]">
                   <p className="text-[10px] font-black uppercase tracking-widest text-brand-dark/40 mb-4">Class Pulse</p>
                   <div className="space-y-4">
                      <div className="flex items-end justify-between">
                         <span className="text-sm font-bold text-brand-dark/60">Success Rate</span>
                         <span className="text-2xl font-black text-brand-purple">{accuracyPct}%</span>
                      </div>
                      <div className="h-2 w-full bg-brand-bg rounded-full overflow-hidden">
                         <div className="h-full bg-brand-purple" style={{ width: `${accuracyPct}%` }} />
                      </div>
                   </div>
                </div>

                <div className="flex-1 rounded-[2.5rem] border-4 border-brand-dark bg-brand-orange/5 p-6 shadow-[8px_8px_0px_0px_#FF5A36] border-dashed">
                   <p className="text-[10px] font-black uppercase tracking-widest text-brand-orange mb-4">Host Tip</p>
                   <p className="text-sm font-black leading-relaxed text-brand-dark/80 italic">
                     "Most students struggled with Choice B. Consider a quick revision before the next pack!"
                   </p>
                </div>
             </div>              {/* Right Column/Main Content: The Board */}
              <div className="flex-1 min-h-0 flex flex-col">
                 <div className="flex-1 min-h-0 w-full overflow-y-auto pr-2 custom-scrollbar">
                    {participants.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-[3rem] border-4 border-brand-dark border-dashed bg-white/50 p-12">
                         <div className="text-center">
                            <Users className="mx-auto h-16 w-16 text-brand-dark/10 mb-4" />
                            <p className="text-xl font-black text-brand-dark/30">Waiting for data sync...</p>
                         </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-8 pb-12">
                         {/* Winners Podium Section */}
                         <div className="flex flex-col items-center justify-center gap-4 lg:flex-row lg:items-end lg:gap-8 lg:px-4 py-8">
                            {/* 2nd Place */}
                            {participants.sort((a, b) => (b.score || 0) - (a.score || 0))[1] && (
                              <PodiumStep
                                participant={participants.sort((a, b) => (b.score || 0) - (a.score || 0))[1]}
                                rank={2}
                                height="h-32 sm:h-48"
                                delay={0.2}
                                color="bg-zinc-200"
                                icon={<div className="bg-zinc-100 p-2 rounded-xl border-2 border-brand-dark shadow-sm"><Medal className="w-8 h-8 text-zinc-400" /></div>}
                              />
                            )}
                            
                            {/* 1st Place */}
                            {participants.sort((a, b) => (b.score || 0) - (a.score || 0))[0] && (
                              <PodiumStep
                                participant={participants.sort((a, b) => (b.score || 0) - (a.score || 0))[0]}
                                rank={1}
                                height="h-44 sm:h-64"
                                delay={0}
                                color="bg-brand-yellow"
                                icon={<div className="bg-white p-3 rounded-2xl border-4 border-brand-dark shadow-xl"><Trophy className="w-12 h-12 text-brand-yellow-dark" /></div>}
                                isWinner={true}
                              />
                            )}

                            {/* 3rd Place */}
                            {participants.sort((a, b) => (b.score || 0) - (a.score || 0))[2] && (
                              <PodiumStep
                                participant={participants.sort((a, b) => (b.score || 0) - (a.score || 0))[2]}
                                rank={3}
                                height="h-24 sm:h-36"
                                delay={0.4}
                                color="bg-orange-200"
                                icon={<div className="bg-orange-50 p-2 rounded-xl border-2 border-brand-dark shadow-sm"><Award className="w-7 h-7 text-orange-400" /></div>}
                              />
                            )}
                         </div>

                         {/* The Rest of the Leaderboard */}
                         <div className="space-y-3">
                            <div className="flex items-center gap-3 px-4 mb-4">
                               <span className="h-[2px] w-6 bg-brand-dark/10" />
                               <span className="text-[10px] font-black uppercase tracking-widest text-brand-dark/30">Challengers Circle</span>
                               <span className="h-[2px] w-6 bg-brand-dark/10" />
                            </div>
                            
                            {participants.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(3, 12).map((p, i) => (
                               <motion.div
                                 key={p.id}
                                 initial={{ x: -20, opacity: 0 }}
                                 animate={{ x: 0, opacity: 1 }}
                                 transition={{ delay: (i + 3) * 0.05 }}
                                 className="flex items-center gap-4 rounded-3xl border-4 border-brand-dark p-4 sm:p-5 shadow-[6px_6px_0px_0px_#1A1A1A] bg-white transition-all hover:translate-x-1"
                               >
                                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-brand-dark bg-brand-bg font-black text-xl text-brand-dark/30 shadow-[3px_3px_0px_0px_#1A1A1A]">
                                    {i + 4}
                                  </div>
                                  
                                  <div className="flex-1 min-w-0">
                                     <div className="flex items-center gap-3">
                                        <Avatar nickname={p.nickname} imgClassName="h-10 w-10 rounded-xl" />
                                        <div className="flex flex-col min-w-0">
                                           <span className="text-xl font-black truncate">{extractNickname(p.nickname)}</span>
                                           <span className="text-xs font-bold text-brand-dark/40 uppercase tracking-widest">{p.correctCount || 0} Correct</span>
                                        </div>
                                     </div>
                                  </div>

                                  <div className="flex flex-col items-end">
                                     <span className="text-3xl font-black tracking-tighter">
                                       {p.score || 0}
                                     </span>
                                     <span className="text-[10px] font-black uppercase tracking-widest opacity-30">Points</span>
                                  </div>
                               </motion.div>
                            ))}
                         </div>
                      </div>
                    )}
                 </div>
              </div>
          </div>

          {/* Personalized Games Success Banner */}
          {isLast && personalizedGamesSummary && (
             <motion.div
               initial={{ y: 50, opacity: 0 }}
               animate={{ y: 0, opacity: 1 }}
               className="shrink-0 rounded-[2.5rem] border-4 border-emerald-500 bg-emerald-50 p-6 shadow-[8px_8px_0px_0px_#059669]"
             >
                <div className="flex items-center justify-between gap-6">
                   <div className="flex items-center gap-4">
                      <div className="bg-emerald-500 text-white p-3 rounded-2xl shadow-lg">
                         <Sparkles className="w-6 h-6" />
                      </div>
                      <div>
                         <h3 className="text-xl font-black text-emerald-900 leading-none mb-1">Adaptive Engine Success</h3>
                         <p className="text-sm font-bold text-emerald-700/70">
                           {personalizedGamesSummary.createdCount} new personal games ready for your students.
                         </p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                      <span className="bg-white border-2 border-emerald-200 px-4 py-1.5 rounded-full text-xs font-black text-emerald-800">
                        {personalizedGamesSummary.createdCount} Created
                      </span>
                   </div>
                </div>
             </motion.div>
          )}
        </div>
      </div>
    );
  }


  if (status === 'ENDED') {
    return (
      <div className="game-viewport-shell flex h-screen flex-col items-center justify-center overflow-hidden bg-brand-bg p-6 text-brand-dark">
        <SessionSoundtrackPlayer status={status} modeConfig={modeConfig} />
        
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative w-full max-w-2xl rounded-[3rem] border-4 border-brand-dark bg-white p-10 text-center shadow-[16px_16px_0px_0px_#1A1A1A] sm:p-16"
        >
          <div className="absolute -top-12 left-1/2 -translate-x-1/2">
             <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border-4 border-brand-dark bg-brand-yellow shadow-[6px_6px_0px_0px_#1A1A1A]">
                <Trophy className="h-12 w-12 text-brand-orange" />
             </div>
          </div>

          <div className="mt-8 mb-6">
             <div className="mb-2 flex items-center justify-center gap-3">
                <span className="h-[2px] w-8 bg-brand-orange/30" />
                <span className="text-xs font-black uppercase tracking-[0.3em] text-brand-orange">Mission Accomplished</span>
                <span className="h-[2px] w-8 bg-brand-orange/30" />
             </div>
             <h2 className="text-4xl font-black tracking-tight sm:text-6xl">Game Complete</h2>
          </div>

          <p className="mx-auto mb-10 max-w-md text-lg font-bold leading-relaxed text-brand-dark/50">
            Quizzi is wrapping up the classroom session and preparing your detailed mastery analytics.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate(`/teacher/analytics/class/${sessionId}`)}
              className="rounded-2xl border-4 border-brand-dark bg-brand-dark px-8 py-4 text-lg font-black text-white shadow-[6px_6px_0px_0px_#FF5A36] transition-all hover:shadow-[8px_8px_0px_0px_#FF5A36]"
            >
              Open Analytics
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/teacher/dashboard')}
              className="rounded-2xl border-4 border-brand-dark bg-white px-8 py-4 text-lg font-black shadow-[6px_6px_0px_0px_#1A1A1A] transition-all"
            >
              Dashboard
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  console.warn('[TeacherHost] Unhandled state reached.', { status, pin, sessionId, packId });
  return (
    <div className="game-viewport-shell flex h-screen flex-col items-center justify-center overflow-hidden bg-brand-bg p-6">
      <div className="w-full max-w-lg rounded-[2.5rem] border-4 border-brand-dark bg-white p-10 text-center shadow-[12px_12px_0px_0px_#1A1A1A]">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-brand-dark bg-rose-100">
           <AlertTriangle className="h-8 w-8 text-rose-600" />
        </div>
        <h2 className="mb-4 text-3xl font-black tracking-tight">Something went wrong</h2>
        <p className="mb-8 font-bold leading-relaxed text-brand-dark/50 italic">
          We encountered an unfamiliar state. Let's get you back on track.
        </p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => window.location.reload()}
            className="w-full rounded-2xl border-4 border-brand-dark bg-brand-orange py-4 text-lg font-black text-white shadow-[4px_4px_0px_0px_#1A1A1A]"
          >
            {t('dash.action.refresh')}
          </button>
          <button 
            onClick={() => navigate('/teacher/dashboard')}
            className="w-full rounded-2xl border-4 border-brand-dark bg-white py-4 text-lg font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
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
          particleCount: 200,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#FF5A36', '#B488FF', '#FFD233', '#emerald-400']
        });
      }, delay * 1000 + 1000);
      return () => clearTimeout(timer);
    }
  }, [isWinner, delay]);

  const nickname = participant.nickname || '';

  return (
    <motion.div 
      initial={{ y: 400, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: delay * 0.4, duration: 1.2, type: 'spring', bounce: 0.25 }}
      className={`flex flex-col items-center justify-end w-full max-w-[280px] h-full relative group pb-1`}
    >
      <div className="mb-4 flex flex-col items-center z-20">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: delay + 1.2, type: 'spring', stiffness: 260 }}
          className="relative"
        >
          {isWinner && (
            <motion.div
              animate={{ y: [0, -8, 0], rotate: [0, 5, -5, 0] }}
              transition={{ repeat: Infinity, duration: 4 }}
              className="absolute -top-10 left-1/2 -translate-x-1/2 z-30"
            >
              <Crown className="w-10 h-10 text-brand-yellow drop-shadow-[0_0_15px_rgba(255,210,51,0.6)]" />
            </motion.div>
          )}

          <div className={`w-20 h-20 sm:w-28 sm:h-28 rounded-[2rem] border-4 border-brand-dark bg-white overflow-hidden shadow-2xl ring-4 ${
            isWinner ? 'ring-brand-yellow/30' : 'ring-white/50'
          }`}>
            <Avatar nickname={nickname} imgClassName="w-full h-full object-cover" />
          </div>

          {rank > 0 && (
            <div className={`absolute -bottom-4 -right-4 w-12 h-12 rounded-2xl border-4 border-brand-dark flex items-center justify-center font-black text-xl shadow-[4px_4px_0px_0px_#1A1A1A] z-40 ${
              isWinner ? 'bg-brand-yellow' : 'bg-white'
            }`}>
              {rank}
            </div>
          )}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + 1.4 }}
          className="mt-6 max-w-[200px] sm:max-w-[260px] rounded-2xl border-4 border-brand-dark bg-white px-5 py-2 shadow-[6px_6px_0px_0px_#1A1A1A]"
        >
          <p className="truncate text-base font-black text-brand-dark sm:text-xl">{extractNickname(nickname)}</p>
        </motion.div>
        
        <motion.p 
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 1.6, type: 'spring' }}
          className={`text-2xl sm:text-3xl font-black mt-2 drop-shadow-sm ${isWinner ? 'text-brand-orange' : 'text-brand-purple'}`}
        >
          {participant.score || 0}
        </motion.p>
      </div>

      <motion.div 
        initial={{ height: 0 }}
        animate={{ height: height.match(/\d+/) ? `${height.match(/\d+/)[0]}%` : '50%' }}
        transition={{ delay: delay + 0.6, duration: 1.5, ease: 'circOut' }}
        className={`w-full ${color} rounded-t-[3rem] border-x-4 border-t-4 border-brand-dark shadow-[12px_-4px_0px_0px_rgba(0,0,0,0.1)] flex flex-col items-center justify-start pt-10 sm:pt-14 relative z-10 ${
          rank > 1 ? 'border-dashed' : 'border-solid'
        }`}
      >
        <div className="absolute top-0 right-0 p-4 opacity-5">
           <div className="text-[12rem] font-black leading-none pointer-events-none select-none">{rank}</div>
        </div>
        
        {!isWinner && (
          <div className="absolute -top-6 drop-shadow-xl scale-[1.3] z-20 transition-transform group-hover:scale-[1.4]">
            {icon}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function LobbyMetric({
  label,
  value,
  icon,
  tone,
  compact = false,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  tone: 'light' | 'warm' | 'dark';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'dark'
      ? 'bg-brand-dark text-white border-brand-dark'
      : tone === 'warm'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : 'bg-white text-brand-dark border-brand-dark';

  if (compact) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border-2 px-3 py-1.5 shadow-[2px_2px_0px_0px_#1A1A1A] ${toneClass}`}>
        <p className="text-[10px] font-black uppercase tracking-widest opacity-60">{label}</p>
        <p className="text-lg font-black leading-none">{value}</p>
        {icon && <div className="ml-1 opacity-40">{icon}</div>}
      </div>
    );
  }

  return (
    <div className={`rounded-[1.5rem] border-2 p-4 min-h-[100px] ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
        <div>{icon}</div>
      </div>
      <p className="text-2xl font-black break-words leading-none">{value}</p>
    </div>
  );
}

function ActivePhaseMetricTile({
  label,
  value,
  tone,
  compact = false,
}: {
  label: string;
  value: string | number;
  tone: 'light' | 'warm' | 'dark' | 'success';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'dark'
      ? 'bg-brand-dark text-white border-brand-dark'
      : tone === 'success'
        ? 'bg-emerald-100 text-emerald-900 border-emerald-400 shadow-[2px_2px_0px_0px_#10b98144]'
      : tone === 'warm'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]'
        : 'bg-white text-brand-dark border-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A]';

  return (
    <div className={`rounded-[1rem] border-2 ${
      compact ? 'p-1.5 px-3 min-h-0' : 'p-3 min-h-[70px]'
    } ${toneClass}`}>
      <p className={`${compact ? 'mb-0 text-[10px] inline-block mr-2' : 'mb-1.5 text-[10px]'} font-black uppercase tracking-widest opacity-60`}>{label}</p>
      <p className={`${compact ? 'text-lg inline-block' : 'text-xl sm:text-2xl'} font-black break-words leading-tight`}>{value}</p>
    </div>
  );
}

function HostStageMetric({
  label,
  value,
  tone,
  compact = false,
}: {
  label: string;
  value: string | number;
  tone: 'light' | 'warm' | 'dark';
  compact?: boolean;
}) {
  return <ActivePhaseMetricTile label={label} value={value} tone={tone} compact={compact} />;
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

function LobbyQuickStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: 'light' | 'warm' | 'dark';
}) {
  const toneClass =
    tone === 'dark'
      ? 'border-brand-dark bg-brand-dark text-white shadow-[4px_4px_0px_0px_#1A1A1A]'
      : tone === 'warm'
        ? 'border-brand-dark bg-brand-yellow text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]'
        : 'border-brand-dark bg-white text-brand-dark shadow-[4px_4px_0px_0px_#1A1A1A]';
  const detailClass = tone === 'dark' ? 'text-white/75' : 'text-brand-dark/65';

  return (
    <div className={`rounded-[1.3rem] border-2 p-3.5 ${toneClass}`}>
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="text-base font-black leading-tight sm:text-lg">{value}</p>
      <p className={`mt-1.5 text-sm font-medium leading-snug ${detailClass}`}>{detail}</p>
    </div>
  );
}

function JoinStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.1rem] border-2 border-brand-dark bg-white p-3 shadow-[3px_3px_0px_0px_#1A1A1A]">
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
    <div className="flex items-center gap-3">
      <Avatar
        nickname={participant.nickname}
        imgClassName="w-9 h-9 rounded-[1rem] sm:w-10 sm:h-10"
        textClassName="hidden"
      />
      <div className="min-w-0">
        <p className="truncate text-base font-black">{extractNickname(participant.nickname || '')}</p>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40">{subtitle}</p>
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
