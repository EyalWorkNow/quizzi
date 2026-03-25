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
import { isPeerInstructionMode, isUntimedMode, resolveSessionQuestionTimeLimit } from '../lib/sessionModeRules.ts';
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
  const timedPhase = activeQuestionSeconds > 0 && phaseTimeLeft > 0;
  const cues: Array<{ tone: 'warning' | 'insight' | 'success'; title: string; body: string }> = [];

  if (!participants) {
    cues.push({
      tone: 'insight',
      title: 'החדר עדיין לא מוכן',
      body: 'כרגע אין תלמידים מחוברים, לכן כדאי להשאיר את הקוד גלוי עד שהחדר יתמלא.',
    });
  } else if (timedPhase && participationPct < 55 && phaseTimeLeft <= secondsThreshold) {
    cues.push({
      tone: 'warning',
      title: 'זוהה היסוס',
      body: 'תלמידים רבים עדיין לא נעלו תשובה. אפשר להוסיף רמז, להאריך את הזמן או להאט מעט לפני החשיפה.',
    });
  }

  if (leader && runnerUp && leader.count > 0 && runnerUp.count > 0 && leader.pct - runnerUp.pct <= 12) {
    cues.push({
      tone: 'insight',
      title: 'החדר מפוצל',
      body: `החדר מתחלק בין ${formatAnswerSlotLabel(leader.index)} לבין ${formatAnswerSlotLabel(runnerUp.index)}. כדאי להזמין את שני הצדדים לנמק לפני החשיפה.`,
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
      title: 'אשכול טעות נפוצה',
      body: `רוב התלמידים נוטים אל ${formatAnswerSlotLabel(leader.index)}, אך זו אינה התשובה הנכונה. מומלץ לעצור ולבדוק את קו החשיבה לפני שממשיכים.`,
    });
  }

  if (
    timedPhase &&
    participants > 0 &&
    participationPct >= 85 &&
    phaseTimeLeft <= Math.max(3, Math.ceil(activeQuestionSeconds * 0.15))
  ) {
    cues.push({
      tone: 'success',
      title: 'אפשר להתקדם',
      body: 'רוב החדר כבר נעל תשובה. אפשר לחשוף בקרוב בלי לאבד הרבה השתתפות.',
    });
  }

  if (cues.length === 0) {
    cues.push({
      tone: 'insight',
      title: status === 'QUESTION_DISCUSSION' ? 'הדיון בעיצומו' : 'מומנטום בריא',
      body:
        status === 'QUESTION_DISCUSSION'
          ? 'הקבוצות משוות עכשיו קווי חשיבה. כדאי להאזין לטיעון חזק מכל צד לפני פתיחת ההצבעה החוזרת.'
          : 'החדר מתקדם בקצב יציב. תן לדפוס המרכזי להתבהר לפני המעבר הבא.',
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
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
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
  const leaderboardRows = React.useMemo(
    () =>
      (Array.isArray(leaderboard) && leaderboard.length ? leaderboard : participants).map((row: any) => {
        const score = Number(row?.score ?? row?.total_score ?? 0);
        const correctCount = Number(row?.correctCount ?? row?.correct_answers ?? row?.correct_count ?? 0);
        const answeredCount = Math.max(
          correctCount,
          Number(
            row?.answeredCount ??
            row?.answersSubmitted ??
            row?.answers_submitted ??
            row?.questions_attempted ??
            row?.attempted_count ??
            row?.total_answers ??
            row?.answered_count ??
            0,
          ),
        );

        return {
          ...row,
          score,
          correctCount,
          answeredCount,
          accuracyPct: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0,
        };
      }),
    [leaderboard, participants],
  );
  const sortedLeaderboardRows = React.useMemo(
    () =>
      [...leaderboardRows].sort((left, right) => {
        const scoreDiff = Number(right?.score || 0) - Number(left?.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const correctDiff = Number(right?.correctCount || 0) - Number(left?.correctCount || 0);
        if (correctDiff !== 0) return correctDiff;
        return String(left?.nickname || '').localeCompare(String(right?.nickname || ''));
      }),
    [leaderboardRows],
  );
  const teamLeaderboardRows = React.useMemo(() => {
    if (Array.isArray(teamBoard) && teamBoard.length) {
      return [...teamBoard]
        .map((row: any) => {
          const score = Number(row?.score ?? row?.total_score ?? row?.points ?? 0);
          const correctCount = Number(row?.correctCount ?? row?.correct_answers ?? row?.correct_count ?? 0);
          const answeredCount = Math.max(
            correctCount,
            Number(
              row?.answeredCount ??
              row?.answersSubmitted ??
              row?.answers_submitted ??
              row?.questions_attempted ??
              row?.attempted_count ??
              row?.total_answers ??
              row?.answered_count ??
              0,
            ),
          );

          return {
            name: String(row?.team_name || row?.name || 'Team'),
            score,
            members: Number(row?.member_count ?? row?.participant_count ?? row?.size ?? 0),
            correctCount,
            answeredCount,
            accuracyPct: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0,
          };
        })
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    }

    const groupedTeams = leaderboardRows.reduce<Record<string, any>>((acc, row: any) => {
      const key = String(row?.team_name || '').trim();
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          name: key,
          score: 0,
          members: 0,
          correctCount: 0,
          answeredCount: 0,
        };
      }
      acc[key].score += Number(row?.score || 0);
      acc[key].members += 1;
      acc[key].correctCount += Number(row?.correctCount || 0);
      acc[key].answeredCount += Number(row?.answeredCount || 0);
      acc[key].accuracyPct = acc[key].answeredCount > 0
        ? Math.round((acc[key].correctCount / acc[key].answeredCount) * 100)
        : 0;
      return acc;
    }, {});

    return Object.values(groupedTeams).sort((left: any, right: any) => Number(right.score || 0) - Number(left.score || 0));
  }, [leaderboardRows, teamBoard]);
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
    setIsLeaderboardLoading(true);
    setLeaderboard([]);
    setTeamBoard([]);
    apiFetchJson(`/api/analytics/class/${sessionId}`)
      .then((analytics) => {
        setLeaderboard(analytics.participants || []);
        setTeamBoard(analytics.teams || []);
      })
      .catch((error: any) => {
        setHostMessage({
          tone: 'error',
          text: error?.message || 'Leaderboard sync failed. Showing the live roster instead.',
        });
      })
      .finally(() => {
        setIsLeaderboardLoading(false);
      });
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
      image_url: question.image_url || '',
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
          className="game-action-button game-action-button--secondary mt-12 px-5 py-3 text-sm sm:text-base"
        >
          <ArrowLeft className="w-5 h-5" />
          חזרה ללוח הבקרה
        </motion.button>
      </div>
    );
  }

  if (status === 'LOBBY') {
    const lobbyRoomName = pack?.title || 'חדר חידון חי';
    const lobbyTitle = participants.length > 0 ? 'החדר מוכן לתלמידים.' : 'ממתין להצטרפות תלמידים.';
    const lobbySubtitle =
      participants.length > 0
        ? `${participants.length} ${participants.length === 1 ? 'תלמיד כבר נמצא בפנים' : 'תלמידים כבר נמצאים בפנים'}. השאר את הקוד גלוי והפעל כשהחדר מרגיש יציב.`
        : 'השאר את הקוד גלוי כדי שתלמידים יוכלו לסרוק את ה־QR או להקליד את הקוד ולהופיע כאן בזמן אמת.';
    const participantSectionCopy =
      participants.length > 0
        ? 'התלמידים מופיעים כאן מיד כשהם מצטרפים.'
        : 'ברגע שמישהו מצטרף, החדר יתחיל להתמלא כאן אוטומטית.';

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
                className="game-icon-button h-10 w-10 hover:border-brand-purple hover:text-brand-purple sm:h-12 sm:w-12"
              >
                <ArrowLeft className="h-6 w-6 opacity-40" />
              </motion.button>
              <div className="flex h-10 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <span className="text-xs font-black uppercase tracking-widest text-brand-dark/40">שלב הלובי</span>
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
                className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 opacity-40" />
              </motion.button>
              
              <motion.button
                whileHover={{ scale: participants.length > 0 && !phaseTransitionPending ? 1.03 : 1 }}
                whileTap={{ scale: participants.length > 0 && !phaseTransitionPending ? 0.97 : 1 }}
                onClick={() => updateState('QUESTION_ACTIVE', 0)}
                disabled={participants.length === 0 || phaseTransitionPending}
                className="game-action-button game-action-button--dark px-6 py-3 text-base"
              >
                {phaseTransitionPending ? '...' : (participants.length > 0 ? 'Launch Session' : 'Waiting...')}
                <Rocket className="w-5 h-5" />
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
                          className="game-action-button game-action-button--yellow w-full px-4 py-2 sm:w-auto"
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
    const isUntimedActivePhase = !isDiscussion && isUntimedMode(gameMode.id, modeConfig);
    const nextStatus = isDiscussion ? 'QUESTION_REVOTE' : isPeerMode && !isRevote ? 'QUESTION_DISCUSSION' : 'QUESTION_REVEAL';
    const nextButtonLabel = isDiscussion ? 'Open Final Revote' : isPeerMode && !isRevote ? 'Start Discussion' : 'Reveal Answer';
    const stageLabel = isDiscussion
      ? 'Pod Discussion'
      : isRevote
        ? 'Final Revote'
        : gameMode.id === 'accuracy_quiz'
          ? 'Accuracy Round'
          : isPeerMode
            ? 'Silent Vote'
            : 'Question Live';
    const phaseTimerLabel = isUntimedActivePhase ? t('game.timer.untimed') : `${phaseTimeLeft}s`;
    const phaseTimerWarning = !isUntimedActivePhase && phaseTimeLeft <= 10;
    
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
                className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-12 sm:w-12"
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
                {t(gameMode.label)}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end mr-2">
                 <span className="text-[10px] font-black uppercase tracking-widest text-brand-dark/30">Submissions</span>
                 <span className="text-lg font-black leading-none text-brand-purple">{stageCountLabel}</span>
              </div>
              <div className="flex h-11 items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 shadow-[4px_4px_0px_0px_#1A1A1A] sm:h-14">
                <Clock className={`h-5 w-5 ${phaseTimerWarning ? 'text-rose-500 animate-pulse' : 'text-brand-orange'}`} />
                <span className={`text-xl font-black ${phaseTimerWarning ? 'text-rose-600' : ''}`}>{phaseTimerLabel}</span>
              </div>
              <motion.button
                whileHover={{ scale: phaseTransitionPending ? 1 : 1.03 }}
                whileTap={{ scale: phaseTransitionPending ? 1 : 0.97 }}
                onClick={() => updateState(nextStatus, questionIndex)}
                disabled={phaseTransitionPending}
                className="game-action-button game-action-button--dark px-6 py-3 text-base sm:px-8"
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
    const correctIndex = currentQuestion?.correct_index ?? -1;
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
                className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 opacity-40" />
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
                className="game-action-button game-action-button--dark px-6 py-3 text-base"
              >
                {phaseTransitionPending ? '...' : 'Next Phase'}
                <ChevronRight className="w-5 h-5" />
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
    const roundAccuracyPct = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;

    const isLast = questionIndex >= (pack?.questions?.length || 0) - 1;
    const rankedRows = sortedLeaderboardRows.slice(0, 10);
    const podiumRows = rankedRows.slice(0, 3);
    const leadingParticipant = rankedRows[0] || null;
    const runnerUpParticipant = rankedRows[1] || null;
    const roomAverageScore = rankedRows.length
      ? Math.round(rankedRows.reduce((sum, participant) => sum + Number(participant?.score || 0), 0) / rankedRows.length)
      : 0;
    const roomAverageAccuracy = rankedRows.length
      ? Math.round(rankedRows.reduce((sum, participant) => sum + Number(participant?.accuracyPct || 0), 0) / rankedRows.length)
      : 0;
    const leaderGap = leadingParticipant
      ? Math.max(0, Number(leadingParticipant?.score || 0) - Number(runnerUpParticipant?.score || 0))
      : 0;
    const leadingTeam = isTeamMode ? teamLeaderboardRows[0] || null : null;
    const accuracyBoard = gameMode.id === 'accuracy_quiz';
    const boardTitle = isLast ? 'The Winners Circle' : accuracyBoard ? 'Accuracy Leaderboard' : 'Leaderboard';
    const boardBadge = isLast ? 'Final Standings' : accuracyBoard ? 'Accuracy Standings' : 'Current Standings';
    const boardNarrative = isLast
      ? 'Final scores are locked. Celebrate the podium, then jump into the analytics.'
      : accuracyBoard
        ? 'This room is ranked by correct answers first, with score used only to break ties.'
        : 'Scores just reshuffled. Spotlight the podium first, then scan the full room list below.';
    const insightMessage =
      roundAccuracyPct >= 75
        ? 'The room landed this round cleanly. You can safely increase the challenge on the next question.'
        : roundAccuracyPct >= 45
          ? 'The room is split enough to warrant a quick debrief before you move on.'
          : 'This round produced friction. Pause on the top misconception before the next launch.';

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
                className="game-icon-button h-10 w-10 hover:bg-rose-50 hover:text-rose-600 sm:h-12 sm:w-12"
              >
                <XCircle className="h-6 w-6 opacity-40" />
              </motion.button>
              <div className="flex h-11 items-center gap-3 rounded-2xl border-2 border-brand-dark bg-brand-bg px-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                 <span className="text-xs font-black uppercase tracking-widest text-brand-dark/40">
                   {boardBadge}
                 </span>
              </div>
            </div>

            <div className="hidden min-w-0 flex-wrap items-center justify-center gap-3 md:flex">
              <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-dark bg-white px-4 py-2 shadow-[4px_4px_0px_0px_#1A1A1A]">
                <span className="text-xs font-black uppercase text-brand-orange">Q{questionIndex + 1}/{pack?.questions?.length}</span>
              </div>
              <div className={`rounded-2xl border-2 border-brand-dark px-4 py-2 text-xs font-black uppercase tracking-widest shadow-[4px_4px_0px_0px_#1A1A1A] ${gameTone.pill}`}>
                {t(gameMode.label)}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isLast && (
                <motion.button
                  whileHover={{ scale: isCreatingPersonalizedGames ? 1 : 1.03 }}
                  whileTap={{ scale: isCreatingPersonalizedGames ? 1 : 0.97 }}
                  onClick={() => void handleCreatePersonalizedGames()}
                  disabled={isCreatingPersonalizedGames}
                  className="game-action-button game-action-button--yellow hidden px-5 py-2.5 text-sm sm:flex"
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
                className={`game-action-button ${isLast ? 'game-action-button--success' : 'game-action-button--dark'} px-6 py-3 text-base`}
              >
                {phaseTransitionPending ? '...' : isLast ? 'End & Analyze' : 'Next Question'}
                <ChevronRight className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        </div>

        <div className="relative flex-1 min-h-0 overflow-hidden px-2 pb-2 sm:px-4 sm:pb-4 lg:px-5 lg:pb-5 w-full max-w-[1540px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex h-full min-h-0 flex-col overflow-y-auto rounded-[2.8rem] border border-brand-dark/10 bg-white/92 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-xl"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(120,160,255,0.16),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(255,214,95,0.16),_transparent_24%),linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(245,249,255,0.96)_100%)]" />
            <div className="absolute right-10 top-10 h-32 w-32 rounded-full bg-brand-purple/10 blur-3xl" />
            <div className="absolute left-10 bottom-10 h-28 w-28 rounded-full bg-brand-yellow/20 blur-3xl" />

            <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-5 p-4 sm:gap-6 sm:p-6 lg:p-8">
              <div className="shrink-0">
                <div className="mb-3 flex items-center gap-3 text-brand-purple/70">
                  <span className="h-[2px] w-10 bg-brand-purple/15" />
                  <span className="text-[11px] font-black uppercase tracking-[0.42em]">Class Spotlight</span>
                  <span className="h-[2px] w-10 bg-brand-purple/15" />
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="text-4xl font-black tracking-[-0.04em] text-brand-dark sm:text-5xl lg:text-6xl">
                      {boardTitle}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm font-bold leading-relaxed text-brand-dark/55 sm:text-base">
                      {boardNarrative}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-full border-2 border-brand-dark/25 bg-white/95 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-brand-dark/65 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                      Ranked Players: {rankedRows.length}
                    </div>
                    <div className="rounded-full border-2 border-brand-dark/25 bg-white/95 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-brand-dark/65 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                      Round Accuracy: {roundAccuracyPct}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <LeaderboardOverviewCard
                  label="Top Score"
                  value={leadingParticipant ? leadingParticipant.score || 0 : '--'}
                  detail={leadingParticipant ? extractNickname(String(leadingParticipant.nickname || '')) : 'Waiting for the room'}
                  tone="indigo"
                />
                <LeaderboardOverviewCard
                  label="Leader Gap"
                  value={leadingParticipant ? `+${leaderGap}` : '--'}
                  detail={runnerUpParticipant ? `Ahead of ${extractNickname(String(runnerUpParticipant.nickname || ''))}` : 'No runner-up yet'}
                  tone="amber"
                />
                <LeaderboardOverviewCard
                  label="Room Average"
                  value={rankedRows.length ? roomAverageScore : '--'}
                  detail={rankedRows.length ? `${roomAverageAccuracy}% average accuracy` : 'Awaiting ranked players'}
                  tone="emerald"
                />
                <LeaderboardOverviewCard
                  label={isTeamMode ? 'Top Team' : 'Host Insight'}
                  value={isTeamMode ? (leadingTeam?.name || '--') : `${roundAccuracyPct}%`}
                  detail={isTeamMode && leadingTeam
                    ? `${leadingTeam.members || 0} members • ${leadingTeam.score || 0} points`
                    : insightMessage}
                  tone="sky"
                />
              </div>

              <div className="shrink-0 rounded-[2.7rem] border border-brand-dark/10 bg-white/90 px-4 pb-4 pt-5 shadow-[0_22px_55px_rgba(15,23,42,0.1)] sm:px-6 sm:pb-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-purple/55">Podium Spotlight</p>
                    <p className="text-xl font-black text-brand-dark">Top three right now</p>
                  </div>
                  <div className="rounded-full border border-brand-dark/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-brand-dark/55 shadow-[0_8px_16px_rgba(15,23,42,0.08)]">
                    {isLast ? 'Final lock-in' : 'Live reshuffle'}
                  </div>
                </div>

                <div className="relative rounded-[2.4rem] border border-brand-dark/8 bg-[linear-gradient(180deg,rgba(247,250,255,0.96)_0%,rgba(255,255,255,0.98)_42%,rgba(248,250,255,0.95)_100%)] px-3 pb-7 pt-10 sm:px-6">
                  <div className="pointer-events-none absolute inset-x-8 bottom-0 h-20 rounded-t-[2.5rem] border border-brand-dark/8 bg-white/70" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
                    <div className="h-[2px] w-[78%] rounded-full bg-brand-dark/10" />
                  </div>
                  <div className="relative z-10 flex items-end justify-center gap-3 sm:gap-5 lg:gap-7">
                    {podiumRows[1] && (
                      <PodiumStep
                        participant={podiumRows[1]}
                        rank={2}
                        height="h-32 sm:h-40 lg:h-48"
                        delay={0.12}
                        color="bg-[linear-gradient(180deg,#E7B7F4_0%,#D9A5EA_100%)]"
                        icon={<Medal className="h-5 w-5 text-brand-dark/70" />}
                      />
                    )}
                    {podiumRows[0] && (
                      <PodiumStep
                        participant={podiumRows[0]}
                        rank={1}
                        height="h-40 sm:h-52 lg:h-60"
                        delay={0}
                        color="bg-[linear-gradient(180deg,#FFE79E_0%,#FFD86D_100%)]"
                        icon={<Trophy className="h-6 w-6 text-brand-dark/70" />}
                        isWinner={true}
                      />
                    )}
                    {podiumRows[2] && (
                      <PodiumStep
                        participant={podiumRows[2]}
                        rank={3}
                        height="h-28 sm:h-36 lg:h-44"
                        delay={0.24}
                        color="bg-[linear-gradient(180deg,#FFB9AE_0%,#F59F94_100%)]"
                        icon={<Award className="h-5 w-5 text-brand-dark/70" />}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
                <div className="order-2 flex flex-col xl:order-1">
                  {isLeaderboardLoading ? (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-[2.5rem] border border-brand-dark/10 border-dashed bg-white/95 p-12 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                      <div className="text-center">
                        <Trophy className="mx-auto mb-4 h-16 w-16 text-brand-dark/15" />
                        <p className="text-2xl font-black text-brand-dark/40">Syncing scores...</p>
                      </div>
                    </div>
                  ) : rankedRows.length === 0 ? (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-[2.5rem] border border-brand-dark/10 border-dashed bg-white/95 p-12 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                      <div className="text-center">
                        <Users className="mx-auto mb-4 h-16 w-16 text-brand-dark/15" />
                        <p className="text-2xl font-black text-brand-dark/40">Waiting for data sync...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col rounded-[2.5rem] border border-brand-dark/10 bg-white/96 p-5 shadow-[0_22px_50px_rgba(15,23,42,0.1)]">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div className="flex-1 text-right">
                          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-purple/55">Game Leaderboard</p>
                          <p className="mt-1 text-lg font-black text-brand-dark">
                            {accuracyBoard ? 'Room accuracy standings' : `Room standings after question ${questionIndex + 1}`}
                          </p>
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand-dark/15 bg-[#eef0ff] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                          <BarChart3 className="h-5 w-5 text-brand-purple" />
                        </div>
                      </div>

                      <div className="mb-4 flex justify-start">
                        <div className="rounded-full border border-brand-dark/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-brand-dark/55 shadow-[0_8px_16px_rgba(15,23,42,0.08)]">
                          Live Rank View
                        </div>
                      </div>

                      <div className="pr-1">
                        <div className="grid gap-4 xl:grid-cols-2">
                          {rankedRows.map((participant, index) => (
                            <LeaderboardStandingRow
                              key={participant.id || participant.nickname || index}
                              participant={participant}
                              rank={index + 1}
                              isTopThree={index < 3}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="order-1 flex flex-col gap-5 xl:order-2">
                  <div className="rounded-[2.5rem] border border-brand-dark/10 bg-white/96 p-5 shadow-[0_22px_50px_rgba(15,23,42,0.1)]">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-purple/55">
                          {isTeamMode ? 'Team Pulse' : 'Host Insight'}
                        </p>
                        <p className="text-lg font-black text-brand-dark">
                          {isTeamMode && leadingTeam ? leadingTeam.name : 'Read the room before you launch again'}
                        </p>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-dark/15 bg-[#fff6db] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                        <Lightbulb className="h-5 w-5 text-brand-dark" />
                      </div>
                    </div>

                    {isTeamMode && leadingTeam ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <LeaderboardOverviewCard
                            label="Team Points"
                            value={leadingTeam.score || 0}
                            detail="Best combined score"
                            tone="amber"
                            compact
                          />
                          <LeaderboardOverviewCard
                            label="Members"
                            value={leadingTeam.members || 0}
                            detail={`${leadingTeam.accuracyPct || 0}% team accuracy`}
                            tone="sky"
                            compact
                          />
                        </div>
                        <p className="rounded-[1.7rem] border border-brand-dark/10 bg-[#f8faff] px-4 py-4 text-sm font-bold leading-relaxed text-brand-dark/72">
                          {insightMessage}
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-[1.7rem] border border-brand-dark/10 bg-[#f8faff] px-4 py-4 text-sm font-bold leading-relaxed text-brand-dark/72">
                        {insightMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

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
              className="game-action-button game-action-button--dark px-8 py-4 text-lg"
            >
              Open Analytics
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/teacher/dashboard')}
              className="game-action-button game-action-button--secondary px-8 py-4 text-lg"
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
            className="game-action-button game-action-button--primary w-full py-4 text-lg"
          >
            {t('dash.action.refresh')}
          </button>
          <button 
            onClick={() => navigate('/teacher/dashboard')}
            className="game-action-button game-action-button--secondary w-full py-4 text-lg"
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
            className="game-action-button game-action-button--primary w-full px-5 py-4 text-lg"
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
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: delay * 0.45, duration: 1, type: 'spring', bounce: 0.2 }}
      className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
    >
      <div className="z-20 mb-4 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: delay + 0.6, type: 'spring', stiffness: 260 }}
          className="relative"
        >
          {isWinner && (
            <motion.div
              animate={{ y: [0, -8, 0], rotate: [0, 5, -5, 0] }}
              transition={{ repeat: Infinity, duration: 4 }}
              className="absolute -top-9 left-1/2 z-30 -translate-x-1/2"
            >
              <Crown className="h-10 w-10 text-brand-yellow drop-shadow-[0_0_18px_rgba(255,210,51,0.55)]" />
            </motion.div>
          )}

          <div className={`rounded-[2rem] border-[3px] border-brand-dark bg-white p-1.5 shadow-[0_16px_30px_rgba(15,23,42,0.16)] ${
            isWinner ? 'ring-4 ring-brand-yellow/25' : ''
          }`}>
            <LeaderboardAvatarBadge
              nickname={nickname}
              sizeClass="h-16 w-16 sm:h-20 sm:w-20 lg:h-24 lg:w-24"
              className="rounded-[1.35rem] border-brand-dark bg-brand-bg"
            />
          </div>

          {rank > 0 && (
            <div className={`absolute -bottom-3 -right-3 z-40 flex h-10 w-10 items-center justify-center rounded-2xl border-[3px] border-brand-dark font-black shadow-[0_10px_18px_rgba(15,23,42,0.18)] ${
              isWinner ? 'bg-brand-yellow text-brand-dark' : 'bg-white text-brand-dark'
            }`}>
              {rank}
            </div>
          )}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + 0.8 }}
          className="mt-4 max-w-[12rem] text-center sm:max-w-[16rem]"
        >
          <p className="truncate text-sm font-black text-brand-dark sm:text-base">{extractNickname(nickname)}</p>
          <div className={`mx-auto mt-2 inline-flex items-center justify-center rounded-full border border-brand-dark/12 px-4 py-2 text-sm font-black shadow-[0_10px_22px_rgba(15,23,42,0.12)] ${
            isWinner
              ? 'bg-white/95 text-brand-dark'
              : 'bg-white/92 text-brand-dark'
          }`}>
            XP {participant.score || 0}
          </div>
        </motion.div>
      </div>

      <motion.div 
        initial={{ y: 100, opacity: 0, scaleY: 0.7 }}
        animate={{ y: 0, opacity: 1, scaleY: 1 }}
        transition={{ delay: delay + 0.15, duration: 0.9, ease: 'easeOut' }}
        className={`relative z-10 flex w-full origin-bottom items-center justify-center overflow-hidden rounded-t-[2.4rem] border-[3px] border-brand-dark ${height} ${color} shadow-[0_18px_34px_rgba(15,23,42,0.16)]`}
      >
        <div className="absolute inset-x-0 top-0 h-8 bg-white/30 blur-lg" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),transparent_40%,rgba(0,0,0,0.06))]" />
        <div className="absolute right-0 top-0 p-4 opacity-[0.14]">
           <div className="pointer-events-none select-none text-[6rem] font-black leading-none text-white sm:text-[8rem]">{rank}</div>
        </div>
        {icon && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border-[3px] border-brand-dark bg-white/90 p-2 text-brand-dark shadow-[0_10px_18px_rgba(15,23,42,0.18)]">
            {icon}
          </div>
        )}
        <div className="relative z-10 mt-6 text-[3.4rem] font-black leading-none text-white drop-shadow-[0_8px_18px_rgba(255,255,255,0.45)] sm:text-[4.8rem]">
          {rank}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LeaderboardAvatarBadge({
  nickname,
  sizeClass = 'h-12 w-12',
  className = '',
}: {
  nickname: string;
  sizeClass?: string;
  className?: string;
}) {
  const avatarMatch = String(nickname || '').match(/^\[(avatar_\d+\.png)\]\s*(.*)$/);
  const avatarFile = avatarMatch?.[1] || '';
  const cleanedName = extractNickname(String(nickname || 'Student')).trim();
  const initials = cleanedName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || '?';

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[1.1rem] border-[3px] border-brand-dark bg-white shadow-[0_10px_18px_rgba(15,23,42,0.14)] ${sizeClass} ${className}`}>
      {avatarFile ? (
        <img
          src={`/avatars/${avatarFile}`}
          alt={cleanedName || 'Avatar'}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="text-base font-black tracking-tight text-brand-dark sm:text-lg">{initials}</span>
      )}
    </div>
  );
}

function LeaderboardOverviewCard({
  label,
  value,
  detail,
  tone,
  compact = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: 'indigo' | 'amber' | 'emerald' | 'sky';
  compact?: boolean;
}) {
  const toneClasses = {
    indigo: {
      dot: 'bg-brand-purple',
      value: 'text-brand-dark',
      card: 'bg-white',
    },
    amber: {
      dot: 'bg-brand-yellow',
      value: 'text-brand-dark',
      card: 'bg-[#fff7df]',
    },
    emerald: {
      dot: 'bg-emerald-400',
      value: 'text-brand-dark',
      card: 'bg-[#ecfff6]',
    },
    sky: {
      dot: 'bg-sky-400',
      value: 'text-brand-dark',
      card: 'bg-[#eef8ff]',
    },
  }[tone];

  return (
    <div className={`rounded-[1.7rem] border border-brand-dark/10 px-4 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)] ${toneClasses.card} ${compact ? 'min-h-[118px]' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${toneClasses.dot}`} />
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-dark/45">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-black tracking-[-0.04em] ${toneClasses.value} ${compact ? 'text-xl' : 'sm:text-3xl'}`}>
        {value}
      </p>
      <p className="mt-2 text-sm font-bold leading-relaxed text-brand-dark/56">
        {detail}
      </p>
    </div>
  );
}

function LeaderboardStandingRow({
  participant,
  rank,
  isTopThree,
}: {
  key?: React.Key;
  participant: any;
  rank: number;
  isTopThree: boolean;
}) {
  const displayName = extractNickname(String(participant?.nickname || 'Student'));
  const answeredCount = Number(participant?.answeredCount || 0);
  const correctCount = Number(participant?.correctCount || 0);
  const accuracyPct = Number(participant?.accuracyPct || 0);
  const performanceLabel = answeredCount > 0 ? `${correctCount}/${answeredCount} correct` : `${correctCount} correct`;
  const badgeLabel = participant?.team_name ? String(participant.team_name) : `${accuracyPct}% accuracy`;

  return (
    <motion.div
      initial={{ x: -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: rank * 0.05 }}
      className={`grid grid-cols-[auto,1fr,auto] items-center gap-4 rounded-[2rem] border-[3px] border-brand-dark bg-white px-4 py-4 shadow-[0_20px_36px_rgba(15,23,42,0.1)] sm:px-5 ${
        isTopThree
          ? 'ring-2 ring-brand-purple/10'
          : ''
      }`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-brand-dark text-base font-black shadow-[0_10px_18px_rgba(15,23,42,0.14)] ${
        rank === 1
          ? 'bg-brand-yellow text-brand-dark'
          : rank === 2
            ? 'bg-brand-purple text-white'
            : rank === 3
              ? 'bg-brand-orange text-white'
              : 'bg-brand-bg text-brand-dark'
      }`}>
        {rank}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <LeaderboardAvatarBadge nickname={String(participant?.nickname || '')} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black text-brand-dark sm:text-lg">{displayName}</p>
            <p className="mt-1 truncate text-sm font-bold text-brand-dark/58">{performanceLabel}</p>
          </div>
          <div className="hidden rounded-full bg-[#ececec] px-4 py-2 text-sm font-black text-brand-dark/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] md:block">
            {badgeLabel}
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-dark/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange via-brand-yellow to-brand-purple"
            style={{ width: `${Math.max(8, Math.min(100, accuracyPct || 0))}%` }}
          />
        </div>
      </div>

      <div className="text-right">
        <div className={`rounded-full border border-brand-dark/10 px-4 py-2 text-xl font-black shadow-[0_12px_24px_rgba(15,23,42,0.1)] sm:text-2xl ${
          isTopThree
            ? 'bg-[#ececec] text-brand-dark'
            : 'bg-[#ececec] text-brand-dark'
        }`}>
          XP {participant?.score || 0}
        </div>
        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.28em] text-brand-dark/32">Score</p>
      </div>
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
