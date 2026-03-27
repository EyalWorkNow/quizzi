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

export function trackPageScrollDepth(pathname: string, percent: number) {
  return trackFirebaseEvent('quizzi_page_scroll_depth', {
    page_path: pathname,
    percent,
  });
}

export function trackCtaClick({
  location,
  ctaId,
  label,
}: {
  location: string;
  ctaId: string;
  label: string;
}) {
  return trackFirebaseEvent('quizzi_cta_click', {
    location,
    cta_id: ctaId,
    label,
  });
}

export function trackFormInteraction({
  formId,
  field,
  action,
}: {
  formId: string;
  field: string;
  action: 'focus' | 'change' | 'complete' | 'error';
}) {
  return trackFirebaseEvent('quizzi_form_interaction', {
    form_id: formId,
    field,
    action,
  });
}

export function trackFaqInteraction({
  questionId,
  expanded,
}: {
  questionId: string;
  expanded: boolean;
}) {
  return trackFirebaseEvent('quizzi_faq_interaction', {
    question_id: questionId,
    expanded,
  });
}

export function trackFeedbackSubmission({
  score,
  messageLength,
}: {
  score: 'positive' | 'neutral' | 'negative';
  messageLength: number;
}) {
  return trackFirebaseEvent('quizzi_feedback_submit', {
    score,
    message_length: messageLength,
  });
}

export function trackContactFlow({
  action,
  step,
  inquiryType,
}: {
  action: 'start' | 'step_view' | 'step_complete' | 'submit_success' | 'submit_failure' | 'draft_restored';
  step: number;
  inquiryType?: string;
}) {
  return trackFirebaseEvent('quizzi_contact_flow', {
    action,
    step,
    inquiry_type: inquiryType || '',
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
