"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Game, ScanBarcode } from "iconsax-react";
import { motion } from "framer-motion";

import { JoinForm } from "@/components/student/join-form";
import { GlassCard } from "@/components/ui/glass-card";
import { api } from "@/lib/api-client";

export default function StudentJoinPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate text-center mt-20">Loading Lobby...</p>}>
      <StudentJoinContent />
    </Suspense>
  );
}

function StudentJoinContent() {
  const router = useRouter();
  const search = useSearchParams();
  const pinFromQuery = search.get("pin") ?? "";

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <GlassCard variant="default" className="p-8 border-gold/20 shadow-[0_20px_50px_rgba(245,158,11,0.1)]">
          <div className="text-center mb-8">
            <div className="w-20 h-20 rounded-3xl bg-gold mx-auto flex items-center justify-center text-bg mb-6 shadow-gold animate-pulse-glow">
              <Game size={32} variant="Bold" />
            </div>
            <h1 className="text-4xl font-bold text-ink tracking-tight">Join the Game</h1>
            <p className="text-slate mt-2">Enter your PIN and pick a nickname to jump in.</p>
          </div>

          <JoinForm
            initialPin={pinFromQuery}
            onSubmit={async (pin, nickname, teamName) => {
              const res = await api.joinSessionWithTeam(pin, nickname, teamName);
              localStorage.setItem("quizzy_student_session", res.session_id);
              localStorage.setItem("quizzy_student_token", res.participant_token);
              localStorage.setItem("quizzy_student_nickname", nickname);
              if (teamName) localStorage.setItem("quizzy_student_team", teamName);
              router.push(`/student/waiting/${res.session_id}`);
            }}
          />

          <div className="mt-8 pt-8 border-t border-ink/15 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-slate/60 px-4 py-2 rounded-full bg-bg/40 border border-ink/15">
              <ScanBarcode size={18} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Or Scan Teacher's QR</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
