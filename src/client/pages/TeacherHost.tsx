import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
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

const HOST_ANSWER_TONES = [
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
    bg: '#78C6FF',
    text: '#1A1A1A',
    hover: '#4BA9F0',
    hoverText: '#1A1A1A',
    sweep: '#B488FF',
    shadow: '#1A1A1A',
    hoverShadow: '#1F6FA8',
  },
] as const;

function buildHostAnswerToneStyle(index: number): CSSProperties {
  const tone = HOST_ANSWER_TONES[index % HOST_ANSWER_TONES.length];
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

function buildMutedHostAnswerToneStyle(): CSSProperties {
  return {
    ['--student-answer-bg' as string]: '#F3F4F6',
    ['--student-answer-text' as string]: '#1A1A1A',
    ['--student-answer-hover-bg' as string]: '#F3F4F6',
    ['--student-answer-hover-text' as string]: '#1A1A1A',
    ['--student-answer-sweep' as string]: '#E5E7EB',
    ['--student-answer-shadow' as string]: '#D1D5DB',
    ['--student-answer-hover-shadow' as string]: '#D1D5DB',
  };
}

function TeacherHostSendGamesButton({
  state,
  onClick,
  disabled,
  className = '',
}: {
  state: 'idle' | 'sending' | 'sent';
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = state === 'sent' ? 'Games Sent' : state === 'sending' ? 'Sending Games' : 'Send Personal Games';
  const letters = label.replace(/\s/g, '').split('');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-state={state}
      className={`teacher-host-send-button ${className}`}
    >
      <div className="teacher-host-send-button__outline" />
      <div className="teacher-host-send-button__surface" />
      <div className="teacher-host-send-button__state teacher-host-send-button__state--default">
        <div className="teacher-host-send-button__icon" aria-hidden="true">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g style={{ filter: 'url(#teacher-host-send-shadow)' }}>
              <path d="M14.2199 21.63C13.0399 21.63 11.3699 20.8 10.0499 16.83L9.32988 14.67L7.16988 13.95C3.20988 12.63 2.37988 10.96 2.37988 9.78001C2.37988 8.61001 3.20988 6.93001 7.16988 5.60001L15.6599 2.77001C17.7799 2.06001 19.5499 2.27001 20.6399 3.35001C21.7299 4.43001 21.9399 6.21001 21.2299 8.33001L18.3999 16.82C17.0699 20.8 15.3999 21.63 14.2199 21.63ZM7.63988 7.03001C4.85988 7.96001 3.86988 9.06001 3.86988 9.78001C3.86988 10.5 4.85988 11.6 7.63988 12.52L10.1599 13.36C10.3799 13.43 10.5599 13.61 10.6299 13.83L11.4699 16.35C12.3899 19.13 13.4999 20.12 14.2199 20.12C14.9399 20.12 16.0399 19.13 16.9699 16.35L19.7999 7.86001C20.3099 6.32001 20.2199 5.06001 19.5699 4.41001C18.9199 3.76001 17.6599 3.68001 16.1299 4.19001L7.63988 7.03001Z" fill="currentColor" />
              <path d="M10.11 14.4C9.92005 14.4 9.73005 14.33 9.58005 14.18C9.29005 13.89 9.29005 13.41 9.58005 13.12L13.16 9.53C13.45 9.24 13.93 9.24 14.22 9.53C14.51 9.82 14.51 10.3 14.22 10.59L10.64 14.18C10.5 14.33 10.3 14.4 10.11 14.4Z" fill="currentColor" />
            </g>
            <defs>
              <filter id="teacher-host-send-shadow">
                <feDropShadow dx="0" dy="1" stdDeviation="0.6" floodOpacity="0.5" />
              </filter>
            </defs>
          </svg>
        </div>
        <p>
          {letters.map((letter, index) => (
            <span key={`${letter}-${index}`} style={{ ['--i' as string]: index } as React.CSSProperties}>
              {letter}
            </span>
          ))}
        </p>
      </div>
      <div className="teacher-host-send-button__state teacher-host-send-button__state--sent">
        <div className="teacher-host-send-button__icon" aria-hidden="true">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p>
          <span style={{ ['--i' as string]: 0 } as React.CSSProperties}>S</span>
          <span style={{ ['--i' as string]: 1 } as React.CSSProperties}>e</span>
          <span style={{ ['--i' as string]: 2 } as React.CSSProperties}>n</span>
          <span style={{ ['--i' as string]: 3 } as React.CSSProperties}>t</span>
        </p>
      </div>
    </button>
  );
}

function TeacherHostPhaseButton({
  label,
  onClick,
  disabled,
  tone = 'dark',
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'dark' | 'success';
  icon?: React.ReactNode;
}) {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.03 }}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`student-play-submit-button student-play-submit-button--host ${tone === 'success' ? 'student-play-submit-button--success' : ''}`}
    >
      <span className="student-play-submit-button__text">{label}</span>
      <span className="student-play-submit-button__icon" aria-hidden="true">
        {icon || (
          <svg xmlns="http://www.w3.org/2000/svg" width="50" height="20" viewBox="0 0 38 15" fill="none">
            <path
              fill="currentColor"
              d="M10 7.519l-.939-.344h0l.939.344zm14.386-1.205l-.981-.192.981.192zm1.276 5.509l.537.843.148-.094.107-.139-.792-.611zm4.819-4.304l-.385-.923h0l.385.923zm7.227.707a1 1 0 0 0 0-1.414L31.343.448a1 1 0 0 0-1.414 0 1 1 0 0 0 0 1.414l5.657 5.657-5.657 5.657a1 1 0 0 0 1.414 1.414l6.364-6.364zM1 7.519l.554.833.029-.019.094-.061.361-.23 1.277-.77c1.054-.609 2.397-1.32 3.629-1.787.617-.234 1.17-.392 1.623-.455.477-.066.707-.008.788.034.025.013.031.021.039.034a.56.56 0 0 1 .058.235c.029.327-.047.906-.39 1.842l1.878.689c.383-1.044.571-1.949.505-2.705-.072-.815-.45-1.493-1.16-1.865-.627-.329-1.358-.332-1.993-.244-.659.092-1.367.305-2.056.566-1.381.523-2.833 1.297-3.921 1.925l-1.341.808-.385.245-.104.068-.028.018c-.011.007-.011.007.543.84zm8.061-.344c-.198.54-.328 1.038-.36 1.484-.032.441.024.94.325 1.364.319.45.786.64 1.21.697.403.054.824-.001 1.21-.09.775-.179 1.694-.566 2.633-1.014l3.023-1.554c2.115-1.122 4.107-2.168 5.476-2.524.329-.086.573-.117.742-.115s.195.038.161.014c-.15-.105.085-.139-.076.685l1.963.384c.192-.98.152-2.083-.74-2.707-.405-.283-.868-.37-1.28-.376s-.849.069-1.274.179c-1.65.43-3.888 1.621-5.909 2.693l-2.948 1.517c-.92.439-1.673.743-2.221.87-.276.064-.429.065-.492.057-.043-.006.066.003.155.127.07.099.024.131.038-.063.014-.187.078-.49.243-.94l-1.878-.689zm14.343-1.053c-.361 1.844-.474 3.185-.413 4.161.059.95.294 1.72.811 2.215.567.544 1.242.546 1.664.459a2.34 2.34 0 0 0 .502-.167l.15-.076.049-.028.018-.011c.013-.008.013-.008-.524-.852l-.536-.844.019-.012c-.038.018-.064.027-.084.032-.037.008.053-.013.125.056.021.02-.151-.135-.198-.895-.046-.734.034-1.887.38-3.652l-1.963-.384zm2.257 5.701l.791.611.024-.031.08-.101.311-.377 1.093-1.213c.922-.954 2.005-1.894 2.904-2.27l-.771-1.846c-1.31.547-2.637 1.758-3.572 2.725l-1.184 1.314-.341.414-.093.117-.025.032c-.01.013-.01.013.781.624zm5.204-3.381c.989-.413 1.791-.42 2.697-.307.871.108 2.083.385 3.437.385v-2c-1.197 0-2.041-.226-3.19-.369-1.114-.139-2.297-.146-3.715.447l.771 1.846z"
            />
          </svg>
        )}
      </span>
    </motion.button>
  );
}

type HostedParticipant = {
  id: number;
  nickname: string;
  team_id: number;
  team_name: string | null;
  seat_index: number;
  created_at: string | null;
  online: boolean;
  student_user_id: number | null;
  class_student_id: number | null;
  join_mode: string;
  display_name_snapshot: string;
  account_linked: boolean;
  profile_mode: 'longitudinal' | 'session-only';
  class_student_name: string;
  class_student_email: string;
  invite_status: string;
  score: number;
  correctCount: number;
  answeredCount: number;
};

function normalizeHostedParticipant(value: any, fallback?: Partial<HostedParticipant>): HostedParticipant {
  const participant = value && typeof value === 'object' ? value : {};
  return {
    id: Number(participant.id || participant.participantId || fallback?.id || 0),
    nickname: String(participant.nickname || fallback?.nickname || ''),
    team_id: Number(participant.team_id || participant.teamId || fallback?.team_id || 0),
    team_name: participant.team_name ?? participant.teamName ?? fallback?.team_name ?? null,
    seat_index: Number(participant.seat_index || participant.seatIndex || fallback?.seat_index || 0),
    created_at: participant.created_at || participant.createdAt || fallback?.created_at || null,
    online: typeof participant.online === 'boolean' ? participant.online : fallback?.online ?? true,
    student_user_id:
      Number(participant.student_user_id || participant.studentUserId || fallback?.student_user_id || 0) || null,
    class_student_id:
      Number(participant.class_student_id || participant.classStudentId || fallback?.class_student_id || 0) || null,
    join_mode: String(participant.join_mode || participant.joinMode || fallback?.join_mode || 'anonymous'),
    display_name_snapshot: String(
      participant.display_name_snapshot ||
        participant.displayNameSnapshot ||
        fallback?.display_name_snapshot ||
        participant.nickname ||
        '',
    ),
    account_linked:
      typeof participant.account_linked === 'boolean'
        ? participant.account_linked
        : typeof participant.accountLinked === 'boolean'
          ? participant.accountLinked
          : Boolean(
              Number(participant.student_user_id || participant.studentUserId || fallback?.student_user_id || 0),
            ) || Boolean(fallback?.account_linked),
    profile_mode:
      String(
        participant.profile_mode ||
          participant.profileMode ||
          fallback?.profile_mode ||
          (Number(participant.student_user_id || participant.studentUserId || fallback?.student_user_id || 0) > 0
            ? 'longitudinal'
            : 'session-only'),
      ) === 'longitudinal'
        ? 'longitudinal'
        : 'session-only',
    class_student_name: String(
      participant.class_student_name || participant.classStudentName || fallback?.class_student_name || '',
    ),
    class_student_email: String(
      participant.class_student_email || participant.classStudentEmail || fallback?.class_student_email || '',
    ),
    invite_status: String(participant.invite_status || participant.inviteStatus || fallback?.invite_status || 'none'),
    score: Number(participant.score ?? participant.total_score ?? fallback?.score ?? 0),
    correctCount: Number(
      participant.correctCount ??
      participant.correct_count ??
      participant.correct_answers ??
      fallback?.correctCount ??
      0,
    ),
    answeredCount: Math.max(
      Number(
        participant.answeredCount ??
        participant.answered_count ??
        participant.answersSubmitted ??
        participant.answers_submitted ??
        participant.questions_attempted ??
        participant.attempted_count ??
        participant.total_answers ??
        fallback?.answeredCount ??
        0,
      ),
      Number(
        participant.correctCount ??
        participant.correct_count ??
        participant.correct_answers ??
        fallback?.correctCount ??
        0,
      ),
    ),
  };
}

function serializeParticipantRoster(participants: HostedParticipant[]) {
  return participants
    .map((participant) =>
      [
        participant.id,
        participant.nickname,
        participant.team_id,
        participant.team_name || '',
        participant.online ? 1 : 0,
        participant.account_linked ? 1 : 0,
        participant.profile_mode,
        participant.join_mode,
        participant.class_student_id || 0,
        participant.class_student_email || '',
      ].join(':'),
    )
    .join('|');
}

function toRealtimeParticipant(participant: HostedParticipant) {
  return {
    participantId: participant.id,
    nickname: participant.nickname,
    teamId: participant.team_id,
    teamName: participant.team_name,
    seatIndex: participant.seat_index,
    createdAt: participant.created_at,
    online: participant.online,
    studentUserId: participant.student_user_id,
    classStudentId: participant.class_student_id,
    joinMode: participant.join_mode,
    displayNameSnapshot: participant.display_name_snapshot,
    accountLinked: participant.account_linked,
    profileMode: participant.profile_mode,
    classStudentName: participant.class_student_name,
    classStudentEmail: participant.class_student_email,
    inviteStatus: participant.invite_status,
  };
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
  const [participants, setParticipants] = useState<HostedParticipant[]>([]);
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
  const [authoritativeQuestionPayload, setAuthoritativeQuestionPayload] = useState<Record<string, unknown> | null>(null);
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
  const answeredParticipantIdsRef = useRef<Set<number>>(new Set());
  const participantRefreshTimeoutRef = useRef<number | null>(null);

  // Transition tracking moved fully to Effects

  const gameMode = getGameMode(sessionMeta?.game_type);
  const gameTone = getGameModeTone(gameMode.id);
  const isTeamMode = gameMode.teamBased;
  const modeConfig = sessionMeta?.mode_config || sessionMeta?.modeConfig || {};
  const isPeerMode = isPeerInstructionMode(sessionMeta?.game_type, modeConfig);
  const discussionSeconds = Math.max(10, Number(modeConfig?.discussion_seconds || 30));
  const revoteSeconds = Math.max(8, Number(modeConfig?.revote_seconds || 22));
  const joinUrl = pin && typeof window !== 'undefined' ? buildSessionJoinUrl(pin, window.location.origin) : '';
  const groupedParticipants = participants.reduce((groups: Record<string, HostedParticipant[]>, participant) => {
    const key = participant.team_name || 'Solo';
    groups[key] = groups[key] || [];
    groups[key].push(participant);
    return groups;
  }, {});
  const currentQuestion = pack?.questions?.[questionIndex];
  const hasPersonalizedGamesReady = Boolean(
    personalizedGamesSummary
    && (Number(personalizedGamesSummary.createdCount || 0) > 0 || Number(personalizedGamesSummary.reusedCount || 0) > 0)
  );
  const linkedParticipantsCount = participants.filter((participant) => participant.account_linked).length;
  const rosterMatchedParticipantsCount = participants.filter((participant) => participant.class_student_id).length;
  const pendingRosterClaimsCount = participants.filter(
    (participant) => !!participant.class_student_email && !participant.account_linked,
  ).length;
  const refreshParticipants = React.useCallback(
    async (syncRealtime = true, updateState = true) => {
      if (!pin) return [];
      const data = await apiFetchJson(`/api/teacher/sessions/pin/${pin}/participants`);
      const nextParticipants = Array.isArray(data?.participants)
        ? data.participants.map((participant: any) => normalizeHostedParticipant(participant))
        : [];
      if (updateState) {
        setParticipants(nextParticipants);
      }
      if (syncRealtime) {
        void syncHostedParticipants(pin, nextParticipants.map(toRealtimeParticipant));
      }
      return nextParticipants;
    },
    [pin],
  );

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

  useEffect(() => () => {
    if (participantRefreshTimeoutRef.current) {
      window.clearTimeout(participantRefreshTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    setAuthoritativeQuestionPayload(null);
    answeredParticipantIdsRef.current = new Set();
  }, [pin, sessionId]);

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
    refreshParticipants()
      .catch(err => {
        console.error('[TeacherHost] Failed to fetch participants:', err);
      });
  }, [pin, refreshParticipants, sessionId]);
  
  // Polling Fallback: If SSE is unstable, we re-fetch participants every 5s while in LOBBY
  useEffect(() => {
    if (!pin || !sessionId || status !== 'LOBBY') return;

    const intervalId = window.setInterval(() => {
      refreshParticipants(false, false)
        .then((nextParticipants) => {
          // Only update if count changed or identities are different to avoid unnecessary re-renders
          setParticipants((current) => {
            const hasChanged = serializeParticipantRoster(current as HostedParticipant[]) !== serializeParticipantRoster(nextParticipants as HostedParticipant[]);
            return hasChanged ? nextParticipants : current;
          });
        })
        .catch(err => {
          console.warn('[TeacherHost] Polling fallback failed:', err);
        });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [pin, refreshParticipants, sessionId, status]);

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

  const patchParticipantLiveProgress = React.useCallback((data: any) => {
    const participantId = Number(data?.participant_id || 0);
    if (!participantId) return;

    const nextScore = Number(data?.participant_score_total);
    const isCorrect = Number(data?.is_correct || 0) === 1;
    const hasCommittedAnswer = answeredParticipantIdsRef.current.has(participantId);

    if (!hasCommittedAnswer) {
      answeredParticipantIdsRef.current.add(participantId);
    }

    const patchRow = (row: any) => {
      const rowId = Number(row?.id || row?.participant_id || row?.participantId || 0);
      if (rowId !== participantId) return row;

      const currentCorrectCount = Number(row?.correctCount ?? row?.correct_count ?? row?.correct_answers ?? 0);
      const currentAnsweredCount = Math.max(
        currentCorrectCount,
        Number(
          row?.answeredCount ??
          row?.answered_count ??
          row?.answersSubmitted ??
          row?.answers_submitted ??
          row?.questions_attempted ??
          row?.attempted_count ??
          row?.total_answers ??
          0,
        ),
      );
      const resolvedScore = Number.isFinite(nextScore)
        ? nextScore
        : Number(row?.score ?? row?.total_score ?? 0);
      const updatedCorrectCount = hasCommittedAnswer ? currentCorrectCount : currentCorrectCount + (isCorrect ? 1 : 0);
      const updatedAnsweredCount = hasCommittedAnswer ? currentAnsweredCount : currentAnsweredCount + 1;

      return {
        ...row,
        score: resolvedScore,
        total_score: resolvedScore,
        correctCount: updatedCorrectCount,
        correct_count: updatedCorrectCount,
        correct_answers: updatedCorrectCount,
        answeredCount: updatedAnsweredCount,
        answered_count: updatedAnsweredCount,
        total_answers: updatedAnsweredCount,
      };
    };

    setParticipants((prev) => prev.map(patchRow));
    setLeaderboard((prev) => (Array.isArray(prev) && prev.length ? prev.map(patchRow) : prev));

    if (participantRefreshTimeoutRef.current) {
      window.clearTimeout(participantRefreshTimeoutRef.current);
    }
    participantRefreshTimeoutRef.current = window.setTimeout(() => {
      void refreshParticipants(false, true).catch((error: any) => {
        console.error('[TeacherHost] Failed to refresh participants after answer:', error);
      });
    }, 220);
  }, [refreshParticipants]);

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
            normalizeHostedParticipant({
              id: data.participant_id,
              nickname: data.nickname,
              team_id: data.team_id,
              team_name: data.team_name,
              seat_index: data.seat_index,
              student_user_id: data.student_user_id,
              class_student_id: data.class_student_id,
              join_mode: data.join_mode,
              display_name_snapshot: data.display_name_snapshot,
              account_linked: data.account_linked,
              profile_mode: data.profile_mode,
              class_student_name: data.class_student_name,
              class_student_email: data.class_student_email,
              invite_status: data.invite_status,
              online: true,
            }),
          ],
    );
    void refreshParticipants();
  };

  const handleLiveStateChange = (data: any) => {
    const nextStatus = normalizeHostStatus(data?.status || sessionMeta?.status || 'LOBBY');
    const nextQuestionIndex = Number(data?.current_question_index ?? data?.currentQuestionIndex ?? 0);
    const nextGameType = data?.game_type || data?.gameType;
    const nextTeamCount = data?.team_count ?? data?.teamCount;
    const nextModeConfig = data?.mode_config || data?.modeConfig;
    const carriesQuestionPayload =
      nextStatus === 'QUESTION_ACTIVE' ||
      nextStatus === 'QUESTION_DISCUSSION' ||
      nextStatus === 'QUESTION_REVOTE' ||
      nextStatus === 'QUESTION_REVEAL';

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

    if (carriesQuestionPayload && data?.question) {
      setAuthoritativeQuestionPayload(data.question);
    } else if (!carriesQuestionPayload) {
      setAuthoritativeQuestionPayload(null);
    }

    if (nextStatus === 'QUESTION_ACTIVE' || nextStatus === 'QUESTION_DISCUSSION' || nextStatus === 'QUESTION_REVOTE' || nextStatus === 'LOBBY') {
      setTotalAnswers(0);
      answeredParticipantIdsRef.current = new Set();
      if (nextStatus === 'QUESTION_ACTIVE' || nextStatus === 'QUESTION_REVOTE' || nextStatus === 'LOBBY') {
        setStudentSelections({});
      }
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
        if (Number.isFinite(Number(data.participant_id)) && Number.isFinite(Number(data.chosen_index))) {
          setStudentSelections((prev) => ({
            ...prev,
            [Number(data.participant_id)]: Number(data.chosen_index),
          }));
        }
        patchParticipantLiveProgress(data);
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
        setParticipants((current) => {
          const currentById = new Map(
            current.map((participant) => [Number(participant.id || 0), normalizeHostedParticipant(participant)] as const),
          );
          return realtimeParticipants.map((participant) =>
            normalizeHostedParticipant(
              {
                id: participant.participantId,
                nickname: participant.nickname,
                team_id: participant.teamId,
                team_name: participant.teamName,
                seat_index: participant.seatIndex,
                created_at: participant.createdAt,
                online: participant.online,
                student_user_id: participant.studentUserId,
                class_student_id: participant.classStudentId,
                join_mode: participant.joinMode,
                display_name_snapshot: participant.displayNameSnapshot,
                account_linked: participant.accountLinked,
                profile_mode: participant.profileMode,
                class_student_name: participant.classStudentName,
                class_student_email: participant.classStudentEmail,
                invite_status: participant.inviteStatus,
              },
              currentById.get(Number(participant.participantId || 0)) || undefined,
            ),
          );
        });
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
  }, [patchParticipantLiveProgress, pin, sessionId]);

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
    const normalizedStatus = normalizeHostStatus(sessionMeta?.status || status);
    const shouldBroadcastQuestion =
      normalizedStatus === 'QUESTION_ACTIVE' ||
      normalizedStatus === 'QUESTION_DISCUSSION' ||
      normalizedStatus === 'QUESTION_REVOTE' ||
      normalizedStatus === 'QUESTION_REVEAL';

    if (shouldBroadcastQuestion && !authoritativeQuestionPayload) {
      return;
    }

    void writeHostedSessionMeta(pin, {
      sessionId: Number(sessionId),
      quizPackId: Number(packId || sessionMeta?.quiz_pack_id || 0),
      packTitle: pack?.title || sessionMeta?.pack_title || '',
      gameType: sessionMeta?.game_type || 'classic_quiz',
      teamCount: Number(sessionMeta?.team_count || 0),
      modeConfig,
      status: normalizedStatus,
      currentQuestionIndex: Number(sessionMeta?.current_question_index ?? questionIndex),
      question: shouldBroadcastQuestion ? authoritativeQuestionPayload : null,
      expectedParticipants: participantCountRef.current,
    });
  }, [authoritativeQuestionPayload, modeConfig, pin, sessionId, packId, pack, sessionMeta, questionIndex, status]);

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
                      <span className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                        {linkedParticipantsCount} {t('Account linked')}
                      </span>
                      {pendingRosterClaimsCount > 0 && (
                        <span className="rounded-full border-2 border-brand-dark bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                          {pendingRosterClaimsCount} {t('Unclaimed roster')}
                        </span>
                      )}
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

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_210px]">
                    <div className="rounded-[1.9rem] border-4 border-brand-dark bg-brand-purple p-3.5 shadow-[9px_9px_0px_0px_#1A1A1A] sm:p-4">
                      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 text-left text-white">
                          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/80">Room PIN</p>
                          <p className="mt-1 max-w-[26ch] text-xs font-bold leading-snug text-white/80 sm:text-sm">
                            Keep this code visible so students can join.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={copyPin}
                          className="game-action-button game-action-button--yellow w-full shrink-0 px-3 py-2 text-sm sm:w-auto"
                        >
                          {isPinCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {isPinCopied ? 'Copied' : 'Copy PIN'}
                        </button>
                      </div>

                      <div className="mx-auto grid max-w-[620px] grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-2.5">
                        {String(pin || '').split('').map((digit, index) => (
                          <motion.div
                            key={`${digit}-${index}`}
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: index * 0.08 }}
                            className="flex aspect-square min-h-[54px] items-center justify-center rounded-[0.95rem] border-4 border-brand-dark bg-white text-[clamp(1.65rem,2.35vw,3rem)] font-black leading-none shadow-[4px_4px_0px_0px_#1A1A1A] sm:min-h-[64px]"
                          >
                            {digit}
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-[1.65rem] border-4 border-brand-dark bg-brand-yellow p-3.5 shadow-[8px_8px_0px_0px_#1A1A1A]">
                        <div className="mx-auto flex aspect-square w-full max-w-[148px] items-center justify-center rounded-[1.25rem] border-2 border-brand-dark bg-white p-2.5">
                          <QRCodeSVG value={joinUrl || String(pin || '')} size={144} level="M" includeMargin />
                        </div>
                        <p className="mt-2.5 text-center text-xs font-black sm:text-sm">Scan to join instantly</p>
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
                    <div className="flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-brand-dark/60">
                      <span>{linkedParticipantsCount} {t('Account linked')}</span>
                      <span>•</span>
                      <span>{rosterMatchedParticipantsCount} {t('Roster matched')}</span>
                      <span>•</span>
                      <span>{Math.max(0, participants.length - linkedParticipantsCount)} {t('Session-only')}</span>
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
                                      <LobbyParticipantCard participant={participant} subtitle="Team Ready" t={t} />
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
                                <LobbyParticipantCard participant={participant} subtitle="Ready" t={t} />
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
              <TeacherHostPhaseButton
                label={phaseTransitionPending ? '...' : nextButtonLabel}
                onClick={() => updateState(nextStatus, questionIndex)}
                disabled={phaseTransitionPending}
                tone="dark"
              />
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
              <div className={`w-full max-w-5xl ${
                currentQuestion?.image_url
                  ? 'rounded-[2rem] border border-white/16 bg-brand-dark/52 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-md sm:rounded-[2.6rem] sm:p-6'
                  : ''
              }`}>
                <h2 className={`${activePromptClassName} text-balance text-center font-black leading-[1.05] tracking-tight ${currentQuestion?.image_url ? 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]' : 'text-brand-dark'}`}>
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
                  style={buildHostAnswerToneStyle(i)}
                  className={`student-play-answer-tile group relative flex h-full flex-col overflow-hidden rounded-[1.5rem] sm:rounded-[2rem] border-[3px] sm:border-4 border-brand-dark shadow-[6px_6px_0px_0px_#1A1A1A] ${
                    liveQuestionDensity.isUltraDense ? 'p-3 sm:p-4' : 'p-4 sm:p-6'
                  } ${isDiscussion ? 'bg-brand-dark text-white' : ''}`}
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
          
          {/* Question Reveal Hero aligned with live question layout */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative ${questionHeroFlexClass} min-h-0 w-full overflow-hidden rounded-[2.5rem] sm:rounded-[3rem] border-4 border-brand-dark bg-white shadow-[8px_8px_0px_0px_#1A1A1A]`}
          >
            {currentQuestion?.image_url && (
              <div className="absolute inset-0 z-0">
                <img
                  src={currentQuestion.image_url}
                  alt={currentPrompt}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/90 via-brand-dark/35 to-transparent" />
              </div>
            )}

            <div className={`relative z-10 flex h-full w-full flex-col items-center justify-center ${
              liveQuestionDensity.isUltraDense ? 'p-4 sm:p-6' : 'p-6 sm:p-10 lg:p-14'
            }`}>
              <div className={`w-full max-w-5xl ${
                currentQuestion?.image_url
                  ? 'rounded-[2rem] border border-white/16 bg-brand-dark/52 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-md sm:rounded-[2.6rem] sm:p-6'
                  : ''
              }`}>
                <p className={`text-balance text-center font-black leading-[1.08] tracking-tight ${
                  currentQuestion?.image_url ? 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]' : 'text-brand-dark'
                } ${
                  liveQuestionDensity.isUltraDense ? 'text-[clamp(1.2rem,1.8vw,2rem)]' : 'text-[clamp(1.5rem,2.4vw,3rem)]'
                }`}>
                  {currentQuestion?.explanation || currentAnswers[correctIndex]}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Answer Distribution Grid aligned with live answer cards */}
          <div className={`grid flex-1 min-h-0 ${answerGridHeightClass} w-full gap-2 sm:gap-4 auto-rows-fr ${answerGridColumnsClass}`}>
            {currentAnswers.map((choice: string, i: number) => {
              const isCorrect = i === correctIndex;
              const choiceResult = answerSelectionSummary[i] || { count: 0, pct: 0 };
              const selectionPct = choiceResult.pct;
              const voteCount = choiceResult.count;
              const toneColor = getReplayChoiceColor(i);

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + (i * 0.08) }}
                  style={isCorrect ? buildHostAnswerToneStyle(i) : buildMutedHostAnswerToneStyle()}
                  className={`student-play-answer-tile relative flex h-full flex-col overflow-hidden rounded-[1.5rem] border-[3px] border-brand-dark p-4 shadow-[6px_6px_0px_0px_#1A1A1A] sm:rounded-[2rem] sm:border-4 sm:p-6 ${
                    isCorrect ? 'student-play-answer-tile--selected' : ''
                  } ${isCorrect ? 'text-white' : 'opacity-95'}`}
                  data-locked="true"
                >
                  <div className="relative z-10 flex h-full items-center gap-3">
                    <div className={`flex shrink-0 items-center justify-center rounded-xl border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A] ${
                      liveQuestionDensity.isUltraDense ? 'h-9 w-9 text-base' : 'h-12 w-12 text-xl'
                    } ${isCorrect ? 'bg-white/10 text-white' : 'bg-white text-brand-dark/55'}`}>
                      {formatAnswerSlotLabel(i)}
                    </div>

                    <div className="flex min-w-0 flex-1 items-center justify-center px-1 text-center">
                      <p className={`block flex-1 break-words font-black leading-tight ${
                        liveQuestionDensity.isUltraDense ? 'text-xs sm:text-sm line-clamp-3' : answerTextClass
                      }`}>
                        {choice}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className={`min-w-[4.5rem] rounded-xl border-2 bg-white px-3 py-1.5 text-center font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,0.08)] ${
                        isCorrect ? 'border-emerald-700/30 text-emerald-600' : 'border-brand-dark/10 text-brand-dark/60'
                      }`}>
                        <span className="text-base sm:text-xl">{selectionPct}%</span>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${
                        isCorrect ? 'text-white/75' : 'text-brand-dark/40'
                      }`}>
                        {voteCount} votes
                      </span>
                    </div>
                  </div>

                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${selectionPct}%` }}
                    className={`absolute bottom-0 left-0 h-1.5 opacity-20 ${
                      isCorrect ? 'bg-white' : 'bg-brand-dark'
                    }`}
                  />
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
    const compactPodium = podiumRows.length <= 1;

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
                <TeacherHostSendGamesButton
                  state={hasPersonalizedGamesReady ? 'sent' : isCreatingPersonalizedGames ? 'sending' : 'idle'}
                  onClick={() => void handleCreatePersonalizedGames()}
                  disabled={isCreatingPersonalizedGames || hasPersonalizedGamesReady}
                  className="hidden sm:flex"
                />
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
            className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[2.4rem] border border-brand-dark/10 bg-white/92 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-xl"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(120,160,255,0.16),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(255,214,95,0.16),_transparent_24%),linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(245,249,255,0.96)_100%)]" />
            <div className="absolute right-10 top-10 h-32 w-32 rounded-full bg-brand-purple/10 blur-3xl" />
            <div className="absolute left-10 bottom-10 h-28 w-28 rounded-full bg-brand-yellow/20 blur-3xl" />

            <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 p-3 sm:gap-3 sm:p-4 lg:p-5">
              <div className="shrink-0">
                <div className="mb-1.5 flex items-center gap-2.5 text-brand-purple/70">
                  <span className="h-[2px] w-6 bg-brand-purple/15" />
                  <span className="text-[11px] font-black uppercase tracking-[0.42em]">Class Spotlight</span>
                  <span className="h-[2px] w-6 bg-brand-purple/15" />
                </div>
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="text-2xl font-black tracking-[-0.04em] text-brand-dark sm:text-3xl lg:text-4xl">
                      {boardTitle}
                    </h2>
                    <p className="mt-1 max-w-3xl text-[11px] font-bold leading-relaxed text-brand-dark/55 sm:text-xs">
                      {boardNarrative}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border-2 border-brand-dark/20 bg-brand-bg/70 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/65 shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                      Ranked Players: {rankedRows.length}
                    </div>
                    <div className="rounded-full border-2 border-brand-dark/20 bg-brand-bg/70 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-brand-dark/65 shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                      Round Accuracy: {roundAccuracyPct}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.22fr)]">
                {isLeaderboardLoading ? (
                  <div className="lg:col-span-2 flex h-full min-h-[320px] items-center justify-center rounded-[2.5rem] border border-brand-dark/10 border-dashed bg-white/95 p-12 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                    <div className="text-center">
                      <Trophy className="mx-auto mb-4 h-16 w-16 text-brand-dark/15" />
                      <p className="text-2xl font-black text-brand-dark/40">Syncing scores...</p>
                    </div>
                  </div>
                ) : rankedRows.length === 0 ? (
                  <div className="lg:col-span-2 flex h-full min-h-[320px] items-center justify-center rounded-[2.5rem] border border-brand-dark/10 border-dashed bg-white/95 p-12 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                    <div className="text-center">
                      <Users className="mx-auto mb-4 h-16 w-16 text-brand-dark/15" />
                      <p className="text-2xl font-black text-brand-dark/40">Waiting for data sync...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.45rem] border border-brand-dark/10 bg-white/96 p-2.5 shadow-[0_16px_34px_rgba(15,23,42,0.1)]">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-purple/55">Podium Spotlight</p>
                          <p className="mt-0.5 text-base font-black text-brand-dark">Top players right now</p>
                        </div>
                        <div className="rounded-full border border-brand-dark/15 bg-brand-bg/60 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-brand-dark/55 shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                          {isLast ? 'Final lock-in' : 'Live reshuffle'}
                        </div>
                      </div>
                      <div className={`relative flex flex-1 items-end justify-center rounded-[1.3rem] border border-brand-dark/8 bg-[linear-gradient(180deg,rgba(247,250,255,0.96)_0%,rgba(255,255,255,0.98)_42%,rgba(248,250,255,0.95)_100%)] px-3 ${
                        compactPodium ? 'min-h-[220px] pb-2 pt-2' : 'min-h-[250px] pb-2 pt-3'
                      }`}>
                        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-5 rounded-t-[1.2rem] border border-brand-dark/8 bg-white/70" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                          <div className="h-[2px] w-[78%] rounded-full bg-brand-dark/10" />
                        </div>
                        <div className={`relative z-10 flex w-full items-end justify-center ${
                          compactPodium ? 'gap-3' : 'gap-2.5 sm:gap-3 lg:gap-4'
                        }`}>
                          {podiumRows[1] && (
                            <PodiumStep
                              participant={podiumRows[1]}
                              rank={2}
                              height={compactPodium ? 'h-14 sm:h-16' : 'h-12 sm:h-14 lg:h-16'}
                              delay={0.12}
                              color="bg-[linear-gradient(180deg,#E7B7F4_0%,#D9A5EA_100%)]"
                              icon={<Medal className="h-5 w-5 text-brand-dark/70" />}
                            />
                          )}
                          {podiumRows[0] && (
                            <PodiumStep
                              participant={podiumRows[0]}
                              rank={1}
                              height={compactPodium ? 'h-18 sm:h-20' : 'h-15 sm:h-18 lg:h-20'}
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
                              height={compactPodium ? 'h-12 sm:h-14' : 'h-10 sm:h-12 lg:h-14'}
                              delay={0.24}
                              color="bg-[linear-gradient(180deg,#FFB9AE_0%,#F59F94_100%)]"
                              icon={<Award className="h-5 w-5 text-brand-dark/70" />}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.45rem] border border-brand-dark/10 bg-white/96 p-2.5 shadow-[0_16px_34px_rgba(15,23,42,0.1)] lg:col-start-2 lg:row-start-1">
                      <div className="mb-1.5 flex items-start justify-between gap-4">
                        <div className="flex-1 text-right">
                          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-purple/55">Game Leaderboard</p>
                          <p className="mt-0.5 text-base font-black text-brand-dark">
                            {accuracyBoard ? 'Room accuracy standings' : `Room standings after question ${questionIndex + 1}`}
                          </p>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-brand-dark/15 bg-white shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                          <BarChart3 className="h-4 w-4 text-brand-purple" />
                        </div>
                      </div>

                      <div className="mb-1.5 flex justify-start">
                        <div className="rounded-full border border-brand-dark/15 bg-brand-bg/60 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-brand-dark/55 shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                          Live Rank View
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-hidden pr-1">
                        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-2">
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
                  </>
                )}
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

          <div className="mb-8 rounded-[2rem] border-3 border-brand-dark bg-brand-bg/70 p-5 shadow-[6px_6px_0px_0px_#1A1A1A] sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-purple">Post-session follow-up</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Send a personal game to every student</h3>
                <p className="mt-2 max-w-xl text-sm font-bold leading-relaxed text-brand-dark/55 sm:text-base">
                  Build adaptive follow-up games from this live session while the misconceptions are still fresh.
                </p>
                {personalizedGamesSummary ? (
                  <p className="mt-3 text-sm font-black text-brand-dark/70">
                    {personalizedGamesSummary.createdCount} created • {personalizedGamesSummary.reusedCount} reused • {personalizedGamesSummary.failedCount} skipped
                  </p>
                ) : null}
              </div>

              <TeacherHostSendGamesButton
                state={hasPersonalizedGamesReady ? 'sent' : isCreatingPersonalizedGames ? 'sending' : 'idle'}
                onClick={() => void handleCreatePersonalizedGames()}
                disabled={isCreatingPersonalizedGames || hasPersonalizedGamesReady}
                className="w-full sm:w-auto"
              />
            </div>
          </div>

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
      <div className="z-20 mb-3 flex flex-col items-center">
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
              <Crown className="h-8 w-8 text-brand-yellow drop-shadow-[0_0_18px_rgba(255,210,51,0.55)]" />
            </motion.div>
          )}

          <div className={`rounded-[2rem] border-[3px] border-brand-dark bg-white p-1.5 shadow-[0_16px_30px_rgba(15,23,42,0.16)] ${
            isWinner ? 'ring-4 ring-brand-yellow/25' : ''
          }`}>
            <LeaderboardAvatarBadge
              nickname={nickname}
              sizeClass="h-14 w-14 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
              className="rounded-[1.35rem] border-brand-dark bg-brand-bg"
            />
          </div>

          {rank > 0 && (
            <div className={`absolute -bottom-2 -right-2 z-40 flex h-8 w-8 items-center justify-center rounded-xl border-[3px] border-brand-dark text-sm font-black shadow-[0_10px_18px_rgba(15,23,42,0.18)] ${
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
          className="mt-3 max-w-[10rem] text-center sm:max-w-[13rem]"
        >
          <p className="truncate text-sm font-black text-brand-dark sm:text-base">{extractNickname(nickname)}</p>
          <div className={`mx-auto mt-1.5 inline-flex items-center justify-center rounded-full border border-brand-dark/12 px-3 py-1.5 text-xs font-black shadow-[0_10px_22px_rgba(15,23,42,0.12)] ${
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
        <div className="absolute inset-x-0 top-0 h-6 bg-white/30 blur-lg" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),transparent_40%,rgba(0,0,0,0.06))]" />
        <div className="absolute right-0 top-0 p-3 opacity-[0.14]">
           <div className="pointer-events-none select-none text-[4.5rem] font-black leading-none text-white sm:text-[6rem]">{rank}</div>
        </div>
        {icon && (
          <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full border-[3px] border-brand-dark bg-white/90 p-1.5 text-brand-dark shadow-[0_10px_18px_rgba(15,23,42,0.18)]">
            {icon}
          </div>
        )}
        <div className="relative z-10 mt-4 text-[2.6rem] font-black leading-none text-white drop-shadow-[0_8px_18px_rgba(255,255,255,0.45)] sm:text-[3.6rem]">
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
      card: 'bg-[linear-gradient(180deg,rgba(180,136,255,0.16)_0%,rgba(255,255,255,0.96)_100%)]',
    },
    amber: {
      dot: 'bg-brand-yellow',
      value: 'text-brand-dark',
      card: 'bg-[linear-gradient(180deg,rgba(255,210,51,0.2)_0%,rgba(255,255,255,0.96)_100%)]',
    },
    emerald: {
      dot: 'bg-brand-orange',
      value: 'text-brand-dark',
      card: 'bg-[linear-gradient(180deg,rgba(255,90,54,0.14)_0%,rgba(255,255,255,0.96)_100%)]',
    },
    sky: {
      dot: 'bg-brand-dark',
      value: 'text-brand-dark',
      card: 'bg-[linear-gradient(180deg,rgba(26,26,26,0.08)_0%,rgba(255,255,255,0.96)_100%)]',
    },
  }[tone];

  return (
    <div className={`rounded-[1.15rem] border-2 border-brand-dark/15 px-2.5 py-2 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.12)] ${toneClasses.card} ${compact ? 'min-h-[84px]' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${toneClasses.dot}`} />
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-dark/45">{label}</p>
      </div>
      <p className={`mt-1.5 text-lg font-black tracking-[-0.04em] ${toneClasses.value} ${compact ? 'text-base' : 'sm:text-xl'}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-bold leading-snug text-brand-dark/56 sm:text-xs">
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
      className={`grid grid-cols-[auto,1fr,auto] items-center gap-2.5 rounded-[1.2rem] border-[3px] border-brand-dark bg-white px-3 py-2.5 shadow-[0_16px_30px_rgba(15,23,42,0.1)] sm:px-3.5 ${
        isTopThree
          ? 'ring-2 ring-brand-purple/10'
          : ''
      }`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-brand-dark text-sm font-black shadow-[0_8px_14px_rgba(15,23,42,0.14)] ${
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
        <div className="flex items-center gap-2.5">
          <LeaderboardAvatarBadge nickname={String(participant?.nickname || '')} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-brand-dark">{displayName}</p>
            <p className="mt-0.5 truncate text-xs font-bold text-brand-dark/58 sm:text-sm">{performanceLabel}</p>
          </div>
          <div className="hidden rounded-full bg-[#ececec] px-2.5 py-1 text-[11px] font-black text-brand-dark/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] md:block">
            {badgeLabel}
          </div>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-dark/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange via-brand-yellow to-brand-purple"
            style={{ width: `${Math.max(8, Math.min(100, accuracyPct || 0))}%` }}
          />
        </div>
      </div>

      <div className="text-right">
        <div className={`rounded-full border border-brand-dark/10 px-3 py-1.5 text-base font-black shadow-[0_10px_18px_rgba(15,23,42,0.1)] sm:text-lg ${
          isTopThree
            ? 'bg-[#ececec] text-brand-dark'
            : 'bg-[#ececec] text-brand-dark'
        }`}>
          XP {participant?.score || 0}
        </div>
        <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.18em] text-brand-dark/32">Score</p>
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
  t,
}: {
  participant: HostedParticipant;
  subtitle: string;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const displayName = extractNickname(participant.display_name_snapshot || participant.nickname || '');
  const rosterName =
    participant.class_student_name && participant.class_student_name.trim() !== displayName.trim()
      ? participant.class_student_name.trim()
      : '';
  const statusTone = participant.account_linked
    ? 'bg-brand-purple text-white'
    : participant.class_student_id || participant.class_student_email
      ? 'bg-brand-yellow text-brand-dark'
      : 'bg-white text-brand-dark/70';
  const statusLabel = participant.account_linked
    ? t('Account linked')
    : participant.class_student_id || participant.class_student_email
      ? t('Unclaimed roster')
      : t('Session-only');

  return (
    <div className="flex items-start gap-3">
      <Avatar
        nickname={participant.nickname}
        imgClassName="w-9 h-9 rounded-[1rem] sm:w-10 sm:h-10"
        textClassName="hidden"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-base font-black">{displayName}</p>
          <span className={`shrink-0 rounded-full border border-brand-dark px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${statusTone}`}>
            {statusLabel}
          </span>
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40">{subtitle}</p>
        {rosterName ? (
          <p className="mt-1 truncate text-xs font-bold text-brand-dark/55">
            {t('Roster matched')}: {rosterName}
          </p>
        ) : null}
        {participant.class_student_email ? (
          <p className="truncate text-[11px] font-medium text-brand-dark/45">{participant.class_student_email}</p>
        ) : null}
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
