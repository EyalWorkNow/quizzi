export const GAME_MODES = [
  {
    id: 'classic_quiz',
    label: 'Classic Quiz',
    shortLabel: 'Classic',
    teamBased: false,
    defaultTeamCount: 0,
    researchCue: 'Fast retrieval practice with immediate feedback.',
    description:
      'Individual competitive quiz with direct scoring, clean pacing, and the lightest cognitive overhead.',
    objectives: ['Rapid retrieval', 'High replayability', 'Clear individual ranking'],
  },
  {
    id: 'team_relay',
    label: 'Team Relay',
    shortLabel: 'Relay',
    teamBased: true,
    defaultTeamCount: 4,
    researchCue: 'Retrieval practice plus team accountability.',
    description:
      'Students are auto-grouped into teams. The class still answers individually, but the live board and final analytics are team-first.',
    objectives: ['Peer accountability', 'Collective momentum', 'Low-friction group play'],
  },
  {
    id: 'peer_pods',
    label: 'Peer Pods',
    shortLabel: 'Pods',
    teamBased: true,
    defaultTeamCount: 5,
    researchCue: 'Peer instruction and collaborative explanation.',
    description:
      'Small pods answer the same items. Analytics emphasize consensus, divergence, and whether teams reason together under pressure.',
    objectives: ['Peer instruction', 'Discussion-rich rounds', 'Consensus analytics'],
  },
  {
    id: 'mastery_matrix',
    label: 'Mastery Matrix',
    shortLabel: 'Matrix',
    teamBased: true,
    defaultTeamCount: 4,
    researchCue: 'Interleaving plus concept coverage tracking.',
    description:
      'Teams compete on concept coverage, not only raw score. The engine rewards broad mastery across tags and weak-topic recovery.',
    objectives: ['Concept coverage', 'Balanced team mastery', 'Tag-level competition'],
  },
] as const;

export type GameModeId = (typeof GAME_MODES)[number]['id'];

export function getGameMode(gameModeId?: string | null) {
  return GAME_MODES.find((mode) => mode.id === gameModeId) || GAME_MODES[0];
}
