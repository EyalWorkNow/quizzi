"use client";

import { useState } from "react";
import { Like1, MessageQuestion, Trash, TickCircle } from "iconsax-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CandidateQuestion } from "@/lib/schemas";

const OPTION_COLORS = [
  { bg: "bg-indigo-500/10 border-indigo-500/25", text: "text-indigo-300" },
  { bg: "bg-amber-500/10 border-amber-500/25",   text: "text-amber-300"  },
  { bg: "bg-rose-500/10 border-rose-500/25",     text: "text-rose-300"   },
  { bg: "bg-teal-500/10 border-teal-500/25",     text: "text-teal-300"   },
];
const LETTERS = ["A", "B", "C", "D"];

export function CandidateReviewTable({
  rows,
  onApprove,
  onReject,
}: {
  rows: CandidateQuestion[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-slate">
        No questions yet. Upload material and generate questions to see them here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const skillTag =
          row.tags.find((t) => t.tag_type === "skill")?.tag_value ?? "Unmapped";
        return (
          <div
            key={row.id}
            className="rounded-2xl border border-ink/15 bg-bg/40 p-5 space-y-4 hover:border-ink/25 transition-colors"
          >
            {/* Question stem */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <MessageQuestion size={18} className="text-accent shrink-0 mt-0.5" variant="Bold" />
                <p className="font-semibold text-ink text-sm leading-relaxed">{row.stem}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-1 text-xs text-slate border border-ink/10">
                  {skillTag}
                </span>
                <Badge>{row.difficulty}</Badge>
              </div>
            </div>

            {/* Answer options */}
            <div className="grid gap-2 sm:grid-cols-2">
              {row.options.map((opt, i) => {
                const color = OPTION_COLORS[i % OPTION_COLORS.length];
                const letter = LETTERS[i] ?? opt.option_key ?? String(i + 1);
                return (
                  <div
                    key={opt.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${color.bg} ${opt.is_correct ? "ring-1 ring-accent/40" : ""}`}
                  >
                    <span className={`text-xs font-black w-5 shrink-0 ${color.text}`}>
                      {letter}
                    </span>
                    <span className="text-xs text-ink/80 leading-snug flex-1">{opt.text}</span>
                    {opt.is_correct && (
                      <TickCircle size={14} variant="Bold" className="text-accent shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 border-t border-ink/10">
              <Button
                size="sm"
                disabled={busyId === row.id}
                onClick={async () => {
                  setBusyId(row.id);
                  await onApprove(row.id);
                  setBusyId(null);
                }}
              >
                <Like1 size={14} variant="Bold" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === row.id}
                onClick={async () => {
                  setBusyId(row.id);
                  await onReject(row.id);
                  setBusyId(null);
                }}
              >
                <Trash size={14} variant="Bold" />
                Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
