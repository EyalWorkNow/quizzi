"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowRight2, Book, Play, TickCircle } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export default function QuizBuilderPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;
  const [title, setTitle] = useState("Weekly Checkpoint");
  const [questionCount, setQuestionCount] = useState(10);
  const [quizzes, setQuizzes] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [publishing, setPublishing] = useState(false);

  const load = async () => {
    try {
      const rows = await api.listQuizzes(classId);
      setQuizzes(rows as Array<{ id: string; title: string; status: string }>);
    } catch {
      setQuizzes([]);
    }
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, [classId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!title.trim()) {
      setError("Please enter a quiz title.");
      return;
    }

    setPublishing(true);
    try {
      const skillRows = (await api.listSkills(classId)) as Array<{ id: string }>;
      const quiz = (await api.createQuiz({
        class_id: classId,
        title: title.trim(),
        question_count: questionCount,
        skill_ids: skillRows.map((s) => s.id)
      })) as { id: string };

      setMessage(`Quiz published: ${quiz.id}`);
      await load();
    } catch (err) {
      const text = (err as Error).message || "Failed to publish quiz.";
      if (text.includes("No approved questions")) {
        setError("No approved questions available yet. Go to Content Ingestion, generate candidates, and approve them first.");
      } else {
        setError(text);
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="border-accent/25 bg-gradient-to-r from-highlight/60 via-card to-panel/85">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Book size={18} className="text-accent" variant="Bold" />
            Step 2: Build and Publish Quiz
          </CardTitle>
          <CardDescription>Use approved questions to publish a fresh quiz for your class.</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Play size={17} className="text-accent" variant="Bold" />
              Publish Quiz
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submit}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" />
              <Input
                type="number"
                min={3}
                max={40}
                value={questionCount}
                onChange={(e) => setQuestionCount(Math.max(3, Math.min(40, Number(e.target.value) || 3)))}
                placeholder="Question count"
              />
              <Button disabled={publishing} type="submit">
                <TickCircle size={15} variant="Bold" />
                {publishing ? "Publishing..." : "Build and Publish"}
              </Button>
            </form>
            {message ? <p className="mt-3 rounded-xl bg-highlight p-2 text-sm text-slate">{message}</p> : null}
            {error ? (
              <div className="mt-3 rounded-xl bg-danger/15 border border-danger/40 p-3 text-sm text-danger">
                <p>{error}</p>
                <Link
                  className="mt-2 inline-flex items-center gap-1 font-semibold text-accent hover:text-ink"
                  href={`/teacher/classes/${classId}/content`}
                >
                  Open Content Ingestion
                  <ArrowRight2 size={14} />
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Publishing Hints</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate">
            <p>1. Keep quizzes short (8-15 questions) for better classroom flow.</p>
            <p>2. Approve enough candidates before publishing to avoid repetition.</p>
            <p>3. Use post-game remediation packs for deeper practice.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Published Quizzes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {quizzes.map((quiz) => (
            <div key={quiz.id} className="rounded-xl border border-ink/10 bg-bg/35 p-3">
              <div className="font-semibold text-ink">{quiz.title}</div>
              <div className="text-xs text-slate">
                {quiz.status} - ID: <span className="font-mono">{quiz.id}</span>
              </div>
            </div>
          ))}
          {quizzes.length === 0 ? <p className="rounded-xl border border-dashed border-ink/20 bg-bg/35 p-4 text-sm text-slate">No quizzes published yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
