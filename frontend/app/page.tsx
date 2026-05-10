"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Teacher, Game, Flash, ScanBarcode, DocumentText, StatusUp } from "iconsax-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const HOW_IT_WORKS = [
  {
    Icon: DocumentText,
    title: "Upload your material",
    description: "Paste lesson notes or any text. Quizzi reads it and builds questions automatically.",
  },
  {
    Icon: Flash,
    title: "Run the live quiz",
    description: "Share the PIN. Students join on any device. Questions appear in real time.",
  },
  {
    Icon: StatusUp,
    title: "See the results",
    description: "Get instant insight into which topics your class understood — and which need more work.",
  },
];

const FEATURES = [
  {
    Icon: Flash,
    iconBg: "rgba(46,211,183,0.12)",
    iconColor: "#2ed3b7",
    title: "AI question generation",
    description: "Paste any text and get quality quiz questions in seconds. No prep time needed.",
  },
  {
    Icon: StatusUp,
    iconBg: "rgba(100,181,255,0.12)",
    iconColor: "#64b5ff",
    title: "Live class analytics",
    description: "See exactly which students answered correctly — question by question, in real time.",
  },
  {
    Icon: Teacher,
    iconBg: "rgba(244,181,70,0.12)",
    iconColor: "#f4b546",
    title: "Teaching follow-up",
    description: "After each session, get a ready-to-use action plan: who needs help and how to reteach.",
  },
];

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

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-20 w-full max-w-5xl"
      >
        <div className="text-center mb-10">
          <p className="text-[11px] font-bold text-slate uppercase tracking-widest mb-2">Simple by design</p>
          <h2 className="text-3xl font-bold text-ink">How it works</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.08 }}
            >
              <GlassCard variant="default" className="p-6 h-full border-ink/10 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center text-xs font-black text-accent">
                    {i + 1}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                    <step.Icon size={22} variant="Bold" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-ink text-lg">{step.title}</h3>
                  <p className="text-slate text-sm mt-1 leading-relaxed">{step.description}</p>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Feature highlights */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="mt-10 w-full max-w-5xl"
      >
        <div className="grid md:grid-cols-3 gap-5">
          {FEATURES.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.72 + i * 0.07 }}
            >
              <GlassCard variant="default" className="p-5 border-ink/10 flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: feat.iconBg }}
                >
                  <feat.Icon size={22} variant="Bold" style={{ color: feat.iconColor }} />
                </div>
                <div>
                  <h4 className="font-bold text-ink text-sm">{feat.title}</h4>
                  <p className="text-slate text-xs mt-1 leading-relaxed">{feat.description}</p>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
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
