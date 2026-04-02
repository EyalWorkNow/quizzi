export interface StudentMemorySnapshot {
  identity_key: string;
  nickname: string;
  memory_version: string;
  updated_at: string;
  trust: {
    confidence_band: 'high' | 'medium' | 'low';
    evidence_count: number;
    session_count: number;
    answer_count: number;
    practice_count: number;
    source_freshness: 'fresh' | 'stale';
  };
  summary: {
    headline: string;
    body: string;
    tone: 'good' | 'watch' | 'support';
  };
  history_rollup: {
    sessions_played: number;
    practice_attempts: number;
    total_answers: number;
    correct_answers: number;
    accuracy_pct: number;
    last_seen_at: string | null;
  };
  behavior_baseline: {
    confidence_score: number;
    focus_score: number;
    stress_index: number;
    stability_score: number;
    confidence_band: 'high' | 'medium' | 'low';
  };
  focus_tags: Array<{
    tag: string;
    mastery_score: number;
    status: 'strong' | 'growing' | 'fragile';
    last_seen_at: string | null;
  }>;
  error_patterns: Array<{
    id: string;
    label: string;
    body: string;
    severity: 'good' | 'watch' | 'support';
  }>;
  memory_timeline: Array<{
    id: string;
    label: string;
    accuracy_pct: number;
    stress_index: number;
    confidence_score: number;
  }>;
  coaching: {
    student_message: string;
    teacher_message: string;
    celebration: string;
    caution: string;
  };
  teacher_notes: {
    note: string;
    updated_at: string | null;
  };
  recommended_next_step: {
    title: string;
    body: string;
    action: 'adaptive_practice' | 'targeted_review' | 'confidence_reset' | 'keep_momentum';
    focus_tags: string[];
    reasons: string[];
  };
}

export interface StudentMemoryBuildInput {
  identityKey: string;
  nickname: string;
  overallAnalytics?: any;
  sessionAnalytics?: any;
  mastery?: any[];
  answers?: any[];
  practiceAttempts?: any[];
  sessions?: any[];
  questions?: any[];
  teacherNote?: string | null;
  teacherNoteUpdatedAt?: string | null;
}

function clampPercent(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Number(numeric.toFixed(1))));
}

function normalizeTag(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9:_-]/g, '')
    .slice(0, 64);
}

function titleCaseTag(tag: string) {
  return tag
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function confidenceBand(score: number) {
  if (score >= 74) return 'high' as const;
  if (score >= 48) return 'medium' as const;
  return 'low' as const;
}

function memoryTone(accuracyPct: number, stressIndex: number, stabilityScore: number) {
  if (accuracyPct < 62 || stressIndex >= 60 || stabilityScore < 45) return 'support' as const;
  if (accuracyPct < 78 || stressIndex >= 40 || stabilityScore < 62) return 'watch' as const;
  return 'good' as const;
}

function describeTrend(current: number, previous: number | null) {
  if (previous == null) return 'steady' as const;
  if (current >= previous + 6) return 'up' as const;
  if (current <= previous - 6) return 'down' as const;
  return 'steady' as const;
}

function freshnessFromIso(value: string | null) {
  if (!value) return 'stale' as const;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'stale' as const;
  const ageMs = Date.now() - timestamp;
  return ageMs <= 21 * 24 * 60 * 60 * 1000 ? 'fresh' : 'stale';
}

function uniqueReasons(items: string[]) {
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 4);
}

export function buildStudentMemorySnapshot(input: StudentMemoryBuildInput): StudentMemorySnapshot {
  const {
    identityKey,
    nickname,
    overallAnalytics,
    sessionAnalytics,
    mastery = [],
    answers = [],
    practiceAttempts = [],
    sessions = [],
    questions = [],
    teacherNote,
    teacherNoteUpdatedAt,
  } = input;

  const correctAnswers = answers.filter((answer: any) => Number(answer?.is_correct) > 0).length;
  const accuracyPct = clampPercent(
    overallAnalytics?.stats?.accuracy ?? (answers.length ? (correctAnswers / answers.length) * 100 : 0),
  );
  const confidenceScore = clampPercent(overallAnalytics?.profile?.confidence_score);
  const focusScore = clampPercent(overallAnalytics?.profile?.focus_score);
  const stressIndex = clampPercent(overallAnalytics?.risk?.stress_index);
  const stabilityScore = clampPercent(overallAnalytics?.stabilityScore || overallAnalytics?.aggregates?.stability_score);
  const tone = memoryTone(accuracyPct, stressIndex, stabilityScore);

  const tagByQuestionId = new Map<number, string[]>();
  for (const question of questions) {
    tagByQuestionId.set(
      Number(question?.id || 0),
      parseJsonArray(question?.tags_json).map(normalizeTag).filter(Boolean),
    );
  }

  const tagLastSeen = new Map<string, string>();
  for (const answer of answers) {
    const createdAt = String(answer?.created_at || '');
    for (const tag of tagByQuestionId.get(Number(answer?.question_id || 0)) || []) {
      if (createdAt && (!tagLastSeen.get(tag) || createdAt > String(tagLastSeen.get(tag)))) {
        tagLastSeen.set(tag, createdAt);
      }
    }
  }

  const focusTags = mastery
    .map((row: any) => {
      const rawScore = Number(row?.score || 0);
      const masteryScore = clampPercent(rawScore <= 1 ? rawScore * 100 : rawScore);
      const tag = normalizeTag(row?.tag);
      return {
        tag,
        mastery_score: masteryScore,
        status: masteryScore >= 75 ? 'strong' as const : masteryScore >= 50 ? 'growing' as const : 'fragile' as const,
        last_seen_at: tagLastSeen.get(tag) || row?.updated_at || null,
      };
    })
    .filter((row) => row.tag)
    .sort((left, right) => left.mastery_score - right.mastery_score)
    .slice(0, 4);

  const weakTags = focusTags.filter((tag) => tag.status !== 'strong');
  const misconceptionPatterns = Array.isArray(overallAnalytics?.misconceptionPatterns) ? overallAnalytics.misconceptionPatterns : [];
  const questionReview = Array.isArray(sessionAnalytics?.questionReview)
    ? sessionAnalytics.questionReview
    : Array.isArray(overallAnalytics?.questionReview)
      ? overallAnalytics.questionReview
      : [];

  const errorPatterns = [
    stressIndex >= 60
      ? {
          id: 'time-pressure',
          label: 'Pressure spikes under the timer',
          body: `Stress baseline is ${stressIndex.toFixed(0)}%, so the student likely needs calmer pacing before the next high-pressure round.`,
          severity: 'support' as const,
        }
      : null,
    confidenceScore < 50
      ? {
          id: 'confidence-instability',
          label: 'Confidence is still unstable',
          body: `Confidence baseline is ${confidenceScore.toFixed(0)}%, which means answer changes are likely hurting performance more than helping.`,
          severity: 'watch' as const,
        }
      : null,
    weakTags[0]
      ? {
          id: `tag-${weakTags[0].tag}`,
          label: `${titleCaseTag(weakTags[0].tag)} keeps returning as a weak area`,
          body: `${titleCaseTag(weakTags[0].tag)} is currently remembered at ${weakTags[0].mastery_score.toFixed(0)}% mastery, so that is the best next target.`,
          severity: weakTags[0].mastery_score < 45 ? ('support' as const) : ('watch' as const),
        }
      : null,
    misconceptionPatterns[0]
      ? {
          id: 'misconception-pattern',
          label: 'A repeated misconception pattern is visible',
          body: String(
            misconceptionPatterns[0]?.body ||
              misconceptionPatterns[0]?.headline ||
              'The same conceptual confusion keeps reappearing across attempts.',
          ),
          severity: 'watch' as const,
        }
      : null,
    questionReview.some((row: any) => row?.revision_outcome === 'correct_to_incorrect')
      ? {
          id: 'harmful-revision',
          label: 'Correct answers are sometimes being revised away',
          body: 'The memory trace shows harmful revisions, so the learner should rebuild confidence before more speed pressure.',
          severity: 'support' as const,
        }
      : null,
  ].filter(Boolean) as StudentMemorySnapshot['error_patterns'];

  const sessionHistory = Array.isArray(overallAnalytics?.sessionHistory) ? overallAnalytics.sessionHistory : [];
  const memoryTimeline = sessionHistory.slice(-4).map((row: any, index: number) => ({
    id: String(row?.session_id || `timeline-${index}`),
    label: String(row?.pack_title || row?.label || `Session ${index + 1}`).slice(0, 40),
    accuracy_pct: clampPercent(row?.accuracy),
    stress_index: clampPercent(row?.stress_index),
    confidence_score: clampPercent(row?.confidence_score ?? confidenceScore),
  }));
  const latestTimeline = memoryTimeline[memoryTimeline.length - 1] || null;
  const previousTimeline = memoryTimeline.length > 1 ? memoryTimeline[memoryTimeline.length - 2] : null;
  const accuracyTrend = describeTrend(Number(latestTimeline?.accuracy_pct || accuracyPct), previousTimeline ? Number(previousTimeline.accuracy_pct || 0) : null);
  const confidenceTrend = describeTrend(Number(latestTimeline?.confidence_score || confidenceScore), previousTimeline ? Number(previousTimeline.confidence_score || 0) : null);
  const stressTrend = describeTrend(
    100 - Number(latestTimeline?.stress_index || stressIndex),
    previousTimeline ? 100 - Number(previousTimeline.stress_index || 0) : null,
  );

  const action =
    weakTags.length > 0 && stressIndex >= 55
      ? 'confidence_reset'
      : weakTags.length > 0
        ? 'adaptive_practice'
        : stressIndex >= 45
          ? 'targeted_review'
          : 'keep_momentum';
  const recommendedFocusTags = weakTags.map((tag) => tag.tag).slice(0, 3);
  const lastSeenAt =
    [sessions, practiceAttempts, answers]
      .flatMap((rows: any[]) => rows.map((row: any) => String(row?.created_at || row?.ended_at || row?.started_at || '')))
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
  const trustSessionCount = Math.max(sessions.length, sessionHistory.length);
  const evidenceCount = trustSessionCount + practiceAttempts.length + answers.length;
  const reasons = uniqueReasons([
    recommendedFocusTags[0] ? `${titleCaseTag(recommendedFocusTags[0])} is still the weakest remembered concept.` : '',
    stressIndex >= 55 ? `Stress baseline is ${stressIndex.toFixed(0)}%, so calmer pacing should come first.` : '',
    confidenceScore < 50 ? `Confidence baseline is only ${confidenceScore.toFixed(0)}%, so answer commitment is still fragile.` : '',
    accuracyTrend === 'down' ? 'Recent sessions show a downward accuracy trend.' : '',
    confidenceTrend === 'up' ? 'Confidence is climbing, so a short stretch challenge is safe.' : '',
  ]);

  return {
    identity_key: identityKey,
    nickname: String(nickname || '').trim(),
    memory_version: 'v2',
    updated_at: new Date().toISOString(),
    trust: {
      confidence_band:
        evidenceCount >= 24 || trustSessionCount >= 5
          ? 'high'
          : evidenceCount >= 10 || trustSessionCount >= 2
            ? 'medium'
            : 'low',
      evidence_count: evidenceCount,
      session_count: trustSessionCount,
      answer_count: answers.length,
      practice_count: practiceAttempts.length,
      source_freshness: freshnessFromIso(lastSeenAt),
    },
    summary: {
      tone,
      headline:
        tone === 'support'
          ? 'This learner needs a steadier pace before another fast round'
          : tone === 'watch'
            ? 'The learner is progressing, but the memory trace is still uneven'
            : 'The learner shows a stable memory pattern overall',
      body:
        tone === 'support'
          ? `Accuracy is ${accuracyPct.toFixed(0)}% with ${stressIndex.toFixed(0)}% stress, so the next step should reduce pressure and revisit the core idea more clearly.`
          : tone === 'watch'
            ? 'The student is improving, but confidence and focus are not stable enough yet for autopilot.'
            : 'The current memory trace is strong enough to keep advancing rather than reteaching the same core ideas.',
    },
    history_rollup: {
      sessions_played: sessions.length,
      practice_attempts: practiceAttempts.length,
      total_answers: answers.length,
      correct_answers: correctAnswers,
      accuracy_pct: accuracyPct,
      last_seen_at: lastSeenAt,
    },
    behavior_baseline: {
      confidence_score: confidenceScore,
      focus_score: focusScore,
      stress_index: stressIndex,
      stability_score: stabilityScore,
      confidence_band: confidenceBand(confidenceScore),
    },
    focus_tags: focusTags,
    error_patterns: errorPatterns.slice(0, 4),
    memory_timeline: memoryTimeline,
    coaching: {
      student_message:
        action === 'confidence_reset'
          ? 'Slow it down for one short round. You are closer than the timer makes it feel.'
          : action === 'adaptive_practice'
            ? `The next practice should focus on ${recommendedFocusTags.map(titleCaseTag).join(', ') || 'your weakest topics'}.`
            : action === 'targeted_review'
              ? 'A quick explanation-first review should help your next round feel easier.'
              : 'Your recent pattern is stable. One short review round should be enough to keep it fresh.',
      teacher_message:
        action === 'confidence_reset'
          ? 'Lower pace before retesting. The memory trace suggests pressure is distorting performance more than content gaps alone.'
          : action === 'adaptive_practice'
            ? `Build the next set around ${recommendedFocusTags.map(titleCaseTag).join(', ') || 'the weakest tags'} and keep the scope tight.`
            : action === 'targeted_review'
              ? 'Use one explanation-led review before another timed round.'
              : 'This learner can stay in reinforcement mode without a full reteach.',
      celebration:
        accuracyTrend === 'up'
          ? 'Accuracy is trending up across recent sessions.'
          : confidenceTrend === 'up'
            ? 'Confidence is becoming more stable.'
            : 'The learner is staying engaged, which gives the model useful signal.',
      caution:
        stressTrend === 'down'
          ? 'Pressure tolerance is slipping, so the next step should be calmer.'
          : weakTags[0]
            ? `${titleCaseTag(weakTags[0].tag)} is still resurfacing as a fragile area.`
            : 'Keep watching whether stable results hold under a timer.',
    },
    teacher_notes: {
      note: String(teacherNote || '').trim(),
      updated_at: teacherNoteUpdatedAt || null,
    },
    recommended_next_step: {
      action,
      focus_tags: recommendedFocusTags,
      title:
        action === 'confidence_reset'
          ? 'Run a lower-pressure confidence reset'
          : action === 'adaptive_practice'
            ? 'Start an adaptive practice set from memory'
            : action === 'targeted_review'
              ? 'Revisit the pressure-heavy questions'
              : 'Keep momentum with a short reinforcement round',
      body:
        action === 'confidence_reset'
          ? 'Use a short practice set with weaker tags and calmer pacing before the next timed assessment.'
          : action === 'adaptive_practice'
            ? `Build the next practice around ${recommendedFocusTags.map(titleCaseTag).join(', ') || 'the weakest memory traces'}.`
            : action === 'targeted_review'
              ? 'Review recent mistakes with explanation-first pacing to stabilize decisions before the next live round.'
              : 'The memory trace looks healthy enough for a quick booster instead of a full reset.',
      reasons,
    },
  };
}
