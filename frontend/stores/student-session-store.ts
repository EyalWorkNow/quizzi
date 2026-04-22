import { create } from "zustand";

import type { SessionEvent } from "@/lib/schemas";

type StudentSessionState = {
  lastSeq: number;
  currentQuestion: Record<string, unknown> | null;
  events: SessionEvent[];
  setQuestion: (question: Record<string, unknown>) => void;
  pushEvent: (event: SessionEvent) => void;
  reset: () => void;
};

export const useStudentSessionStore = create<StudentSessionState>((set) => ({
  lastSeq: 0,
  currentQuestion: null,
  events: [],
  setQuestion: (question) => set({ currentQuestion: question }),
  pushEvent: (event) =>
    set((state) => ({
      events: [...state.events, event],
      lastSeq: Math.max(state.lastSeq, event.seq),
      currentQuestion: event.type === "question_opened" ? event.payload : state.currentQuestion
    })),
  reset: () => set({ lastSeq: 0, currentQuestion: null, events: [] })
}));
