import {
  get,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { ensureFirebaseRealtimeReady } from './firebase.ts';
import type { GameModeConfig } from '../../shared/gameModes.ts';

const SESSION_ROOT = 'quizziSessions';
const FOCUS_ALERT_WINDOW_MS = 5000;
const loggedRealtimeErrors = new Set<string>();
let realtimeDisabledForSession = false;

export interface RealtimeSessionMeta {
  sessionId?: number;
  quizPackId?: number;
  packTitle?: string;
  gameType?: string;
  teamCount?: number;
  modeConfig?: GameModeConfig;
  status?: string;
  currentQuestionIndex?: number;
  question?: Record<string, unknown> | null;
  updatedAt?: number;
}

export interface RealtimeParticipant {
  participantId: number;
  nickname: string;
  teamId?: number;
  teamName?: string | null;
  seatIndex?: number;
  createdAt?: string | null;
  online?: boolean;
  lastSeenAt?: number;
}

export interface HostedSessionRealtimeHandlers {
  onMeta?: (meta: RealtimeSessionMeta | null) => void;
  onParticipants?: (participants: RealtimeParticipant[]) => void;
  onSelections?: (selections: Record<number, number>) => void;
  onFocusAlerts?: (alerts: Array<{ nickname: string; expiresAt: number }>) => void;
  onAnswerProgress?: (payload: { totalAnswers: number; expected: number }) => void;
  onError?: (error: unknown) => void;
}

function getSessionPath(pin: string) {
  return `${SESSION_ROOT}/${String(pin || '').trim()}`;
}

function logRealtimeError(scope: string, error: any) {
  const isPermissionDenied =
    error?.message?.includes('PERMISSION_DENIED') ||
    error?.message?.includes('permission_denied') ||
    error?.code === 'PERMISSION_DENIED';

  if (isPermissionDenied) {
    realtimeDisabledForSession = true;
  }

  if (loggedRealtimeErrors.has(scope)) {
    return;
  }

  loggedRealtimeErrors.add(scope);

  if (isPermissionDenied) {
    console.error(`[firebase-rtdb] ${scope} FAILED: Permission Denied. This is almost certainly because Anonymous Authentication is disabled in your Firebase Console. Please enable it to allow students to see live updates.`);
  } else {
    console.warn(`[firebase-rtdb] ${scope} failed. Falling back to the built-in live channel.`, error);
  }
}

export async function writeHostedSessionMeta(
  pin: string,
  payload: RealtimeSessionMeta & { expectedParticipants?: number },
) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  const sessionRef = ref(db, getSessionPath(pin));
  const updates: Record<string, unknown> = {
    'meta/sessionId': Number(payload.sessionId || 0),
    'meta/quizPackId': Number(payload.quizPackId || 0),
    'meta/packTitle': payload.packTitle || '',
    'meta/gameType': payload.gameType || 'classic_quiz',
    'meta/teamCount': Number(payload.teamCount || 0),
    'meta/modeConfig': payload.modeConfig || {},
    'meta/status': payload.status || 'LOBBY',
    'meta/currentQuestionIndex': Number(payload.currentQuestionIndex || 0),
    'meta/question': payload.question ?? null,
    'meta/updatedAt': Date.now(),
  };

  if (typeof payload.expectedParticipants === 'number') {
    updates['answerProgress/expected'] = Math.max(0, Number(payload.expectedParticipants) || 0);
    updates['answerProgress/updatedAt'] = Date.now();
  }

  if (payload.status === 'LOBBY' || payload.status === 'QUESTION_ACTIVE' || payload.status === 'QUESTION_REVOTE') {
    updates['answerProgress/totalAnswers'] = 0;
    updates.liveSelections = null;
    updates.submittedAnswers = null;
    updates.focusAlerts = null;
  }

  try {
    await update(sessionRef, updates);
    return true;
  } catch (error) {
    logRealtimeError('write-hosted-session-meta', error);
    return false;
  }
}

export async function syncHostedParticipants(pin: string, participants: RealtimeParticipant[]) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  const participantsMap = participants.reduce<Record<string, Record<string, unknown>>>((acc, participant) => {
    acc[String(participant.participantId)] = {
      participantId: Number(participant.participantId),
      nickname: participant.nickname || '',
      teamId: Number(participant.teamId || 0),
      teamName: participant.teamName || null,
      seatIndex: Number(participant.seatIndex || 0),
      createdAt: participant.createdAt || null,
      online: participant.online ?? true,
      lastSeenAt: participant.lastSeenAt || Date.now(),
    };
    return acc;
  }, {});

  try {
    await Promise.all([
      set(ref(db, `${getSessionPath(pin)}/participants`), Object.keys(participantsMap).length ? participantsMap : null),
      update(ref(db, getSessionPath(pin)), {
        'answerProgress/expected': participants.length,
        'answerProgress/updatedAt': Date.now(),
      }),
    ]);
    return true;
  } catch (error) {
    logRealtimeError('sync-hosted-participants', error);
    return false;
  }
}

export async function announceParticipantJoin(pin: string, participant: RealtimeParticipant) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  try {
    await update(ref(db, `${getSessionPath(pin)}/participants/${participant.participantId}`), {
      participantId: Number(participant.participantId),
      nickname: participant.nickname || '',
      teamId: Number(participant.teamId || 0),
      teamName: participant.teamName || null,
      seatIndex: Number(participant.seatIndex || 0),
      createdAt: participant.createdAt || new Date().toISOString(),
      online: true,
      lastSeenAt: Date.now(),
    });
    return true;
  } catch (error) {
    logRealtimeError('announce-participant-join', error);
    return false;
  }
}

export async function attachParticipantPresence(pin: string, participant: RealtimeParticipant) {
  if (realtimeDisabledForSession) return null;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return null;

  const participantRef = ref(db, `${getSessionPath(pin)}/participants/${participant.participantId}`);
  const connectionRef = ref(db, '.info/connected');
  let disposed = false;

  const writeOnlinePresence = () =>
    update(participantRef, {
      participantId: Number(participant.participantId),
      nickname: participant.nickname || '',
      teamId: Number(participant.teamId || 0),
      teamName: participant.teamName || null,
      seatIndex: Number(participant.seatIndex || 0),
      createdAt: participant.createdAt || new Date().toISOString(),
      online: true,
      lastSeenAt: Date.now(),
    });

  const unsubscribe = onValue(
    connectionRef,
    (snapshot) => {
      if (disposed || snapshot.val() !== true) {
        return;
      }

      void onDisconnect(participantRef)
        .update({
          online: false,
          lastSeenAt: serverTimestamp(),
        })
        .catch((error) => logRealtimeError('participant-presence-disconnect', error));

      void writeOnlinePresence().catch((error) => logRealtimeError('participant-presence-online', error));
    },
    (error) => logRealtimeError('participant-presence-listener', error),
  );

  try {
    await writeOnlinePresence();
  } catch (error) {
    logRealtimeError('participant-presence-initial', error);
  }

  return () => {
    disposed = true;
    unsubscribe();
    void update(participantRef, {
      online: false,
      lastSeenAt: Date.now(),
    }).catch(() => {});
    void onDisconnect(participantRef).cancel().catch(() => {});
  };
}

export async function publishLiveSelection(
  pin: string,
  payload: { participantId: number; nickname?: string; chosenIndex: number },
) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  try {
    await update(ref(db, `${getSessionPath(pin)}/liveSelections/${payload.participantId}`), {
      participantId: Number(payload.participantId),
      nickname: payload.nickname || '',
      chosenIndex: Number(payload.chosenIndex || 0),
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    logRealtimeError('publish-live-selection', error);
    return false;
  }
}

export async function publishFocusAlert(
  pin: string,
  payload: { participantId: number; nickname?: string },
) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  try {
    await set(ref(db, `${getSessionPath(pin)}/focusAlerts/${payload.participantId}`), {
      participantId: Number(payload.participantId),
      nickname: payload.nickname || '',
      updatedAt: Date.now(),
      expiresAt: Date.now() + FOCUS_ALERT_WINDOW_MS,
    });
    return true;
  } catch (error) {
    logRealtimeError('publish-focus-alert', error);
    return false;
  }
}

export async function publishAnswerProgress(
  pin: string,
  payload: { participantId: number; totalAnswers?: number; expected?: number },
) {
  if (realtimeDisabledForSession) return false;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return false;

  try {
    const submittedRef = ref(db, `${getSessionPath(pin)}/submittedAnswers/${payload.participantId}`);
    const alreadySubmitted = await get(submittedRef);
    if (!alreadySubmitted.exists()) {
      await set(submittedRef, {
        participantId: Number(payload.participantId),
        submittedAt: Date.now(),
      });
    }

    if (typeof payload.totalAnswers === 'number') {
      await update(ref(db, `${getSessionPath(pin)}/answerProgress`), {
        totalAnswers: Math.max(0, Number(payload.totalAnswers) || 0),
        expected: Math.max(0, Number(payload.expected) || 0),
        updatedAt: Date.now(),
      });
      return true;
    }

    await runTransaction(ref(db, `${getSessionPath(pin)}/answerProgress/totalAnswers`), (current) => {
      return Math.max(0, Number(current || 0)) + 1;
    });
    await update(ref(db, `${getSessionPath(pin)}/answerProgress`), {
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    logRealtimeError('publish-answer-progress', error);
    return false;
  }
}

function normalizeParticipants(raw: Record<string, any> | null | undefined) {
  return Object.values(raw || {})
    .map((row: any) => ({
      participantId: Number(row?.participantId || row?.participant_id || 0),
      nickname: String(row?.nickname || ''),
      teamId: Number(row?.teamId || row?.team_id || 0),
      teamName: row?.teamName || row?.team_name || null,
      seatIndex: Number(row?.seatIndex || row?.seat_index || 0),
      createdAt: row?.createdAt || row?.created_at || null,
      online: row?.online !== false,
      lastSeenAt: Number(row?.lastSeenAt || 0),
    }))
    .filter((row) => row.participantId > 0)
    .sort((a, b) => {
      const seatDelta = Number(a.seatIndex || 0) - Number(b.seatIndex || 0);
      if (seatDelta !== 0) return seatDelta;
      return String(a.nickname).localeCompare(String(b.nickname));
    });
}

function normalizeSelections(raw: Record<string, any> | null | undefined) {
  return Object.values(raw || {}).reduce<Record<number, number>>((acc, row: any) => {
    const participantId = Number(row?.participantId || row?.participant_id || 0);
    if (participantId > 0) {
      acc[participantId] = Number(row?.chosenIndex ?? row?.chosen_index ?? 0);
    }
    return acc;
  }, {});
}

function normalizeFocusAlerts(raw: Record<string, any> | null | undefined) {
  const now = Date.now();

  return Object.values(raw || {})
    .map((row: any) => ({
      nickname: String(row?.nickname || ''),
      expiresAt: Number(row?.expiresAt || row?.updatedAt || 0) || now + FOCUS_ALERT_WINDOW_MS,
    }))
    .filter((row) => row.nickname && row.expiresAt > now);
}

export async function subscribeToHostedSessionRealtime(
  pin: string,
  handlers: HostedSessionRealtimeHandlers,
) {
  if (realtimeDisabledForSession) return null;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return null;

  const unsubscribers: Unsubscribe[] = [];
  let settled = false;

  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    handlers.onError?.(error);
  };

  try {
    unsubscribers.push(
      onValue(
        ref(db, `${getSessionPath(pin)}/meta`),
        (snapshot) => handlers.onMeta?.((snapshot.val() as RealtimeSessionMeta | null) || null),
        fail,
      ),
    );
    unsubscribers.push(
      onValue(
        ref(db, `${getSessionPath(pin)}/participants`),
        (snapshot) => handlers.onParticipants?.(normalizeParticipants(snapshot.val() as Record<string, any> | null)),
        fail,
      ),
    );
    unsubscribers.push(
      onValue(
        ref(db, `${getSessionPath(pin)}/liveSelections`),
        (snapshot) => handlers.onSelections?.(normalizeSelections(snapshot.val() as Record<string, any> | null)),
        fail,
      ),
    );
    unsubscribers.push(
      onValue(
        ref(db, `${getSessionPath(pin)}/focusAlerts`),
        (snapshot) => handlers.onFocusAlerts?.(normalizeFocusAlerts(snapshot.val() as Record<string, any> | null)),
        fail,
      ),
    );
    unsubscribers.push(
      onValue(
        ref(db, `${getSessionPath(pin)}/answerProgress`),
        (snapshot) => {
          const payload = snapshot.val() as Record<string, any> | null;
          handlers.onAnswerProgress?.({
            totalAnswers: Math.max(0, Number(payload?.totalAnswers || 0)),
            expected: Math.max(0, Number(payload?.expected || 0)),
          });
        },
        fail,
      ),
    );

    return () => {
      settled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function subscribeToStudentSessionRealtime(
  pin: string,
  handlers: {
    onMeta?: (meta: RealtimeSessionMeta | null) => void;
    onError?: (error: unknown) => void;
  },
) {
  if (realtimeDisabledForSession) return null;
  const db = await ensureFirebaseRealtimeReady();
  if (!db) return null;

  try {
    const unsubscribe = onValue(
      ref(db, `${getSessionPath(pin)}/meta`),
      (snapshot) => handlers.onMeta?.((snapshot.val() as RealtimeSessionMeta | null) || null),
      handlers.onError,
    );

    return () => unsubscribe();
  } catch (error) {
    handlers.onError?.(error);
    return null;
  }
}
