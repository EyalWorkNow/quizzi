"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Teacher, Game, Flash, ScanBarcode } from "iconsax-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

export default function LandingPage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center py-12 px-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16 space-y-4"
      >
        <h1 className="text-5xl md:text-7xl font-bold text-ink tracking-tighter">
          Quizzy <span className="text-accent underline decoration-accent/30 underline-offset-8">Engine</span>
        </h1>
        <p className="text-slate text-lg md:text-xl max-w-2xl mx-auto font-medium">
          Deterministic Assessment. Real-time Intervention. <br className="hidden md:block" />
          The future of classroom intelligence is here.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-8 w-full max-w-5xl">
        {/* Teacher Portal */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Link href="/teacher/dashboard" className="group block h-full">
            <GlassCard variant="premium" className="p-8 h-full border-accent/20 bg-accent/5 group-hover:bg-accent/10 group-hover:border-accent/40 transition-all flex flex-col justify-between items-start gap-8">
              <div className="space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-bg shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                  <Teacher size={36} variant="Bold" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-ink">Teacher Portal</h2>
                  <p className="text-slate mt-2 text-lg">Ingest materials, Forge games, and analyze live signals.</p>
                </div>
              </div>
              <Button size="lg" className="w-full bg-accent text-bg hover:bg-accent/90 font-bold rounded-xl text-lg h-14">
                Build & Run Session
                <Flash size={20} variant="Bold" className="ml-2" />
              </Button>
            </GlassCard>
          </Link>
        </motion.div>

        {/* Student Portal */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Link href="/student/join" className="group block h-full">
            <GlassCard variant="default" className="p-8 h-full border-gold/20 bg-gold/5 group-hover:bg-gold/10 group-hover:border-gold/40 transition-all flex flex-col justify-between items-start gap-8">
              <div className="space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-gold flex items-center justify-center text-bg shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                  <Game size={36} variant="Bold" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-ink">Student Lobby</h2>
                  <p className="text-slate mt-2 text-lg">Enter a game PIN or scan a code to start playing instantly.</p>
                </div>
              </div>
              <Button size="lg" className="w-full bg-gold text-bg hover:bg-gold/90 font-bold rounded-xl text-lg h-14">
                Join Game Now
                <ScanBarcode size={20} variant="Bold" className="ml-2" />
              </Button>
            </GlassCard>
          </Link>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-20 flex flex-wrap justify-center gap-8 opacity-40 grayscale"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-slate">AI-Enhanced Synthesis</span>
        <span className="text-xs font-bold uppercase tracking-widest text-slate">Real-time Telemetry</span>
        <span className="text-xs font-bold uppercase tracking-widest text-slate">Pedagogical Insights</span>
      </motion.div>
    </div>
  );
}
