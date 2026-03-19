import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Users, Play, CheckCircle, XCircle, BarChart3, ChevronRight, Sparkles, Clock, AlertTriangle, Copy, Check, BookOpen, Rocket, Link2, Trophy, Medal, Crown, Award } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { QRCodeSVG } from 'qrcode.react';
import Avatar, { extractNickname } from '../components/Avatar.tsx';
import QuestionImageCard from '../components/QuestionImageCard.tsx';
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
  const participantCountRef = useRef(0);
  const questionIndexRef = useRef(0);
  const statusRef = useRef(status);
  const focusAlertTimeoutsRef = useRef<Record<string, number>>({});
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
  const currentAnswers = Array.isArray(currentQuestion?.answers)
    ? currentQuestion.answers
    : JSON.parse(currentQuestion?.answers_json || '[]');
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
    apiFetchJson(`/api/sessions/${pin}`)
      .then(data => {
        setSessionMeta(data);
        setSessionId(data.id);
        setPackId(data.quiz_pack_id);
        setStatus(data.status);
        setQuestionIndex(data.current_question_index);
      });
  }, [pin]);

  useEffect(() => {
    if (!pin || !sessionId) return;
    apiFetchJson(`/api/sessions/${pin}/participants`)
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

  useEffect(() => {
    if (packId) {
      apiFetchJson(`/api/packs/${packId}`)
        .then(data => setPack(data));
    }
  }, [packId]);

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
    const response = await apiFetch(`/api/sessions/${sessionId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, current_question_index: index })
    });
    if (!response.ok) {
      return;
    }

    void writeHostedSessionMeta(String(pin || ''), {
      sessionId: Number(sessionId || 0),
      quizPackId: Number(packId || sessionMeta?.quiz_pack_id || 0),
      packTitle: pack?.title || sessionMeta?.pack_title || '',
      gameType: sessionMeta?.game_type || 'classic_quiz',
      teamCount: Number(sessionMeta?.team_count || 0),
      modeConfig,
      status: newStatus,
      currentQuestionIndex: index,
      question: buildRealtimeQuestionPayload(newStatus, index),
      expectedParticipants: participantCountRef.current,
    });
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

  if (status === 'LOBBY') {
    return (
      <div className="min-h-screen bg-brand-bg text-brand-dark font-sans selection:bg-brand-orange selection:text-white relative overflow-hidden">
        <div className="absolute top-[-8%] left-[-4%] w-96 h-96 border-[4px] border-brand-dark/5 rounded-full" />
        <div className="absolute bottom-[-10%] right-[-6%] w-[460px] h-[460px] border-[4px] border-brand-dark/5 rounded-full" />
        <div className="max-w-[1380px] mx-auto px-6 lg:px-10 py-8 relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/teacher/dashboard')}>
                <span className="text-brand-orange">Quiz</span>zi
              </div>
              <span className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark font-black text-sm">Live Host Lobby</span>
            </div>

            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="w-fit px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_#1A1A1A]"
            >
              <XCircle className="w-5 h-5" />
              Exit Lobby
            </button>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.1fr)_360px] gap-8 mb-8">
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

                  <h1 className="text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight mb-4">
                    {participants.length > 0 ? 'The room is warming up.' : 'Your live game is waiting for students.'}
                  </h1>
                  <p className="text-lg text-white/75 font-medium max-w-2xl mb-8">
                    Share the PIN, watch students appear in real time, and launch only when the room feels settled.
                  </p>

                  <div className="bg-white rounded-[2.2rem] border-4 border-brand-dark p-6 text-brand-dark mb-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Join with PIN or scan</p>
                        <p className="font-bold text-brand-dark/60">Students can still type the code, but the QR path now opens the room automatically on their device.</p>
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
                        <button
                          type="button"
                          onClick={copyJoinLink}
                          className="px-4 py-2 rounded-full bg-white border-2 border-brand-dark font-black text-sm flex items-center gap-2"
                        >
                          {isJoinLinkCopied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                          {isJoinLinkCopied ? 'Link copied' : 'Copy join link'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-4 sm:p-5 mb-5 overflow-hidden">
                      <div className="grid grid-cols-6 gap-2 sm:gap-3 w-full max-w-[560px] mx-auto">
                        {String(pin || '').split('').map((digit, index) => (
                          <div
                            key={`${digit}-${index}`}
                            className="aspect-square min-h-[72px] rounded-[1.2rem] bg-white border-2 border-brand-dark flex items-center justify-center text-3xl sm:text-4xl font-black shadow-[3px_3px_0px_0px_#1A1A1A]"
                          >
                            {digit}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-4 items-stretch">
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-3">Student join flow</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <JoinStep title="1. Scan" body="Students scan the host QR or open the join link." />
                          <JoinStep title="2. Identify" body="The room PIN is filled automatically, then they add a nickname if needed." />
                          <JoinStep title="3. Wait" body="They appear in the lobby as soon as the join completes." />
                        </div>
                      </div>
                      <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-yellow p-4 flex flex-col items-center text-center">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/60 mb-3">Scan to join</p>
                        <div className="rounded-[1.25rem] border-2 border-brand-dark bg-white p-3 shadow-[4px_4px_0px_0px_#1A1A1A]">
                          <QRCodeSVG value={joinUrl || String(pin || '')} size={152} level="M" includeMargin />
                        </div>
                        <p className="font-black text-sm mt-4 break-all">{joinUrl || 'Join link loading...'}</p>
                        <p className="font-bold text-brand-dark/65 mt-2">Students land directly in the right session instead of typing the PIN by hand.</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-5 bg-white/10 rounded-[2rem] border border-white/10 p-5 items-center">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50 mb-2">Launch control</p>
                      <p className="text-2xl font-black">{participants.length > 0 ? `${participants.length} student${participants.length === 1 ? '' : 's'} are in the room.` : 'Waiting for the first student to arrive.'}</p>
                      <p className="font-medium text-white/65 mt-1">
                        {participants.length > 0
                          ? 'When the roster looks stable, start the game and move straight into question one.'
                          : 'The launch button unlocks automatically as soon as one student joins.'}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: participants.length > 0 ? 1.03 : 1 }}
                      whileTap={{ scale: participants.length > 0 ? 0.98 : 1 }}
                      onClick={() => updateState('QUESTION_ACTIVE', 0)}
                      disabled={participants.length === 0}
                      className="px-8 py-5 bg-brand-orange text-white border-4 border-brand-dark rounded-[1.75rem] font-black text-2xl flex items-center justify-center gap-3 shadow-[8px_8px_0px_0px_#1A1A1A] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Play className="w-6 h-6 fill-current" />
                      Start Game
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            </section>

            <section className="space-y-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-white rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-7"
              >
                <div className="flex items-center gap-3 mb-5">
                  <BarChart3 className="w-6 h-6 text-brand-purple" />
                  <h2 className="text-3xl font-black">Launch Summary</h2>
                </div>
                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4 mb-5">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Room read</p>
                  <p className="text-2xl font-black mb-2">{roomReadTitle}</p>
                  <p className="font-medium text-brand-dark/70">{roomReadBody}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-5">
                  <LobbyMetric label="Players" value={participants.length} icon={<Users className="w-5 h-5" />} tone="light" />
                  <LobbyMetric label="Questions" value={packQuestionCount} icon={<BookOpen className="w-5 h-5" />} tone="warm" />
                  <LobbyMetric label={isTeamMode ? 'Teams' : 'Pack'} value={isTeamMode ? (sessionMeta?.team_count || 0) : (pack?.title ? 'Loaded' : 'Loading')} icon={<Rocket className="w-5 h-5" />} tone="dark" />
                  <LobbyMetric label="Status" value={participants.length > 0 ? 'Ready' : 'Waiting'} icon={<Clock className="w-5 h-5" />} tone="light" />
                </div>

                <div className="rounded-[1.5rem] border-2 border-brand-dark bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Current pack</p>
                  <p className="text-xl font-black">{pack?.title || 'Loading pack...'}</p>
                  <p className="font-medium text-brand-dark/65 mt-1">
                    {packQuestionCount
                      ? `${packQuestionCount} question${packQuestionCount === 1 ? '' : 's'} are loaded in ${gameMode.label}.`
                      : 'Pack data is loading. Once it lands, the room can launch immediately.'}
                  </p>
                </div>

                {recentParticipants.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-3">Most recent joins</p>
                    <div className="flex flex-wrap gap-2">
                      {recentParticipants.map((participant: any) => (
                        <span
                          key={`recent-${participant.id || participant.nickname}`}
                          className="px-3 py-2 rounded-full bg-brand-yellow border-2 border-brand-dark font-black text-sm"
                        >
                          {extractNickname(participant.nickname || '')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.09 }}
                className="bg-brand-yellow rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-7"
              >
                <div className="flex items-center gap-3 mb-5">
                  <Sparkles className="w-6 h-6 text-brand-orange" />
                  <h2 className="text-3xl font-black">Host Checklist</h2>
                </div>
                <div className="space-y-3">
                  <TipRow title="PIN visible" body="Keep the code and QR in view until the roster stops changing." />
                  <TipRow title="Roster calm" body="Start only after the last burst of joins settles down." />
                  <TipRow title="Pack confirmed" body="Check that the pack title matches the lesson you intend to run." />
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

                <div className="rounded-[1.4rem] border-2 border-brand-dark bg-brand-bg p-4 mb-5">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Room status</p>
                  <p className="font-bold text-brand-dark/65">
                    {participants.length > 0
                      ? 'Names appear here in real time. Hovering over the room is enough to know when the class is settled.'
                      : 'The room is empty right now. Keep the PIN visible and students will populate automatically once they join.'}
                  </p>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <section className="space-y-6">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="bg-white rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-7"
              >
                <div className="flex items-center gap-3 mb-5">
                  <AlertTriangle className="w-6 h-6 text-brand-orange" />
                  <h2 className="text-3xl font-black">Before You Launch</h2>
                </div>
                <div className="space-y-3">
                  <TipRow title="Share the PIN" body="Keep the lobby visible while students join from the homepage or QR link." />
                  <TipRow title="Watch the room" body="New names appear instantly, so you can see when the class has settled." />
                  <TipRow title="Launch cleanly" body="Start once the room looks calm. After the session, analytics open automatically." />
                </div>
              </motion.div>
            </section>
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
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white px-6 py-5 shadow-sm flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 z-10">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to end the game early?')) {
                  updateState('ENDED', questionIndex);
                  navigate(`/teacher/analytics/class/${sessionId}`);
                }
              }}
              className="flex items-center gap-2 text-slate-400 hover:text-rose-500 font-bold transition-colors"
            >
              <XCircle className="w-6 h-6" />
              End Game
            </button>
            <div className="text-slate-500 font-bold text-xl bg-slate-100 px-6 py-2 rounded-xl">
              Question {questionIndex + 1} of {pack?.questions?.length}
            </div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </div>
            <div className="px-4 py-2 rounded-full bg-slate-900 text-white font-black text-sm">
              {stageLabel}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-lg font-black text-slate-900 flex items-center gap-3 bg-slate-100 px-5 py-3 rounded-2xl">
              <Clock className="w-6 h-6 text-brand-orange" />
              {phaseTimeLeft}s left
            </div>
            <div className="text-lg font-black text-indigo-600 flex items-center gap-3 bg-indigo-50 px-5 py-3 rounded-2xl">
              <Users className="w-6 h-6" />
              {stageCountLabel}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => updateState(nextStatus, questionIndex)}
            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold text-lg hover:bg-slate-800 transition-colors shadow-[0_4px_0_0_rgba(15,23,42,1)] active:shadow-none active:translate-y-1"
          >
            {nextButtonLabel}
          </motion.button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-6xl mx-auto w-full relative">
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
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full mb-8 rounded-[2.4rem] border-2 border-slate-200 bg-white p-6 sm:p-8 relative overflow-hidden"
          >
            {/* NEW: Engagement Progress Bar */}
            <div className="absolute top-0 left-0 w-full h-2 bg-slate-100">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${participants.length > 0 ? (totalAnswers / participants.length) * 100 : 0}%` }}
                className="h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
              />
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-[0.2em] ${gameTone.pill}`}>
                    {gameMode.shortLabel}
                  </span>
                  <span className="px-3 py-2 rounded-full bg-slate-100 text-slate-700 text-xs font-black uppercase tracking-[0.2em]">
                    {gameMode.researchCue}
                  </span>
                </div>
                <QuestionImageCard
                  imageUrl={currentQuestion?.image_url}
                  alt={currentQuestion?.prompt || 'Question image'}
                  className="mb-4 max-w-3xl"
                  imgClassName="max-h-[280px]"
                />
                <h2 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-3">
                  {currentQuestion?.prompt}
                </h2>
                <p className="text-lg text-slate-600 font-medium max-w-3xl">
                  {stageBody}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-[260px]">
                <HostStageMetric label="Timer" value={`${phaseTimeLeft}s`} tone="dark" />
                <HostStageMetric label={isDiscussion ? 'First votes' : isPeerMode && !isRevote ? 'Votes' : 'Answers'} value={isDiscussion ? Object.keys(studentSelections).length : isPeerMode && !isRevote ? Object.keys(studentSelections).length : totalAnswers} tone="light" />
                <HostStageMetric label="Players" value={participants.length} tone="light" />
                <HostStageMetric label="Phase" value={stageLabel} tone="warm" />
              </div>
            </div>
          </motion.div>

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
                  className={`rounded-[2rem] p-8 sm:p-10 text-2xl sm:text-3xl font-bold text-center shadow-sm flex flex-col items-center justify-center min-h-[180px] relative overflow-hidden border-4 ${
                    isDiscussion ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  <div className="absolute top-0 left-0 h-full bg-brand-orange/15" style={{ width: `${selectionPct}%` }} />
                  <div className="relative z-10">
                    <p>{ans}</p>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                      <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isDiscussion ? 'bg-white text-slate-900 border-white' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {selectionCount} {selectionCount === 1 ? 'student' : 'students'}
                      </span>
                      <span className={`px-4 py-2 rounded-full text-sm font-black border-2 ${isDiscussion ? 'bg-brand-yellow text-brand-dark border-brand-dark' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                        {selectionPct}%
                      </span>
                    </div>
                    {!isDiscussion && selectionCount > 0 && (
                      <AnimatePresence>
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          className="mt-4 flex flex-wrap gap-2 justify-center"
                        >
                          {Array.from({ length: selectionCount }).map((_, idx) => (
                            <motion.div
                              key={idx}
                              animate={{ scale: [1, 1.2, 1] }}
                              transition={{ repeat: Infinity, duration: 1, delay: idx * 0.18 }}
                              className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(79,70,229,0.5)]"
                            />
                          ))}
                        </motion.div>
                      </AnimatePresence>
                    )}
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
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white px-8 py-6 shadow-sm flex justify-between items-center border-b border-slate-200 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to end the game early?')) {
                  updateState('ENDED', questionIndex);
                  navigate(`/teacher/analytics/class/${sessionId}`);
                }
              }}
              className="flex items-center gap-2 text-slate-400 hover:text-rose-500 font-bold transition-colors"
            >
              <XCircle className="w-6 h-6" />
              End Game
            </button>
            <div className="text-slate-500 font-bold text-xl bg-slate-100 px-6 py-2 rounded-xl">Results</div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => updateState('LEADERBOARD', questionIndex)}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-[0_4px_0_0_#4338ca] active:shadow-none active:translate-y-1"
          >
            Next <ChevronRight className="w-6 h-6" />
          </motion.button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-6xl mx-auto w-full">
          <QuestionImageCard
            imageUrl={currentQuestion?.image_url}
            alt={currentQuestion?.prompt || 'Question image'}
            className="w-full max-w-3xl mb-6"
            imgClassName="max-h-[320px]"
          />
          <motion.h2
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-4xl font-black text-center text-slate-900 mb-12 bg-white px-10 py-6 rounded-3xl shadow-sm border border-slate-200"
          >
            {currentQuestion?.prompt}
          </motion.h2>

          <div
            className="grid gap-6 w-full mb-12"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
          >
            {currentAnswers.map((ans: string, i: number) => {
              const isCorrect = i === currentQuestion.correct_index;
              return (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  key={i}
                  className={`rounded-[2rem] p-10 text-3xl font-bold text-center shadow-sm flex items-center justify-center gap-4 min-h-[160px] ${isCorrect ? 'bg-emerald-100 border-4 border-emerald-500 text-emerald-900 shadow-emerald-500/20 shadow-xl' : 'bg-white border-4 border-slate-200 text-slate-400 opacity-50 grayscale'}`}
                >
                  {isCorrect && <CheckCircle className="w-10 h-10 text-emerald-500 flex-shrink-0" />}
                  {ans}
                </motion.div>
              );
            })}
          </div>

          {currentQuestion?.explanation && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-white rounded-[2rem] p-10 shadow-xl border border-slate-200 w-full max-w-3xl text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-indigo-500"></div>
              <h3 className="text-2xl font-black text-slate-900 mb-4 flex items-center justify-center gap-3">
                <Sparkles className="w-6 h-6 text-indigo-500" />
                Explanation
              </h3>
              <p className="text-slate-600 text-xl font-medium leading-relaxed">{currentQuestion?.explanation}</p>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  if (status === 'LEADERBOARD') {
    const isLast = questionIndex >= (pack?.questions?.length || 0) - 1;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white px-8 py-6 shadow-sm flex justify-between items-center border-b border-slate-200 z-10">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-slate-500 font-bold text-xl bg-slate-100 px-6 py-2 rounded-xl">
              {isLast ? 'Final Standings' : 'Current Standings'}
            </div>
            <div className={`px-4 py-2 rounded-full border-2 border-brand-dark font-black text-sm ${gameTone.pill}`}>
              {gameMode.label}
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (isLast) {
                updateState('ENDED', questionIndex);
                navigate(`/teacher/analytics/class/${sessionId}`);
              } else {
                updateState('QUESTION_ACTIVE', questionIndex + 1);
              }
            }}
            className={`${isLast ? 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_0_0_#047857]' : 'bg-indigo-600 hover:bg-indigo-700 shadow-[0_4px_0_0_#4338ca]'} text-white px-8 py-3 rounded-xl font-bold text-lg transition-colors flex items-center gap-2 active:shadow-none active:translate-y-1`}
          >
            {isLast ? 'End Game & View Analytics' : 'Next Question'} <ChevronRight className="w-6 h-6" />
          </motion.button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-start p-8 max-w-[1400px] mx-auto w-full">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.6 }}
            className="mb-8"
          >
            <h2 className="text-6xl font-black text-slate-900 tracking-tight text-center">
              {isLast ? 'Final Standings' : 'Current Standings'}
            </h2>
          </motion.div>

          {isTeamMode && teamBoard.length > 0 ? (
            <div className="w-full max-w-4xl space-y-6 mb-16">
              {teamBoard.slice(0, 5).map((team: any, i: number) => (
                <motion.div
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1, type: 'spring' }}
                  key={team.team_id || team.team_name}
                  className={`p-8 rounded-[2.5rem] border-4 ${i === 0 ? 'bg-yellow-50 border-yellow-400 shadow-xl' : 'bg-white border-slate-200 shadow-sm'}`}
                >
                  <div className="flex items-center justify-between gap-6 mb-4">
                    <div className="flex items-center gap-6">
                      <div className={`w-16 h-16 rounded-full border-4 border-slate-900 flex items-center justify-center font-black text-3xl ${i === 0 ? 'bg-yellow-400 text-slate-900' : 'bg-slate-100 text-slate-500'}`}>
                        {i + 1}
                      </div>
                      <div>
                        <span className="text-4xl font-black text-slate-900">{team.team_name}</span>
                        <p className="text-lg font-bold text-slate-500">{team.student_count} players · {team.accuracy?.toFixed?.(0) || team.accuracy}% accuracy</p>
                      </div>
                    </div>
                    <div className="text-5xl font-black text-indigo-600">{team.total_score || 0}</div>
                  </div>
                  <p className="text-lg font-medium text-slate-400 italic">
                    {(team.members || []).slice(0, 8).map((member: any) => extractNickname(member.nickname || member)).join(', ')}
                    {(team.members || []).length > 8 && '...'}
                  </p>
                </motion.div>
              ))}
            </div>
          ) : (
            <>
              <div className="w-full mb-16">
                {leaderboard.length > 0 ? (
                  <div className="flex flex-col md:flex-row items-end justify-center gap-4 md:gap-0 h-[450px]">
                    {/* 2nd Place */}
                    {leaderboard[1] && (
                      <PodiumStep 
                        participant={leaderboard[1]} 
                        rank={2} 
                        height="h-[70%]" 
                        delay={0.2} 
                        color="bg-slate-200"
                        icon={<Medal className="w-10 h-10 text-slate-500" />}
                      />
                    )}
                    
                    {/* 1st Place */}
                    {leaderboard[0] && (
                      <PodiumStep 
                        participant={leaderboard[0]} 
                        rank={1} 
                        height="h-[90%]" 
                        delay={0.4} 
                        color="bg-yellow-400"
                        icon={<Crown className="w-14 h-14 text-yellow-800" />}
                        isWinner
                      />
                    )}

                    {/* 3rd Place */}
                    {leaderboard[2] && (
                      <PodiumStep 
                        participant={leaderboard[2]} 
                        rank={3} 
                        height="h-[55%]" 
                        delay={0.6} 
                        color="bg-amber-600"
                        icon={<Award className="w-8 h-8 text-amber-200" />}
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-center text-slate-500 py-12 text-xl font-medium">Loading results...</div>
                )}
              </div>

              {leaderboard.length > 3 && (
                <div className="w-full max-w-4xl space-y-4">
                  <h3 className="text-2xl font-black text-slate-400 mb-6 flex items-center gap-3">
                    <BarChart3 className="w-6 h-6" />
                    Everyone Else
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {leaderboard.slice(3).map((p: any, i: number) => (
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 1 + i * 0.05 }}
                        key={p.id}
                        className="flex items-center justify-between p-5 bg-white rounded-3xl border-2 border-slate-100 shadow-sm hover:border-indigo-200 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-500">
                            {i + 4}
                          </div>
                          <Avatar 
                            nickname={p.nickname} 
                            imgClassName="w-10 h-10" 
                            textClassName="text-xl font-black text-slate-900" 
                          />
                        </div>
                        <div className="text-2xl font-black text-indigo-500">{p.total_score || 0}</div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
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
        <div className="mt-4 bg-white px-6 py-2 rounded-full border-2 border-slate-200 shadow-sm">
          <p className="text-2xl font-black text-slate-900 whitespace-nowrap">{extractNickname(participant.nickname)}</p>
        </div>
        <p className="text-3xl font-black text-indigo-600 mt-2">{participant.total_score || 0}</p>
      </div>

      <motion.div 
        initial={{ height: 0 }}
        animate={{ height: height.match(/\d+/) ? `${height.match(/\d+/)[0]}%` : '50%' }}
        transition={{ delay: delay + 0.3, duration: 1, ease: 'circOut' }}
        className={`w-full ${height} ${color} rounded-t-[3rem] border-x-4 border-t-4 border-slate-900 shadow-[12px_-4px_0px_0px_rgba(0,0,0,0.1)] flex flex-col items-center justify-start pt-8 relative`}
      >
        <div className="absolute -top-12 drop-shadow-lg scale-125">
          {icon}
        </div>
        <div className="text-8xl font-black text-white/40 select-none">{rank}</div>
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
      ? 'bg-slate-900 text-white border-slate-900'
      : tone === 'warm'
        ? 'bg-brand-yellow text-brand-dark border-brand-dark'
        : 'bg-white text-brand-dark border-slate-200';

  return (
    <div className={`rounded-[1.4rem] border-2 p-4 min-h-[94px] ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-2">{label}</p>
      <p className="text-2xl font-black break-words leading-tight">{value}</p>
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
