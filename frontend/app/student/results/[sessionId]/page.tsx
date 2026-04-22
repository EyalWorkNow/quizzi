"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Award } from "iconsax-react";

import { PersonalResultCard } from "@/components/student/personal-result-card";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export default function ResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [score, setScore] = useState(0);

  const nickname = typeof window !== "undefined" ? localStorage.getItem("quizzy_student_nickname") ?? "Student" : "Student";

  useEffect(() => {
    api
      .getLeaderboard(sessionId)
      .then((leaderboard) => {
        const rows = (leaderboard as { items: Array<{ nickname: string; score: number }> }).items;
        const me = rows.find((row) => row.nickname === nickname);
        setScore(me?.score ?? 0);
      })
      .catch(() => setScore(0));
  }, [nickname, sessionId]);

  return (
    <div className="space-y-4">
      <PersonalResultCard score={score} note="Great work. Your teacher will assign next practice based on this session." />
      <Card>
        <CardContent className="inline-flex items-center gap-2 py-3 text-xs text-slate">
          <Award size={14} className="text-accent" />
          Only your personal result is shown here. Class analytics are visible to the teacher dashboard.
        </CardContent>
      </Card>
    </div>
  );
}
