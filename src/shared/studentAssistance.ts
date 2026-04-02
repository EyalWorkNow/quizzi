export const STUDENT_ASSISTANCE_MODE = 'exam_safe_v1' as const;

export const STUDENT_ASSISTANCE_ACTIONS = [
  'reframe_question',
  'extract_keywords',
  'build_checklist',
  'socratic_hint',
  'confidence_check',
  'time_nudge',
  'post_answer_wrap',
] as const;

export type StudentAssistanceAction = (typeof STUDENT_ASSISTANCE_ACTIONS)[number];

export type StudentAssistancePolicy = {
  enabled: boolean;
  mode: typeof STUDENT_ASSISTANCE_MODE;
  allow_question_reframe: boolean;
  allow_keywords: boolean;
  allow_checklist: boolean;
  allow_hint: boolean;
  allow_confidence_check: boolean;
  allow_time_nudge: boolean;
  allow_post_answer_explanation: boolean;
  max_hint_requests_per_question: number;
  max_total_actions_per_question: number;
};

export type StudentAssistanceCapabilities = Record<StudentAssistanceAction, boolean>;

export type StudentAssistanceCard = {
  title: string;
  body: string;
  bullets: string[];
  reflection_prompt: string;
};

export type StudentAssistanceResult = {
  action: StudentAssistanceAction;
  card: StudentAssistanceCard;
  meta: {
    source: 'model' | 'fallback';
    fallback_used: boolean;
    provider: string;
    model: string;
  };
};

export type StudentAssistancePolicyInput = Partial<StudentAssistancePolicy> | null | undefined;

export const DEFAULT_STUDENT_ASSISTANCE_POLICY: StudentAssistancePolicy = {
  enabled: true,
  mode: STUDENT_ASSISTANCE_MODE,
  allow_question_reframe: true,
  allow_keywords: true,
  allow_checklist: true,
  allow_hint: true,
  allow_confidence_check: true,
  allow_time_nudge: true,
  allow_post_answer_explanation: true,
  max_hint_requests_per_question: 0,
  max_total_actions_per_question: 0,
};

export function hasStudentAssistancePolicyOverrides(value: StudentAssistancePolicyInput) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function coerceBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function coercePositiveInt(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function normalizeStudentAssistancePolicy(input?: StudentAssistancePolicyInput): StudentAssistancePolicy {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: coerceBoolean(raw.enabled, DEFAULT_STUDENT_ASSISTANCE_POLICY.enabled),
    mode: STUDENT_ASSISTANCE_MODE,
    allow_question_reframe: coerceBoolean(
      raw.allow_question_reframe,
      DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_question_reframe,
    ),
    allow_keywords: coerceBoolean(raw.allow_keywords, DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_keywords),
    allow_checklist: coerceBoolean(raw.allow_checklist, DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_checklist),
    allow_hint: coerceBoolean(raw.allow_hint, DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_hint),
    allow_confidence_check: coerceBoolean(
      raw.allow_confidence_check,
      DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_confidence_check,
    ),
    allow_time_nudge: coerceBoolean(raw.allow_time_nudge, DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_time_nudge),
    allow_post_answer_explanation: coerceBoolean(
      raw.allow_post_answer_explanation,
      DEFAULT_STUDENT_ASSISTANCE_POLICY.allow_post_answer_explanation,
    ),
    max_hint_requests_per_question: coercePositiveInt(
      raw.max_hint_requests_per_question,
      DEFAULT_STUDENT_ASSISTANCE_POLICY.max_hint_requests_per_question,
      0,
      20,
    ),
    max_total_actions_per_question: coercePositiveInt(
      raw.max_total_actions_per_question,
      DEFAULT_STUDENT_ASSISTANCE_POLICY.max_total_actions_per_question,
      0,
      50,
    ),
  };
}

export function mergeStudentAssistancePolicy(
  base?: StudentAssistancePolicyInput,
  override?: StudentAssistancePolicyInput,
): StudentAssistancePolicy {
  return normalizeStudentAssistancePolicy({
    ...normalizeStudentAssistancePolicy(base),
    ...(override && typeof override === 'object' ? override : {}),
  });
}

export function getStudentAssistanceCapabilities(policyInput?: StudentAssistancePolicyInput): StudentAssistanceCapabilities {
  const policy = normalizeStudentAssistancePolicy(policyInput);
  const enabled = Boolean(policy.enabled);
  return {
    reframe_question: enabled && policy.allow_question_reframe,
    extract_keywords: enabled && policy.allow_keywords,
    build_checklist: enabled && policy.allow_checklist,
    socratic_hint: enabled && policy.allow_hint,
    confidence_check: enabled && policy.allow_confidence_check,
    time_nudge: enabled && policy.allow_time_nudge,
    post_answer_wrap: enabled && policy.allow_post_answer_explanation,
  };
}

export function isStudentAssistanceActionEnabled(
  policyInput: StudentAssistancePolicyInput,
  action: StudentAssistanceAction,
) {
  return Boolean(getStudentAssistanceCapabilities(policyInput)[action]);
}
