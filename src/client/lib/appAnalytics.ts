import { trackFirebaseEvent } from './firebase.ts';

function normalizeErrorCode(message: unknown) {
  return String(message || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export function trackPageView(pathname: string) {
  return trackFirebaseEvent('quizzi_page_view', {
    page_path: pathname,
  });
}

export function trackTeacherAuthEvent({
  action,
  provider,
  result,
  mode,
  errorCode,
}: {
  action: 'sign_in' | 'sign_out';
  provider: 'password' | 'google' | 'facebook';
  result: 'attempt' | 'success' | 'failure';
  mode?: 'login' | 'create';
  errorCode?: string;
}) {
  return trackFirebaseEvent('quizzi_teacher_auth', {
    action,
    provider,
    result,
    mode: mode || 'login',
    error_code: errorCode || '',
  });
}

export function trackStudentJoinEvent({
  result,
  pinLength,
  errorCode,
}: {
  result: 'attempt' | 'success' | 'failure';
  pinLength: number;
  errorCode?: string;
}) {
  return trackFirebaseEvent('quizzi_student_join', {
    result,
    pin_length: pinLength,
    error_code: errorCode || '',
  });
}

export function trackTeacherSessionLaunch({
  gameType,
  teamCount,
}: {
  gameType: string;
  teamCount: number;
}) {
  return trackFirebaseEvent('quizzi_session_launch', {
    game_type: gameType,
    team_count: teamCount,
  });
}

export function toAnalyticsErrorCode(error: unknown) {
  return normalizeErrorCode(error instanceof Error ? error.message : error);
}
