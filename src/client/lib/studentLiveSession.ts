import { apiFetchJson } from './api.ts';
import { loadStudentAuth } from './studentAuth.ts';
import {
  getOrCreateStudentIdentityKey,
  getParticipantToken,
  storeJoinedParticipantSession,
} from './studentSession.ts';

function buildRequestedStudentNickname(explicitNickname?: string) {
  const studentSession = loadStudentAuth();
  const storedNickname = typeof window !== 'undefined' ? String(window.localStorage.getItem('nickname') || '').trim() : '';
  const storedAvatar = typeof window !== 'undefined' ? String(window.localStorage.getItem('avatar') || '').trim() : '';
  const requestedBaseName = String(explicitNickname || '').trim() || storedNickname || String(studentSession?.displayName || '').trim() || 'Student';

  if (storedNickname) {
    return storedNickname;
  }

  if (!storedAvatar) {
    return requestedBaseName;
  }

  return storedAvatar.endsWith('.png') ? `[${storedAvatar}] ${requestedBaseName}` : `${storedAvatar} ${requestedBaseName}`;
}

export function hasStoredLiveSeatForPin(pin: string) {
  if (typeof window === 'undefined') return false;
  return Boolean(
    String(window.localStorage.getItem('session_pin') || '') === String(pin || '')
      && String(window.localStorage.getItem('participant_id') || '').trim()
      && getParticipantToken(),
  );
}

export async function enterLinkedStudentLiveSession({
  pin,
  nickname,
}: {
  pin: string;
  nickname?: string;
}) {
  const studentSession = loadStudentAuth();
  if (!studentSession?.student_user_id) {
    throw new Error('Student authentication required');
  }

  const requestedNickname = buildRequestedStudentNickname(nickname || studentSession.displayName);
  const identityKey = getOrCreateStudentIdentityKey();
  const payload = await apiFetchJson(`/api/sessions/${pin}/student-entry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nickname: requestedNickname,
      identity_key: identityKey,
    }),
  });

  const storedAvatar = typeof window !== 'undefined' ? String(window.localStorage.getItem('avatar') || '') : '';
  const effectiveNickname = String(payload?.display_name_snapshot || requestedNickname || studentSession.displayName || 'Student');

  storeJoinedParticipantSession({
    participantId: Number(payload?.participant_id || 0),
    sessionId: Number(payload?.session_id || 0),
    sessionPin: String(pin || ''),
    nickname: effectiveNickname,
    avatar: storedAvatar,
    participantToken: String(payload?.participant_token || ''),
    identityKey: String(payload?.identity_key || identityKey),
    teamName: payload?.team_name || null,
    gameType: payload?.game_type || null,
  });

  return payload;
}
