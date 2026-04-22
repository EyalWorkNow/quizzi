"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowRight2, Book, Copy, DocumentText, Profile2User, Refresh, ScanBarcode } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";

type ClassRegistration = { join_code: string; registration_url: string };

export default function ClassPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;
  const [students, setStudents] = useState<Array<{ id: string; pseudonym: string }>>([]);
  const [registration, setRegistration] = useState<ClassRegistration | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.listStudents(classId).then(setStudents).catch(() => setStudents([]));
    api
      .getClassRegistration(classId)
      .then((data) => setRegistration(data as ClassRegistration))
      .catch(() => setRegistration(null));
  }, [classId]);

  return (
    <div className="space-y-5">
      <Card className="border-accent/25 bg-gradient-to-r from-highlight/60 via-card to-panel/85">
        <CardHeader>
          <CardTitle className="text-xl">Class Workflow</CardTitle>
          <CardDescription>Use these two actions as your main path to create and run new quizzes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Link
            className="rounded-xl border border-accent/30 bg-bg/35 p-4 transition hover:border-accent/55 hover:bg-highlight/70"
            href={`/teacher/classes/${classId}/content`}
          >
            <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-highlight px-2 py-1 text-xs font-semibold text-accent">
              <DocumentText size={13} variant="Bold" />
              Step 1
            </p>
            <p className="text-base font-semibold text-ink">Upload Learning Material</p>
            <p className="mt-1 text-sm text-slate">Paste lesson text and generate questions.</p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent">
              Open Content Ingestion
              <ArrowRight2 size={14} />
            </p>
          </Link>

          <Link
            className="rounded-xl border border-accent/30 bg-bg/35 p-4 transition hover:border-accent/55 hover:bg-highlight/70"
            href={`/teacher/classes/${classId}/quiz-builder`}
          >
            <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-highlight px-2 py-1 text-xs font-semibold text-accent">
              <Book size={13} variant="Bold" />
              Step 2
            </p>
            <p className="text-base font-semibold text-ink">Build and Publish Quiz</p>
            <p className="mt-1 text-sm text-slate">Create a quiz from approved questions and publish.</p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent">
              Open Quiz Builder
              <ArrowRight2 size={14} />
            </p>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScanBarcode size={17} className="text-accent" variant="Bold" />
            Student Registration Channel
          </CardTitle>
          <CardDescription>Share this class code or link so students can pre-register quickly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-xl border border-ink/10 bg-bg/35 p-3">
            <p className="text-xs uppercase tracking-wide text-slate">Class code</p>
            <p className="text-2xl font-bold tracking-widest text-ink">{registration?.join_code ?? "..."}</p>
          </div>

          <div className="rounded-xl border border-ink/10 bg-bg/35 p-3">
            <p className="text-xs uppercase tracking-wide text-slate">Registration URL</p>
            <p className="mt-1 break-all text-xs text-slate">{registration?.registration_url ?? "Loading..."}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (!registration?.registration_url) return;
                await navigator.clipboard.writeText(registration.registration_url);
                setMessage("Registration link copied.");
              }}
            >
              <Copy size={15} variant="Bold" />
              Copy Link
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const data = await api.rotateClassRegistration(classId);
                setRegistration(data as ClassRegistration);
                setMessage("Class code rotated.");
              }}
            >
              <Refresh size={15} variant="Bold" />
              Rotate Class Code
            </Button>
          </div>

          {message ? <p className="text-xs text-slate">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Profile2User size={17} className="text-accent" variant="Bold" />
            Students and Passports
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {students.map((student) => (
            <div key={student.id} className="flex items-center justify-between rounded-xl border border-ink/10 bg-bg/35 p-3 text-sm">
              <span className="font-semibold text-ink">{student.pseudonym}</span>
              <Link className="inline-flex items-center gap-1 font-semibold text-accent hover:text-ink" href={`/teacher/classes/${classId}/students/${student.id}/passport`}>
                View Passport
                <ArrowRight2 size={14} />
              </Link>
            </div>
          ))}
          {students.length === 0 ? <p className="rounded-xl border border-dashed border-ink/20 bg-bg/35 p-4 text-sm text-slate">No students registered yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
