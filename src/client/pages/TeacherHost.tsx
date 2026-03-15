import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Users, Play, CheckCircle, XCircle, BarChart3, ChevronRight, Sparkles, Clock, AlertTriangle, Copy, Check, BookOpen, Rocket, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { QRCodeSVG } from 'qrcode.react';
import Avatar from '../components/Avatar.tsx';
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
                  <h2 className="text-3xl font-black">Room Snapshot</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <LobbyMetric label="Players" value={participants.length} icon={<Users className="w-5 h-5" />} tone="light" />
                  <LobbyMetric label="Questions" value={pack?.questions?.length || 0} icon={<BookOpen className="w-5 h-5" />} tone="warm" />
                  <LobbyMetric label={isTeamMode ? 'Teams' : 'Pack'} value={isTeamMode ? (sessionMeta?.team_count || 0) : (pack?.title ? 'Loaded' : 'Loading')} icon={<Rocket className="w-5 h-5" />} tone="dark" />
                  <LobbyMetric label="Status" value={participants.length > 0 ? 'Ready' : 'Waiting'} icon={<Clock className="w-5 h-5" />} tone="light" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.07 }}
                className="bg-brand-dark text-white rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#FF5A36] p-7"
              >
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">Current pack</p>
                <h2 className="text-3xl font-black mb-3">{pack?.title || 'Loading pack...'}</h2>
                <p className="font-medium text-white/70 mb-5">
                  {pack?.questions?.length
                    ? `${pack.questions.length} question${pack.questions.length === 1 ? '' : 's'} are loaded and ready.`
                    : 'Pack data is loading. Once ready, the room can launch immediately.'}
                </p>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4 mb-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-2">Format</p>
                  <p className="text-xl font-black">{gameMode.label}</p>
                  <p className="font-medium text-white/70 mt-1">{gameMode.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-2">Lobby rule</p>
                    <p className="font-bold text-white/75">Do not start while names are still arriving in bursts.</p>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45 mb-2">After the game</p>
                    <p className="font-bold text-white/75">You land directly in the class analytics dashboard with drill-down and CSV export.</p>
                  </div>
                </div>
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
                  <TipRow title="PIN visible" body="Keep the strip in view until the class roster stops changing." />
                  <TipRow title="Roster stable" body="Watch for late joiners before starting question one." />
                  <TipRow title="Pack confirmed" body="Make sure the current pack title matches the lesson you intend to run." />
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
                                  className="rounded-[1.4rem] border-2 border-brand-dark bg-white p-4 flex items-center gap-4"
                                >
                                  <Avatar 
                                    nickname={participant.nickname} 
                                    imgClassName="w-12 h-12" 
                                    textClassName="font-black text-lg"
                                  />
                                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 ml-14 -mt-4">Seat {participant.seat_index || index + 1}</p>

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
                            className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-4 flex items-center gap-4"
                          >
                            <Avatar 
                              nickname={participant.nickname} 
                              imgClassName="w-12 h-12" 
                              textClassName="font-black text-lg"
                            />
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 ml-14 -mt-4">Ready in lobby</p>

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
                  <Sparkles className="w-6 h-6 text-brand-purple" />
                  <h2 className="text-3xl font-black">Host Flow</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StepCard step="1" title="Share the PIN" body="Keep the lobby open while students join from the homepage." />
                  <StepCard step="2" title="Watch the room" body="New names appear instantly so you can see when the class is ready." />
                  <StepCard step="3" title="Launch cleanly" body="Start once the room looks stable. Analytics unlock after the session ends." />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-brand-yellow rounded-[2.4rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-7"
              >
                <div className="flex items-center gap-3 mb-5">
                  <AlertTriangle className="w-6 h-6 text-brand-orange" />
                  <h2 className="text-3xl font-black">Host Tips</h2>
                </div>
                <div className="space-y-3">
                  <TipRow title="Best launch timing" body="Wait until the room is stable, then start immediately to keep attention high." />
                  <TipRow title="If someone is late" body="They can still join before the first question starts as long as the lobby stays open." />
                  <TipRow title="After the game" body="You will land in the class analytics dashboard with student drill-down and adaptive follow-up tools." />
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
                  {nickname} lost focus!
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
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
          <motion.h2
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-4xl font-black text-center text-slate-900 mb-12 bg-white px-10 py-6 rounded-3xl shadow-sm border border-slate-200"
          >
            {currentQuestion?.prompt}
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-12">
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
            <div className="text-slate-500 font-bold text-xl bg-slate-100 px-6 py-2 rounded-xl">Leaderboard</div>
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

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', bounce: 0.6 }}
            className="bg-indigo-100 p-6 rounded-full mb-6"
          >
            <BarChart3 className="w-16 h-16 text-indigo-600" />
          </motion.div>
          <h2 className="text-5xl font-black text-slate-900 mb-12 tracking-tight">Current Standings</h2>

          <div className="w-full max-w-3xl bg-white rounded-[3rem] shadow-2xl border border-slate-100 p-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-bl-full -z-10"></div>
            {isTeamMode && teamBoard.length > 0 ? (
              <div className="space-y-4">
                {teamBoard.slice(0, 5).map((team: any, i: number) => (
                  <motion.div
                    initial={{ x: -50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1, type: 'spring' }}
                    key={team.team_id || team.team_name}
                    className={`p-6 rounded-2xl border-2 ${i === 0 ? 'bg-yellow-50 border-yellow-200 shadow-md' : i === 1 ? 'bg-slate-50 border-slate-200' : i === 2 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}
                  >
                    <div className="flex items-center justify-between gap-6 mb-3">
                      <div className="flex items-center gap-6">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-2xl ${i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-indigo-100 text-indigo-600'}`}>
                          {i + 1}
                        </div>
                        <div>
                          <span className="text-3xl font-black text-slate-900">{team.team_name}</span>
                          <p className="text-sm font-bold text-slate-500">{team.student_count} players · {team.accuracy?.toFixed?.(0) || team.accuracy}% accuracy</p>
                        </div>
                      </div>
                      <div className="text-4xl font-black text-indigo-600">{team.total_score || 0}</div>
                    </div>
                    {(gameMode.id === 'mastery_matrix' || gameMode.id === 'peer_pods') && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {typeof team.coverage_score !== 'undefined' && (
                          <span className="px-3 py-2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-black">
                            Coverage {team.coverage_score}%
                          </span>
                        )}
                        {typeof team.consensus_index !== 'undefined' && (
                          <span className="px-3 py-2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-sm font-black">
                            Consensus {team.consensus_index}%
                          </span>
                        )}
                        {typeof team.mode_bonus !== 'undefined' && (
                          <span className="px-3 py-2 rounded-full bg-brand-yellow text-brand-dark border border-brand-dark text-sm font-black">
                            Bonus {team.mode_bonus}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-sm font-medium text-slate-500">
                      {(team.members || []).slice(0, 5).map((member: any) => member.nickname || member).join(', ')}
                    </p>
                  </motion.div>
                ))}
              </div>
            ) : leaderboard.length > 0 ? (
              <div className="space-y-4">
                {leaderboard.slice(0, 5).map((p: any, i: number) => (
                  <motion.div
                    initial={{ x: -50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1, type: 'spring' }}
                    key={p.id}
                    className={`flex items-center justify-between p-6 rounded-2xl border-2 ${i === 0 ? 'bg-yellow-50 border-yellow-200 shadow-md' : i === 1 ? 'bg-slate-50 border-slate-200' : i === 2 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}
                  >
                    <div className="flex items-center gap-6">
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-2xl ${i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-orange-900' : 'bg-indigo-100 text-indigo-600'}`}>
                        {i + 1}
                      </div>
                      <span className="text-3xl font-black text-slate-900">{p.nickname}</span>
                    </div>
                    <div className="text-4xl font-black text-indigo-600">{p.total_score || 0}</div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center text-slate-500 py-12 text-xl font-medium">Loading leaderboard...</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
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

function StepCard({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="rounded-[1.75rem] border-2 border-brand-dark bg-brand-bg p-5">
      <div className="w-10 h-10 rounded-full bg-brand-dark text-white border-2 border-brand-dark flex items-center justify-center font-black mb-4">
        {step}
      </div>
      <p className="text-xl font-black mb-2">{title}</p>
      <p className="font-medium text-brand-dark/65">{body}</p>
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
