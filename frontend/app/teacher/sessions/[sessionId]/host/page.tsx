"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Clock,
  Copy,
  PauseCircle,
  Play,
  PlayCircle,
  Profile2User,
  Refresh,
  ScanBarcode,
  Star1,
  StopCircle,
  UserTag
} from "iconsax-react";

import { AssistCard } from "@/components/teacher/assist-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import type { LiveSessionMetrics } from "@/lib/schemas";
import { connectTeacherSessionWithRetry } from "@/lib/ws-client";
import { useTeacherSessionStore } from "@/stores/teacher-session-store";

type LeaderboardRow = { participant_id: string; nickname: string; score: number };
type TeamRow = { team_name: string; total_score: number; members: number; avg_score: number };

export default function HostPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { events, assistCards, lastSeq, pushEvent, clear } = useTeacherSessionStore();
  const [connection, setConnection] = useState("connecting");
  const [sessionMeta, setSessionMeta] = useState<Record<string, unknown> | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<LiveSessionMetrics | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<LeaderboardRow>>([]);
  const [teamBoard, setTeamBoard] = useState<Array<TeamRow>>([]);
  const [joinAccess, setJoinAccess] = useState<{ join_url: string; qr_data_uri?: string; qr_image_url?: string } | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const refreshSession = async () => {
    const [session, metrics, teams, access] = await Promise.all([
      api.getSession(sessionId),
      api.getSessionLiveMetrics(sessionId),
      api.getTeamLeaderboard(sessionId),
      api.getJoinAccess(sessionId)
    ]);
    setSessionMeta(session as Record<string, unknown>);
    setLiveMetrics(metrics);
    setTeamBoard(teams.items ?? []);
    setJoinAccess(access as { join_url: string; qr_data_uri?: string; qr_image_url?: string });
  };

  useEffect(() => {
    clear();
    void refreshSession();
    const timer = window.setInterval(() => void refreshSession(), 3500);

    const persistedSeq = Number(localStorage.getItem(`quizzy_teacher_last_seq_${sessionId}`) ?? "0");
    const stop = connectTeacherSessionWithRetry(
      sessionId,
      (event) => {
        localStorage.setItem(`quizzy_teacher_last_seq_${sessionId}`, String(event.seq));
        pushEvent(event);

        if (event.type === "leaderboard") {
          const payload = event.payload as { items?: LeaderboardRow[] };
          setLeaderboard(payload.items ?? []);
        }

        if (event.type === "team_leaderboard") {
          const payload = event.payload as { items?: TeamRow[] };
          setTeamBoard(payload.items ?? []);
        }

        if (event.type === "dashboard_metrics") {
          const payload = event.payload as Partial<LiveSessionMetrics>;
          setLiveMetrics((prev) => {
            if (!prev) {
              void refreshSession();
              return prev;
            }
            return { ...prev, ...payload } as LiveSessionMetrics;
          });
        }

        if (
          event.type === "session_paused" ||
          event.type === "session_resumed" ||
          event.type === "session_ended" ||
          event.type === "question_opened"
        ) {
          void refreshSession();
        }
      },
      Math.max(lastSeq, persistedSeq),
      (state) => setConnection(state)
    );

    return () => {
      stop();
      clearInterval(timer);
    };
  }, [clear, lastSeq, pushEvent, sessionId]);

  const latestAssist = useMemo(() => assistCards[assistCards.length - 1], [assistCards]);
  const status = liveMetrics?.status ?? String(sessionMeta?.status ?? "lobby");
  const active = liveMetrics?.active_students ?? Number(sessionMeta?.active_count ?? 0);
  const joined = liveMetrics?.joined_students ?? Number(sessionMeta?.participants_count ?? 0);
  const participation = liveMetrics ? `${Math.round(liveMetrics.participation_rate * 100)}%` : "0%";
  const currentQuestion = liveMetrics?.current_question;
  const qrImage = joinAccess?.qr_data_uri || joinAccess?.qr_image_url || "";

  return (
    <div className="space-y-5">
      <Card className="border-0 bg-gradient-to-r from-bg via-panel to-card text-ink outline-none">
        <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between md:p-6">
          <div>
            <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-highlight px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink/90">
              <Play size={13} variant="Bold" />
              Live Host
            </p>
            <h1 className="font-[var(--font-heading)] text-2xl text-ink md:text-3xl">Run Session</h1>
            <p className="mt-1 text-sm text-ink/85">
              PIN: <strong>{String(sessionMeta?.pin ?? liveMetrics?.pin ?? "...")}</strong> - Connection: {connection}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await api.nextQuestion(sessionId);
                await refreshSession();
              }}
            >
              <PlayCircle size={15} variant="Bold" />
              Next Question
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.pauseSession(sessionId);
                await refreshSession();
              }}
            >
              <PauseCircle size={15} variant="Bold" />
              Pause
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.resumeSession(sessionId);
                await refreshSession();
              }}
            >
              <Refresh size={15} variant="Bold" />
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.endSession(sessionId);
                await refreshSession();
              }}
            >
              <StopCircle size={15} variant="Bold" />
              End Session
            </Button>
            <Link className="inline-flex items-center gap-1 rounded-full border border-ink/30 px-3 py-2 text-sm font-semibold hover:bg-highlight" href={`/teacher/sessions/${sessionId}/report`}>
              <Activity size={15} variant="Bold" />
              Open Report
            </Link>
          </div>
        </CardContent>
      </Card>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-premium p-4 border-ink/15 rounded-2xl flex flex-col md:flex-row items-center gap-4 text-sm"
      >
        <div className="flex -space-x-2">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-bg border-2 border-bg">1</div>
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-bg border-2 border-bg">2</div>
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-bg border-2 border-bg">3</div>
        </div>
        <p className="text-slate flex-1">
          <strong className="text-ink">Pro Tip:</strong> Project this screen. Once students appear in the
          <strong className="text-ink"> Joined </strong> count, click <strong className="text-ink">Next Question</strong> to begin the live assessment.
        </p>
        <div className="px-3 py-1 bg-highlight rounded-full text-[10px] font-bold text-slate uppercase tracking-widest">
          Active Live Link
        </div>
      </motion.div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label={`Status: ${status}`} value={`${active}/${joined}`} hint="Active/Joined" icon={<Profile2User size={16} variant="Bold" />} />
        <MetricCard label="Participation" value={participation} hint="Answered/Expected" icon={<Activity size={16} variant="Bold" />} />
        <MetricCard label="Teams" value={String(liveMetrics?.teams_active ?? teamBoard.length)} hint="Active teams" icon={<UserTag size={16} variant="Bold" />} />
        <MetricCard label="Reconnects" value={String(liveMetrics?.reconnect_events ?? 0)} hint="Wi-Fi signal" icon={<Refresh size={16} variant="Bold" />} />
        <MetricCard label="Assist Cards" value={String(liveMetrics?.assist_cards_count ?? 0)} hint="Triggered alerts" icon={<Star1 size={16} variant="Bold" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScanBarcode size={17} className="text-accent" variant="Bold" />
            Join Access
          </CardTitle>
          <CardDescription>Show QR on projector so students can join in one scan.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
          {qrImage ? <img alt="Session join QR" className="h-40 w-40 rounded-xl border border-ink/15 bg-bg/30 p-2" src={qrImage} /> : null}
          <div className="space-y-2 text-sm">
            <p className="max-w-xl break-all rounded-xl border border-ink/15 bg-bg/35 p-3 text-xs">{joinAccess?.join_url}</p>
            <Button
              variant="outline"
              onClick={async () => {
                if (!joinAccess?.join_url) return;
                await navigator.clipboard.writeText(joinAccess.join_url);
                setLocalMessage("Join link copied.");
              }}
            >
              <Copy size={15} variant="Bold" />
              Copy Join Link
            </Button>
            {localMessage ? <p className="text-xs text-slate">{localMessage}</p> : null}
          </div>
        </CardContent>
      </Card>

      {currentQuestion ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock size={17} className="text-accent" variant="Bold" />
              Current Question Signal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate">
            <p className="font-semibold text-ink">{currentQuestion.stem}</p>
            <p>
              Responses: {currentQuestion.responses} - Incorrect: {Math.round(currentQuestion.incorrect_rate * 100)}%
            </p>
            <p>
              Top wrong option: <strong>{currentQuestion.top_wrong_option ?? "n/a"}</strong> - Misconception: <strong>{currentQuestion.top_misconception ?? "n/a"}</strong>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {latestAssist ? (
        <AssistCard
          card={latestAssist.payload as Record<string, unknown>}
          onPause={async () => {
            await api.pauseSession(sessionId);
            await refreshSession();
          }}
          onLaunchCheck={async () => {
            await api.nextQuestion(sessionId);
            await refreshSession();
          }}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Live Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {leaderboard.slice(0, 10).map((row, idx) => (
              <div key={row.participant_id} className="flex items-center justify-between rounded-xl border border-ink/10 bg-bg/35 p-3">
                <span className="font-medium text-ink">
                  {idx + 1}. {row.nickname}
                </span>
                <strong className="text-accent">{row.score}</strong>
              </div>
            ))}
            {leaderboard.length === 0 ? <p className="text-slate">No scores yet.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Team Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {teamBoard.map((team, idx) => (
              <div key={team.team_name} className="flex items-center justify-between rounded-xl border border-ink/10 bg-bg/35 p-3">
                <span className="font-medium text-ink">
                  {idx + 1}. {team.team_name} ({team.members})
                </span>
                <strong className="text-accent">{team.total_score}</strong>
              </div>
            ))}
            {teamBoard.length === 0 ? <p className="text-slate">No teams yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live Event Stream</CardTitle>
          <CardDescription>Recent realtime events for operational visibility.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-96 space-y-2 overflow-auto text-xs">
          {events.slice(-25).map((event) => (
            <div key={event.seq} className="rounded-lg border border-ink/10 bg-bg/35 p-2">
              <strong>{event.type}</strong> #{event.seq}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-slate">
          <span className="text-accent">{icon}</span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-ink">{value}</p>
        <p className="text-xs text-slate">{hint}</p>
      </CardContent>
    </Card>
  );
}
