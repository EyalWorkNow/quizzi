import { DEFAULT_SESSION_SOUNDTRACKS, type SessionSoundtrackChoice } from './sessionSoundtracks.ts';

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
  lobby_track_id?: SessionSoundtrackChoice;
  gameplay_track_id?: SessionSoundtrackChoice;
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
  hexColor: string;
  accentColor: string;
  visualVibe: string; // Used for CSS background patterns or imagery
};

const DEFAULT_AUDIO_MODE_CONFIG: Pick<GameModeConfig, 'lobby_track_id' | 'gameplay_track_id'> = {
  ...DEFAULT_SESSION_SOUNDTRACKS,
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      scoring_profile: 'standard',
    },
    hexColor: '#6366f1', // Indigo
    accentColor: '#818cf8',
    visualVibe: 'dots-grid',
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      timer_multiplier: 0.65,
      min_time_limit_seconds: 8,
      max_time_limit_seconds: 18,
      scoring_profile: 'speed',
    },
    hexColor: '#f97316', // Orange
    accentColor: '#fb923c',
    visualVibe: 'speed-lines',
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      requires_confidence: true,
      scoring_profile: 'confidence',
    },
    hexColor: '#8b5cf6', // Violet
    accentColor: '#a78bfa',
    visualVibe: 'stepped-gradient',
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      peer_instruction_enabled: true,
      discussion_seconds: 30,
      revote_seconds: 22,
      scoring_profile: 'standard',
    },
    hexColor: '#ec4899', // Pink
    accentColor: '#f472b6',
    visualVibe: 'concentric-circles',
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      scoring_profile: 'standard',
    },
    hexColor: '#10b981', // Emerald
    accentColor: '#34d399',
    visualVibe: 'diagonal-stripes',
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
      ...DEFAULT_AUDIO_MODE_CONFIG,
      scoring_profile: 'coverage',
    },
    hexColor: '#06b6d4', // Cyan
    accentColor: '#22d3ee',
    visualVibe: 'ortho-grid',
  },
] as const;

export function getGameMode(gameModeId?: string | null) {
  return GAME_MODES.find((mode) => mode.id === gameModeId) || GAME_MODES[0];
}

export function getTeamGameModeIds() {
  return GAME_MODES.filter((mode) => mode.teamBased).map((mode) => mode.id);
}
