import { MedalStar } from "iconsax-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PersonalResultCard({ score, note }: { score: number; note: string }) {
  return (
    <Card className="mx-auto max-w-lg overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-bg via-panel to-card text-ink">
        <CardTitle className="flex items-center gap-2 text-xl text-ink">
          <MedalStar size={18} variant="Bold" />
          Your Result
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 py-6">
        <p className="text-4xl font-bold text-ink">{score}</p>
        <p className="rounded-xl bg-highlight p-3 text-sm text-slate">{note}</p>
      </CardContent>
    </Card>
  );
}
