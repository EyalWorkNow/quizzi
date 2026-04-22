import type { SessionEvent } from "@/lib/schemas";

const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE ?? "ws://localhost:8000";

type EventHandler = (event: SessionEvent) => void;

export function connectTeacherSession(sessionId: string, onEvent: EventHandler, lastSeq = 0) {
  const socket = new WebSocket(`${WS_BASE}/ws/teacher/sessions/${sessionId}?last_seq=${lastSeq}`);
  socket.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as SessionEvent);
  };
  return socket;
}

export function connectStudentSession(
  sessionId: string,
  participantToken: string,
  onEvent: EventHandler,
  lastSeq = 0
) {
  const socket = new WebSocket(
    `${WS_BASE}/ws/student/sessions/${sessionId}?participant_token=${participantToken}&last_seq=${lastSeq}`
  );
  socket.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as SessionEvent);
  };
  return socket;
}

type Status = "connecting" | "connected" | "reconnecting" | "disconnected";

function startReconnectingSocket(
  urlFactory: (lastSeq: number) => string,
  onEvent: EventHandler,
  lastSeq = 0,
  onStatus?: (status: Status) => void
) {
  let socket: WebSocket | null = null;
  let alive = true;
  let retry = 0;
  let cursor = lastSeq;

  const connect = () => {
    if (!alive) return;
    onStatus?.(retry === 0 ? "connecting" : "reconnecting");
    socket = new WebSocket(urlFactory(cursor));

    socket.onopen = () => {
      retry = 0;
      onStatus?.("connected");
    };

    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as SessionEvent;
      cursor = Math.max(cursor, event.seq);
      onEvent(event);
    };

    socket.onclose = () => {
      if (!alive) return;
      onStatus?.("reconnecting");
      const delay = Math.min(5000, 500 * 2 ** retry);
      retry += 1;
      window.setTimeout(connect, delay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    alive = false;
    onStatus?.("disconnected");
    socket?.close();
  };
}

export function connectTeacherSessionWithRetry(
  sessionId: string,
  onEvent: EventHandler,
  lastSeq = 0,
  onStatus?: (status: Status) => void
) {
  return startReconnectingSocket(
    (cursor) => `${WS_BASE}/ws/teacher/sessions/${sessionId}?last_seq=${cursor}`,
    onEvent,
    lastSeq,
    onStatus
  );
}

export function connectStudentSessionWithRetry(
  sessionId: string,
  participantToken: string,
  onEvent: EventHandler,
  lastSeq = 0,
  onStatus?: (status: Status) => void
) {
  return startReconnectingSocket(
    (cursor) =>
      `${WS_BASE}/ws/student/sessions/${sessionId}?participant_token=${participantToken}&last_seq=${cursor}`,
    onEvent,
    lastSeq,
    onStatus
  );
}
