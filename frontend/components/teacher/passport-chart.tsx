import { Activity, Calendar } from "iconsax-react";

import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PassportChart({ snapshots }: { snapshots: Array<Record<string, unknown>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-highlight text-accent">
            <Activity size={17} variant="Bold" />
          </span>
          Mastery Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {snapshots.map((snapshot, idx) => {
          const mastery = Math.round(Number(snapshot.mastery_value ?? 0) * 100);
          return (
            <div key={`${snapshot.session_id}-${idx}`} className="space-y-2 rounded-xl border border-ink/10 bg-bg/35 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-ink">Skill {String(snapshot.skill_name ?? snapshot.skill_id)}</span>
                <span className="font-semibold text-accent">{mastery}%</span>
              </div>
              <Progress value={mastery} />
              <div className="inline-flex items-center gap-1 text-xs text-slate">
                <Calendar size={12} />
                Session {String(snapshot.session_id).slice(0, 8)} - misconception: {String(snapshot.recent_misconception ?? "none")}
              </div>
            </div>
          );
        })}
        {snapshots.length === 0 ? <p className="text-sm text-slate">No passport snapshots yet.</p> : null}
      </CardContent>
    </Card>
  );
}
