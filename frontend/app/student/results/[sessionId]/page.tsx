"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Award, MedalStar, Star1 } from "iconsax-react";
import { motion } from "framer-motion";

import { api } from "@/lib/api-client";

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [score, setScore] = useState(0);

  const nickname = typeof window !== "undefined" ? localStorage.getItem("quizzy_student_nickname") ?? "Student" : "Student";

  useEffect(() => {
    api
      .getLeaderboard(sessionId)
      .then((leaderboard) => {
        const rows = (leaderboard as { items: Array<{ nickname: string; score: number }> }).items;
        const me = rows.find((row) => row.nickname === nickname);
        setScore(me?.score ?? 0);
      })
      .catch(() => setScore(0));
  }, [nickname, sessionId]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
        className="space-y-4"
      >
        <div className="relative inline-flex mx-auto">
          <div className="absolute inset-0 bg-gold/30 blur-2xl rounded-full" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-gold/30 to-gold/10 border border-gold/30 flex items-center justify-center shadow-gold">
            <MedalStar size={48} variant="Bold" className="text-gold" />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-bold text-slate uppercase tracking-widest">Your Score</p>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-7xl font-black text-ink tracking-tighter gradient-text"
          >
            {score ?? 0}
          </motion.p>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          <p className="text-xl font-bold text-ink">
            {(score ?? 0) > 0 ? "Awesome work!" : "Good effort!"}
          </p>
          <p className="text-slate mt-1 text-sm max-w-xs mx-auto leading-relaxed">
            {(score ?? 0) > 0
              ? "You answered questions live. Every one counts!"
              : "Playing is the first step. You'll get more next time!"}
          </p>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="w-full max-w-sm"
      >
        <div className="glass-premium rounded-2xl border border-ink/15 p-5 space-y-3">
          <div className="flex items-start gap-3 text-left">
            <Star1 size={18} variant="Bold" className="text-gold shrink-0 mt-0.5" />
            <p className="text-sm text-slate leading-relaxed">
              Your teacher will share next steps and follow-up practice based on how the class did.
            </p>
          </div>
          <div className="flex items-start gap-3 text-left">
            <Award size={18} variant="Bold" className="text-accent shrink-0 mt-0.5" />
            <p className="text-sm text-slate leading-relaxed">
              Class rankings and analytics are visible to your teacher.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
