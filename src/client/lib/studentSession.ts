export const PARTICIPANT_TOKEN_KEY = 'quizzi.participant.token';
export const STUDENT_IDENTITY_KEY = 'quizzi.student.identity';

function randomIdentityKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stu_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `stu_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function getParticipantToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(PARTICIPANT_TOKEN_KEY) || '';
}

export function getOrCreateStudentIdentityKey() {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(STUDENT_IDENTITY_KEY);
  if (existing) return existing;
  const created = randomIdentityKey();
  window.localStorage.setItem(STUDENT_IDENTITY_KEY, created);
  return created;
}

export function storeJoinedParticipantSession(payload: {
  participantId: number;
  sessionId: number;
  sessionPin: string;
  nickname: string;
  avatar: string;
  participantToken?: string;
  identityKey?: string;
  teamName?: string | null;
  gameType?: string | null;
}) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('participant_id', String(payload.participantId));
  window.localStorage.setItem('session_id', String(payload.sessionId));
  window.localStorage.setItem('session_pin', payload.sessionPin);
  window.localStorage.setItem('nickname', payload.nickname);
  window.localStorage.setItem('avatar', payload.avatar);
  if (payload.participantToken) {
    window.localStorage.setItem(PARTICIPANT_TOKEN_KEY, payload.participantToken);
  }
  if (payload.identityKey) {
    window.localStorage.setItem(STUDENT_IDENTITY_KEY, payload.identityKey);
  }
  if (payload.teamName) {
    window.localStorage.setItem('team_name', payload.teamName);
  } else {
    window.localStorage.removeItem('team_name');
  }
  if (payload.gameType) {
    window.localStorage.setItem('game_type', payload.gameType);
  } else {
    window.localStorage.removeItem('game_type');
  }
}

export function clearJoinedParticipantSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('participant_id');
  window.localStorage.removeItem('session_id');
  window.localStorage.removeItem('session_pin');
  window.localStorage.removeItem('nickname');
  window.localStorage.removeItem('team_name');
  window.localStorage.removeItem('game_type');
  window.localStorage.removeItem(PARTICIPANT_TOKEN_KEY);
}
