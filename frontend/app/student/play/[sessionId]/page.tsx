"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Activity, Chart, Clock, Flash, WifiSquare } from "iconsax-react";

import { AnswerPanel } from "@/components/student/answer-panel";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { enqueueResponse, flushResponses, pendingCount } from "@/lib/response-queue";
import type { StudentLiveMetrics } from "@/lib/schemas";
import { connectStudentSessionWithRetry } from "@/lib/ws-client";

type PlayQuestion = { stem: string; options: Array<{ id: string; key: string; text: string }> };

export default function StudentPlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const [question, setQuestion] = useState<PlayQuestion | null>(null);
  const [participantToken, setParticipantToken] = useState("");
  const [connection, setConnection] = useState("connecting");
  const [pending, setPending] = useState(0);
  const [personalMetrics, setPersonalMetrics] = useState<StudentLiveMetrics | null>(null);

  const refreshPending = () => setPending(pendingCount(sessionId));

  const flushPending = useMemo(
    () => async () => {
      if (!participantToken) return;
      await flushResponses(sessionId, async (item) => {
        await api.submitResponse(sessionId, {
          participant_token: item.participantToken,
          option_id: item.optionId,
          latency_ms: item.latencyMs,
          client_response_id: item.clientResponseId
        });
      });
      refreshPending();
    },
    [participantToken, sessionId]
  );

  useEffect(() => {
    const token = localStorage.getItem("quizzy_student_token") ?? "";
    setParticipantToken(token);
    refreshPending();

    const raw = localStorage.getItem("quizzy_current_question");
    if (raw) setQuestion(JSON.parse(raw) as PlayQuestion);

    const lastSeq = Number(localStorage.getItem("quizzy_student_last_seq") ?? "0");
    const stop = connectStudentSessionWithRetry(
      sessionId,
      token,
      (event) => {
        localStorage.setItem("quizzy_student_last_seq", String(event.seq));
        if (event.type === "question_opened") {
          const payload = event.payload as PlayQuestion;
          localStorage.setItem("quizzy_current_question", JSON.stringify(payload));
          setQuestion(payload);
        }
        if (event.type === "session_ended") router.push(`/student/results/${sessionId}`);
      },
      lastSeq,
      (status) => setConnection(status)
    );

    const pullPersonalMetrics = async () => {
      if (!token) return;
      try {
        const metrics = await api.getStudentLiveMetrics(sessionId, token);
        setPersonalMetrics(metrics);
      } catch {
        // noop
      }
    };
    void pullPersonalMetrics();

    const queueInterval = window.setInterval(() => {
      void flushPending();
    }, 2000);

    const metricInterval = window.setInterval(() => {
      void pullPersonalMetrics();
    }, 4000);

    const onOnline = () => {
      void flushPending();
      void pullPersonalMetrics();
    };
    window.addEventListener("online", onOnline);

    return () => {
      stop();
      clearInterval(queueInterval);
      clearInterval(metricInterval);
      window.removeEventListener("online", onOnline);
    };
  }, [flushPending, router, sessionId]);

  if (!question) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-slate">Waiting for question...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MiniMetric label="Connection" value={connection} icon={<WifiSquare size={14} />} />
        <MiniMetric label="Pending" value={String(pending)} icon={<Clock size={14} />} />
        <MiniMetric label="Score" value={personalMetrics ? String(personalMetrics.score) : "--"} icon={<Flash size={14} />} />
      </div>

      {personalMetrics ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs text-slate">
            <span className="inline-flex items-center gap-1">
              <Chart size={14} />
              Rank: #{personalMetrics.rank}
            </span>
            <span>Score: {personalMetrics.score}</span>
            <span>
              Progress: {personalMetrics.answered_count}/{personalMetrics.total_questions}
            </span>
          </CardContent>
        </Card>
      ) : null}

      <AnswerPanel
        question={question}
        onAnswer={async (optionId) => {
          const response = {
            sessionId,
            participantToken,
            optionId,
            latencyMs: 900,
            clientResponseId: crypto.randomUUID(),
            createdAt: Date.now()
          };
          enqueueResponse(response);
          refreshPending();
          await flushPending();
        }}
      />

      <Card className="border-dashed border-ink/20 bg-bg/35">
        <CardContent className="inline-flex items-center gap-2 py-3 text-xs text-slate">
          <Activity size={13} />
          Offline-safe mode: responses are queued locally and synced on reconnect.
        </CardContent>
      </Card>
    </div>
  );
}

function MiniMetric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate">
          <span className="text-accent">{icon}</span>
          {label}
        </p>
        <p className="text-sm font-semibold text-ink">{value}</p>
      </CardContent>
    </Card>
  );
}
