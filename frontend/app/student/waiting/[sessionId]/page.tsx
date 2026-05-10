"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Clock } from "iconsax-react";
import { motion } from "framer-motion";

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

  const nickname =
    typeof window !== "undefined"
      ? (localStorage.getItem("quizzy_student_nickname") ?? "")
      : "";

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
      {/* Animated waiting indicator */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative mb-10"
      >
        <div className="absolute inset-0 rounded-full bg-accent/20 animate-ping" style={{ animationDuration: "1.8s" }} />
        <div className="absolute inset-2 rounded-full bg-accent/10 animate-pulse" />
        <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-accent/30 to-accent/10 border border-accent/30 flex items-center justify-center shadow-accent">
          <Clock size={52} variant="Bold" className="text-accent" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="space-y-3 mb-8"
      >
        {nickname ? (
          <p className="text-sm font-bold text-slate uppercase tracking-widest">
            Ready, {nickname}!
          </p>
        ) : null}
        <h1 className="text-4xl font-bold text-ink tracking-tight">Get ready!</h1>
        <p className="text-slate text-lg max-w-sm mx-auto leading-relaxed">
          Your teacher is about to launch the next question. Stay sharp!
        </p>
      </motion.div>

      {/* Bouncing dots */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-2 mb-8"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
            className="w-3 h-3 rounded-full bg-accent"
          />
        ))}
      </motion.div>

      {/* Connection status */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <div className="glass inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ink/15">
          <span className="text-xs font-bold text-slate uppercase tracking-widest">
            {connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting..." : String(connection)}
          </span>
          {connection === "connected" && (
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          )}
        </div>
      </motion.div>
    </div>
  );
}
