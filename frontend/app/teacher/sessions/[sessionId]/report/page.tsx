"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft2,
  TickCircle,
  People,
  StatusUp,
  Flash,
  Book1,
  MessageQuestion,
  LampCharge,
} from "iconsax-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { SessionInsights } from "@/lib/schemas";

// ── colour helpers ──────────────────────────────────────────────────────────
function masteryColor(pct: number) {
  if (pct >= 70) return "#35d49a";
  if (pct >= 40) return "#f4b546";
  return "#ff6b6b";
}
function masteryTextClass(pct: number) {
  if (pct >= 70) return "text-success";
  if (pct >= 40) return "text-gold";
  return "text-danger";
}
function masteryBorderClass(pct: number) {
  if (pct >= 70) return "border-success/25 bg-success/5";
  if (pct >= 40) return "border-gold/25 bg-gold/5";
  return "border-danger/25 bg-danger/5";
}
function masteryVerdict(pct: number) {
  if (pct >= 70) return "Understood well";
  if (pct >= 40) return "Needs more practice";
  return "Needs reteaching";
}

// ── small stat box ──────────────────────────────────────────────────────────
function StatBox({
  value,
  label,
  colorClass,
}: {
  value: string;
  label: string;
  colorClass: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 text-center border border-ink/10 flex flex-col items-center gap-1">
      <p className={`text-5xl font-black tracking-tight ${colorClass}`}>{value}</p>
      <p className="text-[11px] font-bold text-slate uppercase tracking-widest leading-snug mt-1">
        {label}
      </p>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function ReportPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [report, setReport] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [insights, setInsights] = useState<SessionInsights | null>(null);

  useEffect(() => {
    api.getReport(sessionId).then(setReport);
    api.getDiagnostics(sessionId).then(setDiagnostics);
    api.getSessionInsights(sessionId).then(setInsights).catch(() => setInsights(null));
  }, [sessionId]);

  if (!report) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent" />
      </div>
    );
  }

  // ── derived data ──
  const recommendations: any[] = report.recommendations?.teacher_next_steps ?? [];
  const skillEvidence: any[] = report.summary?.skill_evidence ?? [];
  const groups: any[] = report.groups ?? [];
  const remItems: any[] = report.remediation_pack?.items ?? [];
  const remTitle = String(report.remediation_pack?.title ?? "Follow-up questions based on today's session.");

  const masteryData: { name: string; mastery: number }[] = (
    diagnostics?.skill_mastery ?? []
  ).map((s: any) => ({
    name: s.skill_name || s.skill_id,
    mastery: Math.round(s.mastery * 100),
  }));

  const participationPct = Math.round(
    (diagnostics?.engagement?.participation_rate || 0) * 100
  );
  const avgMastery =
    masteryData.length > 0
      ? Math.round(
          masteryData.reduce((sum, s) => sum + s.mastery, 0) / masteryData.length
        )
      : 0;
  const weakCount = masteryData.filter((s) => s.mastery < 70).length;

  const fade = (delay = 0) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay },
  });

  return (
    <div className="space-y-8 pb-16 max-w-3xl mx-auto">

      {/* ── top bar ── */}
      <div className="flex items-center justify-between">
        <Link href="/teacher/dashboard">
          <Button variant="ghost" className="glass border-ink/15 text-slate hover:text-ink">
            <ArrowLeft2 size={18} className="mr-2" />
            Back to Dashboard
          </Button>
        </Link>
        <div className="px-4 py-2 glass border-success/25 rounded-xl flex items-center gap-2">
          <TickCircle size={16} variant="Bold" className="text-success" />
          <span className="text-xs font-bold text-success uppercase tracking-widest">
            Session complete
          </span>
        </div>
      </div>

      {/* ── SECTION 1 — hero + 3 numbers ── */}
      <motion.div {...fade(0)}>
        <GlassCard variant="premium" className="p-8 space-y-6">
          <div>
            <p className="text-sm text-slate mb-1">Here's how your class did today</p>
            <h1 className="text-4xl font-bold text-ink tracking-tight">Session Results</h1>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <StatBox
              value={`${participationPct}%`}
              label="Students participated"
              colorClass={
                participationPct >= 70
                  ? "text-success"
                  : participationPct >= 50
                  ? "text-gold"
                  : "text-danger"
              }
            />
            <StatBox
              value={`${avgMastery}%`}
              label="Average understanding"
              colorClass={masteryTextClass(avgMastery)}
            />
            <StatBox
              value={String(weakCount)}
              label={weakCount === 1 ? "Topic needs work" : "Topics need work"}
              colorClass={
                weakCount === 0
                  ? "text-success"
                  : weakCount <= 2
                  ? "text-gold"
                  : "text-danger"
              }
            />
          </div>
        </GlassCard>
      </motion.div>

      {/* ── SECTION 2 — topic-by-topic results ── */}
      {masteryData.length > 0 && (
        <motion.div {...fade(0.1)}>
          <GlassCard className="p-6 space-y-5">
            {/* heading + legend */}
            <div className="space-y-3">
              <h2 className="text-xl font-bold text-ink">
                How did students understand each topic?
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                {[
                  { color: "bg-success", label: "Understood well (70%+)" },
                  { color: "bg-gold",    label: "Needs practice (40–70%)" },
                  { color: "bg-danger",  label: "Needs reteaching (under 40%)" },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate">
                    <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>

            {/* skill rows */}
            <div className="space-y-3">
              {masteryData.map((skill) => (
                <div
                  key={skill.name}
                  className={`rounded-2xl border p-4 space-y-2 ${masteryBorderClass(skill.mastery)}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink text-sm">{skill.name}</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xl font-black ${masteryTextClass(skill.mastery)}`}
                      >
                        {skill.mastery}%
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full glass ${masteryTextClass(skill.mastery)}`}
                      >
                        {masteryVerdict(skill.mastery)}
                      </span>
                    </div>
                  </div>
                  {/* progress bar */}
                  <div className="h-2 bg-ink/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${skill.mastery}%`,
                        backgroundColor: masteryColor(skill.mastery),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── SECTION 3 — who needs extra help ── */}
      {groups.length > 0 && (
        <motion.div {...fade(0.15)}>
          <GlassCard className="p-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <People size={22} variant="Bold" className="text-gold" />
                Who needs extra support?
              </h2>
              <p className="text-sm text-slate mt-1">
                These students struggled with specific topics. Consider working with them in small groups.
              </p>
            </div>
            <div className="space-y-3">
              {groups.map((group: any, idx: number) => {
                const count = (group.student_ids as string[])?.length ?? 0;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-4 glass rounded-2xl border border-gold/15"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center shrink-0">
                        <People size={20} variant="Bold" className="text-gold" />
                      </div>
                      <div>
                        <p className="font-bold text-ink text-sm">
                          {String(group.skill_name ?? "Topic")}
                        </p>
                        <p className="text-xs text-slate leading-snug mt-0.5">
                          {String(group.recommended_activity ?? "Targeted reteach and practice")}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-3xl font-black text-gold">{count}</p>
                      <p className="text-[10px] text-slate uppercase tracking-widest font-bold">
                        student{count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── SECTION 4 — what to say in class ── */}
      {recommendations.length > 0 && (
        <motion.div {...fade(0.2)}>
          <GlassCard className="p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <LampCharge size={22} variant="Bold" className="text-accent" />
                What to say in your next class
              </h2>
              <p className="text-sm text-slate mt-1">
                Ready-to-use explanations for the topics students struggled with most.
              </p>
            </div>
            <div className="space-y-4">
              {recommendations.map((step: any, idx: number) => (
                <motion.div
                  key={idx}
                  whileHover={{ x: 3 }}
                  className="rounded-2xl border border-ink/15 bg-bg/30 overflow-hidden"
                >
                  {/* topic header */}
                  <div className="px-5 py-3 border-b border-ink/15 flex items-center justify-between gap-3">
                    <span className="font-bold text-ink text-sm">
                      {step.skill_name || step.skill_id}
                    </span>
                    {step.misconception_tag && (
                      <span className="text-[11px] font-bold text-gold bg-gold/10 border border-gold/20 px-2.5 py-0.5 rounded-full shrink-0">
                        Common mistake: {step.misconception_tag}
                      </span>
                    )}
                  </div>

                  {/* why now */}
                  {step.why_now && (
                    <p className="px-5 pt-3 text-xs text-slate leading-relaxed">
                      {step.why_now}
                    </p>
                  )}

                  {/* the script */}
                  <div className="px-5 pb-5 pt-3">
                    <p className="text-[11px] font-bold text-slate uppercase tracking-widest mb-2">
                      Say this to your class:
                    </p>
                    <div className="border-l-2 border-accent pl-4">
                      <p className="text-sm text-ink/90 italic leading-relaxed">
                        &ldquo;{step.script}&rdquo;
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── SECTION 5 — practice to assign ── */}
      {remItems.length > 0 && (
        <motion.div {...fade(0.25)}>
          <GlassCard className="p-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <Book1 size={22} variant="Bold" className="text-info" />
                Practice questions to assign
              </h2>
              <p className="text-sm text-slate mt-1">{remTitle}</p>
            </div>
            <div className="space-y-2">
              {remItems.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 glass rounded-xl border border-ink/15"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-xs font-black text-accent">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-ink">
                      Practice question {idx + 1}
                    </span>
                  </div>
                  <Badge>{String(item.difficulty)}</Badge>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── SECTION 6 — question breakdown ── */}
      {skillEvidence.length > 0 && (
        <motion.div {...fade(0.3)}>
          <GlassCard className="p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <MessageQuestion size={22} variant="Bold" className="text-slate" />
                Question breakdown
              </h2>
              <p className="text-sm text-slate mt-1">
                Which questions tripped students up and what wrong answer they chose.
              </p>
            </div>
            <div className="space-y-5">
              {skillEvidence.map((row: any) => (
                <div key={row.skill_id} className="space-y-2">
                  <p className="text-sm font-bold text-ink border-b border-ink/15 pb-2">
                    {row.skill_name || row.skill_id}
                  </p>
                  {(row.evidence ?? []).map((ev: any, i: number) => {
                    const wrongPct = Math.round(ev.incorrect_rate * 100);
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-between p-3 rounded-xl border gap-3 ${
                          wrongPct >= 50
                            ? "border-danger/20 bg-danger/5"
                            : "border-ink/15 bg-bg/30"
                        }`}
                      >
                        <span className="text-xs font-bold text-slate w-24 shrink-0">
                          Question {i + 1}
                        </span>
                        <span
                          className={`text-sm font-bold ${
                            wrongPct >= 50 ? "text-danger" : "text-gold"
                          }`}
                        >
                          {wrongPct}% got it wrong
                        </span>
                        {ev.top_wrong_option && (
                          <span className="text-xs text-slate italic flex-1 text-right truncate">
                            Most chose: &ldquo;{ev.top_wrong_option}&rdquo;
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

    </div>
  );
}
