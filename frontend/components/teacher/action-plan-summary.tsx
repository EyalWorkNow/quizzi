import { Ranking } from "iconsax-react";

import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ActionPlanSummary({ summary }: { summary: Record<string, unknown> }) {
  const weak = (summary.top_weak_skills as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-highlight text-accent">
            <Ranking size={17} variant="Bold" />
          </span>
          Layer 1: Class Skill Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {weak.length === 0 ? <p className="text-sm text-slate">No weak skills detected yet.</p> : null}

        {weak.map((skill, index) => {
          const mastery = Number(skill.avg_mastery ?? 0);
          return (
            <div key={String(skill.skill_id)} className="space-y-2 rounded-xl border border-ink/10 bg-bg/35 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-ink">
                  #{index + 1} {String(skill.skill_name ?? skill.skill_id)}
                </span>
                <span className="font-semibold text-accent">{Math.round(mastery * 100)}%</span>
              </div>
              <Progress value={mastery * 100} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
