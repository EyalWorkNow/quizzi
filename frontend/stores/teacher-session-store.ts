import { create } from "zustand";

import type { SessionEvent } from "@/lib/schemas";

type TeacherSessionState = {
  events: SessionEvent[];
  assistCards: SessionEvent[];
  lastSeq: number;
  pushEvent: (event: SessionEvent) => void;
  clear: () => void;
};

export const useTeacherSessionStore = create<TeacherSessionState>((set) => ({
  events: [],
  assistCards: [],
  lastSeq: 0,
  pushEvent: (event) =>
    set((state) => ({
      events: [...state.events, event],
      assistCards: event.type === "assist_card" ? [...state.assistCards, event] : state.assistCards,
      lastSeq: Math.max(state.lastSeq, event.seq)
    })),
  clear: () => set({ events: [], assistCards: [], lastSeq: 0 })
}));
