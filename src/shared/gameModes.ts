export type GameModeId =
  | 'classic_quiz'
  | 'speed_sprint'
  | 'confidence_climb'
  | 'peer_pods'
  | 'team_relay'
  | 'mastery_matrix';

export type GameModeCategory = 'solo' | 'team';

export type GameModeConfig = {
  timer_multiplier?: number;
  min_time_limit_seconds?: number;
  max_time_limit_seconds?: number;
  requires_confidence?: boolean;
  peer_instruction_enabled?: boolean;
  discussion_seconds?: number;
  revote_seconds?: number;
  scoring_profile?: 'standard' | 'speed' | 'confidence' | 'coverage';
};

export type GameModeDefinition = {
  id: GameModeId;
  label: string;
  shortLabel: string;
  category: GameModeCategory;
  teamBased: boolean;
  defaultTeamCount: number;
  evidenceStrength: 'high' | 'medium';
  researchCue: string;
  quickSummary: string;
  description: string;
  objectives: string[];
  bestFor: string[];
  defaultModeConfig: GameModeConfig;
};

export const GAME_MODES: readonly GameModeDefinition[] = [
  {
    id: 'classic_quiz',
    label: 'Classic Quiz',
    shortLabel: 'Classic',
    category: 'solo',
    teamBased: false,
    defaultTeamCount: 0,
    evidenceStrength: 'high',
    researchCue: 'Practice testing with immediate feedback',
    quickSummary: 'The clean retrieval-practice baseline.',
    description:
      'Individual quiz flow with direct scoring, low friction, and the clearest path from question to feedback.',
    objectives: ['Rapid retrieval', 'Low setup overhead', 'Clear individual ranking'],
    bestFor: ['Daily review', 'Whole-class checks', 'Fast formative assessment'],
    defaultModeConfig: {
      scoring_profile: 'standard',
    },
  },
  {
    id: 'speed_sprint',
    label: 'Speed Sprint',
    shortLabel: 'Sprint',
    category: 'solo',
    teamBased: false,
    defaultTeamCount: 0,
    evidenceStrength: 'medium',
    researchCue: 'Repeated fast recall under short windows',
    quickSummary: 'Same quiz bank, tighter pacing, faster retrieval loops.',
    description:
      'A compressed solo mode that shortens question windows so students retrieve from memory before they over-deliberate.',
    objectives: ['Fast recall', 'High tempo', 'Short attention cycles'],
    bestFor: ['Warm-ups', 'Exit tickets', 'Rapid spaced review'],
    defaultModeConfig: {
      timer_multiplier: 0.65,
      min_time_limit_seconds: 8,
      max_time_limit_seconds: 18,
      scoring_profile: 'speed',
    },
  },
  {
    id: 'confidence_climb',
    label: 'Confidence Climb',
    shortLabel: 'Climb',
    category: 'solo',
    teamBased: false,
    defaultTeamCount: 0,
    evidenceStrength: 'high',
    researchCue: 'Retrieval plus metacognitive confidence judgments',
    quickSummary: 'Students answer, then rate how sure they are before lock-in.',
    description:
      'Adds a confidence step before submission so students practice recall and calibration together instead of guessing silently.',
    objectives: ['Confidence calibration', 'Reflective retrieval', 'More deliberate lock-in'],
    bestFor: ['Exam prep', 'Misconception checks', 'Confidence rebuilding'],
    defaultModeConfig: {
      requires_confidence: true,
      scoring_profile: 'confidence',
    },
  },
  {
    id: 'peer_pods',
    label: 'Peer Pods',
    shortLabel: 'Pods',
    category: 'team',
    teamBased: true,
    defaultTeamCount: 5,
    evidenceStrength: 'high',
    researchCue: 'Peer instruction with vote, discuss, revote',
    quickSummary: 'Students vote individually, discuss in pods, then revote.',
    description:
      'Small discussion pods first commit to an answer, then compare reasoning and submit a final revote after discussion.',
    objectives: ['Peer instruction', 'Explanation-rich rounds', 'Revision after discussion'],
    bestFor: ['Conceptual questions', 'Common misconceptions', 'Reasoning-heavy lessons'],
    defaultModeConfig: {
      peer_instruction_enabled: true,
      discussion_seconds: 30,
      revote_seconds: 22,
      scoring_profile: 'standard',
    },
  },
  {
    id: 'team_relay',
    label: 'Team Relay',
    shortLabel: 'Relay',
    category: 'team',
    teamBased: true,
    defaultTeamCount: 4,
    evidenceStrength: 'medium',
    researchCue: 'Collaborative retrieval and shared accountability',
    quickSummary: 'Auto-grouped teams with momentum-driven live play.',
    description:
      'Students are auto-grouped into teams. The class still answers individually, but the live board and end-state feel team-first.',
    objectives: ['Peer accountability', 'Collective momentum', 'Low-friction group play'],
    bestFor: ['Mixed-attainment rooms', 'Energy boosts', 'Team competition'],
    defaultModeConfig: {
      scoring_profile: 'standard',
    },
  },
  {
    id: 'mastery_matrix',
    label: 'Mastery Matrix',
    shortLabel: 'Matrix',
    category: 'team',
    teamBased: true,
    defaultTeamCount: 4,
    evidenceStrength: 'medium',
    researchCue: 'Interleaving and broad concept coverage',
    quickSummary: 'Teams win by balanced concept coverage, not just raw speed.',
    description:
      'Team competition centered on concept coverage and weak-tag recovery, not only total score.',
    objectives: ['Concept coverage', 'Balanced mastery', 'Tag-level competition'],
    bestFor: ['Cumulative review', 'Mixed-topic packs', 'Reinforcement across tags'],
    defaultModeConfig: {
      scoring_profile: 'coverage',
    },
  },
] as const;

export function getGameMode(gameModeId?: string | null) {
  return GAME_MODES.find((mode) => mode.id === gameModeId) || GAME_MODES[0];
}

export function getTeamGameModeIds() {
  return GAME_MODES.filter((mode) => mode.teamBased).map((mode) => mode.id);
}

