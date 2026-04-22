"use client";

import { useState } from "react";
import { Like1, MessageQuestion, Notepad2, Trash } from "iconsax-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CandidateQuestion } from "@/lib/schemas";

export function CandidateReviewTable({
  rows,
  onApprove,
  onReject
}: {
  rows: CandidateQuestion[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <Table>
      <THead>
        <TR>
          <TH>Question</TH>
          <TH>Skill</TH>
          <TH>Difficulty</TH>
          <TH>Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const skillTag = row.tags.find((tag) => tag.tag_type === "skill")?.tag_value ?? "Unmapped";
          return (
            <TR key={row.id}>
              <TD className="max-w-xl">
                <p className="line-clamp-2 font-semibold text-ink">{row.stem}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate">
                  <Notepad2 size={12} />
                  {row.options.length} options
                </p>
              </TD>
              <TD>
                <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-1 text-xs text-slate">
                  <MessageQuestion size={12} />
                  {skillTag}
                </span>
              </TD>
              <TD>
                <Badge>{row.difficulty}</Badge>
              </TD>
              <TD className="flex flex-wrap gap-2">
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
              </TD>
            </TR>
          );
        })}

        {rows.length === 0 ? (
          <TR>
            <TD className="py-10 text-center text-sm text-slate" colSpan={4}>
              No candidates yet. Upload material and generate questions.
            </TD>
          </TR>
        ) : null}
      </TBody>
    </Table>
  );
}
