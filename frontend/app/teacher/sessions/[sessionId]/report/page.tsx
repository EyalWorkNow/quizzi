"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  LampCharge,
  MessageQuestion,
  Profile2User,
  StatusUp,
  ArrowLeft2,
  Flash,
  DirectboxReceive
} from "iconsax-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';

import { ActionPlanSummary } from "@/components/teacher/action-plan-summary";
import { RemediationPack } from "@/components/teacher/remediation-pack";
import { SupportGroups } from "@/components/teacher/support-groups";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { SessionInsights } from "@/lib/schemas";
import Link from "next/link";

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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
      </div>
    );
  }

  const recommendations = report.recommendations?.teacher_next_steps ?? [];
  const skillEvidence = report.summary?.skill_evidence ?? [];
  const p50Latency = Number((insights?.latency_analysis as { p50_ms?: number } | undefined)?.p50_ms ?? 0);
  const masteryData = (diagnostics?.skill_mastery ?? []).map((s: any) => ({
    name: s.skill_name || s.skill_id,
    mastery: Math.round(s.mastery * 100)
  }));

  const engagementData = [
    { name: 'Participated', value: diagnostics?.engagement?.participation_rate || 0 },
    { name: 'Absent', value: 1 - (diagnostics?.engagement?.participation_rate || 0) }
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/teacher/dashboard">
          <Button variant="ghost" className="glass border-ink/15 text-slate hover:text-ink">
            <ArrowLeft2 size={18} className="mr-2" />
            Back to Command Center
          </Button>
        </Link>
        <div className="px-4 py-2 glass border-gold/20 rounded-xl flex items-center gap-2">
          <Flash size={18} variant="Bold" className="text-gold" />
          <span className="text-xs font-bold text-ink uppercase tracking-widest leading-none">Intelligence Ready</span>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <GlassCard variant="premium" className="p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Activity size={120} variant="Bold" className="text-accent" />
          </div>
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-[10px] font-bold text-accent uppercase tracking-widest">
              Decision Engine Analysis
            </div>
            <h1 className="text-4xl font-bold text-ink tracking-tight">Post-Game Intelligence Report</h1>
            <p className="text-slate max-w-2xl text-lg">
              Deterministic skill diagnosis, behavioral heatmaps, and automated intervention sequences generated for this session.
            </p>
          </div>
        </GlassCard>
      </motion.div>

      {/* Analytics Visualization Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-ink flex items-center gap-2">
              <StatusUp size={22} variant="Bold" className="text-accent" />
              Skill Mastery Vector
            </h3>
            <span className="text-[10px] font-bold text-slate uppercase">Mastery %</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={masteryData} layout="vertical" margin={{ left: 40, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" hide domain={[0, 100]} />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#a7b9d6", fontSize: 12, fontWeight: "bold" }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(167,185,214,0.08)" }}
                  contentStyle={{ backgroundColor: "#102340", border: "1px solid rgba(167,185,214,0.24)", borderRadius: "12px" }}
                />
                <Bar dataKey="mastery" radius={[0, 4, 4, 0]} barSize={20}>
                  {masteryData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.mastery > 70 ? "#2ed3b7" : entry.mastery > 40 ? "#f4b546" : "#ff6b6b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <div className="grid gap-6">
          <GlassCard className="p-6 flex flex-col justify-center">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-info/10 flex items-center justify-center text-info">
                <Profile2User size={32} variant="Bold" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-ink">Execution Metrics</h3>
                <p className="text-xs text-slate uppercase tracking-widest font-bold">Participation Flow</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 items-center">
              <div className="space-y-4">
                <div className="glass p-3 rounded-xl border-ink/15">
                  <p className="text-[10px] text-slate font-bold uppercase">Participation Rate</p>
                  <p className="text-2xl font-bold text-ink">{Math.round((diagnostics?.engagement?.participation_rate || 0) * 100)}%</p>
                </div>
                <div className="glass p-3 rounded-xl border-ink/15">
                  <p className="text-[10px] text-slate font-bold uppercase">Avg Response Time</p>
                  <p className="text-2xl font-bold text-ink">{p50Latency}ms</p>
                </div>
              </div>
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={engagementData}
                      innerRadius={40}
                      outerRadius={55}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill="#2ed3b7" />
                      <Cell fill="rgba(167,185,214,0.16)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </GlassCard>

          <GlassCard variant="accent" className="p-6">
            <div className="flex items-center gap-3 text-accent mb-4">
              <LampCharge size={24} variant="Bold" />
              <h4 className="font-bold text-ink">Recommended Interventions</h4>
            </div>
            <div className="space-y-2">
              {insights?.recommendations.slice(0, 2).map((rec, i) => (
                <div key={i} className="flex gap-3 text-sm text-slate">
                  <span className="text-accent font-bold">{i + 1}.</span>
                  <p>{rec}</p>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-ink px-2 flex items-center gap-3 leading-none">
            <DirectboxReceive size={28} variant="Bold" className="text-info" />
            Actionable Intelligence
          </h2>
          <ActionPlanSummary summary={report.summary ?? {}} />
          <SupportGroups groups={report.groups ?? []} />
          <RemediationPack pack={report.remediation_pack ?? {}} />
        </div>

        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-ink px-2 flex items-center gap-3 leading-none">
            <LampCharge size={28} variant="Bold" className="text-gold" />
            Intervention Scripts
          </h2>
          <GlassCard className="p-6 space-y-4">
            {recommendations.map((step: any, idx: number) => (
              <motion.div
                whileHover={{ x: 5 }}
                key={idx}
                className="rounded-xl border border-ink/15 bg-bg/35 p-4 space-y-3"
              >
                <div className="flex justify-between items-start">
                  <span className="text-sm font-bold text-ink">{step.skill_name || step.skill_id}</span>
                  <span className="text-[10px] font-bold text-gold uppercase px-2 py-0.5 glass rounded-full">{step.misconception_tag || 'Misconception'}</span>
                </div>
                <p className="text-xs text-slate leading-relaxed">{step.why_now}</p>
                <div className="bg-bg/80 border-l-2 border-gold p-4 rounded-r-xl">
                  <p className="text-sm italic text-ink/90">"{step.script}"</p>
                </div>
              </motion.div>
            ))}
            {recommendations.length === 0 && <p className="text-sm text-slate italic p-8 text-center glass rounded-xl border-dashed border-ink/15">No scripts generated for this session.</p>}
          </GlassCard>

          <h2 className="text-2xl font-bold text-ink px-2 flex items-center gap-3 leading-none pt-4">
            <MessageQuestion size={28} variant="Bold" className="text-info" />
            Evidence Matrix
          </h2>
          <GlassCard className="p-6 space-y-4">
            {skillEvidence.map((row: any) => (
              <div key={row.skill_id} className="space-y-3 pb-4 border-b border-ink/15 last:border-0 last:pb-0">
                <h5 className="text-sm font-bold text-ink">{row.skill_name || row.skill_id}</h5>
                <div className="grid gap-2">
                  {row.evidence.map((ev: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs px-3 py-2 glass rounded-lg border-ink/15">
                      <span className="text-slate">Q {ev.question_id}</span>
                      <span className="text-danger font-bold">{Math.round(ev.incorrect_rate * 100)}% Failure</span>
                      <span className="text-slate italic max-w-[150px] truncate">{ev.top_wrong_option}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
