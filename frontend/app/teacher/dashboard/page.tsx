"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRight2,
  Book,
  Category,
  DocumentText,
  Flash,
  Logout,
  People,
  Play,
  TickCircle,
  Teacher,
  Add
} from "iconsax-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { clearToken } from "@/lib/auth";
import { api } from "@/lib/api-client";
import type { DashboardOverview } from "@/lib/schemas";

export default function DashboardPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [name, setName] = useState("Class 6A");
  const [grade, setGrade] = useState("6");
  const [classId, setClassId] = useState("");
  const [quizId, setQuizId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const classes = overview?.classes ?? [];
  const primaryClassId = classId || classes[0]?.id || "";
  const selectedClass = classes.find((row) => row.id === primaryClassId) ?? classes[0];

  const load = async () => {
    try {
      const data = await api.getDashboardOverview();
      setOverview(data);
      setClassId((prev) => prev || data.classes[0]?.id || "");
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 6000);
    return () => clearInterval(timer);
  }, []);

  const createClass = async (event: FormEvent) => {
    event.preventDefault();
    await api.createClass(name, grade);
    setMessage("Class created.");
    await load();
  };

  const startSession = async (event: FormEvent) => {
    event.preventDefault();
    const session = await api.createSession(classId, quizId);
    router.push(`/teacher/sessions/${session.id}/host`);
  };

  const activeSessions = useMemo(
    () =>
      classes
        .flatMap((c) => c.recent_sessions.map((s) => ({ ...s, className: c.name })))
        .filter((s) => s.status !== "ended"),
    [classes]
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight flex items-center gap-2">
            <Teacher size={32} variant="Bold" className="text-accent" />
            Teacher Dashboard
          </h1>
          <p className="text-slate mt-1">Good to see you. Let&apos;s build something great.</p>
        </div>
        <Button
          variant="ghost"
          className="text-slate hover:text-ink hover:bg-bg/35 border border-ink/15"
          onClick={async () => {
            await api.logout().catch(() => undefined);
            clearToken();
            router.push("/login");
          }}
        >
          <Logout size={18} variant="Bold" className="mr-2" />
          Sign Out
        </Button>
      </motion.div>

      {/* Quick Start Guide for Non-Tech Users */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GlassCard variant="premium" className="p-4 border-accent/20 bg-accent/5 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12">
            <Flash size={120} variant="Bold" className="text-accent" />
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-bg shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                <Play size={24} variant="Bold" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-ink">Ready to Start a Game?</h2>
                <p className="text-sm text-slate">Follow these 3 simple steps to get your class playing in seconds.</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-4 md:gap-8">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full border border-ink/25 flex items-center justify-center text-xs font-bold text-ink">1</div>
                <span className="text-xs font-bold text-ink uppercase tracking-wider">Select Class</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full border border-ink/25 flex items-center justify-center text-xs font-bold text-ink">2</div>
                <span className="text-xs font-bold text-ink uppercase tracking-wider">Choose Quiz</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full border border-ink/25 flex items-center justify-center text-xs font-bold text-ink">3</div>
                <span className="text-xs font-bold text-ink uppercase tracking-wider">Go Live!</span>
              </div>
            </div>

            <Button
              className="bg-ink text-bg hover:bg-ink/90 font-bold px-8 rounded-full shadow-lg"
              onClick={() => {
                // Find the first published quiz of the selected class if possible, or navigate to builder
                if (selectedClass) {
                  router.push(`/teacher/classes/${selectedClass.id}/quiz-builder`);
                }
              }}
            >
              Start Now
            </Button>
          </div>
        </GlassCard>
      </motion.div>

      {/* Main Grid: Workflow builder and Snapshots */}
      <div className="grid gap-6 lg:grid-cols-3">
        <GlassCard variant="premium" className="lg:col-span-2 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <Flash size={22} variant="Bold" className="text-accent" />
              Quick Start
            </h2>
            <div className="px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-[10px] font-bold text-accent uppercase tracking-widest">
              Live
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Link href={`/teacher/classes/${primaryClassId}/content`} className="group">
              <GlassCard variant="default" className="p-5 h-full border-ink/15 group-hover:border-accent/30 group-hover:bg-accent/5 transition-all text-center">
                <div className="w-14 h-14 rounded-full bg-accent mx-auto flex items-center justify-center text-bg font-black text-xl mb-4 group-hover:scale-110 transition-all shadow-accent">1</div>
                <h4 className="font-bold text-ink mb-2 uppercase tracking-wide">Upload Materials</h4>
                <p className="text-[11px] text-slate leading-relaxed">Add your lesson content and auto-generate questions.</p>
              </GlassCard>
            </Link>

            <Link href={`/teacher/classes/${primaryClassId}/quiz-builder`} className="group">
              <GlassCard variant="default" className="p-5 h-full border-ink/15 group-hover:border-accent/30 group-hover:bg-accent/5 transition-all text-center">
                <div className="w-14 h-14 rounded-full bg-accent mx-auto flex items-center justify-center text-bg font-black text-xl mb-4 group-hover:scale-110 transition-all shadow-accent">2</div>
                <h4 className="font-bold text-ink mb-2 uppercase tracking-wide">Build a Quiz</h4>
                <p className="text-[11px] text-slate leading-relaxed">Review and arrange questions into a ready-to-run quiz.</p>
              </GlassCard>
            </Link>

            <div
              className="group cursor-pointer"
              onClick={() => {
                if (selectedClass) {
                  const element = document.getElementById('quick-actions');
                  element?.scrollIntoView({ behavior: 'smooth' });
                }
              }}
            >
              <GlassCard variant="default" className="p-5 h-full border-ink/15 group-hover:border-accent/30 group-hover:bg-accent/5 transition-all text-center">
                <div className="w-14 h-14 rounded-full bg-accent mx-auto flex items-center justify-center text-bg font-black text-xl mb-4 group-hover:scale-110 transition-all shadow-accent">3</div>
                <h4 className="font-bold text-ink mb-2 uppercase tracking-wide">Start Session</h4>
                <p className="text-[11px] text-slate leading-relaxed">Go live and watch students answer in real time.</p>
              </GlassCard>
            </div>
          </div>

          {/* Target Dimension Select (Linearized) */}
          <div className="pt-4 border-t border-ink/15">
            <div className="flex flex-col md:flex-row items-center gap-4">
              <label className="text-[10px] font-bold text-slate uppercase tracking-widest whitespace-nowrap">Active Class:</label>
              <select
                className="flex-1 bg-bg/50 border border-ink/20 rounded-xl px-4 py-2 text-sm text-ink focus:outline-none focus:border-accent/50 transition-all cursor-pointer"
                value={primaryClassId}
                onChange={(e) => setClassId(e.target.value)}
              >
                {classes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} (Grade {row.grade_level})
                  </option>
                ))}
              </select>
              {selectedClass && (
                <div className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-xl">
                  <span className="text-[10px] font-bold text-accent uppercase tracking-widest mr-2">Code:</span>
                  <span className="text-sm font-mono font-bold text-ink">{selectedClass.join_code}</span>
                </div>
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard variant="premium" className="p-6 space-y-6">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Activity size={22} variant="Bold" className="text-gold" />
            Live Signals
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="glass p-4 rounded-xl text-center border-ink/15">
              <p className="text-[10px] text-slate font-bold uppercase mb-1">Active Sessions</p>
              <p className="text-2xl font-bold text-ink">{activeSessions.length}</p>
            </div>
            <div className="glass p-4 rounded-xl text-center border-ink/15">
              <p className="text-[10px] text-slate font-bold uppercase mb-1">Pending Questions</p>
              <p className="text-2xl font-bold text-ink">{overview?.totals.candidate_questions ?? 0}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] text-slate font-bold uppercase tracking-widest mb-3">Live Sessions</p>
            <AnimatePresence>
              {activeSessions.length === 0 ? (
                <p className="text-xs text-slate italic py-4 text-center glass rounded-xl border-dashed border-ink/20">No live sessions right now.</p>
              ) : (
                activeSessions.map((s, i) => (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={s.session_id}
                  >
                    <Link href={`/teacher/sessions/${s.session_id}/host`} className="flex items-center justify-between p-3 glass rounded-xl border-ink/15 hover:border-accent/30 transition-all group">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-ink">{s.className}</span>
                        <span className="text-[10px] text-accent font-bold uppercase">{s.status}</span>
                      </div>
                      <Play size={16} variant="Bold" className="text-slate group-hover:text-accent transition-all" />
                    </Link>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatItem icon={<Category size={20} variant="Bold" />} label="Classes" value={String(overview?.totals.classes ?? 0)} color="text-info" iconBg="bg-info/15" />
        <StatItem icon={<People size={20} variant="Bold" />} label="Students" value={String(overview?.totals.students ?? 0)} color="text-accent" iconBg="bg-accent/15" />
        <StatItem icon={<Play size={20} variant="Bold" />} label="Sessions Run" value={String(overview?.totals.active_sessions ?? 0)} color="text-gold" iconBg="bg-gold/15" />
        <StatItem icon={<Book size={20} variant="Bold" />} label="Questions" value={String(overview?.totals.candidate_questions ?? 0)} color="text-success" iconBg="bg-success/15" />
      </div>

      {/* Lower Section: Detailed classes and Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-ink px-2">Your Classes</h3>
          <div className="grid gap-4">
            {classes.map((cls) => (
              <GlassCard key={cls.id} className="p-6 border-ink/15 hover:border-ink/20 group">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center text-accent group-hover:scale-110 transition-all">
                      <Category size={24} variant="Bold" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-ink">{cls.name}</h4>
                      <p className="text-xs text-slate">Grade {cls.grade_level} • {cls.students_count} Students • {cls.total_sessions} Sessions</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton icon={<DocumentText size={16} />} label="Materials" href={`/teacher/classes/${cls.id}/content`} />
                    <ActionButton icon={<Flash size={16} />} label="New Quiz" href={`/teacher/classes/${cls.id}/quiz-builder`} />
                    <ActionButton icon={<Activity size={16} />} label="Analytics" href={`/teacher/classes/${cls.id}`} />
                  </div>
                </div>

                {cls.weak_skills.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-ink/15">
                    <p className="text-[10px] font-bold text-slate uppercase tracking-widest mb-3">Skills Needing Work</p>
                    <div className="flex flex-wrap gap-2">
                      {cls.weak_skills.map(skill => (
                        <div key={skill.skill_id} className="px-3 py-2 glass rounded-lg border-ink/15 flex items-center gap-3">
                          <span className="text-xs font-bold text-ink">{skill.skill_name}</span>
                          <div className="w-16 h-1.5 bg-bg/35 rounded-full overflow-hidden">
                            <div className="h-full bg-gold transition-all" style={{ width: `${Math.round(skill.avg_mastery * 100)}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-gold">{Math.round(skill.avg_mastery * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-bold text-ink px-2" id="quick-actions">Quick Actions</h3>
          <GlassCard variant="premium" className="p-6 space-y-6">
            <form onSubmit={createClass} className="space-y-3">
              <div className="flex items-center gap-2 text-ink/90">
                <Add size={18} variant="Bold" className="text-accent" />
                <span className="text-sm font-bold">Create New Class</span>
              </div>
              <Input className="glass border-ink/20" value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name" />
              <Input className="glass border-ink/20" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Grade level" />
              <Button className="w-full bg-accent text-bg font-bold hover:bg-accent/90" type="submit">Create Class</Button>
            </form>

            <div className="h-px bg-bg/35" />

            <form onSubmit={startSession} className="space-y-3">
              <div className="flex items-center gap-2 text-ink/90">
                <Play size={18} variant="Bold" className="text-gold" />
                <span className="text-sm font-bold">Launch Session</span>
              </div>
              <Input className="glass border-ink/20" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="Class ID" />
              <Input className="glass border-ink/20" value={quizId} onChange={(e) => setQuizId(e.target.value)} placeholder="Quiz ID" />
              <Button variant="outline" className="w-full glass border-ink/20 text-ink hover:bg-bg/45 font-bold" type="submit">Start Game</Button>
            </form>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function StatItem({ icon, label, value, color, iconBg }: { icon: ReactNode, label: string, value: string, color: string, iconBg?: string }) {
  return (
    <GlassCard className="p-5 border-ink/15 hover:border-ink/25 hover:shadow-card transition-all">
      <div className={`p-2.5 w-fit rounded-xl mb-3 ${color} ${iconBg ?? "bg-bg/35"}`}>
        {icon}
      </div>
      <p className="text-[10px] font-bold text-slate uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold text-ink mt-1">{value}</p>
    </GlassCard>
  );
}

function ActionButton({ icon, label, href }: { icon: ReactNode, label: string, href: string }) {
  return (
    <Link href={href}>
      <Button variant="ghost" size="sm" className="glass border-ink/15 hover:border-accent/30 text-[10px] font-bold uppercase tracking-tighter text-slate hover:text-ink px-3">
        {icon}
        <span className="ml-1 hidden xl:inline">{label}</span>
      </Button>
    </Link>
  )
}
