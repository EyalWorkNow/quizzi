"use client";

import { Flash } from "iconsax-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AnswerPanel({
  question,
  onAnswer
}: {
  question: { stem: string; options: Array<{ id: string; key: string; text: string }> };
  onAnswer: (optionId: string) => Promise<void>;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-highlight to-card">
        <p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate">
          <Flash size={12} className="text-accent" />
          Live Question
        </p>
        <CardTitle className="text-xl leading-snug">{question.stem}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {question.options.map((option) => (
          <Button key={option.id} className="h-auto justify-start rounded-xl py-3 text-left" variant="outline" onClick={() => onAnswer(option.id)}>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-highlight text-xs font-semibold text-accent">
              {option.key}
            </span>
            <span className="flex-1">{option.text}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
