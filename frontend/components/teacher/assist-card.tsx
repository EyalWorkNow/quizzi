"use client";

import { Flash, PauseCircle, PlayCircle, Warning2 } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AssistCard({
  card,
  onPause,
  onLaunchCheck
}: {
  card: Record<string, unknown>;
  onPause: () => void;
  onLaunchCheck: () => void;
}) {
  const skillLabel = String(card.skill_name ?? card.skill_id ?? "Unknown skill");
  const incorrectRate = Math.round(Number(card.incorrect_rate ?? 0) * 100);

  return (
    <Card className="border-gold/40 bg-gradient-to-br from-gold/20 to-bg/45">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold/20 text-gold">
            <Warning2 size={17} variant="Bold" />
          </span>
          Intervene Now
        </CardTitle>
        <CardDescription>
          {skillLabel} needs a quick reteach based on live response signal.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-xl border border-gold/35 bg-bg/45 p-3 text-sm md:grid-cols-3">
          <Signal label="Incorrect" value={`${incorrectRate}%`} />
          <Signal label="Top Wrong" value={String(card.top_wrong_option ?? "n/a")} />
          <Signal label="Misconception" value={String(card.misconception_tag ?? "n/a")} />
        </div>

        <div className="rounded-xl border border-gold/35 bg-gold/15 p-3">
          <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gold">
            <Flash size={13} variant="Bold" />
            Teacher script (60-90 sec)
          </p>
          <p className="text-sm text-ink">
            {String(card.script ?? "Pause, reteach the key concept, then check understanding with a quick follow-up.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onPause}>
            <PauseCircle size={16} variant="Bold" />
            Pause and Intervene
          </Button>
          <Button variant="outline" onClick={onLaunchCheck}>
            <PlayCircle size={16} variant="Bold" />
            Launch Follow-up
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-xs uppercase tracking-wide text-slate">{label}</span>
      <strong className="block text-sm text-ink">{value}</strong>
    </p>
  );
}
