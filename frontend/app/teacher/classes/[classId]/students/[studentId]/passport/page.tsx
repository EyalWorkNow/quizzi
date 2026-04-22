"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Activity, Profile2User } from "iconsax-react";

import { PassportChart } from "@/components/teacher/passport-chart";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export default function PassportPage() {
  const params = useParams<{ classId: string; studentId: string }>();
  const classId = params.classId;
  const studentId = params.studentId;
  const [passport, setPassport] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.getPassport(classId, studentId).then((data) => setPassport(data as Record<string, unknown>));
  }, [classId, studentId]);

  if (!passport) {
    return (
      <Card>
        <CardContent className="inline-flex items-center gap-2 py-6 text-sm text-slate">
          <Activity size={16} className="animate-pulse" />
          Loading passport...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-accent/25 bg-gradient-to-r from-highlight/60 via-card to-panel/85">
        <CardContent className="space-y-2 p-6">
          <p className="inline-flex w-fit items-center gap-1 rounded-full bg-highlight px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
            <Profile2User size={13} variant="Bold" />
            Learning Passport
          </p>
          <h1 className="font-[var(--font-heading)] text-2xl text-ink">Student Skill Timeline</h1>
          <p className="text-sm text-slate">Monitor mastery trend, recent misconception, and recommended practice.</p>
        </CardContent>
      </Card>

      <PassportChart snapshots={(passport.snapshots as Array<Record<string, unknown>>) ?? []} />
    </div>
  );
}
