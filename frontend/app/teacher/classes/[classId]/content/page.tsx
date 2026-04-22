"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight2, DocumentText, Flash, MessageQuestion, TickCircle } from "iconsax-react";

import { CandidateReviewTable } from "@/components/teacher/candidate-review-table";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import type { CandidateQuestion } from "@/lib/schemas";

export default function ContentPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;
  const [title, setTitle] = useState("Unit 1 Notes");
  const [rawContent, setRawContent] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateQuestion[]>([]);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [savingSource, setSavingSource] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [provider, setProvider] = useState<"gemini" | "auto" | "deterministic">("gemini");
  const canSaveSource = title.trim().length > 0 && rawContent.trim().length > 0;

  const loadCandidates = async () => {
    try {
      const rows = await api.listCandidates(classId);
      setCandidates(rows as CandidateQuestion[]);
    } catch {
      setCandidates([]);
    }
  };

  useEffect(() => {
    void loadCandidates().catch(() => undefined);
  }, [classId]);

  const createSource = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!canSaveSource) {
      setError("Please add a title and paste learning content before saving.");
      return;
    }

    setSavingSource(true);
    try {
      const source = await api.createSource({
        class_id: classId,
        title: title.trim(),
        source_type: "text",
        raw_content: rawContent.trim()
      });
      setSourceId((source as { id: string }).id);
      setMessage("Source saved. Now click Generate Candidates.");
    } catch (err) {
      setError((err as Error).message || "Failed to save source.");
    } finally {
      setSavingSource(false);
    }
  };

  const generate = async () => {
    setError("");
    setMessage("");
    if (!sourceId) {
      setError("Save learning material first, then generate questions.");
      return;
    }

    setGenerating(true);
    try {
      const skills = (await api.listSkills(classId)) as Array<{ id: string }>;
      const result = (await api.generateCandidates(sourceId, {
        skill_ids: skills.map((s) => s.id),
        count: 15,
        provider
      })) as {
        candidates_created: number;
        rejected_by_quality: number;
        provider_used: string;
        fallback_used?: boolean;
        provider_error?: string | null;
      };

      setMessage(
        `Generated ${result.candidates_created} candidates with ${result.provider_used}. Rejected: ${result.rejected_by_quality}` +
        (result.fallback_used ? ` (fallback: ${result.provider_error ?? "unknown"})` : "")
      );
      await loadCandidates();
    } catch (err) {
      setError((err as Error).message || "Failed to generate candidates.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="border-accent/25 bg-accent/5 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl text-ink">
                <DocumentText size={22} className="text-accent" variant="Bold" />
                Step 1: Upload Knowledge
              </CardTitle>
              <CardDescription className="text-slate">Feed the Engine with lesson notes or text to synthesize questions.</CardDescription>
            </div>
            <Link href={`/teacher/classes/${classId}/quiz-builder`}>
              <Button variant="ghost" className="text-accent hover:text-ink hover:bg-accent/10">
                Continue to Forge
                <ArrowRight2 size={16} className="ml-2" />
              </Button>
            </Link>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <GlassCard variant="default" className="p-6 border-ink/15 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-bg">
              <MessageQuestion size={24} variant="Bold" />
            </div>
            <h3 className="text-xl font-bold text-ink">Material Feed</h3>
          </div>

          <form className="space-y-4" onSubmit={createSource}>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate uppercase tracking-widest">Topic Title</label>
              <Input
                className="h-12 rounded-xl border-ink/15 bg-bg/50 text-ink focus:border-accent/40 transition-all"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ancient Rome Foundations"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate uppercase tracking-widest">Learning Content</label>
              <Textarea
                className="min-h-[250px] rounded-xl border-ink/15 bg-bg/50 text-ink focus:border-accent/40 transition-all resize-none"
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                placeholder="Paste the lesson text, notes, or article content here..."
              />
              <p className="text-[10px] text-slate/50 text-right">{rawContent.trim().length} characters ingested</p>
            </div>

            <Button
              className="w-full h-14 bg-accent text-bg hover:bg-accent/90 font-bold rounded-xl text-lg shadow-lg disabled:opacity-50"
              disabled={!canSaveSource || savingSource}
              type="submit"
            >
              <TickCircle size={22} variant="Bold" className="mr-2" />
              {savingSource ? "Ingesting..." : "Save and Process Knowledge"}
            </Button>
          </form>
        </GlassCard>

        <GlassCard variant="premium" className="p-6 border-ink/15 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
              <Flash size={24} variant="Bold" />
            </div>
            <h3 className="text-xl font-bold text-ink">Engine Synthesis</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate uppercase tracking-widest">Synthesis Engine</label>
              <select
                id="provider"
                className="w-full h-12 rounded-xl border border-ink/15 bg-bg/50 px-4 text-sm text-ink focus:outline-none focus:border-accent/40"
                value={provider}
                onChange={(e) => setProvider(e.target.value as "gemini" | "auto" | "deterministic")}
              >
                <option value="gemini">Gemini Neural (Recommended)</option>
                <option value="auto">Adaptive Pipeline</option>
                <option value="deterministic">Local Pattern Filter</option>
              </select>
            </div>

            <Button
              className="w-full h-12 border-accent/30 text-accent hover:bg-accent/5 font-bold rounded-xl shadow-lg"
              disabled={!sourceId || generating}
              onClick={() => void generate()}
              variant="outline"
            >
              <Flash size={18} variant="Bold" className="mr-2" />
              {generating ? "Synthesizing..." : "Start Question Synthesis"}
            </Button>

            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-ink/15">
              <div className="glass p-3 rounded-xl border-ink/15 text-center">
                <p className="text-[10px] text-slate font-bold uppercase mb-1">Queue</p>
                <p className="text-xl font-bold text-ink">{candidates.length}</p>
              </div>
              <div className="glass p-3 rounded-xl border-ink/15 text-center">
                <p className="text-[10px] text-slate font-bold uppercase mb-1">Source</p>
                <p className={`text-xl font-bold ${sourceId ? 'text-accent' : 'text-slate/30'}`}>
                  {sourceId ? 'Ready' : 'Wait'}
                </p>
              </div>
            </div>

            {message ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl bg-accent/10 border border-accent/20 p-3 text-[11px] text-accent font-medium leading-relaxed">
                {message}
              </motion.div>
            ) : null}
            {error ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl bg-danger/15 border border-danger/35 p-3 text-[11px] text-danger font-medium">
                {error}
              </motion.div>
            ) : null}
          </div>
        </GlassCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Teacher Review Queue</CardTitle>
          <CardDescription>Approve high-quality questions before publishing a quiz.</CardDescription>
        </CardHeader>
        <CardContent>
          <CandidateReviewTable
            rows={candidates}
            onApprove={async (id) => {
              try {
                setError("");
                await api.approveQuestion(id);
                await loadCandidates();
              } catch (err) {
                setError((err as Error).message || "Failed to approve question.");
              }
            }}
            onReject={async (id) => {
              try {
                setError("");
                await api.rejectQuestion(id);
                await loadCandidates();
              } catch (err) {
                setError((err as Error).message || "Failed to reject question.");
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
