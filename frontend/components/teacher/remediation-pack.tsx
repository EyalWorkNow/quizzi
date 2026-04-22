import { Book1, TickCircle } from "iconsax-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RemediationPack({ pack }: { pack: Record<string, unknown> }) {
  const items = (pack.items as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-highlight text-accent">
            <Book1 size={17} variant="Bold" />
          </span>
          Layer 3: Remediation Pack
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate">{String(pack.title ?? "Targeted follow-up question set")}</p>
        {items.length === 0 ? <p className="text-sm text-slate">No remediation items yet.</p> : null}

        {items.map((item, idx) => (
          <div key={`${item.question_id}-${idx}`} className="flex items-center justify-between rounded-xl border border-ink/10 bg-bg/35 p-3 text-sm">
            <span className="inline-flex items-center gap-2 font-medium text-ink">
              <TickCircle size={15} className="text-accent" variant="Bold" />
              Q{idx + 1} - Skill {String(item.skill_id)}
            </span>
            <Badge>{String(item.difficulty)}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
