"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Teacher, Game, Flash, ScanBarcode } from "iconsax-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

export default function LandingPage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center py-16 px-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16 space-y-6"
      >
        <h1 className="text-5xl md:text-7xl font-bold text-ink tracking-tighter leading-tight">
          Make Learning a{" "}
          <span className="gradient-text">Game</span>
        </h1>
        <p className="text-slate text-lg md:text-xl max-w-2xl mx-auto font-medium leading-relaxed">
          Create live quizzes from any material.{" "}
          <br className="hidden md:block" />
          Students join in seconds.
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
            <GlassCard variant="premium" className="p-8 h-full border-accent/20 bg-accent/5 group-hover:bg-accent/10 group-hover:border-accent/40 group-hover:shadow-accent transition-all flex flex-col justify-between items-start gap-8">
              <div className="space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-bg shadow-accent group-hover:scale-110 transition-transform">
                  <Teacher size={36} variant="Bold" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-ink">Build &amp; Host Quizzes</h2>
                  <p className="text-slate mt-2 text-lg">Upload materials, create questions, run live sessions.</p>
                </div>
              </div>
              <Button size="lg" className="w-full bg-accent text-bg hover:bg-accent/90 font-bold rounded-xl text-lg h-14">
                Go to Dashboard
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
            <GlassCard variant="default" className="p-8 h-full border-gold/20 bg-gold/5 group-hover:bg-gold/10 group-hover:border-gold/40 group-hover:shadow-gold transition-all flex flex-col justify-between items-start gap-8">
              <div className="space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-gold flex items-center justify-center text-bg shadow-gold group-hover:scale-110 transition-transform">
                  <Game size={36} variant="Bold" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-ink">Join a Live Game</h2>
                  <p className="text-slate mt-2 text-lg">Enter your session PIN to start playing.</p>
                </div>
              </div>
              <Button size="lg" className="w-full bg-gold text-bg hover:bg-gold/90 font-bold rounded-xl text-lg h-14">
                Join Now
                <ScanBarcode size={20} variant="Bold" className="ml-2" />
              </Button>
            </GlassCard>
          </Link>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-16 flex flex-wrap justify-center gap-6"
      >
        {[
          "Used by 500+ teachers",
          "Works on any device",
          "Real-time results",
        ].map((badge) => (
          <div key={badge} className="flex items-center gap-2 px-5 py-2.5 glass rounded-full border-ink/15">
            <span className="text-accent text-sm font-bold">✓</span>
            <span className="text-xs font-bold text-slate uppercase tracking-wider">{badge}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
