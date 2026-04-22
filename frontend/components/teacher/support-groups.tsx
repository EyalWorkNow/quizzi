import { People } from "iconsax-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SupportGroups({ groups }: { groups: Array<Record<string, unknown>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-highlight text-accent">
            <People size={17} variant="Bold" />
          </span>
          Layer 2: Support Groups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.length === 0 ? <p className="text-sm text-slate">No groups generated yet.</p> : null}
        {groups.map((group, idx) => (
          <div key={`${group.skill_id}-${idx}`} className="space-y-2 rounded-xl border border-ink/10 bg-bg/35 p-3">
            <div className="flex items-center gap-2">
              <Badge>{String(group.skill_name ?? "Skill focus")}</Badge>
              <span className="text-xs text-slate">{((group.student_ids as string[]) ?? []).length} students</span>
            </div>
            <p className="text-sm text-ink">{String(group.recommended_activity ?? "Targeted reteach and practice")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
