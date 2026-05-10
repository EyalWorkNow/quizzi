"use client";

import { Flash } from "iconsax-react";

const OPTION_STYLES = [
  { bg: "from-indigo-500 to-indigo-600", badge: "bg-indigo-400", shadow: "shadow-indigo-500/30" },
  { bg: "from-amber-500 to-amber-600", badge: "bg-amber-400", shadow: "shadow-amber-500/30" },
  { bg: "from-rose-500 to-rose-600", badge: "bg-rose-400", shadow: "shadow-rose-500/30" },
  { bg: "from-teal-500 to-teal-600", badge: "bg-teal-400", shadow: "shadow-teal-500/30" },
];

const LETTERS = ["A", "B", "C", "D"];

export function AnswerPanel({
  question,
  onAnswer
}: {
  question: { stem: string; options: Array<{ id: string; key: string; text: string }> };
  onAnswer: (optionId: string) => Promise<void>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl glass-premium border border-ink/15">
      {/* Question header */}
      <div className="bg-gradient-to-r from-highlight to-transparent px-6 py-5 border-b border-ink/15">
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-accent">
          <Flash size={12} className="text-accent" variant="Bold" />
          Live Question
        </p>
        <p className="text-xl font-bold text-ink leading-snug">{question.stem}</p>
      </div>

      {/* Answer tiles */}
      <div className="grid gap-3 p-5">
        {question.options.map((option, index) => {
          const style = OPTION_STYLES[index % OPTION_STYLES.length];
          const letter = LETTERS[index] ?? option.key;
          return (
            <button
              key={option.id}
              onClick={() => onAnswer(option.id)}
              className={`
                group w-full flex items-center gap-4
                min-h-[72px] px-5 rounded-2xl
                bg-gradient-to-r ${style.bg}
                shadow-lg ${style.shadow}
                font-bold text-white text-left
                hover:scale-[1.02] hover:brightness-110
                active:scale-[0.98]
                transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50
              `}
            >
              <span className={`
                inline-flex h-10 w-10 shrink-0 items-center justify-center
                rounded-xl ${style.badge}
                text-white font-black text-lg
                shadow-sm
              `}>
                {letter}
              </span>
              <span className="flex-1 text-base leading-snug">{option.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
