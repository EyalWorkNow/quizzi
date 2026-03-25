import type { GameModeConfig } from '../../shared/gameModes.ts';

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function resolveSessionQuestionTimeLimit(question: any, modeConfig?: GameModeConfig | null) {
  if (isUntimedMode(undefined, modeConfig)) {
    return 0;
  }
  const baseSeconds = clampNumber(question?.time_limit_seconds, 8, 90, 20);
  const multiplier = Number(modeConfig?.timer_multiplier || 1);
  const minSeconds = clampNumber(modeConfig?.min_time_limit_seconds, 5, 90, 8);
  const maxSeconds = clampNumber(modeConfig?.max_time_limit_seconds, minSeconds, 120, Math.max(minSeconds, 30));
  return Math.max(minSeconds, Math.min(maxSeconds, Math.round(baseSeconds * multiplier)));
}

export function isUntimedMode(gameType?: string | null, modeConfig?: GameModeConfig | null) {
  return gameType === 'accuracy_quiz' || modeConfig?.timer_mode === 'unlimited';
}

export function isPeerInstructionMode(gameType?: string | null, modeConfig?: GameModeConfig | null) {
  return gameType === 'peer_pods' || Boolean(modeConfig?.peer_instruction_enabled);
}

export function requiresConfidenceLock(gameType?: string | null, modeConfig?: GameModeConfig | null) {
  return gameType === 'confidence_climb' || Boolean(modeConfig?.requires_confidence);
}
