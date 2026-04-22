const STORAGE_KEY = "quizzy_pending_responses";

export type PendingResponse = {
  sessionId: string;
  participantToken: string;
  optionId: string;
  latencyMs: number;
  clientResponseId: string;
  createdAt: number;
};

function loadQueue(): PendingResponse[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingResponse[];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingResponse[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueResponse(item: PendingResponse): void {
  const queue = loadQueue();
  if (!queue.find((row) => row.clientResponseId === item.clientResponseId)) {
    queue.push(item);
    saveQueue(queue);
  }
}

export function pendingCount(sessionId: string): number {
  return loadQueue().filter((row) => row.sessionId === sessionId).length;
}

export async function flushResponses(
  sessionId: string,
  sender: (item: PendingResponse) => Promise<void>
): Promise<number> {
  const queue = loadQueue();
  const keep: PendingResponse[] = [];
  let flushed = 0;

  for (const item of queue) {
    if (item.sessionId !== sessionId) {
      keep.push(item);
      continue;
    }

    try {
      await sender(item);
      flushed += 1;
    } catch {
      keep.push(item);
    }
  }

  saveQueue(keep);
  return flushed;
}
