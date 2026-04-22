"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Clock, WifiSquare } from "iconsax-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectStudentSessionWithRetry } from "@/lib/ws-client";

export default function WaitingPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const [connection, setConnection] = useState("connecting");

  useEffect(() => {
    const token = localStorage.getItem("quizzy_student_token") ?? "";
    const lastSeq = Number(localStorage.getItem("quizzy_student_last_seq") ?? "0");
    const stop = connectStudentSessionWithRetry(
      sessionId,
      token,
      (event) => {
        localStorage.setItem("quizzy_student_last_seq", String(event.seq));
        if (event.type === "question_opened") {
          localStorage.setItem("quizzy_current_question", JSON.stringify(event.payload));
          router.push(`/student/play/${sessionId}`);
        }
      },
      lastSeq,
      (status) => setConnection(status)
    );

    return () => stop();
  }, [router, sessionId]);

  return (
    <Card className="mx-auto max-w-lg overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-highlight to-card">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Clock size={18} className="text-accent" variant="Bold" />
          Waiting Room
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 py-6">
        <p className="text-sm text-ink">Waiting for teacher to launch the next question...</p>
        <p className="inline-flex w-fit items-center gap-1 rounded-full bg-ink/5 px-2 py-1 text-xs text-slate">
          <WifiSquare size={12} />
          Connection: {connection}
        </p>
      </CardContent>
    </Card>
  );
}
