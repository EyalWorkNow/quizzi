import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { buildScopedHmac } from './authSecrets.js';

const PARTICIPANT_TOKEN_SCOPE = 'participant-access-token';
const PARTICIPANT_TOKEN_HEADER = 'x-quizzi-participant-token';
const PARTICIPANT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface ParticipantAccessSession {
  participantId: number;
  sessionId: number;
  identityKey: string;
  nickname: string;
  issuedAt: string;
  expiresAt: string;
}

function parseCookiesLikeHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').trim();
}

export function normalizeStudentIdentityKey(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 128);
}

export function buildLegacyStudentIdentityKey(nickname: string) {
  const normalizedNickname = String(nickname || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  const encoded = Buffer.from(normalizedNickname || 'anonymous', 'utf8').toString('base64url').slice(0, 96);
  return `legacy:${encoded || 'anonymous'}`;
}

export function resolveStudentIdentityKey(value: unknown, nickname = '') {
  return normalizeStudentIdentityKey(value) || buildLegacyStudentIdentityKey(nickname);
}

export function generateStudentIdentityKey() {
  return `stu_${randomBytes(18).toString('base64url')}`;
}

function signParticipantToken(payload: string) {
  return buildScopedHmac(PARTICIPANT_TOKEN_SCOPE, payload);
}

export function createParticipantAccessToken({
  participantId,
  sessionId,
  identityKey,
  nickname,
}: {
  participantId: number;
  sessionId: number;
  identityKey: string;
  nickname: string;
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + PARTICIPANT_TOKEN_TTL_MS);
  const session: ParticipantAccessSession = {
    participantId: Math.max(0, Math.floor(Number(participantId) || 0)),
    sessionId: Math.max(0, Math.floor(Number(sessionId) || 0)),
    identityKey: resolveStudentIdentityKey(identityKey, nickname),
    nickname: String(nickname || '').trim().slice(0, 160),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const payload = JSON.stringify(session);
  const token = `${Buffer.from(payload, 'utf8').toString('base64url')}.${signParticipantToken(payload)}`;
  return { session, token };
}

export function readParticipantAccessToken(
  req: Pick<Request, 'headers'> | { headers?: Record<string, string | string[] | undefined> },
) {
  const token = parseCookiesLikeHeaderValue(req.headers?.[PARTICIPANT_TOKEN_HEADER]);
  if (!token || !token.includes('.')) return null;

  const [encodedPayload, signature] = token.split('.', 2);
  if (!encodedPayload || !signature) return null;

  let payload = '';
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expectedSignature = signParticipantToken(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as ParticipantAccessSession;
    const participantId = Math.max(0, Math.floor(Number(parsed?.participantId || 0)));
    const sessionId = Math.max(0, Math.floor(Number(parsed?.sessionId || 0)));
    const identityKey = resolveStudentIdentityKey(parsed?.identityKey, parsed?.nickname || '');
    const expiresAt = new Date(String(parsed?.expiresAt || ''));
    if (!participantId || !sessionId || !identityKey || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      participantId,
      sessionId,
      identityKey,
      nickname: String(parsed?.nickname || '').trim().slice(0, 160),
      issuedAt: String(parsed?.issuedAt || ''),
      expiresAt: expiresAt.toISOString(),
    } satisfies ParticipantAccessSession;
  } catch {
    return null;
  }
}

export const participantAuth = {
  headerName: PARTICIPANT_TOKEN_HEADER,
};
