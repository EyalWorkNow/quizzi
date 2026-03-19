export type FollowUpPlanId =
  | 'whole_class_reset'
  | 'target_group_reteach'
  | 'confidence_rebuild';

export type FollowUpQuestionDiagnostic = {
  question_id?: number;
  question_index?: number;
  accuracy?: number;
  stress_index?: number;
  changed_away_from_correct_rate?: number;
  deadline_dependency_rate?: number;
  tags?: string[];
};

export type FollowUpPackQuestion = {
  id?: number;
  question_order?: number;
  tags?: string[];
};

export type FollowUpTopicProfile = {
  tag?: string;
  accuracy?: number;
  stress_index?: number;
  changed_away_from_correct_rate?: number;
  deadline_dependency_rate?: number;
  students_count?: number;
  attempts?: number;
};

export type FollowUpParticipant = {
  id?: number;
  nickname?: string;
  risk_level?: string;
  accuracy?: number;
  stress_index?: number;
  weak_tags?: string[];
};

export type FollowUpPlan = {
  id: FollowUpPlanId;
  audience: string;
  title: string;
  body: string;
  focus_tags: string[];
  priority_question_ids: number[];
  priority_question_indexes: number[];
  target_student_ids: number[];
  target_student_names: string[];
  target_student_count: number;
  question_count: number;
};

export type FollowUpEnginePreview = {
  plans: FollowUpPlan[];
  dominant_focus_tags: string[];
  target_question_indexes: number[];
  target_student_count: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function asNumber(value: unknown, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function uniqueStrings(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function uniqueNumbers(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

function severityRank(level?: string) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function scoreQuestion(question: FollowUpQuestionDiagnostic) {
  return (
    (100 - asNumber(question.accuracy, 100)) * 1.25
    + asNumber(question.stress_index) * 0.75
    + asNumber(question.changed_away_from_correct_rate) * 0.8
    + asNumber(question.deadline_dependency_rate) * 0.45
  );
}

function scoreTopic(tag: FollowUpTopicProfile) {
  return (
    (100 - asNumber(tag.accuracy, 100)) * 1.35
    + asNumber(tag.stress_index) * 0.55
    + asNumber(tag.changed_away_from_correct_rate) * 0.7
    + asNumber(tag.deadline_dependency_rate) * 0.35
  );
}

function rankParticipants(participants: FollowUpParticipant[], attentionQueue: FollowUpParticipant[]) {
  const queueOrder = new Map<number, number>(
    attentionQueue
      .map((student, index) => [Number(student?.id || 0), index] as const)
      .filter(([id]) => id > 0),
  );

  return [...participants].sort((left, right) => {
    const leftQueueIndex = queueOrder.get(Number(left?.id || 0));
    const rightQueueIndex = queueOrder.get(Number(right?.id || 0));

    if (leftQueueIndex != null || rightQueueIndex != null) {
      if (leftQueueIndex == null) return 1;
      if (rightQueueIndex == null) return -1;
      if (leftQueueIndex !== rightQueueIndex) return leftQueueIndex - rightQueueIndex;
    }

    return (
      severityRank(String(right?.risk_level || ''))
      - severityRank(String(left?.risk_level || ''))
      || asNumber(left?.accuracy, 100) - asNumber(right?.accuracy, 100)
      || asNumber(right?.stress_index) - asNumber(left?.stress_index)
      || String(left?.nickname || '').localeCompare(String(right?.nickname || ''))
    );
  });
}

function buildRankedTags(
  topicBehaviorProfiles: FollowUpTopicProfile[],
  questionDiagnostics: FollowUpQuestionDiagnostic[],
  packQuestions: FollowUpPackQuestion[],
) {
  const fromTopics = [...topicBehaviorProfiles]
    .filter((entry) => String(entry?.tag || '').trim())
    .sort((left, right) => scoreTopic(right) - scoreTopic(left))
    .map((entry) => String(entry?.tag || '').trim());

  const fromQuestions = questionDiagnostics
    .flatMap((question) => Array.isArray(question?.tags) ? question.tags : [])
    .filter(Boolean);

  const fromPack = packQuestions
    .flatMap((question) => Array.isArray(question?.tags) ? question.tags : [])
    .filter(Boolean);

  return uniqueStrings([...fromTopics, ...fromQuestions, ...fromPack]);
}

function buildRankedQuestions(
  questionDiagnostics: FollowUpQuestionDiagnostic[],
  packQuestions: FollowUpPackQuestion[],
) {
  const rankedDiagnostics = [...questionDiagnostics]
    .filter((question) => asNumber(question?.question_id) > 0)
    .sort((left, right) => scoreQuestion(right) - scoreQuestion(left))
    .map((question) => ({
      id: asNumber(question.question_id),
      index: asNumber(question.question_index),
      tags: Array.isArray(question.tags) ? question.tags : [],
    }));

  if (rankedDiagnostics.length > 0) {
    return rankedDiagnostics;
  }

  return packQuestions
    .filter((question) => asNumber(question?.id) > 0)
    .map((question, index) => ({
      id: asNumber(question.id),
      index: asNumber(question.question_order, index + 1),
      tags: Array.isArray(question.tags) ? question.tags : [],
    }));
}

function pickQuestions(
  rankedQuestions: Array<{ id: number; index: number; tags: string[] }>,
  focusTags: string[],
  desiredCount: number,
) {
  const focusTagSet = new Set(focusTags);
  const selected: Array<{ id: number; index: number; tags: string[] }> = [];

  rankedQuestions.forEach((question) => {
    if (selected.length >= desiredCount) return;
    if (focusTagSet.size > 0 && question.tags.some((tag) => focusTagSet.has(tag))) {
      selected.push(question);
    }
  });

  if (selected.length < desiredCount) {
    const selectedIds = new Set(selected.map((question) => question.id));
    rankedQuestions.forEach((question) => {
      if (selected.length >= desiredCount || selectedIds.has(question.id)) return;
      selected.push(question);
      selectedIds.add(question.id);
    });
  }

  return {
    ids: uniqueNumbers(selected.map((question) => question.id)).slice(0, desiredCount),
    indexes: uniqueNumbers(selected.map((question) => question.index)).slice(0, desiredCount),
  };
}

function buildPlan(
  id: FollowUpPlanId,
  audience: string,
  title: string,
  body: string,
  focusTags: string[],
  questionIds: number[],
  questionIndexes: number[],
  targetStudents: FollowUpParticipant[],
  fallbackStudentCount: number,
) {
  const targetStudentIds = uniqueNumbers(targetStudents.map((student) => student.id));
  const targetStudentNames = uniqueStrings(targetStudents.map((student) => student.nickname)).slice(0, 6);

  return {
    id,
    audience,
    title,
    body,
    focus_tags: uniqueStrings(focusTags).slice(0, 3),
    priority_question_ids: uniqueNumbers(questionIds),
    priority_question_indexes: uniqueNumbers(questionIndexes),
    target_student_ids: targetStudentIds,
    target_student_names: targetStudentNames,
    target_student_count: targetStudentIds.length || fallbackStudentCount,
    question_count: clamp(uniqueNumbers(questionIds).length || questionIndexes.length || 4, 3, 8),
  } satisfies FollowUpPlan;
}

export function buildFollowUpEnginePreview({
  participants = [],
  attentionQueue = [],
  questionDiagnostics = [],
  topicBehaviorProfiles = [],
  packQuestions = [],
}: {
  participants?: FollowUpParticipant[];
  attentionQueue?: FollowUpParticipant[];
  questionDiagnostics?: FollowUpQuestionDiagnostic[];
  topicBehaviorProfiles?: FollowUpTopicProfile[];
  packQuestions?: FollowUpPackQuestion[];
}): FollowUpEnginePreview {
  const rankedParticipants = rankParticipants(participants, attentionQueue);
  const rankedTags = buildRankedTags(topicBehaviorProfiles, questionDiagnostics, packQuestions);
  const rankedQuestions = buildRankedQuestions(questionDiagnostics, packQuestions);
  const classStudentCount = participants.length || attentionQueue.length || 0;

  const wholeClassFocus = rankedTags.slice(0, 3);
  const wholeClassQuestions = pickQuestions(rankedQuestions, wholeClassFocus, clamp(rankedQuestions.length, 4, 6));

  const targetGroupStudents = rankedParticipants.slice(0, clamp(Math.round(classStudentCount * 0.3) || 4, 3, 6));
  const targetGroupFocus = uniqueStrings([
    ...targetGroupStudents.flatMap((student) => Array.isArray(student?.weak_tags) ? student.weak_tags : []),
    ...rankedTags,
  ]).slice(0, 3);
  const targetGroupQuestions = pickQuestions(rankedQuestions, targetGroupFocus, clamp(rankedQuestions.length, 4, 5));

  const confidenceStudents = rankedParticipants
    .filter((student) => severityRank(String(student?.risk_level || '')) >= 2 || asNumber(student?.stress_index) >= 55)
    .slice(0, 8);
  const confidenceQuestionPool = questionDiagnostics.filter(
    (question) =>
      asNumber(question.changed_away_from_correct_rate) >= 10
      || asNumber(question.stress_index) >= 60
      || asNumber(question.deadline_dependency_rate) >= 25,
  );
  const confidenceFocus = uniqueStrings([
    ...confidenceQuestionPool.flatMap((question) => Array.isArray(question?.tags) ? question.tags : []),
    ...rankedTags,
  ]).slice(0, 2);
  const confidenceQuestions = pickQuestions(
    confidenceQuestionPool.length > 0
      ? buildRankedQuestions(confidenceQuestionPool, packQuestions)
      : rankedQuestions,
    confidenceFocus,
    clamp(rankedQuestions.length, 4, 5),
  );

  const plans = [
    buildPlan(
      'whole_class_reset',
      'Whole class',
      'Whole-Class Reset',
      'Rebuild the weakest concept across the full class before the next live run.',
      wholeClassFocus,
      wholeClassQuestions.ids,
      wholeClassQuestions.indexes,
      [],
      classStudentCount,
    ),
    buildPlan(
      'target_group_reteach',
      'Target group',
      'Targeted Small Group',
      'Pull the highest-need students into a shorter reteach round with calmer pacing.',
      targetGroupFocus,
      targetGroupQuestions.ids,
      targetGroupQuestions.indexes,
      targetGroupStudents,
      targetGroupStudents.length,
    ),
    buildPlan(
      'confidence_rebuild',
      'Confidence rebuild',
      'Confidence Rebuild',
      'Re-run the most unstable questions with tighter scaffolding and clearer commitment moments.',
      confidenceFocus,
      confidenceQuestions.ids,
      confidenceQuestions.indexes,
      confidenceStudents,
      confidenceStudents.length || classStudentCount,
    ),
  ].filter((plan) => plan.priority_question_ids.length > 0);

  return {
    plans,
    dominant_focus_tags: rankedTags.slice(0, 3),
    target_question_indexes: uniqueNumbers(plans.flatMap((plan) => plan.priority_question_indexes)).slice(0, 6),
    target_student_count: targetGroupStudents.length || classStudentCount,
  };
}
