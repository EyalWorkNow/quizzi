import type { LmsProviderCatalogEntry, LmsProviderId } from '../../shared/integrations.js';
import { DEFAULT_LMS_PROVIDER } from '../../shared/integrations.js';

type SessionPayload = {
  session: any;
  pack: any;
  participants: any[];
  questions: any[];
  answers: any[];
};

type LmsExportPackage = {
  provider_id: LmsProviderId;
  provider_label: string;
  filename: string;
  csv: string;
  rows: Array<Record<string, unknown>>;
  notes: string[];
};

type LmsProviderRuntime = {
  catalog: LmsProviderCatalogEntry;
  buildRows: (payload: SessionPayload, context: ReturnType<typeof buildGradebookContext>) => Array<Record<string, unknown>>;
  buildNotes: (payload: SessionPayload, context: ReturnType<typeof buildGradebookContext>) => string[];
};

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'session';
}

function csvEscape(value: unknown) {
  if (value == null) return '';
  const text =
    typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'number'
        ? String(Number.isFinite(value) ? value : 0)
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function stringifyCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function toPercent(value: number, maximum = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.round(value * 100) / 100));
}

function buildGradebookContext(payload: SessionPayload) {
  const answersByParticipant = new Map<number, any[]>();
  for (const answer of payload.answers || []) {
    const participantId = Number(answer?.participant_id || 0);
    if (!participantId) continue;
    if (!answersByParticipant.has(participantId)) {
      answersByParticipant.set(participantId, []);
    }
    answersByParticipant.get(participantId)?.push(answer);
  }

  const totalQuestions = Math.max(1, Number(payload.questions?.length || 0));
  const assignmentLabel = String(payload.pack?.lms_assignment_label || payload.pack?.title || `Session ${payload.session?.id || ''}`).trim();
  const rows = (payload.participants || []).map((participant) => {
    const participantAnswers = answersByParticipant.get(Number(participant?.id || 0)) || [];
    const totalScore = participantAnswers.reduce((sum, answer) => sum + Number(answer?.score_awarded || 0), 0);
    const correctCount = participantAnswers.reduce(
      (sum, answer) => sum + (Number(answer?.is_correct || 0) ? 1 : 0),
      0,
    );
    const answersCount = participantAnswers.length;
    const accuracyPercent = answersCount ? (correctCount / answersCount) * 100 : 0;
    const participationPercent = totalQuestions ? (answersCount / totalQuestions) * 100 : 0;
    const gradePercent = totalQuestions ? (correctCount / totalQuestions) * 100 : 0;

    return {
      participant_id: Number(participant?.id || 0),
      nickname: String(participant?.nickname || ''),
      answers_count: answersCount,
      correct_count: correctCount,
      total_score: totalScore,
      accuracy_percent: toPercent(accuracyPercent),
      participation_percent: toPercent(participationPercent),
      grade_percent: toPercent(gradePercent),
      present_flag: answersCount > 0 ? 1 : 0,
    };
  });

  return {
    assignmentLabel,
    totalQuestions,
    courseCode: String(payload.pack?.course_code || ''),
    courseName: String(payload.pack?.course_name || ''),
    sectionName: String(payload.pack?.section_name || ''),
    academicTerm: String(payload.pack?.academic_term || ''),
    weekLabel: String(payload.pack?.week_label || ''),
    sessionId: Number(payload.session?.id || 0),
    sessionPin: String(payload.session?.pin || ''),
    rows,
  };
}

const runtimeProviders: Record<LmsProviderId, LmsProviderRuntime> = {
  generic_csv: {
    catalog: {
      id: 'generic_csv',
      label: 'Generic Gradebook CSV',
      short_label: 'Generic CSV',
      description: 'Clean, analysis-friendly export for any LMS or spreadsheet workflow.',
      file_extension: 'csv',
      requires_roster_mapping: false,
      workflow_hint: 'Use this when you want the richest CSV and will map columns manually.',
      recommended_columns: ['nickname', 'grade_percent', 'accuracy_percent', 'participation_percent'],
    },
    buildRows(payload, context) {
      return context.rows.map((row) => ({
        course_code: context.courseCode,
        course_name: context.courseName,
        section_name: context.sectionName,
        academic_term: context.academicTerm,
        week_label: context.weekLabel,
        session_id: context.sessionId,
        session_pin: context.sessionPin,
        assignment_name: context.assignmentLabel,
        participant_id: row.participant_id,
        nickname: row.nickname,
        grade_percent: row.grade_percent,
        accuracy_percent: row.accuracy_percent,
        participation_percent: row.participation_percent,
        answers_count: row.answers_count,
        correct_count: row.correct_count,
        total_score: row.total_score,
        present_flag: row.present_flag,
      }));
    },
    buildNotes(_payload, context) {
      return [
        `Best for manual column mapping into any LMS import flow.`,
        `Assignment column label: ${context.assignmentLabel}`,
      ];
    },
  },
  canvas: {
    catalog: {
      id: 'canvas',
      label: 'Canvas Gradebook Export',
      short_label: 'Canvas',
      description: 'Canvas-shaped CSV with assignment-first columns for lecturer import workflows.',
      file_extension: 'csv',
      requires_roster_mapping: true,
      workflow_hint: 'Map nickname to Canvas student identifiers before import for reliable grade passback.',
      recommended_columns: ['Student', 'Section', 'Quizzi Grade (%)'],
    },
    buildRows(payload, context) {
      return context.rows.map((row) => ({
        Student: row.nickname,
        Section: context.sectionName,
        Course: context.courseCode || context.courseName,
        Assignment: context.assignmentLabel,
        'Quizzi Grade (%)': row.grade_percent,
        'Quizzi Accuracy (%)': row.accuracy_percent,
        'Quizzi Participation (%)': row.participation_percent,
        'Session ID': context.sessionId,
        'Session PIN': context.sessionPin,
        'Roster Match Key': row.nickname,
      }));
    },
    buildNotes(_payload, context) {
      return [
        `Canvas import works best after matching Quizzi nicknames to Canvas roster identifiers.`,
        `Keep "${context.assignmentLabel}" aligned with an existing Canvas assignment column.`,
      ];
    },
  },
  moodle: {
    catalog: {
      id: 'moodle',
      label: 'Moodle Grade Import CSV',
      short_label: 'Moodle',
      description: 'Moodle-friendly CSV using assignment and feedback columns for manual grade import.',
      file_extension: 'csv',
      requires_roster_mapping: true,
      workflow_hint: 'Map nickname to Moodle username or idnumber before importing grades.',
      recommended_columns: ['username', 'grade', 'feedback'],
    },
    buildRows(_payload, context) {
      return context.rows.map((row) => ({
        username: row.nickname,
        fullname: row.nickname,
        course: context.courseCode || context.courseName,
        group: context.sectionName,
        itemname: context.assignmentLabel,
        grade: row.grade_percent,
        feedback: `Accuracy ${row.accuracy_percent}% • Participation ${row.participation_percent}%`,
        session_id: context.sessionId,
        roster_match_key: row.nickname,
      }));
    },
    buildNotes(_payload, context) {
      return [
        `Moodle grade import is safest when "username" is replaced with a real Moodle username or idnumber.`,
        `Feedback column already includes Quizzi accuracy and participation for ${context.assignmentLabel}.`,
      ];
    },
  },
  blackboard: {
    catalog: {
      id: 'blackboard',
      label: 'Blackboard Grade Center CSV',
      short_label: 'Blackboard',
      description: 'Blackboard-oriented export with grade and notes columns ready for Grade Center mapping.',
      file_extension: 'csv',
      requires_roster_mapping: true,
      workflow_hint: 'Use Blackboard roster identifiers in place of nickname before bulk upload.',
      recommended_columns: ['username', 'grade', 'notes'],
    },
    buildRows(_payload, context) {
      return context.rows.map((row) => ({
        username: row.nickname,
        course_id: context.courseCode,
        section: context.sectionName,
        column_name: context.assignmentLabel,
        grade: row.grade_percent,
        notes: `Accuracy ${row.accuracy_percent}% | Participation ${row.participation_percent}%`,
        session_id: context.sessionId,
        roster_match_key: row.nickname,
      }));
    },
    buildNotes(_payload, context) {
      return [
        `Blackboard uploads need a stable roster identifier; nickname is exported as a placeholder.`,
        `Column name is prefilled as "${context.assignmentLabel}" for Grade Center alignment.`,
      ];
    },
  },
};

function resolveProvider(providerId?: string | null) {
  return runtimeProviders[providerId as LmsProviderId] || runtimeProviders[DEFAULT_LMS_PROVIDER];
}

export function getLmsProvidersCatalog() {
  return Object.values(runtimeProviders).map((provider) => ({ ...provider.catalog }));
}

export function buildLmsExport(payload: SessionPayload, providerId?: string | null): LmsExportPackage {
  const context = buildGradebookContext(payload);
  const provider = resolveProvider(providerId || payload.pack?.lms_provider || DEFAULT_LMS_PROVIDER);
  const rows = provider.buildRows(payload, context);
  return {
    provider_id: provider.catalog.id,
    provider_label: provider.catalog.label,
    filename: `${slugify(context.assignmentLabel)}-${provider.catalog.id}.csv`,
    csv: stringifyCsv(rows),
    rows,
    notes: provider.buildNotes(payload, context),
  };
}
