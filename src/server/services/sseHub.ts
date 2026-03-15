import type { Request, Response } from 'express';
import { resolveClientIp } from './requestGuards.js';

type SseClient = {
  ip: string;
  response: Response;
  sessionId: number;
};

type RegistrationResult =
  | { ok: true; ip: string; sessionId: number }
  | { ok: false; status: number; error: string };

const MAX_CLIENTS_PER_SESSION = parsePositiveInt(process.env.QUIZZI_SSE_MAX_CLIENTS_PER_SESSION, 600);
const MAX_CLIENTS_PER_IP_PER_SESSION = parsePositiveInt(process.env.QUIZZI_SSE_MAX_CLIENTS_PER_IP_PER_SESSION, 6);
const HEARTBEAT_INTERVAL_MS = parsePositiveInt(process.env.QUIZZI_SSE_HEARTBEAT_MS, 15_000);

const sessionClients = new Map<number, Set<SseClient>>();
const responseToClient = new WeakMap<Response, SseClient>();

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function removeClient(client: SseClient | undefined) {
  if (!client) return;
  const clients = sessionClients.get(client.sessionId);
  if (!clients) return;

  clients.delete(client);
  if (clients.size === 0) {
    sessionClients.delete(client.sessionId);
  }
}

function writeEvent(response: Response, payload: string) {
  if (response.destroyed || response.writableEnded) {
    return false;
  }

  try {
    const writable = response.write(payload);
    return writable !== false;
  } catch {
    return false;
  }
}

const heartbeatTimer = setInterval(() => {
  for (const clients of sessionClients.values()) {
    for (const client of Array.from(clients)) {
      const ok = writeEvent(client.response, ': heartbeat\n\n');
      if (!ok) {
        removeClient(client);
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref?.();

export function registerSseClient(sessionId: number, req: Request, res: Response): RegistrationResult {
  const ip = resolveClientIp(req);
  const clients = sessionClients.get(sessionId) || new Set<SseClient>();
  const activeForIp = Array.from(clients).filter((client) => client.ip === ip).length;

  if (clients.size >= MAX_CLIENTS_PER_SESSION) {
    return {
      ok: false,
      status: 503,
      error: 'Live session is at capacity. Try reconnecting shortly.',
    };
  }

  if (activeForIp >= MAX_CLIENTS_PER_IP_PER_SESSION) {
    return {
      ok: false,
      status: 429,
      error: 'Too many live connections from this network.',
    };
  }

  const client: SseClient = {
    ip,
    response: res,
    sessionId,
  };

  clients.add(client);
  sessionClients.set(sessionId, clients);
  responseToClient.set(res, client);

  const cleanup = () => removeClient(responseToClient.get(res));
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);

  writeEvent(res, 'retry: 3000\n\n');
  writeEvent(
    res,
    `event: CONNECTED\ndata: ${JSON.stringify({
      session_id: sessionId,
      connected_at: new Date().toISOString(),
    })}\n\n`,
  );

  return {
    ok: true,
    ip,
    sessionId,
  };
}

export function broadcastToSession(sessionId: number, event: string, data: unknown) {
  const clients = sessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    return 0;
  }

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = 0;

  for (const client of Array.from(clients)) {
    const ok = writeEvent(client.response, payload);
    if (!ok) {
      removeClient(client);
      continue;
    }
    delivered += 1;
  }

  return delivered;
}
